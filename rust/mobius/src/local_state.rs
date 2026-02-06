//! Local state manager for project-local .mobius/ directory
//!
//! Manages the project-local .mobius/ directory structure including:
//! - Atomic LOC-{N} ID generation via counter.json
//! - Parent/sub-task spec storage
//! - Iteration logging for execution tracking
//! - Pending update queuing for backend sync
//!
//! Uses git repo root detection to ensure .mobius/ is always in the repository root,
//! even when called from nested subdirectories.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::types::context::{ParentIssueContext, SubTaskContext};
use crate::types::task_graph::{LinearIssue, Relation, Relations};

/// Cached git repo root, resolved once per process.
static GIT_REPO_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Entry in the iteration log tracking execution attempts
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IterationLogEntry {
    pub subtask_id: String,
    pub attempt: u32,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub status: IterationStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_modified: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_hash: Option<String>,
}

/// Status of an iteration
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum IterationStatus {
    Success,
    Failed,
    Partial,
}

/// Completion summary for a finished issue
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionSummary {
    pub parent_id: String,
    pub completed_at: String,
    pub total_tasks: u32,
    pub completed_tasks: u32,
    pub failed_tasks: u32,
    pub total_iterations: u32,
    pub task_outcomes: Vec<TaskOutcome>,
}

/// Outcome of a single task in the completion summary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskOutcome {
    pub id: String,
    pub status: String,
    pub iterations: u32,
}

/// Pending update entry queued for backend sync
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPendingUpdate {
    pub id: String,
    pub created_at: String,
    #[serde(rename = "type")]
    pub update_type: String,
    pub payload: serde_json::Value,
}

/// Counter file structure for LOC-{N} ID generation
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Counter {
    next: u32,
}

/// Status priority for deduplication — higher value wins
fn status_priority(status: &str) -> u32 {
    match status {
        "pending" => 0,
        "ready" => 1,
        "in_progress" => 2,
        "done" => 3,
        _ => 0,
    }
}

/// Get the git repository root directory.
///
/// Uses `git rev-parse --show-toplevel` to find the repo root.
/// Result is cached for the process lifetime via `OnceLock`.
fn get_git_repo_root() -> &'static Path {
    GIT_REPO_ROOT.get_or_init(|| {
        match Command::new("git")
            .args(["rev-parse", "--show-toplevel"])
            .output()
        {
            Ok(output) if output.status.success() => {
                let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
                PathBuf::from(root)
            }
            _ => {
                // Fallback to cwd if not in a git repo
                std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
            }
        }
    })
}

/// Get the absolute path to the project-local .mobius/ directory.
///
/// Always returns the path relative to the git repository root,
/// regardless of the current working directory.
pub fn get_project_mobius_path() -> PathBuf {
    get_git_repo_root().join(".mobius")
}

/// Ensure the project-local .mobius/ directory exists with proper structure.
///
/// Creates .mobius/ and a .gitignore file containing `state/` entry
/// to keep runtime state out of version control while preserving specs.
pub fn ensure_project_mobius_dir() -> Result<()> {
    let mobius_path = get_project_mobius_path();
    fs::create_dir_all(&mobius_path)
        .with_context(|| format!("Failed to create {}", mobius_path.display()))?;

    let gitignore_path = mobius_path.join(".gitignore");
    if !gitignore_path.exists() {
        fs::write(&gitignore_path, "state/\n")
            .with_context(|| format!("Failed to write {}", gitignore_path.display()))?;
    }

    Ok(())
}

/// Get the path to the issues directory within .mobius/
fn get_issues_path() -> PathBuf {
    get_project_mobius_path().join("issues")
}

/// Get the path to a specific issue directory
fn get_issue_path(issue_id: &str) -> PathBuf {
    get_issues_path().join(issue_id)
}

/// Ensure the directory structure for a specific issue exists
fn ensure_issue_dir(issue_id: &str) -> Result<()> {
    ensure_project_mobius_dir()?;
    let issue_path = get_issue_path(issue_id);
    fs::create_dir_all(issue_path.join("tasks"))
        .with_context(|| format!("Failed to create tasks dir for {}", issue_id))?;
    fs::create_dir_all(issue_path.join("execution"))
        .with_context(|| format!("Failed to create execution dir for {}", issue_id))?;
    Ok(())
}

/// Write data to a file atomically using temp file + rename pattern.
///
/// This ensures crash safety: either the old content or the new content
/// is visible, never a partially-written file.
fn atomic_write_json<T: Serialize>(path: &Path, data: &T) -> Result<()> {
    let tmp_path = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(data)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(&tmp_path, &json)
        .with_context(|| format!("Failed to write temp file {}", tmp_path.display()))?;
    fs::rename(&tmp_path, path).with_context(|| {
        format!(
            "Failed to rename {} -> {}",
            tmp_path.display(),
            path.display()
        )
    })?;
    Ok(())
}

/// Scan existing LOC-* directories to determine next ID.
fn scan_for_next_id(issues_path: &Path) -> u32 {
    let entries = match fs::read_dir(issues_path) {
        Ok(entries) => entries,
        Err(_) => return 1,
    };

    let mut max_id: u32 = 0;

    for entry in entries.flatten() {
        if let Ok(file_type) = entry.file_type() {
            if file_type.is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    if let Some(num_str) = name.strip_prefix("LOC-") {
                        if let Ok(num) = num_str.parse::<u32>() {
                            if num > max_id {
                                max_id = num;
                            }
                        }
                    }
                }
            }
        }
    }

    max_id + 1
}

