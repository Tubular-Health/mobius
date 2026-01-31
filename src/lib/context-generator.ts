/**
 * Context generator module for local issue context
 *
 * Generates and manages local context files for skills. Fetches issue data
 * via SDK and writes to project-local .mobius/issues/{parentId}/. Supports
 * Linear, Jira, and local backends based on configuration.
 */

import {
  existsSync,
  type FSWatcher,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  ContextMetadata,
  IssueContext,
  ParentIssueContext,
  PendingUpdate,
  PendingUpdatesQueue,
  RuntimeActiveTask,
  RuntimeCompletedTask,
  RuntimeState,
  SessionInfo,
  SubTaskContext,
} from '../types/context.js';
import type { Backend } from '../types.js';
import { readConfig } from './config.js';
import { debugLog } from './debug-logger.js';
import { fetchJiraIssue, fetchJiraSubTasks } from './jira.js';
import { fetchLinearIssue, fetchLinearSubTasks } from './linear.js';
import { ensureProjectMobiusDir, getProjectMobiusPath } from './local-state.js';
import { mapLinearStatus } from './task-graph.js';

/**
 * Get the base path for all mobius context storage
 *
 * Returns the project-local .mobius/ directory path (in the git repo root)
 * instead of the legacy ~/.mobius/ path. All derived path functions use this
 * as their base, so they automatically inherit the new behavior.
 */
export function getMobiusBasePath(): string {
  return getProjectMobiusPath();
}

/**
 * Get the path for a specific parent issue's context directory
 *
 * @param parentId - The parent issue identifier (e.g., "MOB-161")
 * @returns Path to the context directory
 */
export function getContextPath(parentId: string): string {
  return join(getMobiusBasePath(), 'issues', parentId);
}

/**
 * Get the path to the parent.json file
 */
export function getParentContextPath(parentId: string): string {
  return join(getContextPath(parentId), 'parent.json');
}

/**
 * Get the path to the tasks directory
 */
export function getTasksDirectoryPath(parentId: string): string {
  return join(getContextPath(parentId), 'tasks');
}

/**
 * Get the path to a specific task's context file
 */
export function getTaskContextPath(parentId: string, taskIdentifier: string): string {
  return join(getTasksDirectoryPath(parentId), `${taskIdentifier}.json`);
}

/**
 * Get the path to the pending-updates.json file
 */
export function getPendingUpdatesPath(parentId: string): string {
  return join(getContextPath(parentId), 'pending-updates.json');
}

/**
 * Get the path to the sync-log.json file
 */
export function getSyncLogPath(parentId: string): string {
  return join(getContextPath(parentId), 'sync-log.json');
}

/**
 * Get the path to the full context.json file (used by skills via MOBIUS_CONTEXT_FILE)
 */
export function getFullContextPath(parentId: string): string {
  return join(getContextPath(parentId), 'context.json');
}

/**
 * Write the full context to a single JSON file for skills to read
 *
 * Skills read this file via the MOBIUS_CONTEXT_FILE environment variable.
 * This consolidates parent, sub-tasks, and metadata into one file.
 *
 * @param parentIdentifier - The parent issue identifier
 * @param context - The IssueContext to write
 * @returns The path to the written context file
 */
export function writeFullContextFile(parentIdentifier: string, context: IssueContext): string {
  ensureContextDirectories(parentIdentifier);
  const contextFilePath = getFullContextPath(parentIdentifier);
  writeFileSync(contextFilePath, JSON.stringify(context, null, 2), 'utf-8');
  return contextFilePath;
}

/**
 * Detect the backend from configuration
 *
 * Checks in order:
 * 1. Local project mobius.config.yaml
 * 2. Global ~/.config/mobius/config.yaml
 * 3. Falls back to 'linear' as default
 */
export function detectBackend(projectPath?: string): Backend {
  // Try local project config first
  if (projectPath) {
    const localConfigPath = join(projectPath, 'mobius.config.yaml');
    if (existsSync(localConfigPath)) {
      const config = readConfig(localConfigPath);
      if (config.backend) {
        return config.backend;
      }
    }
  }

  // Try global config
  const globalConfigPath = join(homedir(), '.config', 'mobius', 'config.yaml');
  if (existsSync(globalConfigPath)) {
    const config = readConfig(globalConfigPath);
    if (config.backend) {
      return config.backend;
    }
  }

  // Default to linear
  return 'linear';
}

/** Set of parentIds that have already triggered a legacy warning */
const _legacyWarnings = new Set<string>();

/**
 * Check if legacy ~/.mobius/issues/{parentId} exists and emit a one-time
 * warning to stderr when the project-local .mobius/issues/{parentId} does not.
 */
function checkLegacyPath(parentId: string): void {
  if (_legacyWarnings.has(parentId)) return;

  const legacyPath = join(homedir(), '.mobius', 'issues', parentId);
  const localPath = join(getMobiusBasePath(), 'issues', parentId);

  if (existsSync(legacyPath) && !existsSync(localPath)) {
    console.warn(
      `[mobius] Legacy context found at ~/.mobius/issues/${parentId}. ` +
        `New context will be stored in project-local .mobius/issues/${parentId}. ` +
        `Legacy data will not be migrated automatically.`
    );
    _legacyWarnings.add(parentId);
  }
}

/**
 * Reset legacy warning state (for testing)
 */
export function _resetLegacyWarnings(): void {
  _legacyWarnings.clear();
}

/**
 * Ensure the context directory structure exists
 *
 * Calls ensureProjectMobiusDir() from local-state.ts first to create the
 * project-local .mobius/ directory with .gitignore, then creates the
 * issue-specific subdirectories.
 */
