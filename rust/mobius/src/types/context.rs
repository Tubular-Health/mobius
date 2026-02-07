use serde::{Deserialize, Serialize};

use super::config::{ProjectDetectionResult, SubTaskVerifyCommand};
use super::enums::{Backend, PendingUpdateType, SessionStatus, TaskStatus, VerificationResult};

/// Parent issue details stored in local context
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParentIssueContext {
    pub id: String,
    pub identifier: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub git_branch_name: String,
    #[serde(alias = "state", deserialize_with = "deserialize_status_field")]
    pub status: String,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub url: String,
}

/// Deserialize a status field that can be either a plain string or a Linear-style
/// object with a `name` field (e.g. `{"id": "...", "name": "In Progress"}`).
fn deserialize_status_field<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    struct StatusObject {
        name: String,
    }

    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringOrObject {
        Str(String),
        Obj(StatusObject),
    }

    match StringOrObject::deserialize(deserializer)? {
        StringOrObject::Str(s) => Ok(s),
        StringOrObject::Obj(obj) => Ok(obj.name),
    }
}

/// Reference to a related issue (blocker or blocked)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IssueRef {
    pub id: String,
    pub identifier: String,
}

/// Sub-task stored in local context
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubTaskContext {
    pub id: String,
    #[serde(default)]
    pub identifier: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub status: String,
    #[serde(default)]
    pub git_branch_name: String,
    #[serde(default, deserialize_with = "deserialize_issue_refs")]
    pub blocked_by: Vec<IssueRef>,
    #[serde(default, deserialize_with = "deserialize_issue_refs")]
    pub blocks: Vec<IssueRef>,
}

/// Deserialize blockedBy/blocks fields that can be either string arrays or IssueRef arrays.
///
/// Refine writes these as string arrays like `["task-002"]`, but the canonical
/// format is `[{"id": "task-002", "identifier": "task-002"}]`. This handles both.
fn deserialize_issue_refs<'de, D>(deserializer: D) -> Result<Vec<IssueRef>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringOrRef {
        Str(String),
        Ref(IssueRef),
    }

    let items: Vec<StringOrRef> = Vec::deserialize(deserializer)?;
    Ok(items
        .into_iter()
        .map(|item| match item {
            StringOrRef::Str(s) => IssueRef {
                id: s.clone(),
                identifier: s,
            },
            StringOrRef::Ref(r) => r,
        })
        .collect())
}

fn deserialize_optional_token_count<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum TokenValue {
        Number(u64),
        String(String),
    }

    let value = Option::<TokenValue>::deserialize(deserializer)?;
    match value {
        None => Ok(None),
        Some(TokenValue::Number(n)) => Ok(Some(n)),
        Some(TokenValue::String(s)) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                trimmed
                    .parse::<u64>()
                    .map(Some)
                    .map_err(serde::de::Error::custom)
            }
        }
    }
}

/// Local-only issue specification for issues not backed by Linear/Jira
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalIssueSpec {
    pub local_id: String,
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
}

/// Summary of a single execution iteration in the loop
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IterationSummary {
    pub iteration_number: u32,
    pub started_at: String,
    pub completed_at: String,
    pub tasks_completed: Vec<String>,
    pub key_changes: Vec<String>,
    pub next_steps: Vec<String>,
}

/// Counter for generating LOC-{N} local issue identifiers
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCounter {
    pub next_task_number: u32,
    pub last_updated: String,
}

/// Metadata about the local context
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMetadata {
    pub fetched_at: String,
    pub updated_at: String,
    pub backend: Backend,
    pub synced_at: Option<String>,
}

/// Session information for the active working session
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub parent_id: String,
    pub backend: Backend,
    pub started_at: String,
    pub worktree_path: Option<String>,
    pub status: SessionStatus,
}

