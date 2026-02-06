use crate::types::{AgentRuntime, ExecutionConfig};

pub fn effective_model_for_runtime(
    runtime: AgentRuntime,
    config: &ExecutionConfig,
    model_override: Option<&str>,
) -> String {
    match runtime {
        AgentRuntime::Claude => config.model.to_string(),
        AgentRuntime::Opencode => model_override
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string())
            .unwrap_or_else(|| config.model.to_string()),
    }
}

pub fn build_execution_command(
    runtime: AgentRuntime,
    subtask_identifier: &str,
    skill: &str,
    worktree_path: &str,
    config: &ExecutionConfig,
    context_file_path: Option<&str>,
    model_override: Option<&str>,
) -> String {
    let env_prefix = context_file_path
        .map(|path| {
            format!(
                "MOBIUS_CONTEXT_FILE=\"{}\" MOBIUS_TASK_ID=\"{}\" ",
                path, subtask_identifier
            )
        })
        .unwrap_or_default();

    let model_flag = format!(
        "--model {}",
        effective_model_for_runtime(runtime, config, model_override)
    );

    let disallowed_tools_flag = config
        .disallowed_tools
        .as_ref()
        .filter(|tools| !tools.is_empty())
        .map(|tools| match runtime {
            AgentRuntime::Claude => format!("--disallowedTools '{}'", tools.join(",")),
            AgentRuntime::Opencode => String::new(),
        })
        .unwrap_or_default();

    let mut parts = vec![model_flag];
    if !disallowed_tools_flag.is_empty() {
        parts.push(disallowed_tools_flag);
    }
    let flags = parts.join(" ");

    let runtime_command = match runtime {
        AgentRuntime::Claude => {
            format!(
                "claude -p --dangerously-skip-permissions --verbose --output-format stream-json {}",
                flags
            )
        }
        AgentRuntime::Opencode => format!("opencode -p {}", flags),
    };

    format!(
        "cd \"{}\" && echo '{} {}' | {}{} | cclean",
        worktree_path, skill, subtask_identifier, env_prefix, runtime_command
    )
}

pub fn build_submit_command(runtime: AgentRuntime, model: &str, use_cclean: bool) -> String {
    let base = match runtime {
        AgentRuntime::Claude => {
            let output_format = if use_cclean {
                "--output-format=stream-json"
            } else {
                "--output-format=text"
            };
            format!(
                "claude -p --dangerously-skip-permissions --verbose {} --model {}",
                output_format, model
            )
        }
        AgentRuntime::Opencode => format!("opencode -p --model {}", model),
    };

    if use_cclean {
        format!("{} | cclean", base)
    } else {
        base
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_execution_command_claude() {
        let config = ExecutionConfig::default();
        let cmd = build_execution_command(
            AgentRuntime::Claude,
            "MOB-101",
            "/execute",
            "/tmp/worktree",
            &config,
            None,
            None,
        );

        assert!(cmd.contains("claude -p"));
        assert!(cmd.contains("--dangerously-skip-permissions"));
        assert!(cmd.contains("--output-format stream-json"));
    }

    #[test]
    fn test_build_execution_command_opencode() {
        let config = ExecutionConfig::default();
        let cmd = build_execution_command(
            AgentRuntime::Opencode,
            "MOB-101",
            "/execute",
            "/tmp/worktree",
            &config,
            None,
            None,
        );

        assert!(cmd.contains("opencode -p"));
        assert!(!cmd.contains("claude -p"));
    }

    #[test]
    fn test_build_submit_command_claude() {
        let cmd = build_submit_command(AgentRuntime::Claude, "opus", true);
        assert!(cmd.contains("claude -p"));
        assert!(cmd.contains("--model opus"));
        assert!(cmd.contains("| cclean"));
    }

    #[test]
    fn test_build_submit_command_opencode() {
        let cmd = build_submit_command(AgentRuntime::Opencode, "o3", false);
        assert!(cmd.contains("opencode -p"));
        assert!(!cmd.contains("claude -p"));
    }

    #[test]
    fn test_effective_model_for_runtime_claude_ignores_raw_override() {
        let config = ExecutionConfig::default();
        let model = effective_model_for_runtime(AgentRuntime::Claude, &config, Some("custom-op"));
        assert_eq!(model, "opus");
    }

    #[test]
    fn test_effective_model_for_runtime_opencode_uses_raw_override() {
        let config = ExecutionConfig::default();
        let model =
            effective_model_for_runtime(AgentRuntime::Opencode, &config, Some("gpt-5-mini"));
        assert_eq!(model, "gpt-5-mini");
    }
}
