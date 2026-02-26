use crate::types::{AgentRuntime, ExecutionConfig};

const OPENCODE_DEFAULT_MODEL: &str = "openai/gpt-5.3-codex";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelFamily {
    Claude,
    Gpt,
    Unknown,
}

pub fn detect_model_family(raw_model: &str) -> ModelFamily {
    let normalized = raw_model.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return ModelFamily::Unknown;
    }

    if matches!(normalized.as_str(), "opus" | "sonnet" | "haiku")
        || normalized.starts_with("claude")
        || normalized.starts_with("anthropic/")
        || normalized.contains("claude-")
    {
        return ModelFamily::Claude;
    }

    if normalized.starts_with("openai/")
        || normalized.starts_with("gpt-")
        || normalized.contains("/gpt-")
    {
        return ModelFamily::Gpt;
    }

    ModelFamily::Unknown
}

pub fn resolve_runtime_for_model(
    configured_runtime: AgentRuntime,
    raw_model: &str,
) -> Result<AgentRuntime, String> {
    let model = raw_model.trim();
    if model.is_empty() {
        return Err("Model must not be empty".to_string());
    }

    match configured_runtime {
        AgentRuntime::Claude => {
            let family = detect_model_family(model);
            if family == ModelFamily::Claude {
                Ok(AgentRuntime::Claude)
            } else {
                Err(format!(
                    "Model '{model}' is incompatible with runtime 'claude'. Use a Claude-family model (opus/sonnet/haiku or anthropic/claude-*), or set runtime to 'opencode'/'both'."
                ))
            }
        }
        AgentRuntime::Opencode => {
            let normalized = normalize_opencode_model(model);
            let family = detect_model_family(&normalized);
            if family == ModelFamily::Gpt {
                Ok(AgentRuntime::Opencode)
            } else {
                Err(format!(
                    "Model '{model}' is incompatible with runtime 'opencode'. Use a GPT-family model (openai/gpt-* or gpt-*), or set runtime to 'claude'/'both'."
                ))
            }
        }
        AgentRuntime::Both => match detect_model_family(model) {
            ModelFamily::Claude => Ok(AgentRuntime::Claude),
            ModelFamily::Gpt => Ok(AgentRuntime::Opencode),
            ModelFamily::Unknown => Err(format!(
                "Model '{model}' is not recognized for runtime 'both'. Use Claude-family (opus/sonnet/haiku or anthropic/claude-*) or GPT-family (openai/gpt-* or gpt-*)."
            )),
        },
    }
}

fn shell_escape_double_quoted(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '$' => escaped.push_str("\\$"),
            '`' => escaped.push_str("\\`"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

fn shell_quote_single(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

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
        .replace(['_', ' '], "-");
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
        AgentRuntime::Both => None,
    }
}

pub fn effective_model_for_runtime(
    runtime: AgentRuntime,
    config: &ExecutionConfig,
    model_override: Option<&str>,
) -> String {
    resolve_model_and_runtime(runtime, config, model_override)
        .map(|(_, model)| model)
        .unwrap_or_else(|_| config.model.to_string())
}

pub fn effective_runtime_for_model(
    runtime: AgentRuntime,
    config: &ExecutionConfig,
    model_override: Option<&str>,
) -> Result<AgentRuntime, String> {
    resolve_model_and_runtime(runtime, config, model_override)
        .map(|(resolved_runtime, _)| resolved_runtime)
}

fn resolve_model_and_runtime(
    runtime: AgentRuntime,
    config: &ExecutionConfig,
    model_override: Option<&str>,
) -> Result<(AgentRuntime, String), String> {
    let requested_model = match runtime {
        AgentRuntime::Claude => config.model.trim().to_string(),
        AgentRuntime::Opencode | AgentRuntime::Both => model_override
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string())
            .unwrap_or_else(|| config.model.trim().to_string()),
    };

    let resolved_runtime = resolve_runtime_for_model(runtime, &requested_model)?;
    let normalized_model = match resolved_runtime {
        AgentRuntime::Claude => requested_model,
        AgentRuntime::Opencode => normalize_opencode_model(&requested_model),
        AgentRuntime::Both => requested_model,
    };

    Ok((resolved_runtime, normalized_model))
}

pub struct ExecutionCommand<'a> {
    pub subtask_identifier: &'a str,
    pub skill: &'a str,
    pub worktree_path: &'a str,
    pub config: &'a ExecutionConfig,
    pub context_file_path: Option<&'a str>,
    pub model_override: Option<&'a str>,
    pub thinking_level_override: Option<&'a str>,
}

