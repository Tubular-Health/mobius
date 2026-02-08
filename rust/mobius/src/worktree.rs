//! Git worktree management for parallel agent execution.
//!
//! Manages worktree creation/removal, branch detection, and symlinks
//! for isolated parallel execution environments.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use tokio::process::Command;

use crate::types::enums::AgentRuntime;

/// Information about a created or resumed worktree.
#[derive(Debug, Clone)]
pub struct WorktreeInfo {
    pub path: PathBuf,
    pub branch: String,
    pub task_id: String,
    /// `false` if the worktree already existed (resume scenario).
    pub created: bool,
}

/// Minimal execution config fields needed for worktree operations.
/// This will be replaced by the full `ExecutionConfig` from the types module.
pub struct WorktreeConfig {
    pub worktree_path: Option<String>,
    pub base_branch: Option<String>,
    pub runtime: AgentRuntime,
}

/// Get the repository name from git remote or current directory name.
pub async fn get_repo_name() -> Result<String> {
    // Try to get repo name from git remote
    let output = Command::new("git")
        .args(["remote", "get-url", "origin"])
        .output()
        .await
        .context("failed to run git remote get-url origin")?;

    if output.status.success() {
        let url = String::from_utf8_lossy(&output.stdout).trim().to_string();

        // Extract repo name from URL (handles both HTTPS and SSH)
        // https://github.com/user/repo.git -> repo
        // git@github.com:user/repo.git -> repo
        if let Some(name) = extract_repo_name_from_url(&url) {
            return Ok(name);
        }
    }

    // Fall back to current directory name
    let cwd = std::env::current_dir().context("failed to get current directory")?;
    let name = cwd
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "repo".to_string());
    Ok(name)
}

/// Extract the repository name from a git remote URL.
fn extract_repo_name_from_url(url: &str) -> Option<String> {
    // Try HTTPS format: https://github.com/user/repo.git
    if let Some(pos) = url.rfind('/') {
        let name = &url[pos + 1..];
        let name = name.strip_suffix(".git").unwrap_or(name);
        if !name.is_empty() {
            return Some(name.to_string());
        }
    }

    // Try SSH format: git@github.com:user/repo.git
    if let Some(pos) = url.rfind(':') {
        let after_colon = &url[pos + 1..];
        if let Some(slash_pos) = after_colon.rfind('/') {
            let name = &after_colon[slash_pos + 1..];
            let name = name.strip_suffix(".git").unwrap_or(name);
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }

    None
}

/// Get the git repository root (handles both main repo and worktrees).
///
/// If we're in a worktree, this returns the main repo's path, not the worktree path.
/// This ensures consistent worktree path calculation regardless of where mobius is run from.
pub async fn get_git_repo_root() -> Result<PathBuf> {
    // Check if we're in a worktree by comparing git-dir and git-common-dir
    let git_dir_output = Command::new("git")
        .args(["rev-parse", "--git-dir"])
        .output()
        .await
        .context("failed to run git rev-parse --git-dir")?;

    let common_dir_output = Command::new("git")
        .args(["rev-parse", "--git-common-dir"])
        .output()
        .await
        .context("failed to run git rev-parse --git-common-dir")?;

    if git_dir_output.status.success() && common_dir_output.status.success() {
        let git_dir = String::from_utf8_lossy(&git_dir_output.stdout)
            .trim()
            .to_string();
        let common_dir = String::from_utf8_lossy(&common_dir_output.stdout)
            .trim()
            .to_string();

        // If common dir is different from git dir, we're in a worktree
        if common_dir != git_dir && common_dir != ".git" {
            // The common dir points to the main repo's .git directory
            // Get the parent to get the main repo root
            let common_path = PathBuf::from(&common_dir);
            let resolved = if common_path.is_absolute() {
                common_path
            } else {
                let cwd = std::env::current_dir()?;
                cwd.join(&common_path).canonicalize()?
            };
            if let Some(parent) = resolved.parent() {
                return Ok(parent.to_path_buf());
            }
        }
    }

    // We're in the main repo - use show-toplevel
    let output = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .await
        .context("failed to run git rev-parse --show-toplevel")?;

    if output.status.success() {
        let toplevel = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok(PathBuf::from(toplevel));
    }

    // Fallback to cwd
    std::env::current_dir().context("failed to get current directory")
}

/// Get the worktree path for a given task.
pub async fn get_worktree_path(task_id: &str, config: &WorktreeConfig) -> Result<PathBuf> {
    let template = config
        .worktree_path
        .as_deref()
        .unwrap_or("../<repo>-worktrees/");
    let repo_name = get_repo_name().await?;

    // Replace <repo> placeholder with actual repo name
    let base_path = template.replace("<repo>", &repo_name);

    // Get the main repo root (not the worktree we might be in)
    let repo_root = get_git_repo_root().await?;

    // Resolve path relative to the main repo root
    Ok(repo_root.join(base_path).join(task_id))
}

/// Check if a worktree already exists for the given task.
pub async fn worktree_exists(task_id: &str, config: &WorktreeConfig) -> Result<bool> {
    let worktree_path = get_worktree_path(task_id, config).await?;
    Ok(worktree_path.exists())
}

/// Check if a git branch exists (locally or remotely).
pub async fn branch_exists(branch_name: &str) -> Result<BranchExistence> {
    let mut local = false;
    let mut remote = false;

    // Check local branches
    if let Ok(output) = Command::new("git")
        .args(["branch", "--list", branch_name])
        .output()
        .await
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            local = !stdout.trim().is_empty();
        }
    }

    // Check remote branches
    let remote_ref = format!("origin/{}", branch_name);
    if let Ok(output) = Command::new("git")
        .args(["branch", "-r", "--list", &remote_ref])
        .output()
        .await
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            remote = !stdout.trim().is_empty();
        }
    }

    Ok(BranchExistence { local, remote })
}

