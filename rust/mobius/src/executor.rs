use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::Result;
use regex::Regex;
use tokio::time::{sleep, Duration};

use crate::runtime_adapter;
use crate::stream_json;
use crate::tmux::{
    capture_pane_content, create_agent_pane, interrupt_pane, kill_pane, layout_panes, run_in_pane,
    set_pane_title, TmuxPane, TmuxSession,
};
use crate::types::enums::Model;
use crate::types::AgentRuntime;
use crate::types::{ExecutionConfig, SubTask};

/// Verification skill identifier
const VERIFICATION_SKILL: &str = "/verify";

/// Default execute skill identifier
const EXECUTE_SKILL: &str = "/execute";

/// Polling interval for checking agent completion (2 seconds)
const POLL_INTERVAL_MS: u64 = 2000;

/// Default timeout per agent (30 minutes)
const DEFAULT_TIMEOUT_MS: u64 = 30 * 60 * 1000;

/// Status patterns for detecting agent completion in pane output
struct StatusPatterns {
    subtask_complete: Regex,
    verification_failed: Regex,
    all_complete: Regex,
    all_blocked: Regex,
    no_subtasks: Regex,
    execution_complete: Regex,
}

impl StatusPatterns {
    fn new() -> Self {
        Self {
            subtask_complete: status_regex("SUBTASK_COMPLETE"),
            verification_failed: status_regex("VERIFICATION_FAILED"),
            all_complete: status_regex("ALL_COMPLETE"),
            all_blocked: status_regex("ALL_BLOCKED"),
            no_subtasks: status_regex("NO_SUBTASKS"),
            execution_complete: Regex::new(r"EXECUTION_COMPLETE:\s*[\w-]+").unwrap(),
        }
    }
}

fn status_regex(status: &str) -> Regex {
    let escaped = regex::escape(status);
    // Supports both canonical lines (`STATUS: X`) and markdown variants
    // emitted by some runtimes (`- Status: `X``).
    Regex::new(&format!(
        r"(?m)^\s*(?:[-*]\s*)?(?:\*{{1,2}}\s*)?(?:STATUS|Status|status)(?:\s*\*{{1,2}})?\s*:\s*`?{escaped}`?\s*$"
    ))
    .unwrap()
}

/// Result of executing a single agent task
#[derive(Debug, Clone)]
pub struct ExecutionResult {
    pub task_id: String,
    pub identifier: String,
    pub success: bool,
    pub status: ExecutionStatus,
    pub token_usage: Option<TokenUsage>,
    pub duration_ms: u64,
    pub error: Option<String>,
    pub pane_id: Option<String>,
    pub raw_output: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

/// Parsed token usage metadata from agent output.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}

/// Status of an execution result
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutionStatus {
    SubtaskComplete,
    VerificationFailed,
    Error,
}

/// Internal handle for a spawned agent
struct AgentHandle {
    task: SubTask,
    pane: TmuxPane,
    start_time: Instant,
    is_primary: bool,
    #[allow(dead_code)]
    command: String,
    output_file: Option<PathBuf>,
}

/// Aggregated results from a batch of executions
#[derive(Debug, Clone)]
pub struct AggregatedResults {
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub completed: Vec<String>,
    pub failed_tasks: Vec<String>,
}

/// Select the appropriate skill for a task.
///
/// Verification Gate tasks use `/verify`, all others use `/execute`.
pub fn select_skill_for_task(task: &SubTask) -> &str {
    let title_lower = task.title.to_lowercase();
    if title_lower.contains("verification") && title_lower.contains("gate") {
        VERIFICATION_SKILL
    } else {
        EXECUTE_SKILL
    }
}

/// Select the model for a task based on its scoring data.
///
/// If the task has scoring with a recommended model, use that.
/// Otherwise fall back to the global config model.
pub fn select_model_for_task(task: &SubTask, config_model: Model) -> Model {
    task.scoring
        .as_ref()
        .map(|s| s.recommended_model)
        .unwrap_or(config_model)
}

/// Build a runtime-specific command string for executing a task in a pane.
pub fn build_runtime_command(
    runtime: AgentRuntime,
    options: &runtime_adapter::ExecutionCommand<'_>,
) -> String {
    runtime_adapter::build_execution_command(runtime, options)
}

/// Build the Claude CLI command string for executing a task in a pane.
///
/// When `output_file_path` is provided, the raw stream-json output is saved
/// via `tee` before piping to `cclean`, enabling token usage extraction.
pub fn build_claude_command(
    subtask_identifier: &str,
    skill: &str,
    worktree_path: &str,
    config: &ExecutionConfig,
    context_file_path: Option<&str>,
    model: Model,
    output_file_path: Option<&str>,
) -> String {
    let model_flag = format!("--model {}", model);

    let disallowed_tools_flag = config
        .disallowed_tools
        .as_ref()
        .filter(|tools| !tools.is_empty())
        .map(|tools| format!("--disallowedTools '{}'", tools.join(",")))
        .unwrap_or_default();

    let env_prefix = context_file_path
        .map(|path| {
            format!(
                "MOBIUS_CONTEXT_FILE=\"{}\" MOBIUS_TASK_ID=\"{}\" ",
                path, subtask_identifier
            )
        })
        .unwrap_or_default();

    let parts: Vec<&str> = [model_flag.as_str(), disallowed_tools_flag.as_str()]
        .iter()
        .filter(|s| !s.is_empty())
        .copied()
        .collect();

    let flags = parts.join(" ");

    let tee_segment = output_file_path
        .map(|path| format!("tee \"{}\" | ", path))
        .unwrap_or_default();

    format!(
        "cd \"{}\" && echo '{} {}' | {}claude -p --dangerously-skip-permissions --verbose --output-format stream-json {} | {}cclean",
        worktree_path, skill, subtask_identifier, env_prefix, flags, tee_segment
    )
}

/// Calculate the actual parallelism level given ready tasks and config.
pub fn calculate_parallelism(ready_task_count: usize, config: &ExecutionConfig) -> usize {
    let max_parallel = config.max_parallel_agents.unwrap_or(3) as usize;
    max_parallel.min(ready_task_count)
}

#[derive(Clone, Copy)]
pub struct ExecutionContext<'a> {
    pub runtime: AgentRuntime,
    pub worktree_path: &'a str,
    pub config: &'a ExecutionConfig,
    pub context_file_path: Option<&'a str>,
    pub model_override: Option<&'a str>,
    pub thinking_level_override: Option<&'a str>,
    pub output_dir: Option<&'a Path>,
}