pub fn build_execution_command(runtime: AgentRuntime, options: &ExecutionCommand<'_>) -> String {
    let env_prefix = options
        .context_file_path
        .map(|path| {
            format!(
                "MOBIUS_CONTEXT_FILE=\"{}\" MOBIUS_TASK_ID=\"{}\" ",
                path, options.subtask_identifier
            )
        })
        .unwrap_or_default();

    let (resolved_runtime, model) =
        match resolve_model_and_runtime(runtime, options.config, options.model_override) {
            Ok(result) => result,
            Err(error) => {
                return format!(
                    "cd \"{}\" && printf \"%s\\n\" \"Error: {}\" && exit 1",
                    options.worktree_path,
                    shell_escape_double_quoted(&error)
                )
            }
        };

    match resolved_runtime {
        AgentRuntime::Claude => {
            let model_flag = format!("--model {}", shell_quote_single(&model));
            let disallowed_tools_flag = options
                .config
                .disallowed_tools
                .as_ref()
                .filter(|tools| !tools.is_empty())
                .map(|tools| format!("--disallowedTools {}", shell_quote_single(&tools.join(","))))
                .unwrap_or_default();

            let mut parts = vec![model_flag];
            if !disallowed_tools_flag.is_empty() {
                parts.push(disallowed_tools_flag);
            }
            let flags = parts.join(" ");

            format!(
                "cd \"{}\" && echo '{} {}' | {}claude -p --dangerously-skip-permissions --verbose --output-format stream-json {} | cclean",
                options.worktree_path,
                options.skill,
                options.subtask_identifier,
                env_prefix,
                flags
            )
        }
        AgentRuntime::Opencode => {
            let prompt = build_opencode_skill_prompt(options.skill, options.subtask_identifier);
            format!(
                "cd \"{}\" && {}opencode run {} --model {}{}",
                options.worktree_path,
                env_prefix,
                shell_quote_single(&prompt),
                shell_quote_single(&model),
                effective_thinking_level_for_runtime(
                    AgentRuntime::Opencode,
                    options.thinking_level_override,
                )
                .map(|level| format!(" --variant {}", shell_quote_single(&level)))
                .unwrap_or_default(),
            )
        }
        AgentRuntime::Both => unreachable!("runtime resolution returns concrete runtime"),
    }
}

