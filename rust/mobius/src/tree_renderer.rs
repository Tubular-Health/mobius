use std::collections::HashMap;

use colored::{Colorize, CustomColor};

use crate::types::enums::TaskStatus;
use crate::types::task_graph::{get_blockers, get_ready_tasks, SubTask, TaskGraph};

// Nord color palette
// https://www.nordtheme.com/docs/colors-and-palettes

// Polar Night (dark)
const NORD3: CustomColor = CustomColor {
    r: 76,
    g: 86,
    b: 106,
};

// Snow Storm (light)
const NORD4: CustomColor = CustomColor {
    r: 216,
    g: 222,
    b: 233,
};
const NORD6: CustomColor = CustomColor {
    r: 236,
    g: 239,
    b: 244,
};

// Frost (blues/cyans) - used for depth coloring
const NORD7: CustomColor = CustomColor {
    r: 143,
    g: 188,
    b: 187,
}; // teal
const NORD8: CustomColor = CustomColor {
    r: 136,
    g: 192,
    b: 208,
}; // light blue
const NORD9: CustomColor = CustomColor {
    r: 129,
    g: 161,
    b: 193,
}; // blue
const NORD10: CustomColor = CustomColor {
    r: 94,
    g: 129,
    b: 172,
}; // dark blue
const NORD15: CustomColor = CustomColor {
    r: 180,
    g: 142,
    b: 173,
}; // purple

// Aurora (accent colors) - used for status
const NORD11: CustomColor = CustomColor {
    r: 191,
    g: 97,
    b: 106,
}; // red
const NORD12: CustomColor = CustomColor {
    r: 208,
    g: 135,
    b: 112,
}; // orange
const NORD13: CustomColor = CustomColor {
    r: 235,
    g: 203,
    b: 139,
}; // yellow
const NORD14: CustomColor = CustomColor {
    r: 163,
    g: 190,
    b: 140,
}; // green

/// Depth colors cycle through Frost palette
const DEPTH_COLORS: [CustomColor; 5] = [
    NORD8,  // light blue (depth 0)
    NORD7,  // teal (depth 1)
    NORD9,  // blue (depth 2)
    NORD10, // dark blue (depth 3)
    NORD15, // purple (depth 4)
];

/// Get the status color for a task status
fn status_color(status: TaskStatus) -> CustomColor {
    match status {
        TaskStatus::Done => NORD14,       // green
        TaskStatus::Ready => NORD8,       // light blue
        TaskStatus::Blocked => NORD13,    // yellow
        TaskStatus::InProgress => NORD12, // orange
        TaskStatus::Pending => NORD3,     // gray
        TaskStatus::Failed => NORD11,     // red
    }
}

/// Get the status icon for a task status (with color)
fn get_status_icon(status: TaskStatus) -> String {
    let color = status_color(status);
    let icon = match status {
        TaskStatus::Done => "[✓]",
        TaskStatus::Ready => "[→]",
        TaskStatus::Blocked => "[·]",
        TaskStatus::InProgress => "[!]",
        TaskStatus::Pending => "[·]",
        TaskStatus::Failed => "[✗]",
    };
    icon.custom_color(color).to_string()
}

/// Color a task identifier based on depth
fn color_identifier(identifier: &str, depth: usize) -> String {
    let color_index = depth % DEPTH_COLORS.len();
    let color = DEPTH_COLORS[color_index];
    identifier.custom_color(color).bold().to_string()
}

/// Build a map of parent -> children relationships.
/// A task's "parent" in the tree is its first blocker.
fn build_children_map(graph: &TaskGraph) -> HashMap<String, Vec<SubTask>> {
    let mut children_map: HashMap<String, Vec<SubTask>> = HashMap::new();

    for task in graph.tasks.values() {
        if !task.blocked_by.is_empty() {
            let parent_id = &task.blocked_by[0];
            children_map
                .entry(parent_id.clone())
                .or_default()
                .push(task.clone());
        }
    }

    // Sort children by identifier
    for children in children_map.values_mut() {
        children.sort_by(|a, b| a.identifier.cmp(&b.identifier));
    }

    children_map
}

