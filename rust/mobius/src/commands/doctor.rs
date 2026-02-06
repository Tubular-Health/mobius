//! Doctor command - Check system requirements and configuration

use colored::Colorize;
use std::path::Path;
use std::process::Command;

use crate::config::loader::{read_config, read_config_with_env};
use crate::config::paths::resolve_paths;
use crate::types::enums::{AgentRuntime, Backend};

struct CheckResult {
    name: String,
    status: CheckStatus,
    message: String,
    required: bool,
    details: Option<String>,
}

enum CheckStatus {
    Pass,
    Fail,
    Warn,
}

fn format_result(result: &CheckResult) -> String {
    let icon = match result.status {
        CheckStatus::Pass => "✓".green().to_string(),
        CheckStatus::Fail => "✗".red().to_string(),
        CheckStatus::Warn => "!".yellow().to_string(),
    };

    let required_str = if result.required { "" } else { " (optional)" };
    let required_suffix = required_str.dimmed().to_string();

    let message = match result.status {
        CheckStatus::Fail => result.message.red().to_string(),
        _ => result.message.clone(),
    };

    let mut line = format!("  {} {}: {}{}", icon, result.name, message, required_suffix);

    if let Some(ref details) = result.details {
        if !matches!(result.status, CheckStatus::Pass) {
            line += &format!("\n      {}", details.dimmed());
        }
    }

    line
}

fn check_command_exists(name: &str) -> bool {
    which::which(name).is_ok()
}

fn check_command_version(name: &str) -> Option<String> {
    let output = Command::new(name).arg("--version").output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let version = if stdout.trim().is_empty() {
        stderr.trim().to_string()
    } else {
        stdout.trim().to_string()
    };
    if version.is_empty() {
        None
    } else {
        Some(version.lines().next().unwrap_or("").to_string())
    }
}

struct RuntimeCliSpec {
    command: &'static str,
    display_name: &'static str,
    install_hint: &'static str,
}

fn runtime_cli_spec(runtime: AgentRuntime) -> RuntimeCliSpec {
    match runtime {
        AgentRuntime::Claude => RuntimeCliSpec {
            command: "claude",
            display_name: "Claude CLI",
            install_hint: "Install: npm install -g @anthropic-ai/claude-code",
        },
        AgentRuntime::Opencode => RuntimeCliSpec {
            command: "opencode",
            display_name: "OpenCode CLI",
            install_hint: "Install opencode and ensure it is available in PATH",
        },
    }
}

fn check_runtime_cli_with<F, G>(
    runtime: AgentRuntime,
    command_exists: F,
    command_version: G,
) -> CheckResult
where
    F: Fn(&str) -> bool,
    G: Fn(&str) -> Option<String>,
{
    let spec = runtime_cli_spec(runtime);

    if command_exists(spec.command) {
        let version = command_version(spec.command).unwrap_or_else(|| "unknown version".into());
        CheckResult {
            name: spec.display_name.into(),
            status: CheckStatus::Pass,
            message: format!("Installed ({})", version),
            required: true,
            details: None,
        }
    } else {
        CheckResult {
            name: spec.display_name.into(),
            status: CheckStatus::Fail,
            message: "Not found".into(),
            required: true,
            details: Some(spec.install_hint.into()),
        }
    }
}

fn check_runtime_cli(runtime: AgentRuntime) -> CheckResult {
    check_runtime_cli_with(runtime, check_command_exists, check_command_version)
}

fn check_config(config_path: &str) -> CheckResult {
    if Path::new(config_path).exists() {
        match read_config(config_path) {
            Ok(_) => CheckResult {
                name: "Config".into(),
                status: CheckStatus::Pass,
                message: format!("Found at {}", config_path),
                required: true,
                details: None,
            },
            Err(e) => CheckResult {
                name: "Config".into(),
                status: CheckStatus::Fail,
                message: "Parse error".into(),
                required: true,
                details: Some(format!("{}", e)),
            },
        }
    } else {
        CheckResult {
            name: "Config".into(),
            status: CheckStatus::Fail,
            message: format!("Not found at {}", config_path),
            required: true,
            details: Some("Run 'mobius setup' to create configuration".into()),
        }
    }
}

fn check_path(skills_path: &str) -> CheckResult {
    if Path::new(skills_path).exists() {
        CheckResult {
            name: "Skills path".into(),
            status: CheckStatus::Pass,
            message: format!("Found at {}", skills_path),
            required: true,
            details: None,
        }
    } else {
        CheckResult {
            name: "Skills path".into(),
            status: CheckStatus::Fail,
            message: format!("Not found at {}", skills_path),
            required: true,
            details: Some("Run 'mobius setup' to install skills".into()),
        }
    }
}

