//! Loop command - Main parallel orchestrator for task execution
//!
//! Orchestrates parallel execution of sub-tasks with worktree isolation
//! and tmux-based display.

use colored::Colorize;

use crate::config::loader::read_config;
use crate::config::paths::resolve_paths;
use crate::context::{
    add_runtime_active_task, clear_all_runtime_active_tasks, complete_runtime_task,
    create_session as create_mobius_session, delete_runtime_state, end_session, generate_context,
    initialize_runtime_state, update_runtime_task_pane, update_runtime_task_tokens,
    write_full_context_file, write_runtime_state,
};
use crate::executor::{calculate_parallelism, execute_parallel};
use crate::jira::JiraClient;
use crate::types::task_graph::ParentIssue;
use crate::local_state::{
    read_local_subtasks_as_linear_issues, read_parent_spec, read_subtasks, update_subtask_status,
    write_iteration_log, IterationLogEntry, IterationStatus,
};
use crate::tmux::{
    create_session, create_status_pane, destroy_session, get_session_name, update_status_pane,
    LoopStatus, TmuxSession,
};
use crate::tracker::{assign_task, create_tracker, get_retry_tasks, has_permanent_failures, process_results};
use crate::tree_renderer::render_full_tree_output;
use crate::types::context::{RuntimeActiveTask, RuntimeState};
use crate::types::enums::{Backend, SessionStatus, TaskStatus};
use crate::types::task_graph::{
    build_task_graph, get_blocked_tasks, get_graph_stats, get_ready_tasks,
    get_verification_task, update_task_status, SubTask,
};
use crate::worktree::{create_worktree, remove_worktree, WorktreeConfig};

use super::push::push_pending_updates_for_task;
use super::submit;

pub struct LoopOptions<'a> {
    pub backend_override: Option<&'a str>,
    pub model_override: Option<&'a str>,
    pub parallel_override: Option<u32>,
    pub max_iterations_override: Option<u32>,
    pub fresh: bool,
    pub no_submit: bool,
    pub no_tui: bool,
}

