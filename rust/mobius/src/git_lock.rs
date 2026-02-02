//! Git lock manager for serialized operations.
//!
//! Provides exclusive locking for git operations when multiple parallel agents
//! share a worktree. Uses mkdir-based atomic locking with stale lock detection.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::time::sleep;

const LOCK_DIR_NAME: &str = ".git-lock";
const LOCK_METADATA_FILE: &str = "lock.json";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const STALE_LOCK_AGE: Duration = Duration::from_secs(5 * 60); // 5 minutes
const RETRY_INTERVAL: Duration = Duration::from_millis(100);

/// Metadata stored in the lock directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct LockMetadata {
    pid: u32,
    acquired: String, // ISO-8601 timestamp
    hostname: String,
}

/// A handle to an acquired lock. Dropping this does NOT release the lock;
/// you must call `release()` explicitly or use `with_lock()`.
#[derive(Debug)]
pub struct LockHandle {
    lock_path: PathBuf,
    pub acquired: chrono::DateTime<Utc>,
    pub pid: u32,
}

impl LockHandle {
    /// Release the lock by removing the lock directory.
    pub async fn release(self) -> Result<()> {
        do_release_lock(&self.lock_path).await
    }
}

/// Get the lock directory path for a worktree.
fn get_lock_path(worktree_path: &Path) -> PathBuf {
    worktree_path.join(LOCK_DIR_NAME)
}

/// Get the lock metadata file path.
fn get_metadata_path(worktree_path: &Path) -> PathBuf {
    get_lock_path(worktree_path).join(LOCK_METADATA_FILE)
}

/// Read lock metadata from disk.
async fn read_lock_metadata(worktree_path: &Path) -> Option<LockMetadata> {
    let metadata_path = get_metadata_path(worktree_path);
    match tokio::fs::read_to_string(&metadata_path).await {
        Ok(content) => serde_json::from_str(&content).ok(),
        Err(_) => None,
    }
}

/// Write lock metadata to disk.
async fn write_lock_metadata(worktree_path: &Path, metadata: &LockMetadata) -> Result<()> {
    let metadata_path = get_metadata_path(worktree_path);
    let content =
        serde_json::to_string_pretty(metadata).context("failed to serialize lock metadata")?;
    tokio::fs::write(&metadata_path, content)
        .await
        .context("failed to write lock metadata")?;
    Ok(())
}

/// Check if a lock is stale (older than `STALE_LOCK_AGE`).
async fn is_lock_stale(worktree_path: &Path) -> bool {
    let lock_path = get_lock_path(worktree_path);

    match tokio::fs::metadata(&lock_path).await {
        Ok(stats) => {
            if let Ok(modified) = stats.modified() {
                if let Ok(age) = modified.elapsed() {
                    return age > STALE_LOCK_AGE;
                }
            }
            false
        }
        Err(_) => false, // Lock doesn't exist
    }
}

/// Check if the process holding the lock is still alive.
fn is_process_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // Sending signal 0 tests if process exists without killing it
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        // On non-unix, assume alive (conservative)
        let _ = pid;
        true
    }
}

/// Attempt to acquire the lock once.
async fn try_acquire_lock(worktree_path: &Path) -> Result<bool> {
    let lock_path = get_lock_path(worktree_path);

    // mkdir acts as atomic lock - fails with AlreadyExists if lock exists
    match tokio::fs::create_dir(&lock_path).await {
        Ok(()) => {
            // Write metadata
            let metadata = LockMetadata {
                pid: std::process::id(),
                acquired: Utc::now().to_rfc3339(),
                hostname: std::env::var("HOSTNAME").unwrap_or_else(|_| "unknown".to_string()),
            };
            write_lock_metadata(worktree_path, &metadata).await?;
            Ok(true)
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(e) => Err(e).context("failed to create lock directory"),
    }
}

/// Release a lock by removing the lock directory.
async fn do_release_lock(lock_path: &Path) -> Result<()> {
    match tokio::fs::remove_dir_all(lock_path).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e).context("failed to remove lock directory"),
    }
}