function ensureContextDirectories(parentId: string): void {
  // Ensure .mobius/ exists with .gitignore
  ensureProjectMobiusDir();

  // Check for legacy ~/.mobius/ data and warn if needed
  checkLegacyPath(parentId);

  const contextPath = getContextPath(parentId);
  const tasksPath = getTasksDirectoryPath(parentId);

  if (!existsSync(contextPath)) {
    mkdirSync(contextPath, { recursive: true });
  }

  if (!existsSync(tasksPath)) {
    mkdirSync(tasksPath, { recursive: true });
  }
}

/**
 * Fetch parent issue details from Linear
 */
async function fetchLinearParentContext(
  parentIdentifier: string
): Promise<ParentIssueContext | null> {
  const issue = await fetchLinearIssue(parentIdentifier);
  if (!issue) {
    return null;
  }

  // Need to fetch full issue details for description, status, labels, url
  // The fetchLinearIssue only returns basic info. For now, we'll use what we have
  // and fill in missing fields with defaults. The full implementation would need
  // to extend fetchLinearIssue to return all fields.
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: '', // Would need to extend fetchLinearIssue
    gitBranchName: issue.gitBranchName,
    status: 'Backlog', // Would need to extend fetchLinearIssue
    labels: [], // Would need to extend fetchLinearIssue
    url: `https://linear.app/issue/${issue.identifier}`, // Approximate URL
  };
}

/**
 * Fetch parent issue details from Jira
 */
async function fetchJiraParentContext(
  parentIdentifier: string
): Promise<ParentIssueContext | null> {
  const issue = await fetchJiraIssue(parentIdentifier);
  if (!issue) {
    return null;
  }

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: '', // Would need to extend fetchJiraIssue
    gitBranchName: issue.gitBranchName,
    status: 'To Do', // Would need to extend fetchJiraIssue
    labels: [], // Would need to extend fetchJiraIssue
    url: '', // Would need to extend fetchJiraIssue
  };
}

/**
 * Fetch sub-tasks from Linear and convert to SubTaskContext format
 */
async function fetchLinearSubTaskContexts(parentId: string): Promise<SubTaskContext[]> {
  const subTasks = await fetchLinearSubTasks(parentId);
  if (!subTasks) {
    return [];
  }

  return subTasks.map((task) => ({
    id: task.id,
    identifier: task.identifier,
    title: task.title,
    description: '', // Would need to extend fetchLinearSubTasks
    status: mapLinearStatus(task.status),
    gitBranchName: task.gitBranchName || '',
    blockedBy: task.relations?.blockedBy || [],
    blocks: task.relations?.blocks || [],
  }));
}

/**
 * Fetch sub-tasks from Jira and convert to SubTaskContext format
 */
async function fetchJiraSubTaskContexts(parentKey: string): Promise<SubTaskContext[]> {
  const subTasks = await fetchJiraSubTasks(parentKey);
  if (!subTasks) {
    return [];
  }

  return subTasks.map((task) => ({
    id: task.id,
    identifier: task.identifier,
    title: task.title,
    description: '', // Would need to extend fetchJiraSubTasks
    status: mapLinearStatus(task.status), // Reuse Linear status mapping
    gitBranchName: task.gitBranchName || '',
    blockedBy: task.relations?.blockedBy || [],
    blocks: task.relations?.blocks || [],
  }));
}

/**
 * Generate local context files for an issue
 *
 * Fetches issue data from the configured backend (Linear or Jira) via SDK
 * and writes to project-local .mobius/issues/{parentId}/.
 *
 * Creates:
 * - parent.json: Parent issue details
 * - tasks/{identifier}.json: Individual sub-task files
 * - pending-updates.json: Empty queue for pending changes
 *
 * @param parentIdentifier - The parent issue identifier (e.g., "MOB-161")
 * @param options - Optional configuration
 * @returns The generated IssueContext or null on failure
 */
export async function generateContext(
  parentIdentifier: string,
  options?: {
    projectPath?: string;
    forceRefresh?: boolean;
  }
): Promise<IssueContext | null> {
  const backend = detectBackend(options?.projectPath);
  const now = new Date().toISOString();

  // Fetch parent issue based on backend
  let parentContext: ParentIssueContext | null = null;
  let subTaskContexts: SubTaskContext[] = [];

  if (backend === 'linear') {
    parentContext = await fetchLinearParentContext(parentIdentifier);
    if (parentContext) {
      subTaskContexts = await fetchLinearSubTaskContexts(parentContext.id);
    }
  } else {
    parentContext = await fetchJiraParentContext(parentIdentifier);
    if (parentContext) {
      subTaskContexts = await fetchJiraSubTaskContexts(parentIdentifier);
    }
  }

  if (!parentContext) {
    return null;
  }

  // Ensure directories exist
  ensureContextDirectories(parentIdentifier);

  // Create metadata
  const metadata: ContextMetadata = {
    fetchedAt: now,
    updatedAt: now,
    backend,
  };

  // Build the full context
  const context: IssueContext = {
    parent: parentContext,
    subTasks: subTaskContexts,
    metadata,
  };

  // Write parent.json
  writeFileSync(
    getParentContextPath(parentIdentifier),
    JSON.stringify(parentContext, null, 2),
    'utf-8'
  );

  // Write individual task files
  for (const task of subTaskContexts) {
    writeFileSync(
      getTaskContextPath(parentIdentifier, task.identifier),
      JSON.stringify(task, null, 2),
      'utf-8'
    );
  }

  // Initialize pending-updates.json if it doesn't exist
  const pendingUpdatesPath = getPendingUpdatesPath(parentIdentifier);
  if (!existsSync(pendingUpdatesPath)) {
    const emptyQueue: PendingUpdatesQueue = {
      updates: [],
    };
    writeFileSync(pendingUpdatesPath, JSON.stringify(emptyQueue, null, 2), 'utf-8');
  }

  // Initialize sync-log.json if it doesn't exist
  const syncLogPath = getSyncLogPath(parentIdentifier);
  if (!existsSync(syncLogPath)) {
    writeFileSync(syncLogPath, JSON.stringify({ entries: [] }, null, 2), 'utf-8');
  }

  return context;
}