#[derive(Debug)]
pub struct BranchExistence {
    pub local: bool,
    pub remote: bool,
}

/// Result of checking whether an issue's branch has been merged into the base branch.
#[derive(Debug)]
pub struct MergeDetectionResult {
    /// Whether the remote branch has been deleted (indicates merge + cleanup).
    pub remote_branch_deleted: bool,
    /// Whether the issue identifier was found in the base branch's commit log.
    pub found_in_base_log: bool,
}

impl MergeDetectionResult {
    /// Returns `true` if either check indicates the branch was merged.
    pub fn is_merged(&self) -> bool {
        self.remote_branch_deleted || self.found_in_base_log
    }
}

/// Check if an issue's branch has been merged into the base branch.
///
/// Performs two independent checks:
/// 1. Whether the remote branch has been deleted (via `git ls-remote`)
/// 2. Whether the issue identifier appears in the base branch's commit log
///
/// Both checks always execute regardless of individual results.
pub async fn is_issue_merged_into_base(
    branch_name: &str,
    identifier: &str,
    base_branch: &str,
) -> Result<MergeDetectionResult> {
    // Check if remote branch is deleted using ls-remote (queries remote directly)
    let ls_remote_output = Command::new("git")
        .args(["ls-remote", "--heads", "origin", branch_name])
        .output()
        .await
        .context("failed to run git ls-remote")?;

    let remote_branch_deleted = if ls_remote_output.status.success() {
        let stdout = String::from_utf8_lossy(&ls_remote_output.stdout);
        stdout.trim().is_empty()
    } else {
        // If ls-remote fails (e.g. no network), assume not deleted
        false
    };

    // Check if identifier appears in base branch commit log
    let log_output = Command::new("git")
        .args([
            "log",
            base_branch,
            "--oneline",
            &format!("--grep={}", identifier),
        ])
        .output()
        .await
        .context("failed to run git log")?;

    let found_in_base_log = if log_output.status.success() {
        let stdout = String::from_utf8_lossy(&log_output.stdout);
        !stdout.trim().is_empty()
    } else {
        false
    };

    Ok(MergeDetectionResult {
        remote_branch_deleted,
        found_in_base_log,
    })
}

fn runtime_config_dir(runtime: AgentRuntime) -> &'static str {
    match runtime {
        AgentRuntime::Claude => ".claude",
        AgentRuntime::Opencode => ".opencode",
    }
}

