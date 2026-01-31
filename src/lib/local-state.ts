/**
 * Local state manager for project-local .mobius/ directory
 *
 * Manages the project-local .mobius/ directory structure including:
 * - Atomic LOC-{N} ID generation via counter.json
 * - Parent/sub-task spec storage
 * - Iteration logging for execution tracking
 * - Pending update queuing for backend sync
 *
 * Uses git repo root detection to ensure .mobius/ is always in the repository root,
 * even when called from nested subdirectories.
 */

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ParentIssueContext, SubTaskContext } from '../types/context.js';
import type { LinearIssue } from './task-graph.js';

/**
 * Entry in the iteration log tracking execution attempts
 */
export interface IterationLogEntry {
  subtaskId: string;
  attempt: number;
  startedAt: string;
  completedAt?: string;
  status: 'success' | 'failed' | 'partial';
  error?: string;
  filesModified?: string[];
  commitHash?: string;
}

/**
 * Completion summary for a finished issue
 */
export interface CompletionSummary {
  parentId: string;
  completedAt: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalIterations: number;
  taskOutcomes: Array<{
    id: string;
    status: string;
    iterations: number;
  }>;
}

/**
 * Pending update entry queued for backend sync
 */
export interface LocalPendingUpdate {
  id: string;
  createdAt: string;
  type: string;
  payload: Record<string, unknown>;
}

// Cache the git repo root to avoid repeated exec calls
let _cachedRepoRoot: string | null = null;

/**
 * Get the git repository root directory
 *
 * Uses `git rev-parse --show-toplevel` to find the repo root.
 * Result is cached for the process lifetime.
 */
function getGitRepoRoot(): string {
  if (_cachedRepoRoot !== null) {
    return _cachedRepoRoot;
  }

  let root: string;
  try {
    const result = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    root = result.trim();
  } catch {
    // Fallback to cwd if not in a git repo
    root = process.cwd();
  }

  _cachedRepoRoot = root;
  return root;
}

/**
 * Get the absolute path to the project-local .mobius/ directory
 *
 * Always returns the path relative to the git repository root,
 * regardless of the current working directory.
 */
export function getProjectMobiusPath(): string {
  return join(getGitRepoRoot(), '.mobius');
}

/**
 * Ensure the project-local .mobius/ directory exists with proper structure
 *
 * Creates .mobius/ and a .gitignore file containing `state/` entry
 * to keep runtime state out of version control while preserving specs.
 */
export function ensureProjectMobiusDir(): void {
  const mobiusPath = getProjectMobiusPath();

  if (!existsSync(mobiusPath)) {
    mkdirSync(mobiusPath, { recursive: true });
  }

  const gitignorePath = join(mobiusPath, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, 'state/\n', 'utf-8');
  }
}

/**
 * Get the path to the issues directory within .mobius/
 */
function getIssuesPath(): string {
  return join(getProjectMobiusPath(), 'issues');
}

/**
 * Get the path to a specific issue directory
 */
function getIssuePath(issueId: string): string {
  return join(getIssuesPath(), issueId);
}

/**
 * Ensure the directory structure for a specific issue exists
 */
function ensureIssueDir(issueId: string): void {
  ensureProjectMobiusDir();
  const issuePath = getIssuePath(issueId);
  mkdirSync(join(issuePath, 'tasks'), { recursive: true });
  mkdirSync(join(issuePath, 'execution'), { recursive: true });
}

/**
 * Get the next local ID by atomically incrementing counter.json
 *
 * Returns IDs in LOC-{N} format where N is zero-padded to 3 digits.
 * Uses atomic write (temp file + rename) for the counter file.
 * If counter.json is missing or corrupted, scans existing LOC-* directories
 * to determine the next ID.
 */
export function getNextLocalId(): string {
  ensureProjectMobiusDir();
  const issuesPath = getIssuesPath();
  mkdirSync(issuesPath, { recursive: true });

  const counterPath = join(issuesPath, 'counter.json');
  let nextValue = 1;

  try {
    if (existsSync(counterPath)) {
      const content = readFileSync(counterPath, 'utf-8');
      const parsed = JSON.parse(content);
      if (typeof parsed.next === 'number' && parsed.next > 0) {
        nextValue = parsed.next;
      } else {
        // Corrupted counter - scan directories
        nextValue = scanForNextId(issuesPath);
      }
    } else {
      // No counter file - scan for existing LOC-* directories
      nextValue = scanForNextId(issuesPath);
    }
  } catch {
    // Parse error - scan directories for recovery
    nextValue = scanForNextId(issuesPath);
  }

  // Atomic write: temp file + rename
  const newCounter = { next: nextValue + 1 };
  const tmpPath = `${counterPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(newCounter, null, 2), 'utf-8');
  renameSync(tmpPath, counterPath);

  const padded = String(nextValue).padStart(3, '0');
  return `LOC-${padded}`;
}

/**
 * Scan existing LOC-* directories to determine next ID
 */
function scanForNextId(issuesPath: string): number {
  if (!existsSync(issuesPath)) return 1;

  try {
    const entries = readdirSync(issuesPath, { withFileTypes: true });
    let maxId = 0;

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const match = entry.name.match(/^LOC-(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxId) maxId = num;
        }
      }
    }

    return maxId + 1;
  } catch {
    return 1;
  }
}

/**
 * Write a parent issue spec to .mobius/issues/{issueId}/parent.json
 */
export function writeParentSpec(issueId: string, spec: ParentIssueContext): void {
  ensureIssueDir(issueId);
  const filePath = join(getIssuePath(issueId), 'parent.json');
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(spec, null, 2), 'utf-8');
  renameSync(tmpPath, filePath);
}

/**
 * Read a parent issue spec from .mobius/issues/{issueId}/parent.json
 *
 * Returns null if the file doesn't exist or is corrupted.
 */
export function readParentSpec(issueId: string): ParentIssueContext | null {
  const filePath = join(getIssuePath(issueId), 'parent.json');
  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as ParentIssueContext;
  } catch {
    return null;
  }
}

/**
 * Write a sub-task spec to .mobius/issues/{issueId}/tasks/{taskId}.json
 */
export function writeSubTaskSpec(issueId: string, task: SubTaskContext): void {
  ensureIssueDir(issueId);
  const filePath = join(getIssuePath(issueId), 'tasks', `${task.identifier}.json`);
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(task, null, 2), 'utf-8');
  renameSync(tmpPath, filePath);
}

/**
 * Update just the status field of a sub-task's JSON file on disk.
 *
 * Reads the existing file, patches the status, and writes it back atomically.
 * This ensures syncGraphFromLocal() sees the updated status on the next iteration.
 */
export function updateSubTaskStatus(issueId: string, taskIdentifier: string, status: string): void {
  const filePath = join(getIssuePath(issueId), 'tasks', `${taskIdentifier}.json`);
  if (!existsSync(filePath)) return;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const task = JSON.parse(content) as SubTaskContext;
    task.status = status as SubTaskContext['status'];
    const tmpPath = `${filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(task, null, 2), 'utf-8');
    renameSync(tmpPath, filePath);
  } catch {
    // Non-fatal: in-memory graph still has the correct status
  }
}

