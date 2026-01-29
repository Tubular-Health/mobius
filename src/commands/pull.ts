/**
 * Pull command - Fetch fresh context from Linear/Jira
 *
 * Downloads the latest issue data from the configured backend and
 * writes it to the local context files.
 */

import chalk from 'chalk';
import ora from 'ora';
import { readConfig } from '../lib/config.js';
import {
  generateContext,
  getFullContextPath,
  resolveTaskId,
  writeFullContextFile,
} from '../lib/context-generator.js';
import { resolvePaths } from '../lib/paths.js';
import type { Backend } from '../types.js';
import { BACKEND_ID_PATTERNS } from '../types.js';

export interface PullOptions {
  backend?: Backend;
}

/**
 * Pull fresh context from Linear/Jira
 *
 * @param taskId - Optional task ID (falls back to current task)
 * @param options - Command options
 */
export async function pull(taskId: string | undefined, options: PullOptions): Promise<void> {
  // Resolve task ID
  const resolvedId = resolveTaskId(taskId);

  if (!resolvedId) {
    console.error(chalk.red('Error: No task ID provided and no current task set'));
    console.error(chalk.gray('Usage: mobius pull <task-id>'));
    console.error(chalk.gray('Or set a current task: mobius set-id <task-id>'));
    process.exit(1);
  }

  // Resolve backend from options or config
  const paths = resolvePaths();
  const config = readConfig(paths.configPath);
  const backend = options.backend ?? config.backend;

  // Validate task ID format
  const pattern = BACKEND_ID_PATTERNS[backend];
  if (!pattern.test(resolvedId)) {
    console.error(chalk.red(`Error: Invalid task ID format for ${backend}: ${resolvedId}`));
    console.error(chalk.gray('Expected format: PREFIX-NUMBER (e.g., MOB-123)'));
    process.exit(1);
  }

  // Fetch context
  const spinner = ora({
    text: `Fetching context for ${chalk.cyan(resolvedId)} from ${backend}...`,
    color: 'blue',
  }).start();

  try {
    const context = await generateContext(resolvedId, {
      forceRefresh: true,
    });

    if (!context) {
      spinner.fail(`Failed to fetch context for ${resolvedId}`);
      console.error(chalk.red(`Could not find issue ${resolvedId} in ${backend}`));
      process.exit(1);
    }

    // Write the full context file
    writeFullContextFile(resolvedId, context);

    spinner.succeed(`Context fetched for ${chalk.cyan(resolvedId)}`);

    // Display summary
    console.log('');
    console.log(chalk.bold('Summary:'));
    console.log(`  Parent:     ${chalk.cyan(context.parent.identifier)} - ${context.parent.title}`);
    console.log(`  Status:     ${context.parent.status}`);
    console.log(`  Sub-tasks:  ${context.subTasks.length}`);

    // Status breakdown
    if (context.subTasks.length > 0) {
      const statusCounts = new Map<string, number>();
      for (const task of context.subTasks) {
        const count = statusCounts.get(task.status) || 0;
        statusCounts.set(task.status, count + 1);
      }

      console.log('');
      console.log(chalk.bold('Status breakdown:'));
      for (const [status, count] of statusCounts) {
        const statusColor = getStatusColor(status);
        console.log(`  ${statusColor(status)}: ${count}`);
      }
    }

    console.log('');
    console.log(chalk.gray(`Context written to: ${getFullContextPath(resolvedId)}`));
  } catch (error) {
    spinner.fail(`Failed to fetch context for ${resolvedId}`);
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

/**
 * Get chalk color function for a status
 */
function getStatusColor(status: string): typeof chalk {
  switch (status.toLowerCase()) {
    case 'done':
    case 'completed':
      return chalk.green;
    case 'in progress':
    case 'in_progress':
      return chalk.blue;
    case 'blocked':
      return chalk.red;
    case 'ready':
      return chalk.cyan;
    default:
      return chalk.gray;
  }
}
