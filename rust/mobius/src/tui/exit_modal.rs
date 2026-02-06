use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Widget};

use super::header::format_duration;
use super::theme::{MUTED_COLOR, NORD0, NORD13, TEXT_COLOR};

pub struct ExitModal {
    pub active_agent_count: usize,
    pub completed: usize,
    pub total: usize,
    pub failed: usize,
    pub elapsed_ms: u64,
}

impl Widget for ExitModal {
    fn render(self, area: Rect, buf: &mut Buffer) {
        // Calculate centered modal dimensions
        let modal_width = 44u16;
        let modal_height = 11u16;

        let x = area.x + area.width.saturating_sub(modal_width) / 2;
        let y = area.y + area.height.saturating_sub(modal_height) / 2;

        let modal_area = Rect::new(
            x,
            y,
            modal_width.min(area.width),
            modal_height.min(area.height),
        );

        // Clear the area behind the modal
        Clear.render(modal_area, buf);

        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(NORD13))
            .style(Style::default().bg(NORD0));

        let inner = block.inner(modal_area);
        block.render(modal_area, buf);

        let lines = vec![
            Line::raw(""),
            Line::from(Span::styled(
                "⚠ Confirm Exit",
                Style::default().fg(NORD13).add_modifier(Modifier::BOLD),
            )),
            Line::raw(""),
            Line::from(Span::styled(
                format!("  Stop {} running agent(s)?", self.active_agent_count),
                Style::default().fg(TEXT_COLOR),
            )),
            Line::raw(""),
            Line::from(Span::styled(
                format!(
                    "  Progress: {}/{} completed, {} failed",
                    self.completed, self.total, self.failed
                ),
                Style::default().fg(MUTED_COLOR),
            )),
            Line::from(Span::styled(
                format!("  Runtime: {}", format_duration(self.elapsed_ms)),
                Style::default().fg(MUTED_COLOR),
            )),
            Line::raw(""),
            Line::from(vec![
                Span::styled("        [Y]es", Style::default().fg(NORD13)),
                Span::styled("    ", Style::default()),
                Span::styled("[N]o", Style::default().fg(TEXT_COLOR)),
            ]),
        ];

        for (i, line) in lines.iter().enumerate() {
            if i as u16 >= inner.height {
                break;
            }
            buf.set_line(inner.x, inner.y + i as u16, line, inner.width);
        }
    }
}