/// Active task running in a pane (runtime monitoring)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActiveTask {
    pub id: String,
    pub pid: u32,
    pub pane: String,
    pub started_at: String,
    pub worktree: Option<String>,
    #[serde(
        default,
        alias = "token",
        alias = "totalTokens",
        alias = "total_tokens",
        deserialize_with = "deserialize_optional_token_count"
    )]
    pub tokens: Option<u64>,
}

/// Completed or failed task with timing info (runtime monitoring)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCompletedTask {
    pub id: String,
    pub completed_at: String,
    pub duration: u64,
    #[serde(
        default,
        alias = "token",
        alias = "totalTokens",
        alias = "total_tokens",
        deserialize_with = "deserialize_optional_token_count"
    )]
    pub tokens: Option<u64>,
}

/// A single todo task from a Claude Code agent
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTodoTask {
    pub subject: String,
    pub status: String,
    pub description: Option<String>,
}

/// A todo file written by a Claude Code agent's PostToolUse hook
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTodoFile {
    pub subtask_id: String,
    pub updated_at: String,
    pub tasks: Vec<AgentTodoTask>,
}

/// Backend status entry for tracking synced status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendStatusEntry {
    pub identifier: String,
    pub status: String,
    pub synced_at: String,
}

/// Runtime execution state for TUI monitoring
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeState {
    pub parent_id: String,
    pub parent_title: String,
    pub active_tasks: Vec<RuntimeActiveTask>,
    pub completed_tasks: Vec<serde_json::Value>,
    pub failed_tasks: Vec<serde_json::Value>,
    pub started_at: String,
    pub updated_at: String,
    pub loop_pid: Option<u32>,
    pub total_tasks: Option<u32>,
    #[serde(
        default,
        alias = "token",
        alias = "totalTokens",
        alias = "total_tokens",
        deserialize_with = "deserialize_optional_token_count"
    )]
    pub tokens: Option<u64>,
    pub backend_statuses: Option<std::collections::HashMap<String, BackendStatusEntry>>,
}

/// Complete issue context stored locally
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueContext {
    pub parent: ParentIssueContext,
    pub sub_tasks: Vec<SubTaskContext>,
    pub metadata: ContextMetadata,
    pub project_info: Option<ProjectDetectionResult>,
    pub sub_task_verify_commands: Option<Vec<SubTaskVerifyCommand>>,
}

// --- Skill Output Types ---

/// Verification results for a subtask
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtaskVerificationResults {
    pub typecheck: VerificationResult,
    pub tests: VerificationResult,
    pub lint: VerificationResult,
    pub subtask_verify: Option<VerificationResult>,
}

/// Criteria result detail (used in verification needs-work output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CriterionDetail {
    pub criterion: String,
    pub status: String,
    pub evidence: String,
}

/// Criteria results summary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CriteriaResults {
    pub met: u32,
    pub total: u32,
    pub details: Vec<CriterionDetail>,
}

/// Issue detail for failing subtasks
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtaskIssue {
    #[serde(rename = "type")]
    pub issue_type: String,
    pub description: String,
    pub file: Option<String>,
    pub line: Option<u32>,
}

/// Failing subtask entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailingSubtask {
    pub id: String,
    pub identifier: String,
    pub issues: Vec<SubtaskIssue>,
}

/// Feedback comment for rework loop
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackComment {
    pub subtask_id: String,
    pub comment: String,
}