/// Symlink active runtime config directory from source repo to worktree.
fn symlink_runtime_config_dir(source_repo: &Path, worktree_path: &Path, runtime: AgentRuntime) {
    let runtime_dir = runtime_config_dir(runtime);
    let source_path = source_repo.join(runtime_dir);
    let target_path = worktree_path.join(runtime_dir);

    // Only symlink if source exists and target doesn't
    if source_path.exists() && !target_path.exists() {
        if let Ok(metadata) = std::fs::symlink_metadata(&source_path) {
            if metadata.is_dir() {
                #[cfg(unix)]
                {
                    if let Err(e) = std::os::unix::fs::symlink(&source_path, &target_path) {
                        tracing::warn!(
                            "Failed to symlink {} -> {}: {}",
                            source_path.display(),
                            target_path.display(),
                            e
                        );
                    }
                }
                #[cfg(not(unix))]
                {
                    tracing::warn!(
                        "Symlink not supported on this platform for {}",
                        source_path.display()
                    );
                }
            }
        }
    }
}

/// Get the actual default branch name from the repo.
async fn get_default_branch_name() -> Option<String> {
    // Try to get from origin HEAD reference
    if let Ok(output) = Command::new("git")
        .args(["symbolic-ref", "refs/remotes/origin/HEAD"])
        .output()
        .await
    {
        if output.status.success() {
            let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let name = branch
                .strip_prefix("refs/remotes/origin/")
                .unwrap_or(&branch);
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }

    // Fall back to checking common branch names
    let common_branches = ["main", "master", "develop"];
    for branch in common_branches {
        if let Ok(existence) = branch_exists(branch).await {
            if existence.local || existence.remote {
                return Some(branch.to_string());
            }
        }
    }

    None
}

/// Create a worktree for the given task.
pub async fn create_worktree(
    task_id: &str,
    branch_name: &str,
    config: &WorktreeConfig,
) -> Result<WorktreeInfo> {
    let worktree_path = get_worktree_path(task_id, config).await?;

    // Check if worktree already exists (resume scenario)
    if worktree_path.exists() {
        if let Ok(cwd) = std::env::current_dir() {
            symlink_runtime_config_dir(&cwd, &worktree_path, config.runtime);
        }
        return Ok(WorktreeInfo {
            path: worktree_path,
            branch: branch_name.to_string(),
            task_id: task_id.to_string(),
            created: false,
        });
    }

    // Check if branch already exists
    let branch = branch_exists(branch_name).await?;

    if branch.local || branch.remote {
        // Branch exists locally or on remote, create worktree pointing to it
        let output = Command::new("git")
            .args([
                "worktree",
                "add",
                &worktree_path.to_string_lossy(),
                branch_name,
            ])
            .output()
            .await
            .context("failed to run git worktree add")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            bail!("git worktree add failed: {}", stderr.trim());
        }
    } else {
        // Need to create a new branch - determine the base branch
        let base_branch = match &config.base_branch {
            Some(b) => b.clone(),
            None => {
                // Try to auto-detect the default branch
                match get_default_branch_name().await {
                    Some(detected) => detected,
                    None => bail!(
                        "Could not determine base branch for worktree creation.\n\n\
                         This repository does not have a 'main' branch, and the default branch could not be detected.\n\n\
                         Please set 'base_branch' in your mobius config:\n\
                         \x20 1. Run: mobius config -e\n\
                         \x20 2. Add under [execution]:\n\
                         \x20    base_branch = \"master\"  # or your default branch name"
                    ),
                }
            }
        };

        // Verify the base branch exists before attempting to create worktree
        let base_exists = branch_exists(&base_branch).await?;
        if !base_exists.local && !base_exists.remote {
            let detected = get_default_branch_name().await;
            let suggestion = detected
                .as_deref()
                .map(|d| format!("\n\nDetected '{}' as a possible default branch.", d))
                .unwrap_or_default();

            bail!(
                "Base branch '{}' does not exist in this repository.{}\n\n\
                 Please update 'base_branch' in your mobius config:\n\
                 \x20 1. Run: mobius config -e\n\
                 \x20 2. Update under [execution]:\n\
                 \x20    base_branch = \"{}\"",
                base_branch,
                suggestion,
                detected.as_deref().unwrap_or("your-default-branch")
            );
        }

        // Create new branch off base branch
        let output = Command::new("git")
            .args([
                "worktree",
                "add",
                &worktree_path.to_string_lossy(),
                "-b",
                branch_name,
                &base_branch,
            ])
            .output()
            .await
            .context("failed to run git worktree add -b")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            bail!("git worktree add -b failed: {}", stderr.trim());
        }
    }

    // Symlink active runtime config directory from source repo
    let cwd = std::env::current_dir().context("failed to get current directory")?;
    symlink_runtime_config_dir(&cwd, &worktree_path, config.runtime);

    Ok(WorktreeInfo {
        path: worktree_path,
        branch: branch_name.to_string(),
        task_id: task_id.to_string(),
        created: true,
    })
}

