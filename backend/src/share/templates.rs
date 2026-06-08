use crate::domain::{RecapBreakdown, RecapData, RecapMode};

const DISCORD_LIMIT: usize = 1900;

fn stat_line(recap: &RecapData) -> String {
    match recap.mode {
        RecapMode::Mixed => format!(
            "{} scan · {} OK · {} NG ({:.1}%)",
            recap.total, recap.ok, recap.ng, recap.ng_rate
        ),
        RecapMode::Defect => format!("{} temuan NG", recap.ng),
        RecapMode::Passed => format!("{} objek lolos", recap.total),
    }
}

fn breakdown_header(recap: &RecapData) -> &'static str {
    match recap.breakdown {
        RecapBreakdown::ByPart(_) => "Per Part",
        RecapBreakdown::ByDimension(_) => "Per Dimensi",
    }
}

fn breakdown_lines(recap: &RecapData) -> Vec<String> {
    match &recap.breakdown {
        RecapBreakdown::ByPart(parts) => match recap.mode {
            RecapMode::Passed => parts
                .iter()
                .map(|part| {
                    format!(
                        "{} ({}) · {} — {} lolos",
                        part.part_name, part.part_code, part.vendor, part.total
                    )
                })
                .collect(),
            _ => parts
                .iter()
                .filter(|part| part.ng > 0)
                .map(|part| {
                    format!(
                        "{} ({}) · {} — {}/{} NG",
                        part.part_name, part.part_code, part.vendor, part.ng, part.total
                    )
                })
                .collect(),
        },
        RecapBreakdown::ByDimension(dims) => match recap.mode {
            RecapMode::Passed => Vec::new(),
            _ => dims
                .iter()
                .filter(|dim| dim.ng > 0)
                .map(|dim| format!("{} — {}/{} NG", dim.dimension_name, dim.ng, dim.total))
                .collect(),
        },
    }
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub fn render_telegram(recap: &RecapData) -> String {
    let mut out = format!(
        "<b>{}</b>\n{}\n\n{}",
        html_escape(&recap.title),
        html_escape(&recap.scope_label),
        html_escape(&stat_line(recap)),
    );
    let lines = breakdown_lines(recap);
    if !lines.is_empty() {
        out.push_str(&format!("\n\n<b>{}</b>", breakdown_header(recap)));
        for line in lines {
            out.push_str(&format!("\n• {}", html_escape(&line)));
        }
    }
    out.push_str("\n\n<i>DimInspect</i>");
    out
}

pub fn render_whatsapp(recap: &RecapData) -> String {
    let mut out = format!("*{}*\n{}\n\n{}", recap.title, recap.scope_label, stat_line(recap));
    let lines = breakdown_lines(recap);
    if !lines.is_empty() {
        out.push_str(&format!("\n\n*{}*", breakdown_header(recap)));
        for line in lines {
            out.push_str(&format!("\n• {line}"));
        }
    }
    out.push_str("\n\n_DimInspect_");
    out
}

pub fn render_discord(recap: &RecapData) -> String {
    let mut out = format!("**{}**\n{}\n\n{}", recap.title, recap.scope_label, stat_line(recap));
    let lines = breakdown_lines(recap);
    if !lines.is_empty() {
        out.push_str(&format!("\n\n**{}**", breakdown_header(recap)));
        for line in lines {
            out.push_str(&format!("\n• {line}"));
        }
    }
    if out.chars().count() > DISCORD_LIMIT {
        out = out.chars().take(DISCORD_LIMIT).collect::<String>();
        out.push('…');
    }
    out
}

pub fn render_email_subject(recap: &RecapData) -> String {
    match recap.mode {
        RecapMode::Mixed => format!("Rekap Inspeksi {} — {} scan, {} NG", recap.scope_label, recap.total, recap.ng),
        RecapMode::Defect => format!("Rekap Temuan NG {} — {} temuan", recap.scope_label, recap.ng),
        RecapMode::Passed => format!("Rekap Lolos Inspeksi {} — {} lolos", recap.scope_label, recap.total),
    }
}

pub fn render_email_html(recap: &RecapData) -> String {
    let lines = breakdown_lines(recap);
    let breakdown_html = if lines.is_empty() {
        String::new()
    } else {
        let items = lines
            .iter()
            .map(|line| format!("<li style=\"margin:4px 0;\">{}</li>", html_escape(line)))
            .collect::<String>();
        format!(
            "<h3 style=\"font-size:14px;color:#0f172a;margin:20px 0 8px;\">{}</h3><ul style=\"margin:0;padding-left:18px;color:#334155;font-size:13px;\">{}</ul>",
            breakdown_header(recap),
            items
        )
    };
    format!(
        "<div style=\"font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;\">\
         <h2 style=\"font-size:18px;margin:0 0 4px;\">{}</h2>\
         <p style=\"font-size:12px;color:#64748b;margin:0 0 16px;\">{}</p>\
         <p style=\"font-size:15px;font-weight:bold;margin:0 0 8px;\">{}</p>\
         {}\
         <p style=\"font-size:11px;color:#94a3b8;margin-top:24px;\">DimInspect · Sistem Inspeksi Dimensi</p>\
         </div>",
        html_escape(&recap.title),
        html_escape(&recap.scope_label),
        html_escape(&stat_line(recap)),
        breakdown_html,
    )
}
