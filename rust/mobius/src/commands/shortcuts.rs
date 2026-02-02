//! Shortcuts command - Install shell shortcut scripts (md/mr/me/ms/ml/mc)

use colored::Colorize;
use std::path::Path;

use crate::config::paths::{get_shortcuts_install_path, resolve_paths};
use crate::config::setup::{add_shortcuts_source_line, copy_shortcuts};

pub fn run() -> anyhow::Result<()> {
    println!("{}", "\nInstalling Mobius shortcuts...\n".bold());

    // Copy shortcuts script to ~/.config/mobius/shortcuts.sh
    let shortcuts_path = get_shortcuts_install_path();
    let bundled_shortcuts = get_bundled_shortcuts_path();

    if bundled_shortcuts.exists() {
        copy_shortcuts(&bundled_shortcuts)?;
        println!(
            "{}",
            format!("✓ Shortcuts script installed at {}", shortcuts_path.display()).green()
        );
    } else {
        println!(
            "{}",
            "Warning: Bundled shortcuts not found, skipping copy.".yellow()
        );
    }

    // Prompt to add source line to shell rc file
    let add_source = dialoguer::Confirm::new()
        .with_prompt("Add source line to your shell rc file? (enables md/mr/me/ms/ml/mc shortcuts)")
        .default(true)
        .interact()?;

    if add_source {
        let home = dirs::home_dir().unwrap_or_default();
        let zshrc = home.join(".zshrc");
        let bashrc = home.join(".bashrc");

        if zshrc.exists() {
            add_shortcuts_source_line(&zshrc)?;
            println!("  {}", format!("Added source line to {}", zshrc.display()).dimmed());
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
                format!("source \"{}\"", shortcuts_path.display()).cyan()
            );
        }
    } else {
        println!(
            "  {}",
            "To enable shortcuts later, add to your shell rc file:".dimmed()
        );
        println!(
            "    {}",
            format!("source \"{}\"", shortcuts_path.display()).cyan()
        );
    }

    println!("{}", "\nAvailable shortcuts:".bold());
    println!("  {}  - Define a new issue (launches Claude /define)", "md".cyan());
    println!("  {}  - Refine the current issue into sub-tasks", "mr".cyan());
    println!("  {}  - Execute sub-tasks for the current issue", "me".cyan());
    println!("  {}  - Submit/PR the current issue", "ms".cyan());
    println!("  {}  - List all local issues", "ml".cyan());
    println!("  {}  - Clean completed issues from local storage", "mc".cyan());
    println!();

    Ok(())
}

/// Get bundled shortcuts path (relative to executable)
fn get_bundled_shortcuts_path() -> std::path::PathBuf {
    let paths = resolve_paths();
    Path::new(&paths.skills_path)
        .parent()
        .unwrap_or(Path::new("."))
        .join("shortcuts.sh")
}
