/**
 * Git lock manager for serialized operations
 *
 * Provides exclusive locking for git operations when multiple parallel agents
 * share a worktree. Uses mkdir-based atomic locking with stale lock detection.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface LockHandle {
  path: string;
  acquired: Date;
  pid: number;
  release: () => Promise<void>;
}

interface LockMetadata {
  pid: number;
  acquired: string; // ISO timestamp
  hostname: string;
}

const LOCK_DIR_NAME = '.git-lock';
const LOCK_METADATA_FILE = 'lock.json';
const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds
const STALE_LOCK_AGE_MS = 5 * 60 * 1000; // 5 minutes
const RETRY_INTERVAL_MS = 100; // 100ms between lock attempts

/**
 * Get the lock directory path for a worktree
 */
function getLockPath(worktreePath: string): string {
  return join(worktreePath, LOCK_DIR_NAME);
}

/**
 * Get the lock metadata file path
 */
function getMetadataPath(worktreePath: string): string {
  return join(getLockPath(worktreePath), LOCK_METADATA_FILE);
}

/**
 * Read lock metadata from disk
 */
async function readLockMetadata(worktreePath: string): Promise<LockMetadata | null> {
  const metadataPath = getMetadataPath(worktreePath);
  try {
    const content = await readFile(metadataPath, 'utf-8');
    return JSON.parse(content) as LockMetadata;
  } catch {
    return null;
  }
}

/**
 * Write lock metadata to disk
 */
async function writeLockMetadata(worktreePath: string, metadata: LockMetadata): Promise<void> {
  const metadataPath = getMetadataPath(worktreePath);
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
}

/**
 * Check if a lock is stale (older than STALE_LOCK_AGE_MS)
 */
async function isLockStale(worktreePath: string): Promise<boolean> {
  const lockPath = getLockPath(worktreePath);

  try {
    const stats = await stat(lockPath);
    const ageMs = Date.now() - stats.mtimeMs;
    return ageMs > STALE_LOCK_AGE_MS;
  } catch {
    // Lock doesn't exist
    return false;
  }
}

/**
 * Check if the process holding the lock is still alive
 */
