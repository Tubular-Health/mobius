//! Setup command - Interactive setup wizard

use colored::Colorize;
use std::path::Path;

use crate::config::loader::{config_exists, read_config_with_env, write_config};
use crate::config::paths::{
    find_local_config, get_global_config_dir, get_paths_for_type_with_runtime,
    get_settings_path_for_runtime, get_shortcuts_install_path, resolve_paths,
};
use crate::config::setup::{
    add_shortcuts_source_line, copy_commands, copy_shortcuts, copy_skills, ensure_runtime_settings,
};
use crate::types::config::{ExecutionConfig, LoopConfig, PathConfigType};
use crate::types::enums::{AgentRuntime, Backend, Model};

pub fn run(update_skills: bool, update_shortcuts: bool, _install: bool) -> anyhow::Result<()> {
    // --update-skills: Skip config wizard, just update skills/commands
    if update_skills {
        let local_config = find_local_config(None);
        let global_config_path = get_global_config_dir().join("config.yaml");
        let has_global_config = global_config_path.exists();

        if local_config.is_none() && !has_global_config {
            eprintln!(
                "{}",
                "\nError: No existing Mobius installation found.".red()
            );
            eprintln!(
                "{}",
                "Run `mobius setup` first to create a configuration.\n".dimmed()
            );
            std::process::exit(1);
        }

        println!("{}", "\nUpdating skills and commands...\n".bold());

        let paths = resolve_paths();
        let runtime = read_config_with_env(&paths.config_path)
            .map(|c| c.runtime)
            .unwrap_or(AgentRuntime::Claude);
        let bundled_skills = get_bundled_skills_dir();

        if bundled_skills.exists() {
            println!(
                "{}",
                format!("Copying skills to {}...", paths.skills_path).dimmed()
            );
            copy_skills(&bundled_skills, Path::new(&paths.skills_path))?;
        }

        let bundled_commands = get_bundled_commands_dir();
        if bundled_commands.exists() {
            println!("{}", "Copying commands...".dimmed());
            copy_commands(&bundled_commands, &paths, runtime)?;
        }

        if paths.config_type == PathConfigType::Local {
            let config_parent = Path::new(&paths.config_path)
                .parent()
                .unwrap_or(Path::new("."));
            let settings_path = get_settings_path_for_runtime(config_parent, runtime);
            println!(
                "{}",
                format!(
                    "Ensuring .mobius/ permissions in {}...",
                    settings_path.display()
                )
                .dimmed()
            );
            ensure_runtime_settings(config_parent, runtime)?;
        }

        println!("{}", "\n✓ Skills and commands updated!\n".green());
        println!(
            "{}",
            format!("Skills updated at: {}", paths.skills_path).dimmed()
        );
        println!();
        return Ok(());
    }

    // --update-shortcuts: Skip config wizard, just update shortcuts script
    if update_shortcuts {
        println!("{}", "\nUpdating shortcuts script...\n".bold());

        let bundled_shortcuts = get_bundled_shortcuts_path();
        if bundled_shortcuts.exists() {
            copy_shortcuts(&bundled_shortcuts)?;
        }

        println!(
            "{}",
            format!(
                "✓ Shortcuts script updated at {}",
                get_shortcuts_install_path().display()
            )
            .green()
        );
        println!(
            "{}",
            "\nTo enable shortcuts, add this to your shell rc file:".dimmed()
        );
        println!(
            "  {}",
            format!("source \"{}\"", get_shortcuts_install_path().display()).cyan()
        );
        println!();
        return Ok(());
    }

    // Full setup wizard
    println!("{}", "\nMobius Setup Wizard\n".bold());

    // 1. Installation type
    let install_type_idx = dialoguer::Select::new()
        .with_prompt("Installation type")
        .items(&[
            "Local (this project) - Config at ./mobius.config.yaml, runtime assets at ./.<runtime>/"
                .to_string(),
            format!(
                "Global (user-wide) - Config at {}/config.yaml, runtime assets at ~/.<runtime>/",
                get_global_config_dir().display()
            ),
        ])
        .default(0)
        .interact()?;

    let install_type = if install_type_idx == 0 {
        PathConfigType::Local
    } else {
        PathConfigType::Global
    };

    let default_paths = get_paths_for_type_with_runtime(install_type, None, AgentRuntime::Claude);
    let runtime = if config_exists(&default_paths.config_path) {
        read_config_with_env(&default_paths.config_path)
            .map(|c| c.runtime)
            .unwrap_or(AgentRuntime::Claude)
    } else {
        let runtime_idx = dialoguer::Select::new()
            .with_prompt("Agent runtime")
            .items(&[
                "Claude - Use Claude Code runtime",
                "OpenCode - Use OpenCode runtime",
            ])
            .default(0)
            .interact()?;
        if runtime_idx == 0 {
            AgentRuntime::Claude
        } else {
            AgentRuntime::Opencode
        }
    };

    if config_exists(&default_paths.config_path) {
        println!(
            "{}",
            format!("Using runtime from existing config: {runtime}").dimmed()
        );
    }

    let paths = get_paths_for_type_with_runtime(install_type, None, runtime);

    // Check for existing config
    if config_exists(&paths.config_path) {
        let overwrite = dialoguer::Confirm::new()
            .with_prompt(format!(
                "Config already exists at {}. Overwrite?",
                paths.config_path
            ))
            .default(false)
            .interact()?;

        if !overwrite {
            println!(
                "{}",
                "\nSetup cancelled. Existing config preserved.".yellow()
            );
            return Ok(());
        }
    }

    // 2. Backend
    let backend_idx = dialoguer::Select::new()
        .with_prompt("Issue tracker backend")
        .items(&[
            "Linear - Recommended, native MCP integration",
            "Jira - Atlassian Jira integration",
            "Local - No external issue tracker, issues stored in .mobius/",
        ])
        .default(0)
        .interact()?;

    let backend = match backend_idx {
        0 => Backend::Linear,
        1 => Backend::Jira,
        _ => Backend::Local,
    };

    // 3. Model
    let model_idx = dialoguer::Select::new()
        .with_prompt("Model profile")
        .items(&[
            "Opus - Most capable, best for complex tasks",
            "Sonnet - Balanced speed and capability",
            "Haiku - Fastest, good for simple tasks",
        ])
        .default(0)
        .interact()?;

    let model = match model_idx {
        0 => Model::Opus,
        1 => Model::Sonnet,
        _ => Model::Haiku,
    };

    // 4. Delay
    let delay_str: String = dialoguer::Input::new()
        .with_prompt("Delay between iterations (seconds)")
        .default("0".into())
        .validate_with(|input: &String| -> Result<(), &str> {
            input
                .parse::<u32>()
                .map(|_| ())
                .map_err(|_| "Please enter a non-negative number")
        })
        .interact_text()?;
    let delay_seconds: u32 = delay_str.parse().unwrap_or(0);

    // 5. Max iterations
    let max_iter_str: String = dialoguer::Input::new()
        .with_prompt("Maximum iterations per run (0 = unlimited)")
        .default("50".into())
        .validate_with(|input: &String| -> Result<(), &str> {
            input
                .parse::<u32>()
                .map(|_| ())
                .map_err(|_| "Please enter a non-negative number")
        })
        .interact_text()?;
    let max_iterations: u32 = max_iter_str.parse().unwrap_or(50);

    // 6. Sandbox
    let sandbox = dialoguer::Confirm::new()
        .with_prompt("Enable Docker sandbox mode?")
        .default(false)
        .interact()?;

    // Build config
    let config = LoopConfig {
        runtime,
        backend,
        execution: ExecutionConfig {
            delay_seconds,
            max_iterations,
            model,
            sandbox,
            ..ExecutionConfig::default()
        },
        ..LoopConfig::default()
    };

    // Write config
    println!(
        "{}",
        format!("\nWriting config to {}...", paths.config_path).dimmed()
    );
    write_config(&paths.config_path, &config)?;

    // Copy skills
    let bundled_skills = get_bundled_skills_dir();
    if bundled_skills.exists() {
        println!(
            "{}",
            format!("Copying skills to {}...", paths.skills_path).dimmed()
        );
        copy_skills(&bundled_skills, Path::new(&paths.skills_path))?;
    }

    // Copy commands
    let bundled_commands = get_bundled_commands_dir();
    if bundled_commands.exists() {
        println!("{}", "Copying commands...".dimmed());
        copy_commands(&bundled_commands, &paths, runtime)?;
    }

    // Copy shortcuts
    let bundled_shortcuts = get_bundled_shortcuts_path();
    if bundled_shortcuts.exists() {
        println!("{}", "Installing shortcuts script...".dimmed());
        copy_shortcuts(&bundled_shortcuts)?;
    }

    // Prompt for shell rc source line
    let add_source = dialoguer::Confirm::new()
        .with_prompt("Add source line to your shell rc file? (enables md/mr/me/ms shortcuts)")
        .default(true)
        .interact()?;

    if add_source {
        let home = dirs::home_dir().unwrap_or_default();
        let zshrc = home.join(".zshrc");
        let bashrc = home.join(".bashrc");

        if zshrc.exists() {
            add_shortcuts_source_line(&zshrc)?;
            println!(
                "  {}",
                format!("Added source line to {}", zshrc.display()).dimmed()
            );
        } else if bashrc.exists() {
            add_shortcuts_source_line(&bashrc)?;
            println!(
                "  {}",
                format!("Added source line to {}", bashrc.display()).dimmed()
            );
        } else {
            println!("  {}", "No .zshrc or .bashrc found. Add manually:".yellow());
            println!(
                "    {}",
                format!("source \"{}\"", get_shortcuts_install_path().display()).cyan()
            );
        }
    }

    // For local install, ensure .mobius/ permissions
    if install_type == PathConfigType::Local {
        let project_dir = Path::new(&paths.config_path)
            .parent()
            .unwrap_or(Path::new("."));
        let settings_path = get_settings_path_for_runtime(project_dir, runtime);
        println!(
            "{}",
            format!(
                "Ensuring .mobius/ permissions in {}...",
                settings_path.display()
            )
            .dimmed()
        );
        ensure_runtime_settings(project_dir, runtime)?;
    }

    println!("{}", "\n✓ Setup complete!\n".green());

    println!("{}", "Next steps:".bold());
    println!("  1. Run {} to verify installation", "mobius doctor".cyan());
    println!(
        "  2. Run {} to start executing tasks",
        "mobius <TASK-ID>".cyan()
    );
    println!(
        "  3. Use {}/{}/{}/{} shortcuts for the define-refine-execute-submit workflow",
        "md".cyan(),
        "mr".cyan(),
        "me".cyan(),
        "ms".cyan()
    );

    if backend == Backend::Linear && runtime == AgentRuntime::Claude {
        println!(
            "\n{}",
            "Note: Linear MCP should be auto-configured in Claude Code.".dimmed()
        );
    }

    if install_type == PathConfigType::Local {
        println!(
            "\n{}",
            "Tip: Review AGENTS.md and customize for your project.".dimmed()
        );
    }

    println!();
    Ok(())
}

fn get_bundled_skills_dir() -> std::path::PathBuf {
    // Look relative to executable, then fall back to relative paths
    if let Ok(exe) = std::env::current_exe() {
        let dir = exe.parent().unwrap_or(Path::new("."));
        let skills = dir.join("skills");
        if skills.exists() {
            return skills;
        }
        // Check parent/share/mobius/skills
        let share_skills = dir
            .parent()
            .unwrap_or(Path::new("."))
            .join("share")
            .join("mobius")
            .join("skills");
        if share_skills.exists() {
            return share_skills;
        }
    }
    // Fall back to relative
    std::path::PathBuf::from("skills")
}

fn get_bundled_commands_dir() -> std::path::PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        let dir = exe.parent().unwrap_or(Path::new("."));
        let commands = dir.join("commands");
        if commands.exists() {
            return commands;
        }
    }
    std::path::PathBuf::from("commands")
}

fn get_bundled_shortcuts_path() -> std::path::PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        let dir = exe.parent().unwrap_or(Path::new("."));
        let shortcuts = dir.join("shortcuts.sh");
        if shortcuts.exists() {
            return shortcuts;
        }
    }
    std::path::PathBuf::from("shortcuts.sh")
}