/**
 * Read context from local files
 *
 * Loads the issue context from project-local .mobius/issues/{parentId}/.
 * Returns null if context doesn't exist or is invalid.
 *
 * @param parentIdentifier - The parent issue identifier (e.g., "MOB-161")
 * @returns The IssueContext or null if not found/invalid
 */
export function readContext(parentIdentifier: string): IssueContext | null {
  const contextPath = getContextPath(parentIdentifier);
  const parentPath = getParentContextPath(parentIdentifier);
  const tasksDir = getTasksDirectoryPath(parentIdentifier);
  const pendingUpdatesPath = getPendingUpdatesPath(parentIdentifier);

  // Check if context directory exists
  if (!existsSync(contextPath) || !existsSync(parentPath)) {
    return null;
  }

  try {
    // Read parent context
    const parentContent = readFileSync(parentPath, 'utf-8');
    const parent: ParentIssueContext = JSON.parse(parentContent);

    // Read all task files
    const subTasks: SubTaskContext[] = [];
    if (existsSync(tasksDir)) {
      const taskFiles = readdirSync(tasksDir).filter((f) => f.endsWith('.json'));
      for (const file of taskFiles) {
        const taskContent = readFileSync(join(tasksDir, file), 'utf-8');
        const task: SubTaskContext = JSON.parse(taskContent);
        subTasks.push(task);
      }
    }

    // Detect backend from pending-updates or default to linear
    let backend: Backend = 'linear';
    if (existsSync(pendingUpdatesPath)) {
      // Could store backend in a metadata file, but for now we'll detect from config
      backend = detectBackend();
    }

    // Build metadata (use file modification time as approximation)
    const metadata: ContextMetadata = {
      fetchedAt: new Date().toISOString(), // Approximation
      updatedAt: new Date().toISOString(), // Approximation
      backend,
    };

    return {
      parent,
      subTasks,
      metadata,
    };
  } catch {
    return null;
  }
}

/**
 * Check if context exists for an issue
 */
export function contextExists(parentIdentifier: string): boolean {
  return existsSync(getParentContextPath(parentIdentifier));
}

/**
 * Check if context is fresh (generated within the specified time window)
 *
 * @param parentIdentifier - The parent issue identifier
 * @param maxAgeMs - Maximum age in milliseconds (default: 5 minutes)
 */
export function isContextFresh(
  parentIdentifier: string,
  maxAgeMs: number = 5 * 60 * 1000
): boolean {
  const parentPath = getParentContextPath(parentIdentifier);

  if (!existsSync(parentPath)) {
    return false;
  }

  try {
    const stats = require('node:fs').statSync(parentPath);
    const age = Date.now() - stats.mtimeMs;
    return age < maxAgeMs;
  } catch {
    return false;
  }
}

/**
 * Clean up context for an issue
 *
 * Removes all local context files for the specified issue.
 *
 * @param parentIdentifier - The parent issue identifier
 */
export function cleanupContext(parentIdentifier: string): void {
  const contextPath = getContextPath(parentIdentifier);

  if (existsSync(contextPath)) {
    rmSync(contextPath, { recursive: true, force: true });
  }
}

/**
 * Update a single task's context locally
 *
 * Updates the task file in the local context without syncing to backend.
 * Changes should be queued in pending-updates.json for later sync.
 *
 * @param parentIdentifier - The parent issue identifier
 * @param task - The updated task context
 */
export function updateTaskContext(parentIdentifier: string, task: SubTaskContext): void {
  const taskPath = getTaskContextPath(parentIdentifier, task.identifier);
  const tasksDir = getTasksDirectoryPath(parentIdentifier);

  // Ensure tasks directory exists
  if (!existsSync(tasksDir)) {
    mkdirSync(tasksDir, { recursive: true });
  }

  writeFileSync(taskPath, JSON.stringify(task, null, 2), 'utf-8');
}

/**
 * Read pending updates queue
 */
export function readPendingUpdates(parentIdentifier: string): PendingUpdatesQueue {
  const path = getPendingUpdatesPath(parentIdentifier);

  if (!existsSync(path)) {
    return { updates: [] };
  }

  try {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as PendingUpdatesQueue;
  } catch {
    return { updates: [] };
  }
}

/**
 * Write pending updates queue
 */
export function writePendingUpdates(parentIdentifier: string, queue: PendingUpdatesQueue): void {
  ensureContextDirectories(parentIdentifier);
  writeFileSync(getPendingUpdatesPath(parentIdentifier), JSON.stringify(queue, null, 2), 'utf-8');
}

/**
 * Input type for queuePendingUpdate - the update data without id/createdAt
 *
 * We need to define this explicitly because Omit doesn't distribute over unions.
 */
export type PendingUpdateInput =
  | {
      type: 'status_change';
      issueId: string;
      identifier: string;
      oldStatus: string;
      newStatus: string;
    }
  | { type: 'add_comment'; issueId: string; identifier: string; body: string }
  | {
      type: 'create_subtask';
      parentId: string;
      title: string;
      description: string;
      blockedBy?: string[];
    }
  | { type: 'update_description'; issueId: string; identifier: string; description: string }
  | { type: 'add_label'; issueId: string; identifier: string; label: string }
  | { type: 'remove_label'; issueId: string; identifier: string; label: string };

/**
 * Check if two updates are equivalent (same type and content)
 *
 * Used to prevent duplicate updates from being queued when the same
 * change is detected multiple times (e.g., during polling or retries).
 */
