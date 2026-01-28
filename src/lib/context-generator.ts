/**
 * Context generator module for local issue context
 *
 * Generates and manages local context files for skills. Fetches issue data
 * via SDK and writes to ~/.mobius/issues/{parentId}/. Supports both Linear
 * and Jira backends based on configuration.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type {
  IssueContext,
  ParentIssueContext,
  SubTaskContext,
  ContextMetadata,
  PendingUpdatesQueue,
} from '../types/context.js';
import type { Backend } from '../types.js';
import { readConfig } from './config.js';
import { fetchLinearIssue, fetchLinearSubTasks } from './linear.js';
import { fetchJiraIssue, fetchJiraSubTasks } from './jira.js';
import { mapLinearStatus } from './task-graph.js';

/**
 * Get the base path for all mobius context storage
 */
export function getMobiusBasePath(): string {
  return join(homedir(), '.mobius');
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

/**
 * Ensure the context directory structure exists
 */
function ensureContextDirectories(parentId: string): void {
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
async function fetchLinearSubTaskContexts(
  parentId: string
): Promise<SubTaskContext[]> {
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
async function fetchJiraSubTaskContexts(
  parentKey: string
): Promise<SubTaskContext[]> {
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
 * and writes to ~/.mobius/issues/{parentId}/.
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
 * Loads the issue context from ~/.mobius/issues/{parentId}/.
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
    const stats = require('fs').statSync(parentPath);
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
export function updateTaskContext(
  parentIdentifier: string,
  task: SubTaskContext
): void {
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
export function writePendingUpdates(
  parentIdentifier: string,
  queue: PendingUpdatesQueue
): void {
  ensureContextDirectories(parentIdentifier);
  writeFileSync(
    getPendingUpdatesPath(parentIdentifier),
    JSON.stringify(queue, null, 2),
    'utf-8'
  );
}
