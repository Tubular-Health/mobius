/**
 * Execution state module for TUI file watching
 *
 * Handles reading, parsing, and watching the execution state file
 * (~/.mobius/state/<parent-id>.json) for TUI monitoring.
 *
 * Uses fs.watch() for instant file change detection with debouncing.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ActiveTask, CompletedTask, ExecutionState } from '../types.js';

/** Lock file timeout in milliseconds - how long to wait for lock acquisition */
const LOCK_TIMEOUT_MS = 5000;

/** Lock retry interval in milliseconds */
const LOCK_RETRY_INTERVAL_MS = 10;

/** Default state directory */
const DEFAULT_STATE_DIR = join(homedir(), '.mobius', 'state');

/** Debounce timeout in milliseconds - higher value reduces flickering */
const DEBOUNCE_MS = 150;

/**
 * Check if new active tasks were added (significant change that needs immediate update)
 * This ensures the TUI shows tasks as active even if they complete quickly
 */
function hasNewActiveTasks(
  oldState: ExecutionState | null,
  newState: ExecutionState | null
): boolean {
  if (!newState || !newState.activeTasks.length) return false;
  if (!oldState) return newState.activeTasks.length > 0;

  // Check if there are any new task IDs in activeTasks
  const oldIds = new Set(oldState.activeTasks.map(t => t.id));
  return newState.activeTasks.some(t => !oldIds.has(t.id));
}

/**
 * Get the state directory path
 */
export function getStateDir(stateDir?: string): string {
  return stateDir ?? DEFAULT_STATE_DIR;
}

/**
 * Get the state file path for a parent issue
 *
 * @param parentId - Parent issue identifier (e.g., "MOB-11")
 * @param stateDir - Optional custom state directory
 * @returns Full path to the state file
 */
export function getStateFilePath(parentId: string, stateDir?: string): string {
  return join(getStateDir(stateDir), `${parentId}.json`);
}

/**
 * Ensure the state directory exists, creating it if needed
 *
 * @param stateDir - Optional custom state directory
 * @returns The state directory path
 */
export function ensureStateDir(stateDir?: string): string {
  const dir = getStateDir(stateDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Validate that an object is a valid ActiveTask
 */
function isValidActiveTask(obj: unknown): obj is ActiveTask {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const task = obj as Record<string, unknown>;

  if (typeof task.id !== 'string') return false;
  if (typeof task.pid !== 'number') return false;
  if (typeof task.pane !== 'string') return false;
  if (typeof task.startedAt !== 'string') return false;

  // Optional worktree field
  if (task.worktree !== undefined && typeof task.worktree !== 'string') {
    return false;
  }

  return true;
}

/**
 * Validate that an object is a valid CompletedTask
 */
function isValidCompletedTask(obj: unknown): obj is CompletedTask {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const task = obj as Record<string, unknown>;

  if (typeof task.id !== 'string') return false;
  if (typeof task.completedAt !== 'string') return false;
  if (typeof task.duration !== 'number') return false;

  return true;
}

/**
 * Validate that a completed/failed task entry is valid (string or CompletedTask)
 */
function isValidCompletedTaskEntry(item: unknown): item is string | CompletedTask {
  return typeof item === 'string' || isValidCompletedTask(item);
}

/**
 * Normalize a completed task entry to CompletedTask format
 * For backward compatibility with legacy string format
 */
export function normalizeCompletedTask(entry: string | CompletedTask): CompletedTask {
  if (typeof entry === 'string') {
    // Legacy format - no duration info available
    return {
      id: entry,
      completedAt: new Date().toISOString(),
      duration: 0,
    };
  }
  return entry;
}

/**
 * Get the task ID from a completed task entry (string or CompletedTask)
 */
export function getCompletedTaskId(entry: string | CompletedTask): string {
  return typeof entry === 'string' ? entry : entry.id;
}

/**
 * Validate that an object has the required ExecutionState fields
 */
function isValidExecutionState(obj: unknown): obj is ExecutionState {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const state = obj as Record<string, unknown>;

  // Required string fields
  if (typeof state.parentId !== 'string') return false;
  if (typeof state.parentTitle !== 'string') return false;
  if (typeof state.startedAt !== 'string') return false;
  if (typeof state.updatedAt !== 'string') return false;

  // Required array fields
  if (!Array.isArray(state.activeTasks)) return false;
  if (!Array.isArray(state.completedTasks)) return false;
  if (!Array.isArray(state.failedTasks)) return false;

  // Validate activeTasks items
  for (const task of state.activeTasks) {
    if (!isValidActiveTask(task)) return false;
  }

  // Validate completedTasks and failedTasks (accept both string and CompletedTask)
  for (const entry of state.completedTasks) {
    if (!isValidCompletedTaskEntry(entry)) return false;
  }
  for (const entry of state.failedTasks) {
    if (!isValidCompletedTaskEntry(entry)) return false;
  }

  return true;
}

/**
 * Read and parse the execution state file
 *
 * @param parentId - The parent issue identifier (e.g., "MOB-11")
 * @param stateDir - Optional state directory path
 * @returns The parsed ExecutionState or null if file doesn't exist or is invalid
 */
export function readExecutionState(
  parentId: string,
  stateDir?: string
): ExecutionState | null {
  const filePath = getStateFilePath(parentId, stateDir);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);

    if (!isValidExecutionState(parsed)) {
      console.warn(`Invalid execution state file: ${filePath}`);
      return null;
    }

    return parsed;
  } catch (error) {
    // Handle JSON parse errors and file read errors
    if (error instanceof SyntaxError) {
      console.warn(`Malformed JSON in state file: ${filePath}`);
    } else if (error instanceof Error) {
      console.warn(`Error reading state file: ${error.message}`);
    }
    return null;
  }
}