function isDuplicateUpdate(existing: PendingUpdate, incoming: PendingUpdateInput): boolean {
  if (existing.type !== incoming.type) return false;

  switch (existing.type) {
    case 'status_change': {
      const inc = incoming as typeof existing;
      return (
        existing.issueId === inc.issueId &&
        existing.oldStatus === inc.oldStatus &&
        existing.newStatus === inc.newStatus
      );
    }
    case 'add_comment': {
      const inc = incoming as typeof existing;
      return existing.issueId === inc.issueId && existing.body === inc.body;
    }
    case 'create_subtask': {
      const inc = incoming as typeof existing;
      return (
        existing.parentId === inc.parentId &&
        existing.title === inc.title &&
        existing.description === inc.description
      );
    }
    case 'update_description': {
      const inc = incoming as typeof existing;
      return existing.issueId === inc.issueId && existing.description === inc.description;
    }
    case 'add_label': {
      const inc = incoming as typeof existing;
      return existing.issueId === inc.issueId && existing.label === inc.label;
    }
    case 'remove_label': {
      const inc = incoming as typeof existing;
      return existing.issueId === inc.issueId && existing.label === inc.label;
    }
    default:
      return false;
  }
}

/**
 * Queue a pending update for later sync via `mobius push`
 *
 * Adds an update to the pending-updates.json queue. Updates are
 * automatically assigned a unique ID and timestamp. Duplicate updates
 * (same type and content as any existing update) are skipped to prevent
 * the same change from being synced multiple times.
 *
 * @param parentIdentifier - The parent issue identifier (e.g., "MOB-161")
 * @param update - The update to queue (without id and createdAt fields)
 */
export function queuePendingUpdate(parentIdentifier: string, update: PendingUpdateInput): void {
  const queue = readPendingUpdates(parentIdentifier);

  // Check for duplicate updates - only check UNSYNCED updates
  // Once an update has been synced, it shouldn't block new updates
  // (e.g., status might have been changed externally and needs re-applying)
  const unsyncedUpdates = queue.updates.filter((u) => !u.syncedAt && !u.error);
  const isDuplicate = unsyncedUpdates.some((existing) => isDuplicateUpdate(existing, update));

  if (isDuplicate) {
    return;
  }

  const newUpdate: PendingUpdate = {
    ...update,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  } as PendingUpdate;
  queue.updates.push(newUpdate);
  writePendingUpdates(parentIdentifier, queue);
}

// =============================================================================
// Session Management (replaces current-task.ts)
// =============================================================================

/**
 * Get the execution directory path for a parent issue
 * This is where session and runtime state are stored
 */
export function getExecutionPath(parentId: string): string {
  return join(getContextPath(parentId), 'execution');
}

/**
 * Get the path to the session.json file
 */
export function getSessionPath(parentId: string): string {
  return join(getExecutionPath(parentId), 'session.json');
}

/**
 * Get the path to the runtime.json file
 */
export function getRuntimePath(parentId: string): string {
  return join(getExecutionPath(parentId), 'runtime.json');
}

/**
 * Get the path to the global current session pointer
 * This is a symlink or small file pointing to the active session's parent ID
 */
export function getCurrentSessionPointerPath(): string {
  return join(getMobiusBasePath(), 'current-session');
}

/**
 * Ensure the execution directory exists
 */
function ensureExecutionDirectory(parentId: string): void {
  const executionPath = getExecutionPath(parentId);
  if (!existsSync(executionPath)) {
    mkdirSync(executionPath, { recursive: true });
  }
}

/**
 * Read the current session info for a parent issue
 *
 * @param parentId - The parent issue identifier
 * @returns SessionInfo or null if no session exists
 */
export function readSession(parentId: string): SessionInfo | null {
  const sessionPath = getSessionPath(parentId);

  if (!existsSync(sessionPath)) {
    return null;
  }

  try {
    const content = readFileSync(sessionPath, 'utf-8');
    return JSON.parse(content) as SessionInfo;
  } catch {
    return null;
  }
}

/**
 * Write session info for a parent issue
 *
 * @param parentId - The parent issue identifier
 * @param session - The session info to write
 */
export function writeSession(parentId: string, session: SessionInfo): void {
  ensureExecutionDirectory(parentId);
  writeFileSync(getSessionPath(parentId), JSON.stringify(session, null, 2), 'utf-8');
}

/**
 * Create a new session for a parent issue
 *
 * @param parentId - The parent issue identifier
 * @param backend - The backend type (linear or jira)
 * @param worktreePath - Optional worktree path
 * @returns The created SessionInfo
 */
export function createSession(
  parentId: string,
  backend: Backend,
  worktreePath?: string
): SessionInfo {
  const session: SessionInfo = {
    parentId,
    backend,
    startedAt: new Date().toISOString(),
    worktreePath,
    status: 'active',
  };

  writeSession(parentId, session);
  setCurrentSessionPointer(parentId);

  return session;
}

/**
 * Update an existing session
 *
 * @param parentId - The parent issue identifier
 * @param updates - Partial session updates to apply
 * @returns The updated SessionInfo or null if no session exists
 */
export function updateSession(
  parentId: string,
  updates: Partial<Omit<SessionInfo, 'parentId'>>
): SessionInfo | null {
  const existing = readSession(parentId);
  if (!existing) {
    return null;
  }

  const updated: SessionInfo = {
    ...existing,
    ...updates,
  };

  writeSession(parentId, updated);
  return updated;
}

/**
 * End a session (mark as completed or failed)
 *
 * @param parentId - The parent issue identifier
 * @param status - The final status ('completed' or 'failed')
 */
