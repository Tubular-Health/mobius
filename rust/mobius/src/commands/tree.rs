//! Tree command - Display sub-task dependency tree without execution

use colored::Colorize;

use crate::config::loader::read_config;
use crate::config::paths::resolve_paths;
use crate::jira::JiraClient;
use crate::local_state::{read_local_subtasks_as_linear_issues, read_parent_spec};
use crate::mermaid_renderer::render_mermaid_with_title;
use crate::tree_renderer::render_full_tree_output;
use crate::types::enums::Backend;
use crate::types::task_graph::ParentIssue;
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
            format!("Error: Invalid task ID format for {}: {}", backend, task_id).red()
        );
        eprintln!(
            "{}",
            "Expected format: PREFIX-NUMBER (e.g., MOB-123)".dimmed()
        );
        std::process::exit(1);
    }

    // Fetch parent issue
    let parent_issue: Result<ParentIssue, String> = match backend {
        Backend::Local => {
            let spec = read_parent_spec(task_id);
            spec.map(|s| ParentIssue {
                id: s.id,
                identifier: s.identifier,
                title: s.title,
                git_branch_name: s.git_branch_name,
            })
            .ok_or_else(|| format!("No local state found for {}", task_id))
        }
        Backend::Jira => {
            let rt = tokio::runtime::Runtime::new()?;
            rt.block_on(async {
                let api_err = match JiraClient::new() {
                    Ok(client) => match client.fetch_jira_issue(task_id).await {
                        Ok(issue) => return Ok(issue),
                        Err(e) => e.to_string(),
                    },
                    Err(e) => e.to_string(),
                };
                match read_parent_spec(task_id) {
                    Some(s) => Ok(ParentIssue {
                        id: s.id,
                        identifier: s.identifier,
                        title: s.title,
                        git_branch_name: s.git_branch_name,
                    }),
                    None => Err(api_err),
                }
            })
        }
        Backend::Linear => {
            let rt = tokio::runtime::Runtime::new()?;
            rt.block_on(async {
                let api_err = match crate::linear::LinearClient::new() {
                    Ok(client) => match client.fetch_linear_issue(task_id).await {
                        Ok(issue) => return Ok(issue),
                        Err(e) => e.to_string(),
                    },
                    Err(e) => e.to_string(),
                };
                match read_parent_spec(task_id) {
                    Some(s) => Ok(ParentIssue {
                        id: s.id,
                        identifier: s.identifier,
                        title: s.title,
                        git_branch_name: s.git_branch_name,
                    }),
                    None => Err(api_err),
                }
            })
        }
    };

    let parent_issue = match parent_issue {
        Ok(issue) => {
            println!("{} {}: {}", "✓".green(), issue.identifier, issue.title);
            println!(
                "  {}",
                format!("Branch: {}", issue.git_branch_name).dimmed()
            );
            issue
        }
        Err(cause) => {
            eprintln!(
                "{}",
                format!("Error: Could not fetch issue {}", task_id).red()
            );
            eprintln!("{}", format!("  Cause: {}", cause).red());
            std::process::exit(1);
        }
    };

    // Read sub-tasks from local state
    let sub_tasks = read_local_subtasks_as_linear_issues(task_id);
    if sub_tasks.is_empty() {
        println!("{}", format!("No sub-tasks found for {}", task_id).yellow());
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