/// Remove a worktree for the given task.
pub async fn remove_worktree(task_id: &str, config: &WorktreeConfig) -> Result<()> {
    let worktree_path = get_worktree_path(task_id, config).await?;

    if !worktree_path.exists() {
        return Ok(()); // Already removed or never existed
    }

    let output = Command::new("git")
        .args([
            "worktree",
            "remove",
            &worktree_path.to_string_lossy(),
            "--force",
        ])
        .output()
        .await
        .context("failed to run git worktree remove")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("git worktree remove failed: {}", stderr.trim());
    }

    Ok(())
}

/// List all existing worktrees.
pub async fn list_worktrees() -> Result<Vec<WorktreeEntry>> {
    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .output()
        .await
        .context("failed to run git worktree list")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("git worktree list failed: {}", stderr.trim());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut worktrees = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_head: Option<String> = None;
    let mut current_branch: Option<String> = None;

    for line in stdout.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            current_path = Some(path.to_string());
        } else if let Some(head) = line.strip_prefix("HEAD ") {
            current_head = Some(head.to_string());
        } else if let Some(branch) = line.strip_prefix("branch ") {
            current_branch = Some(branch.replace("refs/heads/", ""));
        } else if line == "detached" {
            current_branch = Some("(detached)".to_string());
        } else if line.is_empty() {
            if let (Some(path), Some(branch), Some(head)) = (
                current_path.take(),
                current_branch.take(),
                current_head.take(),
            ) {
                worktrees.push(WorktreeEntry { path, branch, head });
            } else {
                // Reset partial state
                current_path = None;
                current_head = None;
                current_branch = None;
            }
        }
    }

    // Flush the last entry if the output didn't end with a blank line
    if let (Some(path), Some(branch), Some(head)) = (
        current_path.take(),
        current_branch.take(),
        current_head.take(),
    ) {
        worktrees.push(WorktreeEntry { path, branch, head });
    }

    Ok(worktrees)
}

/// A parsed worktree entry from `git worktree list --porcelain`.
#[derive(Debug, Clone)]
pub struct WorktreeEntry {
    pub path: String,
    pub branch: String,
    pub head: String,
}

