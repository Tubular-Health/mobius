/**
 * Push command - Push pending local changes to Linear/Jira via SDK
 *
 * Reads pending-updates.json files from local context and executes the
 * appropriate SDK calls to push changes to the backend.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { readConfig } from '../lib/config.js';
import {
  getContextPath,
  getMobiusBasePath,
  getPendingUpdatesPath,
  getSyncLogPath,
  readPendingUpdates,
  readSession,
  resolveTaskId,
  updateBackendStatus,
  writePendingUpdates,
} from '../lib/context-generator.js';
import { debugLog } from '../lib/debug-logger.js';
import { addJiraComment, createJiraIssue, updateJiraIssueStatus } from '../lib/jira.js';
import { addLinearComment, createLinearIssue, updateLinearIssueStatus } from '../lib/linear.js';
import { readIterationLog, writeSummary } from '../lib/local-state.js';
import { resolvePaths } from '../lib/paths.js';
import type { PendingUpdate, SyncLog, SyncLogEntry } from '../types/context.js';
import type { Backend } from '../types.js';
import { BACKEND_ID_PATTERNS } from '../types.js';

export interface PushOptions {
  backend?: Backend;
  dryRun?: boolean;
  all?: boolean;
  summary?: boolean;
}

interface PushResult {
  updateId: string;
  type: string;
  issueIdentifier: string;
  success: boolean;
  error?: string;
}

/**
 * Push pending updates to Linear/Jira
 *
 * @param parentId - Optional parent issue ID to push (pushes all if not specified with --all)
 * @param options - Command options
 */