/// Execute tasks in parallel using tmux panes.
///
/// Spawns up to `max_parallel_agents` agents, monitors them for completion,
/// and returns results for each task. When `output_dir` is provided, raw
/// stream-json output is saved per-task for token usage extraction.
pub async fn execute_parallel(
    tasks: &[SubTask],
    session: &TmuxSession,
    context: ExecutionContext<'_>,
    timeout_ms: Option<u64>,
) -> Vec<ExecutionResult> {
    let timeout = timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
    let actual_parallelism = calculate_parallelism(tasks.len(), context.config);

    if actual_parallelism == 0 {
        return vec![];
    }

    let batch = &tasks[..actual_parallelism];

    let handles = match spawn_agents(batch, session, context).await {
        Ok(h) => h,
        Err(e) => {
            return batch
                .iter()
                .map(|task| ExecutionResult {
                    task_id: task.id.clone(),
                    identifier: task.identifier.clone(),
                    success: false,
                    status: ExecutionStatus::Error,
                    token_usage: None,
                    duration_ms: 0,
                    error: Some(format!("Failed to spawn agent: {e}")),
                    pane_id: None,
                    raw_output: None,
                    input_tokens: None,
                    output_tokens: None,
                })
                .collect();
        }
    };

    layout_panes(session, handles.len()).await;

    // Wait for all agents concurrently
    let futures: Vec<_> = handles
        .into_iter()
        .map(|handle| wait_for_agent(handle, timeout))
        .collect();

    let settled = futures::future::join_all(futures).await;
    settled.into_iter().collect()
}

/// Spawn a single agent in a specific pane and wait for completion.
pub async fn spawn_agent_in_pane(
    task: &SubTask,
    pane: &TmuxPane,
    context: ExecutionContext<'_>,
) -> ExecutionResult {
    let start_time = Instant::now();
    let skill = select_skill_for_task(task);
    let output_file = if context.runtime == AgentRuntime::Claude {
        context
            .output_dir
            .map(|dir| dir.join(format!("{}.jsonl", task.identifier)))
    } else {
        None
    };
    let output_file_str = output_file
        .as_ref()
        .map(|p| p.to_string_lossy().to_string());

    let command = if context.runtime == AgentRuntime::Claude {
        let default_model = context.config.model.parse::<Model>().unwrap_or_default();
        let model = select_model_for_task(task, default_model);
        build_claude_command(
            &task.identifier,
            skill,
            context.worktree_path,
            context.config,
            context.context_file_path,
            model,
            output_file_str.as_deref(),
        )
    } else {
        let options = runtime_adapter::ExecutionCommand {
            subtask_identifier: &task.identifier,
            skill,
            worktree_path: context.worktree_path,
            config: context.config,
            context_file_path: context.context_file_path,
            model_override: context.model_override,
            thinking_level_override: context.thinking_level_override,
        };
        build_runtime_command(context.runtime, &options)
    };

    run_in_pane(&pane.id, &command, true).await;

    let handle = AgentHandle {
        task: task.clone(),
        pane: pane.clone(),
        start_time,
        is_primary: false,
        command,
        output_file,
    };

    wait_for_agent(handle, DEFAULT_TIMEOUT_MS).await
}

/// Check if an agent in a pane is still active (no completion status detected).
pub async fn is_agent_active(pane: &TmuxPane) -> bool {
    let content = capture_pane_content(&pane.id, 50).await;
    let patterns = StatusPatterns::new();

    !patterns.subtask_complete.is_match(&content)
        && !patterns.verification_failed.is_match(&content)
        && !patterns.all_complete.is_match(&content)
        && !patterns.all_blocked.is_match(&content)
        && !patterns.no_subtasks.is_match(&content)
        && !patterns.execution_complete.is_match(&content)
}

/// Aggregate execution results into summary statistics.
pub fn aggregate_results(results: &[ExecutionResult]) -> AggregatedResults {
    let succeeded: Vec<&ExecutionResult> = results.iter().filter(|r| r.success).collect();
    let failed: Vec<&ExecutionResult> = results.iter().filter(|r| !r.success).collect();

    AggregatedResults {
        total: results.len(),
        succeeded: succeeded.len(),
        failed: failed.len(),
        completed: succeeded.iter().map(|r| r.identifier.clone()).collect(),
        failed_tasks: failed
            .iter()
            .map(|r| {
                format!(
                    "{}: {}",
                    r.identifier,
                    r.error.as_deref().unwrap_or(&format!("{:?}", r.status))
                )
            })
            .collect(),
    }
}

/// Check if a tmux pane is still running (wrapper around tmux module).
pub async fn is_pane_still_running(pane_id: &str) -> bool {
    crate::tmux::is_pane_still_running(pane_id).await
}

// --- Internal functions ---

/// Spawn agents in tmux panes for a batch of tasks.
async fn spawn_agents(
    tasks: &[SubTask],
    session: &TmuxSession,
    context: ExecutionContext<'_>,
) -> Result<Vec<AgentHandle>> {
    let mut handles = Vec::with_capacity(tasks.len());

    for (i, task) in tasks.iter().enumerate() {
        let pane = if i == 0 {
            // Reuse the session's initial pane for the first agent when available.
            if crate::tmux::is_pane_still_running(&session.initial_pane_id).await {
                let title = format!("{}: {}", task.identifier, task.title);
                set_pane_title(&session.initial_pane_id, &title).await;
                TmuxPane {
                    id: session.initial_pane_id.clone(),
                    session_id: session.id.clone(),
                    task_id: Some(task.identifier.clone()),
                    pane_type: crate::tmux::PaneType::Agent,
                }
            } else {
                // If the original pane was destroyed (e.g. prior timeout cleanup),
                // create a replacement pane from the session itself.
                create_agent_pane(
                    session,
                    &task.identifier,
                    &format!("{}: {}", task.identifier, task.title),
                    Some(&session.name),
                )
                .await?
            }
        } else {
            create_agent_pane(
                session,
                &task.identifier,
                &format!("{}: {}", task.identifier, task.title),
                Some(&session.initial_pane_id),
            )
            .await?
        };

        let skill = select_skill_for_task(task);
        let output_file = if context.runtime == AgentRuntime::Claude {
            context
                .output_dir
                .map(|dir| dir.join(format!("{}.jsonl", task.identifier)))
        } else {
            None
        };
        let output_file_str = output_file
            .as_ref()
            .map(|p| p.to_string_lossy().to_string());
        let command = if context.runtime == AgentRuntime::Claude {
            let default_model = context.config.model.parse::<Model>().unwrap_or_default();
            let model = select_model_for_task(task, default_model);
            build_claude_command(
                &task.identifier,
                skill,
                context.worktree_path,
                context.config,
                context.context_file_path,
                model,
                output_file_str.as_deref(),
            )
        } else {
            let options = runtime_adapter::ExecutionCommand {
                subtask_identifier: &task.identifier,
                skill,
                worktree_path: context.worktree_path,
                config: context.config,
                context_file_path: context.context_file_path,
                model_override: context.model_override,
                thinking_level_override: context.thinking_level_override,
            };
            build_runtime_command(context.runtime, &options)
        };

        run_in_pane(&pane.id, &command, true).await;

        handles.push(AgentHandle {
            task: task.clone(),
            pane,
            start_time: Instant::now(),
            is_primary: i == 0,
            command,
            output_file,
        });
    }

    Ok(handles)
}

