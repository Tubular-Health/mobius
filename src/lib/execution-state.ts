/**
 * Execution state module for TUI file watching
 *
 * Handles reading, parsing, and watching the execution state file
 * (~/.mobius/state/<parent-id>.json). Uses fs.watch() for instant
 * file change detection with 50ms debouncing.
 */

import { existsSync, mkdirSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ExecutionState } from '../types.js';

/** Default state directory location */
const DEFAULT_STATE_DIR = join(homedir(), '.mobius', 'state');

/** Debounce timeout for file watch events (ms) */
const DEBOUNCE_MS = 50;

/**
 * Get the state directory path
 *
 * @param stateDir - Optional custom state directory
 * @returns The resolved state directory path
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
  const dir = getStateDir(stateDir);
  return join(dir, `${parentId}.json`);
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
 * Validate that an object conforms to the ExecutionState schema
 */
function isValidExecutionState(obj: unknown): obj is ExecutionState {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  const state = obj as Record<string, unknown>;

  // Required string fields
  if (typeof state.parentId !== 'string' || state.parentId === '') {
    return false;
  }
  if (typeof state.parentTitle !== 'string') {
    return false;
  }
  if (typeof state.startedAt !== 'string') {
    return false;
  }
  if (typeof state.updatedAt !== 'string') {
    return false;
  }

  // Required array fields
  if (!Array.isArray(state.activeTasks)) {
    return false;
  }
  if (!Array.isArray(state.completedTasks)) {
    return false;
  }
  if (!Array.isArray(state.failedTasks)) {
    return false;
  }

  // Validate activeTasks array items
  for (const task of state.activeTasks) {
    if (!task || typeof task !== 'object') {
      return false;
    }
    const activeTask = task as Record<string, unknown>;
    if (typeof activeTask.id !== 'string') {
      return false;
    }
    if (typeof activeTask.pid !== 'number') {
      return false;
    }
    if (typeof activeTask.pane !== 'string') {
      return false;
    }
    if (typeof activeTask.startedAt !== 'string') {
      return false;
    }
  }

  // Validate completedTasks and failedTasks are arrays of strings
  for (const taskId of state.completedTasks) {
    if (typeof taskId !== 'string') {
      return false;
    }
  }
  for (const taskId of state.failedTasks) {
    if (typeof taskId !== 'string') {
      return false;
    }
  }

  return true;
}

/**
 * Read and parse the execution state file
 *
 * @param parentId - Parent issue identifier (e.g., "MOB-11")
 * @param stateDir - Optional custom state directory
 * @returns Parsed ExecutionState or null if file doesn't exist or is invalid
 */
export function readExecutionState(parentId: string, stateDir?: string): ExecutionState | null {
  const filePath = getStateFilePath(parentId, stateDir);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);

    if (!isValidExecutionState(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    // JSON parse error or file read error
    return null;
  }
}

/**
 * Watch the execution state file for changes
 *
 * Uses fs.watch() for instant file change detection with debouncing
 * to handle rapid file updates.
 *
 * @param parentId - Parent issue identifier (e.g., "MOB-11")
 * @param callback - Function called with new state (or null) on each change
 * @param stateDir - Optional custom state directory
 * @returns Cleanup function to stop watching
 */
export function watchExecutionState(
  parentId: string,
  callback: (state: ExecutionState | null) => void,
  stateDir?: string
): () => void {
  const filePath = getStateFilePath(parentId, stateDir);
  const dir = dirname(filePath);

  // Ensure directory exists before watching
  ensureStateDir(stateDir);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;
  let lastState: ExecutionState | null = null;

  const triggerCallback = () => {
    const state = readExecutionState(parentId, stateDir);
    // Only trigger callback if state actually changed
    if (JSON.stringify(state) !== JSON.stringify(lastState)) {
      lastState = state;
      callback(state);
    }
  };

  const handleChange = () => {
    // Debounce rapid file changes
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(triggerCallback, DEBOUNCE_MS);
  };

  // Watch the directory instead of the file directly
  // This handles file creation/deletion scenarios
  try {
    watcher = watch(dir, (_eventType, filename) => {
      if (filename === `${parentId}.json`) {
        handleChange();
      }
    });
  } catch {
    // Directory might not exist yet, that's okay
    // The caller should use ensureStateDir first if they need to create it
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