export async function push(parentId: string | undefined, options: PushOptions): Promise<void> {
  const paths = resolvePaths();
  const config = readConfig(paths.configPath);
  const backend = options.backend ?? config.backend;

  // Handle --summary flag: generate and push loop summary
  if (options.summary) {
    const resolvedSummaryId = resolveTaskId(parentId) ?? undefined;
    if (!resolvedSummaryId) {
      console.error(chalk.red('Error: No task ID provided for summary'));
      console.error(chalk.gray('Usage: mobius push <task-id> --summary'));
      process.exit(1);
    }
    await pushLoopSummary(resolvedSummaryId, backend);
    return;
  }

  // Resolve task ID (use provided or fall back to current task)
  const resolvedId = options.all ? undefined : (resolveTaskId(parentId) ?? undefined);

  // Determine which issues to push
  const issuesToPush = getIssuesToPush(resolvedId, options.all);

  if (issuesToPush.length === 0) {
    if (resolvedId) {
      console.error(chalk.red(`Error: No pending updates found for ${resolvedId}`));
      console.error(chalk.gray('Run "mobius loop <task-id>" to generate context first'));
    } else if (!options.all) {
      console.error(chalk.red('Error: No task ID provided and no current task set'));
      console.error(chalk.gray('Usage: mobius push <task-id>'));
      console.error(chalk.gray('Or set a current task: mobius set-id <task-id>'));
      console.error(chalk.gray('Or use --all to push all pending updates'));
    } else {
      console.error(chalk.yellow('No issues with pending updates found'));
    }
    process.exit(1);
  }

  // Validate issue ID format if specific issue was requested
  if (resolvedId) {
    const pattern = BACKEND_ID_PATTERNS[backend];
    if (!pattern.test(resolvedId)) {
      console.error(chalk.red(`Error: Invalid issue ID format for ${backend}: ${resolvedId}`));
      console.error(chalk.gray('Expected format: PREFIX-NUMBER (e.g., MOB-123)'));
      process.exit(1);
    }
  }

  // Collect all pending updates
  let totalPending = 0;
  const allUpdates: Array<{ parentId: string; update: PendingUpdate }> = [];

  for (const issueId of issuesToPush) {
    const queue = readPendingUpdates(issueId);
    const pending = queue.updates.filter((u) => !u.syncedAt && !u.error);
    totalPending += pending.length;
    for (const update of pending) {
      allUpdates.push({ parentId: issueId, update });
    }
  }

  if (totalPending === 0) {
    console.log(chalk.green('No pending updates to push'));
    return;
  }

  // Dry run mode - show what would be pushed
  if (options.dryRun) {
    console.log(chalk.bold('\nDry run - pending changes to push:\n'));
    displayPendingChanges(allUpdates, backend);
    console.log(
      chalk.gray(`\nTotal: ${totalPending} update(s) across ${issuesToPush.length} issue(s)`)
    );
    console.log(chalk.gray('Run without --dry-run to apply changes'));
    return;
  }

  // Execute push
  const pushSpinner = ora({
    text: `Pushing ${totalPending} update(s) to ${backend}...`,
    color: 'blue',
  }).start();

  const results: PushResult[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (const { parentId: issueParentId, update } of allUpdates) {
    const result = await pushUpdate(update, backend);
    results.push(result);

    if (result.success) {
      successCount++;
      // Mark update as synced
      markUpdateSynced(issueParentId, update.id);
    } else {
      failureCount++;
      // Mark update with error
      markUpdateFailed(issueParentId, update.id, result.error || 'Unknown error');
    }

    // Log to sync-log.json
    logPushResult(issueParentId, result);
  }

  if (failureCount === 0) {
    pushSpinner.succeed(`Successfully pushed ${successCount} update(s)`);
  } else if (successCount === 0) {
    pushSpinner.fail(`Failed to push all ${failureCount} update(s)`);
  } else {
    pushSpinner.warn(`Pushed ${successCount} update(s), ${failureCount} failed`);
  }

  // Display summary
  console.log('');
  displayPushSummary(results);

  if (failureCount > 0) {
    console.log(chalk.gray('\nFailed updates remain in pending-updates.json'));
    console.log(chalk.gray('Fix the issues and run push again'));
    process.exit(1);
  }
}

/**
 * Push pending updates for a specific task (programmatic API for loop.ts)
 *
 * Unlike the CLI `push` command, this function:
 * - Doesn't exit the process on errors
 * - Returns results for the caller to handle
 * - Is designed for auto-push after queueing updates
 *
 * @param parentId - The parent issue identifier
 * @param backend - The backend to push to (linear or jira)
 * @returns Push results with success/failure counts
 */
export async function pushPendingUpdatesForTask(
  parentId: string,
  backend: Backend
): Promise<{ success: number; failed: number; errors: string[] }> {
  const queue = readPendingUpdates(parentId);
  const pending = queue.updates.filter((u) => !u.syncedAt && !u.error);

  if (pending.length === 0) {
    return { success: 0, failed: 0, errors: [] };
  }

  // Log pending updates before push
  debugLog('pending_update_queue', 'push', parentId, {
    pendingCount: pending.length,
    types: pending.map((u) => u.type),
    identifiers: pending.map((u) => getIssueIdentifier(u)),
  });

  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const update of pending) {
    const result = await pushUpdate(update, backend);

    // Log each push result
    debugLog('pending_update_push', 'push', result.issueIdentifier, {
      type: result.type,
      success: result.success,
      error: result.error,
    });

    if (result.success) {
      success++;
      markUpdateSynced(parentId, update.id);

      // Update backend status in runtime state for TUI to display
      // This enables real-time status updates without re-fetching the graph
      if (update.type === 'status_change') {
        updateBackendStatus(parentId, update.identifier, update.newStatus);
      }
    } else {
      failed++;
      const errorMsg = result.error || 'Unknown error';
      errors.push(`${result.issueIdentifier}: ${errorMsg}`);
      markUpdateFailed(parentId, update.id, errorMsg);
    }

    logPushResult(parentId, result);
  }

  return { success, failed, errors };
}

/**
 * Generate and push a loop summary for the given parent issue
 *
 * Reads iteration data from execution/iterations.json and session info
 * to build a structured summary. In backend modes (linear/jira), pushes
 * the summary as a comment on the parent issue. In local mode, writes
 * to .mobius/issues/{id}/summary.json.
 *
 * @param parentId - The parent issue identifier
 * @param backend - The backend to push to
 */