/// Discriminated union of all skill output variants
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum SkillOutputData {
    #[serde(rename = "SUBTASK_COMPLETE")]
    SubtaskComplete {
        timestamp: String,
        #[serde(rename = "subtaskId")]
        subtask_id: String,
        #[serde(rename = "parentId")]
        parent_id: Option<String>,
        #[serde(rename = "commitHash")]
        commit_hash: String,
        #[serde(rename = "filesModified")]
        files_modified: Vec<String>,
        #[serde(rename = "verificationResults")]
        verification_results: SubtaskVerificationResults,
    },
    #[serde(rename = "SUBTASK_PARTIAL")]
    SubtaskPartial {
        timestamp: String,
        #[serde(rename = "subtaskId")]
        subtask_id: String,
        #[serde(rename = "parentId")]
        parent_id: Option<String>,
        #[serde(rename = "progressMade")]
        progress_made: Vec<String>,
        #[serde(rename = "remainingWork")]
        remaining_work: Vec<String>,
        #[serde(rename = "commitHash")]
        commit_hash: Option<String>,
    },
    #[serde(rename = "ALL_COMPLETE")]
    AllComplete {
        timestamp: String,
        #[serde(rename = "parentId")]
        parent_id: String,
        #[serde(rename = "subtaskId")]
        subtask_id: Option<String>,
        #[serde(rename = "completedCount")]
        completed_count: u32,
    },
    #[serde(rename = "ALL_BLOCKED")]
    AllBlocked {
        timestamp: String,
        #[serde(rename = "parentId")]
        parent_id: String,
        #[serde(rename = "subtaskId")]
        subtask_id: Option<String>,
        #[serde(rename = "blockedCount")]
        blocked_count: u32,
        #[serde(rename = "waitingOn")]
        waiting_on: Vec<String>,
    },
    #[serde(rename = "NO_SUBTASKS")]
    NoSubtasks {
        timestamp: String,
        #[serde(rename = "parentId")]
        parent_id: String,
        #[serde(rename = "subtaskId")]
        subtask_id: Option<String>,
    },
    #[serde(rename = "VERIFICATION_FAILED")]
    VerificationFailed {
        timestamp: String,
        #[serde(rename = "subtaskId")]
        subtask_id: String,
        #[serde(rename = "parentId")]
        parent_id: Option<String>,
        #[serde(rename = "errorType")]
        error_type: String,
        #[serde(rename = "errorOutput")]
        error_output: String,
        #[serde(rename = "attemptedFixes")]
        attempted_fixes: Vec<String>,
        #[serde(rename = "uncommittedFiles")]
        uncommitted_files: Vec<String>,
    },
    #[serde(rename = "NEEDS_WORK")]
    NeedsWork {
        timestamp: String,
        #[serde(rename = "subtaskId")]
        subtask_id: Option<String>,
        #[serde(rename = "parentId")]
        parent_id: Option<String>,
        issues: Option<Vec<String>>,
        #[serde(rename = "suggestedFixes")]
        suggested_fixes: Option<Vec<String>>,
        #[serde(rename = "verificationTaskId")]
        verification_task_id: Option<String>,
        #[serde(rename = "criteriaResults")]
        criteria_results: Option<CriteriaResults>,
        #[serde(rename = "failingSubtasks")]
        failing_subtasks: Option<Vec<FailingSubtask>>,
        #[serde(rename = "reworkIteration")]
        rework_iteration: Option<u32>,
        #[serde(rename = "feedbackComments")]
        feedback_comments: Option<Vec<FeedbackComment>>,
    },
    #[serde(rename = "PASS")]
    Pass {
        timestamp: String,
        #[serde(rename = "subtaskId")]
        subtask_id: Option<String>,
        #[serde(rename = "parentId")]
        parent_id: Option<String>,
        details: Option<String>,
    },
    #[serde(rename = "FAIL")]
    Fail {
        timestamp: String,
        #[serde(rename = "subtaskId")]
        subtask_id: Option<String>,
        #[serde(rename = "parentId")]
        parent_id: Option<String>,
        reason: String,
        details: Option<String>,
    },
}

// --- Pending Update Types ---

