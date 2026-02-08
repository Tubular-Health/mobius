use anyhow::{Context, Result};
use std::env;
use tokio::fs;
use tokio::process::Command;

/// Represents a tmux session handle
#[derive(Debug, Clone)]
pub struct TmuxSession {
    pub name: String,
    pub id: String,
    pub initial_pane_id: String,
}

/// Represents a tmux pane handle
#[derive(Debug, Clone)]
pub struct TmuxPane {
    pub id: String,
    pub session_id: String,
    pub task_id: Option<String>,
    pub pane_type: PaneType,
}

/// Type of tmux pane
#[derive(Debug, Clone, PartialEq)]
pub enum PaneType {
    Agent,
    Status,
}

/// Current loop status for the status pane display
pub struct LoopStatus {
    pub total_tasks: usize,
    pub completed_tasks: usize,
    pub active_agents: Vec<ActiveAgent>,
    pub blocked_tasks: Vec<String>,
    pub elapsed_ms: u64,
}

/// An active agent entry for status display
pub struct ActiveAgent {
    pub task_id: String,
    pub identifier: String,
}

/// Get the path to the status file for a session
pub fn get_status_file_path(session_name: &str) -> String {
    format!("/tmp/mobius-status-{session_name}.txt")
}

/// Check if currently running inside a tmux session
pub fn is_inside_tmux() -> bool {
    env::var("TMUX").is_ok()
}

/// Get session name from task ID (e.g., "MOB-123" -> "mobius-MOB-123")
pub fn get_session_name(task_id: &str) -> String {
    format!("mobius-{task_id}")
}

/// Check if a tmux session exists
pub async fn session_exists(session_name: &str) -> bool {
    Command::new("tmux")
        .args(["has-session", "-t", session_name])
        .output()
        .await
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Create a new tmux session, killing any existing session with the same name first
pub async fn create_session(session_name: &str) -> Result<TmuxSession> {
    // Kill any existing session to start fresh
    if session_exists(session_name).await {
        let _ = Command::new("tmux")
            .args(["kill-session", "-t", session_name])
            .output()
            .await;
    }

    // Create new detached session
    let output = Command::new("tmux")
        .args(["new-session", "-d", "-s", session_name])
        .output()
        .await
        .context("Failed to create tmux session")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("tmux new-session failed: {}", stderr.trim());
    }

    // Get the session ID and initial pane ID
    let output = Command::new("tmux")
        .args([
            "display-message",
            "-t",
            session_name,
            "-p",
            "#{session_id}:#{pane_id}",
        ])
        .output()
        .await
        .context("Failed to get session info")?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = stdout.trim().split(':').collect();
    if parts.len() < 2 {
        anyhow::bail!("Unexpected tmux display-message output: {}", stdout.trim());
    }

    Ok(TmuxSession {
        name: session_name.to_string(),
        id: parts[0].to_string(),
        initial_pane_id: parts[1].to_string(),
    })
}

/// Destroy a tmux session and clean up its status file
pub async fn destroy_session(session: &TmuxSession) -> Result<()> {
    // Clean up status file
    let status_file = get_status_file_path(&session.name);
    let _ = fs::remove_file(&status_file).await;

    // Kill the session
    let _ = Command::new("tmux")
        .args(["kill-session", "-t", &session.name])
        .output()
        .await;

    Ok(())
}

/// Attach to an existing tmux session
pub async fn attach_to_session(session_name: &str) -> Result<()> {
    if is_inside_tmux() {
        let output = Command::new("tmux")
            .args(["switch-client", "-t", session_name])
            .output()
            .await
            .context("Failed to switch tmux client")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("tmux switch-client failed: {}", stderr.trim());
        }
    } else {
        // attach-session needs inherited stdio for interactive use
        let status = Command::new("tmux")
            .args(["attach-session", "-t", session_name])
            .status()
            .await
            .context("Failed to attach to tmux session")?;

        if !status.success() {
            anyhow::bail!("tmux attach-session failed");
        }
    }

    Ok(())
}