async function pushLoopSummary(parentId: string, backend: Backend): Promise<void> {
  const iterations = readIterationLog(parentId);

  if (iterations.length === 0) {
    console.error(chalk.yellow(`No iteration data found for ${parentId}`));
    console.error(chalk.gray('Run "mobius loop <task-id>" first to generate iteration data'));
    process.exit(1);
  }

  // Compute summary statistics
  const completedTasks = iterations.filter((e) => e.status === 'success');
  const failedTasks = iterations.filter((e) => e.status === 'failed');
  const uniqueSubtasks = new Set(iterations.map((e) => e.subtaskId));

  // Compute elapsed time from session or iteration timestamps
  const session = readSession(parentId);
  const startTime = session?.startedAt ?? iterations[0].startedAt;
  const lastIteration = iterations[iterations.length - 1];
  const endTime = lastIteration.completedAt ?? lastIteration.startedAt;
  const elapsedMs = new Date(endTime).getTime() - new Date(startTime).getTime();
  const elapsedMinutes = Math.round(elapsedMs / 60000);

  // Build task outcome map (latest status per subtask)
  const taskOutcomes = new Map<string, { status: string; iterations: number }>();
  for (const entry of iterations) {
    const existing = taskOutcomes.get(entry.subtaskId);
    taskOutcomes.set(entry.subtaskId, {
      status: entry.status,
      iterations: (existing?.iterations ?? 0) + 1,
    });
  }

  if (backend === 'local') {
    // In local mode, write summary.json
    const summary = {
      parentId,
      completedAt: new Date().toISOString(),
      totalTasks: uniqueSubtasks.size,
      completedTasks: completedTasks.length,
      failedTasks: failedTasks.length,
      totalIterations: iterations.length,
      taskOutcomes: Array.from(taskOutcomes.entries()).map(([id, outcome]) => ({
        id,
        status: outcome.status,
        iterations: outcome.iterations,
      })),
    };
    writeSummary(parentId, summary);
    console.log(chalk.green(`Summary written to .mobius/issues/${parentId}/summary.json`));
    displaySummaryStats(
      iterations.length,
      completedTasks.length,
      failedTasks.length,
      elapsedMinutes
    );
    return;
  }

  // Backend mode: push summary as comment on parent issue
  const commentBody = buildSummaryComment(
    parentId,
    iterations.length,
    completedTasks.length,
    failedTasks.length,
    elapsedMinutes,
    taskOutcomes
  );

  const spinner = ora({
    text: `Pushing loop summary to ${backend}...`,
    color: 'blue',
  }).start();

  let success: boolean;
  let error: string | undefined;

  if (backend === 'linear') {
    const result = await addLinearComment(parentId, commentBody);
    success = result.success;
    error = result.error;
  } else {
    const result = await addJiraComment(parentId, commentBody);
    success = result !== null;
    error = result === null ? 'Failed to add Jira comment' : undefined;
  }

  if (success) {
    spinner.succeed('Loop summary pushed successfully');
    displaySummaryStats(
      iterations.length,
      completedTasks.length,
      failedTasks.length,
      elapsedMinutes
    );
  } else {
    spinner.fail(`Failed to push summary: ${error ?? 'Unknown error'}`);
    process.exit(1);
  }
}

/**
 * Build a Markdown summary comment for backend posting
 */
function buildSummaryComment(
  parentId: string,
  totalIterations: number,
  completed: number,
  failed: number,
  elapsedMinutes: number,
  taskOutcomes: Map<string, { status: string; iterations: number }>
): string {
  const lines = [
    '## Loop Execution Summary',
    '',
    `**Issue**: ${parentId}`,
    `**Total Iterations**: ${totalIterations}`,
    `**Completed**: ${completed}`,
    `**Failed**: ${failed}`,
    `**Elapsed Time**: ${elapsedMinutes} minute(s)`,
    '',
    '### Task Outcomes',
    '',
    '| Task | Status | Iterations |',
    '|------|--------|------------|',
  ];

  for (const [id, outcome] of taskOutcomes) {
    const statusIcon =
      outcome.status === 'success' ? 'Done' : outcome.status === 'failed' ? 'Failed' : 'Partial';
    lines.push(`| ${id} | ${statusIcon} | ${outcome.iterations} |`);
  }

  lines.push('', '---', '*Generated by mobius push --summary*');

  return lines.join('\n');
}

/**
 * Display summary statistics to the console
 */
function displaySummaryStats(
  totalIterations: number,
  completed: number,
  failed: number,
  elapsedMinutes: number
): void {
  console.log('');
  console.log(chalk.bold('Loop Summary:'));
  console.log(chalk.gray(`  Iterations:  ${totalIterations}`));
  console.log(chalk.green(`  Completed:   ${completed}`));
  if (failed > 0) {
    console.log(chalk.red(`  Failed:      ${failed}`));
  } else {
    console.log(chalk.gray(`  Failed:      ${failed}`));
  }
  console.log(chalk.gray(`  Elapsed:     ${elapsedMinutes} minute(s)`));
}

/**
 * Get list of issues to push
 */
function getIssuesToPush(parentId: string | undefined, all: boolean | undefined): string[] {
  const issuesPath = join(getMobiusBasePath(), 'issues');

  if (!existsSync(issuesPath)) {
    return [];
  }

  if (parentId) {
    // Check if this specific issue has pending updates
    const pendingPath = getPendingUpdatesPath(parentId);
    if (existsSync(pendingPath)) {
      const queue = readPendingUpdates(parentId);
      if (queue.updates.some((u) => !u.syncedAt && !u.error)) {
        return [parentId];
      }
    }
    return [];
  }

  if (all) {
    // Find all issues with pending updates
    const issues: string[] = [];
    const dirs = readdirSync(issuesPath, { withFileTypes: true });

    for (const dir of dirs) {
      if (dir.isDirectory()) {
        const issueId = dir.name;
        const queue = readPendingUpdates(issueId);
        if (queue.updates.some((u) => !u.syncedAt && !u.error)) {
          issues.push(issueId);
        }
      }
    }

    return issues;
  }

  return [];
}