/// A pending update to be synced to the backend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PendingUpdateData {
    #[serde(rename = "status_change")]
    StatusChange {
        #[serde(rename = "issueId")]
        issue_id: String,
        identifier: String,
        #[serde(rename = "oldStatus")]
        old_status: String,
        #[serde(rename = "newStatus")]
        new_status: String,
    },
    #[serde(rename = "add_comment")]
    AddComment {
        #[serde(rename = "issueId")]
        issue_id: String,
        identifier: String,
        body: String,
    },
    #[serde(rename = "create_subtask")]
    CreateSubtask {
        #[serde(rename = "parentId")]
        parent_id: String,
        title: String,
        description: String,
        #[serde(rename = "blockedBy")]
        blocked_by: Option<Vec<String>>,
    },
    #[serde(rename = "update_description")]
    UpdateDescription {
        #[serde(rename = "issueId")]
        issue_id: String,
        identifier: String,
        description: String,
    },
    #[serde(rename = "add_label")]
    AddLabel {
        #[serde(rename = "issueId")]
        issue_id: String,
        identifier: String,
        label: String,
    },
    #[serde(rename = "remove_label")]
    RemoveLabel {
        #[serde(rename = "issueId")]
        issue_id: String,
        identifier: String,
        label: String,
    },
}

/// A pending update with metadata wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingUpdate {
    pub id: String,
    pub created_at: String,
    pub synced_at: Option<String>,
    pub error: Option<String>,
    #[serde(flatten)]
    pub data: PendingUpdateData,
}

/// Queue of pending updates waiting to be synced
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingUpdatesQueue {
    pub updates: Vec<PendingUpdate>,
    pub last_sync_attempt: Option<String>,
    pub last_sync_success: Option<String>,
}

/// Entry in the sync log for audit trail
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncLogEntry {
    pub timestamp: String,
    pub update_id: String,
    #[serde(rename = "type")]
    pub update_type: PendingUpdateType,
    pub issue_identifier: String,
    pub success: bool,
    pub error: Option<String>,
    pub backend_response: Option<String>,
}