export function endSession(parentId: string, status: 'completed' | 'failed'): void {
  updateSession(parentId, { status });
  clearCurrentSessionPointer(parentId);
}

/**
 * Delete session for a parent issue
 *
 * @param parentId - The parent issue identifier
 */
export function deleteSession(parentId: string): void {
  const sessionPath = getSessionPath(parentId);
  if (existsSync(sessionPath)) {
    unlinkSync(sessionPath);
  }
  clearCurrentSessionPointer(parentId);
}

/**
 * Set the global current session pointer
 *
 * @param parentId - The parent issue identifier to set as current
 */
export function setCurrentSessionPointer(parentId: string): void {
  const basePath = getMobiusBasePath();
  if (!existsSync(basePath)) {
    mkdirSync(basePath, { recursive: true });
  }
  writeFileSync(getCurrentSessionPointerPath(), parentId, 'utf-8');
}

/**
 * Get the current session's parent ID
 *
 * @returns The parent ID of the current session or null if none
 */
export function getCurrentSessionParentId(): string | null {
  const pointerPath = getCurrentSessionPointerPath();
  if (!existsSync(pointerPath)) {
    return null;
  }

  try {
    const parentId = readFileSync(pointerPath, 'utf-8').trim();
    // Verify the session still exists
    if (readSession(parentId)) {
      return parentId;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Clear the current session pointer (if it matches the given parentId)
 *
 * @param parentId - Only clear if this is the current session
 */
export function clearCurrentSessionPointer(parentId: string): void {
  const currentId = getCurrentSessionParentId();
  if (currentId === parentId) {
    const pointerPath = getCurrentSessionPointerPath();
    if (existsSync(pointerPath)) {
      unlinkSync(pointerPath);
    }
  }
}

/**
 * Resolve the task ID to use, checking current session if not provided
 *
 * @param providedId - Optional explicitly provided task ID
 * @returns The resolved task ID or null if none available
 */
export function resolveTaskId(providedId?: string): string | null {
  if (providedId) {
    return providedId;
  }
  return getCurrentSessionParentId();
}

/**
 * Resolve both task ID and backend from current session
 *
 * @param providedId - Optional explicitly provided task ID
 * @param providedBackend - Optional explicitly provided backend
 * @returns Object with resolved taskId and backend
 */
export function resolveTaskContext(
  providedId?: string,
  providedBackend?: Backend
): { taskId: string | null; backend: Backend | undefined } {
  const taskId = resolveTaskId(providedId);

  if (providedBackend) {
    return { taskId, backend: providedBackend };
  }

  // Try to get backend from session
  if (taskId) {
    const session = readSession(taskId);
    if (session) {
      return { taskId, backend: session.backend };
    }
  }

  return { taskId, backend: undefined };
}

// =============================================================================
// Runtime State Management (replaces execution-state.ts)
// =============================================================================

/** Lock file timeout in milliseconds - how long to wait for lock acquisition */
const LOCK_TIMEOUT_MS = 5000;

/** Lock retry interval in milliseconds */
const LOCK_RETRY_INTERVAL_MS = 10;

/** Debounce timeout in milliseconds - higher value reduces flickering */
const DEBOUNCE_MS = 150;

/**
 * Get the lock file path for a runtime state file
 */
function getRuntimeLockPath(parentId: string): string {
  return `${getRuntimePath(parentId)}.lock`;
}

/**
 * Check if a lock file is stale (older than timeout)
 */
function isLockStale(lockPath: string): boolean {
  try {
    const content = readFileSync(lockPath, 'utf-8');
    const lockTime = parseInt(content, 10);
    if (Number.isNaN(lockTime)) return true;
    return Date.now() - lockTime > LOCK_TIMEOUT_MS;
  } catch {
    return true;
  }
}

/**
 * Attempt to acquire an exclusive lock on the runtime state file
 */
function tryAcquireLock(lockPath: string): boolean {
  try {
    if (existsSync(lockPath)) {
      if (isLockStale(lockPath)) {
        try {
          unlinkSync(lockPath);
        } catch {
          // Another process may have removed it
        }
      } else {
        return false;
      }
    }
    writeFileSync(lockPath, Date.now().toString(), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Release the lock on a runtime state file
 */
function releaseLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // Lock may have been force-removed due to staleness
  }
}

/**
 * Validate that an object is a valid RuntimeActiveTask
 */
function isValidActiveTask(obj: unknown): obj is RuntimeActiveTask {
  if (typeof obj !== 'object' || obj === null) return false;
  const task = obj as Record<string, unknown>;
  return (
    typeof task.id === 'string' &&
    typeof task.pid === 'number' &&
    typeof task.pane === 'string' &&
    typeof task.startedAt === 'string' &&
    (task.worktree === undefined || typeof task.worktree === 'string')
  );
}

/**
 * Validate that an object is a valid RuntimeCompletedTask
 */
function isValidCompletedTask(obj: unknown): obj is RuntimeCompletedTask {
  if (typeof obj !== 'object' || obj === null) return false;
  const task = obj as Record<string, unknown>;
  return (
    typeof task.id === 'string' &&
    typeof task.completedAt === 'string' &&
    typeof task.duration === 'number'
  );
}

/**
 * Validate completed/failed task entry (string or RuntimeCompletedTask)
 */
function isValidCompletedTaskEntry(item: unknown): item is string | RuntimeCompletedTask {
  return typeof item === 'string' || isValidCompletedTask(item);
}

/**
 * Validate that an object has the required RuntimeState fields
 */
function isValidRuntimeState(obj: unknown): obj is RuntimeState {
  if (typeof obj !== 'object' || obj === null) return false;

  const state = obj as Record<string, unknown>;

  if (typeof state.parentId !== 'string') return false;
  if (typeof state.parentTitle !== 'string') return false;
  if (typeof state.startedAt !== 'string') return false;
  if (typeof state.updatedAt !== 'string') return false;

  if (!Array.isArray(state.activeTasks)) return false;
  if (!Array.isArray(state.completedTasks)) return false;
  if (!Array.isArray(state.failedTasks)) return false;

  for (const task of state.activeTasks) {
    if (!isValidActiveTask(task)) return false;
  }
  for (const entry of state.completedTasks) {
    if (!isValidCompletedTaskEntry(entry)) return false;
  }
  for (const entry of state.failedTasks) {
    if (!isValidCompletedTaskEntry(entry)) return false;
  }

  return true;
}

/**
 * Read runtime state from file
 *
 * @param parentId - The parent issue identifier
 * @returns RuntimeState or null if not found/invalid
 */
export function readRuntimeState(parentId: string): RuntimeState | null {
  const filePath = getRuntimePath(parentId);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);

    if (!isValidRuntimeState(parsed)) {
      console.warn(`Invalid runtime state file: ${filePath}`);
      return null;
    }

    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn(`Malformed JSON in runtime state file: ${filePath}`);
    } else if (error instanceof Error) {
      console.warn(`Error reading runtime state file: ${error.message}`);
    }
    return null;
  }
}

/**
 * Write runtime state to file atomically
 *
 * @param state - The runtime state to write
 */
export function writeRuntimeState(state: RuntimeState): void {
  ensureExecutionDirectory(state.parentId);
  const filePath = getRuntimePath(state.parentId);

  const stateWithTimestamp: RuntimeState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };

  // Atomic write: write to temp file first, then rename
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(stateWithTimestamp, null, 2), 'utf-8');
  renameSync(tmpPath, filePath);
}

