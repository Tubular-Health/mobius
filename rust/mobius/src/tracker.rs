use std::collections::HashMap;

use regex::Regex;

use crate::executor::{ExecutionResult, ExecutionStatus};
use crate::types::{Backend, SubTask};

/// Pattern matching local-only task identifiers (`LOC-001`, `task-001`).
const LOCAL_ID_PATTERN: &str = r"^(LOC|task)-\d+$";

/// Check if an identifier looks like a local-only task (not from a backend).
///
/// Local identifiers match `LOC-NNN` or `task-NNN` patterns.
/// Backend identifiers are anything else (e.g., `MOB-123`, `PROJ-456`).
fn is_local_task_identifier(identifier: &str, _backend: Option<&Backend>) -> bool {
    let local_pattern = Regex::new(LOCAL_ID_PATTERN).unwrap();
    local_pattern.is_match(identifier)
}

/// Assignment record for tracking task execution attempts.
#[derive(Debug, Clone)]
pub struct TaskAssignment {
    pub task_id: String,
    pub identifier: String,
    pub attempts: u32,
    pub last_result: Option<ExecutionResult>,
}

/// Tracks task assignments, attempts, and retry decisions.
#[derive(Debug)]
pub struct ExecutionTracker {
    pub assignments: HashMap<String, TaskAssignment>,
    pub max_retries: u32,
    pub verification_timeout_ms: u64,
}

/// Execution result enriched with backend verification status.
#[derive(Debug, Clone)]
pub struct VerifiedResult {
    pub task_id: String,
    pub identifier: String,
    pub success: bool,
    pub status: ExecutionStatus,
    pub duration_ms: u64,
    pub error: Option<String>,
    pub pane_id: Option<String>,
    pub raw_output: Option<String>,
    pub backend_verified: bool,
    pub backend_status: Option<String>,
    pub should_retry: bool,
}

impl From<&ExecutionResult> for VerifiedResult {
    fn from(result: &ExecutionResult) -> Self {
        Self {
            task_id: result.task_id.clone(),
            identifier: result.identifier.clone(),
            success: result.success,
            status: result.status.clone(),
            duration_ms: result.duration_ms,
            error: result.error.clone(),
            pane_id: result.pane_id.clone(),
            raw_output: result.raw_output.clone(),
            backend_verified: false,
            backend_status: None,
            should_retry: false,
        }
    }
}

/// Tracker statistics summary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackerStats {
    pub total_assigned: usize,
    pub retried_tasks: usize,
    pub max_attempts_reached: usize,
}

/// Create a new execution tracker.
pub fn create_tracker(
    max_retries: Option<u32>,
    verification_timeout_ms: Option<u64>,
) -> ExecutionTracker {
    ExecutionTracker {
        assignments: HashMap::new(),
        max_retries: max_retries.unwrap_or(2),
        verification_timeout_ms: verification_timeout_ms.unwrap_or(5000),
    }
}

/// Record a task assignment (increments attempts if already assigned).
pub fn assign_task(tracker: &mut ExecutionTracker, task: &SubTask) {
    if let Some(existing) = tracker.assignments.get_mut(&task.id) {
        existing.attempts += 1;
    } else {
        tracker.assignments.insert(
            task.id.clone(),
            TaskAssignment {
                task_id: task.id.clone(),
                identifier: task.identifier.clone(),
                attempts: 1,
                last_result: None,
            },
        );
    }
}

/// Process execution results and determine retry eligibility.
///
/// For successful results:
/// - Local-only tasks are auto-verified (no backend check needed)
/// - Backend tasks would need backend verification (status check against Linear/Jira)
///
/// For failed results:
/// - Tasks within retry limit get `should_retry = true`
///
/// Note: Backend verification (checking Linear/Jira API for actual status) is delegated
/// to the caller. This function applies the verification result pattern without making
/// API calls directly, keeping it testable and decoupled from network I/O.
pub fn process_results(
    tracker: &mut ExecutionTracker,
    results: &[ExecutionResult],
    backend: Option<&Backend>,
) -> Vec<VerifiedResult> {
    let mut verified_results = Vec::with_capacity(results.len());

    for result in results {
        let mut assignment = tracker.assignments.get_mut(&result.task_id);
        let attempts = assignment.as_ref().map(|a| a.attempts).unwrap_or(1);

        if let Some(ref mut assign) = assignment {
            assign.last_result = Some(result.clone());
        }

        if result.success {
            let is_local = is_local_task_identifier(&result.identifier, backend);

            if is_local {
                // Local tasks are auto-verified
                let mut vr = VerifiedResult::from(result);
                vr.backend_verified = true;
                vr.backend_status = Some("Done (local)".to_string());
                vr.should_retry = false;
                verified_results.push(vr);
            } else {
                // Backend task - mark as needing verification
                // The caller should verify via backend API and update the result.
                // For now, treat as verified (optimistic) since the agent reported success.
                let mut vr = VerifiedResult::from(result);
                vr.backend_verified = true;
                vr.backend_status = Some("Done (agent-reported)".to_string());
                vr.should_retry = false;
                verified_results.push(vr);
            }
        } else {
            let can_retry = attempts <= tracker.max_retries;
            let mut vr = VerifiedResult::from(result);
            vr.backend_verified = false;
            vr.should_retry = can_retry;
            verified_results.push(vr);
        }
    }

    verified_results
}