/**
 * Write execution state to the state file
 *
 * @param state - The execution state to write
 * @param stateDir - Optional custom state directory
 */
export function writeExecutionState(
  state: ExecutionState,
  stateDir?: string
): void {
  ensureStateDir(stateDir);
  const filePath = getStateFilePath(state.parentId, stateDir);

  // Update the updatedAt timestamp
  const stateWithTimestamp: ExecutionState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };

  // Atomic write: write to temp file first, then rename
  // This prevents readers from seeing partial/corrupted JSON
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(stateWithTimestamp, null, 2), 'utf-8');
  renameSync(tmpPath, filePath);
}

/**
 * Get the lock file path for a state file
 *
 * @param filePath - Path to the state file
 * @returns Path to the lock file
 */
function getLockFilePath(filePath: string): string {
  return `${filePath}.lock`;
}

/**
 * Check if a lock file is stale (older than timeout)
 *
 * @param lockPath - Path to the lock file
 * @returns true if lock is stale and can be forcibly acquired
 */
function isLockStale(lockPath: string): boolean {
  try {
    const content = readFileSync(lockPath, 'utf-8');
    const lockTime = parseInt(content, 10);
    if (isNaN(lockTime)) return true;
    return Date.now() - lockTime > LOCK_TIMEOUT_MS;
  } catch {
    // Lock file doesn't exist or can't be read - consider it stale
    return true;
  }
}

/**
 * Attempt to acquire an exclusive lock on the state file
 *
 * Uses a simple lock file mechanism with timestamp for stale lock detection.
 *
 * @param filePath - Path to the state file to lock
 * @returns true if lock was acquired, false otherwise
 */
function tryAcquireLock(filePath: string): boolean {
  const lockPath = getLockFilePath(filePath);

  try {
    // Check if lock file exists
    if (existsSync(lockPath)) {
      // Check if it's stale (process crashed without releasing)
      if (isLockStale(lockPath)) {
        // Force remove stale lock
        try {
          unlinkSync(lockPath);
        } catch {
          // Another process may have removed it, continue
        }
      } else {
        // Lock is held by another process
        return false;
      }
    }

    // Try to create lock file with exclusive flag
    // Write current timestamp for stale detection
    writeFileSync(lockPath, Date.now().toString(), { flag: 'wx' });
    return true;
  } catch {
    // Lock file was created by another process between our check and write
    return false;
  }
}

/**
 * Release the lock on a state file
 *
 * @param filePath - Path to the state file to unlock
 */
function releaseLock(filePath: string): void {
  const lockPath = getLockFilePath(filePath);
  try {
    unlinkSync(lockPath);
  } catch {
    // Lock may have been force-removed due to staleness, ignore
  }
}

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Acquire a lock with retry and timeout
 *
 * @param filePath - Path to the state file to lock
 * @returns Promise that resolves when lock is acquired
 * @throws Error if lock cannot be acquired within timeout
 */
