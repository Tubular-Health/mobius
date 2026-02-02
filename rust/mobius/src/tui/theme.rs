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
pub const NORD11: Color = Color::Rgb(191, 97, 106);  // red
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
