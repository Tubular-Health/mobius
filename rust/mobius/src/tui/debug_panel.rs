use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Widget};

use crate::types::debug::DebugEvent;
use crate::types::enums::DebugEventType;

use super::theme::{
    BORDER_COLOR, HEADER_COLOR, MUTED_COLOR, TEXT_COLOR, NORD3, NORD8, NORD9, NORD10,
    NORD13, NORD14, NORD15,
};

pub struct DebugPanel<'a> {
    pub events: &'a [DebugEvent],
    pub pending_count: usize,
    pub max_lines: usize,
}

impl Default for DebugPanel<'_> {
    fn default() -> Self {
        Self {
            events: &[],
            pending_count: 0,
            max_lines: 8,
        }
    }
}

impl Widget for DebugPanel<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let drift_text = if self.pending_count > 0 {
            format!("DRIFT: {} pending [d]", self.pending_count)
        } else {
            "[d]".to_string()
        };

        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(BORDER_COLOR))
            .title(Span::styled(" Debug Events ", Style::default().fg(HEADER_COLOR)))
            .title_alignment(ratatui::layout::Alignment::Left);

        let inner = block.inner(area);
        block.render(area, buf);

        // Render drift indicator on the right side of the title bar
        let drift_x = area.x + area.width.saturating_sub(drift_text.len() as u16 + 2);
        buf.set_string(drift_x, area.y, &drift_text, Style::default().fg(NORD13));

        // Show recent events (from end)
        let visible = self.max_lines.min(inner.height as usize);
        let start = self.events.len().saturating_sub(visible);
        let visible_events = &self.events[start..];

        for (i, event) in visible_events.iter().enumerate() {
            if i as u16 >= inner.height {
                break;
            }

            let timestamp = if event.timestamp.len() >= 12 {
                &event.timestamp[11..23.min(event.timestamp.len())]
            } else {
                &event.timestamp
            };

            let (label, color) = event_type_label(event.event_type);

            let data_str = event
                .data
                .iter()
                .map(|(k, v)| format!("{}={}", k, v))
                .collect::<Vec<_>>()
                .join(" ");

            let line = Line::from(vec![
                Span::styled(
                    format!("[{}] ", timestamp),
                    Style::default().fg(MUTED_COLOR),
                ),
                Span::styled(format!("{:<12} ", label), Style::default().fg(color)),
                Span::styled(data_str, Style::default().fg(TEXT_COLOR)),
            ]);

            buf.set_line(inner.x, inner.y + i as u16, &line, inner.width);
        }

        // Show event count
        if !self.events.is_empty() {
            let count_text = format!(
                "Showing {} of {} events",
                visible_events.len(),
                self.events.len()
            );
            let count_y = inner.y + inner.height.saturating_sub(1);
            if count_y > inner.y + visible_events.len() as u16 {
                buf.set_string(inner.x, count_y, &count_text, Style::default().fg(MUTED_COLOR));
            }
        }
    }
}

fn event_type_label(event_type: DebugEventType) -> (&'static str, ratatui::style::Color) {
    match event_type {
        DebugEventType::RuntimeStateWrite => ("STATE:WRITE", NORD10),
        DebugEventType::RuntimeStateRead => ("STATE:READ", NORD3),
        DebugEventType::RuntimeWatcherTrigger => ("WATCHER", NORD15),
        DebugEventType::TaskStateChange => ("TASK", NORD13),
        DebugEventType::PendingUpdateQueue => ("QUEUE", NORD8),
        DebugEventType::PendingUpdatePush => ("PUSH", NORD14),
        DebugEventType::BackendStatusUpdate => ("BACKEND", NORD14),
        DebugEventType::LockAcquire => ("LOCK+", NORD3),
        DebugEventType::LockRelease => ("LOCK-", NORD3),
        DebugEventType::TuiStateReceive => ("TUI:RECV", NORD9),
    }
}

/// Debug panel height (including borders)
pub const DEBUG_PANEL_HEIGHT: u16 = 10;