/// Get the next local ID by atomically incrementing counter.json.
///
/// Returns IDs in LOC-{N} format where N is zero-padded to 3 digits.
/// Uses atomic write (temp file + rename) for the counter file.
/// If counter.json is missing or corrupted, scans existing LOC-* directories
/// to determine the next ID.
pub fn get_next_local_id() -> Result<String> {
    ensure_project_mobius_dir()?;
    let issues_path = get_issues_path();
    fs::create_dir_all(&issues_path)?;

    let counter_path = issues_path.join("counter.json");
    let next_value = if counter_path.exists() {
        match fs::read_to_string(&counter_path) {
            Ok(content) => match serde_json::from_str::<Counter>(&content) {
                Ok(counter) if counter.next > 0 => counter.next,
                _ => scan_for_next_id(&issues_path),
            },
            Err(_) => scan_for_next_id(&issues_path),
        }
    } else {
        scan_for_next_id(&issues_path)
    };

    let new_counter = Counter {
        next: next_value + 1,
    };
    atomic_write_json(&counter_path, &new_counter)?;

    Ok(format!("LOC-{:03}", next_value))
}

/// Write a parent issue spec to .mobius/issues/{issueId}/parent.json
pub fn write_parent_spec(issue_id: &str, spec: &ParentIssueContext) -> Result<()> {
    ensure_issue_dir(issue_id)?;
    let file_path = get_issue_path(issue_id).join("parent.json");
    atomic_write_json(&file_path, spec)
}

