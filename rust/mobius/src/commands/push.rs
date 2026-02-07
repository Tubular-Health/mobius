//! Push command - Push pending local changes to Linear/Jira

use colored::Colorize;
use std::fs;

use crate::config::loader::read_config;
use crate::config::paths::resolve_paths;
use crate::context::{
    get_context_path, get_pending_updates_path, get_sync_log_path, read_pending_updates,
    resolve_task_id, write_pending_updates,
};
use crate::jira::JiraClient;
use crate::local_state::{
    get_project_mobius_path, read_iteration_log, write_summary, CompletionSummary, IterationStatus,
};
use crate::types::context::{PendingUpdate, SyncLog, SyncLogEntry};
use crate::types::enums::{Backend, PendingUpdateType};

struct PushResult {
    update_id: String,
    update_type: String,
    issue_identifier: String,
    success: bool,
    error: Option<String>,
}

pub fn run(
    parent_id: Option<&str>,
    backend_override: Option<&str>,
    dry_run: bool,
    all: bool,
    summary: bool,
) -> anyhow::Result<()> {
    let paths = resolve_paths();
    let config = read_config(&paths.config_path).unwrap_or_default();
    let backend: Backend = if let Some(b) = backend_override {
        b.parse().unwrap_or(config.backend)
    } else {
        config.backend
    };

    // Handle --summary flag
    if summary {
        let resolved_id = resolve_task_id(parent_id);
        if resolved_id.is_none() {
            eprintln!("{}", "Error: No task ID provided for summary".red());
            eprintln!("{}", "Usage: mobius push <task-id> --summary".dimmed());
            std::process::exit(1);
        }
        return push_loop_summary(&resolved_id.unwrap(), &backend);
    }

    // Resolve which issues to push
    let resolved_id = if all {
        None
    } else {
        resolve_task_id(parent_id)
    };

    let issues_to_push = get_issues_to_push(resolved_id.as_deref(), all);

    if issues_to_push.is_empty() {
        if let Some(ref rid) = resolved_id {
            eprintln!(
                "{}",
                format!("Error: No pending updates found for {}", rid).red()
            );
        } else if !all {
            eprintln!(
                "{}",
                "Error: No task ID provided and no current task set".red()
            );
            eprintln!("{}", "Usage: mobius push <task-id>".dimmed());
        } else {
            eprintln!("{}", "No issues with pending updates found".yellow());
        }
        std::process::exit(1);
    }

    // Collect all pending updates
    let mut total_pending = 0;
    let mut all_updates: Vec<(String, PendingUpdate)> = Vec::new();

    for issue_id in &issues_to_push {
        let queue = read_pending_updates(issue_id);
        for update in &queue.updates {
            let synced = update.synced_at.is_some();
            let has_error = update.error.is_some();
            if !synced && !has_error {
                total_pending += 1;
                all_updates.push((issue_id.clone(), update.clone()));
            }
        }
    }

    if total_pending == 0 {
        println!("{}", "No pending updates to push".green());
        return Ok(());
    }

    // Dry run mode
    if dry_run {
        println!("{}", "\nDry run - pending changes to push:\n".bold());
        display_pending_changes(&all_updates, &backend);
        println!(
            "{}",
            format!(
                "\nTotal: {} update(s) across {} issue(s)",
                total_pending,
                issues_to_push.len()
            )
            .dimmed()
        );
        println!("{}", "Run without --dry-run to apply changes".dimmed());
        return Ok(());
    }

    // Execute push
    println!("Pushing {} update(s) to {}...", total_pending, backend);

    let rt = tokio::runtime::Runtime::new()?;
    let mut success_count = 0;
    let mut failure_count = 0;
    let mut results: Vec<PushResult> = Vec::new();

    for (issue_parent_id, update) in &all_updates {
        let update_value = serde_json::to_value(update).unwrap_or_default();
        let result = rt.block_on(push_update(&update_value, &backend));
        results.push(PushResult {
            update_id: update.id.clone(),
            update_type: get_update_type_str(update),
            issue_identifier: get_pending_update_identifier(update),
            success: result.is_ok(),
            error: result.err().map(|e| e.to_string()),
        });

        if results.last().unwrap().success {
            success_count += 1;
            mark_update_synced(issue_parent_id, &results.last().unwrap().update_id);
        } else {
            failure_count += 1;
            mark_update_failed(
                issue_parent_id,
                &results.last().unwrap().update_id,
                results
                    .last()
                    .unwrap()
                    .error
                    .as_deref()
                    .unwrap_or("Unknown error"),
            );
        }

        log_push_result(issue_parent_id, results.last().unwrap());
    }

    if failure_count == 0 {
        println!(
            "{}",
            format!("Successfully pushed {} update(s)", success_count).green()
        );
    } else if success_count == 0 {
        eprintln!(
            "{}",
            format!("Failed to push all {} update(s)", failure_count).red()
        );
    } else {
        println!(
            "{}",
            format!(
                "Pushed {} update(s), {} failed",
                success_count, failure_count
            )
            .yellow()
        );
    }

    // Display summary
    println!();
    display_push_summary(&results);

    if failure_count > 0 {
        println!(
            "{}",
            "\nFailed updates remain in pending-updates.json".dimmed()
        );
        println!("{}", "Fix the issues and run push again".dimmed());
        std::process::exit(1);
    }

    Ok(())
}

