/**
 * Execution state module for TUI file watching
 *
 * Handles reading, parsing, and watching the execution state file
 * (~/.mobius/state/<parent-id>.json) for TUI monitoring.
 *
 * Uses fs.watch() for instant file change detection with debouncing.
 */

import { existsSync, mkdirSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ActiveTask, ExecutionState } from '../types.js';

/** Default state directory */
const DEFAULT_STATE_DIR = join(homedir(), '.mobius', 'state');

/** Debounce timeout in milliseconds */
const DEBOUNCE_MS = 50;

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

  // Validate completedTasks and failedTasks are string arrays
  for (const id of state.completedTasks) {
    if (typeof id !== 'string') return false;
  }
  for (const id of state.failedTasks) {
    if (typeof id !== 'string') return false;
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

      // Debounce rapid changes
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        const newState = readExecutionState(parentId, stateDir);

        // Only call callback if state actually changed
        // (compare by updatedAt timestamp to avoid unnecessary re-renders)
        if (newState?.updatedAt !== lastState?.updatedAt || newState === null !== (lastState === null)) {
          lastState = newState;
          callback(newState);
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