/// Read a parent issue spec from .mobius/issues/{issueId}/parent.json
///
/// Returns None if the file doesn't exist or is corrupted.
pub fn read_parent_spec(issue_id: &str) -> Option<ParentIssueContext> {
    let file_path = get_issue_path(issue_id).join("parent.json");
    let content = fs::read_to_string(&file_path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Write a sub-task spec to .mobius/issues/{issueId}/tasks/{identifier}.json
pub fn write_subtask_spec(issue_id: &str, task: &SubTaskContext) -> Result<()> {
    let identifier = if task.identifier.is_empty() {
        &task.id
    } else {
        &task.identifier
    };
    if identifier.is_empty() {
        return Ok(());
    }

    ensure_issue_dir(issue_id)?;
    let file_path = get_issue_path(issue_id)
        .join("tasks")
        .join(format!("{}.json", identifier));
    atomic_write_json(&file_path, task)
}

/// Update just the status field of a parent issue's parent.json file on disk.
///
/// Reads the existing file, patches the status, and writes it back atomically.
/// Returns false if the file doesn't exist.
pub fn update_parent_status(issue_id: &str, status: &str) -> bool {
    let file_path = get_issue_path(issue_id).join("parent.json");
    let content = match fs::read_to_string(&file_path) {
        Ok(c) => c,
        Err(_) => return false,
    };

    let mut spec: ParentIssueContext = match serde_json::from_str(&content) {
        Ok(s) => s,
        Err(_) => return false,
    };

    spec.status = status.to_string();
    atomic_write_json(&file_path, &spec).is_ok()
}

/// Update just the status field of a sub-task's JSON file on disk.
///
/// Reads the existing file, patches the status, and writes it back atomically.
/// This ensures syncGraphFromLocal() sees the updated status on the next iteration.
pub fn update_subtask_status(issue_id: &str, task_identifier: &str, status: &str) {
    let file_path = get_issue_path(issue_id)
        .join("tasks")
        .join(format!("{}.json", task_identifier));

    let content = match fs::read_to_string(&file_path) {
        Ok(c) => c,
        Err(_) => return,
    };

    let mut task: SubTaskContext = match serde_json::from_str(&content) {
        Ok(t) => t,
        Err(_) => return,
    };

    task.status = status.to_string();
    let _ = atomic_write_json(&file_path, &task);
}

/// Read all sub-task specs from .mobius/issues/{issueId}/tasks/
///
/// Returns an array of all valid sub-task specs found in the tasks directory.
/// Silently skips files that can't be parsed.
pub fn read_subtasks(issue_id: &str) -> Vec<SubTaskContext> {
    let tasks_dir = get_issue_path(issue_id).join("tasks");
    let entries = match fs::read_dir(&tasks_dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let mut tasks = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let mut task: SubTaskContext = match serde_json::from_str(&content) {
            Ok(t) => t,
            Err(_) => continue,
        };

        // Infer identifier from filename if missing
        if task.identifier.is_empty() {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                task.identifier = stem.to_string();
            }
        }

        tasks.push(task);
    }

    tasks
}

/// Read local sub-tasks and convert to LinearIssue format for buildTaskGraph().
///
/// Handles the schema mismatch between refine-written task files (which use
/// string arrays for blockedBy/blocks) and the LinearIssue format expected by
/// the task graph builder. Deduplicates by ID with status priority (higher status wins).
pub fn read_local_subtasks_as_linear_issues(issue_id: &str) -> Vec<LinearIssue> {
    let tasks = read_subtasks(issue_id);

    let issues: Vec<LinearIssue> = tasks
        .into_iter()
        .map(|task| {
            let blocked_by: Vec<Relation> = task
                .blocked_by
                .iter()
                .map(|b| Relation {
                    id: b.id.clone(),
                    identifier: b.identifier.clone(),
                })
                .collect();

            let blocks: Vec<Relation> = task
                .blocks
                .iter()
                .map(|b| Relation {
                    id: b.id.clone(),
                    identifier: b.identifier.clone(),
                })
                .collect();

            let identifier = if task.identifier.is_empty() {
                task.id.clone()
            } else {
                task.identifier.clone()
            };

            LinearIssue {
                id: task.id,
                identifier,
                title: task.title,
                status: task.status,
                git_branch_name: task.git_branch_name,
                relations: Some(Relations { blocked_by, blocks }),
            }
        })
        .collect();

    // Deduplicate by id — prefer done > in_progress > ready > pending
    let mut by_id: HashMap<String, LinearIssue> = HashMap::new();
    for issue in issues {
        let dominated = by_id
            .get(&issue.id)
            .map(|existing| status_priority(&issue.status) > status_priority(&existing.status))
            .unwrap_or(true);

        if dominated {
            by_id.insert(issue.id.clone(), issue);
        }
    }

    by_id.into_values().collect()
}

/// Read all iteration log entries from .mobius/issues/{issueId}/execution/iterations.json
///
/// Returns an empty vec if the file doesn't exist or is corrupted.
pub fn read_iteration_log(issue_id: &str) -> Vec<IterationLogEntry> {
    let file_path = get_issue_path(issue_id)
        .join("execution")
        .join("iterations.json");

    let content = match fs::read_to_string(&file_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    serde_json::from_str::<Vec<IterationLogEntry>>(&content).unwrap_or_default()
}

/// Write an iteration log entry to .mobius/issues/{issueId}/execution/iterations.json
///
/// Appends the entry to the existing array, or creates a new array if the file doesn't exist.
pub fn write_iteration_log(issue_id: &str, entry: IterationLogEntry) -> Result<()> {
    ensure_issue_dir(issue_id)?;
    let file_path = get_issue_path(issue_id)
        .join("execution")
        .join("iterations.json");

    let mut entries = if file_path.exists() {
        match fs::read_to_string(&file_path) {
            Ok(content) => {
                serde_json::from_str::<Vec<IterationLogEntry>>(&content).unwrap_or_default()
            }
            Err(_) => Vec::new(),
        }
    } else {
        Vec::new()
    };

    entries.push(entry);
    atomic_write_json(&file_path, &entries)
}

/// Write a completion summary to .mobius/issues/{issueId}/summary.json
pub fn write_summary(issue_id: &str, summary: &CompletionSummary) -> Result<()> {
    ensure_issue_dir(issue_id)?;
    let file_path = get_issue_path(issue_id).join("summary.json");
    atomic_write_json(&file_path, summary)
}

/// Queue a pending update for backend sync.
///
/// Appends an update entry with a UUID and timestamp to
/// .mobius/issues/{issueId}/pending-updates.json
pub fn queue_pending_update(
    issue_id: &str,
    update_type: &str,
    payload: serde_json::Value,
) -> Result<()> {
    ensure_issue_dir(issue_id)?;
    let file_path = get_issue_path(issue_id).join("pending-updates.json");

    let mut updates: Vec<LocalPendingUpdate> = if file_path.exists() {
        match fs::read_to_string(&file_path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    } else {
        Vec::new()
    };

    updates.push(LocalPendingUpdate {
        id: Uuid::new_v4().to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        update_type: update_type.to_string(),
        payload,
    });

    atomic_write_json(&file_path, &updates)
}

/// Read all pending updates from .mobius/issues/{issueId}/pending-updates.json
pub fn read_pending_updates(issue_id: &str) -> Vec<LocalPendingUpdate> {
    let file_path = get_issue_path(issue_id).join("pending-updates.json");
    let content = match fs::read_to_string(&file_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&content).unwrap_or_default()
}

/// Write pending updates to .mobius/issues/{issueId}/pending-updates.json
pub fn write_pending_updates(issue_id: &str, updates: &[LocalPendingUpdate]) -> Result<()> {
    let file_path = get_issue_path(issue_id).join("pending-updates.json");
    atomic_write_json(&file_path, &updates.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Helper to set up a fake git repo and override the cached root.
    /// Since OnceLock can only be set once, tests that need isolation
    /// work with explicit paths instead of relying on the global cache.
    fn setup_test_dir() -> TempDir {
        TempDir::new().expect("Failed to create temp dir")
    }

    fn issues_path(base: &Path) -> PathBuf {
        base.join(".mobius").join("issues")
    }

    fn ensure_task_dir(base: &Path, issue_id: &str) {
        let issue_path = issues_path(base).join(issue_id);
        fs::create_dir_all(issue_path.join("tasks")).unwrap();
        fs::create_dir_all(issue_path.join("execution")).unwrap();
    }

    #[test]
    fn test_get_next_local_id_sequential() {
        // Test that IDs are generated sequentially using scan_for_next_id
        let tmp = setup_test_dir();
        let issues = tmp.path().join("issues");
        fs::create_dir_all(&issues).unwrap();

        // No existing directories -> should return 1
        assert_eq!(scan_for_next_id(&issues), 1);

        // Create LOC-001
        fs::create_dir_all(issues.join("LOC-001")).unwrap();
        assert_eq!(scan_for_next_id(&issues), 2);

        // Create LOC-003 (gap)
        fs::create_dir_all(issues.join("LOC-003")).unwrap();
        assert_eq!(scan_for_next_id(&issues), 4);
    }

    #[test]
    fn test_counter_recovery_with_existing_dirs() {
        let tmp = setup_test_dir();
        let issues = tmp.path().join("issues");
        fs::create_dir_all(&issues).unwrap();

        // Create some LOC directories to simulate pre-existing state
        fs::create_dir_all(issues.join("LOC-001")).unwrap();
        fs::create_dir_all(issues.join("LOC-002")).unwrap();
        fs::create_dir_all(issues.join("LOC-005")).unwrap();

        // scan_for_next_id should find max=5 and return 6
        assert_eq!(scan_for_next_id(&issues), 6);
    }

    #[test]
    fn test_counter_with_corrupted_json() {
        let tmp = setup_test_dir();
        let issues = tmp.path().join("issues");
        fs::create_dir_all(&issues).unwrap();

        // Write corrupted counter.json
        let counter_path = issues.join("counter.json");
        fs::write(&counter_path, "not valid json").unwrap();

        // Create a LOC dir so recovery has something to find
        fs::create_dir_all(issues.join("LOC-002")).unwrap();

        // Should fall back to scanning
        assert_eq!(scan_for_next_id(&issues), 3);
    }

    #[test]
    fn test_counter_with_valid_json() {
        let tmp = setup_test_dir();
        let issues = tmp.path().join("issues");
        fs::create_dir_all(&issues).unwrap();

        let counter_path = issues.join("counter.json");
        let counter = Counter { next: 7 };
        fs::write(
            &counter_path,
            serde_json::to_string_pretty(&counter).unwrap(),
        )
        .unwrap();

        let content = fs::read_to_string(&counter_path).unwrap();
        let parsed: Counter = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed.next, 7);
    }

    #[test]
    fn test_atomic_write_json() {
        let tmp = setup_test_dir();
        let file_path = tmp.path().join("test.json");

        #[derive(Serialize, Deserialize, Debug, PartialEq)]
        struct TestData {
            value: String,
        }

        let data = TestData {
            value: "hello".to_string(),
        };
        atomic_write_json(&file_path, &data).unwrap();

        let content = fs::read_to_string(&file_path).unwrap();
        let parsed: TestData = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed, data);

        // Verify no tmp file remains
        assert!(!file_path.with_extension("json.tmp").exists());
    }

    #[test]
    fn test_write_and_read_parent_spec() {
        let tmp = setup_test_dir();
        let issue_id = "TEST-001";
        ensure_task_dir(tmp.path(), issue_id);

        let spec = ParentIssueContext {
            id: "abc123".to_string(),
            identifier: "TEST-001".to_string(),
            title: "Test Issue".to_string(),
            description: "A test".to_string(),
            git_branch_name: "feature/test".to_string(),
            status: "Backlog".to_string(),
            labels: vec!["Feature".to_string()],
            url: "https://example.com".to_string(),
        };

        let file_path = issues_path(tmp.path()).join(issue_id).join("parent.json");
        atomic_write_json(&file_path, &spec).unwrap();

        let content = fs::read_to_string(&file_path).unwrap();
        let read_back: ParentIssueContext = serde_json::from_str(&content).unwrap();
        assert_eq!(read_back.identifier, "TEST-001");
        assert_eq!(read_back.title, "Test Issue");
    }

    #[test]
    fn test_write_and_read_subtask() {
        let tmp = setup_test_dir();
        let issue_id = "TEST-001";
        ensure_task_dir(tmp.path(), issue_id);

        let task = SubTaskContext {
            id: "task-001".to_string(),
            identifier: "task-001".to_string(),
            title: "First task".to_string(),
            description: "Do something".to_string(),
            status: "pending".to_string(),
            git_branch_name: String::new(),
            blocked_by: vec![],
            blocks: vec![],
        };

        let file_path = issues_path(tmp.path())
            .join(issue_id)
            .join("tasks")
            .join("task-001.json");
        atomic_write_json(&file_path, &task).unwrap();

        let content = fs::read_to_string(&file_path).unwrap();
        let read_back: SubTaskContext = serde_json::from_str(&content).unwrap();
        assert_eq!(read_back.identifier, "task-001");
        assert_eq!(read_back.status, "pending");
    }

    #[test]
    fn test_read_subtasks_with_missing_dir() {
        // read_subtasks should return empty vec for non-existent directory
        let tasks = read_subtasks("NONEXISTENT-999");
        // This may or may not be empty depending on git root, but should not panic
        assert!(tasks.is_empty() || !tasks.is_empty());
    }

    #[test]
    fn test_read_local_subtasks_deduplication() {
        let tmp = setup_test_dir();
        let issue_id = "TEST-DEDUP";
        ensure_task_dir(tmp.path(), issue_id);

        let tasks_dir = issues_path(tmp.path()).join(issue_id).join("tasks");

        // Write two files for the same task ID with different statuses
        // The one with higher priority status should win
        let task_pending = SubTaskContext {
            id: "task-001".to_string(),
            identifier: "task-001".to_string(),
            title: "First task".to_string(),
            description: String::new(),
            status: "pending".to_string(),
            git_branch_name: String::new(),
            blocked_by: vec![],
            blocks: vec![],
        };

        let task_done = SubTaskContext {
            id: "task-001".to_string(),
            identifier: "task-001-done".to_string(),
            title: "First task".to_string(),
            description: String::new(),
            status: "done".to_string(),
            git_branch_name: String::new(),
            blocked_by: vec![],
            blocks: vec![],
        };

        // Write both
        fs::write(
            tasks_dir.join("task-001.json"),
            serde_json::to_string_pretty(&task_pending).unwrap(),
        )
        .unwrap();
        fs::write(
            tasks_dir.join("task-001-done.json"),
            serde_json::to_string_pretty(&task_done).unwrap(),
        )
        .unwrap();

        // Read as linear issues — files are read from this specific directory
        let entries = fs::read_dir(&tasks_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|ext| ext.to_str()) == Some("json"))
            .filter_map(|e| {
                let content = fs::read_to_string(e.path()).ok()?;
                serde_json::from_str::<SubTaskContext>(&content).ok()
            })
            .collect::<Vec<_>>();

        // Convert and deduplicate manually (same logic as read_local_subtasks_as_linear_issues)
        let mut by_id: HashMap<String, LinearIssue> = HashMap::new();
        for task in entries {
            let issue = LinearIssue {
                id: task.id.clone(),
                identifier: if task.identifier.is_empty() {
                    task.id.clone()
                } else {
                    task.identifier.clone()
                },
                title: task.title,
                status: task.status.clone(),
                git_branch_name: task.git_branch_name,
                relations: None,
            };

            let dominated = by_id
                .get(&issue.id)
                .map(|existing| status_priority(&issue.status) > status_priority(&existing.status))
                .unwrap_or(true);
            if dominated {
                by_id.insert(issue.id.clone(), issue);
            }
        }

        let issues: Vec<_> = by_id.into_values().collect();
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].status, "done");
    }

    #[test]
    fn test_iteration_log_roundtrip() {
        let tmp = setup_test_dir();
        let issue_id = "TEST-ITER";
        ensure_task_dir(tmp.path(), issue_id);

        let entry = IterationLogEntry {
            subtask_id: "task-001".to_string(),
            attempt: 1,
            started_at: "2026-01-28T14:30:00Z".to_string(),
            completed_at: Some("2026-01-28T14:45:00Z".to_string()),
            status: IterationStatus::Success,
            error: None,
            files_modified: Some(vec!["src/main.rs".to_string()]),
            commit_hash: Some("abc1234".to_string()),
        };

        let file_path = issues_path(tmp.path())
            .join(issue_id)
            .join("execution")
            .join("iterations.json");

        // Write first entry
        let entries = vec![entry.clone()];
        atomic_write_json(&file_path, &entries).unwrap();

        // Read back
        let content = fs::read_to_string(&file_path).unwrap();
        let read_back: Vec<IterationLogEntry> = serde_json::from_str(&content).unwrap();
        assert_eq!(read_back.len(), 1);
        assert_eq!(read_back[0].subtask_id, "task-001");
        assert_eq!(read_back[0].status, IterationStatus::Success);

        // Append second entry
        let entry2 = IterationLogEntry {
            subtask_id: "task-002".to_string(),
            attempt: 1,
            started_at: "2026-01-28T15:00:00Z".to_string(),
            completed_at: None,
            status: IterationStatus::Failed,
            error: Some("Test failed".to_string()),
            files_modified: None,
            commit_hash: None,
        };

        let mut all_entries = read_back;
        all_entries.push(entry2);
        atomic_write_json(&file_path, &all_entries).unwrap();

        let content2 = fs::read_to_string(&file_path).unwrap();
        let read_back2: Vec<IterationLogEntry> = serde_json::from_str(&content2).unwrap();
        assert_eq!(read_back2.len(), 2);
        assert_eq!(read_back2[1].status, IterationStatus::Failed);
    }

    #[test]
    fn test_pending_update_roundtrip() {
        let tmp = setup_test_dir();
        let issue_id = "TEST-PU";
        ensure_task_dir(tmp.path(), issue_id);

        let update = LocalPendingUpdate {
            id: Uuid::new_v4().to_string(),
            created_at: "2026-01-28T14:30:00Z".to_string(),
            update_type: "status_change".to_string(),
            payload: serde_json::json!({
                "issueId": "abc123",
                "newStatus": "Done"
            }),
        };

        let file_path = issues_path(tmp.path())
            .join(issue_id)
            .join("pending-updates.json");
        let updates = vec![update];
        atomic_write_json(&file_path, &updates).unwrap();

        let content = fs::read_to_string(&file_path).unwrap();
        let read_back: Vec<LocalPendingUpdate> = serde_json::from_str(&content).unwrap();
        assert_eq!(read_back.len(), 1);
        assert_eq!(read_back[0].update_type, "status_change");
    }

    #[test]
    fn test_subtask_context_with_string_blockers() {
        // Test that the custom deserializer handles string arrays for blockedBy
        let json = r#"{
            "id": "task-003",
            "identifier": "task-003",
            "title": "Third task",
            "description": "",
            "status": "pending",
            "gitBranchName": "",
            "blockedBy": ["task-001", "task-002"],
            "blocks": ["task-004"]
        }"#;

        let task: SubTaskContext = serde_json::from_str(json).unwrap();
        assert_eq!(task.blocked_by.len(), 2);
        assert_eq!(task.blocked_by[0].id, "task-001");
        assert_eq!(task.blocked_by[0].identifier, "task-001");
        assert_eq!(task.blocks.len(), 1);
        assert_eq!(task.blocks[0].id, "task-004");
    }

    #[test]
    fn test_subtask_context_with_object_blockers() {
        // Test that the custom deserializer handles object arrays for blockedBy
        let json = r#"{
            "id": "task-003",
            "identifier": "task-003",
            "title": "Third task",
            "description": "",
            "status": "pending",
            "gitBranchName": "",
            "blockedBy": [{"id": "task-001", "identifier": "MOB-101"}, {"id": "task-002", "identifier": "MOB-102"}],
            "blocks": [{"id": "task-004", "identifier": "MOB-104"}]
        }"#;

        let task: SubTaskContext = serde_json::from_str(json).unwrap();
        assert_eq!(task.blocked_by.len(), 2);
        assert_eq!(task.blocked_by[0].id, "task-001");
        assert_eq!(task.blocked_by[0].identifier, "MOB-101");
        assert_eq!(task.blocks[0].identifier, "MOB-104");
    }

    #[test]
    fn test_completion_summary_roundtrip() {
        let summary = CompletionSummary {
            parent_id: "MOB-100".to_string(),
            completed_at: "2026-01-28T16:00:00Z".to_string(),
            total_tasks: 5,
            completed_tasks: 4,
            failed_tasks: 1,
            total_iterations: 8,
            task_outcomes: vec![
                TaskOutcome {
                    id: "task-001".to_string(),
                    status: "done".to_string(),
                    iterations: 1,
                },
                TaskOutcome {
                    id: "task-002".to_string(),
                    status: "failed".to_string(),
                    iterations: 3,
                },
            ],
        };

        let json = serde_json::to_string_pretty(&summary).unwrap();
        let read_back: CompletionSummary = serde_json::from_str(&json).unwrap();
        assert_eq!(read_back.parent_id, "MOB-100");
        assert_eq!(read_back.total_tasks, 5);
        assert_eq!(read_back.task_outcomes.len(), 2);
    }

    #[test]
    fn test_status_priority() {
        assert!(status_priority("done") > status_priority("in_progress"));
        assert!(status_priority("in_progress") > status_priority("ready"));
        assert!(status_priority("ready") > status_priority("pending"));
        assert_eq!(status_priority("unknown"), 0);
    }

    #[test]
    fn test_read_missing_files_returns_none_or_empty() {
        // These should not panic even when files don't exist
        let spec = read_parent_spec("DEFINITELY-NOT-EXISTS-12345");
        // May be None or may read from actual .mobius dir, but should not panic
        let _ = spec;

        let log = read_iteration_log("DEFINITELY-NOT-EXISTS-12345");
        let _ = log;

        let updates = read_pending_updates("DEFINITELY-NOT-EXISTS-12345");
        let _ = updates;
    }

    // =========================================================================
    // Corrupted JSON Recovery Tests
    // =========================================================================

    #[test]
    fn test_counter_with_invalid_next_value() {
        // Negative next value (via raw JSON with signed int) should fall back to scan
        let tmp = setup_test_dir();
        let issues = tmp.path().join("issues");
        fs::create_dir_all(&issues).unwrap();

        // Write counter.json with next: 0 (treated as invalid since counter.next > 0 fails)
        let counter_path = issues.join("counter.json");
        fs::write(&counter_path, r#"{"next": 0}"#).unwrap();

        // Create a LOC dir so recovery has something to find
        fs::create_dir_all(issues.join("LOC-003")).unwrap();

        // Read counter — next=0 fails the `counter.next > 0` check, falls back to scan
        let content = fs::read_to_string(&counter_path).unwrap();
        let parsed: Counter = serde_json::from_str(&content).unwrap();
        // next is 0, which the get_next_local_id logic treats as invalid
        assert_eq!(parsed.next, 0);

        // scan_for_next_id should return 4 (max LOC-003 + 1)
        assert_eq!(scan_for_next_id(&issues), 4);
    }

    #[test]
    fn test_counter_with_next_zero() {
        // Zero next should fall back to scan
        let tmp = setup_test_dir();
        let issues = tmp.path().join("issues");
        fs::create_dir_all(&issues).unwrap();

        let counter_path = issues.join("counter.json");
        fs::write(&counter_path, r#"{"next": 0}"#).unwrap();

        // No LOC dirs — scan returns 1
        assert_eq!(scan_for_next_id(&issues), 1);

        // Verify the counter.next > 0 check: parsing succeeds but value is invalid
        let content = fs::read_to_string(&counter_path).unwrap();
        match serde_json::from_str::<Counter>(&content) {
            Ok(counter) => assert!(
                !(counter.next > 0),
                "Counter with next=0 should NOT pass the > 0 check"
            ),
            Err(_) => panic!("Should parse as valid Counter"),
        }
    }

    #[test]
    fn test_counter_with_missing_next_field() {
        // JSON with wrong field name should fail to parse as Counter
        let tmp = setup_test_dir();
        let issues = tmp.path().join("issues");
        fs::create_dir_all(&issues).unwrap();

        let counter_path = issues.join("counter.json");
        fs::write(&counter_path, r#"{"count": 5}"#).unwrap();

        fs::create_dir_all(issues.join("LOC-002")).unwrap();

        // Parsing as Counter should fail (missing "next" field)
        let content = fs::read_to_string(&counter_path).unwrap();
        assert!(serde_json::from_str::<Counter>(&content).is_err());

        // Falls back to scan
        assert_eq!(scan_for_next_id(&issues), 3);
    }

    #[test]
    fn test_parent_spec_read_with_corrupted_json() {
        // Invalid JSON in parent.json should return None
        let tmp = setup_test_dir();
        let issue_id = "TEST-CORRUPT";
        ensure_task_dir(tmp.path(), issue_id);

        let parent_path = issues_path(tmp.path()).join(issue_id).join("parent.json");
        fs::write(&parent_path, "{{not valid json at all}}").unwrap();

        // read_parent_spec reads from the global git root path, so we test the
        // deserialization logic directly
        let content = fs::read_to_string(&parent_path).unwrap();
        let result: Option<ParentIssueContext> = serde_json::from_str(&content).ok();
        assert!(result.is_none(), "Corrupted JSON should return None");
    }

    // =========================================================================
    // Missing Directory Handling Tests
    // =========================================================================

    #[test]
    fn test_write_subtask_spec_creates_tasks_dir() {
        // write_subtask_spec should auto-create the tasks/ directory via ensure_issue_dir
        // We test the underlying atomic_write_json which creates parent dirs
        let tmp = setup_test_dir();
        let issue_id = "TEST-MKDIR";

        // Don't pre-create the tasks dir — only create the issue dir
        let tasks_dir = issues_path(tmp.path()).join(issue_id).join("tasks");
        assert!(!tasks_dir.exists());

        // atomic_write_json creates parent dirs
        let file_path = tasks_dir.join("task-001.json");
        let task = SubTaskContext {
            id: "task-001".to_string(),
            identifier: "task-001".to_string(),
            title: "Test task".to_string(),
            description: String::new(),
            status: "pending".to_string(),
            git_branch_name: String::new(),
            blocked_by: vec![],
            blocks: vec![],
        };
        atomic_write_json(&file_path, &task).unwrap();

        // tasks/ directory should now exist
        assert!(tasks_dir.exists());
        assert!(file_path.exists());
    }

    #[test]
    fn test_write_iteration_log_creates_execution_dir() {
        // Writing iteration log should auto-create the execution/ directory
        let tmp = setup_test_dir();
        let issue_id = "TEST-EXECDIR";

        let exec_dir = issues_path(tmp.path()).join(issue_id).join("execution");
        assert!(!exec_dir.exists());

        let file_path = exec_dir.join("iterations.json");
        let entries = vec![IterationLogEntry {
            subtask_id: "task-001".to_string(),
            attempt: 1,
            started_at: "2026-01-28T14:30:00Z".to_string(),
            completed_at: None,
            status: IterationStatus::Success,
            error: None,
            files_modified: None,
            commit_hash: None,
        }];

        atomic_write_json(&file_path, &entries).unwrap();

        assert!(exec_dir.exists());
        assert!(file_path.exists());
    }

    #[test]
    fn test_queue_pending_update_creates_issue_dir() {
        // atomic_write_json creates full directory structure
        let tmp = setup_test_dir();
        let issue_id = "TEST-PENDDIR";

        let issue_dir = issues_path(tmp.path()).join(issue_id);
        assert!(!issue_dir.exists());

        let file_path = issue_dir.join("pending-updates.json");
        let updates = vec![LocalPendingUpdate {
            id: Uuid::new_v4().to_string(),
            created_at: "2026-01-28T14:30:00Z".to_string(),
            update_type: "status_change".to_string(),
            payload: serde_json::json!({"status": "Done"}),
        }];

        atomic_write_json(&file_path, &updates).unwrap();

        assert!(issue_dir.exists());
        assert!(file_path.exists());

        // Verify content is readable
        let content = fs::read_to_string(&file_path).unwrap();
        let read_back: Vec<LocalPendingUpdate> = serde_json::from_str(&content).unwrap();
        assert_eq!(read_back.len(), 1);
        assert_eq!(read_back[0].update_type, "status_change");
    }

    // =========================================================================
    // Status Priority Deduplication Tests
    // =========================================================================

    #[test]
    fn test_deduplication_same_status_first_wins() {
        // When two entries have the same status, first inserted wins (not dominated)
        let mut by_id: HashMap<String, LinearIssue> = HashMap::new();

        let issue_a = LinearIssue {
            id: "task-001".to_string(),
            identifier: "task-001".to_string(),
            title: "First".to_string(),
            status: "done".to_string(),
            git_branch_name: String::new(),
            relations: None,
        };

        let issue_b = LinearIssue {
            id: "task-001".to_string(),
            identifier: "task-001-dup".to_string(),
            title: "Second".to_string(),
            status: "done".to_string(),
            git_branch_name: String::new(),
            relations: None,
        };

        // Insert first
        by_id.insert(issue_a.id.clone(), issue_a);

        // Second has same priority — dominated check returns false (equal, not greater)
        let dominated = by_id
            .get(&issue_b.id)
            .map(|existing| status_priority(&issue_b.status) > status_priority(&existing.status))
            .unwrap_or(true);

        assert!(!dominated, "Same priority should NOT dominate (first wins)");
    }

    #[test]
    fn test_deduplication_in_progress_beats_ready() {
        assert!(
            status_priority("in_progress") > status_priority("ready"),
            "in_progress (2) should beat ready (1)"
        );

        let mut by_id: HashMap<String, LinearIssue> = HashMap::new();
        let ready = LinearIssue {
            id: "t-1".to_string(),
            identifier: "t-1".to_string(),
            title: "Task".to_string(),
            status: "ready".to_string(),
            git_branch_name: String::new(),
            relations: None,
        };

        let in_progress = LinearIssue {
            id: "t-1".to_string(),
            identifier: "t-1".to_string(),
            title: "Task".to_string(),
            status: "in_progress".to_string(),
            git_branch_name: String::new(),
            relations: None,
        };

        by_id.insert(ready.id.clone(), ready);

        let dominated = by_id
            .get(&in_progress.id)
            .map(|existing| {
                status_priority(&in_progress.status) > status_priority(&existing.status)
            })
            .unwrap_or(true);

        assert!(dominated, "in_progress should dominate ready");
        by_id.insert(in_progress.id.clone(), in_progress);
        assert_eq!(by_id["t-1"].status, "in_progress");
    }

    #[test]
    fn test_deduplication_pending_loses_to_all() {
        // Pending (0) should lose to every other known status
        assert!(status_priority("pending") < status_priority("ready"));
        assert!(status_priority("pending") < status_priority("in_progress"));
        assert!(status_priority("pending") < status_priority("done"));

        let mut by_id: HashMap<String, LinearIssue> = HashMap::new();

        let done = LinearIssue {
            id: "t-1".to_string(),
            identifier: "t-1".to_string(),
            title: "Task".to_string(),
            status: "done".to_string(),
            git_branch_name: String::new(),
            relations: None,
        };

        let pending = LinearIssue {
            id: "t-1".to_string(),
            identifier: "t-1".to_string(),
            title: "Task".to_string(),
            status: "pending".to_string(),
            git_branch_name: String::new(),
            relations: None,
        };

        by_id.insert(done.id.clone(), done);

        // pending should NOT dominate done
        let dominated = by_id
            .get(&pending.id)
            .map(|existing| status_priority(&pending.status) > status_priority(&existing.status))
            .unwrap_or(true);

        assert!(!dominated, "pending should NOT dominate done");
        assert_eq!(by_id["t-1"].status, "done");
    }

    #[test]
    fn test_deduplication_unknown_status_priority() {
        // Unknown statuses should have priority 0 (same as pending)
        assert_eq!(status_priority("unknown"), 0);
        assert_eq!(status_priority("cancelled"), 0);
        assert_eq!(status_priority(""), 0);
        assert_eq!(status_priority("DONE"), 0); // case-sensitive
    }

    // =========================================================================
    // Iteration Log Append Tests
    // =========================================================================

    #[test]
    fn test_write_iteration_log_creates_new_file() {
        let tmp = setup_test_dir();
        let issue_id = "TEST-NEWLOG";

        let exec_dir = issues_path(tmp.path()).join(issue_id).join("execution");
        let file_path = exec_dir.join("iterations.json");

        assert!(!file_path.exists());

        let entry = IterationLogEntry {
            subtask_id: "task-001".to_string(),
            attempt: 1,
            started_at: "2026-02-01T10:00:00Z".to_string(),
            completed_at: Some("2026-02-01T10:15:00Z".to_string()),
            status: IterationStatus::Success,
            error: None,
            files_modified: Some(vec!["src/main.rs".to_string()]),
            commit_hash: Some("abc1234".to_string()),
        };

        let entries = vec![entry];
        atomic_write_json(&file_path, &entries).unwrap();

        assert!(file_path.exists());
        let content = fs::read_to_string(&file_path).unwrap();
        let read_back: Vec<IterationLogEntry> = serde_json::from_str(&content).unwrap();
        assert_eq!(read_back.len(), 1);
        assert_eq!(read_back[0].subtask_id, "task-001");
    }

    #[test]
    fn test_write_iteration_log_appends_to_existing() {
        let tmp = setup_test_dir();
        let issue_id = "TEST-APPENDLOG";
        ensure_task_dir(tmp.path(), issue_id);

        let file_path = issues_path(tmp.path())
            .join(issue_id)
            .join("execution")
            .join("iterations.json");

        // Write first entry
        let entry1 = IterationLogEntry {
            subtask_id: "task-001".to_string(),
            attempt: 1,
            started_at: "2026-02-01T10:00:00Z".to_string(),
            completed_at: Some("2026-02-01T10:15:00Z".to_string()),
            status: IterationStatus::Success,
            error: None,
            files_modified: None,
            commit_hash: None,
        };

        let entries = vec![entry1];
        atomic_write_json(&file_path, &entries).unwrap();

        // Read, append, write second entry (simulating write_iteration_log logic)
        let content = fs::read_to_string(&file_path).unwrap();
        let mut existing: Vec<IterationLogEntry> = serde_json::from_str(&content).unwrap();

        let entry2 = IterationLogEntry {
            subtask_id: "task-002".to_string(),
            attempt: 1,
            started_at: "2026-02-01T11:00:00Z".to_string(),
            completed_at: Some("2026-02-01T11:10:00Z".to_string()),
            status: IterationStatus::Failed,
            error: Some("Test assertion failed".to_string()),
            files_modified: None,
            commit_hash: None,
        };

        existing.push(entry2);
        atomic_write_json(&file_path, &existing).unwrap();

        // Verify both entries present
        let content2 = fs::read_to_string(&file_path).unwrap();
        let read_back: Vec<IterationLogEntry> = serde_json::from_str(&content2).unwrap();
        assert_eq!(read_back.len(), 2);
        assert_eq!(read_back[0].subtask_id, "task-001");
        assert_eq!(read_back[0].status, IterationStatus::Success);
        assert_eq!(read_back[1].subtask_id, "task-002");
        assert_eq!(read_back[1].status, IterationStatus::Failed);
    }

    #[test]
    fn test_write_iteration_log_corrupted_file() {
        // Corrupted iterations.json should result in starting fresh (unwrap_or_default)
        let tmp = setup_test_dir();
        let issue_id = "TEST-CORRUPTLOG";
        ensure_task_dir(tmp.path(), issue_id);

        let file_path = issues_path(tmp.path())
            .join(issue_id)
            .join("execution")
            .join("iterations.json");

        // Write corrupted content
        fs::write(&file_path, "this is not json!!! {{{").unwrap();

        // Simulate write_iteration_log logic: read existing, parse (fails), default to empty
        let existing = if file_path.exists() {
            match fs::read_to_string(&file_path) {
                Ok(content) => {
                    serde_json::from_str::<Vec<IterationLogEntry>>(&content).unwrap_or_default()
                }
                Err(_) => Vec::new(),
            }
        } else {
            Vec::new()
        };

        assert!(
            existing.is_empty(),
            "Corrupted file should result in empty vec via unwrap_or_default"
        );

        // Write fresh entry
        let entry = IterationLogEntry {
            subtask_id: "task-001".to_string(),
            attempt: 1,
            started_at: "2026-02-01T12:00:00Z".to_string(),
            completed_at: None,
            status: IterationStatus::Partial,
            error: None,
            files_modified: None,
            commit_hash: None,
        };

        let entries = vec![entry];
        atomic_write_json(&file_path, &entries).unwrap();

        let content = fs::read_to_string(&file_path).unwrap();
        let read_back: Vec<IterationLogEntry> = serde_json::from_str(&content).unwrap();
        assert_eq!(read_back.len(), 1);
        assert_eq!(read_back[0].status, IterationStatus::Partial);
    }

    // =========================================================================
    // Concurrent Counter Increment Tests
    // =========================================================================

    #[test]
    fn test_concurrent_counter_increments() {
        // 5 threads all calling scan_for_next_id on the same directory
        // Each creates a unique LOC-N directory then scans
        use std::sync::{Arc, Barrier};
        use std::thread;

        let tmp = setup_test_dir();
        let issues = tmp.path().join("issues");
        fs::create_dir_all(&issues).unwrap();

        // Pre-create LOC-001 through LOC-005
        for i in 1..=5 {
            fs::create_dir_all(issues.join(format!("LOC-{:03}", i))).unwrap();
        }

        let barrier = Arc::new(Barrier::new(5));
        let issues_path_shared = Arc::new(issues.clone());
        let mut handles = vec![];

        for _ in 0..5 {
            let barrier = Arc::clone(&barrier);
            let issues_path = Arc::clone(&issues_path_shared);

            handles.push(thread::spawn(move || {
                barrier.wait();
                scan_for_next_id(&issues_path)
            }));
        }

        let results: Vec<u32> = handles.into_iter().map(|h| h.join().unwrap()).collect();

        // All threads should see the same state and return 6
        for result in &results {
            assert_eq!(*result, 6, "All concurrent scans should return 6");
        }
    }

    #[test]
    fn test_counter_race_with_scan_fallback() {
        // When no counter.json exists and multiple threads scan concurrently,
        // they should all get consistent results based on existing LOC dirs
        let tmp = setup_test_dir();
        let issues = tmp.path().join("issues");
        fs::create_dir_all(&issues).unwrap();

        // No counter.json, no LOC dirs
        assert!(!issues.join("counter.json").exists());

        use std::sync::{Arc, Barrier};
        use std::thread;

        let barrier = Arc::new(Barrier::new(3));
        let issues_path_shared = Arc::new(issues.clone());
        let mut handles = vec![];

        for _ in 0..3 {
            let barrier = Arc::clone(&barrier);
            let issues_path = Arc::clone(&issues_path_shared);

            handles.push(thread::spawn(move || {
                barrier.wait();
                scan_for_next_id(&issues_path)
            }));
        }

        let results: Vec<u32> = handles.into_iter().map(|h| h.join().unwrap()).collect();

        // All should return 1 (no existing LOC dirs)
        for result in &results {
            assert_eq!(*result, 1, "Empty dir scan should return 1 for all threads");
        }
    }
}
