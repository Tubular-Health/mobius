use serde::{Deserialize, Serialize};

use super::enums::TaskStatus;

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
}

/// The complete task dependency graph
#[derive(Debug, Clone)]
pub struct TaskGraph {
    pub parent_id: String,
    pub parent_identifier: String,
    pub tasks: std::collections::HashMap<String, SubTask>,
    pub edges: std::collections::HashMap<String, Vec<String>>,
}

/// Summary statistics for the graph
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphStats {
    pub total: usize,
    pub done: usize,
    pub ready: usize,
    pub blocked: usize,
    pub in_progress: usize,
}

/// Linear issue data structure (subset of what Linear returns)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_subtask_serde_roundtrip() {
        let task = SubTask {
            id: "uuid-123".to_string(),
            identifier: "MOB-124".to_string(),
            title: "Implement feature".to_string(),
            status: TaskStatus::Ready,
            blocked_by: vec!["uuid-122".to_string()],
            blocks: vec!["uuid-125".to_string()],
            git_branch_name: "feature/mob-124".to_string(),
        };

        let json = serde_json::to_string(&task).unwrap();
        let parsed: SubTask = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.identifier, "MOB-124");
        assert_eq!(parsed.status, TaskStatus::Ready);
        assert_eq!(parsed.blocked_by, vec!["uuid-122"]);
    }

    #[test]
    fn test_linear_issue_serde_roundtrip() {
        let issue = LinearIssue {
            id: "uuid-1".to_string(),
            identifier: "MOB-100".to_string(),
            title: "Test issue".to_string(),
            status: "In Progress".to_string(),
            git_branch_name: "feature/mob-100".to_string(),
            relations: Some(Relations {
                blocked_by: vec![Relation {
                    id: "uuid-0".to_string(),
                    identifier: "MOB-99".to_string(),
                }],
                blocks: vec![Relation {
                    id: "uuid-2".to_string(),
                    identifier: "MOB-101".to_string(),
                }],
            }),
        };

        let json = serde_json::to_string(&issue).unwrap();
        let parsed: LinearIssue = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.identifier, "MOB-100");
        assert_eq!(parsed.relations.as_ref().unwrap().blocked_by.len(), 1);
    }

    #[test]
    fn test_linear_issue_without_relations() {
        let issue = LinearIssue {
            id: "uuid-1".to_string(),
            identifier: "MOB-100".to_string(),
            title: "Test issue".to_string(),
            status: "Backlog".to_string(),
            git_branch_name: String::new(),
            relations: None,
        };

        let json = serde_json::to_string(&issue).unwrap();
        let parsed: LinearIssue = serde_json::from_str(&json).unwrap();
        assert!(parsed.relations.is_none());
    }

    #[test]
    fn test_graph_stats_serde_roundtrip() {
        let stats = GraphStats {
            total: 10,
            done: 3,
            ready: 2,
            blocked: 4,
            in_progress: 1,
        };

        let json = serde_json::to_string(&stats).unwrap();
        let parsed: GraphStats = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.total, 10);
        assert_eq!(parsed.done, 3);
    }
}