/// Push pending updates for a specific task (programmatic API for loop_cmd)
pub fn push_pending_updates_for_task(
    parent_id: &str,
    backend: &Backend,
) -> (usize, usize, Vec<String>) {
    let queue = read_pending_updates(parent_id);
    let mut pending: Vec<PendingUpdate> = Vec::new();

    for update in &queue.updates {
        let synced = update.synced_at.is_some();
        let has_error = update.error.is_some();
        if !synced && !has_error {
            pending.push(update.clone());
        }
    }

    if pending.is_empty() {
        return (0, 0, Vec::new());
    }

    let rt = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(_) => {
            return (
                0,
                pending.len(),
                vec!["Failed to create runtime".to_string()],
            )
        }
    };

    let mut success = 0;
    let mut failed = 0;
    let mut errors: Vec<String> = Vec::new();

    for update in &pending {
        let update_value = serde_json::to_value(update).unwrap_or_default();
        let result = rt.block_on(push_update(&update_value, backend));
        let update_id = update.id.clone();

        if result.is_ok() {
            success += 1;
            mark_update_synced(parent_id, &update_id);
        } else {
            failed += 1;
            let error_msg = result.err().map(|e| e.to_string()).unwrap_or_default();
            let identifier = get_pending_update_identifier(update);
            errors.push(format!("{}: {}", identifier, error_msg));
            mark_update_failed(parent_id, &update_id, &error_msg);
        }
    }

    (success, failed, errors)
}

fn push_loop_summary(parent_id: &str, backend: &Backend) -> anyhow::Result<()> {
    let iterations = read_iteration_log(parent_id);

    if iterations.is_empty() {
        eprintln!(
            "{}",
            format!("No iteration data found for {}", parent_id).yellow()
        );
        std::process::exit(1);
    }

    let completed_tasks: Vec<_> = iterations
        .iter()
        .filter(|e| e.status == IterationStatus::Success)
        .collect();
    let failed_tasks: Vec<_> = iterations
        .iter()
        .filter(|e| e.status == IterationStatus::Failed)
        .collect();

    if *backend == Backend::Local {
        let summary = CompletionSummary {
            parent_id: parent_id.to_string(),
            completed_at: chrono::Utc::now().to_rfc3339(),
            total_tasks: iterations.len() as u32,
            completed_tasks: completed_tasks.len() as u32,
            failed_tasks: failed_tasks.len() as u32,
            total_iterations: iterations.len() as u32,
            task_outcomes: Vec::new(),
        };
        write_summary(parent_id, &summary)?;
        println!(
            "{}",
            format!(
                "Summary written to .mobius/issues/{}/summary.json",
                parent_id
            )
            .green()
        );
    } else {
        println!(
            "{}",
            format!(
                "Loop summary: {} iterations, {} completed, {} failed",
                iterations.len(),
                completed_tasks.len(),
                failed_tasks.len()
            )
            .bold()
        );
    }

    Ok(())
}

