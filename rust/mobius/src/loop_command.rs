//! Loop command orchestrator for parallel sub-task execution.
//!
//! Coordinates worktree isolation, tmux-based agent spawning, task graph
//! management, and runtime state updates. Ported from `src/commands/loop.ts`.

use std::process;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;
use chrono::Utc;
use colored::Colorize;

use crate::config;
use crate::context;
use crate::executor;
use crate::local_state;
use crate::tmux;
use crate::tracker;
use crate::tree_renderer;
use crate::types::context::{RuntimeActiveTask, RuntimeState};
use crate::types::enums::{Backend, Model, SessionStatus, TaskStatus};
use crate::types::task_graph::{
    build_task_graph, get_blocked_tasks, get_graph_stats, get_ready_tasks,
    get_verification_task, update_task_status, TaskGraph,
};
use crate::worktree::{self, WorktreeConfig};

/// Options passed from CLI to the loop orchestrator.
pub struct LoopOptions {
    pub task_id: String,
    pub no_sandbox: bool,
    pub backend: Option<String>,
    pub model: Option<String>,
    pub parallel: Option<u32>,
    pub max_iterations: Option<u32>,
    pub fresh: bool,
    pub debug: Option<Option<String>>,
    pub no_submit: bool,
}

/// Maximum number of VG fast-completion retries to prevent infinite loops.
const MAX_VG_FAST_RETRIES: u32 = 3;

/// Minimum VG duration (ms) considered valid; below this triggers a retry.
const VG_MIN_DURATION_MS: u64 = 5000;