/**
 * Display pending changes in dry-run mode
 */
function displayPendingChanges(
  updates: Array<{ parentId: string; update: PendingUpdate }>,
  _backend: Backend
): void {
  // Group by parent issue
  const grouped = new Map<string, PendingUpdate[]>();
  for (const { parentId, update } of updates) {
    const existing = grouped.get(parentId) || [];
    existing.push(update);
    grouped.set(parentId, existing);
  }

  for (const [parentId, pendingUpdates] of grouped) {
    console.log(chalk.bold(`${parentId}:`));

    for (const update of pendingUpdates) {
      const typeLabel = formatUpdateType(update.type);
      const details = formatUpdateDetails(update);

      console.log(`  ${chalk.cyan(typeLabel)} ${details}`);
    }

    console.log('');
  }
}

/**
 * Format update type for display
 */
function formatUpdateType(type: string): string {
  const labels: Record<string, string> = {
    status_change: '[STATUS]',
    add_comment: '[COMMENT]',
    create_subtask: '[SUBTASK]',
    update_description: '[DESCRIPTION]',
    add_label: '[+LABEL]',
    remove_label: '[-LABEL]',
  };
  return labels[type] || `[${type.toUpperCase()}]`;
}

/**
 * Format update details for display
 */
function formatUpdateDetails(update: PendingUpdate): string {
  switch (update.type) {
    case 'status_change':
      return `${update.identifier}: ${update.oldStatus} → ${update.newStatus}`;
    case 'add_comment': {
      const truncated = update.body.length > 50 ? `${update.body.slice(0, 50)}...` : update.body;
      return `${update.identifier}: "${truncated}"`;
    }
    case 'create_subtask':
      return `${update.title} (parent: ${update.parentId})`;
    case 'update_description':
      return `${update.identifier}: Update description`;
    case 'add_label':
      return `${update.identifier}: +${update.label}`;
    case 'remove_label':
      return `${update.identifier}: -${update.label}`;
    default:
      return `${(update as PendingUpdate).id}`;
  }
}

/**
 * Push a single update to the backend
 */