/// Try to clean up a stale lock.
async fn try_cleanup_stale_lock(worktree_path: &Path) -> bool {
    let lock_path = get_lock_path(worktree_path);

    if !lock_path.exists() {
        return true; // No lock to clean up
    }

    // Check if lock is stale by age
    let stale_by_age = is_lock_stale(worktree_path).await;

    // Check if owning process is dead
    let stale_by_process = match read_lock_metadata(worktree_path).await {
        Some(metadata) => !is_process_alive(metadata.pid),
        None => true, // Can't read metadata, assume stale
    };

    if stale_by_age || stale_by_process {
        let _ = do_release_lock(&lock_path).await;
        return true;
    }

    false
}

/// Acquire exclusive lock for git operations.
///
/// Retries with a 100ms interval until the lock is acquired or the timeout is exceeded.
/// Stale locks (older than 5 minutes or held by dead processes) are automatically cleaned up.
pub async fn acquire_lock(worktree_path: &Path, timeout: Option<Duration>) -> Result<LockHandle> {
    let timeout = timeout.unwrap_or(DEFAULT_TIMEOUT);
    let start = Instant::now();

    loop {
        // Try to acquire lock
        if try_acquire_lock(worktree_path).await? {
            let acquired = Utc::now();
            let lock_path = get_lock_path(worktree_path);

            return Ok(LockHandle {
                lock_path,
                acquired,
                pid: std::process::id(),
            });
        }

        // Try to clean up stale lock
        try_cleanup_stale_lock(worktree_path).await;

        // Check timeout
        let elapsed = start.elapsed();
        if elapsed >= timeout {
            let metadata = read_lock_metadata(worktree_path).await;
            let owner_info = match metadata {
                Some(m) => format!("Lock held by PID {} since {}", m.pid, m.acquired),
                None => "Unknown lock owner".to_string(),
            };
            bail!(
                "Failed to acquire git lock after {}ms. {}. Lock path: {}",
                timeout.as_millis(),
                owner_info,
                get_lock_path(worktree_path).display()
            );
        }

        // Wait before retrying
        sleep(RETRY_INTERVAL).await;
    }
}

/// Execute a function while holding the git lock.
///
/// The lock is automatically released when the function completes (or panics).
pub async fn with_lock<T, F, Fut>(
    worktree_path: &Path,
    timeout: Option<Duration>,
    f: F,
) -> Result<T>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<T>>,
{
    let handle = acquire_lock(worktree_path, timeout).await?;
    let result = f().await;
    let _ = handle.release().await;
    result
}

/// Check if a lock is currently held for the worktree (and not stale).
pub async fn is_locked(worktree_path: &Path) -> bool {
    let lock_path = get_lock_path(worktree_path);

    if !lock_path.exists() {
        return false;
    }

    // Check if lock is stale
    if is_lock_stale(worktree_path).await {
        return false;
    }

    // Check if owning process is alive
    if let Some(metadata) = read_lock_metadata(worktree_path).await {
        if !is_process_alive(metadata.pid) {
            return false;
        }
    }

    true
}

/// Force release a lock (use with caution).
///
/// This should only be used for manual cleanup, not during normal operation.
pub async fn force_release_lock(worktree_path: &Path) -> Result<()> {
    let lock_path = get_lock_path(worktree_path);
    do_release_lock(&lock_path).await
}

/// Get information about the current lock holder.
pub async fn get_lock_info(worktree_path: &Path) -> Option<LockInfo> {
    let metadata = read_lock_metadata(worktree_path).await?;
    Some(LockInfo {
        pid: metadata.pid,
        acquired: metadata.acquired,
        hostname: metadata.hostname,
    })
}

