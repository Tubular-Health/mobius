/**
 * Status sync - Fetch current issue statuses from backend and update local parent.json files
 *
 * Used by `clean` and `list` commands to ensure local state reflects
 * the actual backend status before making decisions or displaying info.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Backend } from '../types.js';
import { BACKEND_ID_PATTERNS } from '../types.js';
import { fetchJiraIssueStatus } from './jira.js';
import { fetchLinearIssueStatus } from './linear.js';
import { getProjectMobiusPath, readParentSpec, updateParentStatus } from './local-state.js';

export interface SyncResult {
  synced: number;
  failed: number;
  skipped: number;
}

/**
 * Fetch current status from the appropriate backend.
 * Returns null on error or for unsupported backends.
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
 * Sync backend statuses for all non-local issues in .mobius/issues/.
 *
 * Scans issue directories, fetches current status from the backend,
 * and updates local parent.json files so subsequent reads see fresh data.
 */
export async function syncBackendStatuses(backend: Backend): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, failed: 0, skipped: 0 };

  if (backend === 'local') {
    return result;
  }

  const issuesPath = join(getProjectMobiusPath(), 'issues');

  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = readdirSync(issuesPath, { withFileTypes: true });
  } catch {
    return result;
  }

  const dirs = entries.filter((e) => e.isDirectory());

  for (const dir of dirs) {
    const issueId = dir.name;

    // Skip local-only issues — no backend to sync
    if (BACKEND_ID_PATTERNS.local.test(issueId)) {
      result.skipped++;
      continue;
    }

    const spec = readParentSpec(issueId);
    if (!spec) {
      result.skipped++;
      continue;
    }

    const backendStatus = await fetchBackendStatus(issueId, backend);
    if (backendStatus === null) {
      result.failed++;
      continue;
    }

    // Only write if status actually changed
    if (spec.status !== backendStatus) {
      updateParentStatus(issueId, backendStatus);
    }
    result.synced++;
  }

  return result;
}
