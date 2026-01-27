/**
 * TUI entry point for Mobius
 *
 * Initializes the Ink app with the Dashboard component. Fetches initial
 * TaskGraph from the configured backend at startup, then starts state file watching.
 */

import { render } from 'ink';
import chalk from 'chalk';
import React from 'react';
import { BACKEND_ID_PATTERNS } from '../types.js';
import type { Backend, TuiConfig } from '../types.js';
import { resolvePaths } from '../lib/paths.js';
import { readConfig } from '../lib/config.js';
import { fetchLinearIssue, fetchLinearSubTasks } from '../lib/linear.js';
import type { ParentIssue } from '../lib/linear.js';
import { fetchJiraIssue, fetchJiraSubTasks } from '../lib/jira.js';
import { buildTaskGraph } from '../lib/task-graph.js';
import type { LinearIssue } from '../lib/task-graph.js';
import { clearAllActiveTasks } from '../lib/execution-state.js';
import { Dashboard } from '../tui/components/Dashboard.js';

export interface TuiOptions {
  stateDir?: string;
  showLegend?: boolean;
  panelRefreshMs?: number;
  panelLines?: number;
}

/**
 * Validate task ID format based on backend
 */
export function validateTaskId(taskId: string, backend: Backend): boolean {
  return BACKEND_ID_PATTERNS[backend].test(taskId);
}

/**
 * Fetch parent issue from the configured backend
 */
async function fetchParentIssue(taskId: string, backend: Backend): Promise<ParentIssue | null> {
  if (backend === 'jira') {
    return fetchJiraIssue(taskId);
  }
  return fetchLinearIssue(taskId);
}

/**
 * Fetch sub-tasks from the configured backend
 *
 * Note: Linear uses parentId (UUID), Jira uses parentIdentifier (key like PROJ-123)
 */
async function fetchSubTasks(
  parentId: string,
  parentIdentifier: string,
  backend: Backend
): Promise<LinearIssue[] | null> {
  if (backend === 'jira') {
    return fetchJiraSubTasks(parentIdentifier);
  }
  return fetchLinearSubTasks(parentId);
}

/**
 * Main TUI entry point
 *
 * @param taskId - Parent issue identifier (e.g., "MOB-11")
 * @param options - Optional TUI configuration
 */
export async function tui(taskId: string, options?: TuiOptions): Promise<void> {
  // 1. Load configuration (needed for backend detection)
  const paths = resolvePaths();
  const config = readConfig(paths.configPath);
  const backend = config.backend;

  // 2. Validate task ID format
  if (!validateTaskId(taskId, backend)) {
    console.error(chalk.red(`Invalid task ID format: ${taskId}`));
    console.error(chalk.gray('Expected format: PREFIX-NUMBER (e.g., MOB-11)'));
    process.exitCode = 1;
    return;
  }

  // Build TuiConfig from options and config file
  const tuiConfig: TuiConfig = {
    show_legend: options?.showLegend ?? config.execution.tui?.show_legend ?? true,
    state_dir: options?.stateDir ?? config.execution.tui?.state_dir,
    panel_refresh_ms: options?.panelRefreshMs ?? config.execution.tui?.panel_refresh_ms ?? 300,
    panel_lines: options?.panelLines ?? config.execution.tui?.panel_lines ?? 8,
  };

  // 3. Fetch dependency graph from backend
  console.log(chalk.gray(`Fetching issue ${taskId} from ${backend}...`));

  const parentIssue = await fetchParentIssue(taskId, backend);
  if (!parentIssue) {
    console.error(chalk.red(`Failed to fetch issue ${taskId} from ${backend}`));
    if (backend === 'jira') {
      console.error(chalk.gray('Make sure JIRA_HOST, JIRA_EMAIL, and JIRA_API_TOKEN are set and the issue exists.'));
    } else {
      console.error(chalk.gray('Make sure LINEAR_API_KEY is set and the issue exists.'));
    }
    process.exitCode = 1;
    return;
  }

  console.log(chalk.gray(`Fetching sub-tasks for ${parentIssue.identifier}...`));

  const subTasks = await fetchSubTasks(parentIssue.id, parentIssue.identifier, backend);
  if (!subTasks) {
    console.error(chalk.red(`Failed to fetch sub-tasks for ${taskId} from ${backend}`));
    if (backend === 'jira') {
      console.error(chalk.gray('Make sure JIRA_HOST, JIRA_EMAIL, and JIRA_API_TOKEN are set and the issue has sub-tasks.'));
    } else {
      console.error(chalk.gray('Make sure LINEAR_API_KEY is set and the issue has sub-tasks.'));
    }
    process.exitCode = 1;
    return;
  }

  if (subTasks.length === 0) {
    console.error(chalk.yellow(`Issue ${taskId} has no sub-tasks.`));
    console.error(chalk.gray('Consider running /refine-issue first to create sub-tasks.'));
    process.exitCode = 1;
    return;
  }

  // Build the task graph
  const graph = buildTaskGraph(parentIssue.id, parentIssue.identifier, subTasks);

  // Clear stale active tasks from any previous execution
  // The loop will re-populate this when tasks actually start running
  clearAllActiveTasks(taskId, tuiConfig.state_dir);

  console.log(chalk.gray(`Found ${graph.tasks.size} sub-tasks. Starting TUI...`));
  console.log(''); // Empty line before TUI

  // 4. Initialize Ink render with Dashboard
  const { waitUntilExit, unmount } = render(
    React.createElement(Dashboard, {
      parentId: taskId,
      graph: graph,
      config: tuiConfig,
    }),
    {
      // Intercept console output to prevent it from breaking Ink's layout
      patchConsole: true,
    }
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
