use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::enums::{Model, TaskStatus};

/// Scoring data for per-task model routing
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskScoring {
    pub complexity: u8,
    pub risk: u8,
    pub recommended_model: Model,
    pub rationale: String,
}

/// Represents a sub-task in the dependency graph
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubTask {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub status: TaskStatus,
    pub blocked_by: Vec<String>,
    pub blocks: Vec<String>,
    pub git_branch_name: String,
    #[serde(default)]
    pub scoring: Option<TaskScoring>,
}

/// The complete task dependency graph
#[derive(Debug, Clone)]
pub struct TaskGraph {
    pub parent_id: String,
    pub parent_identifier: String,
    pub tasks: HashMap<String, SubTask>,
    pub edges: HashMap<String, Vec<String>>,
}

/// Summary statistics for the graph
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphStats {
    pub total: usize,
    pub done: usize,
    pub ready: usize,
    pub blocked: usize,
    pub in_progress: usize,
}

/// A parent issue fetched from the backend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParentIssue {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub git_branch_name: String,
}

/// Linear/Jira issue data structure (subset of what the backend returns)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinearIssue {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub status: String,
    #[serde(default)]
    pub git_branch_name: String,
    #[serde(default)]
    pub relations: Option<Relations>,
    #[serde(default)]
    pub scoring: Option<TaskScoring>,
}

/// Blocking relations for an issue
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Relations {
    #[serde(default)]
    pub blocked_by: Vec<Relation>,
    #[serde(default)]
    pub blocks: Vec<Relation>,
}

/// A single relation reference
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Relation {
    pub id: String,
    pub identifier: String,
}

/// Map backend status string to internal TaskStatus
pub fn map_linear_status(status: &str) -> TaskStatus {
    let status_lower = status.to_lowercase();

    // Done states
    if matches!(
        status_lower.as_str(),
        "done" | "completed" | "cancelled" | "canceled"
    ) {
        return TaskStatus::Done;
    }

    // In progress states
    if matches!(
        status_lower.as_str(),
        "in progress" | "in review" | "started" | "active"
    ) {
        return TaskStatus::InProgress;
    }

    // Everything else is pending (will be calculated as ready/blocked later)
    TaskStatus::Pending
}

/// Calculate whether a pending task is ready or blocked
fn calculate_task_status(task: &SubTask, all_tasks: &HashMap<String, SubTask>) -> TaskStatus {
    if task.blocked_by.is_empty() {
        return TaskStatus::Ready;
    }

    let all_blockers_done = task.blocked_by.iter().all(|blocker_id| {
        match all_tasks.get(blocker_id) {
            Some(blocker) => blocker.status == TaskStatus::Done,
            // If blocker not in our graph (external), assume it's done
            None => true,
        }
    });

    if all_blockers_done {
        TaskStatus::Ready
    } else {
        TaskStatus::Blocked
    }
}

/// Build a task graph from a list of issues.
///
/// Two-pass algorithm:
/// 1. Create SubTask entries from LinearIssue list, extracting blockedBy/blocks from relations
/// 2. Calculate ready/blocked status for pending tasks
pub fn build_task_graph(
    parent_id: &str,
    parent_identifier: &str,
    issues: &[LinearIssue],
) -> TaskGraph {
    let mut tasks = HashMap::new();
    let mut edges = HashMap::new();

    // First pass: create all tasks
    for issue in issues {
        let blocked_by_ids: Vec<String> = issue
            .relations
            .as_ref()
            .map(|r| r.blocked_by.iter().map(|rel| rel.id.clone()).collect())
            .unwrap_or_default();

        let blocks_ids: Vec<String> = issue
            .relations
            .as_ref()
            .map(|r| r.blocks.iter().map(|rel| rel.id.clone()).collect())
            .unwrap_or_default();

        let task = SubTask {
            id: issue.id.clone(),
            identifier: issue.identifier.clone(),
            title: issue.title.clone(),
            status: map_linear_status(&issue.status),
            blocked_by: blocked_by_ids.clone(),
            blocks: blocks_ids,
            git_branch_name: issue.git_branch_name.clone(),
            scoring: issue.scoring.clone(),
        };

        tasks.insert(issue.id.clone(), task);
        edges.insert(issue.id.clone(), blocked_by_ids);
    }

    // Second pass: calculate ready/blocked status for pending tasks
    let task_ids: Vec<String> = tasks.keys().cloned().collect();
    for task_id in &task_ids {
        let new_status = {
            let task = &tasks[task_id];
            if task.status == TaskStatus::Pending {
                Some(calculate_task_status(task, &tasks))
            } else {
                None
            }
        };
        if let Some(status) = new_status {
            tasks.get_mut(task_id).unwrap().status = status;
        }
    }

    TaskGraph {
        parent_id: parent_id.to_string(),
        parent_identifier: parent_identifier.to_string(),
        tasks,
        edges,
    }
}

