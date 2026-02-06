use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Widget;

use crate::types::enums::TaskStatus;

use super::theme::{status_color, MUTED_COLOR, TEXT_COLOR};

pub struct Legend;

impl Widget for Legend {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let items = [
            (TaskStatus::Done, "[✓] Done"),
            (TaskStatus::Ready, "[→] Ready"),
            (TaskStatus::Blocked, "[·] Blocked"),
            (TaskStatus::InProgress, "[⟳] In Progress"),
            (TaskStatus::Failed, "[✗] Failed"),
        ];

        let mut spans = vec![Span::styled("Legend: ", Style::default().fg(MUTED_COLOR))];

        for (i, (status, label)) in items.iter().enumerate() {
            spans.push(Span::styled(
                *label,
                Style::default().fg(status_color(*status)),
            ));
            if i < items.len() - 1 {
                spans.push(Span::styled("  ", Style::default().fg(TEXT_COLOR)));
            }
        }

        let line = Line::from(spans);
        buf.set_line(area.x + 1, area.y, &line, area.width.saturating_sub(1));
    }
}

/// Legend widget height
pub const LEGEND_HEIGHT: u16 = 1;