/// Create a pane for an agent in the session
pub async fn create_agent_pane(
    session: &TmuxSession,
    identifier: &str,
    title: &str,
    source_pane_id: Option<&str>,
) -> Result<TmuxPane> {
    let target_pane = source_pane_id.unwrap_or(&session.initial_pane_id);

    async fn split_window(target: &str) -> Result<String> {
        let output = Command::new("tmux")
            .args(["split-window", "-t", target, "-h", "-P", "-F", "#{pane_id}"])
            .output()
            .await
            .context("Failed to create agent pane")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            anyhow::bail!("tmux split-window failed: {}", stderr);
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    let pane_id = match split_window(target_pane).await {
        Ok(id) => id,
        Err(primary_err) => {
            // Fallback to a session target when the pane target vanished.
            if target_pane != session.name {
                match split_window(&session.name).await {
                    Ok(id) => id,
                    Err(fallback_err) => {
                        anyhow::bail!(
                            "{} (target: {}) | fallback failed: {}",
                            primary_err,
                            target_pane,
                            fallback_err
                        )
                    }
                }
            } else {
                return Err(primary_err);
            }
        }
    };

    // Set the pane title
    let pane_title = format!("{identifier}: {title}");
    let _ = Command::new("tmux")
        .args(["select-pane", "-t", &pane_id, "-T", &pane_title])
        .output()
        .await;

    Ok(TmuxPane {
        id: pane_id,
        session_id: session.id.clone(),
        task_id: None,
        pane_type: PaneType::Agent,
    })
}

/// Create a status bar pane at the bottom of the session
pub async fn create_status_pane(session: &TmuxSession) -> Result<TmuxPane> {
    let status_file = get_status_file_path(&session.name);

    // Create empty status file
    fs::write(&status_file, "")
        .await
        .context("Failed to create status file")?;

    // Split vertically at the bottom for status bar (15% height)
    let output = Command::new("tmux")
        .args([
            "split-window",
            "-t",
            &session.name,
            "-v",
            "-l",
            "15%",
            "-P",
            "-F",
            "#{pane_id}",
        ])
        .output()
        .await
        .context("Failed to create status pane")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("tmux split-window for status failed: {}", stderr.trim());
    }

    let pane_id = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // Set the pane title
    let _ = Command::new("tmux")
        .args(["select-pane", "-t", &pane_id, "-T", "Status"])
        .output()
        .await;

    // Start watch command to display status file with 0.5s refresh
    let watch_cmd = format!("watch -t -n 0.5 cat {status_file}");
    let _ = Command::new("tmux")
        .args(["send-keys", "-t", &pane_id, &watch_cmd, "Enter"])
        .output()
        .await;

    Ok(TmuxPane {
        id: pane_id,
        session_id: session.id.clone(),
        task_id: None,
        pane_type: PaneType::Status,
    })
}

/// Kill a specific pane
pub async fn kill_pane(pane_id: &str) {
    let _ = Command::new("tmux")
        .args(["kill-pane", "-t", pane_id])
        .output()
        .await;
}

/// Clear the scrollback and visible content of a pane
pub async fn clear_pane(pane_id: &str) {
    // Clear screen
    let _ = Command::new("tmux")
        .args(["send-keys", "-t", pane_id, "C-l"])
        .output()
        .await;

    // Clear scrollback history
    let _ = Command::new("tmux")
        .args(["clear-history", "-t", pane_id])
        .output()
        .await;
}