function isProcessAlive(pid: number): boolean {
  try {
    // Sending signal 0 tests if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempt to acquire the lock once
 */
async function tryAcquireLock(worktreePath: string): Promise<boolean> {
  const lockPath = getLockPath(worktreePath);

  try {
    // mkdir with recursive: false acts as atomic lock
    await mkdir(lockPath, { recursive: false });

    // Write metadata
    const metadata: LockMetadata = {
      pid: process.pid,
      acquired: new Date().toISOString(),
      hostname: process.env.HOSTNAME ?? 'unknown',
    };
    await writeLockMetadata(worktreePath, metadata);

    return true;
  } catch (error) {
    // EEXIST means lock already exists
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

/**
 * Release a lock
 */
async function doReleaseLock(worktreePath: string): Promise<void> {
  const lockPath = getLockPath(worktreePath);

  try {
    // Remove the lock directory and its contents
    await rm(lockPath, { recursive: true, force: true });
  } catch {
    // Ignore errors during release (lock may already be removed)
  }
}

/**
 * Try to clean up a stale lock
 */
async function tryCleanupStaleLock(worktreePath: string): Promise<boolean> {
  // Check if lock exists
  const lockPath = getLockPath(worktreePath);
  if (!existsSync(lockPath)) {
    return true; // No lock to clean up
  }

  // Check if lock is stale by age
  const staleByAge = await isLockStale(worktreePath);

  // Check if owning process is dead
  const metadata = await readLockMetadata(worktreePath);
  const staleByProcess = metadata ? !isProcessAlive(metadata.pid) : true;

  if (staleByAge || staleByProcess) {
    await doReleaseLock(worktreePath);
    return true;
  }

  return false;
}

/**
 * Acquire exclusive lock for git operations
 *
 * @param worktreePath - Path to the worktree
 * @param timeout - Maximum time to wait for lock in milliseconds (default: 30s)
 * @returns LockHandle on success
 * @throws Error if timeout exceeded
 */
export async function acquireLock(
  worktreePath: string,
  timeout: number = DEFAULT_TIMEOUT_MS
): Promise<LockHandle> {
  const startTime = Date.now();

  while (true) {
    // Try to acquire lock
    if (await tryAcquireLock(worktreePath)) {
      const acquired = new Date();

      // Create release function with cleanup
      const release = async (): Promise<void> => {
        await doReleaseLock(worktreePath);
      };

      // Set up signal handlers for cleanup on unexpected exit
      const cleanup = () => {
        doReleaseLock(worktreePath).catch(() => {});
      };
      process.once('exit', cleanup);
      process.once('SIGINT', cleanup);
      process.once('SIGTERM', cleanup);

      return {
        path: getLockPath(worktreePath),
        acquired,
        pid: process.pid,
        release: async () => {
          // Remove signal handlers
          process.removeListener('exit', cleanup);
          process.removeListener('SIGINT', cleanup);
          process.removeListener('SIGTERM', cleanup);
          await release();
        },
      };
    }

    // Try to clean up stale lock
    await tryCleanupStaleLock(worktreePath);

    // Check timeout
    const elapsed = Date.now() - startTime;
    if (elapsed >= timeout) {
      const metadata = await readLockMetadata(worktreePath);
      const ownerInfo = metadata
        ? `Lock held by PID ${metadata.pid} since ${metadata.acquired}`
        : 'Unknown lock owner';
      throw new Error(
        `Failed to acquire git lock after ${timeout}ms. ${ownerInfo}. ` +
          `Lock path: ${getLockPath(worktreePath)}`
      );
    }

    // Wait before retrying
    await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
  }
}

/**
 * Release an acquired lock
 *
 * @param handle - The lock handle from acquireLock
 */
export async function releaseLock(handle: LockHandle): Promise<void> {
  await handle.release();
}

/**
 * Execute a function while holding the git lock
 *
 * @param worktreePath - Path to the worktree
 * @param fn - Function to execute while holding lock
 * @param timeout - Maximum time to wait for lock in milliseconds
 * @returns The return value of fn
 */
export async function withLock<T>(
  worktreePath: string,
  fn: () => Promise<T>,
  timeout?: number
): Promise<T> {
  const handle = await acquireLock(worktreePath, timeout);
  try {
    return await fn();
  } finally {
    await releaseLock(handle);
  }
}

/**
 * Check if a lock is currently held for the worktree
 *
 * @param worktreePath - Path to the worktree
 * @returns true if lock is held (and not stale)
 */
export async function isLocked(worktreePath: string): Promise<boolean> {
  const lockPath = getLockPath(worktreePath);

  if (!existsSync(lockPath)) {
    return false;
  }

  // Check if lock is stale
  const staleByAge = await isLockStale(worktreePath);
  if (staleByAge) {
    return false;
  }

  // Check if owning process is alive
  const metadata = await readLockMetadata(worktreePath);
  if (metadata && !isProcessAlive(metadata.pid)) {
    return false;
  }

  return true;
}

/**
 * Force release a lock (use with caution)
 *
 * This should only be used for manual cleanup, not during normal operation.
 *
 * @param worktreePath - Path to the worktree
 */
export async function forceReleaseLock(worktreePath: string): Promise<void> {
  await doReleaseLock(worktreePath);
}

/**
 * Get information about the current lock holder
 *
 * @param worktreePath - Path to the worktree
 * @returns Lock metadata or null if not locked
 */
export async function getLockInfo(
  worktreePath: string
): Promise<{ pid: number; acquired: Date; hostname: string } | null> {
  const metadata = await readLockMetadata(worktreePath);
  if (!metadata) {
    return null;
  }

  return {
    pid: metadata.pid,
    acquired: new Date(metadata.acquired),
    hostname: metadata.hostname,
  };
}