/**
 * Execute a runtime state mutation atomically with read-modify-write pattern
 *
 * @param parentId - Parent issue identifier
 * @param mutate - Function that takes current state and returns new state
 * @returns The new state after mutation
 */
export function withRuntimeStateSync(
  parentId: string,
  mutate: (state: RuntimeState | null) => RuntimeState
): RuntimeState {
  ensureExecutionDirectory(parentId);
  const lockPath = getRuntimeLockPath(parentId);
  const startTime = Date.now();

  // Busy-wait for lock acquisition
  while (Date.now() - startTime < LOCK_TIMEOUT_MS) {
    if (tryAcquireLock(lockPath)) {
      const lockAcquireTime = Date.now();
      debugLog('lock_acquire', 'context-generator', parentId, {
        waitMs: lockAcquireTime - startTime,
      });

      try {
        const currentState = readRuntimeState(parentId);
        debugLog('runtime_state_read', 'context-generator', parentId, {
          activeTasks: currentState?.activeTasks.length ?? 0,
          completedTasks: currentState?.completedTasks.length ?? 0,
        });

        const newState = mutate(currentState);
        writeRuntimeState(newState);

        debugLog('runtime_state_write', 'context-generator', parentId, {
          activeTasks: newState.activeTasks.length,
          completedTasks: newState.completedTasks.length,
          failedTasks: newState.failedTasks.length,
        });

        return newState;
      } finally {
        const lockDuration = Date.now() - lockAcquireTime;
        debugLog('lock_release', 'context-generator', parentId, {
          durationMs: lockDuration,
        });
        releaseLock(lockPath);
      }
    }

    // Busy wait with small delay
    const endTime = Date.now() + LOCK_RETRY_INTERVAL_MS;
    while (Date.now() < endTime) {
      // Spin
    }
  }

  throw new Error(
    `Failed to acquire lock on runtime state for ${parentId} within ${LOCK_TIMEOUT_MS}ms`
  );
}

/**
 * Rebuild backendStatuses and completedTasks from synced pending updates.
 * This ensures TUI shows correct status even after session restart.
 *
 * @param parentId - Parent issue identifier
 * @returns Object with backendStatuses and completedTasks arrays
 */
function rebuildStateFromPendingUpdates(parentId: string): {
  backendStatuses: RuntimeState['backendStatuses'];
  completedTasks: string[];
} {
  const queue = readPendingUpdates(parentId);
  const backendStatuses: NonNullable<RuntimeState['backendStatuses']> = {};

  for (const update of queue.updates) {
    if (update.type === 'status_change' && update.syncedAt) {
      // Only keep the most recent sync for each task
      const existing = backendStatuses[update.identifier];
      if (!existing || new Date(update.syncedAt) > new Date(existing.syncedAt)) {
        // Map the backend status to internal TaskStatus format for TUI display
        const mappedStatus = mapLinearStatus(update.newStatus);
        backendStatuses[update.identifier] = {
          identifier: update.identifier,
          status: mappedStatus,
          syncedAt: update.syncedAt,
        };
      }
    }
  }

  // Build completedTasks from tasks whose final status is "done"
  const completedTasks: string[] = [];
  for (const [identifier, entry] of Object.entries(backendStatuses)) {
    if (entry.status === 'done') {
      completedTasks.push(identifier);
    }
  }

  return {
    backendStatuses: Object.keys(backendStatuses).length > 0 ? backendStatuses : undefined,
    completedTasks,
  };
}

/**
 * Initialize a new runtime state for a parent issue
 *
 * @param parentId - Parent issue identifier
 * @param parentTitle - Parent issue title for display
 * @param options - Optional configuration
 * @returns The initialized runtime state
 */
export function initializeRuntimeState(
  parentId: string,
  parentTitle: string,
  options?: {
    loopPid?: number;
    totalTasks?: number;
  }
): RuntimeState {
  const now = new Date().toISOString();

  // Rebuild state from any previously synced updates
  const { backendStatuses, completedTasks } = rebuildStateFromPendingUpdates(parentId);

  const state: RuntimeState = {
    parentId,
    parentTitle,
    activeTasks: [],
    completedTasks,
    failedTasks: [],
    startedAt: now,
    updatedAt: now,
    loopPid: options?.loopPid,
    totalTasks: options?.totalTasks,
    backendStatuses,
  };

  writeRuntimeState(state);
  return state;
}

