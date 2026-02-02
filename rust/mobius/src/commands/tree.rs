//! Tree command - Display sub-task dependency tree without execution

use colored::Colorize;

use crate::config::loader::read_config;
use crate::config::paths::resolve_paths;
use crate::jira::{JiraClient, ParentIssue};
use crate::local_state::{read_local_subtasks_as_linear_issues, read_parent_spec};
use crate::mermaid_renderer::render_mermaid_with_title;
use crate::tree_renderer::render_full_tree_output;
use crate::types::enums::Backend;
use crate::types::task_graph::{build_task_graph, get_graph_stats};

pub fn run(task_id: &str, backend_override: Option<&str>, mermaid: bool) -> anyhow::Result<()> {
    let paths = resolve_paths();
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
            format!(
                "Error: Invalid task ID format for {}: {}",
                backend, task_id
            )
            .red()
        );
        eprintln!(
            "{}",
            "Expected format: PREFIX-NUMBER (e.g., MOB-123)".dimmed()
        );
        std::process::exit(1);
    }

    // Fetch parent issue
    let parent_issue: Option<ParentIssue> = match backend {
        Backend::Local => {
            let spec = read_parent_spec(task_id);
            spec.map(|s| ParentIssue {
                id: s.id,
                identifier: s.identifier,
                title: s.title,
                git_branch_name: s.git_branch_name,
            })
        }
        Backend::Jira => {
            let rt = tokio::runtime::Runtime::new()?;
            rt.block_on(async {
                match JiraClient::new() {
                    Ok(client) => client.fetch_jira_issue(task_id).await.ok(),
                    Err(_) => None,
                }
            })
        }
        Backend::Linear => {
            // Linear client not implemented in Rust yet - fall back to local state
            let spec = read_parent_spec(task_id);
            spec.map(|s| ParentIssue {
                id: s.id,
                identifier: s.identifier,
                title: s.title,
                git_branch_name: s.git_branch_name,
            })
        }
    };

    match parent_issue {
        Some(ref issue) => {
            println!(
                "{} {}: {}",
                "✓".green(),
                issue.identifier,
                issue.title
            );
            println!("  {}", format!("Branch: {}", issue.git_branch_name).dimmed());
        }
        None => {
            eprintln!("{}", format!("Could not fetch issue {}", task_id).red());
            std::process::exit(1);
        }
    }

    let parent_issue = parent_issue.unwrap();

    // Read sub-tasks from local state
    let sub_tasks = read_local_subtasks_as_linear_issues(task_id);
    if sub_tasks.is_empty() {
        println!(
            "{}",
            format!("No sub-tasks found for {}", task_id).yellow()
        );
        return Ok(());
    }

    println!(
        "{} Found {} sub-task{}",
        "✓".green(),
        sub_tasks.len(),
        if sub_tasks.len() == 1 { "" } else { "s" }
    );

    // Build the graph
    let graph = build_task_graph(&parent_issue.id, &parent_issue.identifier, &sub_tasks);

    // Display ASCII tree
    println!();
    println!("{}", render_full_tree_output(&graph));

    // Optionally display Mermaid diagram
    if mermaid {
        println!();
        println!("{}", "Mermaid Diagram:".bold());
        println!("{}", render_mermaid_with_title(&graph));
    }

    // Display summary stats
    let stats = get_graph_stats(&graph);
    println!();
    println!("{}", "Summary:".bold());
    println!("  Total: {}", stats.total);
    println!("  Done: {}", stats.done.to_string().green());
    println!("  Ready: {}", stats.ready.to_string().blue());
    println!("  Blocked: {}", stats.blocked.to_string().yellow());
    println!("  In Progress: {}", stats.in_progress.to_string().cyan());

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
