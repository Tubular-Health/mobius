use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Widget;

use super::theme::{HEADER_COLOR, TEXT_COLOR, MUTED_COLOR};

const LOGO: &[&str] = &[
    "███╗   ███╗ ██████╗ ██████╗ ██╗██╗   ██╗███████╗",
    "████╗ ████║██╔═══██╗██╔══██╗██║██║   ██║██╔════╝",
    "██╔████╔██║██║   ██║██████╔╝██║██║   ██║███████╗",
    "██║╚██╔╝██║██║   ██║██╔══██╗██║██║   ██║╚════██║",
    "██║ ╚═╝ ██║╚██████╔╝██████╔╝██║╚██████╔╝███████║",
    "╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝ ╚══════╝",
];

pub struct Header<'a> {
    pub parent_id: &'a str,
    pub parent_title: &'a str,
    pub elapsed_ms: u64,
    pub has_runtime: bool,
}

impl Widget for Header<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let logo_style = Style::default().fg(HEADER_COLOR);

        // Render logo lines
        for (i, line) in LOGO.iter().enumerate() {
            if i as u16 >= area.height {
                break;
            }
            let y = area.y + i as u16;
            // Center the logo
            let x_offset = if area.width > line.len() as u16 {
                (area.width - line.len() as u16) / 2
            } else {
                0
            };
            buf.set_string(area.x + x_offset, y, line, logo_style);
        }

        // Render info line below logo
        let info_y = area.y + LOGO.len() as u16;
        if info_y < area.y + area.height {
            let runtime_text = if self.has_runtime {
                format_duration(self.elapsed_ms)
            } else {
                "(waiting)".to_string()
            };

            let info_line = Line::from(vec![
                Span::styled(
                    format!("Task Tree for {}", self.parent_id),
                    Style::default().fg(TEXT_COLOR),
                ),
                Span::styled(" | ", Style::default().fg(MUTED_COLOR)),
                Span::styled(
                    format!("Runtime: {}", runtime_text),
                    Style::default().fg(TEXT_COLOR),
                ),
            ]);

            // Center the info line
            let info_width: usize = info_line.spans.iter().map(|s| s.content.len()).sum();
            let x_offset = if area.width as usize > info_width {
                (area.width as usize - info_width) / 2
            } else {
                0
            };

            buf.set_line(area.x + x_offset as u16, info_y, &info_line, area.width);
        }
    }
}

/// Format a duration in milliseconds to a human-readable string.
pub fn format_duration(ms: u64) -> String {
    let total_secs = ms / 1000;
    let hours = total_secs / 3600;
    let minutes = (total_secs % 3600) / 60;
    let seconds = total_secs % 60;

    if hours > 0 {
        format!("{}h {}m", hours, minutes)
    } else if minutes > 0 {
        format!("{}m {:02}s", minutes, seconds)
    } else {
        format!("{}s", seconds)
    }
}

/// Header height: logo lines + 1 info line + 1 spacer
pub const HEADER_HEIGHT: u16 = 8;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_duration_seconds() {
        assert_eq!(format_duration(5000), "5s");
        assert_eq!(format_duration(45000), "45s");
    }

    #[test]
    fn test_format_duration_minutes() {
        assert_eq!(format_duration(60_000), "1m 00s");
        assert_eq!(format_duration(154_000), "2m 34s");
    }

    #[test]
    fn test_format_duration_hours() {
        assert_eq!(format_duration(3_900_000), "1h 5m");
        assert_eq!(format_duration(7_200_000), "2h 0m");
    }
}
