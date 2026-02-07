use crate::types::{AgentRuntime, ExecutionConfig};

const OPENCODE_DEFAULT_MODEL: &str = "openai/gpt-5.3-codex";

fn normalize_opencode_model(raw_model: &str) -> String {
    let trimmed = raw_model.trim();
    if trimmed.is_empty() {
        return OPENCODE_DEFAULT_MODEL.to_string();
    }

    if trimmed.contains('/') {
        return trimmed.to_string();
    }

    let alias = trimmed.to_ascii_lowercase().replace(' ', "-");
    match alias.as_str() {
        "opus" | "sonnet" | "haiku" | "gpt-5.3" | "gpt-5.3-codex" => {
            OPENCODE_DEFAULT_MODEL.to_string()
        }
        "gpt-5.2" => "openai/gpt-5.2".to_string(),
        "gpt-5.2-codex" => "openai/gpt-5.2-codex".to_string(),
        "gpt-5.1-codex" => "openai/gpt-5.1-codex".to_string(),
        "gpt-5.1-codex-max" => "openai/gpt-5.1-codex-max".to_string(),
        "gpt-5.1-codex-mini" => "openai/gpt-5.1-codex-mini".to_string(),
        _ => trimmed.to_string(),
    }
}

fn normalize_opencode_variant(raw_variant: &str) -> String {
    let alias = raw_variant
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-")
        .replace(' ', "-");
    match alias.as_str() {
        "xhigh" | "very-high" | "veryhigh" => "max".to_string(),
        "xlow" => "minimal".to_string(),
        "med" => "medium".to_string(),
        "min" => "minimal".to_string(),
        "" => String::new(),
        _ => alias,
    }
}

fn normalize_skill_name(skill: &str) -> String {
    let trimmed = skill.trim();
    let normalized = trimmed.trim_start_matches('/');

    if normalized.is_empty() {
        trimmed.to_string()
    } else {
        normalized.to_string()
    }
}

fn build_opencode_skill_prompt(skill: &str, subtask_identifier: &str) -> String {
    let skill_name = normalize_skill_name(skill);
    format!(
        "Use the {} skill for sub-task {}. First call the skill tool with name {}.",
        skill_name, subtask_identifier, skill_name
    )
}

pub fn effective_thinking_level_for_runtime(
    runtime: AgentRuntime,
    thinking_level_override: Option<&str>,
) -> Option<String> {
    match runtime {
        AgentRuntime::Claude => None,
        AgentRuntime::Opencode => thinking_level_override
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(normalize_opencode_variant)
            .filter(|value| !value.is_empty()),
    }
}

