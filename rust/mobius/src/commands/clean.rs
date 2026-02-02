//! Clean command - Remove completed issues from local .mobius/issues/ directory

use colored::Colorize;
use std::fs;

use crate::config::loader::read_config;
use crate::config::paths::resolve_paths;
use crate::context::cleanup_context;
use crate::jira::JiraClient;
use crate::local_state::{get_project_mobius_path, read_parent_spec};
use crate::types::enums::Backend;

struct CleanupCandidate {
    identifier: String,
    title: String,
    local_status: String,
    backend_status: Option<String>,
}

fn is_completed_status(status: &str, backend: &Backend) -> bool {
    match backend {
        Backend::Linear => matches!(status, "Done" | "Canceled" | "Cancelled"),
        Backend::Jira => matches!(status, "Done" | "Closed"),
        Backend::Local => status == "done",
    }
}

fn is_local_id(id: &str) -> bool {
    let re = regex::Regex::new(r"^(LOC-\d+|task-\d+)$").unwrap();
    re.is_match(id)
}

pub fn run(dry_run: bool, backend_override: Option<&str>) -> anyhow::Result<()> {
    let paths = resolve_paths();
    let config = read_config(&paths.config_path).unwrap_or_default();
    let backend: Backend = if let Some(b) = backend_override {
        b.parse().unwrap_or(config.backend)
    } else {
        config.backend
    };

    println!("Scanning for completed issues...");

    let issues_path = get_project_mobius_path().join("issues");

    let entries = match fs::read_dir(&issues_path) {
        Ok(entries) => entries,
        Err(_) => {
            println!("{}", "No completed issues found to clean up.".green());
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

    let mut candidates: Vec<CleanupCandidate> = Vec::new();

    let rt = tokio::runtime::Runtime::new()?;

    for issue_id in &dirs {
        let spec = match read_parent_spec(issue_id) {
            Some(s) => s,
            None => continue,
        };

        if is_local_id(issue_id) {
            if is_completed_status(&spec.status, &Backend::Local) {
                candidates.push(CleanupCandidate {
                    identifier: spec.identifier,
                    title: spec.title,
                    local_status: spec.status,
                    backend_status: None,
                });
            }
        } else {
            let local_completed = is_completed_status(&spec.status, &backend);
            if !local_completed {
                continue;
            }

            // Check backend status
            let backend_status: Option<String> = match backend {
                Backend::Jira => rt.block_on(async {
                    match JiraClient::new() {
                        Ok(client) => client.fetch_jira_issue_status(issue_id).await.ok(),
                        Err(_) => None,
                    }
                }),
                Backend::Linear => rt.block_on(async {
                    match crate::linear::LinearClient::new() {
                        Ok(client) => client.fetch_linear_issue_status(issue_id).await.ok(),
                        Err(_) => None,
                    }
                }),
                Backend::Local => None,
            };

            if let Some(ref bs) = backend_status {
                if is_completed_status(bs, &backend) {
                    candidates.push(CleanupCandidate {
                        identifier: spec.identifier,
                        title: spec.title,
                        local_status: spec.status,
                        backend_status: backend_status.clone(),
                    });
                }
            } else if backend == Backend::Local {
                // For local backend, we already checked local status above
                candidates.push(CleanupCandidate {
                    identifier: spec.identifier,
                    title: spec.title,
                    local_status: spec.status,
                    backend_status: None,
                });
            }
            // If backend unreachable, skip
        }
    }

    if candidates.is_empty() {
        println!("{}", "No completed issues found to clean up.".green());
        return Ok(());
    }

    println!(
        "Found {} completed issue{}:",
        candidates.len(),
        if candidates.len() == 1 { "" } else { "s" }
    );
    println!();

    for candidate in &candidates {
        let status_info = if let Some(ref bs) = candidate.backend_status {
            format!("local: {}, backend: {}", candidate.local_status, bs)
        } else {
            format!("local: {}", candidate.local_status)
        };
        println!(
            "  {}  {}  {}",
            candidate.identifier.cyan(),
            candidate.title,
            format!("({})", status_info).dimmed()
        );
    }
    println!();

    if dry_run {
        println!("{}", "Dry run — no issues were removed.".yellow());
        return Ok(());
    }

    let confirmed = dialoguer::Confirm::new()
        .with_prompt(format!(
            "Remove {} completed issue{} from local state?",
            candidates.len(),
            if candidates.len() == 1 { "" } else { "s" }
        ))
        .default(false)
        .interact()?;

    if !confirmed {
        println!("{}", "Aborted.".dimmed());
        return Ok(());
    }

    let mut success = 0;
    let mut failed = 0;

    for candidate in &candidates {
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            cleanup_context(&candidate.identifier);
        })) {
            Ok(()) => success += 1,
            Err(_) => {
                failed += 1;
                eprintln!(
                    "  {}",
                    format!("Warning: Failed to remove {}", candidate.identifier).yellow()
                );
            }
        }
    }

    if failed == 0 {
        println!(
            "{}",
            format!(
                "Removed {} issue{}.",
                success,
                if success == 1 { "" } else { "s" }
            )
            .green()
        );
    } else {
        println!(
            "{}",
            format!("Removed {}, failed {}.", success, failed).yellow()
        );
    }

    Ok(())
}