/**
 * Add an active task to runtime state
 */
export function addRuntimeActiveTask(state: RuntimeState, task: RuntimeActiveTask): RuntimeState {
  debugLog('task_state_change', 'context-generator', task.id, {
    transition: 'add_active',
    pane: task.pane,
    pid: task.pid,
  });

  return withRuntimeStateSync(state.parentId, (currentState) => {
    const baseState = currentState ?? state;
    return {
      ...baseState,
      activeTasks: [...baseState.activeTasks, task],
    };
  });
}

/**
 * Complete a task in runtime state
 */
export function completeRuntimeTask(state: RuntimeState, taskId: string): RuntimeState {
  debugLog('task_state_change', 'context-generator', taskId, {
    transition: 'complete',
  });

  return withRuntimeStateSync(state.parentId, (currentState) => {
    const baseState = currentState ?? state;

    // Check if task is already in completedTasks (prevent duplicates)
    const alreadyCompleted = baseState.completedTasks.some(
      (t) => (typeof t === 'string' ? t : t.id) === taskId
    );
    if (alreadyCompleted) {
      return baseState;
    }

    const now = new Date();
    const activeTask = baseState.activeTasks.find((t) => t.id === taskId);

    const duration = activeTask ? now.getTime() - new Date(activeTask.startedAt).getTime() : 0;

    const completedTask: RuntimeCompletedTask = {
      id: taskId,
      completedAt: now.toISOString(),
      duration,
    };

    return {
      ...baseState,
      activeTasks: baseState.activeTasks.filter((t) => t.id !== taskId),
      completedTasks: [...baseState.completedTasks, completedTask],
    };
  });
}

/**
 * Fail a task in runtime state
 */
export function failRuntimeTask(state: RuntimeState, taskId: string): RuntimeState {
  debugLog('task_state_change', 'context-generator', taskId, {
    transition: 'fail',
  });

  return withRuntimeStateSync(state.parentId, (currentState) => {
    const baseState = currentState ?? state;
    const now = new Date();
    const activeTask = baseState.activeTasks.find((t) => t.id === taskId);

    const duration = activeTask ? now.getTime() - new Date(activeTask.startedAt).getTime() : 0;

    const failedTask: RuntimeCompletedTask = {
      id: taskId,
      completedAt: now.toISOString(),
      duration,
    };

    return {
      ...baseState,
      activeTasks: baseState.activeTasks.filter((t) => t.id !== taskId),
      failedTasks: [...baseState.failedTasks, failedTask],
    };
  });
}

/**
 * Remove an active task without marking as completed/failed (for retries)
 */
export function removeRuntimeActiveTask(state: RuntimeState, taskId: string): RuntimeState {
  return withRuntimeStateSync(state.parentId, (currentState) => {
    const baseState = currentState ?? state;
    return {
      ...baseState,
      activeTasks: baseState.activeTasks.filter((t) => t.id !== taskId),
    };
  });
}

/**
 * Update the pane ID of an active task
 */
export function updateRuntimeTaskPane(
  state: RuntimeState,
  taskId: string,
  paneId: string
): RuntimeState {
  return withRuntimeStateSync(state.parentId, (currentState) => {
    const baseState = currentState ?? state;
    return {
      ...baseState,
      activeTasks: baseState.activeTasks.map((task) =>
        task.id === taskId ? { ...task, pane: paneId } : task
      ),
    };
  });
}

/**
 * Clear all active tasks from runtime state
 */
export function clearAllRuntimeActiveTasks(parentId: string): RuntimeState | null {
  const currentState = readRuntimeState(parentId);
  if (!currentState) {
    return null;
  }

  return withRuntimeStateSync(parentId, (state) => {
    const baseState = state ?? currentState;
    return {
      ...baseState,
      activeTasks: [],
    };
  });
}

/**
 * Delete the runtime state file for a parent task
 *
 * @param parentId - The parent task identifier
 * @returns true if file was deleted, false if it didn't exist
 */