pub fn effective_model_for_runtime(
    runtime: AgentRuntime,
    config: &ExecutionConfig,
    model_override: Option<&str>,
) -> String {
    match runtime {
        AgentRuntime::Claude => config.model.to_string(),
        AgentRuntime::Opencode => {
            let requested_model = model_override
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
                .unwrap_or_else(|| config.model.to_string());
            normalize_opencode_model(&requested_model)
        }
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
    thinking_level_override: Option<&str>,
) -> String {
    let env_prefix = context_file_path
        .map(|path| {
            format!(
                "MOBIUS_CONTEXT_FILE=\"{}\" MOBIUS_TASK_ID=\"{}\" ",
                path, subtask_identifier
            )
        })
        .unwrap_or_default();

    let model = effective_model_for_runtime(runtime, config, model_override);

    match runtime {
        AgentRuntime::Claude => {
            let model_flag = format!("--model {}", model);
            let disallowed_tools_flag = config
                .disallowed_tools
                .as_ref()
                .filter(|tools| !tools.is_empty())
                .map(|tools| format!("--disallowedTools '{}'", tools.join(",")))
                .unwrap_or_default();

            let mut parts = vec![model_flag];
            if !disallowed_tools_flag.is_empty() {
                parts.push(disallowed_tools_flag);
            }
            let flags = parts.join(" ");

            format!(
                "cd \"{}\" && echo '{} {}' | {}claude -p --dangerously-skip-permissions --verbose --output-format stream-json {} | cclean",
                worktree_path, skill, subtask_identifier, env_prefix, flags
            )
        }
        AgentRuntime::Opencode => {
            let prompt = build_opencode_skill_prompt(skill, subtask_identifier);
            format!(
                "cd \"{}\" && {}opencode run '{}' --model {}{}",
                worktree_path,
                env_prefix,
                prompt,
                model,
                effective_thinking_level_for_runtime(runtime, thinking_level_override)
                    .map(|level| format!(" --variant {}", level))
                    .unwrap_or_default(),
            )
        }
    }
}

pub fn build_submit_command(
    runtime: AgentRuntime,
    model: &str,
    use_cclean: bool,
    thinking_level_override: Option<&str>,
) -> String {
    match runtime {
        AgentRuntime::Claude => {
            let output_format = if use_cclean {
                "--output-format=stream-json"
            } else {
                "--output-format=text"
            };
            let base = format!(
                "claude -p --dangerously-skip-permissions --verbose {} --model {}",
                output_format, model
            );

            if use_cclean {
                format!("{} | cclean", base)
            } else {
                base
            }
        }
        AgentRuntime::Opencode => format!(
            "opencode run --model {}{}",
            normalize_opencode_model(model),
            effective_thinking_level_for_runtime(runtime, thinking_level_override)
                .map(|level| format!(" --variant {}", level))
                .unwrap_or_default(),
        ),
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
            None,
        );

        assert!(cmd.contains(
            "opencode run 'Use the execute skill for sub-task MOB-101. First call the skill tool with name execute.'"
        ));
        assert!(cmd.contains("--model openai/gpt-5.3-codex"));
        assert!(!cmd.contains("claude -p"));
        assert!(!cmd.contains("| cclean"));
        assert!(!cmd.contains("echo '/execute MOB-101'"));
    }

    #[test]
    fn test_build_execution_command_opencode_with_context_file() {
        let config = ExecutionConfig::default();
        let cmd = build_execution_command(
            AgentRuntime::Opencode,
            "MOB-101",
            "/execute",
            "/tmp/worktree",
            &config,
            Some("/tmp/context.json"),
            None,
            None,
        );

        assert!(cmd.contains("MOBIUS_CONTEXT_FILE=\"/tmp/context.json\""));
        assert!(cmd.contains("MOBIUS_TASK_ID=\"MOB-101\""));
        assert!(cmd.contains("Use the execute skill for sub-task MOB-101"));
    }

    #[test]
    fn test_build_execution_command_opencode_normalizes_skill_name() {
        let config = ExecutionConfig::default();
        let cmd = build_execution_command(
            AgentRuntime::Opencode,
            "MOB-101",
            "/verify",
            "/tmp/worktree",
            &config,
            None,
            None,
            None,
        );

        assert!(cmd.contains("Use the verify skill for sub-task MOB-101"));
    }

    #[test]
    fn test_build_submit_command_claude() {
        let cmd = build_submit_command(AgentRuntime::Claude, "opus", true, Some("xhigh"));
        assert!(cmd.contains("claude -p"));
        assert!(cmd.contains("--model opus"));
        assert!(cmd.contains("| cclean"));
        assert!(!cmd.contains("--variant"));
    }

    #[test]
    fn test_build_submit_command_opencode() {
        let cmd = build_submit_command(AgentRuntime::Opencode, "opus", true, Some("xhigh"));
        assert!(cmd.contains("opencode run"));
        assert!(cmd.contains("--model openai/gpt-5.3-codex"));
        assert!(cmd.contains("--variant max"));
        assert!(!cmd.contains("claude -p"));
        assert!(!cmd.contains("| cclean"));
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
            effective_model_for_runtime(AgentRuntime::Opencode, &config, Some("gpt-5.3-codex"));
        assert_eq!(model, "openai/gpt-5.3-codex");
    }

    #[test]
    fn test_effective_model_for_runtime_opencode_maps_profile_default() {
        let config = ExecutionConfig::default();
        let model = effective_model_for_runtime(AgentRuntime::Opencode, &config, None);
        assert_eq!(model, "openai/gpt-5.3-codex");
    }

    #[test]
    fn test_effective_model_for_runtime_opencode_keeps_fully_qualified_override() {
        let config = ExecutionConfig::default();
        let model = effective_model_for_runtime(
            AgentRuntime::Opencode,
            &config,
            Some("openai/gpt-5.2-codex"),
        );
        assert_eq!(model, "openai/gpt-5.2-codex");
    }

    #[test]
    fn test_effective_thinking_level_for_runtime_opencode() {
        let level = effective_thinking_level_for_runtime(AgentRuntime::Opencode, Some("xhigh"));
        assert_eq!(level.as_deref(), Some("max"));
    }

    #[test]
    fn test_effective_thinking_level_for_runtime_claude_ignored() {
        let level = effective_thinking_level_for_runtime(AgentRuntime::Claude, Some("high"));
        assert!(level.is_none());
    }
}