/// Get all tasks that are ready for execution (no unresolved blockers).
///
/// Includes both 'ready' tasks and 'in_progress' tasks that haven't completed yet.
/// Results are sorted by identifier for consistent ordering.
pub fn get_ready_tasks(graph: &TaskGraph) -> Vec<&SubTask> {
    let mut ready: Vec<&SubTask> = graph
        .tasks
        .values()
        .filter(|t| t.status == TaskStatus::Ready || t.status == TaskStatus::InProgress)
        .collect();
    ready.sort_by(|a, b| a.identifier.cmp(&b.identifier));
    ready
}

/// Get all tasks that are blocked (have unresolved blockers)
pub fn get_blocked_tasks(graph: &TaskGraph) -> Vec<&SubTask> {
    let mut blocked: Vec<&SubTask> = graph
        .tasks
        .values()
        .filter(|t| t.status == TaskStatus::Blocked)
        .collect();
    blocked.sort_by(|a, b| a.identifier.cmp(&b.identifier));
    blocked
}

/// Get all completed tasks
pub fn get_completed_tasks(graph: &TaskGraph) -> Vec<&SubTask> {
    let mut completed: Vec<&SubTask> = graph
        .tasks
        .values()
        .filter(|t| t.status == TaskStatus::Done)
        .collect();
    completed.sort_by(|a, b| a.identifier.cmp(&b.identifier));
    completed
}

/// Get all in-progress tasks
pub fn get_in_progress_tasks(graph: &TaskGraph) -> Vec<&SubTask> {
    let mut in_progress: Vec<&SubTask> = graph
        .tasks
        .values()
        .filter(|t| t.status == TaskStatus::InProgress)
        .collect();
    in_progress.sort_by(|a, b| a.identifier.cmp(&b.identifier));
    in_progress
}

/// Get all pending tasks (not yet started, not done)
pub fn get_pending_tasks(graph: &TaskGraph) -> Vec<&SubTask> {
    let mut pending: Vec<&SubTask> = graph
        .tasks
        .values()
        .filter(|t| t.status == TaskStatus::Pending)
        .collect();
    pending.sort_by(|a, b| a.identifier.cmp(&b.identifier));
    pending
}

/// Immutably update a task's status in the graph.
///
/// If the task is marked as Done, cascades to recalculate status of downstream tasks.
/// Returns a new TaskGraph with the updated status.
pub fn update_task_status(graph: &TaskGraph, task_id: &str, new_status: TaskStatus) -> TaskGraph {
    let Some(task) = graph.tasks.get(task_id) else {
        return TaskGraph {
            parent_id: graph.parent_id.clone(),
            parent_identifier: graph.parent_identifier.clone(),
            tasks: graph.tasks.clone(),
            edges: graph.edges.clone(),
        };
    };

    let mut new_tasks = graph.tasks.clone();
    new_tasks.insert(
        task_id.to_string(),
        SubTask {
            status: new_status,
            ..task.clone()
        },
    );

    // If task was marked done, recalculate status for tasks blocked by it
    if new_status == TaskStatus::Done {
        let task_ids: Vec<String> = new_tasks.keys().cloned().collect();
        for id in &task_ids {
            let should_recalculate = {
                let t = &new_tasks[id];
                t.blocked_by.contains(&task_id.to_string())
                    && (t.status == TaskStatus::Blocked || t.status == TaskStatus::Pending)
            };
            if should_recalculate {
                let recalculated = {
                    let t = &new_tasks[id];
                    calculate_task_status(t, &new_tasks)
                };
                new_tasks.get_mut(id).unwrap().status = recalculated;
            }
        }
    }

    TaskGraph {
        parent_id: graph.parent_id.clone(),
        parent_identifier: graph.parent_identifier.clone(),
        tasks: new_tasks,
        edges: graph.edges.clone(),
    }
}

/// Get a task by its ID
pub fn get_task_by_id<'a>(graph: &'a TaskGraph, task_id: &str) -> Option<&'a SubTask> {
    graph.tasks.get(task_id)
}

/// Get a task by its identifier (e.g., "MOB-124")
pub fn get_task_by_identifier<'a>(graph: &'a TaskGraph, identifier: &str) -> Option<&'a SubTask> {
    graph.tasks.values().find(|t| t.identifier == identifier)
}

/// Get the blockers for a specific task
pub fn get_blockers<'a>(graph: &'a TaskGraph, task_id: &str) -> Vec<&'a SubTask> {
    graph
        .tasks
        .get(task_id)
        .map(|task| {
            task.blocked_by
                .iter()
                .filter_map(|bid| graph.tasks.get(bid))
                .collect()
        })
        .unwrap_or_default()
}

