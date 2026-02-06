//! Context generator for issue management.
//!
//! Manages issue context generation, runtime state with file locking,
//! session management, pending updates with deduplication, and file watching.
//!
//! Ported from context-generator.ts (1,676 lines).

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{bail, Context as AnyhowContext, Result};
use chrono::Utc;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use regex::Regex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::local_state::{
    self, get_project_mobius_path, read_parent_spec, read_subtasks, write_parent_spec,
    write_subtask_spec,
};
use crate::types::config::SubTaskVerifyCommand;
use crate::types::context::{
    BackendStatusEntry, ContextMetadata, IssueContext, PendingUpdate, PendingUpdateData,
    PendingUpdatesQueue, RuntimeActiveTask, RuntimeCompletedTask, RuntimeState, SessionInfo,
    SubTaskContext,
};
use crate::types::enums::{Backend, SessionStatus};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Maximum time to wait for runtime state lock acquisition (ms).
const LOCK_TIMEOUT_MS: u64 = 5000;

/// Sleep interval between lock acquisition attempts (ms).
const LOCK_RETRY_INTERVAL_MS: u64 = 10;

/// Debounce timeout for file watcher events (ms).
const DEBOUNCE_MS: u64 = 150;

/// Maximum age for context freshness check (default 5 minutes).
const DEFAULT_MAX_AGE_MS: u64 = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/// Get the project-local .mobius/ base path.
pub fn get_mobius_base_path() -> PathBuf {
    get_project_mobius_path()
}

/// Get the path to a specific issue's context directory.
pub fn get_context_path(parent_id: &str) -> PathBuf {
    get_mobius_base_path().join("issues").join(parent_id)
}

/// Get the path to a parent issue's parent.json.
pub fn get_parent_context_path(parent_id: &str) -> PathBuf {
    get_context_path(parent_id).join("parent.json")
}

/// Get the path to the tasks directory for a parent issue.
pub fn get_tasks_directory_path(parent_id: &str) -> PathBuf {
    get_context_path(parent_id).join("tasks")
}

/// Get the path to a specific task's JSON file.
pub fn get_task_context_path(parent_id: &str, task_identifier: &str) -> PathBuf {
    get_tasks_directory_path(parent_id).join(format!("{}.json", task_identifier))
}

/// Get the path to pending-updates.json for a parent issue.
pub fn get_pending_updates_path(parent_id: &str) -> PathBuf {
    get_context_path(parent_id).join("pending-updates.json")
}

/// Get the path to sync-log.json for a parent issue.
pub fn get_sync_log_path(parent_id: &str) -> PathBuf {
    get_context_path(parent_id).join("sync-log.json")
}

/// Get the path to the full context.json file.
pub fn get_full_context_path(parent_id: &str) -> PathBuf {
    get_context_path(parent_id).join("context.json")
}

/// Get the path to the execution directory for a parent issue.
pub fn get_execution_path(parent_id: &str) -> PathBuf {
    get_context_path(parent_id).join("execution")
}

/// Get the path to session.json.
pub fn get_session_path(parent_id: &str) -> PathBuf {
    get_execution_path(parent_id).join("session.json")
}

/// Get the path to runtime.json.
pub fn get_runtime_path(parent_id: &str) -> PathBuf {
    get_execution_path(parent_id).join("runtime.json")
}

/// Get the path to the current-session pointer file.
pub fn get_current_session_pointer_path() -> PathBuf {
    get_mobius_base_path().join("current-session")
}

// ---------------------------------------------------------------------------
// Directory management
// ---------------------------------------------------------------------------