fn get_issues_to_push(parent_id: Option<&str>, all: bool) -> Vec<String> {
    let issues_path = get_project_mobius_path().join("issues");

    if !issues_path.exists() {
        return Vec::new();
    }

    if let Some(pid) = parent_id {
        let pending_path = get_pending_updates_path(pid);
        if pending_path.exists() {
            let queue = read_pending_updates(pid);
            let has_pending = queue
                .updates
                .iter()
                .any(|u| u.synced_at.is_none() && u.error.is_none());
            if has_pending {
                return vec![pid.to_string()];
            }
        }
        return Vec::new();
    }

    if all {
        let mut issues = Vec::new();
        if let Ok(entries) = fs::read_dir(&issues_path) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    if let Some(name) = entry.file_name().to_str() {
                        let queue = read_pending_updates(name);
                        let has_pending = queue
                            .updates
                            .iter()
                            .any(|u| u.synced_at.is_none() && u.error.is_none());
                        if has_pending {
                            issues.push(name.to_string());
                        }
                    }
                }
            }
        }
        return issues;
    }

    Vec::new()
}

fn get_issue_identifier(update: &serde_json::Value) -> String {
    update
        .get("identifier")
        .and_then(|v| v.as_str())
        .or_else(|| update.get("parentId").and_then(|v| v.as_str()))
        .unwrap_or("unknown")
        .to_string()
}

fn format_update_type(update_type: &str) -> String {
    match update_type {
        "status_change" => "[STATUS]".to_string(),
        "add_comment" => "[COMMENT]".to_string(),
        "create_subtask" => "[SUBTASK]".to_string(),
        "update_description" => "[DESCRIPTION]".to_string(),
        "add_label" => "[+LABEL]".to_string(),
        "remove_label" => "[-LABEL]".to_string(),
        other => format!("[{}]", other.to_uppercase()),
    }
}

async fn push_update(update: &serde_json::Value, backend: &Backend) -> anyhow::Result<()> {
    let update_type = update
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let identifier = get_issue_identifier(update);

    // Skip API calls for local-only task IDs
    let backend_pattern = match backend {
        Backend::Linear | Backend::Jira => regex::Regex::new(r"^[A-Z]+-\d+$").unwrap(),
        Backend::Local => return Ok(()),
    };
    if !backend_pattern.is_match(&identifier) {
        return Ok(());
    }

    match update_type {
        "status_change" => {
            let issue_id = update
                .get("issueId")
                .and_then(|v| v.as_str())
                .unwrap_or(&identifier);
            let new_status = update
                .get("newStatus")
                .and_then(|v| v.as_str())
                .unwrap_or("Done");

            match backend {
                Backend::Jira => {
                    let client = JiraClient::new()?;
                    client
                        .update_jira_issue_status(issue_id, new_status)
                        .await
                        .map_err(|e| anyhow::anyhow!("Failed to update Jira status: {}", e))?;
                }
                Backend::Linear => {
                    let client = crate::linear::LinearClient::new()?;
                    client
                        .update_linear_issue_status(issue_id, new_status)
                        .await
                        .map_err(|e| anyhow::anyhow!("Failed to update Linear status: {}", e))?;
                }
                Backend::Local => {}
            }
        }
        "add_comment" => {
            let issue_id = update
                .get("issueId")
                .and_then(|v| v.as_str())
                .unwrap_or(&identifier);
            let body = update.get("body").and_then(|v| v.as_str()).unwrap_or("");

            match backend {
                Backend::Jira => {
                    let client = JiraClient::new()?;
                    client.add_jira_comment(issue_id, body).await?;
                }
                Backend::Linear => {
                    let client = crate::linear::LinearClient::new()?;
                    client
                        .add_linear_comment(issue_id, body)
                        .await
                        .map_err(|e| anyhow::anyhow!("Failed to add Linear comment: {}", e))?;
                }
                Backend::Local => {}
            }
        }
        _ => {
            // Other types not yet implemented
        }
    }

    Ok(())
}

fn mark_update_synced(parent_id: &str, update_id: &str) {
    let mut queue = read_pending_updates(parent_id);
    let now = chrono::Utc::now().to_rfc3339();

    for update in &mut queue.updates {
        if update.id == update_id {
            update.synced_at = Some(now.clone());
        }
    }

    let _ = write_pending_updates(parent_id, &queue);
}

fn mark_update_failed(parent_id: &str, update_id: &str, error: &str) {
    let mut queue = read_pending_updates(parent_id);

    for update in &mut queue.updates {
        if update.id == update_id {
            update.error = Some(error.to_string());
        }
    }

    let _ = write_pending_updates(parent_id, &queue);
}

