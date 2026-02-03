use std::collections::HashMap;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Widget;

use crate::types::context::AgentTodoFile;

use super::theme::{HEADER_COLOR, MUTED_COLOR, NORD8, NORD13, NORD14};

pub struct AgentProgress<'a> {
    pub todos: &'a HashMap<String, AgentTodoFile>,
}

impl Widget for AgentProgress<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if area.height == 0 || area.width == 0 {
            return;
        }

        // Header line
        let header = Line::from(Span::styled(
            "Agent Progress",
            Style::default().fg(HEADER_COLOR),
        ));
        buf.set_line(area.x + 1, area.y, &header, area.width.saturating_sub(1));

        // Sort keys for deterministic rendering order
        let mut keys: Vec<&String> = self.todos.keys().collect();
        keys.sort();

        for (i, key) in keys.iter().enumerate() {
            let row = area.y + 1 + i as u16;
            if row >= area.y + area.height {
                break;
            }

            let todo_file = &self.todos[*key];
            let available_width = area.width.saturating_sub(2) as usize;

            let mut spans: Vec<Span> = Vec::new();
            let prefix = format!("  {}: ", todo_file.subtask_id);
            spans.push(Span::styled(prefix.clone(), Style::default().fg(MUTED_COLOR)));

            let mut used_width = prefix.len();

            for (j, task) in todo_file.tasks.iter().enumerate() {
                let (icon, color) = match task.status.as_str() {
                    "completed" => ("\u{2713}", NORD14),
                    "in_progress" => ("\u{25ba}", NORD13),
                    _ => ("\u{25cb}", NORD8),
                };

                // Space before icon (except first task)
                if j > 0 {
                    let sep = " ";
                    if used_width + sep.len() > available_width {
                        break;
                    }
                    spans.push(Span::raw(sep));
                    used_width += sep.len();
                }

                // Icon
                let icon_display = format!("{} ", icon);
                if used_width + icon_display.len() > available_width {
                    break;
                }
                spans.push(Span::styled(icon_display.clone(), Style::default().fg(color)));
                used_width += icon_display.len();

                // Subject with potential truncation
                let remaining = available_width.saturating_sub(used_width);
                if remaining == 0 {
                    break;
                }

                let subject = &task.subject;
                if subject.len() > remaining {
                    if remaining > 3 {
                        let truncated = &subject[..remaining - 3];
                        spans.push(Span::styled(
                            format!("{}...", truncated),
                            Style::default().fg(color),
                        ));
                    } else {
                        spans.push(Span::styled(
                            "...".to_string(),
                            Style::default().fg(color),
                        ));
                    }
                    break;
                } else {
                    spans.push(Span::styled(
                        subject.clone(),
                        Style::default().fg(color),
                    ));
                    used_width += subject.len();
                }
            }

            let line = Line::from(spans);
            buf.set_line(area.x + 1, row, &line, area.width.saturating_sub(1));
        }
    }
}

/// Calculate the height needed for the agent progress widget.
/// Returns 1 (header) + one line per agent.
pub fn calculate_height(agent_count: usize) -> u16 {
    1 + agent_count as u16
}
