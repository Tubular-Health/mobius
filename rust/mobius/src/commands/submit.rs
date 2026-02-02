//! Submit command - Create a pull request via Claude CLI

use colored::Colorize;
use std::process::Command;

use crate::config::loader::read_config;
use crate::config::paths::resolve_paths;
// Session reading not needed here currently
use crate::jira::JiraClient;
use crate::local_state::{read_parent_spec, write_parent_spec};
use crate::types::enums::Backend;

pub fn run(
    task_id: Option<&str>,
    backend_override: Option<&str>,
    model_override: Option<&str>,
    draft: bool,
    skip_status_update: bool,
) -> anyhow::Result<()> {
    let paths = resolve_paths();
    let config = read_config(&paths.config_path).unwrap_or_default();
    let backend: Backend = if let Some(b) = backend_override {
        b.parse().unwrap_or(config.backend)
    } else {
        config.backend
    };
    let model = model_override.unwrap_or(&config.execution.model.to_string()).to_string();

    // Validate task ID format if provided
    if let Some(tid) = task_id {
        if !validate_task_id(tid, &backend) {
            eprintln!(
                "{}",
                format!(
                    "Error: Invalid task ID format for {}: {}",
                    backend, tid
                )
                .red()
            );
            return Err(anyhow::anyhow!("Invalid task ID format"));
        }
    }

    let task_label = task_id
        .map(|t| format!(" for {}", t))
        .unwrap_or_default();
    println!("{}", format!("\nCreating pull request{}...\n", task_label).cyan());

    // Build skill invocation
    let mut skill_args = Vec::new();
    if draft {
        skill_args.push("--draft".to_string());
    }

    let skill_invocation = if skill_args.is_empty() {
        "/pr".to_string()
    } else {
        format!("/pr {}", skill_args.join(" "))
    };

    let context_note = if let Some(tid) = task_id {
        format!(
            "\n\nNote: This PR is for issue {}. Ensure this issue is linked in the PR.",
            tid
        )
    } else {
        String::new()
    };

    let full_prompt = format!(
        "Run the {} skill to create a pull request.{}",
        skill_invocation, context_note
    );

    // Check if cclean is available
    let use_cclean = which::which("cclean").is_ok();
    let output_format = if use_cclean {
        "--output-format=stream-json"
    } else {
        "--output-format=text"
    };

    let claude_cmd = format!(
        "claude -p --dangerously-skip-permissions --verbose {} --model {}",
        output_format, model
    );
    let full_cmd = if use_cclean {
        format!("{} | cclean", claude_cmd)
    } else {
        claude_cmd
    };

    // Execute Claude with the PR skill
    let status = Command::new("sh")
        .args(["-c", &full_cmd])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit())
        .spawn()
        .and_then(|mut child| {
            if let Some(ref mut stdin) = child.stdin {
                use std::io::Write;
                let _ = stdin.write_all(full_prompt.as_bytes());
            }
            child.wait()
        });

    match status {
        Ok(s) if s.success() => {
            println!("{}", "\n✓ Submit complete".green());
        }
        Ok(_) | Err(_) => {
            eprintln!("{}", "Error running Claude CLI".red());
            return Err(anyhow::anyhow!("Submit failed"));
        }
    }

    // Update parent issue status to "In Review"
    if let Some(tid) = task_id {
        if !skip_status_update {
            update_parent_status_to_review(tid, &backend);
        }
    }

    Ok(())
}

fn update_parent_status_to_review(task_id: &str, backend: &Backend) {
    let review_status = "In Review";

    match backend {
        Backend::Linear => {
            let rt = tokio::runtime::Runtime::new().ok();
            if let Some(rt) = rt {
                rt.block_on(async {
                    if let Ok(client) = crate::linear::LinearClient::new() {
                        match client
                            .update_linear_issue_status(task_id, review_status)
                            .await
                        {
                            Ok(()) => println!(
                                "{}",
                                format!(
                                    "✓ Updated {} status to \"{}\"",
                                    task_id, review_status
                                )
                                .green()
                            ),
                            Err(_) => eprintln!(
                                "{}",
                                format!(
                                    "⚠ Could not update {} status to \"{}\"",
                                    task_id, review_status
                                )
                                .yellow()
                            ),
                        }
                    }
                });
            }
        }
        Backend::Jira => {
            let rt = tokio::runtime::Runtime::new().ok();
            if let Some(rt) = rt {
                rt.block_on(async {
                    if let Ok(client) = JiraClient::new() {
                        match client.update_jira_issue_status(task_id, review_status).await {
                            Ok(()) => println!(
                                "{}",
                                format!("✓ Updated {} status to \"{}\"", task_id, review_status)
                                    .green()
                            ),
                            Err(_) => eprintln!(
                                "{}",
                                format!(
                                    "⚠ Could not update {} status to \"{}\"",
                                    task_id, review_status
                                )
                                .yellow()
                            ),
                        }
                    }
                });
            }
        }
        Backend::Local => {
            if let Some(mut spec) = read_parent_spec(task_id) {
                spec.status = review_status.to_string();
                let _ = write_parent_spec(task_id, &spec);
                println!(
                    "{}",
                    format!(
                        "✓ Updated local parent.json status to \"{}\"",
                        review_status
                    )
                    .green()
                );
            }
        }
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
