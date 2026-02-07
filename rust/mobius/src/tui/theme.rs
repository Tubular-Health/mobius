use ratatui::style::Color;

// Nord Polar Night (dark backgrounds)
pub const NORD0: Color = Color::Rgb(46, 52, 64);
pub const NORD1: Color = Color::Rgb(59, 66, 82);
pub const NORD2: Color = Color::Rgb(67, 76, 94);
pub const NORD3: Color = Color::Rgb(76, 86, 106);

// Nord Snow Storm (light text)
pub const NORD4: Color = Color::Rgb(216, 222, 233);
pub const NORD5: Color = Color::Rgb(229, 233, 240);
pub const NORD6: Color = Color::Rgb(236, 239, 244);

// Nord Frost (accent)
pub const NORD7: Color = Color::Rgb(143, 188, 187);
pub const NORD8: Color = Color::Rgb(136, 192, 208);
pub const NORD9: Color = Color::Rgb(129, 161, 193);
pub const NORD10: Color = Color::Rgb(94, 129, 172);

// Nord Aurora (status indicators)
pub const NORD11: Color = Color::Rgb(191, 97, 106); // red
pub const NORD12: Color = Color::Rgb(208, 135, 112); // orange
pub const NORD13: Color = Color::Rgb(235, 203, 139); // yellow
pub const NORD14: Color = Color::Rgb(163, 190, 140); // green
pub const NORD15: Color = Color::Rgb(180, 142, 173); // purple

use crate::types::enums::TaskStatus;

pub fn status_color(status: TaskStatus) -> Color {
    match status {
        TaskStatus::Done => NORD14,
        TaskStatus::Ready => NORD8,
        TaskStatus::Blocked => NORD3,
        TaskStatus::InProgress => NORD13,
        TaskStatus::Pending => NORD3,
        TaskStatus::Failed => NORD11,
    }
}

pub fn status_icon(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::Done => "[✓]",
        TaskStatus::Ready => "[→]",
        TaskStatus::Blocked => "[·]",
        TaskStatus::InProgress => "[⟳]",
        TaskStatus::Pending => "[·]",
        TaskStatus::Failed => "[✗]",
    }
}

// Structure colors
pub const BORDER_COLOR: Color = NORD9;
pub const HEADER_COLOR: Color = NORD8;
pub const TEXT_COLOR: Color = NORD4;
pub const MUTED_COLOR: Color = NORD3;

/// Returns a Nord color for the given model string.
/// Uses substring matching: opus=purple, sonnet=blue, haiku=green, else default text.
pub fn model_color(model: &str) -> Color {
    let lower = model.to_lowercase();
    if lower.contains("opus") {
        NORD15
    } else if lower.contains("sonnet") {
        NORD8
    } else if lower.contains("haiku") {
        NORD14
    } else {
        NORD4
    }
}

/// Formats a token count into an abbreviated string.
/// >=1M -> "X.XM", >=1K -> "X.XK", else raw number.
pub fn format_tokens(count: u64) -> String {
    if count >= 1_000_000 {
        format!("{:.1}M", count as f64 / 1_000_000.0)
    } else if count >= 1_000 {
        format!("{:.1}K", count as f64 / 1_000.0)
    } else {
        count.to_string()
    }
}

/// Formats an input/output token pair as "{input} in / {output} out".
pub fn format_token_pair(input: u64, output: u64) -> String {
    format!(
        "{} in / {} out",
        format_tokens(input),
        format_tokens(output)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_color_opus() {
        assert_eq!(model_color("claude-opus-4-6"), NORD15);
        assert_eq!(model_color("opus"), NORD15);
    }

    #[test]
    fn test_model_color_sonnet() {
        assert_eq!(model_color("claude-sonnet-4-5-20250929"), NORD8);
        assert_eq!(model_color("sonnet"), NORD8);
    }

    #[test]
    fn test_model_color_haiku() {
        assert_eq!(model_color("claude-haiku-4-5-20251001"), NORD14);
        assert_eq!(model_color("haiku"), NORD14);
    }

    #[test]
    fn test_model_color_unknown() {
        assert_eq!(model_color("gpt-4"), NORD4);
        assert_eq!(model_color(""), NORD4);
    }

    #[test]
    fn test_format_tokens_millions() {
        assert_eq!(format_tokens(2_500_000), "2.5M");
        assert_eq!(format_tokens(1_000_000), "1.0M");
    }

    #[test]
    fn test_format_tokens_thousands() {
        assert_eq!(format_tokens(1_500), "1.5K");
        assert_eq!(format_tokens(1_000), "1.0K");
    }

    #[test]
    fn test_format_tokens_raw() {
        assert_eq!(format_tokens(500), "500");
        assert_eq!(format_tokens(0), "0");
    }

    #[test]
    fn test_format_token_pair() {
        assert_eq!(format_token_pair(1_500, 500), "1.5K in / 500 out");
        assert_eq!(format_token_pair(2_500_000, 1_000), "2.5M in / 1.0K out");
    }
}