/// Execute a command in a specific pane
pub async fn run_in_pane(pane_id: &str, command: &str, clear_first: bool) {
    if clear_first {
        clear_pane(pane_id).await;
        // Small delay to ensure clear completes before sending command
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    let _ = Command::new("tmux")
        .args(["send-keys", "-t", pane_id, command, "Enter"])
        .output()
        .await;
}

/// Capture the content of a pane (last N lines)
pub async fn capture_pane_content(pane_id: &str, lines: u32) -> String {
    let start_line = format!("-{lines}");
    match Command::new("tmux")
        .args(["capture-pane", "-t", pane_id, "-p", "-S", &start_line])
        .output()
        .await
    {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).to_string()
        }
        _ => String::new(),
    }
}

/// Set the title of a pane
pub async fn set_pane_title(pane_id: &str, title: &str) {
    let _ = Command::new("tmux")
        .args(["select-pane", "-t", pane_id, "-T", title])
        .output()
        .await;
}

/// Send Ctrl+C to a pane to interrupt the running process
pub async fn interrupt_pane(pane_id: &str) {
    let _ = Command::new("tmux")
        .args(["send-keys", "-t", pane_id, "C-c"])
        .output()
        .await;
}

/// Check if a pane is still running (not dead)
pub async fn is_pane_still_running(pane_id: &str) -> bool {
    match Command::new("tmux")
        .args(["list-panes", "-a", "-F", "#{pane_id}:#{pane_dead}"])
        .output()
        .await
    {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let line = line.trim();
                if let Some((id, dead)) = line.split_once(':') {
                    if id == pane_id {
                        return dead != "1";
                    }
                }
            }
            // Pane not found at all means it's gone
            false
        }
        _ => false,
    }
}

/// Update the status pane with current loop status
pub async fn update_status_pane(status: &LoopStatus, session_name: &str) -> Result<()> {
    let elapsed = format_elapsed(status.elapsed_ms);

    let agents_list = if status.active_agents.is_empty() {
        "none".to_string()
    } else {
        status
            .active_agents
            .iter()
            .map(|a| a.identifier.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    };

    let blocked_list = if status.blocked_tasks.is_empty() {
        "none".to_string()
    } else {
        status.blocked_tasks.join(", ")
    };

    let content = format!(
        "Progress: {}/{} tasks completed\nActive agents: {}\nBlocked: {}\nElapsed: {}\n",
        status.completed_tasks, status.total_tasks, agents_list, blocked_list, elapsed
    );

    let status_file = get_status_file_path(session_name);
    fs::write(&status_file, &content)
        .await
        .context("Failed to write status file")?;

    Ok(())
}

/// Arrange panes in a layout suitable for the number of agents
pub async fn layout_panes(session: &TmuxSession, pane_count: usize) {
    if pane_count <= 1 {
        return;
    }

    let layout = select_layout(pane_count);

    let _ = Command::new("tmux")
        .args(["select-layout", "-t", &session.name, layout])
        .output()
        .await;
}

/// Select the appropriate tmux layout for a given pane count
fn select_layout(pane_count: usize) -> &'static str {
    if pane_count <= 2 {
        "even-horizontal"
    } else {
        "tiled"
    }
}