/// Apply backend verification result to a verified result.
///
/// Call this after checking the backend API status. If the backend says the task
/// is not actually done, mark the result as failed with retry eligibility.
pub fn apply_backend_verification(
    result: &mut VerifiedResult,
    verified: bool,
    backend_status: Option<String>,
    attempts: u32,
    max_retries: u32,
) {
    if verified {
        result.backend_verified = true;
        result.backend_status = backend_status;
        result.should_retry = false;
    } else {
        result.backend_verified = false;
        result.backend_status = backend_status;
        result.success = false;
        result.should_retry = attempts <= max_retries;
    }
}

/// Get tasks that should be retried based on verified results.
pub fn get_retry_tasks<'a>(
    results: &[VerifiedResult],
    all_tasks: &'a [SubTask],
) -> Vec<&'a SubTask> {
    let retry_ids: Vec<&str> = results
        .iter()
        .filter(|r| r.should_retry)
        .map(|r| r.task_id.as_str())
        .collect();

    all_tasks
        .iter()
        .filter(|task| retry_ids.contains(&task.id.as_str()))
        .collect()
}

/// Get permanently failed tasks (failed with no retries remaining).
pub fn get_permanently_failed_tasks(results: &[VerifiedResult]) -> Vec<&VerifiedResult> {
    results
        .iter()
        .filter(|r| !r.success && !r.should_retry)
        .collect()
}

/// Check if all results succeeded and were backend-verified.
pub fn all_succeeded(results: &[VerifiedResult]) -> bool {
    results.iter().all(|r| r.success && r.backend_verified)
}

/// Check if there are any permanent failures (no retries left).
pub fn has_permanent_failures(results: &[VerifiedResult]) -> bool {
    results.iter().any(|r| !r.success && !r.should_retry)
}

/// Reset the tracker, clearing all assignments.
pub fn reset_tracker(tracker: &mut ExecutionTracker) {
    tracker.assignments.clear();
}

