/**
 * Clean command - Remove completed issue directories from .mobius/issues/
 *
 * Verifies completion status against both local state and the backend
 * (Linear/Jira) before removing issue directories.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { readConfig } from '../lib/config.js';
import { cleanupContext } from '../lib/context-generator.js';
import { fetchJiraIssueStatus } from '../lib/jira.js';
import { fetchLinearIssueStatus } from '../lib/linear.js';
import { getProjectMobiusPath, readParentSpec } from '../lib/local-state.js';
import { resolvePaths } from '../lib/paths.js';
import { syncBackendStatuses } from '../lib/status-sync.js';
import type { Backend } from '../types.js';
import { BACKEND_ID_PATTERNS } from '../types.js';

export interface CleanOptions {
  dryRun?: boolean;
  backend?: Backend;
}

interface IssueCleanupCandidate {
  identifier: string;
  title: string;
  localStatus: string;
  backendStatus: string | null;
}

/**
 * Check if a status represents a completed issue for the given backend.
 */
function isCompletedStatus(status: string, backend: Backend): boolean {
  switch (backend) {
    case 'linear':
      return ['Done', 'Canceled', 'Cancelled'].includes(status);
    case 'jira':
      return ['Done', 'Closed'].includes(status);
    case 'local':
      return status === 'done';
    default:
      return false;
  }
}

/**
 * Fetch the current status of an issue from the backend.
 * Returns null for local issues or on API error.
 */
async function fetchBackendStatus(issueId: string, backend: Backend): Promise<string | null> {
  switch (backend) {
    case 'linear':
      return fetchLinearIssueStatus(issueId);
    case 'jira':
      return fetchJiraIssueStatus(issueId);
    case 'local':
      return null;
    default:
      return null;
  }
}

/**
 * Scan .mobius/issues/ directory for completed issues eligible for cleanup.
 *
 * For LOC-* issues, checks local status only.
 * For Linear/Jira issues, checks BOTH local AND backend status.
 * Skips issues where backend status is unreachable.
 */
async function scanIssuesForCleanup(backend: Backend): Promise<IssueCleanupCandidate[]> {
  const issuesPath = join(getProjectMobiusPath(), 'issues');

  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = readdirSync(issuesPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const dirs = entries.filter((e) => e.isDirectory());
  const candidates: IssueCleanupCandidate[] = [];

  for (const dir of dirs) {
    const issueId = dir.name;
    const spec = readParentSpec(issueId);
    if (!spec) continue;

    const isLocal = BACKEND_ID_PATTERNS.local.test(issueId);

    if (isLocal) {
      // Local issues: check local status only
      if (isCompletedStatus(spec.status, 'local')) {
        candidates.push({
          identifier: spec.identifier,
          title: spec.title,
          localStatus: spec.status,
          backendStatus: null,
        });
      }
    } else {
      // Linear/Jira issues: check BOTH local and backend status
      const localCompleted = isCompletedStatus(spec.status, backend);
      if (!localCompleted) continue;

      const backendStatus = await fetchBackendStatus(issueId, backend);
      if (backendStatus === null) {
        // Backend unreachable — skip this issue
        continue;
      }

      if (isCompletedStatus(backendStatus, backend)) {
        candidates.push({
          identifier: spec.identifier,
          title: spec.title,
          localStatus: spec.status,
          backendStatus,
        });
      }
    }
  }

  return candidates;
}

/**
 * Remove completed issues from .mobius/issues/ directory.
 *
 * Scans for completed issues, displays them, and prompts for confirmation
 * before deletion. Supports --dry-run for preview without deletion.
 */
export async function clean(options: CleanOptions): Promise<void> {
  const paths = resolvePaths();
  const config = readConfig(paths.configPath);
  const backend = options.backend ?? config.backend;

  // Sync statuses from backend before scanning
  const syncSpinner = ora({
    text: 'Syncing statuses from backend...',
    color: 'blue',
  }).start();

  const syncResult = await syncBackendStatuses(backend);

  if (syncResult.synced > 0 || syncResult.failed > 0) {
    const parts: string[] = [];
    if (syncResult.synced > 0) parts.push(`${syncResult.synced} synced`);
    if (syncResult.failed > 0) parts.push(`${syncResult.failed} unreachable`);
    syncSpinner.succeed(`Status sync: ${parts.join(', ')}`);
  } else {
    syncSpinner.succeed('Status sync complete.');
  }

  const spinner = ora({
    text: 'Scanning for completed issues...',
    color: 'blue',
  }).start();

  const candidates = await scanIssuesForCleanup(backend);

  if (candidates.length === 0) {
    spinner.succeed('No completed issues found to clean up.');
    return;
  }

  spinner.succeed(
    `Found ${candidates.length} completed issue${candidates.length === 1 ? '' : 's'}:`
  );
  console.log('');

  for (const candidate of candidates) {
    const statusInfo = candidate.backendStatus
      ? `local: ${candidate.localStatus}, backend: ${candidate.backendStatus}`
      : `local: ${candidate.localStatus}`;
    console.log(
      `  ${chalk.cyan(candidate.identifier)}  ${candidate.title}  ${chalk.gray(`(${statusInfo})`)}`
    );
  }
  console.log('');

  if (options.dryRun) {
    console.log(chalk.yellow('Dry run — no issues were removed.'));
    return;
  }

  const confirmed = await confirm({
    message: `Remove ${candidates.length} completed issue${candidates.length === 1 ? '' : 's'} from local state?`,
    default: false,
  });

  if (!confirmed) {
    console.log(chalk.gray('Aborted.'));
    return;
  }

  let success = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      cleanupContext(candidate.identifier);
      success++;
    } catch (error) {
      failed++;
      console.warn(
        chalk.yellow(
          `  Warning: Failed to remove ${candidate.identifier}: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  if (failed === 0) {
    console.log(chalk.green(`Removed ${success} issue${success === 1 ? '' : 's'}.`));
  } else {
    console.log(chalk.yellow(`Removed ${success}, failed ${failed}.`));
  }
}
