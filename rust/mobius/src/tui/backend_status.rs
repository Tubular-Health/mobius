use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Widget};

use crate::types::enums::Backend;
use crate::types::task_graph::{TaskGraph, SubTask};

use super::theme::{status_color, status_icon, BORDER_COLOR, HEADER_COLOR, TEXT_COLOR};

pub struct BackendStatusBox<'a> {
    pub graph: &'a TaskGraph,
    pub backend: Backend,
}

impl Widget for BackendStatusBox<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(BORDER_COLOR))
            .title(Span::styled(
                format!(" Backend ({}) ", self.backend),
                Style::default().fg(HEADER_COLOR),
            ));

        let inner = block.inner(area);
        block.render(area, buf);

        let mut tasks: Vec<&SubTask> = self.graph.tasks.values().collect();
        tasks.sort_by(|a, b| a.identifier.cmp(&b.identifier));

        for (i, task) in tasks.iter().enumerate() {
            if i as u16 >= inner.height {
                break;
            }

            let icon = status_icon(task.status);
            let color = status_color(task.status);

            let line = Line::from(vec![
                Span::styled(format!("{} ", icon), Style::default().fg(color)),
                Span::styled(&task.identifier, Style::default().fg(TEXT_COLOR)),
            ]);

            buf.set_line(inner.x, inner.y + i as u16, &line, inner.width);
        }
    }
}