async function acquireLock(filePath: string): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < LOCK_TIMEOUT_MS) {
    if (tryAcquireLock(filePath)) {
      return;
    }
    await sleep(LOCK_RETRY_INTERVAL_MS);
  }

  throw new Error(`Failed to acquire lock on ${filePath} within ${LOCK_TIMEOUT_MS}ms`);
}

/**
 * Execute a state mutation atomically with read-modify-write pattern
 *
 * This function:
 * 1. Acquires an exclusive lock on the state file
 * 2. Reads the current state from disk
 * 3. Applies the mutation function to get the new state
 * 4. Writes the new state atomically (tmp file + rename)
 * 5. Releases the lock
 *
 * This ensures that concurrent state updates don't lose changes.
 *
 * @param parentId - Parent issue identifier (e.g., "MOB-11")
 * @param mutate - Function that takes current state and returns new state
 * @param stateDir - Optional custom state directory
 * @returns The new state after mutation
 * @throws Error if lock cannot be acquired or mutation fails
 */
export async function withExecutionState(
  parentId: string,
  mutate: (state: ExecutionState | null) => ExecutionState,
  stateDir?: string
): Promise<ExecutionState> {
  ensureStateDir(stateDir);
  const filePath = getStateFilePath(parentId, stateDir);

  await acquireLock(filePath);

  try {
    // Read current state (may be null if file doesn't exist)
    const currentState = readExecutionState(parentId, stateDir);

    // Apply mutation
    const newState = mutate(currentState);

    // Write atomically
    writeExecutionState(newState, stateDir);

    return newState;
  } finally {
    releaseLock(filePath);
  }
}

/**
 * Synchronous version of withExecutionState for backwards compatibility
 *
 * Uses busy-wait for lock acquisition. Prefer the async version when possible.
 *
 * @param parentId - Parent issue identifier (e.g., "MOB-11")
 * @param mutate - Function that takes current state and returns new state
 * @param stateDir - Optional custom state directory
 * @returns The new state after mutation
 * @throws Error if lock cannot be acquired or mutation fails
 */
export function withExecutionStateSync(
  parentId: string,
  mutate: (state: ExecutionState | null) => ExecutionState,
  stateDir?: string
): ExecutionState {
  ensureStateDir(stateDir);
  const filePath = getStateFilePath(parentId, stateDir);
  const startTime = Date.now();

  // Busy-wait for lock acquisition
  while (Date.now() - startTime < LOCK_TIMEOUT_MS) {
    if (tryAcquireLock(filePath)) {
      try {
        // Read current state (may be null if file doesn't exist)
        const currentState = readExecutionState(parentId, stateDir);

        // Apply mutation
        const newState = mutate(currentState);

        // Write atomically
        writeExecutionState(newState, stateDir);

        return newState;
      } finally {
        releaseLock(filePath);
      }
    }

    // Busy wait - use a small delay to reduce CPU usage
    const endTime = Date.now() + LOCK_RETRY_INTERVAL_MS;
    while (Date.now() < endTime) {
      // Spin
    }
  }

  throw new Error(`Failed to acquire lock on ${filePath} within ${LOCK_TIMEOUT_MS}ms`);
}

/**
 * Initialize a new execution state for a parent issue
 *
 * @param parentId - Parent issue identifier (e.g., "MOB-11")
 * @param parentTitle - Parent issue title for display
 * @param options - Optional configuration
 * @param options.stateDir - Custom state directory
 * @param options.loopPid - PID of the loop process
 * @param options.totalTasks - Total number of tasks
 * @returns The initialized execution state
 */
export function initializeExecutionState(
  parentId: string,
  parentTitle: string,
  options?: {
    stateDir?: string;
    loopPid?: number;
    totalTasks?: number;
  }
): ExecutionState {
  const now = new Date().toISOString();

  const state: ExecutionState = {
    parentId,
    parentTitle,
    activeTasks: [],
    completedTasks: [],
    failedTasks: [],
    startedAt: now,
    updatedAt: now,
    loopPid: options?.loopPid,
    totalTasks: options?.totalTasks,
  };

  writeExecutionState(state, options?.stateDir);
  return state;
}

/**
 * Update execution state with a task starting
 *
 * Uses atomic read-modify-write to prevent race conditions in concurrent scenarios.
 * The passed state is used for parentId extraction only; fresh state is read from disk.
 */