export function deleteRuntimeState(parentId: string): boolean {
  const filePath = getRuntimePath(parentId);

  if (!existsSync(filePath)) {
    return false;
  }

  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Update backend status for a task after successful push
 *
 * This is called by the loop after push succeeds, allowing the TUI
 * to show real-time backend status without re-fetching the entire graph.
 *
 * @param parentId - The parent task identifier
 * @param taskIdentifier - The task identifier (e.g., "MOB-124")
 * @param status - The new backend status (e.g., "Done")
 */
export function updateBackendStatus(
  parentId: string,
  taskIdentifier: string,
  status: string
): void {
  const currentState = readRuntimeState(parentId);
  if (!currentState) {
    return;
  }

  // Map the backend status to internal TaskStatus format for TUI display
  const mappedStatus = mapLinearStatus(status);

  debugLog('backend_status_update', 'context-generator', taskIdentifier, {
    status: mappedStatus,
    syncedAt: new Date().toISOString(),
  });

  withRuntimeStateSync(parentId, (state) => {
    const baseState = state ?? currentState;
    const backendStatuses = { ...(baseState.backendStatuses ?? {}) };

    backendStatuses[taskIdentifier] = {
      identifier: taskIdentifier,
      status: mappedStatus,
      syncedAt: new Date().toISOString(),
    };

    return {
      ...baseState,
      backendStatuses,
    };
  });
}

/**
 * Normalize a completed task entry to RuntimeCompletedTask format
 * For backward compatibility with legacy string format
 */
export function normalizeCompletedTask(entry: string | RuntimeCompletedTask): RuntimeCompletedTask {
  if (typeof entry === 'string') {
    return {
      id: entry,
      completedAt: new Date().toISOString(),
      duration: 0,
    };
  }
  return entry;
}

/**
 * Get the task ID from a completed task entry (string or RuntimeCompletedTask)
 */
export function getCompletedTaskId(entry: string | RuntimeCompletedTask): string {
  return typeof entry === 'string' ? entry : entry.id;
}

/**
 * Check if new active tasks were added (significant change that needs immediate update)
 */
function hasNewActiveTasks(oldState: RuntimeState | null, newState: RuntimeState | null): boolean {
  if (!newState || !newState.activeTasks.length) return false;
  if (!oldState) return newState.activeTasks.length > 0;

  const oldIds = new Set(oldState.activeTasks.map((t) => t.id));
  return newState.activeTasks.some((t) => !oldIds.has(t.id));
}

/**
 * Compare active task arrays for equality (by id and startedAt)
 */
function activeTasksEqual(a: RuntimeActiveTask[], b: RuntimeActiveTask[]): boolean {
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
  a: (string | RuntimeCompletedTask)[],
  b: (string | RuntimeCompletedTask)[]
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
 * Check if backend statuses have changed
 */
function backendStatusesEqual(
  oldStatuses: RuntimeState['backendStatuses'],
  newStatuses: RuntimeState['backendStatuses']
): boolean {
  if (!oldStatuses && !newStatuses) return true;
  if (!oldStatuses || !newStatuses) return false;

  const oldKeys = Object.keys(oldStatuses);
  const newKeys = Object.keys(newStatuses);

  if (oldKeys.length !== newKeys.length) return false;

  for (const key of oldKeys) {
    const oldEntry = oldStatuses[key];
    const newEntry = newStatuses[key];
    if (!newEntry) return false;
    if (oldEntry.status !== newEntry.status) return false;
  }

  return true;
}

/**
 * Check if runtime state content has actually changed
 * Ignores updatedAt timestamp to prevent unnecessary re-renders
 */
function hasContentChanged(oldState: RuntimeState | null, newState: RuntimeState | null): boolean {
  if (oldState === null && newState === null) return false;
  if (oldState === null || newState === null) return true;

  if (!activeTasksEqual(oldState.activeTasks, newState.activeTasks)) return true;
  if (!completedTasksEqual(oldState.completedTasks, newState.completedTasks)) return true;
  if (!completedTasksEqual(oldState.failedTasks, newState.failedTasks)) return true;
  if (oldState.loopPid !== newState.loopPid) return true;
  if (!backendStatusesEqual(oldState.backendStatuses, newState.backendStatuses)) return true;

  return false;
}

/**
 * Watch the runtime state file for changes
 *
 * @param parentId - The parent issue identifier
 * @param callback - Function called with new state on each change
 * @returns Cleanup function to stop watching
 */
export function watchRuntimeState(
  parentId: string,
  callback: (state: RuntimeState | null) => void
): () => void {
  const executionDir = getExecutionPath(parentId);
  const fileName = 'runtime.json';

  ensureExecutionDirectory(parentId);

  let watcher: FSWatcher | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastState: RuntimeState | null = null;

  // Initial read
  lastState = readRuntimeState(parentId);
  callback(lastState);

  try {
    watcher = watch(executionDir, (_eventType, changedFileName) => {
      if (changedFileName !== fileName) {
        return;
      }

      debugLog('runtime_watcher_trigger', 'context-generator', parentId, {
        event: _eventType,
      });

      const newState = readRuntimeState(parentId);

      // Fast path: immediately notify for new active tasks
      if (hasNewActiveTasks(lastState, newState)) {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        debugLog('runtime_watcher_trigger', 'context-generator', parentId, {
          fastPath: true,
          reason: 'new_active_tasks',
        });
        lastState = newState;
        callback(newState);
        return;
      }

      // Debounce other changes
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        const currentState = readRuntimeState(parentId);

        if (hasContentChanged(lastState, currentState)) {
          debugLog('runtime_watcher_trigger', 'context-generator', parentId, {
            debounced: true,
            debounceMs: DEBOUNCE_MS,
          });
          lastState = currentState;
          callback(currentState);
        }
      }, DEBOUNCE_MS);
    });
  } catch (error) {
    console.warn(`Failed to watch runtime state directory: ${executionDir}`, error);
  }

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
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Filter active tasks to only include those with running processes
 */
export function filterRunningTasks(activeTasks: RuntimeActiveTask[]): RuntimeActiveTask[] {
  return activeTasks.filter((task) => isProcessRunning(task.pid));
}

/**
 * Progress summary returned by getProgressSummary
 */
export interface ProgressSummary {
  completed: number;
  failed: number;
  active: number;
  total: number;
  isComplete: boolean;
}

/**
 * Execution summary for modal display
 */
export interface ExecutionSummary extends ProgressSummary {
  elapsedMs: number;
}

/**
 * Get execution progress summary
 */
export function getProgressSummary(state: RuntimeState | null): ProgressSummary {
  if (!state) {
    return { completed: 0, failed: 0, active: 0, total: 0, isComplete: false };
  }

  const completed = state.completedTasks.length;
  const failed = state.failedTasks.length;
  const active = state.activeTasks.length;
  const total = completed + failed + active;

  const isComplete = active === 0 && (completed > 0 || failed > 0);

  return { completed, failed, active, total, isComplete };
}

/**
 * Get execution summary for modal display
 */
export function getModalSummary(state: RuntimeState | null, elapsedMs: number): ExecutionSummary {
  return {
    ...getProgressSummary(state),
    elapsedMs,
  };
}