pub fn run(task_id: &str, opts: &LoopOptions<'_>) -> anyhow::Result<()> {
    let backend_override = opts.backend_override;
    let model_override = opts.model_override;
    let parallel_override = opts.parallel_override;
    let max_iterations_override = opts.max_iterations_override;
    let fresh = opts.fresh;
    let no_submit = opts.no_submit;

    if !opts.no_tui {
        return run_with_tui(
            task_id,
            backend_override,
            model_override,
            parallel_override,
            max_iterations_override,
            fresh,
            no_submit,
        );
    }

    let paths = resolve_paths();
    let config = read_config(&paths.config_path).unwrap_or_default();
    let backend: Backend = if let Some(b) = backend_override {
        b.parse().unwrap_or(config.backend)
    } else {
        config.backend
    };

    // Validate task ID format
    if !validate_task_id(task_id, &backend) {
        eprintln!(
            "{}",
            format!(
                "Error: Invalid task ID format for {}: {}",
                backend, task_id
            )
            .red()
        );
        eprintln!(
            "{}",
            "Expected format: PREFIX-NUMBER (e.g., MOB-123)".dimmed()
        );
        std::process::exit(1);
    }

    // Check for tmux availability
    if which::which("tmux").is_err() {
        eprintln!(
            "{}",
            "Error: tmux is required for parallel execution mode".red()
        );
        eprintln!(
            "{}",
            "Install with: brew install tmux (macOS) or apt install tmux (Linux)".dimmed()
        );
        eprintln!(
            "{}",
            "Alternatively, use '--sequential' flag for sequential execution.".dimmed()
        );
        std::process::exit(1);
    }

    // Apply option overrides to config
    let mut execution_config = config.execution.clone();
    if let Some(p) = parallel_override {
        execution_config.max_parallel_agents = Some(p);
    }
    if let Some(m) = model_override {
        if let Ok(model) = m.parse() {
            execution_config.model = model;
        }
    }

    let max_iterations = max_iterations_override.unwrap_or(config.execution.max_iterations);

    // Set up signal handlers
    let task_id_for_signal = task_id.to_string();
    ctrlc_handler(&task_id_for_signal);

    // Clear stale state if --fresh flag
    if fresh {
        let deleted = delete_runtime_state(task_id);
        if deleted {
            println!(
                "{}",
                "Cleared stale state from previous execution.".yellow()
            );
        }
    }

    println!(
        "{}",
        format!("Starting parallel loop for {}...", task_id).blue()
    );

    // Fetch parent issue
    let rt = tokio::runtime::Runtime::new()?;

    let parent_issue = match rt.block_on(fetch_parent_issue(task_id, &backend)) {
        Ok(issue) => issue,
        Err(cause) => {
            eprintln!(
                "{}",
                format!("Error: Could not fetch issue {}", task_id).red()
            );
            eprintln!(
                "{}",
                format!("  Cause: {}", cause).red()
            );
            std::process::exit(1);
        }
    };

    // Derive branch name with fallback when Linear/backend doesn't provide one
    let branch_name = if parent_issue.git_branch_name.is_empty() {
        format!("feat/{}", task_id.to_lowercase())
    } else {
        parent_issue.git_branch_name.clone()
    };

    println!("{}", format!("Issue: {}", parent_issue.title).dimmed());
    println!("{}", format!("Branch: {}", branch_name).dimmed());

    // Create or resume worktree
    let worktree_config = WorktreeConfig {
        worktree_path: execution_config.worktree_path.clone(),
        base_branch: execution_config.base_branch.clone(),
    };
    let worktree_info = rt.block_on(create_worktree(
        task_id,
        &branch_name,
        &worktree_config,
    ))?;

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

    // Create tmux session
    let session_name = get_session_name(task_id);
    let session: TmuxSession = rt.block_on(create_session(&session_name))?;
    let _status_pane = rt.block_on(create_status_pane(&session))?;
    println!(
        "{}",
        format!("Created tmux session: {}", session_name).green()
    );

    // Build initial task graph from local state
    let issues = read_local_subtasks_as_linear_issues(task_id);
    if issues.is_empty() {
        eprintln!(
            "{}",
            format!("No sub-tasks found for {}", task_id).yellow()
        );
        rt.block_on(destroy_session(&session))?;
        std::process::exit(1);
    }

    let mut graph = build_task_graph(&parent_issue.id, &parent_issue.identifier, &issues);

    // Generate local context for skills to read
    println!("{}", "Generating local context for skills...".dimmed());
    let parent_spec = read_parent_spec(task_id);
    let _sub_tasks = read_subtasks(task_id);

    if parent_spec.is_some() {
        match generate_context(task_id, None, false) {
            Ok(Some(context)) => {
                match write_full_context_file(task_id, &context) {
                    Ok(path) => println!("{}", format!("Context file: {}", path).dimmed()),
                    Err(e) => eprintln!("{}", format!("Warning: Failed to write context file: {}", e).yellow()),
                }
            }
            Ok(None) => {
                eprintln!(
                    "{}",
                    "Warning: generate_context returned None".yellow()
                );
            }
            Err(e) => {
                eprintln!(
                    "{}",
                    format!("Warning: Failed to generate context: {}", e).yellow()
                );
            }
        }
    }

    // Display ASCII tree
    println!();
    println!("{}", render_full_tree_output(&graph));
    println!();

    // Track loop state
    let start_time = std::time::Instant::now();
    let mut iteration = 0u32;
    let mut all_complete = false;
    let mut any_failed = false;

    // Initialize execution tracker
    let mut tracker = create_tracker(
        execution_config.max_retries,
        execution_config.verification_timeout.map(|v| v as u64),
    );

    let mut retry_queue: Vec<SubTask> = Vec::new();

    // Create session in context system
    let _ = create_mobius_session(task_id, backend, None);

    // Initialize runtime state (include own PID so TUI can SIGTERM this process)
    let mut runtime_state = initialize_runtime_state(
        task_id,
        &parent_issue.title,
        Some(std::process::id()),
        Some(graph.tasks.len() as u32),
    )?;

    // Pre-populate completed tasks
    for task in graph.tasks.values() {
        if task.status == TaskStatus::Done {
            runtime_state = complete_runtime_task(&runtime_state, &task.identifier);
        }
    }
    write_runtime_state(&runtime_state)?;

    // Main execution loop
    while iteration < max_iterations {
        iteration += 1;

        // Re-sync task graph from local state
        let local_issues = read_local_subtasks_as_linear_issues(task_id);
        if !local_issues.is_empty() {
            graph = build_task_graph(&parent_issue.id, &parent_issue.identifier, &local_issues);
        }

        // Check if verification task is complete
        if let Some(vt) = get_verification_task(&graph) {
            if vt.status == TaskStatus::Done {
                all_complete = true;
                println!(
                    "{}",
                    "\n✓ Verification task completed successfully!".green()
                );
                println!(
                    "{}",
                    format!("  {}: {}", vt.identifier, vt.title).green()
                );
                break;
            }
        }

        // Get ready tasks (collect into owned Vec for uniform handling with retries)
        let mut ready_tasks: Vec<SubTask> = get_ready_tasks(&graph)
            .into_iter()
            .cloned()
            .collect();

        // Add retry tasks
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

        // Check completion
        if stats.done == stats.total {
            all_complete = true;
            println!("{}", "\nAll tasks completed!".green());
            break;
        }

        if ready_tasks.is_empty() {
            let blocked = get_blocked_tasks(&graph);
            if !blocked.is_empty() {
                println!(
                    "{}",
                    "\nNo tasks ready. All remaining tasks are blocked.".yellow()
                );
                let ids: Vec<_> = blocked.iter().map(|t| t.identifier.as_str()).collect();
                println!("{}", format!("Blocked: {}", ids.join(", ")).dimmed());
            }
            break;
        }

        // Calculate parallelism
        let parallel_count = calculate_parallelism(ready_tasks.len(), &execution_config);
        let tasks_to_execute: Vec<SubTask> = ready_tasks.into_iter().take(parallel_count).collect();

        println!(
            "{}",
            format!(
                "\nIteration {}: Executing {} task(s) in parallel...",
                iteration, parallel_count
            )
            .blue()
        );
        let task_ids: Vec<_> = tasks_to_execute.iter().map(|t| t.identifier.as_str()).collect();
        println!("{}", format!("  Tasks: {}", task_ids.join(", ")).dimmed());

        // Assign tasks to tracker
        for task in &tasks_to_execute {
            assign_task(&mut tracker, task);
        }

        // Update runtime state with active tasks
        for task in &tasks_to_execute {
            runtime_state = add_runtime_active_task(
                &runtime_state,
                RuntimeActiveTask {
                    id: task.identifier.clone(),
                    pid: 0,
                    pane: String::new(),
                    started_at: chrono::Utc::now().to_rfc3339(),
                    worktree: Some(worktree_info.path.display().to_string()),
                    tokens: None,
                },
            );
        }
        write_runtime_state(&runtime_state)?;

        // Update status pane
        let loop_status = LoopStatus {
            total_tasks: stats.total,
            completed_tasks: stats.done,
            active_agents: tasks_to_execute
                .iter()
                .map(|t| crate::tmux::ActiveAgent {
                    task_id: t.id.clone(),
                    identifier: t.identifier.clone(),
                })
                .collect(),
            blocked_tasks: get_blocked_tasks(&graph)
                .iter()
                .map(|t| t.identifier.clone())
                .collect(),
            elapsed_ms: start_time.elapsed().as_millis() as u64,
        };
        let _ = rt.block_on(update_status_pane(&loop_status, &session_name));

        // Execute tasks in parallel
        let context_file_path = crate::context::get_full_context_path(task_id);
        let context_file_str = context_file_path.display().to_string();
        let results = rt.block_on(execute_parallel(
            &tasks_to_execute,
            &execution_config,
            &worktree_info.path.display().to_string(),
            &session,
            Some(&context_file_str),
            None,
        ));

        // Update runtime state with pane IDs
        for result in &results {
            if let Some(ref pane) = result.pane_id {
                runtime_state = update_runtime_task_pane(&runtime_state, &result.identifier, pane);
            }
        }

        // Auto-push queued updates to backend
        let (push_success, push_failed, push_errors) =
            push_pending_updates_for_task(task_id, &backend);
        if push_success > 0 || push_failed > 0 {
            println!(
                "{}",
                format!(
                    "Pushed updates: {} succeeded, {} failed",
                    push_success, push_failed
                )
                .dimmed()
            );
            for error in &push_errors {
                println!("{}", format!("  ⚠ {}", error).yellow());
            }
        }

        // Verify results
        println!("{}", "Verifying results...".dimmed());
        let verified_results = process_results(&mut tracker, &results, Some(&backend));

        let verified: Vec<_> = verified_results
            .iter()
            .filter(|r| r.success && r.backend_verified)
            .collect();
        let need_retry: Vec<SubTask> = get_retry_tasks(&verified_results, &tasks_to_execute)
            .into_iter()
            .cloned()
            .collect();
        let permanent_failures: Vec<_> = verified_results
            .iter()
            .filter(|r| !r.success && !r.should_retry)
            .collect();

        println!(
            "{}",
            format!(
                "Verified: {}/{} | Retry: {} | Failed: {}",
                verified.len(),
                verified_results.len(),
                need_retry.len(),
                permanent_failures.len()
            )
            .dimmed()
        );

        // Update graph and runtime state
        for result in &verified_results {
            let result_tokens = extract_result_total_tokens(&results, &result.identifier);

            if result.success && result.backend_verified {
                graph = update_task_status(&graph, &result.task_id, TaskStatus::Done);
                runtime_state = apply_runtime_transition(
                    &runtime_state,
                    &result.identifier,
                    result_tokens,
                    RuntimeTaskTransition::Complete,
                );
                update_subtask_status(task_id, &result.identifier, "done");
                println!(
                    "{}",
                    format!("  ✓ {}", result.identifier).green()
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
                        "  ↻ {}: Retrying ({})",
                        result.identifier,
                        result.error.as_deref().unwrap_or("verification pending")
                    )
                    .yellow()
                );
            } else {
                runtime_state = apply_runtime_transition(
                    &runtime_state,
                    &result.identifier,
                    result_tokens,
                    RuntimeTaskTransition::Failed,
                );
                println!(
                    "{}",
                    format!(
                        "  ✗ {}: {}",
                        result.identifier,
                        result.error.as_deref().unwrap_or("unknown error")
                    )
                    .red()
                );
            }
        }
        write_runtime_state(&runtime_state)?;

        // Add retry tasks
        for task in need_retry {
            if !retry_queue.iter().any(|t| t.id == task.id) {
                retry_queue.push(task.clone());
            }
        }

        // Check for permanent failures
        if has_permanent_failures(&verified_results) {
            any_failed = true;
            println!(
                "{}",
                "\nStopping due to permanent task failure (max retries exceeded).".red()
            );
            break;
        }

        // Write iteration log entries
        let iteration_timestamp = chrono::Utc::now().to_rfc3339();
        for result in &verified_results {
            let status = if result.success && result.backend_verified {
                IterationStatus::Success
            } else if result.should_retry {
                IterationStatus::Partial
            } else {
                IterationStatus::Failed
            };
            let entry = IterationLogEntry {
                subtask_id: result.identifier.clone(),
                attempt: iteration,
                started_at: iteration_timestamp.clone(),
                completed_at: Some(chrono::Utc::now().to_rfc3339()),
                status,
                error: result.error.clone(),
                files_modified: None,
                commit_hash: None,
            };
            let _ = write_iteration_log(task_id, entry);
        }

        // Re-render ASCII tree
        println!();
        println!("{}", render_full_tree_output(&graph));
    }

    // Final status
    let final_stats = get_graph_stats(&graph);
    println!();
    println!("{}", "Loop completed:".bold());
    println!("  Iterations: {}", iteration);
    println!(
        "  Tasks: {}/{} completed",
        final_stats.done, final_stats.total
    );
    println!("  Time: {}", format_elapsed(start_time.elapsed()));

    // Clear active tasks
    clear_all_runtime_active_tasks(task_id);

    // End session
    if all_complete {
        end_session(task_id, SessionStatus::Completed);
    } else if any_failed {
        end_session(task_id, SessionStatus::Failed);
    }

    // Auto-submit PR on success
    if all_complete && !no_submit {
        println!("{}", "\nCreating pull request...".dimmed());
        let original_cwd = std::env::current_dir().ok();
        let _ = std::env::set_current_dir(&worktree_info.path);

        match submit::run(
            Some(task_id),
            backend_override,
            model_override,
            false,
            true,
        ) {
            Ok(()) => println!("{}", "Pull request created successfully.".green()),
            Err(e) => {
                println!(
                    "{}",
                    format!("⚠ PR submission failed: {}", e).yellow()
                );
                all_complete = false;
            }
        }

        if let Some(ref orig) = original_cwd {
            let _ = std::env::set_current_dir(orig);
        }
    }

    // Cleanup
    if all_complete && execution_config.cleanup_on_success != Some(false) {
        println!("{}", "\nCleaning up worktree...".dimmed());
        let _ = rt.block_on(remove_worktree(task_id, &worktree_config));
        println!("{}", "Worktree removed.".green());

        let _ = rt.block_on(destroy_session(&session));
        println!("{}", "tmux session destroyed.".green());
    } else if any_failed {
        println!(
            "{}",
            "\nWorktree preserved for debugging at:".yellow()
        );
        println!(
            "  {}",
            worktree_info.path.display().to_string().dimmed()
        );
        println!(
            "{}",
            "tmux session preserved. Attach with:".yellow()
        );
        println!(
            "  {}",
            format!("tmux attach -t {}", session_name).dimmed()
        );
    } else {
        println!("{}", "\nWorktree preserved at:".yellow());
        println!(
            "  {}",
            worktree_info.path.display().to_string().dimmed()
        );
        println!("{}", "tmux session:".yellow());
        println!(
            "  {}",
            format!("tmux attach -t {}", session_name).dimmed()
        );
    }

    Ok(())
}

