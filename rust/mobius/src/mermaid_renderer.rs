use crate::types::enums::TaskStatus;
use crate::types::task_graph::TaskGraph;

/// Status icons for Mermaid node labels
fn status_icon(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::Done => "✓",
        TaskStatus::Ready => "→",
        TaskStatus::Blocked => "·",
        TaskStatus::InProgress => "!",
        TaskStatus::Pending => "·",
        TaskStatus::Failed => "✗",
    }
}

/// Status colors for Mermaid node styling (hex colors)
pub fn get_status_color(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::Done => "#90EE90",       // Light green
        TaskStatus::Ready => "#87CEEB",      // Light blue
        TaskStatus::Blocked => "#D3D3D3",    // Light gray
        TaskStatus::InProgress => "#FFE4B5", // Moccasin (yellow-ish)
        TaskStatus::Pending => "#D3D3D3",    // Light gray
        TaskStatus::Failed => "#FF6B6B",     // Light red
    }
}

/// Maximum title length before truncation
const MAX_TITLE_LENGTH: usize = 40;

/// Truncate a title if it exceeds the maximum length
fn truncate_title(title: &str) -> String {
    if title.len() <= MAX_TITLE_LENGTH {
        return title.to_string();
    }
    format!("{}...", &title[..MAX_TITLE_LENGTH - 3])
}

/// Escape special characters for Mermaid node labels.
/// Mermaid uses specific characters that need escaping in labels.
fn escape_label(text: &str) -> String {
    text.replace('"', "'")
        .replace(['[', ']'], "")
        .replace(['(', ')'], "")
        .replace(['<', '>'], "")
        .replace('&', "and")
}

/// Sanitize an identifier for use as a Mermaid node ID.
/// Mermaid node IDs have restrictions on characters.
fn sanitize_node_id(identifier: &str) -> String {
    identifier
        .replace('-', "_")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_')
        .collect()
}

/// Generate a Mermaid flowchart diagram from a task graph.
///
/// Returns Mermaid flowchart code (without markdown fence).
pub fn render_mermaid_diagram(graph: &TaskGraph) -> String {
    let mut lines: Vec<String> = Vec::new();

    // Flowchart header (top-down orientation)
    lines.push("flowchart TD".to_string());

    // Get all tasks sorted by identifier for consistent output
    let mut tasks: Vec<_> = graph.tasks.values().collect();
    tasks.sort_by(|a, b| a.identifier.cmp(&b.identifier));

    // Generate node definitions
    for task in &tasks {
        let node_id = sanitize_node_id(&task.identifier);
        let icon = status_icon(task.status);
        let truncated_title = truncate_title(&task.title);
        let escaped_title = escape_label(&truncated_title);
        let label = format!("{}: {} {}", task.identifier, escaped_title, icon);

        lines.push(format!("    {node_id}[\"{label}\"]"));
    }

    // Add blank line before edges
    lines.push(String::new());

    // Generate edges (blocker --> blocked)
    for task in &tasks {
        for blocker_id in &task.blocked_by {
            if let Some(blocker_task) = graph.tasks.get(blocker_id) {
                let from_id = sanitize_node_id(&blocker_task.identifier);
                let to_id = sanitize_node_id(&task.identifier);
                lines.push(format!("    {from_id} --> {to_id}"));
            }
        }
    }

    // Add blank line before styles
    lines.push(String::new());

    // Generate style definitions
    for task in &tasks {
        let node_id = sanitize_node_id(&task.identifier);
        let color = get_status_color(task.status);
        lines.push(format!("    style {node_id} fill:{color}"));
    }

    lines.join("\n")
}

/// Generate a Mermaid diagram wrapped in a markdown code fence.
pub fn render_mermaid_markdown(graph: &TaskGraph) -> String {
    let diagram = render_mermaid_diagram(graph);
    format!("```mermaid\n{diagram}\n```")
}

/// Generate a Mermaid diagram with a title header.
pub fn render_mermaid_with_title(graph: &TaskGraph) -> String {
    let title = format!("## Task Dependency Graph for {}\n\n", graph.parent_identifier);
    format!("{title}{}", render_mermaid_markdown(graph))
}

