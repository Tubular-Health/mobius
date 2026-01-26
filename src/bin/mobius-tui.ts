/**
 * TUI entry point for Mobius
 *
 * Initializes the Ink app with the Dashboard component. Fetches initial
 * TaskGraph from Linear at startup, then starts state file watching.
 */

import { render } from 'ink';
import chalk from 'chalk';
import React from 'react';
import { BACKEND_ID_PATTERNS } from '../types.js';
import type { TuiConfig } from '../types.js';
import { resolvePaths } from '../lib/paths.js';
import { readConfig } from '../lib/config.js';
import { fetchLinearIssue, fetchLinearSubTasks } from '../lib/linear.js';
import { buildTaskGraph } from '../lib/task-graph.js';
import { Dashboard } from '../tui/components/Dashboard.js';

export interface TuiOptions {
  stateDir?: string;
  showLegend?: boolean;
  panelRefreshMs?: number;
  panelLines?: number;
}

/**
 * Validate task ID format
 */
function validateTaskId(taskId: string): boolean {
  return BACKEND_ID_PATTERNS.linear.test(taskId);
}

/**
 * Main TUI entry point
 *
 * @param taskId - Parent issue identifier (e.g., "MOB-11")
 * @param options - Optional TUI configuration
 */
export async function tui(taskId: string, options?: TuiOptions): Promise<void> {
  // 1. Validate task ID format
  if (!validateTaskId(taskId)) {
    console.error(chalk.red(`Invalid task ID format: ${taskId}`));
    console.error(chalk.gray('Expected format: PREFIX-NUMBER (e.g., MOB-11)'));
    process.exitCode = 1;
    return;
  }

  // 2. Load configuration
  const paths = resolvePaths();
  const config = readConfig(paths.configPath);

  // Build TuiConfig from options and config file
  const tuiConfig: TuiConfig = {
    show_legend: options?.showLegend ?? config.execution.tui?.show_legend ?? true,
    state_dir: options?.stateDir ?? config.execution.tui?.state_dir,
    panel_refresh_ms: options?.panelRefreshMs ?? config.execution.tui?.panel_refresh_ms ?? 300,
    panel_lines: options?.panelLines ?? config.execution.tui?.panel_lines ?? 8,
  };

  // 3. Fetch dependency graph from Linear
  console.log(chalk.gray(`Fetching issue ${taskId} from Linear...`));

  const parentIssue = await fetchLinearIssue(taskId);
  if (!parentIssue) {
    console.error(chalk.red(`Failed to fetch issue ${taskId} from Linear`));
    console.error(chalk.gray('Make sure LINEAR_API_KEY is set and the issue exists.'));
    process.exitCode = 1;
    return;
  }

  console.log(chalk.gray(`Fetching sub-tasks for ${parentIssue.identifier}...`));

  const subTasks = await fetchLinearSubTasks(parentIssue.id);
  if (!subTasks) {
    console.error(chalk.red(`Failed to fetch sub-tasks for ${taskId}`));
    console.error(chalk.gray('Make sure LINEAR_API_KEY is set and the issue has sub-tasks.'));
    process.exitCode = 1;
    return;
  }

  if (subTasks.length === 0) {
    console.error(chalk.yellow(`Issue ${taskId} has no sub-tasks.`));
    console.error(chalk.gray('Consider running /refine-linear-issue first to create sub-tasks.'));
    process.exitCode = 1;
    return;
  }

  // Build the task graph
  const graph = buildTaskGraph(parentIssue.id, parentIssue.identifier, subTasks);

  console.log(chalk.gray(`Found ${graph.tasks.size} sub-tasks. Starting TUI...`));
  console.log(''); // Empty line before TUI

  // 4. Initialize Ink render with Dashboard
  const { waitUntilExit, unmount } = render(
    React.createElement(Dashboard, {
      parentId: taskId,
      graph: graph,
      config: tuiConfig,
    })
  );

  // 5. Handle cleanup on exit (SIGINT)
  const cleanup = () => {
    unmount();
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Wait for the TUI to exit
  await waitUntilExit();

  // Remove signal handlers after clean exit
  process.off('SIGINT', cleanup);
  process.off('SIGTERM', cleanup);
}

export default tui;