/// Get tasks that are blocked by a specific task
pub fn get_downstream_tasks<'a>(graph: &'a TaskGraph, task_id: &str) -> Vec<&'a SubTask> {
    graph
        .tasks
        .get(task_id)
        .map(|task| {
            task.blocks
                .iter()
                .filter_map(|bid| graph.tasks.get(bid))
                .collect()
        })
        .unwrap_or_default()
}

/// Get summary statistics for the graph
pub fn get_graph_stats(graph: &TaskGraph) -> GraphStats {
    let mut stats = GraphStats {
        total: graph.tasks.len(),
        done: 0,
        ready: 0,
        blocked: 0,
        in_progress: 0,
    };

    for task in graph.tasks.values() {
        match task.status {
            TaskStatus::Done => stats.done += 1,
            TaskStatus::Ready => stats.ready += 1,
            TaskStatus::Blocked => stats.blocked += 1,
            TaskStatus::InProgress => stats.in_progress += 1,
            _ => {}
        }
    }

    stats
}

/// Get the verification gate task from the graph (if present).
///
/// Finds a task by looking for "verification" and "gate" in the title (case-insensitive).
pub fn get_verification_task(graph: &TaskGraph) -> Option<&SubTask> {
    graph.tasks.values().find(|task| {
        let title_lower = task.title.to_lowercase();
        title_lower.contains("verification") && title_lower.contains("gate")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_chain_issues() -> Vec<LinearIssue> {
        vec![
            LinearIssue {
                id: "a".to_string(),
                identifier: "MOB-124".to_string(),
                title: "Task A".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![],
                    blocks: vec![Relation {
                        id: "b".to_string(),
                        identifier: "MOB-125".to_string(),
                    }],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "b".to_string(),
                identifier: "MOB-125".to_string(),
                title: "Task B".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation {
                        id: "a".to_string(),
                        identifier: "MOB-124".to_string(),
                    }],
                    blocks: vec![Relation {
                        id: "c".to_string(),
                        identifier: "MOB-126".to_string(),
                    }],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "c".to_string(),
                identifier: "MOB-126".to_string(),
                title: "Task C".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation {
                        id: "b".to_string(),
                        identifier: "MOB-125".to_string(),
                    }],
                    blocks: vec![],
                }),
                scoring: None,
            },
        ]
    }

    #[test]
    fn test_build_graph_chain() {
        let issues = make_chain_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);

        assert_eq!(graph.tasks.len(), 3);
        assert_eq!(graph.tasks.get("a").unwrap().status, TaskStatus::Ready);
        assert_eq!(graph.tasks.get("b").unwrap().status, TaskStatus::Blocked);
        assert_eq!(graph.tasks.get("c").unwrap().status, TaskStatus::Blocked);
    }

    #[test]
    fn test_cascade_done_unblocks_downstream() {
        let issues = make_chain_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);

        let graph = update_task_status(&graph, "a", TaskStatus::Done);
        assert_eq!(graph.tasks.get("b").unwrap().status, TaskStatus::Ready);
        assert_eq!(graph.tasks.get("c").unwrap().status, TaskStatus::Blocked);

        let graph = update_task_status(&graph, "b", TaskStatus::Done);
        assert_eq!(graph.tasks.get("c").unwrap().status, TaskStatus::Ready);
    }

    #[test]
    fn test_external_blockers_assumed_done() {
        let issues = vec![LinearIssue {
            id: "x".to_string(),
            identifier: "MOB-130".to_string(),
            title: "Task X".to_string(),
            status: "Backlog".to_string(),
            git_branch_name: String::new(),
            relations: Some(Relations {
                blocked_by: vec![Relation {
                    id: "external-999".to_string(),
                    identifier: "EXT-999".to_string(),
                }],
                blocks: vec![],
            }),
            scoring: None,
        }];
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        assert_eq!(graph.tasks.get("x").unwrap().status, TaskStatus::Ready);
    }

    #[test]
    fn test_get_verification_task() {
        let issues = vec![
            LinearIssue {
                id: "normal".to_string(),
                identifier: "MOB-101".to_string(),
                title: "Regular task".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: None,
                scoring: None,
            },
            LinearIssue {
                id: "vg".to_string(),
                identifier: "MOB-VG".to_string(),
                title: "[MOB-100] Verification Gate".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: None,
                scoring: None,
            },
        ];
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let vg = get_verification_task(&graph);
        assert!(vg.is_some());
        assert_eq!(vg.unwrap().identifier, "MOB-VG");
    }

    #[test]
    fn test_map_linear_status_variants() {
        assert_eq!(map_linear_status("Done"), TaskStatus::Done);
        assert_eq!(map_linear_status("completed"), TaskStatus::Done);
        assert_eq!(map_linear_status("Cancelled"), TaskStatus::Done);
        assert_eq!(map_linear_status("canceled"), TaskStatus::Done);
        assert_eq!(map_linear_status("In Progress"), TaskStatus::InProgress);
        assert_eq!(map_linear_status("In Review"), TaskStatus::InProgress);
        assert_eq!(map_linear_status("started"), TaskStatus::InProgress);
        assert_eq!(map_linear_status("active"), TaskStatus::InProgress);
        assert_eq!(map_linear_status("Backlog"), TaskStatus::Pending);
        assert_eq!(map_linear_status("Todo"), TaskStatus::Pending);
    }

    #[test]
    fn test_graph_stats() {
        let issues = make_chain_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let stats = get_graph_stats(&graph);
        assert_eq!(
            stats,
            GraphStats {
                total: 3,
                done: 0,
                ready: 1,
                blocked: 2,
                in_progress: 0,
            }
        );
    }

    #[test]
    fn test_get_ready_tasks_sorted() {
        let issues = make_chain_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let ready = get_ready_tasks(&graph);
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].identifier, "MOB-124");
    }

    #[test]
    fn test_get_task_by_identifier() {
        let issues = make_chain_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let task = get_task_by_identifier(&graph, "MOB-125");
        assert!(task.is_some());
        assert_eq!(task.unwrap().id, "b");
    }

    #[test]
    fn test_get_task_by_id() {
        let issues = make_chain_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        assert!(get_task_by_id(&graph, "a").is_some());
        assert!(get_task_by_id(&graph, "nonexistent").is_none());
    }

    #[test]
    fn test_update_missing_task_returns_same_graph() {
        let issues = make_chain_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let new_graph = update_task_status(&graph, "nonexistent", TaskStatus::Done);
        assert_eq!(new_graph.tasks.len(), 3);
    }

    #[test]
    fn test_get_blockers() {
        let issues = make_chain_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let blockers = get_blockers(&graph, "b");
        assert_eq!(blockers.len(), 1);
        assert_eq!(blockers[0].identifier, "MOB-124");
        assert!(get_blockers(&graph, "a").is_empty());
        assert!(get_blockers(&graph, "nonexistent").is_empty());
    }

    #[test]
    fn test_get_downstream_tasks() {
        let issues = make_chain_issues();
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let downstream = get_downstream_tasks(&graph, "a");
        assert_eq!(downstream.len(), 1);
        assert_eq!(downstream[0].identifier, "MOB-125");
    }

    #[test]
    fn test_subtask_serde_roundtrip() {
        let task = SubTask {
            id: "a".to_string(),
            identifier: "MOB-124".to_string(),
            title: "Task A".to_string(),
            status: TaskStatus::Ready,
            blocked_by: vec![],
            blocks: vec!["b".to_string()],
            git_branch_name: "feature/mob-124".to_string(),
            scoring: None,
        };
        let json = serde_json::to_string(&task).unwrap();
        let parsed: SubTask = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.identifier, "MOB-124");
        assert_eq!(parsed.status, TaskStatus::Ready);
    }

    #[test]
    fn test_linear_issue_serde_roundtrip() {
        let issue = LinearIssue {
            id: "abc".to_string(),
            identifier: "MOB-124".to_string(),
            title: "Test".to_string(),
            status: "Done".to_string(),
            git_branch_name: "feature/mob-124".to_string(),
            relations: Some(Relations {
                blocked_by: vec![Relation {
                    id: "def".to_string(),
                    identifier: "MOB-123".to_string(),
                }],
                blocks: vec![],
            }),
            scoring: None,
        };
        let json = serde_json::to_string(&issue).unwrap();
        let parsed: LinearIssue = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.identifier, "MOB-124");
        assert_eq!(parsed.relations.unwrap().blocked_by.len(), 1);
    }

    #[test]
    fn test_done_issue_stays_done() {
        let issues = vec![LinearIssue {
            id: "d".to_string(),
            identifier: "MOB-127".to_string(),
            title: "Already done".to_string(),
            status: "Done".to_string(),
            git_branch_name: String::new(),
            relations: None,
                scoring: None,
        }];
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        assert_eq!(graph.tasks.get("d").unwrap().status, TaskStatus::Done);
    }

    #[test]
    fn test_in_progress_included_in_ready() {
        let issues = vec![LinearIssue {
            id: "ip".to_string(),
            identifier: "MOB-128".to_string(),
            title: "Working on it".to_string(),
            status: "In Progress".to_string(),
            git_branch_name: String::new(),
            relations: None,
                scoring: None,
        }];
        let graph = build_task_graph("parent-1", "MOB-100", &issues);
        let ready = get_ready_tasks(&graph);
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].status, TaskStatus::InProgress);
    }

    // ── Diamond Dependency Tests ──────────────────────────────────────

    /// Helper: creates a diamond dependency graph A→B, A→C, B→D, C→D
    fn make_diamond_issues() -> Vec<LinearIssue> {
        vec![
            LinearIssue {
                id: "a".to_string(),
                identifier: "MOB-200".to_string(),
                title: "Task A (root)".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![],
                    blocks: vec![
                        Relation { id: "b".to_string(), identifier: "MOB-201".to_string() },
                        Relation { id: "c".to_string(), identifier: "MOB-202".to_string() },
                    ],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "b".to_string(),
                identifier: "MOB-201".to_string(),
                title: "Task B (left)".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation { id: "a".to_string(), identifier: "MOB-200".to_string() }],
                    blocks: vec![Relation { id: "d".to_string(), identifier: "MOB-203".to_string() }],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "c".to_string(),
                identifier: "MOB-202".to_string(),
                title: "Task C (right)".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation { id: "a".to_string(), identifier: "MOB-200".to_string() }],
                    blocks: vec![Relation { id: "d".to_string(), identifier: "MOB-203".to_string() }],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "d".to_string(),
                identifier: "MOB-203".to_string(),
                title: "Task D (sink)".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![
                        Relation { id: "b".to_string(), identifier: "MOB-201".to_string() },
                        Relation { id: "c".to_string(), identifier: "MOB-202".to_string() },
                    ],
                    blocks: vec![],
                }),
                scoring: None,
            },
        ]
    }

    #[test]
    fn test_diamond_dependency_all_blocked() {
        let graph = build_task_graph("p1", "MOB-100", &make_diamond_issues());
        assert_eq!(graph.tasks.get("a").unwrap().status, TaskStatus::Ready);
        assert_eq!(graph.tasks.get("b").unwrap().status, TaskStatus::Blocked);
        assert_eq!(graph.tasks.get("c").unwrap().status, TaskStatus::Blocked);
        assert_eq!(graph.tasks.get("d").unwrap().status, TaskStatus::Blocked);
    }

    #[test]
    fn test_diamond_dependency_partial_unblock() {
        let graph = build_task_graph("p1", "MOB-100", &make_diamond_issues());
        // Mark A done → B and C become Ready, but D still blocked (needs both B and C)
        let graph = update_task_status(&graph, "a", TaskStatus::Done);
        assert_eq!(graph.tasks.get("b").unwrap().status, TaskStatus::Ready);
        assert_eq!(graph.tasks.get("c").unwrap().status, TaskStatus::Ready);
        assert_eq!(graph.tasks.get("d").unwrap().status, TaskStatus::Blocked);
    }

    #[test]
    fn test_diamond_dependency_full_cascade() {
        let graph = build_task_graph("p1", "MOB-100", &make_diamond_issues());
        let graph = update_task_status(&graph, "a", TaskStatus::Done);
        let graph = update_task_status(&graph, "b", TaskStatus::Done);
        // D still blocked because C is not done
        assert_eq!(graph.tasks.get("d").unwrap().status, TaskStatus::Blocked);
        let graph = update_task_status(&graph, "c", TaskStatus::Done);
        // Now D should be ready
        assert_eq!(graph.tasks.get("d").unwrap().status, TaskStatus::Ready);
    }

    #[test]
    fn test_diamond_with_multiple_downstream() {
        // A blocks B, C, D directly (fan-out)
        let issues = vec![
            LinearIssue {
                id: "a".to_string(),
                identifier: "MOB-300".to_string(),
                title: "Root".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![],
                    blocks: vec![
                        Relation { id: "b".to_string(), identifier: "MOB-301".to_string() },
                        Relation { id: "c".to_string(), identifier: "MOB-302".to_string() },
                        Relation { id: "d".to_string(), identifier: "MOB-303".to_string() },
                    ],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "b".to_string(),
                identifier: "MOB-301".to_string(),
                title: "B".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation { id: "a".to_string(), identifier: "MOB-300".to_string() }],
                    blocks: vec![],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "c".to_string(),
                identifier: "MOB-302".to_string(),
                title: "C".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation { id: "a".to_string(), identifier: "MOB-300".to_string() }],
                    blocks: vec![],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "d".to_string(),
                identifier: "MOB-303".to_string(),
                title: "D".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation { id: "a".to_string(), identifier: "MOB-300".to_string() }],
                    blocks: vec![],
                }),
                scoring: None,
            },
        ];
        let graph = build_task_graph("p1", "MOB-100", &issues);
        assert_eq!(graph.tasks.get("b").unwrap().status, TaskStatus::Blocked);
        assert_eq!(graph.tasks.get("c").unwrap().status, TaskStatus::Blocked);
        assert_eq!(graph.tasks.get("d").unwrap().status, TaskStatus::Blocked);

        let graph = update_task_status(&graph, "a", TaskStatus::Done);
        assert_eq!(graph.tasks.get("b").unwrap().status, TaskStatus::Ready);
        assert_eq!(graph.tasks.get("c").unwrap().status, TaskStatus::Ready);
        assert_eq!(graph.tasks.get("d").unwrap().status, TaskStatus::Ready);
    }

    // ── Empty/Single-Task Graph Tests ─────────────────────────────────

    #[test]
    fn test_build_graph_empty_issues() {
        let graph = build_task_graph("p1", "MOB-100", &[]);
        assert_eq!(graph.tasks.len(), 0);
        let stats = get_graph_stats(&graph);
        assert_eq!(stats.total, 0);
        assert_eq!(stats.done, 0);
        assert_eq!(stats.ready, 0);
        assert_eq!(stats.blocked, 0);
        assert_eq!(stats.in_progress, 0);
        assert!(get_ready_tasks(&graph).is_empty());
        assert!(get_blocked_tasks(&graph).is_empty());
        assert!(get_completed_tasks(&graph).is_empty());
    }

    #[test]
    fn test_build_graph_single_task_no_relations() {
        let issues = vec![LinearIssue {
            id: "solo".to_string(),
            identifier: "MOB-400".to_string(),
            title: "Solo task".to_string(),
            status: "Backlog".to_string(),
            git_branch_name: String::new(),
            relations: None,
            scoring: None,
        }];
        let graph = build_task_graph("p1", "MOB-100", &issues);
        assert_eq!(graph.tasks.len(), 1);
        // No blockers → should be Ready
        assert_eq!(graph.tasks.get("solo").unwrap().status, TaskStatus::Ready);
    }

    #[test]
    fn test_build_graph_single_task_external_blocker() {
        let issues = vec![LinearIssue {
            id: "solo".to_string(),
            identifier: "MOB-401".to_string(),
            title: "Blocked by external".to_string(),
            status: "Backlog".to_string(),
            git_branch_name: String::new(),
            relations: Some(Relations {
                blocked_by: vec![Relation {
                    id: "ext-1".to_string(),
                    identifier: "EXT-1".to_string(),
                }],
                blocks: vec![],
            }),
            scoring: None,
        }];
        let graph = build_task_graph("p1", "MOB-100", &issues);
        // External blocker not in graph → assumed done → task is Ready
        assert_eq!(graph.tasks.get("solo").unwrap().status, TaskStatus::Ready);
    }

    // ── Multi-Level Cascade Tests ─────────────────────────────────────

    #[test]
    fn test_cascade_three_level_chain() {
        // A → B → C → D (four-level chain)
        let issues = vec![
            LinearIssue {
                id: "a".to_string(),
                identifier: "MOB-500".to_string(),
                title: "Level 0".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![],
                    blocks: vec![Relation { id: "b".to_string(), identifier: "MOB-501".to_string() }],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "b".to_string(),
                identifier: "MOB-501".to_string(),
                title: "Level 1".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation { id: "a".to_string(), identifier: "MOB-500".to_string() }],
                    blocks: vec![Relation { id: "c".to_string(), identifier: "MOB-502".to_string() }],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "c".to_string(),
                identifier: "MOB-502".to_string(),
                title: "Level 2".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation { id: "b".to_string(), identifier: "MOB-501".to_string() }],
                    blocks: vec![Relation { id: "d".to_string(), identifier: "MOB-503".to_string() }],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "d".to_string(),
                identifier: "MOB-503".to_string(),
                title: "Level 3".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation { id: "c".to_string(), identifier: "MOB-502".to_string() }],
                    blocks: vec![],
                }),
                scoring: None,
            },
        ];
        let graph = build_task_graph("p1", "MOB-100", &issues);

        // Initially: A ready, B/C/D blocked
        assert_eq!(graph.tasks.get("a").unwrap().status, TaskStatus::Ready);
        assert_eq!(graph.tasks.get("d").unwrap().status, TaskStatus::Blocked);

        let graph = update_task_status(&graph, "a", TaskStatus::Done);
        assert_eq!(graph.tasks.get("b").unwrap().status, TaskStatus::Ready);
        assert_eq!(graph.tasks.get("c").unwrap().status, TaskStatus::Blocked);
        assert_eq!(graph.tasks.get("d").unwrap().status, TaskStatus::Blocked);

        let graph = update_task_status(&graph, "b", TaskStatus::Done);
        assert_eq!(graph.tasks.get("c").unwrap().status, TaskStatus::Ready);
        assert_eq!(graph.tasks.get("d").unwrap().status, TaskStatus::Blocked);

        let graph = update_task_status(&graph, "c", TaskStatus::Done);
        assert_eq!(graph.tasks.get("d").unwrap().status, TaskStatus::Ready);
    }

    #[test]
    fn test_cascade_does_not_affect_unrelated() {
        // Two independent chains: A→B and X→Y
        let issues = vec![
            LinearIssue {
                id: "a".to_string(),
                identifier: "MOB-600".to_string(),
                title: "Chain1-A".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![],
                    blocks: vec![Relation { id: "b".to_string(), identifier: "MOB-601".to_string() }],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "b".to_string(),
                identifier: "MOB-601".to_string(),
                title: "Chain1-B".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation { id: "a".to_string(), identifier: "MOB-600".to_string() }],
                    blocks: vec![],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "x".to_string(),
                identifier: "MOB-602".to_string(),
                title: "Chain2-X".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![],
                    blocks: vec![Relation { id: "y".to_string(), identifier: "MOB-603".to_string() }],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "y".to_string(),
                identifier: "MOB-603".to_string(),
                title: "Chain2-Y".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation { id: "x".to_string(), identifier: "MOB-602".to_string() }],
                    blocks: vec![],
                }),
                scoring: None,
            },
        ];
        let graph = build_task_graph("p1", "MOB-100", &issues);

        // Mark A done - should only affect B, not Y
        let graph = update_task_status(&graph, "a", TaskStatus::Done);
        assert_eq!(graph.tasks.get("b").unwrap().status, TaskStatus::Ready);
        assert_eq!(graph.tasks.get("y").unwrap().status, TaskStatus::Blocked);

        // Mark X done - should only affect Y
        let graph = update_task_status(&graph, "x", TaskStatus::Done);
        assert_eq!(graph.tasks.get("y").unwrap().status, TaskStatus::Ready);
    }

    #[test]
    fn test_cascade_with_in_progress_blocker() {
        // A (InProgress) → B: B should remain blocked because InProgress != Done
        let issues = vec![
            LinearIssue {
                id: "a".to_string(),
                identifier: "MOB-700".to_string(),
                title: "In progress blocker".to_string(),
                status: "In Progress".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![],
                    blocks: vec![Relation { id: "b".to_string(), identifier: "MOB-701".to_string() }],
                }),
                scoring: None,
            },
            LinearIssue {
                id: "b".to_string(),
                identifier: "MOB-701".to_string(),
                title: "Waiting on A".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation { id: "a".to_string(), identifier: "MOB-700".to_string() }],
                    blocks: vec![],
                }),
                scoring: None,
            },
        ];
        let graph = build_task_graph("p1", "MOB-100", &issues);
        assert_eq!(graph.tasks.get("a").unwrap().status, TaskStatus::InProgress);
        assert_eq!(graph.tasks.get("b").unwrap().status, TaskStatus::Blocked);

        // Setting A to InProgress again shouldn't unblock B
        let graph = update_task_status(&graph, "a", TaskStatus::InProgress);
        assert_eq!(graph.tasks.get("b").unwrap().status, TaskStatus::Blocked);
    }

    // ── Graph Stats After Mutations Tests ─────────────────────────────

    #[test]
    fn test_graph_stats_after_status_updates() {
        let issues = make_chain_issues(); // A→B→C
        let graph = build_task_graph("p1", "MOB-100", &issues);

        let stats = get_graph_stats(&graph);
        assert_eq!(stats, GraphStats { total: 3, done: 0, ready: 1, blocked: 2, in_progress: 0 });

        let graph = update_task_status(&graph, "a", TaskStatus::Done);
        let stats = get_graph_stats(&graph);
        assert_eq!(stats, GraphStats { total: 3, done: 1, ready: 1, blocked: 1, in_progress: 0 });

        let graph = update_task_status(&graph, "b", TaskStatus::Done);
        let stats = get_graph_stats(&graph);
        assert_eq!(stats, GraphStats { total: 3, done: 2, ready: 1, blocked: 0, in_progress: 0 });

        let graph = update_task_status(&graph, "c", TaskStatus::Done);
        let stats = get_graph_stats(&graph);
        assert_eq!(stats, GraphStats { total: 3, done: 3, ready: 0, blocked: 0, in_progress: 0 });
    }

    #[test]
    fn test_graph_stats_with_all_statuses() {
        // Create tasks with different statuses
        let issues = vec![
            LinearIssue {
                id: "done1".to_string(),
                identifier: "MOB-800".to_string(),
                title: "Done task".to_string(),
                status: "Done".to_string(),
                git_branch_name: String::new(),
                relations: None,
                scoring: None,
            },
            LinearIssue {
                id: "ip1".to_string(),
                identifier: "MOB-801".to_string(),
                title: "In progress task".to_string(),
                status: "In Progress".to_string(),
                git_branch_name: String::new(),
                relations: None,
                scoring: None,
            },
            LinearIssue {
                id: "ready1".to_string(),
                identifier: "MOB-802".to_string(),
                title: "Ready task".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: None,
                scoring: None,
            },
            LinearIssue {
                id: "blocked1".to_string(),
                identifier: "MOB-803".to_string(),
                title: "Blocked task".to_string(),
                status: "Backlog".to_string(),
                git_branch_name: String::new(),
                relations: Some(Relations {
                    blocked_by: vec![Relation { id: "ip1".to_string(), identifier: "MOB-801".to_string() }],
                    blocks: vec![],
                }),
                scoring: None,
            },
        ];
        let graph = build_task_graph("p1", "MOB-100", &issues);
        let stats = get_graph_stats(&graph);
        assert_eq!(stats, GraphStats { total: 4, done: 1, ready: 1, blocked: 1, in_progress: 1 });
    }

    #[test]
    fn test_graph_stats_after_cascade() {
        let graph = build_task_graph("p1", "MOB-100", &make_diamond_issues());
        let stats = get_graph_stats(&graph);
        assert_eq!(stats, GraphStats { total: 4, done: 0, ready: 1, blocked: 3, in_progress: 0 });

        // A done → B and C become ready, D still blocked
        let graph = update_task_status(&graph, "a", TaskStatus::Done);
        let stats = get_graph_stats(&graph);
        assert_eq!(stats, GraphStats { total: 4, done: 1, ready: 2, blocked: 1, in_progress: 0 });

        // B and C done → D becomes ready
        let graph = update_task_status(&graph, "b", TaskStatus::Done);
        let graph = update_task_status(&graph, "c", TaskStatus::Done);
        let stats = get_graph_stats(&graph);
        assert_eq!(stats, GraphStats { total: 4, done: 3, ready: 1, blocked: 0, in_progress: 0 });
    }

    // ── TaskScoring Tests ────────────────────────────────────────────

    #[test]
    fn test_task_scoring_serde_roundtrip() {
        let scoring = TaskScoring {
            complexity: 7,
            risk: 3,
            recommended_model: Model::Sonnet,
            rationale: "Moderate complexity, low risk".to_string(),
        };
        let json = serde_json::to_string(&scoring).unwrap();
        assert!(json.contains("\"recommendedModel\":\"sonnet\""));
        let parsed: TaskScoring = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.complexity, 7);
        assert_eq!(parsed.risk, 3);
        assert_eq!(parsed.recommended_model, Model::Sonnet);
    }

    #[test]
    fn test_subtask_with_scoring_serde_roundtrip() {
        let task = SubTask {
            id: "a".to_string(),
            identifier: "MOB-124".to_string(),
            title: "Task A".to_string(),
            status: TaskStatus::Ready,
            blocked_by: vec![],
            blocks: vec![],
            git_branch_name: "feature/mob-124".to_string(),
            scoring: Some(TaskScoring {
                complexity: 9,
                risk: 5,
                recommended_model: Model::Opus,
                rationale: "High complexity".to_string(),
            }),
        };
        let json = serde_json::to_string(&task).unwrap();
        let parsed: SubTask = serde_json::from_str(&json).unwrap();
        assert!(parsed.scoring.is_some());
        let scoring = parsed.scoring.unwrap();
        assert_eq!(scoring.complexity, 9);
        assert_eq!(scoring.recommended_model, Model::Opus);
    }

    #[test]
    fn test_subtask_without_scoring_backward_compat() {
        // JSON without scoring field should deserialize with scoring: None
        let json = r#"{
            "id": "a",
            "identifier": "MOB-124",
            "title": "Task A",
            "status": "ready",
            "blockedBy": [],
            "blocks": [],
            "gitBranchName": "feature/mob-124"
        }"#;
        let parsed: SubTask = serde_json::from_str(json).unwrap();
        assert!(parsed.scoring.is_none());
        assert_eq!(parsed.identifier, "MOB-124");
    }

    #[test]
    fn test_linear_issue_with_scoring_serde_roundtrip() {
        let issue = LinearIssue {
            id: "abc".to_string(),
            identifier: "MOB-124".to_string(),
            title: "Test".to_string(),
            status: "Backlog".to_string(),
            git_branch_name: String::new(),
            relations: None,
            scoring: Some(TaskScoring {
                complexity: 3,
                risk: 1,
                recommended_model: Model::Haiku,
                rationale: "Simple task".to_string(),
            }),
        };
        let json = serde_json::to_string(&issue).unwrap();
        let parsed: LinearIssue = serde_json::from_str(&json).unwrap();
        assert!(parsed.scoring.is_some());
        assert_eq!(parsed.scoring.unwrap().recommended_model, Model::Haiku);
    }
}