pub fn build_submit_command(
    runtime: AgentRuntime,
    model: &str,
    use_cclean: bool,
    thinking_level_override: Option<&str>,
) -> String {
    let resolved_runtime = match resolve_runtime_for_model(runtime, model) {
        Ok(resolved_runtime) => resolved_runtime,
        Err(error) => {
            return format!(
                "printf \"%s\\n\" \"Error: {}\" && exit 1",
                shell_escape_double_quoted(&error)
            )
        }
    };

    match resolved_runtime {
        AgentRuntime::Claude => {
            let output_format = if use_cclean {
                "--output-format=stream-json"
            } else {
                "--output-format=text"
            };
            let base = format!(
                "claude -p --dangerously-skip-permissions --verbose {} --model {}",
                output_format,
                shell_quote_single(model)
            );

            if use_cclean {
                format!("{} | cclean", base)
            } else {
                base
            }
        }
        AgentRuntime::Opencode => format!(
            "opencode run --model {}{}",
            shell_quote_single(&normalize_opencode_model(model)),
            effective_thinking_level_for_runtime(AgentRuntime::Opencode, thinking_level_override)
                .map(|level| format!(" --variant {}", shell_quote_single(&level)))
                .unwrap_or_default(),
        ),
        AgentRuntime::Both => unreachable!("runtime resolution returns concrete runtime"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_execution_command_claude() {
        let config = ExecutionConfig::default();
        let options = ExecutionCommand {
            subtask_identifier: "MOB-101",
            skill: "/execute",
            worktree_path: "/tmp/worktree",
            config: &config,
            context_file_path: None,
            model_override: None,
            thinking_level_override: None,
        };
        let cmd = build_execution_command(AgentRuntime::Claude, &options);

        assert!(cmd.contains("claude -p"));
        assert!(cmd.contains("--dangerously-skip-permissions"));
        assert!(cmd.contains("--output-format stream-json"));
    }

    #[test]
    fn test_build_execution_command_opencode() {
        let config = ExecutionConfig::default();
        let options = ExecutionCommand {
            subtask_identifier: "MOB-101",
            skill: "/execute",
            worktree_path: "/tmp/worktree",
            config: &config,
            context_file_path: None,
            model_override: None,
            thinking_level_override: None,
        };
        let cmd = build_execution_command(AgentRuntime::Opencode, &options);

        assert!(cmd.contains(
            "opencode run 'Use the execute skill for sub-task MOB-101. First call the skill tool with name execute.'"
        ));
        assert!(cmd.contains("--model 'openai/gpt-5.3-codex'"));
        assert!(!cmd.contains("claude -p"));
        assert!(!cmd.contains("| cclean"));
        assert!(!cmd.contains("echo '/execute MOB-101'"));
    }

    #[test]
    fn test_build_execution_command_opencode_with_context_file() {
        let config = ExecutionConfig::default();
        let options = ExecutionCommand {
            subtask_identifier: "MOB-101",
            skill: "/execute",
            worktree_path: "/tmp/worktree",
            config: &config,
            context_file_path: Some("/tmp/context.json"),
            model_override: None,
            thinking_level_override: None,
        };
        let cmd = build_execution_command(AgentRuntime::Opencode, &options);

        assert!(cmd.contains("MOBIUS_CONTEXT_FILE=\"/tmp/context.json\""));
        assert!(cmd.contains("MOBIUS_TASK_ID=\"MOB-101\""));
        assert!(cmd.contains("Use the execute skill for sub-task MOB-101"));
    }

    #[test]
    fn test_build_execution_command_opencode_normalizes_skill_name() {
        let config = ExecutionConfig::default();
        let options = ExecutionCommand {
            subtask_identifier: "MOB-101",
            skill: "/verify",
            worktree_path: "/tmp/worktree",
            config: &config,
            context_file_path: None,
            model_override: None,
            thinking_level_override: None,
        };
        let cmd = build_execution_command(AgentRuntime::Opencode, &options);

        assert!(cmd.contains("Use the verify skill for sub-task MOB-101"));
    }

    #[test]
    fn test_build_submit_command_claude() {
        let cmd = build_submit_command(AgentRuntime::Claude, "opus", true, Some("xhigh"));
        assert!(cmd.contains("claude -p"));
        assert!(cmd.contains("--model 'opus'"));
        assert!(cmd.contains("| cclean"));
        assert!(!cmd.contains("--variant"));
    }

    #[test]
    fn test_build_submit_command_opencode() {
        let cmd = build_submit_command(AgentRuntime::Opencode, "opus", true, Some("xhigh"));
        assert!(cmd.contains("opencode run"));
        assert!(cmd.contains("--model 'openai/gpt-5.3-codex'"));
        assert!(cmd.contains("--variant 'max'"));
        assert!(!cmd.contains("claude -p"));
        assert!(!cmd.contains("| cclean"));
    }

    #[test]
    fn test_build_execution_command_both_routes_claude_family_to_claude() {
        let config = ExecutionConfig::default();
        let options = ExecutionCommand {
            subtask_identifier: "MOB-101",
            skill: "/execute",
            worktree_path: "/tmp/worktree",
            config: &config,
            context_file_path: None,
            model_override: Some("claude-sonnet-4-5"),
            thinking_level_override: Some("xhigh"),
        };

        let cmd = build_execution_command(AgentRuntime::Both, &options);
        assert!(cmd.contains("claude -p"));
        assert!(!cmd.contains("opencode run"));
        assert!(!cmd.contains("--variant"));
    }

    #[test]
    fn test_build_execution_command_both_routes_gpt_family_to_opencode() {
        let config = ExecutionConfig::default();
        let options = ExecutionCommand {
            subtask_identifier: "MOB-101",
            skill: "/execute",
            worktree_path: "/tmp/worktree",
            config: &config,
            context_file_path: None,
            model_override: Some("gpt-5.3-codex"),
            thinking_level_override: Some("xhigh"),
        };

        let cmd = build_execution_command(AgentRuntime::Both, &options);
        assert!(cmd.contains("opencode run"));
        assert!(cmd.contains("--model 'openai/gpt-5.3-codex'"));
        assert!(cmd.contains("--variant 'max'"));
        assert!(!cmd.contains("claude -p"));
    }

    #[test]
    fn test_build_execution_command_claude_quotes_model_argument() {
        let config = ExecutionConfig {
            model: "claude-sonnet-4-5; touch /tmp/pwn".to_string(),
            ..ExecutionConfig::default()
        };
        let options = ExecutionCommand {
            subtask_identifier: "MOB-101",
            skill: "/execute",
            worktree_path: "/tmp/worktree",
            config: &config,
            context_file_path: None,
            model_override: None,
            thinking_level_override: None,
        };
        let cmd = build_execution_command(AgentRuntime::Claude, &options);
        assert!(cmd.contains("--model 'claude-sonnet-4-5; touch /tmp/pwn'"));
    }

    #[test]
    fn test_build_execution_command_opencode_quotes_model_argument() {
        let config = ExecutionConfig::default();
        let options = ExecutionCommand {
            subtask_identifier: "MOB-101",
            skill: "/execute",
            worktree_path: "/tmp/worktree",
            config: &config,
            context_file_path: None,
            model_override: Some("openai/gpt-5.3-codex; touch /tmp/pwn"),
            thinking_level_override: None,
        };
        let cmd = build_execution_command(AgentRuntime::Opencode, &options);
        assert!(cmd.contains("--model 'openai/gpt-5.3-codex; touch /tmp/pwn'"));
    }

    #[test]
    fn test_build_execution_command_returns_actionable_error_for_incompatible_runtime() {
        let mut config = ExecutionConfig::default();
        config.model = "openai/gpt-5.3-codex".to_string();
        let options = ExecutionCommand {
            subtask_identifier: "MOB-101",
            skill: "/execute",
            worktree_path: "/tmp/worktree",
            config: &config,
            context_file_path: None,
            model_override: None,
            thinking_level_override: None,
        };

        let cmd = build_execution_command(AgentRuntime::Claude, &options);
        assert!(cmd
            .contains("Error: Model 'openai/gpt-5.3-codex' is incompatible with runtime 'claude'"));
        assert!(cmd.contains("runtime to 'opencode'/'both'"));
    }

    #[test]
    fn test_build_execution_command_escapes_shell_substitutions_in_error_path() {
        let mut config = ExecutionConfig::default();
        config.model = "openai/gpt-5.3-codex$(touch /tmp/pwn)`whoami`".to_string();
        let options = ExecutionCommand {
            subtask_identifier: "MOB-101",
            skill: "/execute",
            worktree_path: "/tmp/worktree",
            config: &config,
            context_file_path: None,
            model_override: None,
            thinking_level_override: None,
        };

        let cmd = build_execution_command(AgentRuntime::Claude, &options);
        assert!(cmd.contains("openai/gpt-5.3-codex\\$(touch /tmp/pwn)\\`whoami\\`"));
    }

    #[test]
    fn test_build_submit_command_both_routes_by_model_family() {
        let claude_cmd = build_submit_command(
            AgentRuntime::Both,
            "anthropic/claude-3-7-sonnet-latest",
            true,
            Some("xhigh"),
        );
        assert!(claude_cmd.contains("claude -p"));
        assert!(!claude_cmd.contains("opencode run"));

        let opencode_cmd = build_submit_command(AgentRuntime::Both, "gpt-5.2", false, Some("med"));
        assert!(opencode_cmd.contains("opencode run"));
        assert!(opencode_cmd.contains("--model 'openai/gpt-5.2'"));
        assert!(opencode_cmd.contains("--variant 'medium'"));
        assert!(!opencode_cmd.contains("claude -p"));
    }

    #[test]
    fn test_resolve_runtime_for_model_both_rejects_unknown_family() {
        let error = resolve_runtime_for_model(AgentRuntime::Both, "llama3").unwrap_err();
        assert_eq!(
            error,
            "Model 'llama3' is not recognized for runtime 'both'. Use Claude-family (opus/sonnet/haiku or anthropic/claude-*) or GPT-family (openai/gpt-* or gpt-*)."
        );
    }

    #[test]
    fn test_build_submit_command_escapes_shell_substitutions_in_error_path() {
        let cmd = build_submit_command(
            AgentRuntime::Both,
            "llama$(touch /tmp/pwn)`whoami`",
            false,
            None,
        );
        assert!(cmd.contains("llama\\$(touch /tmp/pwn)\\`whoami\\`"));
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
    fn test_effective_model_for_runtime_both_normalizes_gpt_override() {
        let config = ExecutionConfig::default();
        let model = effective_model_for_runtime(AgentRuntime::Both, &config, Some("gpt-5.1-codex"));
        assert_eq!(model, "openai/gpt-5.1-codex");
    }

    #[test]
    fn test_effective_runtime_for_model_both_routes_from_model_family() {
        let config = ExecutionConfig::default();
        let runtime = effective_runtime_for_model(
            AgentRuntime::Both,
            &config,
            Some("anthropic/claude-3-7-sonnet-latest"),
        )
        .unwrap();
        assert_eq!(runtime, AgentRuntime::Claude);
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