async function pushUpdate(update: PendingUpdate, backend: Backend): Promise<PushResult> {
  const baseResult = {
    updateId: update.id,
    type: update.type,
    issueIdentifier: getIssueIdentifier(update),
  };

  try {
    switch (update.type) {
      case 'status_change':
        return await pushStatusChange(update, backend, baseResult);
      case 'add_comment':
        return await pushAddComment(update, backend, baseResult);
      case 'create_subtask':
        return await pushCreateSubtask(update, backend, baseResult);
      case 'update_description':
        // Not yet implemented - would need to add updateLinearIssueDescription
        return { ...baseResult, success: false, error: 'update_description not yet implemented' };
      case 'add_label':
      case 'remove_label':
        // Not yet implemented - would need to add label mutation functions
        return { ...baseResult, success: false, error: `${update.type} not yet implemented` };
      default:
        return {
          ...baseResult,
          success: false,
          error: `Unknown update type: ${(update as PendingUpdate).type}`,
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { ...baseResult, success: false, error: errorMessage };
  }
}

/**
 * Get issue identifier from update
 */
function getIssueIdentifier(update: PendingUpdate): string {
  switch (update.type) {
    case 'status_change':
    case 'add_comment':
    case 'update_description':
    case 'add_label':
    case 'remove_label':
      return update.identifier;
    case 'create_subtask':
      return update.parentId;
    default:
      return 'unknown';
  }
}

/**
 * Push a status change
 */
async function pushStatusChange(
  update: Extract<PendingUpdate, { type: 'status_change' }>,
  backend: Backend,
  baseResult: Omit<PushResult, 'success' | 'error'>
): Promise<PushResult> {
  if (backend === 'linear') {
    const result = await updateLinearIssueStatus(update.issueId, update.newStatus);
    return {
      ...baseResult,
      success: result.success,
      error: result.error,
    };
  } else {
    const success = await updateJiraIssueStatus(update.issueId, update.newStatus);
    return {
      ...baseResult,
      success,
      error: success ? undefined : 'Failed to update Jira status',
    };
  }
}

/**
 * Push an add comment operation
 */
async function pushAddComment(
  update: Extract<PendingUpdate, { type: 'add_comment' }>,
  backend: Backend,
  baseResult: Omit<PushResult, 'success' | 'error'>
): Promise<PushResult> {
  if (backend === 'linear') {
    const result = await addLinearComment(update.issueId, update.body);
    return {
      ...baseResult,
      success: result.success,
      error: result.error,
    };
  } else {
    const result = await addJiraComment(update.issueId, update.body);
    return {
      ...baseResult,
      success: result !== null,
      error: result === null ? 'Failed to add Jira comment' : undefined,
    };
  }
}

/**
 * Push a create subtask operation
 */
async function pushCreateSubtask(
  update: Extract<PendingUpdate, { type: 'create_subtask' }>,
  backend: Backend,
  baseResult: Omit<PushResult, 'success' | 'error'>
): Promise<PushResult> {
  if (backend === 'linear') {
    // For Linear, we need the team ID which should be derived from the parent
    // For now, we'll return an error indicating this needs more work
    // In a full implementation, we'd fetch the parent issue to get the team
    const result = await createLinearIssue({
      teamId: '', // Would need to be derived from parent
      title: update.title,
      description: update.description,
      parentId: update.parentId,
      blockedBy: update.blockedBy,
    });

    if (!result.success && result.error?.includes('teamId')) {
      return {
        ...baseResult,
        success: false,
        error: 'create_subtask requires team context - use refine skill instead',
      };
    }

    return {
      ...baseResult,
      success: result.success,
      error: result.error,
    };
  } else {
    // For Jira, extract project key from parent identifier
    const projectKey = update.parentId.split('-')[0];
    const result = await createJiraIssue({
      projectKey,
      issueTypeName: 'Sub-task',
      summary: update.title,
      description: update.description,
      parentKey: update.parentId,
    });

    return {
      ...baseResult,
      success: result !== null,
      error: result === null ? 'Failed to create Jira subtask' : undefined,
    };
  }
}

/**
 * Mark an update as synced
 */
function markUpdateSynced(parentId: string, updateId: string): void {
  const queue = readPendingUpdates(parentId);
  const now = new Date().toISOString();

  queue.updates = queue.updates.map((u) => {
    if (u.id === updateId) {
      return { ...u, syncedAt: now };
    }
    return u;
  });

  queue.lastSyncAttempt = now;
  queue.lastSyncSuccess = now;

  writePendingUpdates(parentId, queue);
}

/**
 * Mark an update as failed
 */
function markUpdateFailed(parentId: string, updateId: string, error: string): void {
  const queue = readPendingUpdates(parentId);
  const now = new Date().toISOString();

  queue.updates = queue.updates.map((u) => {
    if (u.id === updateId) {
      return { ...u, error };
    }
    return u;
  });

  queue.lastSyncAttempt = now;

  writePendingUpdates(parentId, queue);
}

/**
 * Log push result to sync-log.json
 */
function logPushResult(parentId: string, result: PushResult): void {
  const logPath = getSyncLogPath(parentId);
  let log: SyncLog = { entries: [] };

  if (existsSync(logPath)) {
    try {
      const content = readFileSync(logPath, 'utf-8');
      log = JSON.parse(content) as SyncLog;
    } catch {
      // Start fresh if log is corrupted
      log = { entries: [] };
    }
  }

  const entry: SyncLogEntry = {
    timestamp: new Date().toISOString(),
    updateId: result.updateId,
    type: result.type as SyncLogEntry['type'],
    issueIdentifier: result.issueIdentifier,
    success: result.success,
    error: result.error,
  };

  log.entries.push(entry);

  // Write back to file
  const contextDir = getContextPath(parentId);
  if (!existsSync(contextDir)) {
    // Context directory should exist, but create if not
    require('node:fs').mkdirSync(contextDir, { recursive: true });
  }

  writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf-8');
}

/**
 * Display push summary
 */
function displayPushSummary(results: PushResult[]): void {
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  if (successful.length > 0) {
    console.log(chalk.green('Pushed:'));
    for (const result of successful) {
      console.log(chalk.gray(`  ✓ ${formatUpdateType(result.type)} ${result.issueIdentifier}`));
    }
  }

  if (failed.length > 0) {
    console.log(chalk.red('\nFailed:'));
    for (const result of failed) {
      console.log(chalk.gray(`  ✗ ${formatUpdateType(result.type)} ${result.issueIdentifier}`));
      if (result.error) {
        console.log(chalk.gray(`    ${result.error}`));
      }
    }
  }
}