/// Format elapsed time in milliseconds for display
fn format_elapsed(ms: u64) -> String {
    let seconds = ms / 1000;
    let minutes = seconds / 60;
    let hours = minutes / 60;

    if hours > 0 {
        format!("{}h {}m {}s", hours, minutes % 60, seconds % 60)
    } else if minutes > 0 {
        format!("{}m {}s", minutes, seconds % 60)
    } else {
        format!("{}s", seconds)
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    #[test]
    fn test_get_session_name() {
        assert_eq!(get_session_name("MOB-123"), "mobius-MOB-123");
        assert_eq!(get_session_name("PROJ-1"), "mobius-PROJ-1");
    }

    #[test]
    fn test_get_status_file_path() {
        assert_eq!(
            get_status_file_path("mobius-MOB-123"),
            "/tmp/mobius-status-mobius-MOB-123.txt"
        );
    }

    #[test]
    fn test_format_elapsed_seconds() {
        assert_eq!(format_elapsed(0), "0s");
        assert_eq!(format_elapsed(1000), "1s");
        assert_eq!(format_elapsed(30_000), "30s");
        assert_eq!(format_elapsed(59_000), "59s");
    }

    #[test]
    fn test_format_elapsed_minutes() {
        assert_eq!(format_elapsed(60_000), "1m 0s");
        assert_eq!(format_elapsed(90_000), "1m 30s");
        assert_eq!(format_elapsed(300_000), "5m 0s");
        assert_eq!(format_elapsed(3_599_000), "59m 59s");
    }

    #[test]
    fn test_format_elapsed_hours() {
        assert_eq!(format_elapsed(3_600_000), "1h 0m 0s");
        assert_eq!(format_elapsed(3_661_000), "1h 1m 1s");
        assert_eq!(format_elapsed(7_200_000), "2h 0m 0s");
    }

    #[test]
    fn test_select_layout_single() {
        assert_eq!(select_layout(1), "even-horizontal");
    }

    #[test]
    fn test_select_layout_two_panes() {
        assert_eq!(select_layout(2), "even-horizontal");
    }

    #[test]
    fn test_select_layout_three_plus() {
        assert_eq!(select_layout(3), "tiled");
        assert_eq!(select_layout(4), "tiled");
        assert_eq!(select_layout(10), "tiled");
    }

    #[test]
    fn test_is_inside_tmux_without_env() {
        // In test environments, TMUX is typically not set
        // This tests the function returns false when TMUX env var is absent
        if env::var("TMUX").is_err() {
            assert!(!is_inside_tmux());
        }
    }

    #[test]
    fn test_pane_type_equality() {
        assert_eq!(PaneType::Agent, PaneType::Agent);
        assert_eq!(PaneType::Status, PaneType::Status);
        assert_ne!(PaneType::Agent, PaneType::Status);
    }

    #[tokio::test]
    async fn test_update_status_pane_content() {
        // Create a temp file for testing
        let test_session = "test-status-pane-content";
        let status_file = get_status_file_path(test_session);

        let status = LoopStatus {
            total_tasks: 10,
            completed_tasks: 3,
            active_agents: vec![
                ActiveAgent {
                    task_id: "t1".to_string(),
                    identifier: "MOB-101".to_string(),
                },
                ActiveAgent {
                    task_id: "t2".to_string(),
                    identifier: "MOB-102".to_string(),
                },
            ],
            blocked_tasks: vec!["MOB-105".to_string()],
            elapsed_ms: 125_000,
        };

        let result = update_status_pane(&status, test_session).await;
        assert!(result.is_ok());

        let content = fs::read_to_string(&status_file).await.unwrap();
        assert!(content.contains("Progress: 3/10 tasks completed"));
        assert!(content.contains("Active agents: MOB-101, MOB-102"));
        assert!(content.contains("Blocked: MOB-105"));
        assert!(content.contains("Elapsed: 2m 5s"));

        // Clean up
        let _ = fs::remove_file(&status_file).await;
    }

    #[tokio::test]
    async fn test_update_status_pane_empty_agents() {
        let test_session = "test-status-empty-agents";
        let status_file = get_status_file_path(test_session);

        let status = LoopStatus {
            total_tasks: 5,
            completed_tasks: 5,
            active_agents: vec![],
            blocked_tasks: vec![],
            elapsed_ms: 60_000,
        };

        let result = update_status_pane(&status, test_session).await;
        assert!(result.is_ok());

        let content = fs::read_to_string(&status_file).await.unwrap();
        assert!(content.contains("Active agents: none"));
        assert!(content.contains("Blocked: none"));

        // Clean up
        let _ = fs::remove_file(&status_file).await;
    }

    #[tokio::test]
    async fn test_session_exists_nonexistent() {
        // A session with a random name should not exist
        let exists = session_exists("mobius-nonexistent-test-session-xyz").await;
        assert!(!exists);
    }
}
