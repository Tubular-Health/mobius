/**
 * List command - Display local issues with interactive selector
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { select } from '@inquirer/prompts';
import chalk from 'chalk';
import { getProjectMobiusPath, readParentSpec } from '../lib/local-state.js';

/**
 * List all local issues and present an interactive selector.
 * Outputs the selected issue identifier to stdout.
 */
export async function list(): Promise<void> {
  const issuesPath = join(getProjectMobiusPath(), 'issues');

  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = readdirSync(issuesPath, { withFileTypes: true });
  } catch {
    console.log(chalk.yellow('No local issues found.'));
    console.log(chalk.gray('Run `mobius refine <issue-id>` to create local issue state.'));
    return;
  }

  const dirs = entries.filter((e) => e.isDirectory());

  if (dirs.length === 0) {
    console.log(chalk.yellow('No local issues found.'));
    console.log(chalk.gray('Run `mobius refine <issue-id>` to create local issue state.'));
    return;
  }

  const choices: Array<{ name: string; value: string }> = [];

  for (const dir of dirs) {
    const issueId = dir.name;
    const spec = readParentSpec(issueId);
    if (!spec) continue;

    const statusColor =
      spec.status === 'Done' ? chalk.green :
      spec.status === 'In Progress' ? chalk.cyan :
      chalk.gray;

    choices.push({
      name: `${chalk.bold(spec.identifier)}  ${spec.title}  ${statusColor(`[${spec.status}]`)}`,
      value: spec.identifier,
    });
  }

  if (choices.length === 0) {
    console.log(chalk.yellow('No valid local issues found.'));
    console.log(chalk.gray('Issue directories exist but parent specs could not be read.'));
    return;
  }

  const selected = await select({
    message: 'Select an issue:',
    choices,
  });

  console.log(selected);
}
