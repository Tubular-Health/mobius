//! Status sync — fetch current issue statuses from backend and update local parent.json files.
//!
//! Used by `list` and `clean` commands to ensure local state reflects
//! the actual backend status before making decisions or displaying info.

use anyhow::Result;
use regex::Regex;
use std::fs;

use crate::jira::JiraClient;
use crate::linear::LinearClient;
use crate::local_state::{get_project_mobius_path, read_parent_spec, update_parent_status};
use crate::types::enums::Backend;

/// Result of a backend status sync operation.
#[derive(Debug, Clone, Default)]
pub struct SyncResult {
    pub synced: u32,
    pub failed: u32,
    pub skipped: u32,
}

/// Check whether an issue ID is local-only (LOC-* or task-*) and has no backend to sync.
pub fn is_local_id(id: &str) -> bool {
    lazy_static_regex().is_match(id)
}

fn lazy_static_regex() -> &'static Regex {
    use std::sync::OnceLock;
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(LOC-\d+|task-\d+)$").expect("valid regex"))
}

/// Fetch the current status name from the appropriate backend.
///
/// Returns `None` on error or for unsupported backends.
async fn fetch_backend_status(issue_id: &str, backend: Backend) -> Option<String> {
    match backend {
        Backend::Linear => {
            let client = LinearClient::new().ok()?;
            client.fetch_linear_issue_status(issue_id).await.ok()
        }
        Backend::Jira => {
            let client = JiraClient::new().ok()?;
            client.fetch_jira_issue_status(issue_id).await.ok()
        }
        Backend::Local => None,
    }
}

/// Sync backend statuses for all non-local issues in `.mobius/issues/`.
///
/// Scans issue directories, fetches current status from the backend,
/// and updates local `parent.json` files so subsequent reads see fresh data.
pub async fn sync_backend_statuses(backend: Backend) -> Result<SyncResult> {
    let mut result = SyncResult::default();

    if backend == Backend::Local {
        return Ok(result);
    }

    let issues_path = get_project_mobius_path().join("issues");

    let entries = match fs::read_dir(&issues_path) {
        Ok(e) => e,
        Err(_) => return Ok(result),
    };

    for entry in entries.flatten() {
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !file_type.is_dir() {
            continue;
        }

        let issue_id = entry.file_name().to_string_lossy().to_string();

        // Skip local-only issues — no backend to sync
        if is_local_id(&issue_id) {
            result.skipped += 1;
            continue;
        }

        let spec = match read_parent_spec(&issue_id) {
            Some(s) => s,
            None => {
                result.skipped += 1;
                continue;
            }
        };

        let backend_status = match fetch_backend_status(&issue_id, backend).await {
            Some(s) => s,
            None => {
                result.failed += 1;
                continue;
            }
        };

        // Only write if status actually changed
        if spec.status != backend_status {
            update_parent_status(&issue_id, &backend_status);
        }
        result.synced += 1;
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_local_id_loc_pattern() {
        assert!(is_local_id("LOC-1"));
        assert!(is_local_id("LOC-123"));
        assert!(is_local_id("LOC-0"));
    }

    #[test]
    fn test_is_local_id_task_pattern() {
        assert!(is_local_id("task-001"));
        assert!(is_local_id("task-1"));
        assert!(is_local_id("task-99"));
    }

    #[test]
    fn test_is_local_id_non_local() {
        assert!(!is_local_id("MOB-123"));
        assert!(!is_local_id("PROJ-1"));
        assert!(!is_local_id("ABC-999"));
        assert!(!is_local_id(""));
        assert!(!is_local_id("random-string"));
    }

    #[test]
    fn test_is_local_id_partial_matches() {
        // Must be full match, not partial
        assert!(!is_local_id("LOC-"));
        assert!(!is_local_id("task-"));
        assert!(!is_local_id("xLOC-1"));
        assert!(!is_local_id("LOC-1x"));
        assert!(!is_local_id("xtask-1"));
        assert!(!is_local_id("task-1x"));
    }

    #[test]
    fn test_sync_result_default() {
        let result = SyncResult::default();
        assert_eq!(result.synced, 0);
        assert_eq!(result.failed, 0);
        assert_eq!(result.skipped, 0);
    }
}
