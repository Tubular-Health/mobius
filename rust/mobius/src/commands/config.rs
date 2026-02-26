//! Config command - Show or edit current configuration

use colored::Colorize;
use std::path::Path;
use std::process::Command;

use crate::config::loader::read_config_with_env;
use crate::config::paths::resolve_paths;
use crate::runtime_adapter;
use crate::types::AgentRuntime;

pub fn run(edit: bool) -> anyhow::Result<()> {
    let paths = resolve_paths();

    if edit {
        return edit_config(&paths.config_path);
    }

    println!("{}", "\nMobius Configuration\n".bold());

    // Show config location
    println!("{}", "Config location:".dimmed());
    if Path::new(&paths.config_path).exists() {
        println!(
            "  {} {} ({:?})",
            "●".green(),
            paths.config_path,
            paths.config_type
        );
    } else {
        println!("  {} {} (not found)", "○".red(), paths.config_path);
        println!(
            "\n  {}",
            "Run 'mobius setup' to create configuration.\n".dimmed()
        );
        return Ok(());
    }

    // Show skills location
    println!("{}", "\nSkills location:".dimmed());
    if Path::new(&paths.skills_path).exists() {
        println!("  {} {}", "●".green(), paths.skills_path);
    } else {
        println!("  {} {} (not found)", "○".red(), paths.skills_path);
    }

    // Read and display config
    match read_config_with_env(&paths.config_path) {
        Ok(config) => {
            let effective_model = runtime_adapter::effective_model_for_runtime(
                config.runtime,
                &config.execution,
                None,
            );
            let runtime_model_display =
                format_runtime_model_display(config.runtime, &effective_model);

            println!("{}", "\nCurrent settings:".dimmed());
            println!(
                "  runtime:         {}",
                format!("{}", config.runtime).cyan()
            );
            println!(
                "  backend:         {}",
                format!("{}", config.backend).cyan()
            );
            println!(
                "  model_profile:   {}",
                config.execution.model.to_string().cyan()
            );
            println!("  runtime_model:   {}", runtime_model_display.cyan());
            if let Some(runtime_behavior) = runtime_behavior_note(config.runtime) {
                println!("  runtime_route:   {}", runtime_behavior.cyan());
            }
            if let Some(task_type_models) = config.execution.task_type_models.as_ref() {
                println!("  task_models:      {}", "enabled".cyan());
                for (label, value) in format_task_type_model_rows(config.runtime, task_type_models)
                {
                    println!("    {:<14} {}", label, value.cyan());
                }
            }
            println!(
                "  delay_seconds:   {}",
                format!("{}", config.execution.delay_seconds).cyan()
            );
            println!(
                "  max_iterations:  {}",
                format!("{}", config.execution.max_iterations).cyan()
            );
            println!(
                "  sandbox:         {}",
                format!("{}", config.execution.sandbox).cyan()
            );
            println!(
                "  container:       {}",
                config.execution.container_name.cyan()
            );

            println!("{}", "\nEnvironment overrides:".dimmed());
            let env_vars = [
                "MOBIUS_RUNTIME",
                "MOBIUS_BACKEND",
                "MOBIUS_DELAY_SECONDS",
                "MOBIUS_MAX_ITERATIONS",
                "MOBIUS_MODEL",
                "MOBIUS_SANDBOX_ENABLED",
                "MOBIUS_CONTAINER",
            ];

            let mut has_overrides = false;
            for var in &env_vars {
                if let Ok(val) = std::env::var(var) {
                    println!("  {}={}", var, val.yellow());
                    has_overrides = true;
                }
            }
            if !has_overrides {
                println!("  {}", "(none)".dimmed());
            }

            println!();
        }
        Err(e) => {
            eprintln!("\n{}", "Error reading config:".red());
            eprintln!("  {}", format!("{}", e).dimmed());
            println!();
        }
    }

    Ok(())
}

fn format_runtime_model_display(runtime: AgentRuntime, effective_model: &str) -> String {
    match runtime {
        AgentRuntime::Both => format!("{} (family-routed)", effective_model),
        _ => effective_model.to_string(),
    }
}

fn runtime_behavior_note(runtime: AgentRuntime) -> Option<&'static str> {
    match runtime {
        AgentRuntime::Both => {
            Some("Claude-family models use claude runtime; GPT-family models use opencode runtime")
        }
        _ => None,
    }
}

