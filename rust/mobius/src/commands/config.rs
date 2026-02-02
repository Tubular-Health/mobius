//! Config command - Show or edit current configuration

use colored::Colorize;
use std::path::Path;
use std::process::Command;

use crate::config::loader::read_config;
use crate::config::paths::resolve_paths;

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
        println!(
            "  {} {} (not found)",
            "○".red(),
            paths.config_path
        );
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
    match read_config(&paths.config_path) {
        Ok(config) => {
            println!("{}", "\nCurrent settings:".dimmed());
            println!("  backend:         {}", format!("{}", config.backend).cyan());
            println!(
                "  model:           {}",
                format!("{}", config.execution.model).cyan()
            );
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

    let status = Command::new(&editor)
        .arg(config_path)
        .status();

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
