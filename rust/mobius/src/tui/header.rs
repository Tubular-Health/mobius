use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Widget;
use unicode_width::UnicodeWidthStr;

use super::theme::{HEADER_COLOR, MUTED_COLOR, TEXT_COLOR};

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
            // Center the logo using display width (not UTF-8 byte length).
            let x_offset = centered_x(area.width, display_width(line));
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
            let x_offset = centered_x(area.width, line_display_width(&info_line));

            buf.set_line(area.x + x_offset as u16, info_y, &info_line, area.width);
        }
    }
}

fn display_width(text: &str) -> usize {
    UnicodeWidthStr::width(text)
}

fn line_display_width(line: &Line<'_>) -> usize {
    line.spans
        .iter()
        .map(|span| display_width(span.content.as_ref()))
        .sum()
}

fn centered_x(area_width: u16, content_width: usize) -> u16 {
    if area_width as usize > content_width {
        ((area_width as usize - content_width) / 2) as u16
    } else {
        0
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

    #[test]
    fn test_display_width_uses_terminal_cells_not_bytes() {
        let logo_line = LOGO[0];
        assert!(logo_line.len() > display_width(logo_line));
    }

    #[test]
    fn test_centered_x_uses_display_width_for_logo() {
        let area_width = 80;
        let logo_width = display_width(LOGO[0]);

        let display_offset = centered_x(area_width, logo_width);
        let byte_offset = centered_x(area_width, LOGO[0].len());

        assert_eq!(
            display_offset,
            ((area_width as usize - logo_width) / 2) as u16
        );
        assert_ne!(display_offset, byte_offset);
    }

    #[test]
    fn test_centered_x_clamps_to_zero_when_content_wider_than_area() {
        assert_eq!(centered_x(10, 20), 0);
    }

    #[test]
    fn test_centered_x_recalculates_across_width_changes() {
        let content_width = display_width(LOGO[0]);

        let wide_offset = centered_x(120, content_width);
        let narrow_offset = centered_x(70, content_width);

        assert!(wide_offset > narrow_offset);
        assert_eq!(
            narrow_offset,
            ((70usize.saturating_sub(content_width)) / 2) as u16
        );
    }

    #[test]
    fn test_line_display_width_counts_span_display_width() {
        let line = Line::from(vec![
            Span::raw("Task Tree for "),
            Span::raw("MOB-123"),
            Span::raw(" | Runtime: 12s"),
        ]);
        assert_eq!(line_display_width(&line), 36);
    }
}