/// Poll a pane for agent completion, returning the result when done or on timeout.
async fn wait_for_agent(handle: AgentHandle, timeout_ms: u64) -> ExecutionResult {
    let deadline = Duration::from_millis(timeout_ms);
    let patterns = StatusPatterns::new();
    let error_summary_re = Regex::new(r"### Error Summary\n([^\n]+)").unwrap();

    loop {
        let elapsed = handle.start_time.elapsed();
        if elapsed >= deadline {
            // Timeout — still try to extract tokens from partial output
            let tokens = handle
                .output_file
                .as_ref()
                .and_then(|f| stream_json::parse_current_tokens(f));
            let title = format!("\u{2717} {}: TIMEOUT", handle.task.identifier);
            set_pane_title(&handle.pane.id, &title).await;
            // Keep the primary pane alive for future retries. Killing it can leave
            // session.initial_pane_id dangling and break tmux split targets.
            interrupt_pane(&handle.pane.id).await;
            sleep(Duration::from_millis(150)).await;
            if !handle.is_primary {
                kill_pane(&handle.pane.id).await;
            }
            let timeout_output = capture_pane_content(&handle.pane.id, 200).await;

            return ExecutionResult {
                task_id: handle.task.id.clone(),
                identifier: handle.task.identifier.clone(),
                success: false,
                status: ExecutionStatus::Error,
                token_usage: None,
                duration_ms: elapsed.as_millis() as u64,
                error: Some(format!(
                    "Agent timed out after {} seconds",
                    elapsed.as_secs()
                )),
                pane_id: Some(handle.pane.id.clone()),
                raw_output: if timeout_output.is_empty() {
                    None
                } else {
                    Some(timeout_output)
                },
                input_tokens: tokens.as_ref().map(|t| t.input_tokens),
                output_tokens: tokens.as_ref().map(|t| t.output_tokens),
            };
        }

        let content = capture_pane_content(&handle.pane.id, 200).await;

        if let Some(mut result) = parse_agent_output(
            &content,
            &handle.task,
            handle.start_time,
            &handle.pane.id,
            &patterns,
            &error_summary_re,
        ) {
            // Extract final token usage from output file
            if let Some(ref output_file) = handle.output_file {
                let tokens = stream_json::parse_final_tokens(output_file)
                    .or_else(|| stream_json::parse_current_tokens(output_file));
                if let Some(usage) = tokens {
                    result.input_tokens = Some(usage.input_tokens);
                    result.output_tokens = Some(usage.output_tokens);
                }
            }
            // Update pane title with completion status
            let emoji = if result.success {
                "\u{2713}"
            } else {
                "\u{2717}"
            };
            let title = format!("{} {}: {:?}", emoji, handle.task.identifier, result.status);
            set_pane_title(&handle.pane.id, &title).await;

            return result;
        }

        sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;
    }
}