/// Get all status colors as a list of (status, color) pairs.
pub fn get_all_status_colors() -> Vec<(TaskStatus, &'static str)> {
    vec![
        (TaskStatus::Done, get_status_color(TaskStatus::Done)),
        (TaskStatus::Ready, get_status_color(TaskStatus::Ready)),
        (TaskStatus::Blocked, get_status_color(TaskStatus::Blocked)),
        (TaskStatus::InProgress, get_status_color(TaskStatus::InProgress)),
        (TaskStatus::Pending, get_status_color(TaskStatus::Pending)),
        (TaskStatus::Failed, get_status_color(TaskStatus::Failed)),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::task_graph::{build_task_graph, LinearIssue, Relations, Relation};

    fn make_sample_issues() -> Vec<LinearIssue> {
        vec![
            LinearIssue {
                id: "a".to_string(),
                identifier: "MOB-101".to_string(),
                title: "Initialize project".to_string(),
                status: "Done".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![],
                    blocks: vec![
                        Relation { id: "b".to_string(), identifier: "MOB-102".to_string() },
                    ],
                }),
            },
            LinearIssue {
                id: "b".to_string(),
                identifier: "MOB-102".to_string(),
                title: "Define types".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation { id: "a".to_string(), identifier: "MOB-101".to_string() }],
                    blocks: vec![Relation { id: "c".to_string(), identifier: "MOB-103".to_string() }],
                }),
            },
            LinearIssue {
                id: "c".to_string(),
                identifier: "MOB-103".to_string(),
                title: "Implement feature".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation { id: "b".to_string(), identifier: "MOB-102".to_string() }],
                    blocks: vec![],
                }),
            },
        ]
    }

    #[test]
    fn test_truncate_title_short() {
        assert_eq!(truncate_title("Short title"), "Short title");
    }

    #[test]
    fn test_truncate_title_at_limit() {
        let title = "a".repeat(40);
        assert_eq!(truncate_title(&title), title);
    }

    #[test]
    fn test_truncate_title_long() {
        let title = "This is a very long title that exceeds the maximum length for display";
        let result = truncate_title(title);
        assert!(result.len() == MAX_TITLE_LENGTH);
        assert!(result.ends_with("..."));
    }

    #[test]
    fn test_escape_label_quotes() {
        assert_eq!(escape_label("Hello \"world\""), "Hello 'world'");
    }

    #[test]
    fn test_escape_label_brackets() {
        assert_eq!(escape_label("[MOB-101] Task"), "MOB-101 Task");
    }

    #[test]
    fn test_escape_label_parens() {
        assert_eq!(escape_label("Task (optional)"), "Task optional");
    }

    #[test]
    fn test_escape_label_angle_brackets() {
        assert_eq!(escape_label("Config <T>"), "Config T");
    }

    #[test]
    fn test_escape_label_ampersand() {
        assert_eq!(escape_label("A & B"), "A and B");
    }

    #[test]
    fn test_sanitize_node_id_hyphens() {
        assert_eq!(sanitize_node_id("MOB-101"), "MOB_101");
    }

    #[test]
    fn test_sanitize_node_id_special_chars() {
        assert_eq!(sanitize_node_id("task-VG!@#"), "task_VG");
    }

    #[test]
    fn test_render_mermaid_diagram_header() {
        let issues = make_sample_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let diagram = render_mermaid_diagram(&graph);
        assert!(diagram.starts_with("flowchart TD"));
    }

    #[test]
    fn test_render_mermaid_diagram_node_definitions() {
        let issues = make_sample_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let diagram = render_mermaid_diagram(&graph);
        assert!(diagram.contains("MOB_101[\"MOB-101: Initialize project ✓\"]"));
        assert!(diagram.contains("MOB_102[\"MOB-102: Define types →\"]"));
        assert!(diagram.contains("MOB_103[\"MOB-103: Implement feature ·\"]"));
    }

    #[test]
    fn test_render_mermaid_diagram_edges() {
        let issues = make_sample_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let diagram = render_mermaid_diagram(&graph);
        assert!(diagram.contains("MOB_101 --> MOB_102"));
        assert!(diagram.contains("MOB_102 --> MOB_103"));
    }

    #[test]
    fn test_render_mermaid_diagram_styles() {
        let issues = make_sample_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let diagram = render_mermaid_diagram(&graph);
        assert!(diagram.contains("style MOB_101 fill:#90EE90")); // done = green
        assert!(diagram.contains("style MOB_102 fill:#87CEEB")); // ready = blue
        assert!(diagram.contains("style MOB_103 fill:#D3D3D3")); // blocked = gray
    }

    #[test]
    fn test_render_mermaid_markdown() {
        let issues = make_sample_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let markdown = render_mermaid_markdown(&graph);
        assert!(markdown.starts_with("```mermaid"));
        assert!(markdown.ends_with("```"));
    }

    #[test]
    fn test_render_mermaid_with_title() {
        let issues = make_sample_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let output = render_mermaid_with_title(&graph);
        assert!(output.starts_with("## Task Dependency Graph for MOB-100"));
        assert!(output.contains("```mermaid"));
    }

    #[test]
    fn test_deterministic_output() {
        let issues = make_sample_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let output1 = render_mermaid_diagram(&graph);
        let output2 = render_mermaid_diagram(&graph);
        assert_eq!(output1, output2);
    }

    #[test]
    fn test_get_status_color_all_statuses() {
        // Verify all statuses return valid hex colors
        let colors = get_all_status_colors();
        assert_eq!(colors.len(), 6);
        for (_, color) in &colors {
            assert!(color.starts_with('#'));
            assert_eq!(color.len(), 7);
        }
    }

    #[test]
    fn test_escape_label_combined() {
        let input = "Fix [Bug] (critical) <P0> & deploy \"v2\"";
        let result = escape_label(input);
        assert_eq!(result, "Fix Bug critical P0 and deploy 'v2'");
    }

    #[test]
    fn test_mermaid_with_special_chars_in_title() {
        let issues = vec![
            LinearIssue {
                id: "a".to_string(),
                identifier: "MOB-401".to_string(),
                title: "[MOB-401] Fix \"bug\" in <Component> & deploy".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: None,
            },
        ];
        let graph = build_task_graph("parent-1", "MOB-400", &issues);
        let diagram = render_mermaid_diagram(&graph);
        // Should not contain raw special chars that break Mermaid
        assert!(!diagram.contains("\"bug\""));
        assert!(!diagram.contains('<'));
        assert!(!diagram.contains('>'));
        assert!(!diagram.contains('&'));
    }
}
