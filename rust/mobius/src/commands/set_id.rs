//! Set-id command - Set or show the current task ID

use colored::Colorize;

use crate::config::loader::read_config;
use crate::config::paths::resolve_paths;
use crate::context::{
    create_session, delete_session, get_current_session_parent_id, read_session,
    set_current_session_pointer,
};
use crate::types::enums::Backend;

pub fn run(task_id: Option<&str>, backend: Option<&str>, clear: bool) -> anyhow::Result<()> {
    // Handle --clear flag
    if clear {
        if let Some(current_id) = get_current_session_parent_id() {
            delete_session(&current_id);
        }
        println!("{}", "Current task cleared".green());
        return Ok(());
    }

    // If no task ID provided, show current task
    if task_id.is_none() {
        let current_id = get_current_session_parent_id();

        if current_id.is_none() {
            println!("{}", "No current task set".yellow());
            println!("{}", "Usage: mobius set-id <task-id>".dimmed());
            return Ok(());
        }

        let current_id = current_id.unwrap();
        let session = read_session(&current_id);

        match session {
            Some(session) => {
                println!("{}", "Current task:".bold());
                println!("  ID:      {}", session.parent_id.cyan());
                println!("  Backend: {}", format!("{}", session.backend).dimmed());
                println!("  Status:  {}", format!("{:?}", session.status).dimmed());
                println!("  Started: {}", session.started_at.dimmed());
                if let Some(ref wt) = session.worktree_path {
                    println!("  Worktree: {}", wt.dimmed());
                }
            }
            None => {
                println!("{}", "No current task set".yellow());
                println!("{}", "Usage: mobius set-id <task-id>".dimmed());
            }
        }
        return Ok(());
    }

    let task_id = task_id.unwrap();

    // Resolve backend
    let paths = resolve_paths();
    let config = read_config(&paths.config_path).unwrap_or_default();
    let resolved_backend = resolve_backend(backend, &config.backend);

    // Validate task ID format
    if !validate_task_id(task_id, &resolved_backend) {
        eprintln!(
            "{}",
            format!(
                "Error: Invalid task ID format for {}: {}",
                resolved_backend, task_id
            )
            .red()
        );
        eprintln!(
            "{}",
            "Expected format: PREFIX-NUMBER (e.g., MOB-123)".dimmed()
        );
        std::process::exit(1);
    }

    // Check if there's already a session for this task
    let existing = read_session(task_id);
    if existing.is_some() {
        set_current_session_pointer(task_id)?;
        println!(
            "{}",
            format!("Current task set to {} (existing session)", task_id.bold()).green()
        );
    } else {
        create_session(task_id, resolved_backend, None)?;
        set_current_session_pointer(task_id)?;
        println!(
            "{}",
            format!("Current task set to {}", task_id.bold()).green()
        );
    }

    if backend.is_some() {
        println!("  {}", format!("Backend: {}", resolved_backend).dimmed());
    }

    Ok(())
}

fn resolve_backend(override_backend: Option<&str>, config_backend: &Backend) -> Backend {
    if let Some(b) = override_backend {
        b.parse().unwrap_or(*config_backend)
    } else {
        *config_backend
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
