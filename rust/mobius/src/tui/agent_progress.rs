use std::collections::HashMap;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Gauge, Widget};

use crate::types::context::AgentTodoFile;

use super::theme::{HEADER_COLOR, MUTED_COLOR, NORD1, NORD8, NORD13, NORD14};

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
            let row = area.y + 1 + (i as u16 * 2);
            if row >= area.y + area.height {
                break;
            }

            let todo_file = &self.todos[*key];
            let completed = todo_file
                .tasks
                .iter()
                .filter(|t| t.status == "completed")
                .count();
            let total = todo_file.tasks.len();
            let available_width = area.width.saturating_sub(2) as usize;

            // Line 1: agent name + count + status icons
            let mut spans: Vec<Span> = Vec::new();
            let prefix = format!("  {}: {}/{} done ", todo_file.subtask_id, completed, total);
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
                if used_width + 1 > available_width {
                    break;
                }
                spans.push(Span::styled(icon, Style::default().fg(color)));
                used_width += 1;
            }

            let line = Line::from(spans);
            buf.set_line(area.x + 1, row, &line, area.width.saturating_sub(1));

            // Line 2: Gauge progress bar
            let gauge_row = row + 1;
            if gauge_row >= area.y + area.height {
                break;
            }

            let ratio = if total == 0 {
                0.0
            } else {
                completed as f64 / total as f64
            };
            let pct = (ratio * 100.0) as u16;

            let gauge_area = Rect::new(area.x + 2, gauge_row, area.width.saturating_sub(4), 1);
            let gauge = Gauge::default()
                .ratio(ratio)
                .label(format!("{}%", pct))
                .gauge_style(Style::default().fg(NORD8).bg(NORD1));
            gauge.render(gauge_area, buf);
        }
    }
}

/// Calculate the height needed for the agent progress widget.
/// Returns 1 (header) + two lines per agent (info line + gauge bar).
pub fn calculate_height(agent_count: usize) -> u16 {
    1 + (agent_count as u16 * 2)
}
