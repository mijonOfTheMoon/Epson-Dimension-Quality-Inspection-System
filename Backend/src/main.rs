mod auth;
mod config;
mod domain;
mod error;
mod http;
mod ingestion;
mod realtime;
mod storage;

use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Context;
use tokio::net::TcpListener;
use tracing_subscriber::{fmt, EnvFilter};

use crate::config::Config;
use crate::http::router::build_router;
use crate::storage::object_store::R2Store;
use crate::storage::postgres::PostgresStore;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if std::env::args().any(|arg| arg == "--healthcheck") {
        return healthcheck().await;
    }

    dotenvy::dotenv().ok();
    let config = Config::from_env()?;
    init_tracing(&config);

    let store = PostgresStore::connect(&config).await?;
    store.init().await?;
    let object_store = match &config.object_store {
        Some(object_store_config) => Some(Arc::new(R2Store::from_config(object_store_config).await?)),
        None => None,
    };

    let app = build_router(config.clone(), store, object_store);
    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .context("invalid HOST/PORT")?;
    let listener = TcpListener::bind(addr).await?;

    tracing::info!(%addr, node_env = ?config.node_env, "diminspect backend listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

fn init_tracing(config: &Config) {
    let filter = EnvFilter::try_new(&config.log_level).unwrap_or_else(|_| EnvFilter::new("info"));
    fmt()
        .json()
        .with_env_filter(filter)
        .with_current_span(false)
        .with_span_list(false)
        .init();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

async fn healthcheck() -> anyhow::Result<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    dotenvy::dotenv().ok();
    let config = Config::from_env()?;
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", config.port)).await?;
    stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .await?;
    let mut response = [0_u8; 128];
    let read = stream.read(&mut response).await?;
    let status = std::str::from_utf8(&response[..read]).unwrap_or_default();
    if status.starts_with("HTTP/1.1 200") || status.starts_with("HTTP/1.0 200") {
        Ok(())
    } else {
        anyhow::bail!("healthcheck failed")
    }
}