/// Get root tasks (tasks with no blockers). If none, use all tasks.
fn get_root_tasks(graph: &TaskGraph) -> Vec<SubTask> {
    let mut roots: Vec<SubTask> = graph
        .tasks
        .values()
        .filter(|t| t.blocked_by.is_empty())
        .cloned()
        .collect();

    if roots.is_empty() {
        roots = graph.tasks.values().cloned().collect();
    }

    roots.sort_by(|a, b| a.identifier.cmp(&b.identifier));
    roots
}

/// Render a task dependency graph as an ASCII tree
pub fn render_ascii_tree(graph: &TaskGraph) -> String {
    let mut lines: Vec<String> = Vec::new();

    let header = format!("Task Tree for {}:", graph.parent_identifier);
    lines.push(header.custom_color(NORD6).bold().to_string());

    let children_map = build_children_map(graph);
    let root_tasks = get_root_tasks(graph);

    for (i, task) in root_tasks.iter().enumerate() {
        let is_last = i == root_tasks.len() - 1;
        render_task_node(task, graph, &children_map, "", is_last, 0, &mut lines);
    }

    lines.join("\n")
}

/// Recursively render a task node and its children
fn render_task_node(
    task: &SubTask,
    graph: &TaskGraph,
    children_map: &HashMap<String, Vec<SubTask>>,
    prefix: &str,
    is_last: bool,
    depth: usize,
    lines: &mut Vec<String>,
) {
    let connector = if is_last { "└── " } else { "├── " };
    let colored_connector = connector.custom_color(NORD3).to_string();

    let icon = get_status_icon(task.status);
    let identifier = color_identifier(&task.identifier, depth);
    let title = task.title.custom_color(NORD4).to_string();
    let blocker_suffix = format_blocker_suffix(task, graph);

    lines.push(format!(
        "{prefix}{colored_connector}{icon} {identifier}: {title}{blocker_suffix}"
    ));

    // Get children for this task
    let children = children_map.get(&task.id);

    if let Some(children) = children {
        let child_prefix_str = if is_last { "    " } else { "│   " };
        let colored_child_prefix = child_prefix_str.custom_color(NORD3).to_string();
        let new_prefix = format!("{prefix}{colored_child_prefix}");

        for (i, child) in children.iter().enumerate() {
            let child_is_last = i == children.len() - 1;
            render_task_node(
                child,
                graph,
                children_map,
                &new_prefix,
                child_is_last,
                depth + 1,
                lines,
            );
        }
    }
}

/// Format the blocker suffix for a task
fn format_blocker_suffix(task: &SubTask, graph: &TaskGraph) -> String {
    if task.blocked_by.is_empty() {
        return String::new();
    }

    let blockers = get_blockers(graph, &task.id);
    let unresolved: Vec<&SubTask> = blockers
        .into_iter()
        .filter(|b| b.status != TaskStatus::Done)
        .collect();

    if unresolved.is_empty() {
        return String::new();
    }

    let blocker_ids: Vec<String> = unresolved
        .iter()
        .map(|b| b.identifier.custom_color(NORD11).to_string())
        .collect();

    let separator = ", ".custom_color(NORD3).to_string();
    let joined = blocker_ids.join(&separator);

    format!(
        "{}{}{}",
        " (blocked by: ".custom_color(NORD3),
        joined,
        ")".custom_color(NORD3)
    )
}

/// Render the legend explaining status icons
pub fn render_legend() -> String {
    let done = "[✓] Done".custom_color(status_color(TaskStatus::Done));
    let ready = "[→] Ready".custom_color(status_color(TaskStatus::Ready));
    let blocked = "[·] Blocked".custom_color(status_color(TaskStatus::Blocked));
    let in_progress = "[!] In Progress".custom_color(status_color(TaskStatus::InProgress));

    format!(
        "{}{}  {}  {}  {}",
        "Legend: ".custom_color(NORD4),
        done,
        ready,
        blocked,
        in_progress
    )
}

