//! Run command - Execute sub-tasks sequentially via bash script

use colored::Colorize;
use std::path::Path;
use std::process::Command;

use crate::config::loader::read_config;
use crate::config::paths::resolve_paths;
use crate::types::enums::Backend;

pub fn run(
    task_id: &str,
    max_iterations: Option<u32>,
    no_sandbox: bool,
    backend_override: Option<&str>,
    model_override: Option<&str>,
    delay: Option<u32>,
) -> anyhow::Result<()> {
    let paths = resolve_paths();

    // Verify script exists
    if !Path::new(&paths.script_path).exists() {
        eprintln!(
            "{}",
            format!("Error: Script not found at {}", paths.script_path).red()
        );
        eprintln!(
            "{}",
            "Run 'mobius setup' to install Mobius properly.".dimmed()
        );
        std::process::exit(1);
    }

    // Load config
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
            format!("Error: Invalid task ID format for {}: {}", backend, task_id).red()
        );
        eprintln!(
            "{}",
            "Expected format: PREFIX-NUMBER (e.g., MOB-123)".dimmed()
        );
        std::process::exit(1);
    }

    // Build arguments for bash script
    let mut args: Vec<String> = vec![task_id.to_string()];

    if let Some(max_iter) = max_iterations {
        args.push(max_iter.to_string());
    }

    if no_sandbox {
        args.push("--no-sandbox".to_string());
    }

    if let Some(b) = backend_override {
        args.push(format!("--backend={}", b));
    }

    if let Some(m) = model_override {
        args.push(format!("--model={}", m));
    }

    if let Some(d) = delay {
        args.push(format!("--delay={}", d));
    }

    // Execute the bash script
    let status = Command::new(&paths.script_path)
        .args(&args)
        .env("MOBIUS_CONFIG_FILE", &paths.config_path)
        .stdin(std::process::Stdio::inherit())
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit())
        .status();

    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => std::process::exit(s.code().unwrap_or(1)),
        Err(e) => {
            eprintln!("{}", format!("Error running script: {}", e).red());
            std::process::exit(1);
        }
    }
}

fn validate_task_id(task_id: &str, backend: &Backend) -> bool {
    let pattern = match backend {
        Backend::Linear => regex::Regex::new(r"^[A-Z]+-\d+$").unwrap(),
        Backend::Jira => regex::Regex::new(r"^[A-Z]+-\d+$").unwrap(),
        Backend::Local => regex::Regex::new(r"^(LOC-\d+|task-\d+)$").unwrap(),
    };
    pattern.is_match(task_id)
}