fn format_task_type_model_rows(
    runtime: AgentRuntime,
    task_type_models: &crate::types::config::TaskTypeModelRoutingConfig,
) -> Vec<(String, String)> {
    vec![
        (
            "general".to_string(),
            format_model_target(runtime, &task_type_models.general, None),
        ),
        (
            "frontend".to_string(),
            format_model_target(
                runtime,
                task_type_models
                    .frontend
                    .as_deref()
                    .unwrap_or(&task_type_models.general),
                task_type_models
                    .frontend
                    .is_none()
                    .then_some("fallback: general"),
            ),
        ),
        (
            "backend".to_string(),
            format_model_target(
                runtime,
                task_type_models
                    .backend
                    .as_deref()
                    .unwrap_or(&task_type_models.general),
                task_type_models
                    .backend
                    .is_none()
                    .then_some("fallback: general"),
            ),
        ),
    ]
}

fn format_model_target(runtime: AgentRuntime, model: &str, note: Option<&str>) -> String {
    let runtime_label = resolved_runtime_label(runtime, model);
    match note {
        Some(note) => format!("{} -> {} ({})", model, runtime_label, note),
        None => format!("{} -> {}", model, runtime_label),
    }
}

fn resolved_runtime_label(runtime: AgentRuntime, model: &str) -> &'static str {
    match runtime {
        AgentRuntime::Claude => "claude",
        AgentRuntime::Opencode => "opencode",
        AgentRuntime::Both => match model_family(model) {
            ModelFamily::Claude => "claude",
            ModelFamily::Gpt => "opencode",
            ModelFamily::Unknown => "unknown-family",
        },
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ModelFamily {
    Claude,
    Gpt,
    Unknown,
}

fn model_family(model: &str) -> ModelFamily {
    let normalized = model.trim().to_ascii_lowercase();
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

fn edit_config(config_path: &str) -> anyhow::Result<()> {
    if !Path::new(config_path).exists() {
        eprintln!("{}", format!("Config not found at {}", config_path).red());
        eprintln!("{}", "Run 'mobius setup' to create configuration.".dimmed());
        std::process::exit(1);
    }

    let editor = std::env::var("VISUAL")
        .or_else(|_| std::env::var("EDITOR"))
        .unwrap_or_else(|_| "vi".to_string());

    println!(
        "{}",
        format!("Opening {} in {}...\n", config_path, editor).dimmed()
    );

    let status = Command::new(&editor).arg(config_path).status();

    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(_) => {
            eprintln!("{}", format!("Editor {} exited with error", editor).red());
            std::process::exit(1);
        }
        Err(_) => {
            eprintln!("{}", format!("Failed to open editor: {}", editor).red());
            eprintln!(
                "{}",
                "Set EDITOR or VISUAL environment variable to your preferred editor.".dimmed()
            );
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::config::TaskTypeModelRoutingConfig;
    use crate::types::AgentRuntime;

    #[test]
    fn test_runtime_both_behavior_note_is_present() {
        let note = runtime_behavior_note(AgentRuntime::Both);
        assert_eq!(
            note,
            Some("Claude-family models use claude runtime; GPT-family models use opencode runtime")
        );
    }

    #[test]
    fn test_runtime_model_display_marks_family_routed_for_both() {
        assert_eq!(
            format_runtime_model_display(AgentRuntime::Both, "opus"),
            "opus (family-routed)"
        );
        assert_eq!(
            format_runtime_model_display(AgentRuntime::Claude, "opus"),
            "opus"
        );
    }

    #[test]
    fn test_task_type_models_include_fallbacks_and_runtime_targets() {
        let routing = TaskTypeModelRoutingConfig {
            frontend: None,
            backend: Some("openai/gpt-5.3-codex".to_string()),
            general: "opus".to_string(),
        };

        let rows = format_task_type_model_rows(AgentRuntime::Both, &routing);

        assert_eq!(rows[0].0, "general");
        assert_eq!(rows[0].1, "opus -> claude");
        assert_eq!(rows[1].0, "frontend");
        assert_eq!(rows[1].1, "opus -> claude (fallback: general)");
        assert_eq!(rows[2].0, "backend");
        assert_eq!(rows[2].1, "openai/gpt-5.3-codex -> opencode");
    }

    #[test]
    fn test_unknown_model_family_is_reported_safely() {
        assert_eq!(
            resolved_runtime_label(AgentRuntime::Both, "custom-model"),
            "unknown-family"
        );
    }
}