fn run_with_tui(
    task_id: &str,
    backend_override: Option<&str>,
    model_override: Option<&str>,
    parallel_override: Option<u32>,
    max_iterations_override: Option<u32>,
    fresh: bool,
    no_submit: bool,
) -> anyhow::Result<()> {
    // 1. Read local state for TUI display data (cheap, no network/worktree)
    let issues = read_local_subtasks_as_linear_issues(task_id);
    if issues.is_empty() {
        anyhow::bail!("No sub-tasks found for {}. Run refine first.", task_id);
    }
    let parent_spec = read_parent_spec(task_id);
    let parent_title = parent_spec
        .as_ref()
        .map(|p| p.title.clone())
        .unwrap_or_else(|| task_id.to_string());
    let parent_id = parent_spec
        .as_ref()
        .map(|p| p.identifier.clone())
        .unwrap_or_else(|| task_id.to_string());
    let graph = build_task_graph(task_id, &parent_id, &issues);
    let runtime_state_path = crate::context::get_runtime_path(task_id);

    // 3. Build subprocess args (pass through all overrides, always add --no-tui)
    let mut args = vec![
        "loop".to_string(),
        task_id.to_string(),
        "--no-tui".to_string(),
    ];
    if let Some(b) = backend_override {
        args.extend(["--backend".into(), b.to_string()]);
    }
    if let Some(m) = model_override {
        args.extend(["--model".into(), m.to_string()]);
    }
    if let Some(p) = parallel_override {
        args.extend(["--parallel".into(), p.to_string()]);
    }
    if let Some(n) = max_iterations_override {
        args.extend(["--max-iterations".into(), n.to_string()]);
    }
    if fresh {
        args.push("--fresh".into());
    }
    if no_submit {
        args.push("--no-submit".into());
    }

    // 4. Spawn subprocess with stderr redirected to a log file for diagnostics
    let log_dir = runtime_state_path.parent().unwrap_or(std::path::Path::new("."));
    std::fs::create_dir_all(log_dir)?;
    let log_path = log_dir.join("loop-subprocess.log");
    let log_file = std::fs::File::create(&log_path)?;

    let _child = std::process::Command::new(std::env::current_exe()?)
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::from(log_file))
        .spawn()?;

    // 5. Load config to get max_parallel_agents
    let paths = resolve_paths();
    let config = read_config(&paths.config_path).unwrap_or_default();
    let max_parallel_agents = if let Some(p) = parallel_override {
        p as usize
    } else {
        config.execution.max_parallel_agents.unwrap_or(3) as usize
    };

    // 6. Run TUI dashboard (blocks until user exits or execution completes)
    crate::tui::dashboard::run_dashboard(
        parent_id,
        parent_title,
        graph,
        runtime_state_path,
        max_parallel_agents,
    )?;

    Ok(())
}