fn log_push_result(parent_id: &str, result: &PushResult) {
    let log_path = get_sync_log_path(parent_id);
    let mut log: SyncLog = if log_path.exists() {
        fs::read_to_string(&log_path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or(SyncLog {
                entries: Vec::new(),
            })
    } else {
        SyncLog {
            entries: Vec::new(),
        }
    };

    log.entries.push(SyncLogEntry {
        timestamp: chrono::Utc::now().to_rfc3339(),
        update_id: result.update_id.clone(),
        update_type: parse_update_type(&result.update_type),
        issue_identifier: result.issue_identifier.clone(),
        success: result.success,
        error: result.error.clone(),
        backend_response: None,
    });

    let context_dir = get_context_path(parent_id);
    let _ = fs::create_dir_all(&context_dir);
    let _ = fs::write(
        &log_path,
        serde_json::to_string_pretty(&log).unwrap_or_default(),
    );
}

fn display_pending_changes(updates: &[(String, PendingUpdate)], _backend: &Backend) {
    let mut grouped: std::collections::HashMap<String, Vec<&PendingUpdate>> =
        std::collections::HashMap::new();

    for (parent_id, update) in updates {
        grouped.entry(parent_id.clone()).or_default().push(update);
    }

    for (parent_id, pending_updates) in &grouped {
        println!("{}:", parent_id.bold());
        for update in pending_updates {
            let type_str = get_update_type_str(update);
            let type_label = format_update_type(&type_str);
            let identifier = get_pending_update_identifier(update);
            println!("  {} {}", type_label.cyan(), identifier);
        }
        println!();
    }
}

fn get_update_type_str(update: &PendingUpdate) -> String {
    use crate::types::context::PendingUpdateData;
    match &update.data {
        PendingUpdateData::StatusChange { .. } => "status_change".to_string(),
        PendingUpdateData::AddComment { .. } => "add_comment".to_string(),
        PendingUpdateData::CreateSubtask { .. } => "create_subtask".to_string(),
        PendingUpdateData::UpdateDescription { .. } => "update_description".to_string(),
        PendingUpdateData::AddLabel { .. } => "add_label".to_string(),
        PendingUpdateData::RemoveLabel { .. } => "remove_label".to_string(),
    }
}

fn get_pending_update_identifier(update: &PendingUpdate) -> String {
    use crate::types::context::PendingUpdateData;
    match &update.data {
        PendingUpdateData::StatusChange { identifier, .. } => identifier.clone(),
        PendingUpdateData::AddComment { identifier, .. } => identifier.clone(),
        PendingUpdateData::CreateSubtask { parent_id, .. } => parent_id.clone(),
        PendingUpdateData::UpdateDescription { identifier, .. } => identifier.clone(),
        PendingUpdateData::AddLabel { identifier, .. } => identifier.clone(),
        PendingUpdateData::RemoveLabel { identifier, .. } => identifier.clone(),
    }
}

fn parse_update_type(type_str: &str) -> PendingUpdateType {
    match type_str {
        "status_change" => PendingUpdateType::StatusChange,
        "add_comment" => PendingUpdateType::AddComment,
        "create_subtask" => PendingUpdateType::CreateSubtask,
        "update_description" => PendingUpdateType::UpdateDescription,
        "add_label" => PendingUpdateType::AddLabel,
        "remove_label" => PendingUpdateType::RemoveLabel,
        _ => PendingUpdateType::StatusChange,
    }
}

fn display_push_summary(results: &[PushResult]) {
    let successful: Vec<_> = results.iter().filter(|r| r.success).collect();
    let failed: Vec<_> = results.iter().filter(|r| !r.success).collect();

    if !successful.is_empty() {
        println!("{}", "Pushed:".green());
        for result in &successful {
            println!(
                "  {}",
                format!(
                    "✓ {} {}",
                    format_update_type(&result.update_type),
                    result.issue_identifier
                )
                .dimmed()
            );
        }
    }

    if !failed.is_empty() {
        println!("{}", "\nFailed:".red());
        for result in &failed {
            println!(
                "  {}",
                format!(
                    "✗ {} {}",
                    format_update_type(&result.update_type),
                    result.issue_identifier
                )
                .dimmed()
            );
            if let Some(ref err) = result.error {
                println!("    {}", err.dimmed());
            }
        }
    }
}