/**
 * Read all sub-task specs from .mobius/issues/{issueId}/tasks/
 *
 * Returns an array of all valid sub-task specs found in the tasks directory.
 * Silently skips files that can't be parsed.
 */
export function readSubTasks(issueId: string): SubTaskContext[] {
  const tasksDir = join(getIssuePath(issueId), 'tasks');
  if (!existsSync(tasksDir)) return [];

  const tasks: SubTaskContext[] = [];

  try {
    const files = readdirSync(tasksDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = readFileSync(join(tasksDir, file), 'utf-8');
        tasks.push(JSON.parse(content) as SubTaskContext);
      } catch {
        // Skip malformed files
      }
    }
  } catch {
    return [];
  }

  return tasks;
}

/**
 * Read local sub-tasks and convert to LinearIssue[] for buildTaskGraph()
 *
 * Handles the schema mismatch between refine-written task files (which use
 * string arrays for blockedBy/blocks and omit identifier/gitBranchName) and
 * the LinearIssue format expected by the task graph builder.
 */
export function readLocalSubTasksAsLinearIssues(issueId: string): LinearIssue[] {
  const tasks = readSubTasks(issueId);

  return tasks.map((task) => {
    // Refine writes blockedBy/blocks as string arrays like ["task-002"],
    // but SubTaskContext expects Array<{id, identifier}>. Handle both.
    const rawBlockedBy = (task.blockedBy ?? []) as Array<string | { id: string; identifier: string }>;
    const rawBlocks = (task.blocks ?? []) as Array<string | { id: string; identifier: string }>;

    const blockedBy = rawBlockedBy.map((b) =>
      typeof b === 'string' ? { id: b, identifier: b } : b
    );
    const blocks = rawBlocks.map((b) =>
      typeof b === 'string' ? { id: b, identifier: b } : b
    );

    return {
      id: task.id,
      identifier: task.identifier ?? task.id,
      title: task.title,
      status: task.status,
      gitBranchName: task.gitBranchName ?? '',
      relations: { blockedBy, blocks },
    };
  });
}

/**
 * Read all iteration log entries from .mobius/issues/{issueId}/execution/iterations.json
 *
 * Returns an empty array if the file doesn't exist or is corrupted.
 */
export function readIterationLog(issueId: string): IterationLogEntry[] {
  const filePath = join(getIssuePath(issueId), 'execution', 'iterations.json');
  if (!existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed as IterationLogEntry[];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Write an iteration log entry to .mobius/issues/{issueId}/execution/iterations.json
 *
 * Appends the entry to the existing array, or creates a new array if the file doesn't exist.
 */
export function writeIterationLog(issueId: string, entry: IterationLogEntry): void {
  ensureIssueDir(issueId);
  const filePath = join(getIssuePath(issueId), 'execution', 'iterations.json');

  let entries: IterationLogEntry[] = [];
  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        entries = parsed;
      }
    } catch {
      // Start fresh if corrupted
    }
  }

  entries.push(entry);

  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
  renameSync(tmpPath, filePath);
}

/**
 * Write a completion summary to .mobius/issues/{issueId}/summary.json
 */
export function writeSummary(issueId: string, summary: CompletionSummary): void {
  ensureIssueDir(issueId);
  const filePath = join(getIssuePath(issueId), 'summary.json');
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(summary, null, 2), 'utf-8');
  renameSync(tmpPath, filePath);
}

/**
 * Queue a pending update for backend sync
 *
 * Appends an update entry with a UUID and timestamp to
 * .mobius/issues/{issueId}/pending-updates.json
 */
export function queuePendingUpdate(
  issueId: string,
  type: string,
  payload: Record<string, unknown>
): void {
  ensureIssueDir(issueId);
  const filePath = join(getIssuePath(issueId), 'pending-updates.json');

  let updates: LocalPendingUpdate[] = [];
  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        updates = parsed;
      }
    } catch {
      // Start fresh if corrupted
    }
  }

  updates.push({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    type,
    payload,
  });

  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(updates, null, 2), 'utf-8');
  renameSync(tmpPath, filePath);
}

/**
 * Reset the cached repo root (useful for testing)
 */
export function _resetCachedRepoRoot(): void {
  _cachedRepoRoot = null;
}