async fn fetch_parent_issue(task_id: &str, backend: &Backend) -> Result<ParentIssue, String> {
    match backend {
        Backend::Local => {
            let spec = read_parent_spec(task_id);
            spec.map(|s| ParentIssue {
                id: s.id,
                identifier: s.identifier,
                title: s.title,
                git_branch_name: s.git_branch_name,
            })
            .ok_or_else(|| format!("No local state found for {}", task_id))
        }
        Backend::Jira => {
            let api_err = match JiraClient::new() {
                Ok(client) => match client.fetch_jira_issue(task_id).await {
                    Ok(issue) => return Ok(issue),
                    Err(e) => e.to_string(),
                },
                Err(e) => e.to_string(),
            };
            // API failed, try local state fallback
            tracing::warn!("Jira API fetch failed, falling back to local state: {}", api_err);
            match read_parent_spec(task_id) {
                Some(s) => Ok(ParentIssue {
                    id: s.id,
                    identifier: s.identifier,
                    title: s.title,
                    git_branch_name: s.git_branch_name,
                }),
                None => Err(api_err),
            }
        }
        Backend::Linear => {
            let api_err = match crate::linear::LinearClient::new() {
                Ok(client) => match client.fetch_linear_issue(task_id).await {
                    Ok(issue) => return Ok(issue),
                    Err(e) => e.to_string(),
                },
                Err(e) => e.to_string(),
            };
            // API failed, try local state fallback
            tracing::warn!("Linear API fetch failed, falling back to local state: {}", api_err);
            match read_parent_spec(task_id) {
                Some(s) => Ok(ParentIssue {
                    id: s.id,
                    identifier: s.identifier,
                    title: s.title,
                    git_branch_name: s.git_branch_name,
                }),
                None => Err(api_err),
            }
        }
    }
}