/// Main loop orchestrator entry point.
pub async fn run_loop(options: LoopOptions) -> Result<()> {
    // -----------------------------------------------------------------------
    // 1. Resolve configuration
    // -----------------------------------------------------------------------
    let paths = config::resolve_paths();
    let loop_config = match config::read_config(&paths.config_path) {
        Ok(c) => c,
        Err(_) => {
            eprintln!(
                "{}",
                "Warning: Could not read config, using defaults.".yellow()
            );
            crate::types::config::LoopConfig::default()
        }
    };

    // -----------------------------------------------------------------------
    // 2. Resolve backend
    // -----------------------------------------------------------------------
    let backend = if let Some(ref b) = options.backend {
        Backend::from_str(b).unwrap_or_else(|e| {
            eprintln!("{}", format!("Error: {e}").red());
            process::exit(1);
        })
    } else {
        context::detect_backend(None)
    };

    // -----------------------------------------------------------------------
    // 3. Build execution config with CLI overrides
    // -----------------------------------------------------------------------
    let mut exec_config = loop_config.execution.clone();
    if let Some(p) = options.parallel {
        exec_config.max_parallel_agents = Some(p);
    }
    if let Some(ref m) = options.model {
        exec_config.model = Model::from_str(m).unwrap_or_else(|e| {
            eprintln!("{}", format!("Error: {e}").red());
            process::exit(1);
        });
    }
    if options.no_sandbox {
        exec_config.sandbox = false;
    }

    let max_iterations = options
        .max_iterations
        .unwrap_or(exec_config.max_iterations);

    // -----------------------------------------------------------------------
    // 4. Check tmux availability
    // -----------------------------------------------------------------------
    let tmux_check = tokio::process::Command::new("which")
        .arg("tmux")
        .output()
        .await;
    if tmux_check.map(|o| !o.status.success()).unwrap_or(true) {
        eprintln!(
            "{}",
            "Error: tmux is required for parallel execution mode".red()
        );
        eprintln!(
            "{}",
            "Install with: brew install tmux (macOS) or apt install tmux (Linux)".dimmed()
        );
        process::exit(1);
    }

    // -----------------------------------------------------------------------
    // 5. Signal handling — register SIGINT/SIGTERM cleanup
    // -----------------------------------------------------------------------
    let task_id = options.task_id.clone();
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_flag = shutdown.clone();
    let cleanup_task_id = task_id.clone();
    tokio::spawn(async move {
        tokio::signal::ctrl_c().await.ok();
        shutdown_flag.store(true, Ordering::SeqCst);
        context::clear_all_runtime_active_tasks(&cleanup_task_id);
        eprintln!("\nReceived interrupt, cleaning up...");
        process::exit(130);
    });

    // -----------------------------------------------------------------------
    // 6. Clear stale state if --fresh
    // -----------------------------------------------------------------------
    if options.fresh {
        let deleted = context::delete_runtime_state(&task_id);
        if deleted {
            println!("{}", "Cleared stale state from previous execution.".yellow());
        }
    }

    println!(
        "{}",
        format!("Starting parallel loop for {task_id}...").blue()
    );

    // -----------------------------------------------------------------------
    // 7. Fetch parent issue from local state
    // -----------------------------------------------------------------------
    let parent_spec = local_state::read_parent_spec(&task_id);
    let (parent_id, parent_identifier, parent_title, branch_name) = match parent_spec {
        Some(ref p) => {
            let branch = if p.git_branch_name.is_empty() {
                format!("feat/{}", task_id.to_lowercase())
            } else {
                p.git_branch_name.clone()
            };
            (
                p.id.clone(),
                p.identifier.clone(),
                p.title.clone(),
                branch,
            )
        }
        None => {
            eprintln!(
                "{}",
                format!("Error: Could not fetch issue {task_id}").red()
            );
            eprintln!(
                "{}",
                "Ensure local task files exist in .mobius/issues/<task_id>/".dimmed()
            );
            process::exit(1);
        }
    };

    println!("{}", format!("Issue: {parent_title}").dimmed());
    println!("{}", format!("Branch: {branch_name}").dimmed());

    // -----------------------------------------------------------------------
    // 8. Create or resume worktree
    // -----------------------------------------------------------------------
    let wt_config = WorktreeConfig {
        worktree_path: exec_config.worktree_path.clone(),
        base_branch: exec_config.base_branch.clone(),
    };
    let worktree_info = worktree::create_worktree(&task_id, &branch_name, &wt_config).await?;

    if worktree_info.created {
        println!(
            "{}",
            format!("Created worktree at {}", worktree_info.path.display()).green()
        );
    } else {
        println!(
            "{}",
            format!(
                "Resuming existing worktree at {}",
                worktree_info.path.display()
            )
            .yellow()
        );
    }

    let worktree_path = worktree_info.path.to_string_lossy().to_string();

    // -----------------------------------------------------------------------
    // 9. Create tmux session
    // -----------------------------------------------------------------------
    let session_name = tmux::get_session_name(&task_id);
    let session = match tmux::create_session(&session_name).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("{}", "Error: Failed to create tmux session".red());
            eprintln!("{}", format!("{e}").dimmed());
            process::exit(1);
        }
    };
    let _status_pane = tmux::create_status_pane(&session).await?;
    println!(
        "{}",
        format!("Created tmux session: {session_name}").green()
    );

    // -----------------------------------------------------------------------
    // 10. Build initial task graph
    // -----------------------------------------------------------------------
    let issues = local_state::read_local_subtasks_as_linear_issues(&task_id);
    if issues.is_empty() {
        eprintln!(
            "{}",
            format!("No sub-tasks found for {task_id}").yellow()
        );
        tmux::destroy_session(&session).await?;
        process::exit(1);
    }
    println!(
        "{}",
        format!(
            "Reading sub-tasks from local state ({} found)",
            issues.len()
        )
        .dimmed()
    );
    let mut graph = build_task_graph(&parent_id, &parent_identifier, &issues);

    // -----------------------------------------------------------------------
    // 11. Generate context for skills
    // -----------------------------------------------------------------------
    println!("{}", "Generating local context for skills...".dimmed());
    let issue_context = context::generate_context(&task_id, Some(&worktree_path), false)?;
    let context_file_path = match issue_context {
        Some(ref ctx) => {
            let path = context::write_full_context_file(&task_id, ctx)?;
            println!("{}", format!("Context file: {path}").dimmed());
            Some(path)
        }
        None => {
            eprintln!("{}", "Warning: Failed to generate issue context".yellow());
            None
        }
    };

    // -----------------------------------------------------------------------
    // 12. Display initial tree
    // -----------------------------------------------------------------------
    println!();
    println!("{}", tree_renderer::render_full_tree_output(&graph));
    println!();

    // -----------------------------------------------------------------------
    // 13. Create execution session + initialize runtime state
    // -----------------------------------------------------------------------
    context::create_session(&task_id, backend, Some(&worktree_path))?;

    let total_tasks = graph.tasks.len() as u32;
    let mut runtime_state =
        context::initialize_runtime_state(&task_id, &parent_title, Some(process::id()), Some(total_tasks))?;

    // Pre-populate completed tasks from graph
    for task in graph.tasks.values() {
        if task.status == TaskStatus::Done {
            runtime_state = context::complete_runtime_task(&runtime_state, &task.identifier);
        }
    }
    // Write the pre-populated state
    context::write_runtime_state(&runtime_state)?;

    // -----------------------------------------------------------------------
    // 14. Create execution tracker
    // -----------------------------------------------------------------------
    let mut tracker = tracker::create_tracker(
        exec_config.max_retries,
        exec_config
            .verification_timeout
            .map(|v| v as u64),
    );

    // -----------------------------------------------------------------------
    // MAIN LOOP
    // -----------------------------------------------------------------------
    let start_time = Instant::now();
    let mut iteration: u32 = 0;
    let mut all_complete = false;
    let mut any_failed = false;
    let mut retry_queue: Vec<crate::types::SubTask> = Vec::new();
    let mut vg_fast_retry_count: u32 = 0;

    let loop_result: Result<()> = async {
        while iteration < max_iterations {
            if shutdown.load(Ordering::SeqCst) {
                break;
            }

            iteration += 1;

            // Re-sync graph from local state
            graph = sync_graph_from_local(&graph, &parent_id, &parent_identifier, &task_id);

            // Check if verification task is complete
            if let Some(vt) = get_verification_task(&graph) {
                if vt.status == TaskStatus::Done {
                    all_complete = true;
                    println!(
                        "{}",
                        "\nVerification task completed successfully!".green()
                    );
                    println!(
                        "{}",
                        format!("  {}: {}", vt.identifier, vt.title).green()
                    );
                    break;
                }
            }

            // Get ready tasks, merge retry queue
            let graph_ready = get_ready_tasks(&graph);
            let mut ready_tasks: Vec<crate::types::SubTask> =
                graph_ready.into_iter().cloned().collect();

            for retry_task in &retry_queue {
                if let Some(current) = graph.tasks.get(&retry_task.id) {
                    if current.status == TaskStatus::Done {
                        continue;
                    }
                }
                if !ready_tasks.iter().any(|t| t.id == retry_task.id) {
                    ready_tasks.push(retry_task.clone());
                }
            }
            retry_queue.clear();

            let stats = get_graph_stats(&graph);

            // Check all done
            if stats.done == stats.total {
                all_complete = true;
                println!("{}", "\nAll tasks completed!".green());
                break;
            }

            // Check no ready tasks
            if ready_tasks.is_empty() {
                let blocked = get_blocked_tasks(&graph);
                if !blocked.is_empty() {
                    println!(
                        "{}",
                        "\nNo tasks ready. All remaining tasks are blocked.".yellow()
                    );
                    let ids: Vec<&str> =
                        blocked.iter().map(|t| t.identifier.as_str()).collect();
                    println!("{}", format!("Blocked: {}", ids.join(", ")).dimmed());
                }
                break;
            }

            // Calculate parallelism and slice batch
            let parallel_count =
                executor::calculate_parallelism(ready_tasks.len(), &exec_config);
            let tasks_to_execute: Vec<crate::types::SubTask> =
                ready_tasks.into_iter().take(parallel_count).collect();

            println!(
                "{}",
                format!(
                    "\nIteration {iteration}: Executing {} task(s) in parallel...",
                    tasks_to_execute.len()
                )
                .blue()
            );
            let task_ids_str: Vec<&str> = tasks_to_execute
                .iter()
                .map(|t| t.identifier.as_str())
                .collect();
            println!(
                "{}",
                format!("  Tasks: {}", task_ids_str.join(", ")).dimmed()
            );

            // Assign tasks to tracker
            for task in &tasks_to_execute {
                tracker::assign_task(&mut tracker, task);
            }

            // Update runtime state with active tasks
            let now = Utc::now().to_rfc3339();
            for task in &tasks_to_execute {
                runtime_state = context::add_runtime_active_task(
                    &runtime_state,
                    RuntimeActiveTask {
                        id: task.identifier.clone(),
                        pid: 0,
                        pane: String::new(),
                        started_at: now.clone(),
                        worktree: Some(worktree_path.clone()),
                        tokens: None,
                    },
                );
            }
            context::write_runtime_state(&runtime_state)?;

            // Update tmux status pane
            let blocked_ids: Vec<String> = get_blocked_tasks(&graph)
                .iter()
                .map(|t| t.identifier.clone())
                .collect();
            let loop_status = tmux::LoopStatus {
                total_tasks: stats.total,
                completed_tasks: stats.done,
                active_agents: tasks_to_execute
                    .iter()
                    .map(|t| tmux::ActiveAgent {
                        task_id: t.id.clone(),
                        identifier: t.identifier.clone(),
                    })
                    .collect(),
                blocked_tasks: blocked_ids,
                elapsed_ms: start_time.elapsed().as_millis() as u64,
            };
            tmux::update_status_pane(&loop_status, &session_name).await?;

            // Execute tasks in parallel
            let ctx_path_ref = context_file_path.as_deref();
            let results = executor::execute_parallel(
                &tasks_to_execute,
                &exec_config,
                &worktree_path,
                &session,
                ctx_path_ref,
                None,
            )
            .await;

            // Update runtime state with real pane IDs
            for result in &results {
                if let Some(ref pane_id) = result.pane_id {
                    runtime_state = context::update_runtime_task_pane(
                        &runtime_state,
                        &result.identifier,
                        pane_id,
                    );
                }
            }
            context::write_runtime_state(&runtime_state)?;

            // Verify results via tracker
            let verified_results = tracker::process_results(
                &mut tracker,
                &results,
                Some(&backend),
            );

            // Collect retry tasks from tracker
            let need_retry =
                tracker::get_retry_tasks(&verified_results, &tasks_to_execute);
            let verified_count = verified_results
                .iter()
                .filter(|r| r.success && r.backend_verified)
                .count();
            let retry_count = need_retry.len();
            let permanent_fail_count = verified_results
                .iter()
                .filter(|r| !r.success && !r.should_retry)
                .count();

            println!(
                "{}",
                format!(
                    "Verified: {verified_count}/{} | Retry: {retry_count} | Failed: {permanent_fail_count}",
                    verified_results.len()
                )
                .dimmed()
            );

            // Process each verified result
            for result in &verified_results {
                let result_tokens = extract_result_total_tokens(&results, &result.identifier);

                if result.success && result.backend_verified {
                    // VG fast-completion check
                    let is_vg_task = result.identifier.to_lowercase().contains("vg")
                        || graph
                            .tasks
                            .values()
                            .find(|t| t.identifier == result.identifier)
                            .map(|t| {
                                t.title.to_lowercase().contains("verification gate")
                            })
                            .unwrap_or(false);

                    if is_vg_task
                        && result.duration_ms < VG_MIN_DURATION_MS
                        && vg_fast_retry_count < MAX_VG_FAST_RETRIES
                    {
                        vg_fast_retry_count += 1;
                        println!(
                            "{}",
                            format!(
                                "  VG task {} completed in {}ms (< 5s). Queuing for retry ({}/{}).",
                                result.identifier,
                                result.duration_ms,
                                vg_fast_retry_count,
                                MAX_VG_FAST_RETRIES
                            )
                            .yellow()
                        );
                        graph = update_task_status(&graph, &result.task_id, TaskStatus::Ready);
                        if let Some(task) = tasks_to_execute
                            .iter()
                            .find(|t| t.identifier == result.identifier)
                        {
                            if !retry_queue.iter().any(|t| t.identifier == result.identifier) {
                                retry_queue.push(task.clone());
                            }
                        }
                        runtime_state = apply_runtime_transition(
                            &runtime_state,
                            &result.identifier,
                            result_tokens,
                            RuntimeTaskTransition::Retry,
                        );
                        continue;
                    }

                    // Mark done
                    graph = update_task_status(&graph, &result.task_id, TaskStatus::Done);
                    runtime_state = apply_runtime_transition(
                        &runtime_state,
                        &result.identifier,
                        result_tokens,
                        RuntimeTaskTransition::Complete,
                    );
                    local_state::update_subtask_status(&task_id, &result.identifier, "done");
                    println!(
                        "{}",
                        format!(
                            "  {} {} ({})",
                            "\u{2713}",
                            result.identifier,
                            result
                                .backend_status
                                .as_deref()
                                .unwrap_or("done")
                        )
                        .green()
                    );
                } else if result.should_retry {
                    runtime_state = apply_runtime_transition(
                        &runtime_state,
                        &result.identifier,
                        result_tokens,
                        RuntimeTaskTransition::Retry,
                    );
                    println!(
                        "{}",
                        format!(
                            "  \u{21bb} {}: Retrying ({})",
                            result.identifier,
                            result.error.as_deref().unwrap_or("verification pending")
                        )
                        .yellow()
                    );
                } else {
                    // Permanent failure — check if pane still running
                    let pane_running = if let Some(ref pane_id) = result.pane_id {
                        executor::is_pane_still_running(pane_id).await
                    } else {
                        false
                    };

                    if pane_running {
                        // Pane still active, queue for retry
                        if let Some(task) = tasks_to_execute
                            .iter()
                            .find(|t| t.identifier == result.identifier)
                        {
                            if !retry_queue.iter().any(|t| t.identifier == result.identifier) {
                                retry_queue.push(task.clone());
                            }
                        }
                        runtime_state = apply_runtime_transition(
                            &runtime_state,
                            &result.identifier,
                            result_tokens,
                            RuntimeTaskTransition::Retry,
                        );
                        println!(
                            "{}",
                            format!(
                                "  \u{21bb} {}: Pane still active, queuing retry",
                                result.identifier
                            )
                            .yellow()
                        );
                    } else {
                        // Actual permanent failure
                        runtime_state = apply_runtime_transition(
                            &runtime_state,
                            &result.identifier,
                            result_tokens,
                            RuntimeTaskTransition::Failed,
                        );
                        println!(
                            "{}",
                            format!(
                                "  \u{2717} {}: {}",
                                result.identifier,
                                result.error.as_deref().unwrap_or(&format!("{:?}", result.status))
                            )
                            .red()
                        );
                    }
                }
            }

            // Merge retry tasks from tracker
            for task in need_retry {
                if !retry_queue.iter().any(|t| t.id == task.id) {
                    retry_queue.push(task.clone());
                }
            }

            // Write updated runtime state
            context::write_runtime_state(&runtime_state)?;

            // Check for permanent failures
            if tracker::has_permanent_failures(&verified_results) {
                any_failed = true;
                println!(
                    "{}",
                    "\nStopping due to permanent task failure (max retries exceeded).".red()
                );
                break;
            }

            // Write iteration log entries
            let iteration_ts = Utc::now().to_rfc3339();
            for result in &verified_results {
                let status = if result.success && result.backend_verified {
                    local_state::IterationStatus::Success
                } else if result.should_retry {
                    local_state::IterationStatus::Partial
                } else {
                    local_state::IterationStatus::Failed
                };
                let entry = local_state::IterationLogEntry {
                    subtask_id: result.identifier.clone(),
                    attempt: iteration,
                    started_at: iteration_ts.clone(),
                    completed_at: Some(Utc::now().to_rfc3339()),
                    status,
                    error: result.error.clone(),
                    files_modified: None,
                    commit_hash: None,
                };
                if let Err(e) = local_state::write_iteration_log(&task_id, entry) {
                    eprintln!(
                        "{}",
                        format!("Warning: Failed to write iteration log: {e}").yellow()
                    );
                }
            }

            // Re-render tree
            println!();
            println!("{}", tree_renderer::render_full_tree_output(&graph));
        }

        Ok(())
    }
    .await;

    // -----------------------------------------------------------------------
    // CLEANUP PHASE
    // -----------------------------------------------------------------------
    let elapsed = start_time.elapsed();
    let final_stats = get_graph_stats(&graph);

    println!();
    println!("{}", "Loop completed:".bold());
    println!("  Iterations: {iteration}");
    println!(
        "  Tasks: {}/{} completed",
        final_stats.done, final_stats.total
    );
    println!("  Time: {}", format_elapsed(elapsed.as_millis() as u64));

    // Clear active tasks
    context::clear_all_runtime_active_tasks(&task_id);

    // End session
    if all_complete {
        context::end_session(&task_id, SessionStatus::Completed);
    } else if any_failed || loop_result.is_err() {
        context::end_session(&task_id, SessionStatus::Failed);
    }

    // Handle loop error
    if let Err(ref e) = loop_result {
        eprintln!("{}", format!("\nLoop error: {e}").red());
        println!(
            "{}",
            format!("\nWorktree preserved for debugging at:\n  {worktree_path}").yellow()
        );
        println!(
            "{}",
            format!("tmux session preserved. Attach with:\n  tmux attach -t {session_name}")
                .yellow()
        );
        return loop_result;
    }

    // Auto-submit (deferred — print message instead)
    if all_complete && !options.no_submit {
        println!(
            "{}",
            "\nAll tasks complete. Run `mobius submit` to create a pull request.".dimmed()
        );
    }

    // Cleanup on success
    if all_complete && exec_config.cleanup_on_success != Some(false) {
        println!("{}", "\nCleaning up worktree...".dimmed());
        if let Err(e) = worktree::remove_worktree(&task_id, &wt_config).await {
            eprintln!(
                "{}",
                format!("Warning: Failed to remove worktree: {e}").yellow()
            );
        } else {
            println!("{}", "Worktree removed.".green());
        }

        if let Err(e) = tmux::destroy_session(&session).await {
            eprintln!(
                "{}",
                format!("Warning: Failed to destroy tmux session: {e}").yellow()
            );
        } else {
            println!("{}", "tmux session destroyed.".green());
        }
    } else if any_failed {
        println!(
            "{}",
            format!("\nWorktree preserved for debugging at:\n  {worktree_path}").yellow()
        );
        println!(
            "{}",
            format!("tmux session preserved. Attach with:\n  tmux attach -t {session_name}")
                .yellow()
        );
    } else {
        // Not all complete, not failed (e.g., all blocked)
        println!(
            "{}",
            format!("\nWorktree preserved at:\n  {worktree_path}").yellow()
        );
        println!(
            "{}",
            format!("tmux session:\n  tmux attach -t {session_name}").yellow()
        );
    }

    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeTaskTransition {
    Complete,
    Retry,
    Failed,
}

