use std::collections::HashMap;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Widget;

use crate::types::enums::TaskStatus;
use crate::types::task_graph::{SubTask, TaskGraph};

use super::header::format_duration;
use super::theme::{status_color, status_icon, MUTED_COLOR, TEXT_COLOR};

/// Information about a completed task's timing.
pub struct CompletedInfo {
    pub duration: u64,
}

/// Widget that renders the task dependency tree.
pub struct TaskTreeWidget<'a> {
    pub graph: &'a TaskGraph,
    pub status_overrides: &'a HashMap<String, TaskStatus>,
    pub active_elapsed: &'a HashMap<String, u64>,
    pub completed_info: &'a HashMap<String, CompletedInfo>,
}

/// Context for recursive tree rendering, bundled to reduce argument count.
struct RenderCtx<'a, 'b> {
    widget: &'a TaskTreeWidget<'a>,
    children_map: &'a HashMap<String, Vec<&'a SubTask>>,
    area: Rect,
    buf: &'b mut Buffer,
}

impl Widget for TaskTreeWidget<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let children_map = build_children_map(self.graph);
        let roots = get_root_tasks(self.graph);

        let mut ctx = RenderCtx {
            widget: &self,
            children_map: &children_map,
            area,
            buf,
        };

        let mut y = area.y;
        for (i, root) in roots.iter().enumerate() {
            let is_last = i == roots.len() - 1;
            y = render_task_node(&mut ctx, root, y, "", is_last);
            if y >= area.y + area.height {
                break;
            }
        }
    }
}

fn render_task_node(
    ctx: &mut RenderCtx,
    task: &SubTask,
    y: u16,
    prefix: &str,
    is_last: bool,
) -> u16 {
    if y >= ctx.area.y + ctx.area.height {
        return y;
    }

    let effective_status = ctx
        .widget
        .status_overrides
        .get(&task.id)
        .copied()
        .unwrap_or(task.status);

    let connector = if prefix.is_empty() {
        ""
    } else if is_last {
        "└── "
    } else {
        "├── "
    };

    // Build runtime suffix
    let runtime_suffix = if let Some(info) = ctx.widget.completed_info.get(&task.id) {
        if info.duration > 0 {
            format!(" ({})", format_duration(info.duration))
        } else {
            String::new()
        }
    } else if let Some(&elapsed) = ctx.widget.active_elapsed.get(&task.id) {
        format!(" ({}...)", format_duration(elapsed))
    } else {
        String::new()
    };

    // Build blocker suffix for blocked tasks
    let blocker_suffix = if effective_status == TaskStatus::Blocked {
        let unresolved: Vec<&str> = task
            .blocked_by
            .iter()
            .filter_map(|bid| {
                let blocker = ctx.widget.graph.tasks.get(bid)?;
                let blocker_status = ctx
                    .widget
                    .status_overrides
                    .get(&blocker.id)
                    .copied()
                    .unwrap_or(blocker.status);
                if blocker_status != TaskStatus::Done {
                    Some(blocker.identifier.as_str())
                } else {
                    None
                }
            })
            .collect();
        if !unresolved.is_empty() {
            format!(" (blocked by: {})", unresolved.join(", "))
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    // Compose the line
    let icon = status_icon(effective_status);
    let color = status_color(effective_status);

    let line = Line::from(vec![
        Span::styled(prefix.to_string(), Style::default().fg(MUTED_COLOR)),
        Span::styled(connector.to_string(), Style::default().fg(MUTED_COLOR)),
        Span::styled(format!("{} ", icon), Style::default().fg(color)),
        Span::styled(
            format!("{}: ", task.identifier),
            Style::default().fg(TEXT_COLOR),
        ),
        Span::styled(
            truncate_title(&task.title, 50),
            Style::default().fg(TEXT_COLOR),
        ),
        Span::styled(runtime_suffix, Style::default().fg(MUTED_COLOR)),
        Span::styled(blocker_suffix, Style::default().fg(MUTED_COLOR)),
    ]);

    ctx.buf.set_line(ctx.area.x, y, &line, ctx.area.width);

    // Render children
    let mut current_y = y + 1;
    if let Some(children) = ctx.children_map.get(&task.id) {
        let child_prefix = if prefix.is_empty() {
            if is_last {
                "    "
            } else {
                "│   "
            }
        } else if is_last {
            &format!("{}    ", prefix)
        } else {
            &format!("{}│   ", prefix)
        };

        for (i, child) in children.iter().enumerate() {
            let child_is_last = i == children.len() - 1;
            current_y = render_task_node(ctx, child, current_y, child_prefix, child_is_last);
            if current_y >= ctx.area.y + ctx.area.height {
                break;
            }
        }
    }

    current_y
}

/// Build a map of parent task ID -> children tasks.
/// Uses "first blocker = parent" heuristic.
fn build_children_map(graph: &TaskGraph) -> HashMap<String, Vec<&SubTask>> {
    let mut children: HashMap<String, Vec<&SubTask>> = HashMap::new();

    for task in graph.tasks.values() {
        if !task.blocked_by.is_empty() {
            let parent_id = &task.blocked_by[0];
            children.entry(parent_id.clone()).or_default().push(task);
        }
    }

    // Sort children by identifier
    for list in children.values_mut() {
        list.sort_by(|a, b| a.identifier.cmp(&b.identifier));
    }

    children
}

/// Get root tasks (no blockers). If none, return all tasks.
fn get_root_tasks(graph: &TaskGraph) -> Vec<&SubTask> {
    let mut roots: Vec<&SubTask> = graph
        .tasks
        .values()
        .filter(|t| t.blocked_by.is_empty())
        .collect();

    if roots.is_empty() {
        roots = graph.tasks.values().collect();
    }

    roots.sort_by(|a, b| a.identifier.cmp(&b.identifier));
    roots
}

/// Truncate a title to max length with "..." suffix.
fn truncate_title(title: &str, max_len: usize) -> String {
    // Strip common prefix patterns like "[MOB-251] "
    let display_title = if let Some(end) = title.find("] ") {
        &title[end + 2..]
    } else {
        title
    };

    if display_title.len() > max_len {
        format!("{}...", &display_title[..max_len - 3])
    } else {
        display_title.to_string()
    }
}
