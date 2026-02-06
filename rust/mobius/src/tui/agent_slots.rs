use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Widget;

use super::theme::{model_color, MUTED_COLOR, NORD14, TEXT_COLOR};

pub struct ActiveTaskDisplay {
    pub id: String,
    pub model: Option<String>,
}

pub struct AgentSlots<'a> {
    pub active_tasks: &'a [ActiveTaskDisplay],
    pub max_slots: usize,
}

impl Default for AgentSlots<'_> {
    fn default() -> Self {
        Self {
            active_tasks: &[],
            max_slots: 3,
        }
    }
}

impl Widget for AgentSlots<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let mut spans = vec![Span::styled("Agents: ", Style::default().fg(TEXT_COLOR))];

        for i in 0..self.max_slots {
            if i < self.active_tasks.len() {
                let task = &self.active_tasks[i];
                spans.push(Span::styled("● ", Style::default().fg(NORD14)));
                spans.push(Span::styled(
                    task.id.clone(),
                    Style::default().fg(TEXT_COLOR),
                ));
                if let Some(ref model) = task.model {
                    let short = if model.contains("opus") {
                        "opus"
                    } else if model.contains("sonnet") {
                        "sonnet"
                    } else if model.contains("haiku") {
                        "haiku"
                    } else {
                        model.as_str()
                    };
                    spans.push(Span::styled(
                        format!(" [{}]", short),
                        Style::default().fg(model_color(model)),
                    ));
                }
            } else {
                spans.push(Span::styled("○", Style::default().fg(MUTED_COLOR)));
            }

            if i < self.max_slots - 1 {
                spans.push(Span::raw("  "));
            }
        }

        let line = Line::from(spans);
        buf.set_line(area.x + 1, area.y, &line, area.width.saturating_sub(1));
    }
}

/// Agent slots widget height
pub const AGENT_SLOTS_HEIGHT: u16 = 1;