/// Render a summary of ready tasks for parallel execution
pub fn render_ready_summary(graph: &TaskGraph) -> String {
    let ready_tasks = get_ready_tasks(graph);

    if ready_tasks.is_empty() {
        return "No tasks ready for execution"
            .custom_color(NORD13)
            .to_string();
    }

    let task_ids: Vec<String> = ready_tasks
        .iter()
        .map(|t| t.identifier.custom_color(NORD8).bold().to_string())
        .collect();

    let separator = ", ".custom_color(NORD3).to_string();
    let joined = task_ids.join(&separator);

    let agent_text = if ready_tasks.len() == 1 {
        "1 agent".to_string()
    } else {
        format!("{} agents", ready_tasks.len())
    };

    format!(
        "{}{}{}",
        "Ready for parallel execution: ".custom_color(NORD4),
        joined,
        format!(" ({agent_text})").custom_color(NORD3)
    )
}

/// Render the complete tree output including legend and summary
pub fn render_full_tree_output(graph: &TaskGraph) -> String {
    let parts = [
        render_ascii_tree(graph),
        String::new(),
        render_legend(),
        render_ready_summary(graph),
    ];

    parts.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::task_graph::{build_task_graph, LinearIssue, Relation, Relations};

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
                        Relation {
                            id: "b".to_string(),
                            identifier: "MOB-102".to_string(),
                        },
                        Relation {
                            id: "c".to_string(),
                            identifier: "MOB-103".to_string(),
                        },
                    ],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "b".to_string(),
                identifier: "MOB-102".to_string(),
                title: "Define types".to_string(),
                status: "Done".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation {
                        id: "a".to_string(),
                        identifier: "MOB-101".to_string(),
                    }],
                    blocks: vec![Relation {
                        id: "d".to_string(),
                        identifier: "MOB-104".to_string(),
                    }],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "c".to_string(),
                identifier: "MOB-103".to_string(),
                title: "Config system".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation {
                        id: "a".to_string(),
                        identifier: "MOB-101".to_string(),
                    }],
                    blocks: vec![],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "d".to_string(),
                identifier: "MOB-104".to_string(),
                title: "Task graph engine".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation {
                        id: "b".to_string(),
                        identifier: "MOB-102".to_string(),
                    }],
                    blocks: vec![Relation {
                        id: "e".to_string(),
                        identifier: "MOB-105".to_string(),
                    }],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "e".to_string(),
                identifier: "MOB-105".to_string(),
                title: "Tree renderer with a very long title that should still render properly"
                    .to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation {
                        id: "d".to_string(),
                        identifier: "MOB-104".to_string(),
                    }],
                    blocks: vec![],
                }),
                scoring: None,
            },
        ]
    }

    #[test]
    fn test_render_ascii_tree_contains_header() {
        let issues = make_sample_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let output = render_ascii_tree(&graph);
        // The header should contain the parent identifier (may have ANSI codes)
        assert!(output.contains("MOB-100"));
    }

    #[test]
    fn test_render_ascii_tree_contains_all_tasks() {
        let issues = make_sample_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let output = render_ascii_tree(&graph);
        assert!(output.contains("MOB-101"));
        assert!(output.contains("MOB-102"));
        assert!(output.contains("MOB-103"));
        assert!(output.contains("MOB-104"));
        assert!(output.contains("MOB-105"));
    }

    #[test]
    fn test_render_ascii_tree_contains_titles() {
        let issues = make_sample_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let output = render_ascii_tree(&graph);
        assert!(output.contains("Initialize project"));
        assert!(output.contains("Define types"));
    }

    #[test]
    fn test_render_ascii_tree_box_drawing_chars() {
        let issues = make_sample_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let output = render_ascii_tree(&graph);
        // Should contain box-drawing characters
        assert!(output.contains("├") || output.contains("└"));
    }

    #[test]
    fn test_render_ascii_tree_status_icons() {
        let issues = make_sample_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let output = render_ascii_tree(&graph);
        // Done tasks should have checkmark icon
        assert!(output.contains("✓"));
        // Ready tasks should have arrow icon
        assert!(output.contains("→"));
    }

    #[test]
    fn test_blocker_suffix_shown_for_blocked_tasks() {
        let issues = make_sample_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let output = render_ascii_tree(&graph);
        // MOB-105 is blocked by MOB-104 which is not done
        assert!(output.contains("blocked by"));
        assert!(output.contains("MOB-104"));
    }

    #[test]
    fn test_blocker_suffix_hidden_for_resolved() {
        // When all blockers are Done, no suffix should appear for that task
        let issues = vec![
            LinearIssue {
                id: "a".to_string(),
                identifier: "MOB-201".to_string(),
                title: "Task A".to_string(),
                status: "Done".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![],
                    blocks: vec![Relation {
                        id: "b".to_string(),
                        identifier: "MOB-202".to_string(),
                    }],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "b".to_string(),
                identifier: "MOB-202".to_string(),
                title: "Task B".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation {
                        id: "a".to_string(),
                        identifier: "MOB-201".to_string(),
                    }],
                    blocks: vec![],
                }),
                scoring: None,
            },
        ];
        let graph = build_task_graph("parent-1", "MOB-200", &issues);
        let output = render_ascii_tree(&graph);
        // MOB-202 is blocked by MOB-201 which IS done, so no "blocked by" suffix
        assert!(!output.contains("blocked by"));
    }

    #[test]
    fn test_render_legend() {
        let legend = render_legend();
        assert!(legend.contains("Legend"));
        assert!(legend.contains("Done"));
        assert!(legend.contains("Ready"));
        assert!(legend.contains("Blocked"));
        assert!(legend.contains("In Progress"));
    }

    #[test]
    fn test_render_ready_summary_with_ready_tasks() {
        let issues = make_sample_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let summary = render_ready_summary(&graph);
        assert!(summary.contains("Ready for parallel execution"));
    }

    #[test]
    fn test_render_ready_summary_no_ready() {
        // All tasks blocked
        let issues = vec![
            LinearIssue {
                id: "a".to_string(),
                identifier: "MOB-301".to_string(),
                title: "Task A".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation {
                        id: "b".to_string(),
                        identifier: "MOB-302".to_string(),
                    }],
                    blocks: vec![],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "b".to_string(),
                identifier: "MOB-302".to_string(),
                title: "Task B".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation {
                        id: "a".to_string(),
                        identifier: "MOB-301".to_string(),
                    }],
                    blocks: vec![],
                }),
                scoring: None,
            },
        ];
        let graph = build_task_graph("parent-1", "MOB-300", &issues);
        let summary = render_ready_summary(&graph);
        assert!(summary.contains("No tasks ready"));
    }

    #[test]
    fn test_render_full_tree_output() {
        let issues = make_sample_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let output = render_full_tree_output(&graph);
        // Should contain tree, legend, and summary
        assert!(output.contains("MOB-100"));
        assert!(output.contains("Legend"));
        assert!(output.contains("Ready for parallel execution"));
    }

    #[test]
    fn test_depth_coloring_cycles() {
        // With 5+ depth levels, colors should cycle
        // This test verifies the color_identifier function doesn't panic at any depth
        for depth in 0..10 {
            let result = color_identifier("MOB-100", depth);
            assert!(result.contains("MOB-100"));
        }
    }

    #[test]
    fn test_build_children_map_first_blocker_is_parent() {
        let issues = make_sample_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let children_map = build_children_map(&graph);

        // "a" should have children "b" and "c" (both blocked by "a")
        let a_children = children_map.get("a").unwrap();
        assert_eq!(a_children.len(), 2);
        assert_eq!(a_children[0].identifier, "MOB-102");
        assert_eq!(a_children[1].identifier, "MOB-103");
    }

    #[test]
    fn test_get_root_tasks_no_blockers() {
        let issues = make_sample_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let roots = get_root_tasks(&graph);

        // Only "a" (MOB-101) has no blockers
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].identifier, "MOB-101");
    }

    #[test]
    fn test_deterministic_output() {
        let issues = make_sample_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let output1 = render_full_tree_output(&graph);
        let output2 = render_full_tree_output(&graph);
        assert_eq!(output1, output2);
    }
}