/// Complete sync log file structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncLog {
    pub entries: Vec<SyncLogEntry>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parent_issue_context_serde_roundtrip() {
        let parent = ParentIssueContext {
            id: "abc-123".to_string(),
            identifier: "MOB-100".to_string(),
            title: "Test issue".to_string(),
            description: "A test".to_string(),
            git_branch_name: "feature/mob-100".to_string(),
            status: "Backlog".to_string(),
            labels: vec!["Feature".to_string()],
            url: "https://linear.app/issue/MOB-100".to_string(),
        };

        let json = serde_json::to_string(&parent).unwrap();
        let parsed: ParentIssueContext = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.identifier, "MOB-100");
        assert_eq!(parsed.git_branch_name, "feature/mob-100");
    }

    #[test]
    fn test_parent_issue_context_linear_state_object() {
        // Linear API returns state as an object with id and name
        let json = serde_json::json!({
            "id": "cc04d503-e7f5-48f8-b6fd-9ec198ee6e56",
            "identifier": "TUB-292",
            "title": "Remote active sessions not visible on other team devices",
            "description": "## Summary\nSome description",
            "state": {
                "id": "7ca632a3-9c6b-4ccc-968a-d7da504b1ce4",
                "name": "In Progress"
            },
            "team": {
                "id": "27d43416-a740-49ae-bdd9-e96c36abc610",
                "key": "TUB",
                "name": "Tubular"
            },
            "priority": 2,
            "labels": ["Bug"],
            "url": "https://linear.app/tubular/issue/TUB-292"
        });

        let parsed: ParentIssueContext = serde_json::from_value(json).unwrap();
        assert_eq!(parsed.identifier, "TUB-292");
        assert_eq!(parsed.status, "In Progress");
        assert_eq!(parsed.labels, vec!["Bug"]);
    }

    #[test]
    fn test_subtask_context_serde_roundtrip() {
        let json = serde_json::json!({
            "id": "task-001",
            "identifier": "MOB-101",
            "title": "Implement feature",
            "description": "Do the thing",
            "status": "ready",
            "gitBranchName": "feature/mob-101",
            "blockedBy": [{"id": "task-000", "identifier": "MOB-100"}],
            "blocks": []
        });

        let parsed: SubTaskContext = serde_json::from_value(json).unwrap();
        assert_eq!(parsed.status, "ready");
        assert_eq!(parsed.blocked_by.len(), 1);
        assert_eq!(parsed.blocked_by[0].identifier, "MOB-100");
    }

    #[test]
    fn test_subtask_context_string_blockers() {
        // Refine writes blockedBy as string arrays
        let json = serde_json::json!({
            "id": "task-002",
            "title": "Second task",
            "status": "pending",
            "blockedBy": ["task-001"],
            "blocks": ["task-003"]
        });

        let parsed: SubTaskContext = serde_json::from_value(json).unwrap();
        assert_eq!(parsed.blocked_by.len(), 1);
        assert_eq!(parsed.blocked_by[0].id, "task-001");
        assert_eq!(parsed.blocked_by[0].identifier, "task-001");
        assert_eq!(parsed.blocks.len(), 1);
    }

    #[test]
    fn test_issue_context_serde_roundtrip() {
        let ctx = IssueContext {
            parent: ParentIssueContext {
                id: "abc".to_string(),
                identifier: "MOB-100".to_string(),
                title: "Test".to_string(),
                description: "".to_string(),
                git_branch_name: "feature/mob-100".to_string(),
                status: "Backlog".to_string(),
                labels: vec![],
                url: "".to_string(),
            },
            sub_tasks: vec![],
            metadata: ContextMetadata {
                fetched_at: "2024-01-01T00:00:00Z".to_string(),
                updated_at: "2024-01-01T00:00:00Z".to_string(),
                backend: Backend::Linear,
                synced_at: None,
            },
            project_info: None,
            sub_task_verify_commands: None,
        };

        let json = serde_json::to_string(&ctx).unwrap();
        let parsed: IssueContext = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.parent.identifier, "MOB-100");
        assert_eq!(parsed.metadata.backend, Backend::Linear);
    }

    #[test]
    fn test_runtime_token_fields_treat_missing_null_and_empty_as_none() {
        let active_missing = serde_json::json!({
            "id": "task-1",
            "pid": 10,
            "pane": "%1",
            "startedAt": "2024-01-01T00:00:00Z",
            "worktree": null
        });
        let active_null = serde_json::json!({
            "id": "task-1",
            "pid": 10,
            "pane": "%1",
            "startedAt": "2024-01-01T00:00:00Z",
            "worktree": null,
            "tokens": null
        });
        let active_empty = serde_json::json!({
            "id": "task-1",
            "pid": 10,
            "pane": "%1",
            "startedAt": "2024-01-01T00:00:00Z",
            "worktree": null,
            "tokens": ""
        });

        let completed_missing = serde_json::json!({
            "id": "task-1",
            "completedAt": "2024-01-01T00:10:00Z",
            "duration": 42
        });
        let completed_null = serde_json::json!({
            "id": "task-1",
            "completedAt": "2024-01-01T00:10:00Z",
            "duration": 42,
            "tokens": null
        });
        let completed_empty = serde_json::json!({
            "id": "task-1",
            "completedAt": "2024-01-01T00:10:00Z",
            "duration": 42,
            "tokens": ""
        });

        let state_missing = serde_json::json!({
            "parentId": "MOB-1",
            "parentTitle": "Parent",
            "activeTasks": [],
            "completedTasks": [],
            "failedTasks": [],
            "startedAt": "2024-01-01T00:00:00Z",
            "updatedAt": "2024-01-01T00:00:00Z",
            "loopPid": null,
            "totalTasks": 1,
            "backendStatuses": null
        });
        let state_null = serde_json::json!({
            "parentId": "MOB-1",
            "parentTitle": "Parent",
            "activeTasks": [],
            "completedTasks": [],
            "failedTasks": [],
            "startedAt": "2024-01-01T00:00:00Z",
            "updatedAt": "2024-01-01T00:00:00Z",
            "loopPid": null,
            "totalTasks": 1,
            "tokens": null,
            "backendStatuses": null
        });
        let state_empty = serde_json::json!({
            "parentId": "MOB-1",
            "parentTitle": "Parent",
            "activeTasks": [],
            "completedTasks": [],
            "failedTasks": [],
            "startedAt": "2024-01-01T00:00:00Z",
            "updatedAt": "2024-01-01T00:00:00Z",
            "loopPid": null,
            "totalTasks": 1,
            "tokens": "",
            "backendStatuses": null
        });

        for active_json in [active_missing, active_null, active_empty] {
            let active: RuntimeActiveTask = serde_json::from_value(active_json).unwrap();
            assert_eq!(active.tokens, None);
        }

        for completed_json in [completed_missing, completed_null, completed_empty] {
            let completed: RuntimeCompletedTask = serde_json::from_value(completed_json).unwrap();
            assert_eq!(completed.tokens, None);
        }

        for state_json in [state_missing, state_null, state_empty] {
            let state: RuntimeState = serde_json::from_value(state_json).unwrap();
            assert_eq!(state.tokens, None);
        }
    }

    #[test]
    fn test_runtime_token_fields_roundtrip_consistency() {
        let active_json = serde_json::json!({
            "id": "task-1",
            "pid": 10,
            "pane": "%1",
            "startedAt": "2024-01-01T00:00:00Z",
            "worktree": null,
            "totalTokens": "123"
        });
        let active: RuntimeActiveTask = serde_json::from_value(active_json).unwrap();
        assert_eq!(active.tokens, Some(123));
        let active_roundtrip: RuntimeActiveTask =
            serde_json::from_str(&serde_json::to_string(&active).unwrap()).unwrap();
        assert_eq!(active_roundtrip.tokens, Some(123));

        let completed_json = serde_json::json!({
            "id": "task-1",
            "completedAt": "2024-01-01T00:10:00Z",
            "duration": 42,
            "token": 123
        });
        let completed: RuntimeCompletedTask = serde_json::from_value(completed_json).unwrap();
        assert_eq!(completed.tokens, Some(123));
        let completed_roundtrip: RuntimeCompletedTask =
            serde_json::from_str(&serde_json::to_string(&completed).unwrap()).unwrap();
        assert_eq!(completed_roundtrip.tokens, Some(123));

        let state_json = serde_json::json!({
            "parentId": "MOB-1",
            "parentTitle": "Parent",
            "activeTasks": [],
            "completedTasks": [],
            "failedTasks": [],
            "startedAt": "2024-01-01T00:00:00Z",
            "updatedAt": "2024-01-01T00:00:00Z",
            "loopPid": null,
            "totalTasks": 1,
            "total_tokens": "123",
            "backendStatuses": null
        });
        let state: RuntimeState = serde_json::from_value(state_json).unwrap();
        assert_eq!(state.tokens, Some(123));
        let state_roundtrip: RuntimeState =
            serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap();
        assert_eq!(state_roundtrip.tokens, Some(123));
    }

    #[test]
    fn test_skill_output_subtask_complete_serde() {
        let output = SkillOutputData::SubtaskComplete {
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            subtask_id: "MOB-101".to_string(),
            parent_id: Some("MOB-100".to_string()),
            commit_hash: "abc1234".to_string(),
            files_modified: vec!["src/main.rs".to_string()],
            verification_results: SubtaskVerificationResults {
                typecheck: VerificationResult::Pass,
                tests: VerificationResult::Pass,
                lint: VerificationResult::Pass,
                subtask_verify: Some(VerificationResult::Pass),
            },
        };

        let json = serde_json::to_string(&output).unwrap();
        assert!(json.contains("\"status\":\"SUBTASK_COMPLETE\""));
        let parsed: SkillOutputData = serde_json::from_str(&json).unwrap();
        match parsed {
            SkillOutputData::SubtaskComplete { subtask_id, .. } => {
                assert_eq!(subtask_id, "MOB-101");
            }
            _ => panic!("Expected SubtaskComplete"),
        }
    }

    #[test]
    fn test_skill_output_all_statuses_serialize() {
        let cases: Vec<(SkillOutputData, &str)> = vec![
            (
                SkillOutputData::SubtaskComplete {
                    timestamp: "t".into(),
                    subtask_id: "s".into(),
                    parent_id: None,
                    commit_hash: "h".into(),
                    files_modified: vec![],
                    verification_results: SubtaskVerificationResults {
                        typecheck: VerificationResult::Pass,
                        tests: VerificationResult::Pass,
                        lint: VerificationResult::Pass,
                        subtask_verify: None,
                    },
                },
                "SUBTASK_COMPLETE",
            ),
            (
                SkillOutputData::SubtaskPartial {
                    timestamp: "t".into(),
                    subtask_id: "s".into(),
                    parent_id: None,
                    progress_made: vec![],
                    remaining_work: vec![],
                    commit_hash: None,
                },
                "SUBTASK_PARTIAL",
            ),
            (
                SkillOutputData::AllComplete {
                    timestamp: "t".into(),
                    parent_id: "p".into(),
                    subtask_id: None,
                    completed_count: 5,
                },
                "ALL_COMPLETE",
            ),
            (
                SkillOutputData::AllBlocked {
                    timestamp: "t".into(),
                    parent_id: "p".into(),
                    subtask_id: None,
                    blocked_count: 3,
                    waiting_on: vec!["MOB-101".into()],
                },
                "ALL_BLOCKED",
            ),
            (
                SkillOutputData::NoSubtasks {
                    timestamp: "t".into(),
                    parent_id: "p".into(),
                    subtask_id: None,
                },
                "NO_SUBTASKS",
            ),
            (
                SkillOutputData::VerificationFailed {
                    timestamp: "t".into(),
                    subtask_id: "s".into(),
                    parent_id: None,
                    error_type: "tests".into(),
                    error_output: "failed".into(),
                    attempted_fixes: vec![],
                    uncommitted_files: vec![],
                },
                "VERIFICATION_FAILED",
            ),
            (
                SkillOutputData::NeedsWork {
                    timestamp: "t".into(),
                    subtask_id: Some("s".into()),
                    parent_id: None,
                    issues: Some(vec!["bug".into()]),
                    suggested_fixes: Some(vec!["fix".into()]),
                    verification_task_id: None,
                    criteria_results: None,
                    failing_subtasks: None,
                    rework_iteration: None,
                    feedback_comments: None,
                },
                "NEEDS_WORK",
            ),
            (
                SkillOutputData::Pass {
                    timestamp: "t".into(),
                    subtask_id: None,
                    parent_id: None,
                    details: None,
                },
                "PASS",
            ),
            (
                SkillOutputData::Fail {
                    timestamp: "t".into(),
                    subtask_id: None,
                    parent_id: None,
                    reason: "broken".into(),
                    details: None,
                },
                "FAIL",
            ),
        ];

        for (output, expected_status) in cases {
            let json = serde_json::to_string(&output).unwrap();
            assert!(
                json.contains(&format!("\"status\":\"{}\"", expected_status)),
                "Expected status '{}' in json: {}",
                expected_status,
                json
            );
            let _parsed: SkillOutputData = serde_json::from_str(&json).unwrap();
        }
    }

    #[test]
    fn test_skill_output_needs_work_verify_format() {
        let output = SkillOutputData::NeedsWork {
            timestamp: "t".into(),
            subtask_id: None,
            parent_id: Some("MOB-100".into()),
            issues: None,
            suggested_fixes: None,
            verification_task_id: Some("MOB-VG".into()),
            criteria_results: Some(CriteriaResults {
                met: 3,
                total: 5,
                details: vec![CriterionDetail {
                    criterion: "Tests pass".into(),
                    status: "PASS".into(),
                    evidence: "All 10 tests passed".into(),
                }],
            }),
            failing_subtasks: Some(vec![FailingSubtask {
                id: "task-001".into(),
                identifier: "MOB-101".into(),
                issues: vec![SubtaskIssue {
                    issue_type: "test_failure".into(),
                    description: "Test failed".into(),
                    file: Some("src/main.rs".into()),
                    line: Some(42),
                }],
            }]),
            rework_iteration: Some(1),
            feedback_comments: Some(vec![FeedbackComment {
                subtask_id: "MOB-101".into(),
                comment: "Fix the test".into(),
            }]),
        };

        let json = serde_json::to_string(&output).unwrap();
        assert!(json.contains("\"failingSubtasks\""));
        let parsed: SkillOutputData = serde_json::from_str(&json).unwrap();
        match parsed {
            SkillOutputData::NeedsWork {
                failing_subtasks, ..
            } => {
                assert!(failing_subtasks.is_some());
                assert_eq!(failing_subtasks.unwrap().len(), 1);
            }
            _ => panic!("Expected NeedsWork"),
        }
    }

    #[test]
    fn test_pending_update_status_change_serde() {
        let update = PendingUpdate {
            id: "uuid-123".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            synced_at: None,
            error: None,
            data: PendingUpdateData::StatusChange {
                issue_id: "abc".to_string(),
                identifier: "MOB-101".to_string(),
                old_status: "Backlog".to_string(),
                new_status: "In Progress".to_string(),
            },
        };

        let json = serde_json::to_string(&update).unwrap();
        assert!(json.contains("\"type\":\"status_change\""));
        let parsed: PendingUpdate = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "uuid-123");
        match parsed.data {
            PendingUpdateData::StatusChange { new_status, .. } => {
                assert_eq!(new_status, "In Progress");
            }
            _ => panic!("Expected StatusChange"),
        }
    }

    #[test]
    fn test_pending_update_all_variants_serde() {
        let variants: Vec<PendingUpdateData> = vec![
            PendingUpdateData::StatusChange {
                issue_id: "a".into(),
                identifier: "MOB-1".into(),
                old_status: "Backlog".into(),
                new_status: "Done".into(),
            },
            PendingUpdateData::AddComment {
                issue_id: "a".into(),
                identifier: "MOB-1".into(),
                body: "comment".into(),
            },
            PendingUpdateData::CreateSubtask {
                parent_id: "p".into(),
                title: "New task".into(),
                description: "Desc".into(),
                blocked_by: Some(vec!["a".into()]),
            },
            PendingUpdateData::UpdateDescription {
                issue_id: "a".into(),
                identifier: "MOB-1".into(),
                description: "New desc".into(),
            },
            PendingUpdateData::AddLabel {
                issue_id: "a".into(),
                identifier: "MOB-1".into(),
                label: "Bug".into(),
            },
            PendingUpdateData::RemoveLabel {
                issue_id: "a".into(),
                identifier: "MOB-1".into(),
                label: "Bug".into(),
            },
        ];

        let expected_types = [
            "status_change",
            "add_comment",
            "create_subtask",
            "update_description",
            "add_label",
            "remove_label",
        ];

        for (data, expected_type) in variants.into_iter().zip(expected_types.iter()) {
            let update = PendingUpdate {
                id: "id".into(),
                created_at: "t".into(),
                synced_at: None,
                error: None,
                data,
            };
            let json = serde_json::to_string(&update).unwrap();
            assert!(
                json.contains(&format!("\"type\":\"{}\"", expected_type)),
                "Expected type '{}' in json: {}",
                expected_type,
                json
            );
            let _parsed: PendingUpdate = serde_json::from_str(&json).unwrap();
        }
    }

    #[test]
    fn test_sync_log_serde_roundtrip() {
        let log = SyncLog {
            entries: vec![SyncLogEntry {
                timestamp: "2024-01-01T00:00:00Z".to_string(),
                update_id: "uuid-1".to_string(),
                update_type: PendingUpdateType::StatusChange,
                issue_identifier: "MOB-101".to_string(),
                success: true,
                error: None,
                backend_response: None,
            }],
        };

        let json = serde_json::to_string(&log).unwrap();
        let parsed: SyncLog = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(
            parsed.entries[0].update_type,
            PendingUpdateType::StatusChange
        );
    }
}