fn format_elapsed(duration: std::time::Duration) -> String {
    let seconds = duration.as_secs();
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeTaskTransition {
    Complete,
    Retry,
    Failed,
}

fn extract_result_total_tokens(
    results: &[crate::executor::ExecutionResult],
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
    let merged_state = update_runtime_task_tokens(state, task_id, tokens);

    match transition {
        RuntimeTaskTransition::Complete => complete_runtime_task(&merged_state, task_id),
        RuntimeTaskTransition::Retry => {
            crate::context::remove_runtime_active_task(&merged_state, task_id)
        }
        RuntimeTaskTransition::Failed => crate::context::fail_runtime_task(&merged_state, task_id),
    }
}

fn ctrlc_handler(task_id: &str) {
    let task_id = task_id.to_string();
    let _ = ctrlc::set_handler(move || {
        clear_all_runtime_active_tasks(&task_id);
        std::process::exit(130);
    });
}

fn validate_task_id(task_id: &str, backend: &Backend) -> bool {
    let pattern = match backend {
        Backend::Linear => regex::Regex::new(r"^[A-Z]+-\d+$").unwrap(),
        Backend::Jira => regex::Regex::new(r"^[A-Z]+-\d+$").unwrap(),
        Backend::Local => regex::Regex::new(r"^(LOC-\d+|task-\d+)$").unwrap(),
    };
    pattern.is_match(task_id)
}