export function addActiveTask(
  state: ExecutionState,
  task: ActiveTask,
  stateDir?: string
): ExecutionState {
  return withExecutionStateSync(
    state.parentId,
    (currentState) => {
      // Use fresh state from disk, falling back to passed state if file doesn't exist
      const baseState = currentState ?? state;
      return {
        ...baseState,
        activeTasks: [...baseState.activeTasks, task],
      };
    },
    stateDir
  );
}

/**
 * Update execution state when a task completes
 *
 * Uses atomic read-modify-write to prevent race conditions in concurrent scenarios.
 * The passed state is used for parentId extraction only; fresh state is read from disk.
 */
export function completeTask(
  state: ExecutionState,
  taskId: string,
  stateDir?: string
): ExecutionState {
  return withExecutionStateSync(
    state.parentId,
    (currentState) => {
      // Use fresh state from disk, falling back to passed state if file doesn't exist
      const baseState = currentState ?? state;
      const now = new Date();
      const activeTask = baseState.activeTasks.find(t => t.id === taskId);

      // Calculate duration from task start time
      const duration = activeTask
        ? now.getTime() - new Date(activeTask.startedAt).getTime()
        : 0;

      const completedTask: CompletedTask = {
        id: taskId,
        completedAt: now.toISOString(),
        duration,
      };

      return {
        ...baseState,
        activeTasks: baseState.activeTasks.filter(t => t.id !== taskId),
        completedTasks: [...baseState.completedTasks, completedTask],
      };
    },
    stateDir
  );
}

/**
 * Update execution state when a task fails
 *
 * Uses atomic read-modify-write to prevent race conditions in concurrent scenarios.
 * The passed state is used for parentId extraction only; fresh state is read from disk.
 */
export function failTask(
  state: ExecutionState,
  taskId: string,
  stateDir?: string
): ExecutionState {
  return withExecutionStateSync(
    state.parentId,
    (currentState) => {
      // Use fresh state from disk, falling back to passed state if file doesn't exist
      const baseState = currentState ?? state;
      const now = new Date();
      const activeTask = baseState.activeTasks.find(t => t.id === taskId);

      // Calculate duration from task start time
      const duration = activeTask
        ? now.getTime() - new Date(activeTask.startedAt).getTime()
        : 0;

      const failedTask: CompletedTask = {
        id: taskId,
        completedAt: now.toISOString(),
        duration,
      };

      return {
        ...baseState,
        activeTasks: baseState.activeTasks.filter(t => t.id !== taskId),
        failedTasks: [...baseState.failedTasks, failedTask],
      };
    },
    stateDir
  );
}

/**
 * Remove active task without marking as completed or failed (for retries)
 *
 * Uses atomic read-modify-write to prevent race conditions in concurrent scenarios.
 * The passed state is used for parentId extraction only; fresh state is read from disk.
 */
export function removeActiveTask(
  state: ExecutionState,
  taskId: string,
  stateDir?: string
): ExecutionState {
  return withExecutionStateSync(
    state.parentId,
    (currentState) => {
      // Use fresh state from disk, falling back to passed state if file doesn't exist
      const baseState = currentState ?? state;
      return {
        ...baseState,
        activeTasks: baseState.activeTasks.filter(t => t.id !== taskId),
      };
    },
    stateDir
  );
}

/**
 * Update the pane ID of an active task
 *
 * Used to set the real tmux pane ID after executeParallel() returns,
 * replacing the initial empty string placeholder.
 *
 * Uses atomic read-modify-write to prevent race conditions in concurrent scenarios.
 * The passed state is used for parentId extraction only; fresh state is read from disk.
 *
 * @param state - Current execution state
 * @param taskId - Task identifier (e.g., "MOB-124")
 * @param paneId - The real tmux pane ID (e.g., "%0", "%1")
 * @param stateDir - Optional custom state directory
 * @returns Updated execution state
 */
export function updateActiveTaskPane(
  state: ExecutionState,
  taskId: string,
  paneId: string,
  stateDir?: string
): ExecutionState {
  return withExecutionStateSync(
    state.parentId,
    (currentState) => {
      // Use fresh state from disk, falling back to passed state if file doesn't exist
      const baseState = currentState ?? state;
      return {
        ...baseState,
        activeTasks: baseState.activeTasks.map(task =>
          task.id === taskId ? { ...task, pane: paneId } : task
        ),
      };
    },
    stateDir
  );
}

/**
 * Compare active task arrays for equality (by id and startedAt)
 */
function activeTasksEqual(a: ActiveTask[], b: ActiveTask[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].startedAt !== b[i].startedAt) {
      return false;
    }
  }
  return true;
}

