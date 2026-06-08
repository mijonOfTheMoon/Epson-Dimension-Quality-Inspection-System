pub mod providers;
pub mod templates;

use std::collections::HashMap;

use reqwest::Client;

use crate::config::ShareConfig;
use crate::domain::RecapData;

pub struct ChannelOutcome {
    pub ok: bool,
    pub error: Option<String>,
}

pub fn available_channels(config: &ShareConfig) -> Vec<&'static str> {
    let mut channels = Vec::new();
    if config.telegram.is_some() {
        channels.push("telegram");
    }
    if config.brevo.is_some() {
        channels.push("email");
    }
    if config.discord.is_some() {
        channels.push("discord");
    }
    if config.fonnte.is_some() {
        channels.push("whatsapp");
    }
    channels
}

pub async fn dispatch(
    client: &Client,
    config: &ShareConfig,
    recap: &RecapData,
    channels: &[String],
    email_recipients: &[String],
) -> HashMap<String, ChannelOutcome> {
    let mut results = HashMap::new();
    for channel in channels {
        let outcome = match channel.as_str() {
            "telegram" => match &config.telegram {
                Some(cfg) => providers::send_telegram(client, cfg, &templates::render_telegram(recap)).await,
                None => Err("Telegram belum dikonfigurasi".to_string()),
            },
            "email" => match &config.brevo {
                Some(cfg) => {
                    providers::send_brevo(
                        client,
                        cfg,
                        email_recipients,
                        &templates::render_email_subject(recap),
                        &templates::render_email_html(recap),
                    )
                    .await
                }
                None => Err("Email belum dikonfigurasi".to_string()),
            },
            "discord" => match &config.discord {
                Some(cfg) => providers::send_discord(client, cfg, &templates::render_discord(recap)).await,
                None => Err("Discord belum dikonfigurasi".to_string()),
            },
            "whatsapp" => match &config.fonnte {
                Some(cfg) => providers::send_fonnte(client, cfg, &templates::render_whatsapp(recap)).await,
                None => Err("WhatsApp belum dikonfigurasi".to_string()),
            },
            other => Err(format!("Channel tidak dikenal: {other}")),
        };
        let entry = match outcome {
            Ok(()) => ChannelOutcome { ok: true, error: None },
            Err(error) => ChannelOutcome { ok: false, error: Some(error) },
        };
        results.insert(channel.clone(), entry);
    }
    results
}