fn extract_result_total_tokens(
    results: &[executor::ExecutionResult],
    task_identifier: &str,
) -> Option<u64> {
    results
        .iter()
        .find(|result| result.identifier == task_identifier)
        .and_then(|result| result.token_usage.as_ref())
        .and_then(|usage| usage.total_tokens)
}

fn apply_runtime_transition(
    state: &RuntimeState,
    task_id: &str,
    tokens: Option<u64>,
    transition: RuntimeTaskTransition,
) -> RuntimeState {
    let merged_state = context::update_runtime_task_tokens(state, task_id, tokens);

    match transition {
        RuntimeTaskTransition::Complete => context::complete_runtime_task(&merged_state, task_id),
        RuntimeTaskTransition::Retry => context::remove_runtime_active_task(&merged_state, task_id),
        RuntimeTaskTransition::Failed => context::fail_runtime_task(&merged_state, task_id),
    }
}

/// Re-sync the task graph from local state files.
///
/// Reads fresh subtask status from `.mobius/issues/{id}/tasks/*.json`.
/// Falls back to the existing graph on read failure.
fn sync_graph_from_local(
    graph: &TaskGraph,
    parent_id: &str,
    parent_identifier: &str,
    task_id: &str,
) -> TaskGraph {
    let local_issues = local_state::read_local_subtasks_as_linear_issues(task_id);
    if local_issues.is_empty() {
        return graph.clone();
    }
    build_task_graph(parent_id, parent_identifier, &local_issues)
}

