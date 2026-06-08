use std::time::Duration;

use reqwest::Client;
use serde_json::json;

use crate::config::{BrevoConfig, DiscordConfig, FonnteConfig, TelegramConfig};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(12);

fn map_status(action: &str, status: reqwest::StatusCode, body: &str) -> String {
    let snippet: String = body.chars().take(160).collect();
    format!("{action} gagal: HTTP {} {}", status.as_u16(), snippet)
}

pub async fn send_telegram(client: &Client, config: &TelegramConfig, text: &str) -> Result<(), String> {
    let url = format!("https://api.telegram.org/bot{}/sendMessage", config.bot_token);
    let response = client
        .post(url)
        .timeout(REQUEST_TIMEOUT)
        .json(&json!({
            "chat_id": config.chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": true,
        }))
        .send()
        .await
        .map_err(|error| format!("Telegram tidak dapat dihubungi: {error}"))?;
    let status = response.status();
    if status.is_success() {
        Ok(())
    } else {
        let body = response.text().await.unwrap_or_default();
        Err(map_status("Telegram", status, &body))
    }
}

pub async fn send_brevo(
    client: &Client,
    config: &BrevoConfig,
    recipients: &[String],
    subject: &str,
    html: &str,
) -> Result<(), String> {
    if recipients.is_empty() {
        return Err("Tidak ada alamat email tujuan".to_string());
    }
    let to: Vec<_> = recipients.iter().map(|email| json!({ "email": email })).collect();
    let response = client
        .post("https://api.brevo.com/v3/smtp/email")
        .timeout(REQUEST_TIMEOUT)
        .header("api-key", &config.api_key)
        .header("accept", "application/json")
        .json(&json!({
            "sender": { "name": config.sender_name, "email": config.sender_email },
            "to": to,
            "subject": subject,
            "htmlContent": html,
        }))
        .send()
        .await
        .map_err(|error| format!("Brevo tidak dapat dihubungi: {error}"))?;
    let status = response.status();
    if status.is_success() {
        Ok(())
    } else {
        let body = response.text().await.unwrap_or_default();
        Err(map_status("Email", status, &body))
    }
}

pub async fn send_discord(client: &Client, config: &DiscordConfig, content: &str) -> Result<(), String> {
    let response = client
        .post(&config.webhook_url)
        .timeout(REQUEST_TIMEOUT)
        .json(&json!({ "content": content }))
        .send()
        .await
        .map_err(|error| format!("Discord tidak dapat dihubungi: {error}"))?;
    let status = response.status();
    if status.is_success() {
        Ok(())
    } else {
        let body = response.text().await.unwrap_or_default();
        Err(map_status("Discord", status, &body))
    }
}

pub async fn send_fonnte(client: &Client, config: &FonnteConfig, message: &str) -> Result<(), String> {
    let response = client
        .post("https://api.fonnte.com/send")
        .timeout(REQUEST_TIMEOUT)
        .header("Authorization", &config.token)
        .form(&[("target", config.target.as_str()), ("message", message)])
        .send()
        .await
        .map_err(|error| format!("Fonnte tidak dapat dihubungi: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(map_status("WhatsApp", status, &body));
    }
    let body = response.text().await.unwrap_or_default();
    if body.contains("\"status\":false") {
        return Err(format!("WhatsApp ditolak Fonnte: {}", body.chars().take(160).collect::<String>()));
    }
    Ok(())
}