/// Parse captured pane content for completion status patterns.
///
/// Returns `None` if no completion pattern is found (agent still running).
fn parse_agent_output(
    content: &str,
    task: &SubTask,
    start_time: Instant,
    pane_id: &str,
    patterns: &StatusPatterns,
    error_summary_re: &Regex,
) -> Option<ExecutionResult> {
    let duration_ms = start_time.elapsed().as_millis() as u64;
    let token_usage = parse_token_usage(content);

    // Check for successful completion
    if patterns.subtask_complete.is_match(content) || patterns.execution_complete.is_match(content)
    {
        return Some(ExecutionResult {
            task_id: task.id.clone(),
            identifier: task.identifier.clone(),
            success: true,
            status: ExecutionStatus::SubtaskComplete,
            token_usage,
            duration_ms,
            error: None,
            pane_id: Some(pane_id.to_string()),
            raw_output: Some(content.to_string()),
            input_tokens: None,
            output_tokens: None,
        });
    }

    // Check for verification failure
    if patterns.verification_failed.is_match(content) {
        let error = error_summary_re
            .captures(content)
            .and_then(|caps| caps.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_else(|| "Verification failed".to_string());

        return Some(ExecutionResult {
            task_id: task.id.clone(),
            identifier: task.identifier.clone(),
            success: false,
            status: ExecutionStatus::VerificationFailed,
            token_usage,
            duration_ms,
            error: Some(error),
            pane_id: Some(pane_id.to_string()),
            raw_output: Some(content.to_string()),
            input_tokens: None,
            output_tokens: None,
        });
    }

    // Check for all complete
    if patterns.all_complete.is_match(content) {
        return Some(ExecutionResult {
            task_id: task.id.clone(),
            identifier: task.identifier.clone(),
            success: true,
            status: ExecutionStatus::SubtaskComplete,
            token_usage,
            duration_ms,
            error: None,
            pane_id: Some(pane_id.to_string()),
            raw_output: Some(content.to_string()),
            input_tokens: None,
            output_tokens: None,
        });
    }

    // Check for all blocked or no subtasks
    if patterns.all_blocked.is_match(content) || patterns.no_subtasks.is_match(content) {
        return Some(ExecutionResult {
            task_id: task.id.clone(),
            identifier: task.identifier.clone(),
            success: false,
            status: ExecutionStatus::Error,
            token_usage,
            duration_ms,
            error: Some("No actionable sub-tasks available".to_string()),
            pane_id: Some(pane_id.to_string()),
            raw_output: Some(content.to_string()),
            input_tokens: None,
            output_tokens: None,
        });
    }

    // No completion pattern found - still running
    None
}

/// Parse token usage fields from pane content.
///
/// Supports both snake_case and camelCase key variants and tolerates partial payloads.
fn parse_token_usage(content: &str) -> Option<TokenUsage> {
    fn parse_last_u64(content: &str, patterns: &[&str]) -> Option<u64> {
        for pattern in patterns {
            if let Ok(re) = Regex::new(pattern) {
                if let Some(caps) = re.captures_iter(content).last() {
                    if let Some(m) = caps.get(1) {
                        if let Ok(value) = m.as_str().parse::<u64>() {
                            return Some(value);
                        }
                    }
                }
            }
        }
        None
    }

    let input_tokens = parse_last_u64(
        content,
        &[
            r#""input_tokens"\s*:\s*(\d+)"#,
            r#""inputTokens"\s*:\s*(\d+)"#,
        ],
    );
    let output_tokens = parse_last_u64(
        content,
        &[
            r#""output_tokens"\s*:\s*(\d+)"#,
            r#""outputTokens"\s*:\s*(\d+)"#,
        ],
    );
    let total_tokens = parse_last_u64(
        content,
        &[
            r#""total_tokens"\s*:\s*(\d+)"#,
            r#""totalTokens"\s*:\s*(\d+)"#,
        ],
    );

    if input_tokens.is_some() || output_tokens.is_some() || total_tokens.is_some() {
        Some(TokenUsage {
            input_tokens,
            output_tokens,
            total_tokens,
        })
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::TaskStatus;

    fn make_task(id: &str, identifier: &str, title: &str) -> SubTask {
        SubTask {
            id: id.to_string(),
            identifier: identifier.to_string(),
            title: title.to_string(),
            status: TaskStatus::Ready,
            blocked_by: vec![],
            blocks: vec![],
            git_branch_name: String::new(),
            scoring: None,
        }
    }

    #[test]
    fn test_select_skill_for_task_execute() {
        let task = make_task("1", "MOB-101", "Implement feature X");
        assert_eq!(select_skill_for_task(&task), "/execute");
    }

    #[test]
    fn test_select_skill_for_task_verify() {
        let task = make_task("vg", "MOB-VG", "[MOB-100] Verification Gate");
        assert_eq!(select_skill_for_task(&task), "/verify");
    }

    #[test]
    fn test_select_skill_for_task_verify_case_insensitive() {
        let task = make_task("vg", "MOB-VG", "VERIFICATION GATE for MOB-100");
        assert_eq!(select_skill_for_task(&task), "/verify");
    }

    #[test]
    fn test_select_skill_for_task_partial_match() {
        // Must contain both "verification" AND "gate"
        let task = make_task("1", "MOB-101", "Verification of types");
        assert_eq!(select_skill_for_task(&task), "/execute");
    }

    #[test]
    fn test_build_claude_command_basic() {
        let config = ExecutionConfig::default();
        let cmd = build_claude_command(
            "MOB-101",
            "/execute",
            "/path/to/worktree",
            &config,
            None,
            Model::Opus,
            None,
        );

        assert!(cmd.contains("cd \"/path/to/worktree\""));
        assert!(cmd.contains("echo '/execute MOB-101'"));
        assert!(cmd.contains("claude -p --dangerously-skip-permissions"));
        assert!(cmd.contains("--output-format stream-json"));
        assert!(cmd.contains("--model opus"));
        assert!(cmd.contains("| cclean"));
        // No tee when output_file_path is None
        assert!(!cmd.contains("tee"));
    }

    #[test]
    fn test_build_claude_command_with_output_file() {
        let config = ExecutionConfig::default();
        let cmd = build_claude_command(
            "MOB-101",
            "/execute",
            "/path/to/worktree",
            &config,
            None,
            Model::Opus,
            Some("/tmp/output/MOB-101.jsonl"),
        );

        assert!(cmd.contains("tee \"/tmp/output/MOB-101.jsonl\""));
        assert!(cmd.contains("| tee"));
        assert!(cmd.contains("| cclean"));
    }

    #[test]
    fn test_build_claude_command_with_context_file() {
        let config = ExecutionConfig::default();
        let cmd = build_claude_command(
            "MOB-101",
            "/execute",
            "/path/to/worktree",
            &config,
            Some("/tmp/context.json"),
            Model::Opus,
            None,
        );

        assert!(cmd.contains("MOBIUS_CONTEXT_FILE=\"/tmp/context.json\""));
        assert!(cmd.contains("MOBIUS_TASK_ID=\"MOB-101\""));
    }

    #[test]
    fn test_build_runtime_command_opencode_uses_raw_model_override() {
        let config = ExecutionConfig::default();
        let options = runtime_adapter::ExecutionCommand {
            subtask_identifier: "MOB-101",
            skill: "/execute",
            worktree_path: "/path/to/worktree",
            config: &config,
            context_file_path: None,
            model_override: Some("gpt-5.3-codex"),
            thinking_level_override: Some("xhigh"),
        };
        let cmd = build_runtime_command(AgentRuntime::Opencode, &options);

        assert!(cmd.contains("Use the execute skill for sub-task MOB-101"));
        assert!(cmd.contains("--model openai/gpt-5.3-codex"));
        assert!(cmd.contains("--variant max"));
        assert!(!cmd.contains("| cclean"));
        assert!(!cmd.contains("echo '/execute MOB-101'"));
    }

    #[test]
    fn test_build_runtime_command_claude_ignores_raw_model_override() {
        let config = ExecutionConfig::default();
        let options = runtime_adapter::ExecutionCommand {
            subtask_identifier: "MOB-101",
            skill: "/execute",
            worktree_path: "/path/to/worktree",
            config: &config,
            context_file_path: None,
            model_override: Some("custom-model"),
            thinking_level_override: Some("xhigh"),
        };
        let cmd = build_runtime_command(AgentRuntime::Claude, &options);

        assert!(cmd.contains("claude -p"));
        assert!(cmd.contains("--model opus"));
        assert!(!cmd.contains("--model custom-model"));
    }

    #[test]
    fn test_build_claude_command_with_disallowed_tools() {
        let mut config = ExecutionConfig::default();
        config.disallowed_tools = Some(vec!["Bash".to_string(), "Write".to_string()]);

        let cmd = build_claude_command(
            "MOB-101",
            "/execute",
            "/path/to/worktree",
            &config,
            None,
            Model::Opus,
            None,
        );

        assert!(cmd.contains("--disallowedTools 'Bash,Write'"));
    }

    #[test]
    fn test_build_claude_command_without_disallowed_tools() {
        let mut config = ExecutionConfig::default();
        config.disallowed_tools = None;

        let cmd = build_claude_command(
            "MOB-101",
            "/execute",
            "/path/to/worktree",
            &config,
            None,
            Model::Opus,
            None,
        );

        assert!(!cmd.contains("--disallowedTools"));
    }

    #[test]
    fn test_status_patterns_subtask_complete() {
        let patterns = StatusPatterns::new();
        assert!(patterns
            .subtask_complete
            .is_match("STATUS: SUBTASK_COMPLETE"));
        assert!(patterns
            .subtask_complete
            .is_match("STATUS:  SUBTASK_COMPLETE"));
        assert!(patterns
            .subtask_complete
            .is_match("some text before\nSTATUS: SUBTASK_COMPLETE\nsome text after"));
        assert!(patterns
            .subtask_complete
            .is_match("- Status: `SUBTASK_COMPLETE`"));
        assert!(patterns
            .subtask_complete
            .is_match("**Status**: SUBTASK_COMPLETE"));
        assert!(!patterns.subtask_complete.is_match("SUBTASK_COMPLETE"));
    }

    #[test]
    fn test_status_patterns_verification_failed() {
        let patterns = StatusPatterns::new();
        assert!(patterns
            .verification_failed
            .is_match("STATUS: VERIFICATION_FAILED"));
        assert!(patterns
            .verification_failed
            .is_match("- Status: `VERIFICATION_FAILED`"));
        assert!(!patterns.verification_failed.is_match("VERIFICATION_FAILED"));
    }

    #[test]
    fn test_status_patterns_all_complete() {
        let patterns = StatusPatterns::new();
        assert!(patterns.all_complete.is_match("STATUS: ALL_COMPLETE"));
    }

    #[test]
    fn test_status_patterns_all_blocked() {
        let patterns = StatusPatterns::new();
        assert!(patterns.all_blocked.is_match("STATUS: ALL_BLOCKED"));
    }

    #[test]
    fn test_status_patterns_no_subtasks() {
        let patterns = StatusPatterns::new();
        assert!(patterns.no_subtasks.is_match("STATUS: NO_SUBTASKS"));
    }

    #[test]
    fn test_status_patterns_execution_complete() {
        let patterns = StatusPatterns::new();
        assert!(patterns
            .execution_complete
            .is_match("EXECUTION_COMPLETE: MOB-124"));
        assert!(patterns
            .execution_complete
            .is_match("EXECUTION_COMPLETE: task-001"));
        assert!(patterns
            .execution_complete
            .is_match("EXECUTION_COMPLETE:task-001"));
    }

    #[test]
    fn test_parse_agent_output_subtask_complete() {
        let task = make_task("1", "MOB-101", "Test task");
        let patterns = StatusPatterns::new();
        let error_re = Regex::new(r"### Error Summary\n([^\n]+)").unwrap();
        let start = Instant::now();

        let content = "lots of output\nSTATUS: SUBTASK_COMPLETE\nmore output";
        let result = parse_agent_output(content, &task, start, "%0", &patterns, &error_re);

        assert!(result.is_some());
        let result = result.unwrap();
        assert!(result.success);
        assert_eq!(result.status, ExecutionStatus::SubtaskComplete);
        assert_eq!(result.identifier, "MOB-101");
    }

    #[test]
    fn test_parse_agent_output_subtask_complete_markdown_status_line() {
        let task = make_task("1", "MOB-101", "Test task");
        let patterns = StatusPatterns::new();
        let error_re = Regex::new(r"### Error Summary\n([^\n]+)").unwrap();
        let start = Instant::now();

        let content = "Done\n- Status: `SUBTASK_COMPLETE`\ncommit: abc123\n";
        let result = parse_agent_output(content, &task, start, "%0", &patterns, &error_re);

        assert!(result.is_some());
        let result = result.unwrap();
        assert!(result.success);
        assert_eq!(result.status, ExecutionStatus::SubtaskComplete);
    }

    #[test]
    fn test_parse_agent_output_execution_complete() {
        let task = make_task("1", "MOB-101", "Test task");
        let patterns = StatusPatterns::new();
        let error_re = Regex::new(r"### Error Summary\n([^\n]+)").unwrap();
        let start = Instant::now();

        let content = "output\nEXECUTION_COMPLETE: MOB-101\nmore";
        let result = parse_agent_output(content, &task, start, "%0", &patterns, &error_re);

        assert!(result.is_some());
        assert!(result.unwrap().success);
    }

    #[test]
    fn test_parse_agent_output_parses_token_usage() {
        let task = make_task("1", "MOB-101", "Test task");
        let patterns = StatusPatterns::new();
        let error_re = Regex::new(r"### Error Summary\n([^\n]+)").unwrap();
        let start = Instant::now();

        let content = "output\n{\"usage\":{\"input_tokens\":120,\"output_tokens\":45,\"total_tokens\":165}}\nSTATUS: SUBTASK_COMPLETE\n";
        let result = parse_agent_output(content, &task, start, "%0", &patterns, &error_re)
            .expect("result should parse");

        assert_eq!(
            result.token_usage,
            Some(TokenUsage {
                input_tokens: Some(120),
                output_tokens: Some(45),
                total_tokens: Some(165),
            })
        );
    }

    #[test]
    fn test_parse_agent_output_handles_missing_token_usage() {
        let task = make_task("1", "MOB-101", "Test task");
        let patterns = StatusPatterns::new();
        let error_re = Regex::new(r"### Error Summary\n([^\n]+)").unwrap();
        let start = Instant::now();

        let content = "output\nSTATUS: SUBTASK_COMPLETE\n";
        let result = parse_agent_output(content, &task, start, "%0", &patterns, &error_re)
            .expect("result should parse");

        assert_eq!(result.token_usage, None);
    }

    #[test]
    fn test_parse_agent_output_handles_partial_token_usage() {
        let task = make_task("1", "MOB-101", "Test task");
        let patterns = StatusPatterns::new();
        let error_re = Regex::new(r"### Error Summary\n([^\n]+)").unwrap();
        let start = Instant::now();

        let content = "output\n{\"usage\":{\"inputTokens\":33,\"totalTokens\":88}}\nSTATUS: SUBTASK_COMPLETE\n";
        let result = parse_agent_output(content, &task, start, "%0", &patterns, &error_re)
            .expect("result should parse");

        assert_eq!(
            result.token_usage,
            Some(TokenUsage {
                input_tokens: Some(33),
                output_tokens: None,
                total_tokens: Some(88),
            })
        );
    }

    #[test]
    fn test_parse_agent_output_verification_failed() {
        let task = make_task("1", "MOB-101", "Test task");
        let patterns = StatusPatterns::new();
        let error_re = Regex::new(r"### Error Summary\n([^\n]+)").unwrap();
        let start = Instant::now();

        let content =
            "output\n### Error Summary\nType mismatch in foo.rs\nSTATUS: VERIFICATION_FAILED\n";
        let result = parse_agent_output(content, &task, start, "%0", &patterns, &error_re);

        assert!(result.is_some());
        let result = result.unwrap();
        assert!(!result.success);
        assert_eq!(result.status, ExecutionStatus::VerificationFailed);
        assert_eq!(result.error.as_deref(), Some("Type mismatch in foo.rs"));
    }

    #[test]
    fn test_parse_agent_output_verification_failed_no_summary() {
        let task = make_task("1", "MOB-101", "Test task");
        let patterns = StatusPatterns::new();
        let error_re = Regex::new(r"### Error Summary\n([^\n]+)").unwrap();
        let start = Instant::now();

        let content = "output\nSTATUS: VERIFICATION_FAILED\n";
        let result = parse_agent_output(content, &task, start, "%0", &patterns, &error_re);

        assert!(result.is_some());
        let result = result.unwrap();
        assert!(!result.success);
        assert_eq!(result.error.as_deref(), Some("Verification failed"));
    }

    #[test]
    fn test_parse_agent_output_all_blocked() {
        let task = make_task("1", "MOB-101", "Test task");
        let patterns = StatusPatterns::new();
        let error_re = Regex::new(r"### Error Summary\n([^\n]+)").unwrap();
        let start = Instant::now();

        let content = "output\nSTATUS: ALL_BLOCKED\n";
        let result = parse_agent_output(content, &task, start, "%0", &patterns, &error_re);

        assert!(result.is_some());
        let result = result.unwrap();
        assert!(!result.success);
        assert_eq!(
            result.error.as_deref(),
            Some("No actionable sub-tasks available")
        );
    }

    #[test]
    fn test_parse_agent_output_no_subtasks() {
        let task = make_task("1", "MOB-101", "Test task");
        let patterns = StatusPatterns::new();
        let error_re = Regex::new(r"### Error Summary\n([^\n]+)").unwrap();
        let start = Instant::now();

        let content = "output\nSTATUS: NO_SUBTASKS\n";
        let result = parse_agent_output(content, &task, start, "%0", &patterns, &error_re);

        assert!(result.is_some());
        assert!(!result.unwrap().success);
    }

    #[test]
    fn test_parse_agent_output_still_running() {
        let task = make_task("1", "MOB-101", "Test task");
        let patterns = StatusPatterns::new();
        let error_re = Regex::new(r"### Error Summary\n([^\n]+)").unwrap();
        let start = Instant::now();

        let content = "Agent is still working on the task...\nNo completion pattern here.";
        let result = parse_agent_output(content, &task, start, "%0", &patterns, &error_re);

        assert!(result.is_none());
    }

    #[test]
    fn test_parse_agent_output_all_complete() {
        let task = make_task("1", "MOB-101", "Test task");
        let patterns = StatusPatterns::new();
        let error_re = Regex::new(r"### Error Summary\n([^\n]+)").unwrap();
        let start = Instant::now();

        let content = "output\nSTATUS: ALL_COMPLETE\n";
        let result = parse_agent_output(content, &task, start, "%0", &patterns, &error_re);

        assert!(result.is_some());
        assert!(result.unwrap().success);
    }

    #[test]
    fn test_calculate_parallelism() {
        let config = ExecutionConfig::default(); // max_parallel_agents = Some(3)
        assert_eq!(calculate_parallelism(5, &config), 3);
        assert_eq!(calculate_parallelism(2, &config), 2);
        assert_eq!(calculate_parallelism(0, &config), 0);
    }

    #[test]
    fn test_calculate_parallelism_no_config() {
        let mut config = ExecutionConfig::default();
        config.max_parallel_agents = None;
        // Default fallback is 3
        assert_eq!(calculate_parallelism(5, &config), 3);
    }

    #[test]
    fn test_aggregate_results() {
        let results = vec![
            ExecutionResult {
                task_id: "1".to_string(),
                identifier: "MOB-101".to_string(),
                success: true,
                status: ExecutionStatus::SubtaskComplete,
                token_usage: None,
                duration_ms: 5000,
                error: None,
                pane_id: Some("%0".to_string()),
                raw_output: None,
                input_tokens: None,
                output_tokens: None,
            },
            ExecutionResult {
                task_id: "2".to_string(),
                identifier: "MOB-102".to_string(),
                success: false,
                status: ExecutionStatus::VerificationFailed,
                token_usage: None,
                duration_ms: 3000,
                error: Some("Tests failed".to_string()),
                pane_id: Some("%1".to_string()),
                raw_output: None,
                input_tokens: None,
                output_tokens: None,
            },
            ExecutionResult {
                task_id: "3".to_string(),
                identifier: "MOB-103".to_string(),
                success: true,
                status: ExecutionStatus::SubtaskComplete,
                token_usage: None,
                duration_ms: 7000,
                error: None,
                pane_id: Some("%2".to_string()),
                raw_output: None,
                input_tokens: None,
                output_tokens: None,
            },
        ];

        let agg = aggregate_results(&results);
        assert_eq!(agg.total, 3);
        assert_eq!(agg.succeeded, 2);
        assert_eq!(agg.failed, 1);
        assert_eq!(agg.completed, vec!["MOB-101", "MOB-103"]);
        assert_eq!(agg.failed_tasks.len(), 1);
        assert!(agg.failed_tasks[0].contains("MOB-102"));
        assert!(agg.failed_tasks[0].contains("Tests failed"));
    }

    #[test]
    fn test_aggregate_results_empty() {
        let agg = aggregate_results(&[]);
        assert_eq!(agg.total, 0);
        assert_eq!(agg.succeeded, 0);
        assert_eq!(agg.failed, 0);
    }

    // --- build_claude_command Edge Cases ---

    #[test]
    fn test_build_claude_command_path_with_spaces() {
        let config = ExecutionConfig::default();
        let cmd = build_claude_command(
            "MOB-101",
            "/execute",
            "/path/to/my worktree/project",
            &config,
            None,
            Model::Opus,
            None,
        );
        // Path with spaces should be properly quoted in the cd command
        assert!(cmd.contains("cd \"/path/to/my worktree/project\""));
        assert!(cmd.contains("claude -p"));
    }

    #[test]
    fn test_build_claude_command_path_with_special_chars() {
        let config = ExecutionConfig::default();
        let cmd = build_claude_command(
            "MOB-101",
            "/execute",
            "/path/to/project-v2.0_(beta)",
            &config,
            None,
            Model::Opus,
            None,
        );
        assert!(cmd.contains("cd \"/path/to/project-v2.0_(beta)\""));
        assert!(cmd.contains("echo '/execute MOB-101'"));
    }

    #[test]
    fn test_build_claude_command_empty_disallowed_tools() {
        let mut config = ExecutionConfig::default();
        config.disallowed_tools = Some(vec![]);

        let cmd = build_claude_command(
            "MOB-101",
            "/execute",
            "/path",
            &config,
            None,
            Model::Opus,
            None,
        );
        // Empty vec should be filtered out, no --disallowedTools flag
        assert!(!cmd.contains("--disallowedTools"));
    }

    #[test]
    fn test_build_claude_command_context_file_with_quotes() {
        let config = ExecutionConfig::default();
        let cmd = build_claude_command(
            "MOB-101",
            "/execute",
            "/path",
            &config,
            Some("/tmp/my context/file.json"),
            Model::Opus,
            None,
        );
        // Context file path should be in quotes
        assert!(cmd.contains("MOBIUS_CONTEXT_FILE=\"/tmp/my context/file.json\""));
        assert!(cmd.contains("MOBIUS_TASK_ID=\"MOB-101\""));
    }

    // --- Status Pattern Matching in Noisy Output ---

    #[test]
    fn test_status_patterns_match_in_noisy_output() {
        let patterns = StatusPatterns::new();

        // Generate 50 lines of noise before and after the status line
        let mut lines = Vec::new();
        for i in 0..50 {
            lines.push(format!(
                "Line {} of agent output: processing files, running tests, checking types...",
                i
            ));
        }
        lines.push("STATUS: SUBTASK_COMPLETE".to_string());
        for i in 50..100 {
            lines.push(format!(
                "Line {} more output after completion marker with various data",
                i
            ));
        }
        let content = lines.join("\n");

        assert!(patterns.subtask_complete.is_match(&content));
        // Other patterns should NOT match
        assert!(!patterns.verification_failed.is_match(&content));
        assert!(!patterns.all_blocked.is_match(&content));
    }

    #[test]
    fn test_status_patterns_multiple_statuses_first_wins() {
        let task = make_task("1", "MOB-101", "Test task");
        let patterns = StatusPatterns::new();
        let error_re = Regex::new(r"### Error Summary\n([^\n]+)").unwrap();
        let start = Instant::now();

        // Content has SUBTASK_COMPLETE before VERIFICATION_FAILED
        let content = "output\nSTATUS: SUBTASK_COMPLETE\nlater\nSTATUS: VERIFICATION_FAILED\n";
        let result = parse_agent_output(content, &task, start, "%0", &patterns, &error_re);

        assert!(result.is_some());
        let result = result.unwrap();
        // SUBTASK_COMPLETE is checked first in parse_agent_output, so it wins
        assert!(result.success);
        assert_eq!(result.status, ExecutionStatus::SubtaskComplete);
    }

    #[test]
    fn test_status_patterns_execution_complete_various_ids() {
        let patterns = StatusPatterns::new();

        // Standard format
        assert!(patterns
            .execution_complete
            .is_match("EXECUTION_COMPLETE: MOB-124"));
        // Hyphenated task IDs
        assert!(patterns
            .execution_complete
            .is_match("EXECUTION_COMPLETE: task-001"));
        // No space after colon
        assert!(patterns
            .execution_complete
            .is_match("EXECUTION_COMPLETE:task-VG"));
        // Alphanumeric IDs
        assert!(patterns
            .execution_complete
            .is_match("EXECUTION_COMPLETE: PROJ-999"));
        // Embedded in larger output
        assert!(patterns
            .execution_complete
            .is_match("lots of text\nEXECUTION_COMPLETE: MOB-255\nmore text"));
    }

    #[test]
    fn test_status_patterns_case_sensitivity() {
        let patterns = StatusPatterns::new();

        // Lowercase should NOT match
        assert!(!patterns
            .subtask_complete
            .is_match("status: subtask_complete"));
        assert!(!patterns
            .subtask_complete
            .is_match("Status: Subtask_Complete"));

        // Missing STATUS: prefix should NOT match
        assert!(!patterns.subtask_complete.is_match("SUBTASK_COMPLETE"));
        assert!(!patterns.verification_failed.is_match("VERIFICATION_FAILED"));
        assert!(!patterns.all_complete.is_match("ALL_COMPLETE"));
    }

    // --- parse_agent_output Edge Cases ---

    #[test]
    fn test_parse_agent_output_empty_content() {
        let task = make_task("1", "MOB-101", "Test task");
        let patterns = StatusPatterns::new();
        let error_re = Regex::new(r"### Error Summary\n([^\n]+)").unwrap();
        let start = Instant::now();

        let result = parse_agent_output("", &task, start, "%0", &patterns, &error_re);
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_agent_output_only_error_no_status() {
        let task = make_task("1", "MOB-101", "Test task");
        let patterns = StatusPatterns::new();
        let error_re = Regex::new(r"### Error Summary\n([^\n]+)").unwrap();
        let start = Instant::now();

        // Has error summary but no STATUS: pattern - should return None (still running)
        let content =
            "Agent output\n### Error Summary\nSomething went wrong\nBut no status pattern";
        let result = parse_agent_output(content, &task, start, "%0", &patterns, &error_re);
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_agent_output_truncated_pattern() {
        let task = make_task("1", "MOB-101", "Test task");
        let patterns = StatusPatterns::new();
        let error_re = Regex::new(r"### Error Summary\n([^\n]+)").unwrap();
        let start = Instant::now();

        // Truncated status keywords should NOT match
        let content = "STATUS: SUBTASK_COMPLE";
        let result = parse_agent_output(content, &task, start, "%0", &patterns, &error_re);
        assert!(result.is_none());

        let content2 = "STATUS: VERIFICATION_FAIL";
        let result2 = parse_agent_output(content2, &task, start, "%0", &patterns, &error_re);
        assert!(result2.is_none());
    }

    #[test]
    fn test_parse_agent_output_multiline_error() {
        let task = make_task("1", "MOB-101", "Test task");
        let patterns = StatusPatterns::new();
        let error_re = Regex::new(r"### Error Summary\n([^\n]+)").unwrap();
        let start = Instant::now();

        // Error summary captures only the first line after the header
        let content = "output\n### Error Summary\nFirst error line\nSecond error line\nThird error line\nSTATUS: VERIFICATION_FAILED\n";
        let result = parse_agent_output(content, &task, start, "%0", &patterns, &error_re);

        assert!(result.is_some());
        let result = result.unwrap();
        assert_eq!(result.error.as_deref(), Some("First error line"));
    }

    #[test]
    fn test_parse_agent_output_multiple_error_summaries() {
        let task = make_task("1", "MOB-101", "Test task");
        let patterns = StatusPatterns::new();
        let error_re = Regex::new(r"### Error Summary\n([^\n]+)").unwrap();
        let start = Instant::now();

        // Multiple error summaries - regex captures first occurrence
        let content = "### Error Summary\nFirst error\n\n### Error Summary\nSecond error\nSTATUS: VERIFICATION_FAILED\n";
        let result = parse_agent_output(content, &task, start, "%0", &patterns, &error_re);

        assert!(result.is_some());
        let result = result.unwrap();
        // First capture wins
        assert_eq!(result.error.as_deref(), Some("First error"));
    }

    // --- aggregate_results Additional Tests ---

    #[test]
    fn test_aggregate_results_all_success() {
        let results: Vec<ExecutionResult> = (0..5)
            .map(|i| ExecutionResult {
                task_id: format!("{}", i),
                identifier: format!("MOB-{}", 100 + i),
                success: true,
                status: ExecutionStatus::SubtaskComplete,
                token_usage: None,
                duration_ms: 5000 + i * 1000,
                error: None,
                pane_id: Some(format!("%{}", i)),
                raw_output: None,
                input_tokens: None,
                output_tokens: None,
            })
            .collect();

        let agg = aggregate_results(&results);
        assert_eq!(agg.total, 5);
        assert_eq!(agg.succeeded, 5);
        assert_eq!(agg.failed, 0);
        assert_eq!(agg.completed.len(), 5);
        assert!(agg.failed_tasks.is_empty());
    }

    #[test]
    fn test_aggregate_results_all_failure() {
        let errors = vec![
            "Type mismatch in foo.rs",
            "Test assertion failed",
            "Lint error: unused variable",
        ];
        let results: Vec<ExecutionResult> = errors
            .iter()
            .enumerate()
            .map(|(i, err)| ExecutionResult {
                task_id: format!("{}", i),
                identifier: format!("MOB-{}", 200 + i),
                success: false,
                status: ExecutionStatus::VerificationFailed,
                token_usage: None,
                duration_ms: 3000,
                error: Some(err.to_string()),
                pane_id: Some(format!("%{}", i)),
                raw_output: None,
                input_tokens: None,
                output_tokens: None,
            })
            .collect();

        let agg = aggregate_results(&results);
        assert_eq!(agg.total, 3);
        assert_eq!(agg.succeeded, 0);
        assert_eq!(agg.failed, 3);
        assert!(agg.completed.is_empty());
        assert_eq!(agg.failed_tasks.len(), 3);
        // Each failure message should contain the identifier and error
        assert!(agg.failed_tasks[0].contains("MOB-200"));
        assert!(agg.failed_tasks[0].contains("Type mismatch"));
        assert!(agg.failed_tasks[1].contains("MOB-201"));
        assert!(agg.failed_tasks[2].contains("MOB-202"));
    }

    #[test]
    fn test_aggregate_results_mixed() {
        let results = vec![
            ExecutionResult {
                task_id: "1".to_string(),
                identifier: "MOB-301".to_string(),
                success: true,
                status: ExecutionStatus::SubtaskComplete,
                token_usage: None,
                duration_ms: 5000,
                error: None,
                pane_id: Some("%0".to_string()),
                raw_output: None,
                input_tokens: None,
                output_tokens: None,
            },
            ExecutionResult {
                task_id: "2".to_string(),
                identifier: "MOB-302".to_string(),
                success: false,
                status: ExecutionStatus::VerificationFailed,
                token_usage: None,
                duration_ms: 8000,
                error: Some("Tests failed".to_string()),
                pane_id: Some("%1".to_string()),
                raw_output: None,
                input_tokens: None,
                output_tokens: None,
            },
            ExecutionResult {
                task_id: "3".to_string(),
                identifier: "MOB-303".to_string(),
                success: false,
                status: ExecutionStatus::Error,
                token_usage: None,
                duration_ms: 1000,
                error: Some("Agent timed out".to_string()),
                pane_id: Some("%2".to_string()),
                raw_output: None,
                input_tokens: None,
                output_tokens: None,
            },
            ExecutionResult {
                task_id: "4".to_string(),
                identifier: "MOB-304".to_string(),
                success: true,
                status: ExecutionStatus::SubtaskComplete,
                token_usage: None,
                duration_ms: 6000,
                error: None,
                pane_id: Some("%3".to_string()),
                raw_output: None,
                input_tokens: None,
                output_tokens: None,
            },
        ];

        let agg = aggregate_results(&results);
        assert_eq!(agg.total, 4);
        assert_eq!(agg.succeeded, 2);
        assert_eq!(agg.failed, 2);
        assert_eq!(agg.completed, vec!["MOB-301", "MOB-304"]);
        assert_eq!(agg.failed_tasks.len(), 2);
        assert!(agg.failed_tasks[0].contains("MOB-302"));
        assert!(agg.failed_tasks[0].contains("Tests failed"));
        assert!(agg.failed_tasks[1].contains("MOB-303"));
        assert!(agg.failed_tasks[1].contains("Agent timed out"));
    }

    // --- select_model_for_task Tests ---

    #[test]
    fn test_select_model_uses_scoring_when_present() {
        use crate::types::task_graph::TaskScoring;

        let mut task = make_task("1", "MOB-101", "Task with scoring");
        task.scoring = Some(TaskScoring {
            complexity: 3,
            risk: 1,
            recommended_model: Model::Haiku,
            rationale: "Simple task".to_string(),
        });

        let model = select_model_for_task(&task, Model::Opus);
        assert_eq!(model, Model::Haiku);
    }

    #[test]
    fn test_select_model_falls_back_to_config_when_no_scoring() {
        let task = make_task("1", "MOB-101", "Task without scoring");
        assert!(task.scoring.is_none());

        let model = select_model_for_task(&task, Model::Sonnet);
        assert_eq!(model, Model::Sonnet);
    }

    #[test]
    fn test_select_model_different_scoring_models() {
        use crate::types::task_graph::TaskScoring;

        let models = [Model::Haiku, Model::Sonnet, Model::Opus];
        for expected_model in models {
            let mut task = make_task("1", "MOB-101", "Task");
            task.scoring = Some(TaskScoring {
                complexity: 5,
                risk: 3,
                recommended_model: expected_model,
                rationale: "Test".to_string(),
            });
            assert_eq!(select_model_for_task(&task, Model::Opus), expected_model);
        }
    }
}
