//! List command - Display local issues with interactive selector

use colored::Colorize;
use std::fs;

use crate::config::loader::read_config;
use crate::config::paths::resolve_paths;
use crate::local_state::{get_project_mobius_path, read_parent_spec};
use crate::types::enums::Backend;

pub fn run(backend_override: Option<&str>) -> anyhow::Result<()> {
    let paths = resolve_paths();
    let config = read_config(&paths.config_path).unwrap_or_default();
    let _backend: Backend = if let Some(b) = backend_override {
        b.parse().unwrap_or(config.backend)
    } else {
        config.backend
    };

    let issues_path = get_project_mobius_path().join("issues");

    let entries = match fs::read_dir(&issues_path) {
        Ok(entries) => entries,
        Err(_) => {
            eprintln!("{}", "No local issues found.".yellow());
            eprintln!(
                "{}",
                "Run `mobius refine <issue-id>` to create local issue state.".dimmed()
            );
            return Ok(());
        }
    };

    let mut dirs: Vec<String> = Vec::new();
    for entry in entries.flatten() {
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            if let Some(name) = entry.file_name().to_str() {
                dirs.push(name.to_string());
            }
        }
    }

    if dirs.is_empty() {
        eprintln!("{}", "No local issues found.".yellow());
        eprintln!(
            "{}",
            "Run `mobius refine <issue-id>` to create local issue state.".dimmed()
        );
        return Ok(());
    }

    dirs.sort();

    let mut choices: Vec<(String, String)> = Vec::new();

    for issue_id in &dirs {
        if let Some(spec) = read_parent_spec(issue_id) {
            let status_color = match spec.status.as_str() {
                "Done" => spec.status.green().to_string(),
                "In Progress" => spec.status.cyan().to_string(),
                _ => spec.status.dimmed().to_string(),
            };

            let display = format!(
                "{}  {}  [{}]",
                spec.identifier.bold(),
                spec.title,
                status_color
            );
            choices.push((display, spec.identifier));
        }
    }

    if choices.is_empty() {
        eprintln!("{}", "No valid local issues found.".yellow());
        eprintln!(
            "{}",
            "Issue directories exist but parent specs could not be read.".dimmed()
        );
        return Ok(());
    }

    let items: Vec<&str> = choices.iter().map(|(display, _)| display.as_str()).collect();

    let selection = dialoguer::Select::new()
        .with_prompt("Select an issue")
        .items(&items)
        .interact()?;

    // Output selected issue identifier to stdout
    println!("{}", choices[selection].1);

    Ok(())
}
