//! Clean command - Remove completed issues from local .mobius/issues/ directory

use colored::Colorize;
use std::fs;

use crate::config::loader::read_config;
use crate::config::paths::resolve_paths;
use crate::context::cleanup_context;
use crate::local_state::{get_project_mobius_path, read_parent_spec};
use crate::types::enums::Backend;
use crate::worktree::{is_issue_merged_into_base, MergeDetectionResult, remove_worktree, WorktreeConfig};

struct CleanupCandidate {
    identifier: String,
    title: String,
    local_status: String,
    git_branch_name: String,
    merge_info: Option<MergeDetectionResult>,
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

    let base_branch = config
        .execution
        .base_branch
        .as_deref()
        .unwrap_or("main")
        .to_string();

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
                    git_branch_name: spec.git_branch_name,
                    merge_info: None,
                });
            }
        } else if !spec.git_branch_name.is_empty() {
            // Issue has a git branch — use git-based merge detection
            let merge_result = rt.block_on(async {
                is_issue_merged_into_base(
                    &spec.git_branch_name,
                    &spec.identifier,
                    &base_branch,
                )
                .await
            })?;

            if merge_result.is_merged() {
                candidates.push(CleanupCandidate {
                    identifier: spec.identifier,
                    title: spec.title,
                    local_status: spec.status,
                    git_branch_name: spec.git_branch_name,
                    merge_info: Some(merge_result),
                });
            }
        } else {
            // No git branch name — fall back to local status check
            if is_completed_status(&spec.status, &backend) {
                candidates.push(CleanupCandidate {
                    identifier: spec.identifier,
                    title: spec.title,
                    local_status: spec.status,
                    git_branch_name: String::new(),
                    merge_info: None,
                });
            }
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
        let status_info = if let Some(ref mi) = candidate.merge_info {
            let mut parts = Vec::new();
            if mi.remote_branch_deleted {
                parts.push("remote deleted".to_string());
            }
            if mi.found_in_base_log {
                parts.push(format!("found in {}", base_branch));
            }
            format!("merged: {}", parts.join(" + "))
        } else {
            format!("status: {}", candidate.local_status)
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

    // Bulk confirmation for .mobius/issues/ directory cleanup
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

    let worktree_config = WorktreeConfig {
        worktree_path: config.execution.worktree_path.clone(),
        base_branch: config.execution.base_branch.clone(),
        runtime: config.runtime,
    };

    for candidate in &candidates {
        // Per-branch prompt for local branch and worktree deletion
        if !candidate.git_branch_name.is_empty() {
            let delete_branch = dialoguer::Confirm::new()
                .with_prompt(format!(
                    "Delete local branch '{}' and worktree for {}?",
                    candidate.git_branch_name, candidate.identifier
                ))
                .default(false)
                .interact()
                .unwrap_or(false);

            if delete_branch {
                // Delete local branch
                if let Err(e) = rt.block_on(async {
                    let output = tokio::process::Command::new("git")
                        .args(["branch", "-D", &candidate.git_branch_name])
                        .output()
                        .await?;
                    if !output.status.success() {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        eprintln!(
                            "  {}",
                            format!(
                                "Warning: Failed to delete branch '{}': {}",
                                candidate.git_branch_name,
                                stderr.trim()
                            )
                            .yellow()
                        );
                    }
                    Ok::<(), anyhow::Error>(())
                }) {
                    eprintln!(
                        "  {}",
                        format!(
                            "Warning: Error deleting branch '{}': {}",
                            candidate.git_branch_name, e
                        )
                        .yellow()
                    );
                }

                // Remove worktree
                if let Err(e) = rt.block_on(async {
                    remove_worktree(&candidate.identifier, &worktree_config).await
                }) {
                    eprintln!(
                        "  {}",
                        format!(
                            "Warning: Failed to remove worktree for {}: {}",
                            candidate.identifier, e
                        )
                        .yellow()
                    );
                }
            }
        }

        // Always clean up the .mobius/issues/ context directory
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