/// Ensure all context directories exist for a parent issue.
pub fn ensure_context_directories(parent_id: &str) -> Result<()> {
    local_state::ensure_project_mobius_dir()?;
    let ctx_path = get_context_path(parent_id);
    fs::create_dir_all(ctx_path.join("tasks"))
        .with_context(|| format!("Failed to create tasks dir for {}", parent_id))?;
    fs::create_dir_all(ctx_path.join("execution"))
        .with_context(|| format!("Failed to create execution dir for {}", parent_id))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Verify command extraction
// ---------------------------------------------------------------------------

/// Extract verify commands from sub-task descriptions.
///
/// Scans each sub-task for a `### Verify Command` section with a bash code block
/// and returns the extracted commands.
pub fn extract_verify_commands(sub_tasks: &[SubTaskContext]) -> Vec<SubTaskVerifyCommand> {
    let pattern =
        Regex::new(r"(?i)###\s+Verify\s+Command\s*\n\s*```bash\s*\n([\s\S]*?)\n\s*```").unwrap();

    sub_tasks
        .iter()
        .filter_map(|task| {
            if task.description.is_empty() {
                return None;
            }
            let caps = pattern.captures(&task.description)?;
            let command = caps.get(1)?.as_str().trim().to_string();
            if command.is_empty() {
                return None;
            }

            let subtask_id = if task.identifier.is_empty() {
                task.id.clone()
            } else {
                task.identifier.clone()
            };

            Some(SubTaskVerifyCommand {
                subtask_id,
                title: task.title.clone(),
                command,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Context I/O
// ---------------------------------------------------------------------------

/// Write the full context.json file atomically.
///
/// Returns the path to the written file.
pub fn write_full_context_file(parent_identifier: &str, context: &IssueContext) -> Result<String> {
    ensure_context_directories(parent_identifier)?;
    let path = get_full_context_path(parent_identifier);
    atomic_write_json(&path, context)?;
    Ok(path.to_string_lossy().to_string())
}

/// Read the full context from context.json.
pub fn read_context(parent_identifier: &str) -> Option<IssueContext> {
    let path = get_full_context_path(parent_identifier);
    let content = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Check if a context.json file exists for the given parent.
pub fn context_exists(parent_identifier: &str) -> bool {
    get_full_context_path(parent_identifier).exists()
}

/// Check if the context is still fresh (not older than max_age_ms).
pub fn is_context_fresh(parent_identifier: &str, max_age_ms: Option<u64>) -> bool {
    let max_age = max_age_ms.unwrap_or(DEFAULT_MAX_AGE_MS);
    let path = get_full_context_path(parent_identifier);
    match fs::metadata(&path) {
        Ok(meta) => match meta.modified() {
            Ok(modified) => {
                let age = modified
                    .elapsed()
                    .unwrap_or(Duration::from_millis(max_age + 1));
                age.as_millis() < max_age as u128
            }
            Err(_) => false,
        },
        Err(_) => false,
    }
}

/// Clean up all context files for a parent issue.
pub fn cleanup_context(parent_identifier: &str) {
    let ctx_path = get_context_path(parent_identifier);
    let _ = fs::remove_dir_all(&ctx_path);
}

/// Update a single task's context file.
pub fn update_task_context(parent_identifier: &str, task: &SubTaskContext) -> Result<()> {
    write_subtask_spec(parent_identifier, task)
}

/// Detect the backend from project configuration.
///
/// Checks local config first, then global config, defaults to Linear.
pub fn detect_backend(project_path: Option<&str>) -> Backend {
    // Try reading config from project path
    if let Some(path) = project_path {
        let config_path = Path::new(path).join("mobius.config.yaml");
        if let Ok(content) = fs::read_to_string(&config_path) {
            if let Ok(config) = serde_yaml::from_str::<serde_json::Value>(&content) {
                if let Some(backend_str) = config.get("backend").and_then(|v| v.as_str()) {
                    if let Ok(backend) = backend_str.parse::<Backend>() {
                        return backend;
                    }
                }
            }
        }
    }

    // Try global config
    if let Some(config_dir) = dirs::config_dir() {
        let global_config = config_dir.join("mobius").join("config.yaml");
        if let Ok(content) = fs::read_to_string(&global_config) {
            if let Ok(config) = serde_yaml::from_str::<serde_json::Value>(&content) {
                if let Some(backend_str) = config.get("backend").and_then(|v| v.as_str()) {
                    if let Ok(backend) = backend_str.parse::<Backend>() {
                        return backend;
                    }
                }
            }
        }
    }

    Backend::Linear
}

/// Generate or refresh the issue context.
///
/// Fetches parent from backend (or local), reads sub-tasks from local state,
/// detects project info, extracts verify commands, writes all context files.
pub fn generate_context(
    parent_identifier: &str,
    project_path: Option<&str>,
    _force_refresh: bool,
) -> Result<Option<IssueContext>> {
    let backend = detect_backend(project_path);
    let now = Utc::now().to_rfc3339();

    // Fetch parent context
    // For linear/jira backends, we'd call the respective API clients.
    // For local or as fallback, read from local state.
    let parent_context = match backend {
        Backend::Local => read_parent_spec(parent_identifier),
        Backend::Linear => {
            let rt = tokio::runtime::Runtime::new().ok();
            let fetched = rt.and_then(|rt| {
                rt.block_on(async {
                    let client = crate::linear::LinearClient::new().ok()?;
                    let issue = client.fetch_linear_issue(parent_identifier).await.ok()?;
                    Some(crate::types::context::ParentIssueContext {
                        id: issue.id,
                        identifier: issue.identifier,
                        title: issue.title,
                        status: String::new(),
                        git_branch_name: issue.git_branch_name,
                        description: String::new(),
                        labels: vec![],
                        url: String::new(),
                    })
                })
            });
            fetched.or_else(|| read_parent_spec(parent_identifier))
        }
        Backend::Jira => {
            let rt = tokio::runtime::Runtime::new().ok();
            let fetched = rt.and_then(|rt| {
                rt.block_on(async {
                    let client = crate::jira::JiraClient::new().ok()?;
                    let issue = client.fetch_jira_issue(parent_identifier).await.ok()?;
                    Some(crate::types::context::ParentIssueContext {
                        id: issue.id,
                        identifier: issue.identifier,
                        title: issue.title,
                        status: String::new(),
                        git_branch_name: issue.git_branch_name,
                        description: String::new(),
                        labels: vec![],
                        url: String::new(),
                    })
                })
            });
            fetched.or_else(|| read_parent_spec(parent_identifier))
        }
    };

    // Read sub-tasks from local state
    let sub_tasks = read_subtasks(parent_identifier);

    // If parent not found, return None
    let parent_context = match parent_context {
        Some(p) => p,
        None => return Ok(None),
    };

    // Extract verify commands from sub-task descriptions
    let verify_commands = extract_verify_commands(&sub_tasks);

    // Ensure directories exist
    ensure_context_directories(parent_identifier)?;

    // Build metadata
    let metadata = ContextMetadata {
        fetched_at: now.clone(),
        updated_at: now,
        backend,
        synced_at: None,
    };

    // Build full context
    let context = IssueContext {
        parent: parent_context.clone(),
        sub_tasks: sub_tasks.clone(),
        metadata,
        project_info: None,
        sub_task_verify_commands: if verify_commands.is_empty() {
            None
        } else {
            Some(verify_commands)
        },
    };

    // Write parent.json
    write_parent_spec(parent_identifier, &parent_context)?;

    // Write individual task files
    for task in &sub_tasks {
        let identifier = if task.identifier.is_empty() {
            &task.id
        } else {
            &task.identifier
        };
        if !identifier.is_empty() {
            write_subtask_spec(parent_identifier, task)?;
        }
    }

    // Initialize pending-updates.json if not exists
    let pending_path = get_pending_updates_path(parent_identifier);
    if !pending_path.exists() {
        let empty_queue = PendingUpdatesQueue {
            updates: vec![],
            last_sync_attempt: None,
            last_sync_success: None,
        };
        atomic_write_json(&pending_path, &empty_queue)?;
    }

    // Initialize sync-log.json if not exists
    let sync_log_path = get_sync_log_path(parent_identifier);
    if !sync_log_path.exists() {
        #[derive(Serialize)]
        struct EmptySyncLog {
            entries: Vec<()>,
        }
        atomic_write_json(&sync_log_path, &EmptySyncLog { entries: vec![] })?;
    }

    // Write full context.json
    write_full_context_file(parent_identifier, &context)?;

    Ok(Some(context))
}

// ---------------------------------------------------------------------------
// Pending updates management
// ---------------------------------------------------------------------------

/// Input type for queueing a pending update.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PendingUpdateInput {
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

/// Check if an existing pending update is a duplicate of the incoming one.
fn is_duplicate_update(existing: &PendingUpdate, incoming: &PendingUpdateInput) -> bool {
    match (&existing.data, incoming) {
        (
            PendingUpdateData::StatusChange {
                issue_id: e_id,
                old_status: e_old,
                new_status: e_new,
                ..
            },
            PendingUpdateInput::StatusChange {
                issue_id: i_id,
                old_status: i_old,
                new_status: i_new,
                ..
            },
        ) => e_id == i_id && e_old == i_old && e_new == i_new,

        (
            PendingUpdateData::AddComment {
                issue_id: e_id,
                body: e_body,
                ..
            },
            PendingUpdateInput::AddComment {
                issue_id: i_id,
                body: i_body,
                ..
            },
        ) => e_id == i_id && e_body == i_body,

        (
            PendingUpdateData::CreateSubtask {
                parent_id: e_pid,
                title: e_title,
                description: e_desc,
                ..
            },
            PendingUpdateInput::CreateSubtask {
                parent_id: i_pid,
                title: i_title,
                description: i_desc,
                ..
            },
        ) => e_pid == i_pid && e_title == i_title && e_desc == i_desc,

        (
            PendingUpdateData::UpdateDescription {
                issue_id: e_id,
                description: e_desc,
                ..
            },
            PendingUpdateInput::UpdateDescription {
                issue_id: i_id,
                description: i_desc,
                ..
            },
        ) => e_id == i_id && e_desc == i_desc,

        (
            PendingUpdateData::AddLabel {
                issue_id: e_id,
                label: e_label,
                ..
            },
            PendingUpdateInput::AddLabel {
                issue_id: i_id,
                label: i_label,
                ..
            },
        ) => e_id == i_id && e_label == i_label,

        (
            PendingUpdateData::RemoveLabel {
                issue_id: e_id,
                label: e_label,
                ..
            },
            PendingUpdateInput::RemoveLabel {
                issue_id: i_id,
                label: i_label,
                ..
            },
        ) => e_id == i_id && e_label == i_label,

        _ => false,
    }
}

/// Convert a PendingUpdateInput into PendingUpdateData.
fn input_to_data(input: &PendingUpdateInput) -> PendingUpdateData {
    match input {
        PendingUpdateInput::StatusChange {
            issue_id,
            identifier,
            old_status,
            new_status,
        } => PendingUpdateData::StatusChange {
            issue_id: issue_id.clone(),
            identifier: identifier.clone(),
            old_status: old_status.clone(),
            new_status: new_status.clone(),
        },
        PendingUpdateInput::AddComment {
            issue_id,
            identifier,
            body,
        } => PendingUpdateData::AddComment {
            issue_id: issue_id.clone(),
            identifier: identifier.clone(),
            body: body.clone(),
        },
        PendingUpdateInput::CreateSubtask {
            parent_id,
            title,
            description,
            blocked_by,
        } => PendingUpdateData::CreateSubtask {
            parent_id: parent_id.clone(),
            title: title.clone(),
            description: description.clone(),
            blocked_by: blocked_by.clone(),
        },
        PendingUpdateInput::UpdateDescription {
            issue_id,
            identifier,
            description,
        } => PendingUpdateData::UpdateDescription {
            issue_id: issue_id.clone(),
            identifier: identifier.clone(),
            description: description.clone(),
        },
        PendingUpdateInput::AddLabel {
            issue_id,
            identifier,
            label,
        } => PendingUpdateData::AddLabel {
            issue_id: issue_id.clone(),
            identifier: identifier.clone(),
            label: label.clone(),
        },
        PendingUpdateInput::RemoveLabel {
            issue_id,
            identifier,
            label,
        } => PendingUpdateData::RemoveLabel {
            issue_id: issue_id.clone(),
            identifier: identifier.clone(),
            label: label.clone(),
        },
    }
}

/// Read pending updates queue from disk.
pub fn read_pending_updates(parent_identifier: &str) -> PendingUpdatesQueue {
    let path = get_pending_updates_path(parent_identifier);
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or(PendingUpdatesQueue {
            updates: vec![],
            last_sync_attempt: None,
            last_sync_success: None,
        }),
        Err(_) => PendingUpdatesQueue {
            updates: vec![],
            last_sync_attempt: None,
            last_sync_success: None,
        },
    }
}

/// Write pending updates queue to disk.
pub fn write_pending_updates(parent_identifier: &str, queue: &PendingUpdatesQueue) -> Result<()> {
    let path = get_pending_updates_path(parent_identifier);
    atomic_write_json(&path, queue)
}

/// Queue a pending update with deduplication.
///
/// Only unsynced updates (no `synced_at` and no `error`) block duplicates.
/// Once an update is synced or errored, new equivalent updates are allowed.
pub fn queue_pending_update(parent_identifier: &str, update: &PendingUpdateInput) -> Result<()> {
    ensure_context_directories(parent_identifier)?;
    let mut queue = read_pending_updates(parent_identifier);

    // Check for duplicates among unsynced, non-errored updates
    let is_dup = queue.updates.iter().any(|existing| {
        existing.synced_at.is_none()
            && existing.error.is_none()
            && is_duplicate_update(existing, update)
    });

    if is_dup {
        return Ok(());
    }

    let new_update = PendingUpdate {
        id: Uuid::new_v4().to_string(),
        created_at: Utc::now().to_rfc3339(),
        synced_at: None,
        error: None,
        data: input_to_data(update),
    };

    queue.updates.push(new_update);
    write_pending_updates(parent_identifier, &queue)
}

/// Get the count of unsynced pending updates.
pub fn get_pending_updates_count(parent_identifier: &str) -> usize {
    let queue = read_pending_updates(parent_identifier);
    queue
        .updates
        .iter()
        .filter(|u| u.synced_at.is_none() && u.error.is_none())
        .count()
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/// Read session info from disk.
pub fn read_session(parent_id: &str) -> Option<SessionInfo> {
    let path = get_session_path(parent_id);
    let content = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Write session info to disk.
pub fn write_session(parent_id: &str, session: &SessionInfo) -> Result<()> {
    let path = get_session_path(parent_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    atomic_write_json(&path, session)
}

/// Create a new session.
pub fn create_session(
    parent_id: &str,
    backend: Backend,
    worktree_path: Option<&str>,
) -> Result<SessionInfo> {
    ensure_context_directories(parent_id)?;
    let session = SessionInfo {
        parent_id: parent_id.to_string(),
        backend,
        started_at: Utc::now().to_rfc3339(),
        worktree_path: worktree_path.map(|s| s.to_string()),
        status: SessionStatus::Active,
    };
    write_session(parent_id, &session)?;
    set_current_session_pointer(parent_id)?;
    Ok(session)
}

/// Update an existing session with partial fields.
pub fn update_session(
    parent_id: &str,
    status: Option<SessionStatus>,
    worktree_path: Option<String>,
) -> Option<SessionInfo> {
    let mut session = read_session(parent_id)?;
    if let Some(s) = status {
        session.status = s;
    }
    if let Some(wp) = worktree_path {
        session.worktree_path = Some(wp);
    }
    write_session(parent_id, &session).ok()?;
    Some(session)
}

/// End a session with a final status.
pub fn end_session(parent_id: &str, status: SessionStatus) {
    let _ = update_session(parent_id, Some(status), None);
    clear_current_session_pointer(parent_id);
}

/// Delete a session entirely.
pub fn delete_session(parent_id: &str) {
    let path = get_session_path(parent_id);
    let _ = fs::remove_file(&path);
    clear_current_session_pointer(parent_id);
}

/// Set the current-session pointer to a parent ID.
pub fn set_current_session_pointer(parent_id: &str) -> Result<()> {
    local_state::ensure_project_mobius_dir()?;
    let path = get_current_session_pointer_path();
    fs::write(&path, parent_id).with_context(|| {
        format!(
            "Failed to write current-session pointer: {}",
            path.display()
        )
    })?;
    Ok(())
}

/// Get the current session's parent ID from the pointer file.
pub fn get_current_session_parent_id() -> Option<String> {
    let path = get_current_session_pointer_path();
    let content = fs::read_to_string(&path).ok()?;
    let parent_id = content.trim().to_string();
    if parent_id.is_empty() {
        return None;
    }
    // Verify session still exists
    if read_session(&parent_id).is_some() {
        Some(parent_id)
    } else {
        None
    }
}

/// Clear the current-session pointer (only if it matches the given parent ID).
pub fn clear_current_session_pointer(parent_id: &str) {
    if let Some(current) = get_current_session_parent_id_raw() {
        if current == parent_id {
            let path = get_current_session_pointer_path();
            let _ = fs::remove_file(&path);
        }
    }
}

/// Read the raw current-session pointer without validation.
fn get_current_session_parent_id_raw() -> Option<String> {
    let path = get_current_session_pointer_path();
    let content = fs::read_to_string(&path).ok()?;
    let trimmed = content.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

/// Resolve task ID from provided ID or current session.
pub fn resolve_task_id(provided_id: Option<&str>) -> Option<String> {
    if let Some(id) = provided_id {
        Some(id.to_string())
    } else {
        get_current_session_parent_id()
    }
}

/// Resolve both task ID and backend.
pub fn resolve_task_context(
    provided_id: Option<&str>,
    provided_backend: Option<Backend>,
) -> (Option<String>, Option<Backend>) {
    let task_id = resolve_task_id(provided_id);
    if provided_backend.is_some() {
        return (task_id, provided_backend);
    }
    let backend = task_id.as_deref().and_then(read_session).map(|s| s.backend);
    (task_id, backend)
}

// ---------------------------------------------------------------------------
// Runtime state management
// ---------------------------------------------------------------------------

/// Read runtime state from disk.
pub fn read_runtime_state(parent_id: &str) -> Option<RuntimeState> {
    let path = get_runtime_path(parent_id);
    let content = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Write runtime state to disk.
pub fn write_runtime_state(state: &RuntimeState) -> Result<()> {
    let path = get_runtime_path(&state.parent_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    atomic_write_json(&path, state)
}

/// Atomically read-modify-write runtime state with file locking.
///
/// Acquires a `.lock` file (5s timeout, 10ms retry interval), reads the current
/// state, applies the mutation, writes the result, and releases the lock.
pub fn with_runtime_state_sync<F>(parent_id: &str, mutate: F) -> Result<RuntimeState>
where
    F: FnOnce(Option<RuntimeState>) -> RuntimeState,
{
    ensure_context_directories(parent_id)?;
    let lock_path = get_runtime_path(parent_id).with_extension("json.lock");
    let start = Instant::now();

    loop {
        if try_acquire_lock(&lock_path) {
            let current_state = read_runtime_state(parent_id);
            let new_state = mutate(current_state);
            let write_result = write_runtime_state(&new_state);
            release_lock(&lock_path);
            write_result?;
            return Ok(new_state);
        }

        if start.elapsed() > Duration::from_millis(LOCK_TIMEOUT_MS) {
            bail!(
                "Timeout acquiring runtime state lock after {}ms",
                LOCK_TIMEOUT_MS
            );
        }

        thread::sleep(Duration::from_millis(LOCK_RETRY_INTERVAL_MS));
    }
}

/// Initialize runtime state for a new execution session.
pub fn initialize_runtime_state(
    parent_id: &str,
    parent_title: &str,
    loop_pid: Option<u32>,
    total_tasks: Option<u32>,
) -> Result<RuntimeState> {
    with_runtime_state_sync(parent_id, |_| RuntimeState {
        parent_id: parent_id.to_string(),
        parent_title: parent_title.to_string(),
        active_tasks: vec![],
        completed_tasks: vec![],
        failed_tasks: vec![],
        started_at: Utc::now().to_rfc3339(),
        updated_at: Utc::now().to_rfc3339(),
        loop_pid,
        total_tasks,
        backend_statuses: None,
        total_input_tokens: None,
        total_output_tokens: None,
    })
}

/// Add an active task to runtime state.
pub fn add_runtime_active_task(state: &RuntimeState, task: RuntimeActiveTask) -> RuntimeState {
    let mut new_state = state.clone();
    // Remove existing entry for same ID if present
    new_state.active_tasks.retain(|t| t.id != task.id);
    new_state.active_tasks.push(task);
    new_state.updated_at = Utc::now().to_rfc3339();
    new_state
}

/// Mark a task as completed in runtime state.
pub fn complete_runtime_task(state: &RuntimeState, task_id: &str) -> RuntimeState {
    let mut new_state = state.clone();
    // Find and remove from active tasks
    if let Some(pos) = new_state.active_tasks.iter().position(|t| t.id == task_id) {
        let active = new_state.active_tasks.remove(pos);
        let completed = RuntimeCompletedTask {
            id: active.id,
            completed_at: Utc::now().to_rfc3339(),
            duration: 0, // Approximate; can be calculated from started_at
            input_tokens: None,
            output_tokens: None,
        };
        new_state
            .completed_tasks
            .push(serde_json::to_value(completed).unwrap_or_default());
    }
    new_state.updated_at = Utc::now().to_rfc3339();
    new_state
}

/// Mark a task as failed in runtime state.
pub fn fail_runtime_task(state: &RuntimeState, task_id: &str) -> RuntimeState {
    let mut new_state = state.clone();
    if let Some(pos) = new_state.active_tasks.iter().position(|t| t.id == task_id) {
        let active = new_state.active_tasks.remove(pos);
        new_state
            .failed_tasks
            .push(serde_json::to_value(&active).unwrap_or_default());
    }
    new_state.updated_at = Utc::now().to_rfc3339();
    new_state
}

/// Remove an active task from runtime state without marking it completed or failed.
pub fn remove_runtime_active_task(state: &RuntimeState, task_id: &str) -> RuntimeState {
    let mut new_state = state.clone();
    new_state.active_tasks.retain(|t| t.id != task_id);
    new_state.updated_at = Utc::now().to_rfc3339();
    new_state
}

/// Update the pane ID for an active task.
pub fn update_runtime_task_pane(
    state: &RuntimeState,
    task_id: &str,
    pane_id: &str,
) -> RuntimeState {
    let mut new_state = state.clone();
    if let Some(task) = new_state.active_tasks.iter_mut().find(|t| t.id == task_id) {
        task.pane = pane_id.to_string();
    }
    new_state.updated_at = Utc::now().to_rfc3339();
    new_state
}

/// Clear all active tasks from runtime state.
pub fn clear_all_runtime_active_tasks(parent_id: &str) -> Option<RuntimeState> {
    with_runtime_state_sync(parent_id, |state| {
        let mut s = state.unwrap_or(RuntimeState {
            parent_id: parent_id.to_string(),
            parent_title: String::new(),
            active_tasks: vec![],
            completed_tasks: vec![],
            failed_tasks: vec![],
            started_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
            loop_pid: None,
            total_tasks: None,
            backend_statuses: None,
            total_input_tokens: None,
            total_output_tokens: None,
        });
        s.active_tasks.clear();
        s.updated_at = Utc::now().to_rfc3339();
        s
    })
    .ok()
}

/// Delete runtime state file.
pub fn delete_runtime_state(parent_id: &str) -> bool {
    let path = get_runtime_path(parent_id);
    fs::remove_file(&path).is_ok()
}

/// Update backend status for a specific task identifier.
pub fn update_backend_status(parent_id: &str, task_identifier: &str, status: &str) {
    let _ = with_runtime_state_sync(parent_id, |state| {
        let mut s = state.unwrap_or(RuntimeState {
            parent_id: parent_id.to_string(),
            parent_title: String::new(),
            active_tasks: vec![],
            completed_tasks: vec![],
            failed_tasks: vec![],
            started_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
            loop_pid: None,
            total_tasks: None,
            backend_statuses: None,
            total_input_tokens: None,
            total_output_tokens: None,
        });
        let statuses = s.backend_statuses.get_or_insert_with(HashMap::new);
        statuses.insert(
            task_identifier.to_string(),
            BackendStatusEntry {
                identifier: task_identifier.to_string(),
                status: status.to_string(),
                synced_at: Utc::now().to_rfc3339(),
            },
        );
        s.updated_at = Utc::now().to_rfc3339();
        s
    });
}

/// Normalize a completed task entry (handle both string and RuntimeCompletedTask formats).
pub fn normalize_completed_task(entry: &serde_json::Value) -> RuntimeCompletedTask {
    if let Some(s) = entry.as_str() {
        RuntimeCompletedTask {
            id: s.to_string(),
            completed_at: String::new(),
            duration: 0,
            input_tokens: None,
            output_tokens: None,
        }
    } else {
        serde_json::from_value(entry.clone()).unwrap_or(RuntimeCompletedTask {
            id: String::new(),
            completed_at: String::new(),
            duration: 0,
            input_tokens: None,
            output_tokens: None,
        })
    }
}

/// Get the task ID from a completed task entry.
pub fn get_completed_task_id(entry: &serde_json::Value) -> String {
    if let Some(s) = entry.as_str() {
        s.to_string()
    } else if let Some(obj) = entry.as_object() {
        obj.get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    } else {
        String::new()
    }
}

/// Check if a process is still running.
pub fn is_process_running(pid: u32) -> bool {
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}

/// Filter active tasks to only those with running processes.
pub fn filter_running_tasks(active_tasks: &[RuntimeActiveTask]) -> Vec<RuntimeActiveTask> {
    active_tasks
        .iter()
        .filter(|task| is_process_running(task.pid))
        .cloned()
        .collect()
}

/// Progress summary for display.
#[derive(Debug, Clone)]
pub struct ProgressSummary {
    pub total: u32,
    pub completed: usize,
    pub active: usize,
    pub failed: usize,
    pub is_complete: bool,
}

/// Execution summary for modal/exit display.
#[derive(Debug, Clone)]
pub struct ExecutionSummary {
    pub completed: usize,
    pub failed: usize,
    pub active: usize,
    pub total: u32,
    pub is_complete: bool,
    pub elapsed_ms: u64,
}

/// Get a progress summary from runtime state.
pub fn get_progress_summary(state: Option<&RuntimeState>) -> ProgressSummary {
    match state {
        Some(s) => {
            let completed = s.completed_tasks.len();
            let active = s.active_tasks.len();
            let failed = s.failed_tasks.len();
            ProgressSummary {
                total: s.total_tasks.unwrap_or(0),
                completed,
                active,
                failed,
                is_complete: active == 0 && (completed > 0 || failed > 0),
            }
        }
        None => ProgressSummary {
            total: 0,
            completed: 0,
            active: 0,
            failed: 0,
            is_complete: false,
        },
    }
}

/// Get an execution summary suitable for modal/exit display.
pub fn get_modal_summary(state: Option<&RuntimeState>, elapsed_ms: u64) -> ExecutionSummary {
    let progress = get_progress_summary(state);
    ExecutionSummary {
        completed: progress.completed,
        failed: progress.failed,
        active: progress.active,
        total: progress.total,
        is_complete: progress.is_complete,
        elapsed_ms,
    }
}

// ---------------------------------------------------------------------------
// File watching
// ---------------------------------------------------------------------------

/// Handle for a running file watcher.
///
/// Drop this to stop watching.
pub struct RuntimeWatchHandle {
    _watcher: RecommendedWatcher,
    stop_tx: Option<mpsc::Sender<()>>,
}

impl RuntimeWatchHandle {
    /// Stop the watcher explicitly.
    pub fn stop(mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
    }
}

impl Drop for RuntimeWatchHandle {
    fn drop(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
    }
}

/// Watch runtime state file for changes.
///
/// Uses 150ms debounce for most changes, with a fast-path (no debounce)
/// when new active tasks are detected.
///
/// Returns a handle that can be used to stop watching.
pub fn watch_runtime_state<F>(parent_id: &str, callback: F) -> Result<RuntimeWatchHandle>
where
    F: Fn(Option<RuntimeState>) + Send + 'static,
{
    let exec_path = get_execution_path(parent_id);
    fs::create_dir_all(&exec_path)?;

    let parent_id_owned = parent_id.to_string();

    // Read initial state and call callback
    let initial_state = read_runtime_state(parent_id);
    callback(initial_state.clone());

    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (event_tx, event_rx) = mpsc::channel::<notify::Event>();

    // Set up file watcher
    let event_tx_clone = event_tx.clone();
    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                let _ = event_tx_clone.send(event);
            }
        },
        Config::default(),
    )?;

    watcher.watch(&exec_path, RecursiveMode::NonRecursive)?;

    // Spawn event processing thread
    let parent_id_for_thread = parent_id_owned.clone();
    thread::spawn(move || {
        let mut last_state: Option<RuntimeState> = initial_state;
        let mut debounce_deadline: Option<Instant> = None;

        loop {
            // Check for stop signal
            if stop_rx.try_recv().is_ok() {
                break;
            }

            // Check for file events
            let timeout = if debounce_deadline.is_some() {
                Duration::from_millis(10)
            } else {
                Duration::from_millis(50)
            };

            if let Ok(event) = event_rx.recv_timeout(timeout) {
                // Only process runtime.json changes
                let is_runtime = event.paths.iter().any(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n == "runtime.json")
                        .unwrap_or(false)
                });

                if is_runtime {
                    let new_state = read_runtime_state(&parent_id_for_thread);

                    // Fast-path for new active tasks
                    if has_new_active_tasks(&last_state, &new_state) {
                        debounce_deadline = None;
                        last_state = new_state.clone();
                        callback(new_state);
                        continue;
                    }

                    // Set debounce for other changes
                    debounce_deadline = Some(Instant::now() + Duration::from_millis(DEBOUNCE_MS));
                }
            }

            // Check if debounce timer expired
            if let Some(deadline) = debounce_deadline {
                if Instant::now() >= deadline {
                    debounce_deadline = None;
                    let current_state = read_runtime_state(&parent_id_for_thread);
                    if has_content_changed(&last_state, &current_state) {
                        last_state = current_state.clone();
                        callback(current_state);
                    }
                }
            }
        }
    });

    Ok(RuntimeWatchHandle {
        _watcher: watcher,
        stop_tx: Some(stop_tx),
    })
}

/// Check if new active tasks were added.
fn has_new_active_tasks(
    old_state: &Option<RuntimeState>,
    new_state: &Option<RuntimeState>,
) -> bool {
    let new_tasks = match new_state {
        Some(s) => &s.active_tasks,
        None => return false,
    };
    let old_tasks = match old_state {
        Some(s) => &s.active_tasks,
        None => return !new_tasks.is_empty(),
    };

    new_tasks
        .iter()
        .any(|new_task| !old_tasks.iter().any(|old_task| old_task.id == new_task.id))
}

/// Check if runtime state content has changed (ignoring updated_at).
fn has_content_changed(old_state: &Option<RuntimeState>, new_state: &Option<RuntimeState>) -> bool {
    match (old_state, new_state) {
        (None, None) => false,
        (Some(_), None) | (None, Some(_)) => true,
        (Some(old), Some(new)) => {
            !active_tasks_equal(&old.active_tasks, &new.active_tasks)
                || !completed_tasks_equal(&old.completed_tasks, &new.completed_tasks)
                || !failed_tasks_equal(&old.failed_tasks, &new.failed_tasks)
                || old.loop_pid != new.loop_pid
                || !backend_statuses_equal(&old.backend_statuses, &new.backend_statuses)
        }
    }
}

fn active_tasks_equal(a: &[RuntimeActiveTask], b: &[RuntimeActiveTask]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .all(|(x, y)| x.id == y.id && x.started_at == y.started_at)
}

fn completed_tasks_equal(a: &[serde_json::Value], b: &[serde_json::Value]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .all(|(x, y)| get_completed_task_id(x) == get_completed_task_id(y))
}

fn failed_tasks_equal(a: &[serde_json::Value], b: &[serde_json::Value]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .all(|(x, y)| get_completed_task_id(x) == get_completed_task_id(y))
}

fn backend_statuses_equal(
    a: &Option<HashMap<String, BackendStatusEntry>>,
    b: &Option<HashMap<String, BackendStatusEntry>>,
) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(_), None) | (None, Some(_)) => false,
        (Some(a_map), Some(b_map)) => {
            if a_map.len() != b_map.len() {
                return false;
            }
            a_map.iter().all(|(k, v)| {
                b_map
                    .get(k)
                    .map(|bv| bv.status == v.status)
                    .unwrap_or(false)
            })
        }
    }
}

// ---------------------------------------------------------------------------
// Lock helpers
// ---------------------------------------------------------------------------

/// Try to acquire a file lock.
///
/// Uses atomic file creation. Returns true if lock was acquired.
fn try_acquire_lock(lock_path: &Path) -> bool {
    if lock_path.exists() {
        if is_lock_stale(lock_path) {
            let _ = fs::remove_file(lock_path);
        } else {
            return false;
        }
    }

    // Try creating the lock file atomically
    // Use OpenOptions with create_new for atomic creation
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(lock_path)
    {
        Ok(file) => {
            use std::io::Write;
            let mut file = file;
            let _ = write!(
                file,
                "{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis()
            );
            true
        }
        Err(_) => false,
    }
}

/// Check if a lock file is stale (older than LOCK_TIMEOUT_MS).
fn is_lock_stale(lock_path: &Path) -> bool {
    match fs::read_to_string(lock_path) {
        Ok(content) => {
            let timestamp: u128 = content.trim().parse().unwrap_or(0);
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            now - timestamp > LOCK_TIMEOUT_MS as u128
        }
        Err(_) => true, // Can't read => treat as stale
    }
}

/// Release a file lock.
fn release_lock(lock_path: &Path) {
    let _ = fs::remove_file(lock_path);
}

// ---------------------------------------------------------------------------
// Atomic write helper
// ---------------------------------------------------------------------------

/// Write data to a file atomically using temp file + rename pattern.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup_test_dir() -> TempDir {
        TempDir::new().expect("Failed to create temp dir")
    }

    // -- Verify command extraction tests --

    #[test]
    fn test_extract_verify_commands_basic() {
        let tasks = vec![SubTaskContext {
            id: "task-001".to_string(),
            identifier: "MOB-101".to_string(),
            title: "Test task".to_string(),
            description: r#"## Summary
Do something.

### Verify Command
```bash
cd /tmp && echo "hello"
```
"#
            .to_string(),
            status: "pending".to_string(),
            git_branch_name: String::new(),
            blocked_by: vec![],
            blocks: vec![],
        }];

        let commands = extract_verify_commands(&tasks);
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].subtask_id, "MOB-101");
        assert_eq!(commands[0].command, "cd /tmp && echo \"hello\"");
    }

    #[test]
    fn test_extract_verify_commands_no_block() {
        let tasks = vec![SubTaskContext {
            id: "task-001".to_string(),
            identifier: "MOB-101".to_string(),
            title: "Test task".to_string(),
            description: "No verify block here.".to_string(),
            status: "pending".to_string(),
            git_branch_name: String::new(),
            blocked_by: vec![],
            blocks: vec![],
        }];

        let commands = extract_verify_commands(&tasks);
        assert!(commands.is_empty());
    }

    #[test]
    fn test_extract_verify_commands_empty_description() {
        let tasks = vec![SubTaskContext {
            id: "task-001".to_string(),
            identifier: "MOB-101".to_string(),
            title: "Test task".to_string(),
            description: String::new(),
            status: "pending".to_string(),
            git_branch_name: String::new(),
            blocked_by: vec![],
            blocks: vec![],
        }];

        let commands = extract_verify_commands(&tasks);
        assert!(commands.is_empty());
    }

    #[test]
    fn test_extract_verify_commands_multiline() {
        let tasks = vec![SubTaskContext {
            id: "task-002".to_string(),
            identifier: "MOB-102".to_string(),
            title: "Multi-line verify".to_string(),
            description: r#"## Summary
Complex task.

### Verify Command
```bash
cd /home/test/project && \
cargo check --all-features && \
cargo test -- --nocapture
```
"#
            .to_string(),
            status: "pending".to_string(),
            git_branch_name: String::new(),
            blocked_by: vec![],
            blocks: vec![],
        }];

        let commands = extract_verify_commands(&tasks);
        assert_eq!(commands.len(), 1);
        assert!(commands[0].command.contains("cargo check --all-features"));
        assert!(commands[0].command.contains("cargo test"));
    }

    #[test]
    fn test_extract_verify_commands_case_insensitive() {
        let tasks = vec![SubTaskContext {
            id: "task-003".to_string(),
            identifier: "MOB-103".to_string(),
            title: "Case test".to_string(),
            description: r#"### verify command
```bash
echo "works"
```
"#
            .to_string(),
            status: "pending".to_string(),
            git_branch_name: String::new(),
            blocked_by: vec![],
            blocks: vec![],
        }];

        let commands = extract_verify_commands(&tasks);
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].command, "echo \"works\"");
    }

    #[test]
    fn test_extract_verify_commands_uses_identifier_over_id() {
        let tasks = vec![SubTaskContext {
            id: "some-uuid".to_string(),
            identifier: "MOB-104".to_string(),
            title: "ID test".to_string(),
            description: r#"### Verify Command
```bash
echo "test"
```
"#
            .to_string(),
            status: "pending".to_string(),
            git_branch_name: String::new(),
            blocked_by: vec![],
            blocks: vec![],
        }];

        let commands = extract_verify_commands(&tasks);
        assert_eq!(commands[0].subtask_id, "MOB-104");
    }

    #[test]
    fn test_extract_verify_commands_falls_back_to_id() {
        let tasks = vec![SubTaskContext {
            id: "task-005".to_string(),
            identifier: String::new(),
            title: "Fallback test".to_string(),
            description: r#"### Verify Command
```bash
echo "test"
```
"#
            .to_string(),
            status: "pending".to_string(),
            git_branch_name: String::new(),
            blocked_by: vec![],
            blocks: vec![],
        }];

        let commands = extract_verify_commands(&tasks);
        assert_eq!(commands[0].subtask_id, "task-005");
    }

    // -- Pending update deduplication tests --

    #[test]
    fn test_is_duplicate_status_change() {
        let existing = PendingUpdate {
            id: "u1".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            synced_at: None,
            error: None,
            data: PendingUpdateData::StatusChange {
                issue_id: "abc".to_string(),
                identifier: "MOB-101".to_string(),
                old_status: "Backlog".to_string(),
                new_status: "Done".to_string(),
            },
        };

        let incoming_dup = PendingUpdateInput::StatusChange {
            issue_id: "abc".to_string(),
            identifier: "MOB-101".to_string(),
            old_status: "Backlog".to_string(),
            new_status: "Done".to_string(),
        };

        let incoming_diff = PendingUpdateInput::StatusChange {
            issue_id: "abc".to_string(),
            identifier: "MOB-101".to_string(),
            old_status: "Backlog".to_string(),
            new_status: "In Progress".to_string(),
        };

        assert!(is_duplicate_update(&existing, &incoming_dup));
        assert!(!is_duplicate_update(&existing, &incoming_diff));
    }

    #[test]
    fn test_is_duplicate_add_comment() {
        let existing = PendingUpdate {
            id: "u1".to_string(),
            created_at: "t".to_string(),
            synced_at: None,
            error: None,
            data: PendingUpdateData::AddComment {
                issue_id: "abc".to_string(),
                identifier: "MOB-101".to_string(),
                body: "Hello".to_string(),
            },
        };

        let incoming_dup = PendingUpdateInput::AddComment {
            issue_id: "abc".to_string(),
            identifier: "MOB-101".to_string(),
            body: "Hello".to_string(),
        };

        let incoming_diff = PendingUpdateInput::AddComment {
            issue_id: "abc".to_string(),
            identifier: "MOB-101".to_string(),
            body: "Different body".to_string(),
        };

        assert!(is_duplicate_update(&existing, &incoming_dup));
        assert!(!is_duplicate_update(&existing, &incoming_diff));
    }

    #[test]
    fn test_is_duplicate_cross_type() {
        let existing = PendingUpdate {
            id: "u1".to_string(),
            created_at: "t".to_string(),
            synced_at: None,
            error: None,
            data: PendingUpdateData::StatusChange {
                issue_id: "abc".to_string(),
                identifier: "MOB-101".to_string(),
                old_status: "Backlog".to_string(),
                new_status: "Done".to_string(),
            },
        };

        let incoming = PendingUpdateInput::AddComment {
            issue_id: "abc".to_string(),
            identifier: "MOB-101".to_string(),
            body: "Hello".to_string(),
        };

        assert!(!is_duplicate_update(&existing, &incoming));
    }

    // -- Lock tests --

    #[test]
    fn test_lock_acquire_and_release() {
        let tmp = setup_test_dir();
        let lock_path = tmp.path().join("test.lock");

        assert!(try_acquire_lock(&lock_path));
        assert!(lock_path.exists());

        // Second acquire should fail
        assert!(!try_acquire_lock(&lock_path));

        release_lock(&lock_path);
        assert!(!lock_path.exists());

        // Can acquire again after release
        assert!(try_acquire_lock(&lock_path));
        release_lock(&lock_path);
    }

    #[test]
    fn test_stale_lock_detection() {
        let tmp = setup_test_dir();
        let lock_path = tmp.path().join("stale.lock");

        // Write a lock with timestamp 0 (always stale)
        fs::write(&lock_path, "0").unwrap();
        assert!(is_lock_stale(&lock_path));

        // Write a lock with current timestamp (not stale)
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        fs::write(&lock_path, now.to_string()).unwrap();
        assert!(!is_lock_stale(&lock_path));
    }

    #[test]
    fn test_stale_lock_broken_on_acquire() {
        let tmp = setup_test_dir();
        let lock_path = tmp.path().join("stale.lock");

        // Create a stale lock
        fs::write(&lock_path, "0").unwrap();

        // Acquire should succeed (stale lock is broken)
        assert!(try_acquire_lock(&lock_path));
        release_lock(&lock_path);
    }

    // -- Runtime state tests --

    #[test]
    fn test_runtime_state_mutations() {
        let state = RuntimeState {
            parent_id: "MOB-100".to_string(),
            parent_title: "Test".to_string(),
            active_tasks: vec![],
            completed_tasks: vec![],
            failed_tasks: vec![],
            started_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            loop_pid: None,
            total_tasks: Some(5),
            backend_statuses: None,
            total_input_tokens: None,
            total_output_tokens: None,
        };

        // Add active task
        let task = RuntimeActiveTask {
            id: "task-001".to_string(),
            pid: 1234,
            pane: "%1".to_string(),
            started_at: "2026-01-01T00:00:00Z".to_string(),
            worktree: None,
            model: None,
            input_tokens: None,
            output_tokens: None,
        };
        let state = add_runtime_active_task(&state, task);
        assert_eq!(state.active_tasks.len(), 1);

        // Update pane
        let state = update_runtime_task_pane(&state, "task-001", "%2");
        assert_eq!(state.active_tasks[0].pane, "%2");

        // Complete task
        let state = complete_runtime_task(&state, "task-001");
        assert!(state.active_tasks.is_empty());
        assert_eq!(state.completed_tasks.len(), 1);

        // Add and fail another task
        let task2 = RuntimeActiveTask {
            id: "task-002".to_string(),
            pid: 5678,
            pane: "%3".to_string(),
            started_at: "2026-01-01T00:01:00Z".to_string(),
            worktree: None,
            model: None,
            input_tokens: None,
            output_tokens: None,
        };
        let state = add_runtime_active_task(&state, task2);
        let state = fail_runtime_task(&state, "task-002");
        assert!(state.active_tasks.is_empty());
        assert_eq!(state.failed_tasks.len(), 1);
    }

    #[test]
    fn test_add_runtime_task_deduplicates() {
        let state = RuntimeState {
            parent_id: "MOB-100".to_string(),
            parent_title: "Test".to_string(),
            active_tasks: vec![RuntimeActiveTask {
                id: "task-001".to_string(),
                pid: 1234,
                pane: "%1".to_string(),
                started_at: "2026-01-01T00:00:00Z".to_string(),
                worktree: None,
                model: None,
                input_tokens: None,
                output_tokens: None,
            }],
            completed_tasks: vec![],
            failed_tasks: vec![],
            started_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            loop_pid: None,
            total_tasks: None,
            backend_statuses: None,
            total_input_tokens: None,
            total_output_tokens: None,
        };

        // Re-adding same task ID should replace, not duplicate
        let task = RuntimeActiveTask {
            id: "task-001".to_string(),
            pid: 9999,
            pane: "%5".to_string(),
            started_at: "2026-01-01T00:01:00Z".to_string(),
            worktree: None,
            model: None,
            input_tokens: None,
            output_tokens: None,
        };
        let state = add_runtime_active_task(&state, task);
        assert_eq!(state.active_tasks.len(), 1);
        assert_eq!(state.active_tasks[0].pid, 9999);
    }

    // -- Completed task normalization tests --

    #[test]
    fn test_normalize_completed_task_string() {
        let entry = serde_json::Value::String("MOB-101".to_string());
        let task = normalize_completed_task(&entry);
        assert_eq!(task.id, "MOB-101");
    }

    #[test]
    fn test_normalize_completed_task_object() {
        let entry = serde_json::json!({
            "id": "MOB-102",
            "completedAt": "2026-01-01T00:00:00Z",
            "duration": 5000
        });
        let task = normalize_completed_task(&entry);
        assert_eq!(task.id, "MOB-102");
        assert_eq!(task.duration, 5000);
    }

    #[test]
    fn test_get_completed_task_id_string() {
        let entry = serde_json::Value::String("MOB-103".to_string());
        assert_eq!(get_completed_task_id(&entry), "MOB-103");
    }

    #[test]
    fn test_get_completed_task_id_object() {
        let entry = serde_json::json!({"id": "MOB-104"});
        assert_eq!(get_completed_task_id(&entry), "MOB-104");
    }

    // -- Change detection tests --

    #[test]
    fn test_has_new_active_tasks() {
        let old = Some(RuntimeState {
            parent_id: "p".to_string(),
            parent_title: "t".to_string(),
            active_tasks: vec![RuntimeActiveTask {
                id: "task-001".to_string(),
                pid: 1,
                pane: "%1".to_string(),
                started_at: "t".to_string(),
                worktree: None,
                model: None,
                input_tokens: None,
                output_tokens: None,
            }],
            completed_tasks: vec![],
            failed_tasks: vec![],
            started_at: "t".to_string(),
            updated_at: "t".to_string(),
            loop_pid: None,
            total_tasks: None,
            backend_statuses: None,
            total_input_tokens: None,
            total_output_tokens: None,
        });

        let new_same = old.clone();
        assert!(!has_new_active_tasks(&old, &new_same));

        let new_with_addition = Some(RuntimeState {
            active_tasks: vec![
                RuntimeActiveTask {
                    id: "task-001".to_string(),
                    pid: 1,
                    pane: "%1".to_string(),
                    started_at: "t".to_string(),
                    worktree: None,
                    model: None,
                    input_tokens: None,
                    output_tokens: None,
                },
                RuntimeActiveTask {
                    id: "task-002".to_string(),
                    pid: 2,
                    pane: "%2".to_string(),
                    started_at: "t".to_string(),
                    worktree: None,
                    model: None,
                    input_tokens: None,
                    output_tokens: None,
                },
            ],
            ..old.as_ref().unwrap().clone()
        });
        assert!(has_new_active_tasks(&old, &new_with_addition));
    }

    #[test]
    fn test_has_content_changed() {
        let state = RuntimeState {
            parent_id: "p".to_string(),
            parent_title: "t".to_string(),
            active_tasks: vec![],
            completed_tasks: vec![],
            failed_tasks: vec![],
            started_at: "t".to_string(),
            updated_at: "t1".to_string(),
            loop_pid: Some(1234),
            total_tasks: None,
            backend_statuses: None,
            total_input_tokens: None,
            total_output_tokens: None,
        };

        // Same except updated_at -> no change
        let state2 = RuntimeState {
            updated_at: "t2".to_string(),
            ..state.clone()
        };
        assert!(!has_content_changed(&Some(state.clone()), &Some(state2)));

        // Different loop_pid -> changed
        let state3 = RuntimeState {
            loop_pid: Some(5678),
            ..state.clone()
        };
        assert!(has_content_changed(&Some(state.clone()), &Some(state3)));

        // None vs Some -> changed
        assert!(has_content_changed(&None, &Some(state.clone())));
        assert!(has_content_changed(&Some(state.clone()), &None));
        assert!(!has_content_changed(&None, &None));
    }

    // -- Backend statuses equality tests --

    #[test]
    fn test_backend_statuses_equal() {
        let a: Option<HashMap<String, BackendStatusEntry>> = None;
        let b: Option<HashMap<String, BackendStatusEntry>> = None;
        assert!(backend_statuses_equal(&a, &b));

        let mut map_a = HashMap::new();
        map_a.insert(
            "MOB-101".to_string(),
            BackendStatusEntry {
                identifier: "MOB-101".to_string(),
                status: "Done".to_string(),
                synced_at: "t".to_string(),
            },
        );
        let map_b = map_a.clone();

        assert!(backend_statuses_equal(&Some(map_a.clone()), &Some(map_b)));
        assert!(!backend_statuses_equal(&Some(map_a.clone()), &None));
        assert!(!backend_statuses_equal(&None, &Some(map_a)));
    }

    // -- Atomic write tests --

    #[test]
    fn test_atomic_write_json() {
        let tmp = setup_test_dir();
        let path = tmp.path().join("test.json");

        #[derive(Serialize, Deserialize, PartialEq, Debug)]
        struct Data {
            value: String,
        }

        let data = Data {
            value: "hello".to_string(),
        };
        atomic_write_json(&path, &data).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        let parsed: Data = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed, data);

        // No temp file left behind
        assert!(!path.with_extension("json.tmp").exists());
    }

    // -- Context freshness tests --

    #[test]
    fn test_context_freshness_nonexistent() {
        assert!(!is_context_fresh("NONEXISTENT-999", None));
    }

    // -- Path resolution tests --

    #[test]
    fn test_path_functions() {
        let parent = "MOB-100";
        let ctx = get_context_path(parent);
        assert!(ctx.ends_with("issues/MOB-100"));

        let parent_json = get_parent_context_path(parent);
        assert!(parent_json.ends_with("parent.json"));

        let tasks = get_tasks_directory_path(parent);
        assert!(tasks.ends_with("tasks"));

        let task = get_task_context_path(parent, "MOB-101");
        assert!(task.ends_with("MOB-101.json"));

        let pending = get_pending_updates_path(parent);
        assert!(pending.ends_with("pending-updates.json"));

        let sync = get_sync_log_path(parent);
        assert!(sync.ends_with("sync-log.json"));

        let full = get_full_context_path(parent);
        assert!(full.ends_with("context.json"));

        let exec = get_execution_path(parent);
        assert!(exec.ends_with("execution"));

        let session = get_session_path(parent);
        assert!(session.ends_with("session.json"));

        let runtime = get_runtime_path(parent);
        assert!(runtime.ends_with("runtime.json"));

        let pointer = get_current_session_pointer_path();
        assert!(pointer.ends_with("current-session"));
    }

    // -- Progress summary tests --

    #[test]
    fn test_progress_summary() {
        let summary = get_progress_summary(None);
        assert_eq!(summary.total, 0);
        assert!(!summary.is_complete);

        let state = RuntimeState {
            parent_id: "p".to_string(),
            parent_title: "t".to_string(),
            active_tasks: vec![RuntimeActiveTask {
                id: "t1".to_string(),
                pid: 1,
                pane: "%1".to_string(),
                started_at: "t".to_string(),
                worktree: None,
                model: None,
                input_tokens: None,
                output_tokens: None,
            }],
            completed_tasks: vec![serde_json::json!("t2"), serde_json::json!("t3")],
            failed_tasks: vec![serde_json::json!("t4")],
            started_at: "t".to_string(),
            updated_at: "t".to_string(),
            loop_pid: None,
            total_tasks: Some(10),
            backend_statuses: None,
            total_input_tokens: None,
            total_output_tokens: None,
        };

        let summary = get_progress_summary(Some(&state));
        assert_eq!(summary.total, 10);
        assert_eq!(summary.active, 1);
        assert_eq!(summary.completed, 2);
        assert_eq!(summary.failed, 1);
        assert!(!summary.is_complete); // active > 0, so not complete
    }

    // -- Session management tests --

    #[test]
    fn test_session_info_serde() {
        let session = SessionInfo {
            parent_id: "MOB-100".to_string(),
            backend: Backend::Linear,
            started_at: "2026-01-01T00:00:00Z".to_string(),
            worktree_path: Some("/tmp/worktree".to_string()),
            status: SessionStatus::Active,
        };

        let json = serde_json::to_string(&session).unwrap();
        let parsed: SessionInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.parent_id, "MOB-100");
        assert_eq!(parsed.status, SessionStatus::Active);
    }

    // -- Remove active task tests --

    #[test]
    fn test_remove_runtime_active_task() {
        let state = RuntimeState {
            parent_id: "p".to_string(),
            parent_title: "t".to_string(),
            active_tasks: vec![
                RuntimeActiveTask {
                    id: "task-001".to_string(),
                    pid: 1,
                    pane: "%1".to_string(),
                    started_at: "t".to_string(),
                    worktree: None,
                    model: None,
                    input_tokens: None,
                    output_tokens: None,
                },
                RuntimeActiveTask {
                    id: "task-002".to_string(),
                    pid: 2,
                    pane: "%2".to_string(),
                    started_at: "t".to_string(),
                    worktree: None,
                    model: None,
                    input_tokens: None,
                    output_tokens: None,
                },
            ],
            completed_tasks: vec![],
            failed_tasks: vec![],
            started_at: "t".to_string(),
            updated_at: "t".to_string(),
            loop_pid: None,
            total_tasks: None,
            backend_statuses: None,
            total_input_tokens: None,
            total_output_tokens: None,
        };

        let state = remove_runtime_active_task(&state, "task-001");
        assert_eq!(state.active_tasks.len(), 1);
        assert_eq!(state.active_tasks[0].id, "task-002");

        // Removing non-existent task is a no-op
        let state = remove_runtime_active_task(&state, "nonexistent");
        assert_eq!(state.active_tasks.len(), 1);
    }

    // -- Session lifecycle tests --

    /// Helper to clean up test context directories
    fn cleanup_test_parent(parent_id: &str) {
        let ctx = get_context_path(parent_id);
        let _ = fs::remove_dir_all(&ctx);
    }

    #[test]
    fn test_session_lifecycle_create_update_end_delete() {
        let parent_id = "TEST-CTX-SL-001";
        cleanup_test_parent(parent_id);

        // Create session
        let session = create_session(parent_id, Backend::Linear, Some("/tmp/wt"))
            .expect("create_session should succeed");
        assert_eq!(session.parent_id, parent_id);
        assert_eq!(session.status, SessionStatus::Active);
        assert_eq!(session.worktree_path, Some("/tmp/wt".to_string()));

        // Verify session.json exists on disk
        let session_path = get_session_path(parent_id);
        assert!(
            session_path.exists(),
            "session.json should exist after create"
        );

        // Update session status
        let updated = update_session(parent_id, Some(SessionStatus::Paused), None);
        assert!(updated.is_some());
        assert_eq!(updated.unwrap().status, SessionStatus::Paused);

        // Read back from disk
        let read_back = read_session(parent_id);
        assert!(read_back.is_some());
        assert_eq!(read_back.unwrap().status, SessionStatus::Paused);

        // End session
        end_session(parent_id, SessionStatus::Completed);
        let after_end = read_session(parent_id);
        assert!(after_end.is_some());
        assert_eq!(after_end.unwrap().status, SessionStatus::Completed);

        // Delete session
        delete_session(parent_id);
        let after_delete = read_session(parent_id);
        assert!(
            after_delete.is_none(),
            "session should be gone after delete"
        );
        assert!(
            !session_path.exists(),
            "session.json should not exist after delete"
        );

        cleanup_test_parent(parent_id);
    }

    #[test]
    fn test_session_pointer_survives_read() {
        let parent_id = "TEST-CTX-SP-001";
        cleanup_test_parent(parent_id);

        // Create session sets the pointer
        let _session =
            create_session(parent_id, Backend::Local, None).expect("create_session should succeed");

        // Read pointer back
        let raw = get_current_session_parent_id_raw();
        assert_eq!(raw.as_deref(), Some(parent_id));

        // Full validation (checks session file exists)
        let validated = get_current_session_parent_id();
        assert_eq!(validated.as_deref(), Some(parent_id));

        // Cleanup
        delete_session(parent_id);
        cleanup_test_parent(parent_id);
    }

    #[test]
    fn test_session_pointer_cleared_on_delete() {
        let parent_id_a = "TEST-CTX-SPC-A";
        let parent_id_b = "TEST-CTX-SPC-B";
        cleanup_test_parent(parent_id_a);
        cleanup_test_parent(parent_id_b);

        // Create session A, then session B (B becomes current)
        let _sa = create_session(parent_id_a, Backend::Local, None).unwrap();
        let _sb = create_session(parent_id_b, Backend::Local, None).unwrap();

        // Pointer should be B
        assert_eq!(
            get_current_session_parent_id_raw().as_deref(),
            Some(parent_id_b)
        );

        // Clearing pointer for A should NOT clear it (it doesn't match)
        clear_current_session_pointer(parent_id_a);
        assert_eq!(
            get_current_session_parent_id_raw().as_deref(),
            Some(parent_id_b),
            "pointer should still be B after clearing A"
        );

        // Clearing pointer for B should clear it
        clear_current_session_pointer(parent_id_b);
        assert!(
            get_current_session_parent_id_raw().is_none(),
            "pointer should be cleared after clearing B"
        );

        // Cleanup
        delete_session(parent_id_a);
        delete_session(parent_id_b);
        cleanup_test_parent(parent_id_a);
        cleanup_test_parent(parent_id_b);
    }

    #[test]
    fn test_update_session_partial_fields() {
        let parent_id = "TEST-CTX-USP-001";
        cleanup_test_parent(parent_id);

        let _session = create_session(parent_id, Backend::Linear, Some("/original"))
            .expect("create_session should succeed");

        // Update only worktree_path, leave status unchanged
        let updated = update_session(parent_id, None, Some("/new-path".to_string()));
        assert!(updated.is_some());
        let s = updated.unwrap();
        assert_eq!(
            s.status,
            SessionStatus::Active,
            "status should remain Active"
        );
        assert_eq!(s.worktree_path.as_deref(), Some("/new-path"));

        // Update only status, worktree should remain
        let updated2 = update_session(parent_id, Some(SessionStatus::Failed), None);
        assert!(updated2.is_some());
        let s2 = updated2.unwrap();
        assert_eq!(s2.status, SessionStatus::Failed);
        assert_eq!(
            s2.worktree_path.as_deref(),
            Some("/new-path"),
            "worktree should persist"
        );

        delete_session(parent_id);
        cleanup_test_parent(parent_id);
    }

    // -- Concurrent lock tests --

    #[test]
    fn test_concurrent_lock_contention_retry() {
        let tmp = setup_test_dir();
        let lock_path = tmp.path().join("contention.lock");

        // Acquire the lock (simulating another process holding it)
        assert!(try_acquire_lock(&lock_path));

        // Try to acquire again - should fail (lock is held and not stale)
        assert!(!try_acquire_lock(&lock_path), "second acquire should fail");

        // Release the lock
        release_lock(&lock_path);

        // Now acquisition should succeed
        assert!(try_acquire_lock(&lock_path), "should succeed after release");
        release_lock(&lock_path);
    }

    #[test]
    fn test_stale_lock_cleanup_on_acquire() {
        let tmp = setup_test_dir();
        let lock_path = tmp.path().join("stale-cleanup.lock");

        // Write a stale lock with timestamp 0
        fs::write(&lock_path, "0").unwrap();
        assert!(lock_path.exists());

        // Acquiring should succeed by cleaning up the stale lock
        assert!(
            try_acquire_lock(&lock_path),
            "should acquire over stale lock"
        );

        // The lock file should now contain a recent timestamp
        let content = fs::read_to_string(&lock_path).unwrap();
        let ts: u128 = content.trim().parse().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        assert!(now - ts < 5000, "lock timestamp should be recent");

        release_lock(&lock_path);
    }

    #[test]
    fn test_lock_release_idempotent() {
        let tmp = setup_test_dir();
        let lock_path = tmp.path().join("idempotent.lock");

        // Acquire lock
        assert!(try_acquire_lock(&lock_path));

        // Release once
        release_lock(&lock_path);
        assert!(!lock_path.exists());

        // Release again - should not panic or error
        release_lock(&lock_path);
        assert!(!lock_path.exists(), "double release should be safe");
    }

    // -- Runtime state edge cases --

    #[test]
    fn test_runtime_state_read_missing_file() {
        // Non-existent parent should return None
        let result = read_runtime_state("NONEXISTENT-RUNTIME-999");
        assert!(result.is_none(), "missing runtime file should return None");
    }

    #[test]
    fn test_runtime_state_read_empty_json() {
        let parent_id = "TEST-CTX-RSE-001";
        cleanup_test_parent(parent_id);
        ensure_context_directories(parent_id).unwrap();

        // Write empty content to runtime.json
        let runtime_path = get_runtime_path(parent_id);
        fs::write(&runtime_path, "").unwrap();

        let result = read_runtime_state(parent_id);
        assert!(result.is_none(), "empty file should return None");

        cleanup_test_parent(parent_id);
    }

    #[test]
    fn test_runtime_state_read_malformed_json() {
        let parent_id = "TEST-CTX-RSM-001";
        cleanup_test_parent(parent_id);
        ensure_context_directories(parent_id).unwrap();

        // Write invalid JSON to runtime.json
        let runtime_path = get_runtime_path(parent_id);
        fs::write(&runtime_path, "{invalid json!!!").unwrap();

        let result = read_runtime_state(parent_id);
        assert!(result.is_none(), "malformed JSON should return None");

        cleanup_test_parent(parent_id);
    }

    #[test]
    fn test_initialize_runtime_state_overwrites_existing() {
        let parent_id = "TEST-CTX-IRO-001";
        cleanup_test_parent(parent_id);

        // Initialize with first values
        let state1 = initialize_runtime_state(parent_id, "First Title", Some(100), Some(5))
            .expect("first init should succeed");
        assert_eq!(state1.parent_title, "First Title");
        assert_eq!(state1.loop_pid, Some(100));

        // Re-initialize with different values - should overwrite
        let state2 = initialize_runtime_state(parent_id, "Second Title", Some(200), Some(10))
            .expect("second init should succeed");
        assert_eq!(state2.parent_title, "Second Title");
        assert_eq!(state2.loop_pid, Some(200));
        assert_eq!(state2.total_tasks, Some(10));

        // Active tasks from first init should be gone
        assert!(state2.active_tasks.is_empty());
        assert!(state2.completed_tasks.is_empty());

        // Clean up
        delete_runtime_state(parent_id);
        cleanup_test_parent(parent_id);
    }

    #[test]
    fn test_with_runtime_state_sync_creates_parent_dir() {
        let parent_id = "TEST-CTX-WRSS-001";
        cleanup_test_parent(parent_id);

        // The execution dir should not exist yet
        let exec_path = get_execution_path(parent_id);
        assert!(
            !exec_path.exists(),
            "execution dir should not exist before test"
        );

        // with_runtime_state_sync should create the necessary directories
        let result = with_runtime_state_sync(parent_id, |_current| RuntimeState {
            parent_id: parent_id.to_string(),
            parent_title: "Test".to_string(),
            active_tasks: vec![],
            completed_tasks: vec![],
            failed_tasks: vec![],
            started_at: "t".to_string(),
            updated_at: "t".to_string(),
            loop_pid: None,
            total_tasks: None,
            backend_statuses: None,
            total_input_tokens: None,
            total_output_tokens: None,
        });

        assert!(result.is_ok(), "with_runtime_state_sync should succeed");
        assert!(
            exec_path.exists(),
            "execution directory should be auto-created"
        );

        // Runtime file should exist
        let runtime_path = get_runtime_path(parent_id);
        assert!(runtime_path.exists(), "runtime.json should exist");

        delete_runtime_state(parent_id);
        cleanup_test_parent(parent_id);
    }

    // -- ProgressSummary is_complete tests --

    #[test]
    fn test_progress_summary_is_complete_true() {
        // active=0, completed>0 → is_complete=true
        let state = RuntimeState {
            parent_id: "p".to_string(),
            parent_title: "t".to_string(),
            active_tasks: vec![],
            completed_tasks: vec![serde_json::json!("t1"), serde_json::json!("t2")],
            failed_tasks: vec![],
            started_at: "t".to_string(),
            updated_at: "t".to_string(),
            loop_pid: None,
            total_tasks: Some(2),
            backend_statuses: None,
            total_input_tokens: None,
            total_output_tokens: None,
        };

        let summary = get_progress_summary(Some(&state));
        assert!(
            summary.is_complete,
            "should be complete with no active tasks and some completed"
        );
        assert_eq!(summary.completed, 2);
        assert_eq!(summary.active, 0);

        // Also true when only failed tasks exist (active=0, failed>0)
        let state_failed = RuntimeState {
            active_tasks: vec![],
            completed_tasks: vec![],
            failed_tasks: vec![serde_json::json!("t1")],
            ..state
        };
        let summary_failed = get_progress_summary(Some(&state_failed));
        assert!(
            summary_failed.is_complete,
            "should be complete with only failed tasks"
        );
    }

    #[test]
    fn test_progress_summary_is_complete_false() {
        // active>0 → is_complete=false even if completed > 0
        let state = RuntimeState {
            parent_id: "p".to_string(),
            parent_title: "t".to_string(),
            active_tasks: vec![RuntimeActiveTask {
                id: "running".to_string(),
                pid: 1,
                pane: "%1".to_string(),
                started_at: "t".to_string(),
                worktree: None,
                model: None,
                input_tokens: None,
                output_tokens: None,
            }],
            completed_tasks: vec![serde_json::json!("t1")],
            failed_tasks: vec![],
            started_at: "t".to_string(),
            updated_at: "t".to_string(),
            loop_pid: None,
            total_tasks: Some(3),
            backend_statuses: None,
            total_input_tokens: None,
            total_output_tokens: None,
        };

        let summary = get_progress_summary(Some(&state));
        assert!(
            !summary.is_complete,
            "should NOT be complete while tasks are active"
        );
        assert_eq!(summary.active, 1);

        // Also false when all empty (no work done at all)
        let state_empty = RuntimeState {
            active_tasks: vec![],
            completed_tasks: vec![],
            failed_tasks: vec![],
            ..state
        };
        let summary_empty = get_progress_summary(Some(&state_empty));
        assert!(
            !summary_empty.is_complete,
            "should NOT be complete when nothing has run"
        );
    }

    // -- File watcher helper tests --

    #[test]
    fn test_has_new_active_tasks_detection() {
        // None old → non-empty new → new tasks detected
        let new = Some(RuntimeState {
            parent_id: "p".to_string(),
            parent_title: "t".to_string(),
            active_tasks: vec![RuntimeActiveTask {
                id: "task-001".to_string(),
                pid: 1,
                pane: "%1".to_string(),
                started_at: "t".to_string(),
                worktree: None,
                model: None,
                input_tokens: None,
                output_tokens: None,
            }],
            completed_tasks: vec![],
            failed_tasks: vec![],
            started_at: "t".to_string(),
            updated_at: "t".to_string(),
            loop_pid: None,
            total_tasks: None,
            backend_statuses: None,
            total_input_tokens: None,
            total_output_tokens: None,
        });
        assert!(
            has_new_active_tasks(&None, &new),
            "None→Some with active tasks should detect new tasks"
        );

        // None old → empty new → no new tasks
        let new_empty = Some(RuntimeState {
            active_tasks: vec![],
            ..new.as_ref().unwrap().clone()
        });
        assert!(
            !has_new_active_tasks(&None, &new_empty),
            "None→Some with empty active should NOT detect new tasks"
        );

        // Both None → no new tasks
        assert!(
            !has_new_active_tasks(&None, &None),
            "None→None should not detect new tasks"
        );

        // Old has tasks, new is None → no new tasks
        assert!(
            !has_new_active_tasks(&new, &None),
            "Some→None should not detect new tasks"
        );

        // Old has task-001, new has task-001 + task-002 → new tasks
        let new_with_extra = Some(RuntimeState {
            active_tasks: vec![
                RuntimeActiveTask {
                    id: "task-001".to_string(),
                    pid: 1,
                    pane: "%1".to_string(),
                    started_at: "t".to_string(),
                    worktree: None,
                    model: None,
                    input_tokens: None,
                    output_tokens: None,
                },
                RuntimeActiveTask {
                    id: "task-002".to_string(),
                    pid: 2,
                    pane: "%2".to_string(),
                    started_at: "t".to_string(),
                    worktree: None,
                    model: None,
                    input_tokens: None,
                    output_tokens: None,
                },
            ],
            ..new.as_ref().unwrap().clone()
        });
        assert!(
            has_new_active_tasks(&new, &new_with_extra),
            "added task-002 should be detected as new"
        );

        // Same tasks in both → no new tasks
        assert!(
            !has_new_active_tasks(&new, &new),
            "identical active tasks should not detect new"
        );
    }

    #[test]
    fn test_has_content_changed_ignores_updated_at() {
        let base = RuntimeState {
            parent_id: "p".to_string(),
            parent_title: "t".to_string(),
            active_tasks: vec![RuntimeActiveTask {
                id: "task-001".to_string(),
                pid: 1,
                pane: "%1".to_string(),
                started_at: "t".to_string(),
                worktree: None,
                model: None,
                input_tokens: None,
                output_tokens: None,
            }],
            completed_tasks: vec![serde_json::json!("done-1")],
            failed_tasks: vec![serde_json::json!("fail-1")],
            started_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            loop_pid: Some(42),
            total_tasks: Some(5),
            backend_statuses: None,
            total_input_tokens: None,
            total_output_tokens: None,
        };

        // Only updated_at changed → no content change
        let with_different_updated_at = RuntimeState {
            updated_at: "2026-01-01T12:00:00Z".to_string(),
            ..base.clone()
        };
        assert!(
            !has_content_changed(&Some(base.clone()), &Some(with_different_updated_at)),
            "only updated_at change should NOT count as content change"
        );

        // started_at changed → still no content change (not compared)
        let with_different_started_at = RuntimeState {
            started_at: "2026-06-01T00:00:00Z".to_string(),
            ..base.clone()
        };
        assert!(
            !has_content_changed(&Some(base.clone()), &Some(with_different_started_at)),
            "started_at change alone should NOT count as content change"
        );

        // active_tasks changed → content change
        let with_extra_task = RuntimeState {
            active_tasks: vec![
                RuntimeActiveTask {
                    id: "task-001".to_string(),
                    pid: 1,
                    pane: "%1".to_string(),
                    started_at: "t".to_string(),
                    worktree: None,
                    model: None,
                    input_tokens: None,
                    output_tokens: None,
                },
                RuntimeActiveTask {
                    id: "task-002".to_string(),
                    pid: 2,
                    pane: "%2".to_string(),
                    started_at: "t".to_string(),
                    worktree: None,
                    model: None,
                    input_tokens: None,
                    output_tokens: None,
                },
            ],
            ..base.clone()
        };
        assert!(
            has_content_changed(&Some(base.clone()), &Some(with_extra_task)),
            "different active_tasks should count as content change"
        );

        // completed_tasks changed → content change
        let with_extra_completed = RuntimeState {
            completed_tasks: vec![serde_json::json!("done-1"), serde_json::json!("done-2")],
            ..base.clone()
        };
        assert!(
            has_content_changed(&Some(base.clone()), &Some(with_extra_completed)),
            "different completed_tasks should count as content change"
        );

        // backend_statuses changed → content change
        let mut statuses = HashMap::new();
        statuses.insert(
            "MOB-101".to_string(),
            BackendStatusEntry {
                identifier: "MOB-101".to_string(),
                status: "Done".to_string(),
                synced_at: "t".to_string(),
            },
        );
        let with_statuses = RuntimeState {
            backend_statuses: Some(statuses),
            ..base.clone()
        };
        assert!(
            has_content_changed(&Some(base.clone()), &Some(with_statuses)),
            "added backend_statuses should count as content change"
        );
    }
}
