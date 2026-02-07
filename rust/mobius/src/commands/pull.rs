//! Pull command - Fetch fresh context from Linear/Jira

use colored::Colorize;

use crate::config::loader::read_config;
use crate::config::paths::resolve_paths;
use crate::context::{
    generate_context, get_full_context_path, resolve_task_id, write_full_context_file,
};
use crate::types::enums::Backend;

pub fn run(task_id: Option<&str>, backend_override: Option<&str>) -> anyhow::Result<()> {
    // Resolve task ID
    let resolved_id = resolve_task_id(task_id);

    if resolved_id.is_none() {
        eprintln!(
            "{}",
            "Error: No task ID provided and no current task set".red()
        );
        eprintln!("{}", "Usage: mobius pull <task-id>".dimmed());
        eprintln!(
            "{}",
            "Or set a current task: mobius set-id <task-id>".dimmed()
        );
        std::process::exit(1);
    }

    let resolved_id = resolved_id.unwrap();

    // Resolve backend
    let paths = resolve_paths();
    let config = read_config(&paths.config_path).unwrap_or_default();
    let backend: Backend = if let Some(b) = backend_override {
        b.parse().unwrap_or(config.backend)
    } else {
        config.backend
    };

    // Validate task ID format
    if !validate_task_id(&resolved_id, &backend) {
        eprintln!(
            "{}",
            format!(
                "Error: Invalid task ID format for {}: {}",
                backend, resolved_id
            )
            .red()
        );
        eprintln!(
            "{}",
            "Expected format: PREFIX-NUMBER (e.g., MOB-123)".dimmed()
        );
        std::process::exit(1);
    }

    println!(
        "Fetching context for {} from {}...",
        resolved_id.cyan(),
        backend
    );

    // Generate context
    match generate_context(&resolved_id, None, false) {
        Ok(Some(context)) => {
            // Write full context file
            write_full_context_file(&resolved_id, &context)?;

            println!("{} Context fetched for {}", "✓".green(), resolved_id.cyan());

            // Display summary
            println!();
            println!("{}", "Summary:".bold());
            println!(
                "  Parent:     {} - {}",
                context.parent.identifier.cyan(),
                context.parent.title
            );
            println!("  Status:     {}", context.parent.status);
            println!("  Sub-tasks:  {}", context.sub_tasks.len());

            // Status breakdown
            if !context.sub_tasks.is_empty() {
                let mut status_counts: std::collections::HashMap<String, usize> =
                    std::collections::HashMap::new();
                for task in &context.sub_tasks {
                    *status_counts.entry(task.status.clone()).or_insert(0) += 1;
                }

                println!();
                println!("{}", "Status breakdown:".bold());
                for (status, count) in &status_counts {
                    let colored_status = match status.to_lowercase().as_str() {
                        "done" | "completed" => status.green().to_string(),
                        "in progress" | "in_progress" => status.blue().to_string(),
                        "blocked" => status.red().to_string(),
                        "ready" => status.cyan().to_string(),
                        _ => status.dimmed().to_string(),
                    };
                    println!("  {}: {}", colored_status, count);
                }
            }

            println!();
            println!(
                "{}",
                format!(
                    "Context written to: {}",
                    get_full_context_path(&resolved_id).display()
                )
                .dimmed()
            );
        }
        Ok(None) => {
            eprintln!("{}", format!("No context found for {}", resolved_id).red());
            std::process::exit(1);
        }
        Err(e) => {
            eprintln!(
                "{}",
                format!("Failed to fetch context for {}", resolved_id).red()
            );
            eprintln!("{}", format!("Error: {}", e).red());
            std::process::exit(1);
        }
    }

    Ok(())
}

fn validate_task_id(task_id: &str, backend: &Backend) -> bool {
    let pattern = match backend {
        Backend::Linear => regex::Regex::new(r"^[A-Z]+-\d+$").unwrap(),
        Backend::Jira => regex::Regex::new(r"^[A-Z]+-\d+$").unwrap(),
        Backend::Local => regex::Regex::new(r"^(LOC-\d+|task-\d+)$").unwrap(),
    };
    pattern.is_match(task_id)
}