fn check_git() -> CheckResult {
    if check_command_exists("git") {
        let version = check_command_version("git").unwrap_or_else(|| "unknown".into());
        CheckResult {
            name: "Git".into(),
            status: CheckStatus::Pass,
            message: format!("Installed ({})", version),
            required: true,
            details: None,
        }
    } else {
        CheckResult {
            name: "Git".into(),
            status: CheckStatus::Fail,
            message: "Not found".into(),
            required: true,
            details: Some("Install git for your platform".into()),
        }
    }
}

fn check_api_keys(backend: &Backend) -> CheckResult {
    match backend {
        Backend::Linear => {
            let has_key = std::env::var("LINEAR_API_KEY").is_ok()
                || std::env::var("LINEAR_API_TOKEN").is_ok();
            if has_key {
                CheckResult {
                    name: "API keys".into(),
                    status: CheckStatus::Pass,
                    message: "LINEAR_API_KEY or LINEAR_API_TOKEN set".into(),
                    required: true,
                    details: None,
                }
            } else {
                CheckResult {
                    name: "API keys".into(),
                    status: CheckStatus::Fail,
                    message: "LINEAR_API_KEY not set".into(),
                    required: true,
                    details: Some("Set LINEAR_API_KEY environment variable".into()),
                }
            }
        }
        Backend::Jira => {
            let has_host = std::env::var("JIRA_HOST").is_ok();
            let has_email = std::env::var("JIRA_EMAIL").is_ok();
            let has_token = std::env::var("JIRA_API_TOKEN").is_ok();

            if has_host && has_email && has_token {
                CheckResult {
                    name: "API keys".into(),
                    status: CheckStatus::Pass,
                    message: "JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN set".into(),
                    required: true,
                    details: None,
                }
            } else {
                let mut missing = Vec::new();
                if !has_host {
                    missing.push("JIRA_HOST");
                }
                if !has_email {
                    missing.push("JIRA_EMAIL");
                }
                if !has_token {
                    missing.push("JIRA_API_TOKEN");
                }
                CheckResult {
                    name: "API keys".into(),
                    status: CheckStatus::Fail,
                    message: format!("Missing: {}", missing.join(", ")),
                    required: true,
                    details: Some("Set Jira environment variables".into()),
                }
            }
        }
        Backend::Local => CheckResult {
            name: "API keys".into(),
            status: CheckStatus::Pass,
            message: "Not required for local backend".into(),
            required: true,
            details: None,
        },
    }
}

fn check_tmux() -> CheckResult {
    if check_command_exists("tmux") {
        let version = check_command_version("tmux").unwrap_or_else(|| "unknown".into());
        CheckResult {
            name: "tmux".into(),
            status: CheckStatus::Pass,
            message: format!("Installed ({})", version),
            required: false,
            details: None,
        }
    } else {
        CheckResult {
            name: "tmux".into(),
            status: CheckStatus::Warn,
            message: "Not found".into(),
            required: false,
            details: Some("Install: brew install tmux (macOS) or apt install tmux (Linux)".into()),
        }
    }
}

fn check_docker(sandbox_enabled: bool) -> CheckResult {
    if !sandbox_enabled {
        return CheckResult {
            name: "Docker".into(),
            status: CheckStatus::Pass,
            message: "Sandbox disabled".into(),
            required: false,
            details: None,
        };
    }

    if check_command_exists("docker") {
        CheckResult {
            name: "Docker".into(),
            status: CheckStatus::Pass,
            message: "Installed".into(),
            required: false,
            details: None,
        }
    } else {
        CheckResult {
            name: "Docker".into(),
            status: CheckStatus::Warn,
            message: "Not found (sandbox mode requires Docker)".into(),
            required: false,
            details: Some("Install Docker Desktop or Docker Engine".into()),
        }
    }
}

fn check_cclean() -> CheckResult {
    if check_command_exists("cclean") {
        CheckResult {
            name: "cclean".into(),
            status: CheckStatus::Pass,
            message: "Installed".into(),
            required: false,
            details: None,
        }
    } else {
        CheckResult {
            name: "cclean".into(),
            status: CheckStatus::Warn,
            message: "Not found".into(),
            required: false,
            details: Some("Install: npm install -g cclean".into()),
        }
    }
}