/// Format elapsed milliseconds as a human-readable string.
fn format_elapsed(ms: u64) -> String {
    let seconds = ms / 1000;
    let minutes = seconds / 60;
    let hours = minutes / 60;

    if hours > 0 {
        format!("{}h {}m {}s", hours, minutes % 60, seconds % 60)
    } else if minutes > 0 {
        format!("{}m {}s", minutes, seconds % 60)
    } else {
        format!("{}s", seconds)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::context::RuntimeActiveTask;

    fn make_state() -> RuntimeState {
        RuntimeState {
            parent_id: "MOB-263".to_string(),
            parent_title: "Parent".to_string(),
            active_tasks: Vec::new(),
            completed_tasks: Vec::new(),
            failed_tasks: Vec::new(),
            started_at: "2026-02-06T00:00:00Z".to_string(),
            updated_at: "2026-02-06T00:00:00Z".to_string(),
            loop_pid: None,
            total_tasks: Some(3),
            tokens: None,
            backend_statuses: None,
        }
    }

    fn make_active_task(id: &str) -> RuntimeActiveTask {
        RuntimeActiveTask {
            id: id.to_string(),
            pid: 0,
            pane: "%1".to_string(),
            started_at: "2026-02-06T00:00:01Z".to_string(),
            worktree: Some("/tmp/worktree".to_string()),
            tokens: None,
        }
    }

    fn failed_task_tokens(state: &RuntimeState, id: &str) -> Option<u64> {
        state.failed_tasks.iter().find_map(|entry| {
            serde_json::from_value::<RuntimeActiveTask>(entry.clone())
                .ok()
                .filter(|task| task.id == id)
                .and_then(|task| task.tokens)
        })
    }

    #[test]
    fn test_format_elapsed_seconds() {
        assert_eq!(format_elapsed(5000), "5s");
        assert_eq!(format_elapsed(45000), "45s");
    }

    #[test]
    fn test_format_elapsed_minutes() {
        assert_eq!(format_elapsed(65000), "1m 5s");
        assert_eq!(format_elapsed(600000), "10m 0s");
    }

    #[test]
    fn test_format_elapsed_hours() {
        assert_eq!(format_elapsed(3665000), "1h 1m 5s");
    }

    #[test]
    fn test_apply_runtime_transition_complete_updates_completed_tokens_and_totals() {
        let mut state = make_state();
        state.active_tasks.push(make_active_task("task-006"));

        let state = apply_runtime_transition(
            &state,
            "task-006",
            Some(120),
            RuntimeTaskTransition::Complete,
        );

        assert!(state.active_tasks.is_empty());
        assert_eq!(state.tokens, Some(120));

        let completed = context::normalize_completed_task(&state.completed_tasks[0]);
        assert_eq!(completed.id, "task-006");
        assert_eq!(completed.tokens, Some(120));
    }

    #[test]
    fn test_apply_runtime_transition_retry_removes_active_and_keeps_state_coherent() {
        let mut state = make_state();
        state.active_tasks.push(make_active_task("task-006"));

        let state = apply_runtime_transition(
            &state,
            "task-006",
            Some(45),
            RuntimeTaskTransition::Retry,
        );

        assert!(state.active_tasks.is_empty());
        assert!(state.completed_tasks.is_empty());
        assert!(state.failed_tasks.is_empty());
        assert_eq!(state.tokens, None);
    }

    #[test]
    fn test_apply_runtime_transition_failure_records_task_tokens() {
        let mut state = make_state();
        state.active_tasks.push(make_active_task("task-006"));

        let state = apply_runtime_transition(
            &state,
            "task-006",
            Some(33),
            RuntimeTaskTransition::Failed,
        );

        assert!(state.active_tasks.is_empty());
        assert_eq!(state.failed_tasks.len(), 1);
        assert_eq!(state.tokens, Some(33));
        assert_eq!(failed_task_tokens(&state, "task-006"), Some(33));
    }

    #[test]
    fn test_apply_runtime_transition_mixed_outcomes_accumulates_totals() {
        let mut state = make_state();
        state.active_tasks.push(make_active_task("task-a"));
        state = apply_runtime_transition(
            &state,
            "task-a",
            Some(10),
            RuntimeTaskTransition::Complete,
        );

        state.active_tasks.push(make_active_task("task-b"));
        state = apply_runtime_transition(&state, "task-b", Some(20), RuntimeTaskTransition::Retry);

        state.active_tasks.push(make_active_task("task-c"));
        state = apply_runtime_transition(&state, "task-c", Some(30), RuntimeTaskTransition::Failed);

        assert!(state.active_tasks.is_empty());
        assert_eq!(state.completed_tasks.len(), 1);
        assert_eq!(state.failed_tasks.len(), 1);
        assert_eq!(state.tokens, Some(40));
    }

    #[test]
    fn test_extract_result_total_tokens_prefers_matching_identifier() {
        let results = vec![
            executor::ExecutionResult {
                task_id: "1".to_string(),
                identifier: "task-001".to_string(),
                success: true,
                status: executor::ExecutionStatus::SubtaskComplete,
                token_usage: Some(executor::TokenUsage {
                    input_tokens: Some(10),
                    output_tokens: Some(20),
                    total_tokens: Some(30),
                }),
                duration_ms: 1,
                error: None,
                pane_id: None,
                raw_output: None,
            },
            executor::ExecutionResult {
                task_id: "2".to_string(),
                identifier: "task-006".to_string(),
                success: true,
                status: executor::ExecutionStatus::SubtaskComplete,
                token_usage: Some(executor::TokenUsage {
                    input_tokens: Some(1),
                    output_tokens: Some(2),
                    total_tokens: Some(3),
                }),
                duration_ms: 1,
                error: None,
                pane_id: None,
                raw_output: None,
            },
        ];

        assert_eq!(extract_result_total_tokens(&results, "task-006"), Some(3));
    }
}