/// Prune stale worktree references.
pub async fn prune_worktrees() -> Result<()> {
    let output = Command::new("git")
        .args(["worktree", "prune"])
        .output()
        .await
        .context("failed to run git worktree prune")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("git worktree prune failed: {}", stderr.trim());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_repo_name_https() {
        assert_eq!(
            extract_repo_name_from_url("https://github.com/user/repo.git"),
            Some("repo".to_string())
        );
    }

    #[test]
    fn test_extract_repo_name_https_no_git_suffix() {
        assert_eq!(
            extract_repo_name_from_url("https://github.com/user/repo"),
            Some("repo".to_string())
        );
    }

    #[test]
    fn test_extract_repo_name_ssh() {
        assert_eq!(
            extract_repo_name_from_url("git@github.com:user/repo.git"),
            Some("repo".to_string())
        );
    }

    #[test]
    fn test_extract_repo_name_ssh_no_git_suffix() {
        assert_eq!(
            extract_repo_name_from_url("git@github.com:user/repo"),
            Some("repo".to_string())
        );
    }

    #[tokio::test]
    async fn test_get_repo_name_returns_string() {
        // This test just verifies it doesn't panic - actual name depends on repo
        let name = get_repo_name().await;
        assert!(name.is_ok());
        assert!(!name.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_get_git_repo_root_returns_path() {
        let root = get_git_repo_root().await;
        assert!(root.is_ok());
        assert!(root.unwrap().exists());
    }

    #[tokio::test]
    async fn test_get_worktree_path_default_template() {
        let config = WorktreeConfig {
            worktree_path: None,
            base_branch: None,
            runtime: AgentRuntime::Claude,
        };
        let path = get_worktree_path("MOB-123", &config).await;
        assert!(path.is_ok());
        let path = path.unwrap();
        // Should end with the task ID
        assert!(path.ends_with("MOB-123"));
    }

    #[tokio::test]
    async fn test_get_worktree_path_custom_template() {
        let config = WorktreeConfig {
            worktree_path: Some("../custom-<repo>-trees/".to_string()),
            base_branch: None,
            runtime: AgentRuntime::Claude,
        };
        let path = get_worktree_path("MOB-456", &config).await;
        assert!(path.is_ok());
        let path = path.unwrap();
        assert!(path.ends_with("MOB-456"));
    }

    #[tokio::test]
    async fn test_worktree_exists_nonexistent() {
        let config = WorktreeConfig {
            worktree_path: Some("/tmp/nonexistent-worktrees/".to_string()),
            base_branch: None,
            runtime: AgentRuntime::Claude,
        };
        let exists = worktree_exists("nonexistent-task-xyz", &config).await;
        assert!(exists.is_ok());
        assert!(!exists.unwrap());
    }

    #[tokio::test]
    async fn test_list_worktrees() {
        let result = list_worktrees().await;
        assert!(result.is_ok());
        // At minimum, the main worktree should exist
        let worktrees = result.unwrap();
        assert!(!worktrees.is_empty());
    }

    #[tokio::test]
    async fn test_create_worktree_resume_existing() {
        // Create a temp directory to simulate an existing worktree
        let temp_dir = std::env::temp_dir().join("mobius-test-worktree-resume");
        std::fs::create_dir_all(&temp_dir).unwrap();

        let config = WorktreeConfig {
            worktree_path: Some(temp_dir.parent().unwrap().to_string_lossy().to_string()),
            base_branch: None,
            runtime: AgentRuntime::Claude,
        };

        // The task_id matches the temp directory name
        let task_id = temp_dir.file_name().unwrap().to_string_lossy().to_string();
        let result = create_worktree(&task_id, "test-branch", &config).await;
        assert!(result.is_ok());
        let info = result.unwrap();
        assert!(!info.created); // Should detect as existing (resume)

        // Cleanup
        std::fs::remove_dir_all(&temp_dir).ok();
    }

    #[test]
    fn test_runtime_config_dir_claude() {
        assert_eq!(runtime_config_dir(AgentRuntime::Claude), ".claude");
    }

    #[test]
    fn test_runtime_config_dir_opencode() {
        assert_eq!(runtime_config_dir(AgentRuntime::Opencode), ".opencode");
    }

    #[test]
    #[cfg(unix)]
    fn test_symlink_runtime_config_dir_claude() {
        let tmp = tempfile::tempdir().unwrap();
        let source_repo = tmp.path().join("source");
        let worktree = tmp.path().join("worktree");
        std::fs::create_dir_all(source_repo.join(".claude")).unwrap();
        std::fs::create_dir_all(&worktree).unwrap();

        symlink_runtime_config_dir(&source_repo, &worktree, AgentRuntime::Claude);

        let link_path = worktree.join(".claude");
        let meta = std::fs::symlink_metadata(&link_path).unwrap();
        assert!(meta.file_type().is_symlink());
        assert_eq!(
            std::fs::read_link(&link_path).unwrap(),
            source_repo.join(".claude")
        );
    }

    #[test]
    #[cfg(unix)]
    fn test_symlink_runtime_config_dir_opencode() {
        let tmp = tempfile::tempdir().unwrap();
        let source_repo = tmp.path().join("source");
        let worktree = tmp.path().join("worktree");
        std::fs::create_dir_all(source_repo.join(".opencode")).unwrap();
        std::fs::create_dir_all(&worktree).unwrap();

        symlink_runtime_config_dir(&source_repo, &worktree, AgentRuntime::Opencode);

        let link_path = worktree.join(".opencode");
        let meta = std::fs::symlink_metadata(&link_path).unwrap();
        assert!(meta.file_type().is_symlink());
        assert_eq!(
            std::fs::read_link(&link_path).unwrap(),
            source_repo.join(".opencode")
        );
    }
}