fn check_jq() -> CheckResult {
    if check_command_exists("jq") {
        CheckResult {
            name: "jq".into(),
            status: CheckStatus::Pass,
            message: "Installed".into(),
            required: false,
            details: None,
        }
    } else {
        CheckResult {
            name: "jq".into(),
            status: CheckStatus::Warn,
            message: "Not found".into(),
            required: false,
            details: Some("Install: brew install jq (macOS) or apt install jq (Linux)".into()),
        }
    }
}

pub fn run() -> anyhow::Result<()> {
    println!("{}", "\nLoop Doctor\n".bold());
    println!("Checking system requirements...\n");

    let paths = resolve_paths();

    // Try to read config for runtime, sandbox, and backend settings
    let mut runtime = AgentRuntime::Claude;
    let mut sandbox_enabled = false;
    let mut backend = Backend::Linear;

    if let Ok(config) = read_config_with_env(&paths.config_path) {
        runtime = config.runtime;
        sandbox_enabled = config.execution.sandbox;
        backend = config.backend;
    }

    // Run required checks
    let mut results = Vec::new();

    println!("{}", "Required:".bold());

    let runtime_result = check_runtime_cli(runtime);
    println!("{}", format_result(&runtime_result));
    results.push(runtime_result);

    let config_result = check_config(&paths.config_path);
    println!("{}", format_result(&config_result));
    results.push(config_result);

    let path_result = check_path(&paths.skills_path);
    println!("{}", format_result(&path_result));
    results.push(path_result);

    let git_result = check_git();
    println!("{}", format_result(&git_result));
    results.push(git_result);

    let api_result = check_api_keys(&backend);
    println!("{}", format_result(&api_result));
    results.push(api_result);

    // Optional checks
    println!("{}", "\nOptional:".bold());

    let docker_result = check_docker(sandbox_enabled);
    println!("{}", format_result(&docker_result));
    results.push(docker_result);

    let cclean_result = check_cclean();
    println!("{}", format_result(&cclean_result));
    results.push(cclean_result);

    let tmux_result = check_tmux();
    println!("{}", format_result(&tmux_result));
    results.push(tmux_result);

    let jq_result = check_jq();
    println!("{}", format_result(&jq_result));
    results.push(jq_result);

    // Summary
    println!();
    let failed: Vec<_> = results
        .iter()
        .filter(|r| matches!(r.status, CheckStatus::Fail) && r.required)
        .collect();
    let warnings: Vec<_> = results
        .iter()
        .filter(|r| {
            matches!(r.status, CheckStatus::Warn)
                || (matches!(r.status, CheckStatus::Fail) && !r.required)
        })
        .collect();

    if !failed.is_empty() {
        eprintln!(
            "{}",
            format!("✗ {} required check(s) failed", failed.len()).red()
        );
        eprintln!(
            "{}",
            "  Run 'mobius setup' to fix configuration issues\n".dimmed()
        );
        std::process::exit(1);
    } else if !warnings.is_empty() {
        println!(
            "{}",
            format!(
                "! All required checks passed, {} warning(s)",
                warnings.len()
            )
            .yellow()
        );
        println!(
            "{}",
            "  Mobius should work, but some features may be limited\n".green()
        );
    } else {
        println!(
            "{}",
            "✓ All checks passed! Mobius is ready to use.\n".green()
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_cli_spec_uses_expected_command_and_label() {
        let claude = runtime_cli_spec(AgentRuntime::Claude);
        assert_eq!(claude.command, "claude");
        assert_eq!(claude.display_name, "Claude CLI");

        let opencode = runtime_cli_spec(AgentRuntime::Opencode);
        assert_eq!(opencode.command, "opencode");
        assert_eq!(opencode.display_name, "OpenCode CLI");
    }

    #[test]
    fn opencode_runtime_does_not_require_claude_cli() {
        let result = check_runtime_cli_with(
            AgentRuntime::Opencode,
            |command| command == "opencode",
            |_| Some("opencode 1.0.0".to_string()),
        );

        assert!(matches!(result.status, CheckStatus::Pass));
        assert_eq!(result.name, "OpenCode CLI");
        assert!(result.message.contains("opencode 1.0.0"));
    }

    #[test]
    fn opencode_runtime_failure_uses_opencode_install_hint() {
        let result = check_runtime_cli_with(AgentRuntime::Opencode, |_| false, |_| None);

        assert!(matches!(result.status, CheckStatus::Fail));
        assert_eq!(result.name, "OpenCode CLI");
        assert_eq!(result.message, "Not found");
        assert!(result
            .details
            .as_deref()
            .unwrap_or_default()
            .contains("opencode"));
    }
}