/**
 * Compare completed/failed task arrays for equality (by id)
 */
function completedTasksEqual(
  a: (string | CompletedTask)[],
  b: (string | CompletedTask)[]
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const aId = getCompletedTaskId(a[i]);
    const bId = getCompletedTaskId(b[i]);
    if (aId !== bId) return false;
  }
  return true;
}

/**
 * Check if execution state content has actually changed
 * Ignores updatedAt timestamp to prevent unnecessary re-renders
 */
function hasContentChanged(
  oldState: ExecutionState | null,
  newState: ExecutionState | null
): boolean {
  // Handle null cases
  if (oldState === null && newState === null) return false;
  if (oldState === null || newState === null) return true;

  // Compare actual content, not timestamps
  if (!activeTasksEqual(oldState.activeTasks, newState.activeTasks)) return true;
  if (!completedTasksEqual(oldState.completedTasks, newState.completedTasks)) return true;
  if (!completedTasksEqual(oldState.failedTasks, newState.failedTasks)) return true;

  // Check loopPid change (for exit handling)
  if (oldState.loopPid !== newState.loopPid) return true;

  return false;
}

/**
 * Watch the execution state file for changes
 *
 * Uses fs.watch() for instant file change detection with 50ms debouncing.
 * Calls the callback with the new state on each change.
 *
 * @param parentId - The parent issue identifier (e.g., "MOB-11")
 * @param callback - Function called with new state (or null) on each change
 * @param stateDir - Optional state directory path
 * @returns Cleanup function to stop watching
 */
export function watchExecutionState(
  parentId: string,
  callback: (state: ExecutionState | null) => void,
  stateDir?: string
): () => void {
  const dir = getStateDir(stateDir);
  const fileName = `${parentId}.json`;

  // Ensure directory exists for watching
  ensureStateDir(stateDir);

  let watcher: FSWatcher | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastState: ExecutionState | null = null;

  // Initial read
  lastState = readExecutionState(parentId, stateDir);
  callback(lastState);

  // Watch the directory for changes to our file
  try {
    watcher = watch(dir, (_eventType, changedFileName) => {
      // Only react to changes to our specific file
      if (changedFileName !== fileName) {
        return;
      }

      // Read state immediately to check for significant changes
      const newState = readExecutionState(parentId, stateDir);

      // Fast path: immediately notify for new active tasks (ensures TUI shows tasks
      // even if they complete quickly, before debounce fires)
      if (hasNewActiveTasks(lastState, newState)) {
        // Cancel any pending debounced update since we're updating now
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        lastState = newState;
        callback(newState);
        return;
      }

      // Debounce other changes (completions, failures, timestamp updates)
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        // Re-read state in case it changed during debounce
        const currentState = readExecutionState(parentId, stateDir);

        // Only call callback if actual content changed (not just updatedAt timestamp)
        // This prevents unnecessary re-renders when only the timestamp changes
        if (hasContentChanged(lastState, currentState)) {
          lastState = currentState;
          callback(currentState);
        }
      }, DEBOUNCE_MS);
    });
  } catch (error) {
    console.warn(`Failed to watch state directory: ${dir}`, error);
  }

  // Return cleanup function
  return () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  };
}

/**
 * Check if a process is still running by PID
 *
 * @param pid - Process ID to check
 * @returns true if the process is running, false otherwise
 */
export function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without affecting it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Filter active tasks to only include those with running processes
 *
 * Useful for handling stale state from crashed agents.
 *
 * @param activeTasks - Array of active tasks from state
 * @returns Array of active tasks with valid running PIDs
 */
export function filterRunningTasks(activeTasks: ActiveTask[]): ActiveTask[] {
  return activeTasks.filter(task => isProcessRunning(task.pid));
}

/**
 * Get execution progress summary
 */
export function getProgressSummary(state: ExecutionState | null): {
  completed: number;
  failed: number;
  active: number;
  total: number;
  isComplete: boolean;
} {
  if (!state) {
    return { completed: 0, failed: 0, active: 0, total: 0, isComplete: false };
  }

  const completed = state.completedTasks.length;
  const failed = state.failedTasks.length;
  const active = state.activeTasks.length;
  const total = completed + failed + active;

  // Complete when no active tasks and at least one completed or failed
  const isComplete = active === 0 && (completed > 0 || failed > 0);

  return { completed, failed, active, total, isComplete };
}
