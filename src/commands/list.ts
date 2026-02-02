/**
 * List command - Display local issues with interactive selector
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { select } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { readConfig } from '../lib/config.js';
import { getProjectMobiusPath, readParentSpec } from '../lib/local-state.js';
import { resolvePaths } from '../lib/paths.js';
import { syncBackendStatuses } from '../lib/status-sync.js';
import type { Backend } from '../types.js';

export interface ListOptions {
  backend?: Backend;
}

/**
 * List all local issues and present an interactive selector.
 * Outputs the selected issue identifier to stdout.
 */
export async function list(options: ListOptions = {}): Promise<void> {
  const paths = resolvePaths();
  const config = readConfig(paths.configPath);
  const backend = options.backend ?? config.backend;

  // Sync statuses from backend before displaying
  const syncSpinner = ora({
    text: 'Syncing statuses from backend...',
    stream: process.stderr,
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

  const issuesPath = join(getProjectMobiusPath(), 'issues');

  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = readdirSync(issuesPath, { withFileTypes: true });
  } catch {
    console.error(chalk.yellow('No local issues found.'));
    console.error(chalk.gray('Run `mobius refine <issue-id>` to create local issue state.'));
    return;
  }

  const dirs = entries.filter((e) => e.isDirectory());

  if (dirs.length === 0) {
    console.error(chalk.yellow('No local issues found.'));
    console.error(chalk.gray('Run `mobius refine <issue-id>` to create local issue state.'));
    return;
  }

  const choices: Array<{ name: string; value: string }> = [];

  for (const dir of dirs) {
    const issueId = dir.name;
    const spec = readParentSpec(issueId);
    if (!spec) continue;

    const statusColor =
      spec.status === 'Done'
        ? chalk.green
        : spec.status === 'In Progress'
          ? chalk.cyan
          : chalk.gray;

    choices.push({
      name: `${chalk.bold(spec.identifier)}  ${spec.title}  ${statusColor(`[${spec.status}]`)}`,
      value: spec.identifier,
    });
  }

  if (choices.length === 0) {
    console.error(chalk.yellow('No valid local issues found.'));
    console.error(chalk.gray('Issue directories exist but parent specs could not be read.'));
    return;
  }

  const selected = await select(
    { message: 'Select an issue:', choices },
    { output: process.stderr }
  );

  console.log(selected);
}