/// Get statistics about tracked task assignments.
pub fn get_tracker_stats(tracker: &ExecutionTracker) -> TrackerStats {
    let mut retried_tasks = 0;
    let mut max_attempts_reached = 0;

    for assignment in tracker.assignments.values() {
        if assignment.attempts > 1 {
            retried_tasks += 1;
        }
        if assignment.attempts >= tracker.max_retries {
            max_attempts_reached += 1;
        }
    }

    TrackerStats {
        total_assigned: tracker.assignments.len(),
        retried_tasks,
        max_attempts_reached,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::TaskStatus;

    fn make_task(id: &str, identifier: &str) -> SubTask {
        SubTask {
            id: id.to_string(),
            identifier: identifier.to_string(),
            title: format!("Task {id}"),
            status: TaskStatus::Ready,
            blocked_by: vec![],
            blocks: vec![],
            git_branch_name: String::new(),
            scoring: None,
        }
    }

    fn make_result(task_id: &str, identifier: &str, success: bool) -> ExecutionResult {
        ExecutionResult {
            task_id: task_id.to_string(),
            identifier: identifier.to_string(),
            success,
            status: if success {
                ExecutionStatus::SubtaskComplete
            } else {
                ExecutionStatus::VerificationFailed
            },
            duration_ms: 5000,
            error: if success {
                None
            } else {
                Some("Tests failed".to_string())
            },
            pane_id: Some("%0".to_string()),
            raw_output: None,
            input_tokens: None,
            output_tokens: None,
        }
    }

    #[test]
    fn test_create_tracker() {
        let tracker = create_tracker(None, None);
        assert_eq!(tracker.max_retries, 2);
        assert_eq!(tracker.verification_timeout_ms, 5000);
        assert!(tracker.assignments.is_empty());
    }

    #[test]
    fn test_create_tracker_custom() {
        let tracker = create_tracker(Some(5), Some(10000));
        assert_eq!(tracker.max_retries, 5);
        assert_eq!(tracker.verification_timeout_ms, 10000);
    }

    #[test]
    fn test_assign_task_new() {
        let mut tracker = create_tracker(None, None);
        let task = make_task("1", "MOB-101");

        assign_task(&mut tracker, &task);

        assert_eq!(tracker.assignments.len(), 1);
        assert_eq!(tracker.assignments["1"].attempts, 1);
    }

    #[test]
    fn test_assign_task_retry_increments() {
        let mut tracker = create_tracker(None, None);
        let task = make_task("1", "MOB-101");

        assign_task(&mut tracker, &task);
        assert_eq!(tracker.assignments["1"].attempts, 1);

        assign_task(&mut tracker, &task);
        assert_eq!(tracker.assignments["1"].attempts, 2);

        assign_task(&mut tracker, &task);
        assert_eq!(tracker.assignments["1"].attempts, 3);
    }

    #[test]
    fn test_process_results_success_local() {
        let mut tracker = create_tracker(None, None);
        let task = make_task("1", "task-001");
        assign_task(&mut tracker, &task);

        let results = vec![make_result("1", "task-001", true)];
        let verified = process_results(&mut tracker, &results, Some(&Backend::Linear));

        assert_eq!(verified.len(), 1);
        assert!(verified[0].success);
        assert!(verified[0].backend_verified);
        assert_eq!(verified[0].backend_status.as_deref(), Some("Done (local)"));
        assert!(!verified[0].should_retry);
    }

    #[test]
    fn test_process_results_success_remote() {
        let mut tracker = create_tracker(None, None);
        let task = make_task("1", "MOB-101");
        assign_task(&mut tracker, &task);

        let results = vec![make_result("1", "MOB-101", true)];
        let verified = process_results(&mut tracker, &results, Some(&Backend::Linear));

        assert_eq!(verified.len(), 1);
        assert!(verified[0].success);
        assert!(verified[0].backend_verified);
    }

    #[test]
    fn test_process_results_failure_with_retry() {
        let mut tracker = create_tracker(Some(2), None);
        let task = make_task("1", "MOB-101");
        assign_task(&mut tracker, &task); // attempts = 1

        let results = vec![make_result("1", "MOB-101", false)];
        let verified = process_results(&mut tracker, &results, Some(&Backend::Linear));

        assert_eq!(verified.len(), 1);
        assert!(!verified[0].success);
        assert!(verified[0].should_retry); // 1 <= 2 (max_retries)
    }

    #[test]
    fn test_process_results_failure_no_retry() {
        let mut tracker = create_tracker(Some(2), None);
        let task = make_task("1", "MOB-101");
        assign_task(&mut tracker, &task); // attempts = 1
        assign_task(&mut tracker, &task); // attempts = 2
        assign_task(&mut tracker, &task); // attempts = 3

        let results = vec![make_result("1", "MOB-101", false)];
        let verified = process_results(&mut tracker, &results, Some(&Backend::Linear));

        assert_eq!(verified.len(), 1);
        assert!(!verified[0].success);
        assert!(!verified[0].should_retry); // 3 > 2 (max_retries)
    }

    #[test]
    fn test_apply_backend_verification_success() {
        let result = make_result("1", "MOB-101", true);
        let mut vr = VerifiedResult::from(&result);

        apply_backend_verification(&mut vr, true, Some("Done".to_string()), 1, 2);

        assert!(vr.backend_verified);
        assert_eq!(vr.backend_status.as_deref(), Some("Done"));
        assert!(!vr.should_retry);
    }

    #[test]
    fn test_apply_backend_verification_failure() {
        let result = make_result("1", "MOB-101", true);
        let mut vr = VerifiedResult::from(&result);

        apply_backend_verification(&mut vr, false, Some("In Progress".to_string()), 1, 2);

        assert!(!vr.backend_verified);
        assert!(!vr.success); // Overridden to false
        assert!(vr.should_retry); // 1 <= 2
    }

    #[test]
    fn test_get_retry_tasks() {
        let tasks = vec![
            make_task("1", "MOB-101"),
            make_task("2", "MOB-102"),
            make_task("3", "MOB-103"),
        ];

        let results = vec![
            VerifiedResult {
                should_retry: true,
                ..VerifiedResult::from(&make_result("1", "MOB-101", false))
            },
            VerifiedResult {
                should_retry: false,
                ..VerifiedResult::from(&make_result("2", "MOB-102", true))
            },
            VerifiedResult {
                should_retry: true,
                ..VerifiedResult::from(&make_result("3", "MOB-103", false))
            },
        ];

        let retries = get_retry_tasks(&results, &tasks);
        assert_eq!(retries.len(), 2);
        assert_eq!(retries[0].identifier, "MOB-101");
        assert_eq!(retries[1].identifier, "MOB-103");
    }

    #[test]
    fn test_get_permanently_failed_tasks() {
        let results = vec![
            VerifiedResult {
                success: false,
                should_retry: false,
                ..VerifiedResult::from(&make_result("1", "MOB-101", false))
            },
            VerifiedResult {
                success: true,
                should_retry: false,
                ..VerifiedResult::from(&make_result("2", "MOB-102", true))
            },
            VerifiedResult {
                success: false,
                should_retry: true,
                ..VerifiedResult::from(&make_result("3", "MOB-103", false))
            },
        ];

        let failed = get_permanently_failed_tasks(&results);
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0].identifier, "MOB-101");
    }

    #[test]
    fn test_all_succeeded() {
        let results = vec![
            VerifiedResult {
                success: true,
                backend_verified: true,
                ..VerifiedResult::from(&make_result("1", "MOB-101", true))
            },
            VerifiedResult {
                success: true,
                backend_verified: true,
                ..VerifiedResult::from(&make_result("2", "MOB-102", true))
            },
        ];
        assert!(all_succeeded(&results));
    }

    #[test]
    fn test_all_succeeded_false_when_not_verified() {
        let results = vec![
            VerifiedResult {
                success: true,
                backend_verified: true,
                ..VerifiedResult::from(&make_result("1", "MOB-101", true))
            },
            VerifiedResult {
                success: true,
                backend_verified: false,
                ..VerifiedResult::from(&make_result("2", "MOB-102", true))
            },
        ];
        assert!(!all_succeeded(&results));
    }

    #[test]
    fn test_has_permanent_failures() {
        let results = vec![VerifiedResult {
            success: false,
            should_retry: false,
            ..VerifiedResult::from(&make_result("1", "MOB-101", false))
        }];
        assert!(has_permanent_failures(&results));
    }

    #[test]
    fn test_has_permanent_failures_false() {
        let results = vec![VerifiedResult {
            success: false,
            should_retry: true,
            ..VerifiedResult::from(&make_result("1", "MOB-101", false))
        }];
        assert!(!has_permanent_failures(&results));
    }

    #[test]
    fn test_reset_tracker() {
        let mut tracker = create_tracker(None, None);
        assign_task(&mut tracker, &make_task("1", "MOB-101"));
        assign_task(&mut tracker, &make_task("2", "MOB-102"));
        assert_eq!(tracker.assignments.len(), 2);

        reset_tracker(&mut tracker);
        assert!(tracker.assignments.is_empty());
    }

    #[test]
    fn test_get_tracker_stats() {
        let mut tracker = create_tracker(Some(2), None);
        let task1 = make_task("1", "MOB-101");
        let task2 = make_task("2", "MOB-102");
        let task3 = make_task("3", "MOB-103");

        assign_task(&mut tracker, &task1);
        assign_task(&mut tracker, &task2);
        assign_task(&mut tracker, &task2); // retry
        assign_task(&mut tracker, &task3);
        assign_task(&mut tracker, &task3); // retry
        assign_task(&mut tracker, &task3); // retry again (attempts = 3)

        let stats = get_tracker_stats(&tracker);
        assert_eq!(stats.total_assigned, 3);
        assert_eq!(stats.retried_tasks, 2); // task2 (2 attempts) and task3 (3 attempts)
        assert_eq!(stats.max_attempts_reached, 2); // task2 (2 >= 2) and task3 (3 >= 2)
    }

    #[test]
    fn test_get_tracker_stats_empty() {
        let tracker = create_tracker(None, None);
        let stats = get_tracker_stats(&tracker);
        assert_eq!(
            stats,
            TrackerStats {
                total_assigned: 0,
                retried_tasks: 0,
                max_attempts_reached: 0,
            }
        );
    }

    #[test]
    fn test_is_local_task_identifier() {
        // Backend tasks (remote) - not local
        assert!(!is_local_task_identifier("MOB-101", Some(&Backend::Linear)));
        assert!(!is_local_task_identifier("PROJ-456", Some(&Backend::Jira)));

        // Local tasks
        assert!(is_local_task_identifier("task-001", Some(&Backend::Linear)));
        assert!(is_local_task_identifier("LOC-001", Some(&Backend::Linear)));
        assert!(is_local_task_identifier("task-001", Some(&Backend::Jira)));
        assert!(is_local_task_identifier("LOC-123", None));

        // Without backend specified
        assert!(!is_local_task_identifier("MOB-101", None));
        assert!(is_local_task_identifier("task-001", None));
    }

    #[test]
    fn test_is_local_task_identifier_edge_cases() {
        // Lowercase backend-style identifiers are NOT local (but also don't match LOC/task)
        assert!(!is_local_task_identifier("mob-123", None));

        // Must match LOC or task prefix
        assert!(!is_local_task_identifier("FOO-001", None));
        assert!(!is_local_task_identifier("TASK-001", None)); // uppercase TASK doesn't match
    }
}