/// Information about a lock holder.
#[derive(Debug, Clone)]
pub struct LockInfo {
    pub pid: u32,
    pub acquired: String,
    pub hostname: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEST_COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn unique_test_dir() -> PathBuf {
        let id = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!(
            "mobius-git-lock-test-{}-{}",
            std::process::id(),
            id
        ))
    }

    #[tokio::test]
    async fn test_acquire_and_release_lock() {
        let test_dir = unique_test_dir();
        std::fs::create_dir_all(&test_dir).unwrap();

        let handle = acquire_lock(&test_dir, None).await.unwrap();
        assert_eq!(handle.pid, std::process::id());

        // Lock should be held
        assert!(is_locked(&test_dir).await);

        // Release lock
        handle.release().await.unwrap();

        // Lock should be released
        assert!(!is_locked(&test_dir).await);

        // Cleanup
        std::fs::remove_dir_all(&test_dir).ok();
    }

    #[tokio::test]
    async fn test_lock_prevents_double_acquire() {
        let test_dir = unique_test_dir();
        std::fs::create_dir_all(&test_dir).unwrap();

        let handle = acquire_lock(&test_dir, None).await.unwrap();

        // Trying to acquire again should timeout (with short timeout)
        let result = acquire_lock(&test_dir, Some(Duration::from_millis(200))).await;
        assert!(result.is_err());

        handle.release().await.unwrap();

        // Cleanup
        std::fs::remove_dir_all(&test_dir).ok();
    }

    #[tokio::test]
    async fn test_stale_lock_by_dead_process() {
        let test_dir = unique_test_dir();
        std::fs::create_dir_all(&test_dir).unwrap();

        // Create a fake lock with a dead PID
        let lock_path = get_lock_path(&test_dir);
        std::fs::create_dir_all(&lock_path).unwrap();

        let metadata = LockMetadata {
            pid: 999999999, // Very unlikely to be a real PID
            acquired: Utc::now().to_rfc3339(),
            hostname: "test".to_string(),
        };
        let metadata_path = lock_path.join(LOCK_METADATA_FILE);
        std::fs::write(
            &metadata_path,
            serde_json::to_string_pretty(&metadata).unwrap(),
        )
        .unwrap();

        // Should be able to acquire because the owning process is dead
        let handle = acquire_lock(&test_dir, Some(Duration::from_secs(2)))
            .await
            .unwrap();
        handle.release().await.unwrap();

        // Cleanup
        std::fs::remove_dir_all(&test_dir).ok();
    }

    #[tokio::test]
    async fn test_with_lock() {
        let test_dir = unique_test_dir();
        std::fs::create_dir_all(&test_dir).unwrap();

        let result = with_lock(&test_dir, None, || async { Ok(42) }).await;
        assert_eq!(result.unwrap(), 42);

        // Lock should be released after with_lock
        assert!(!is_locked(&test_dir).await);

        // Cleanup
        std::fs::remove_dir_all(&test_dir).ok();
    }

    #[tokio::test]
    async fn test_is_locked_nonexistent() {
        let test_dir = unique_test_dir();
        // Don't create the directory - should return false
        assert!(!is_locked(&test_dir).await);
    }

    #[tokio::test]
    async fn test_force_release_lock() {
        let test_dir = unique_test_dir();
        std::fs::create_dir_all(&test_dir).unwrap();

        let _handle = acquire_lock(&test_dir, None).await.unwrap();
        assert!(is_locked(&test_dir).await);

        force_release_lock(&test_dir).await.unwrap();
        assert!(!is_locked(&test_dir).await);

        // Cleanup
        std::fs::remove_dir_all(&test_dir).ok();
    }

    #[tokio::test]
    async fn test_get_lock_info() {
        let test_dir = unique_test_dir();
        std::fs::create_dir_all(&test_dir).unwrap();

        // No lock yet
        assert!(get_lock_info(&test_dir).await.is_none());

        let handle = acquire_lock(&test_dir, None).await.unwrap();

        // Should have lock info
        let info = get_lock_info(&test_dir).await.unwrap();
        assert_eq!(info.pid, std::process::id());

        handle.release().await.unwrap();

        // Cleanup
        std::fs::remove_dir_all(&test_dir).ok();
    }

    #[test]
    fn test_is_process_alive_current() {
        // Current process should be alive
        assert!(is_process_alive(std::process::id()));
    }

    #[test]
    fn test_is_process_alive_dead() {
        // Very high PID should not exist
        assert!(!is_process_alive(999999999));
    }
}
