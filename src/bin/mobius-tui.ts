/**
 * TUI entry point for Mobius
 *
 * Initializes the Ink app with the Dashboard component. Fetches initial
 * TaskGraph from the configured backend at startup, then starts state file watching.
 */

import chalk from 'chalk';
import { render } from 'ink';
import React from 'react';
import { readConfig } from '../lib/config.js';
import { clearAllRuntimeActiveTasks } from '../lib/context-generator.js';
import { fetchJiraIssue } from '../lib/jira.js';
import type { ParentIssue } from '../lib/linear.js';
import { fetchLinearIssue } from '../lib/linear.js';
import { readLocalSubTasksAsLinearIssues, readParentSpec } from '../lib/local-state.js';
import { resolvePaths } from '../lib/paths.js';
import { buildTaskGraph } from '../lib/task-graph.js';
import { Dashboard } from '../tui/components/Dashboard.js';
import { EXIT_REQUEST_EVENT, tuiEvents } from '../tui/events.js';
import type { Backend, TuiConfig } from '../types.js';
import { BACKEND_ID_PATTERNS, resolveBackend } from '../types.js';

export interface TuiOptions {
  stateDir?: string;
  showLegend?: boolean;
  panelRefreshMs?: number;
  panelLines?: number;
  backend?: Backend;
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
 * Main TUI entry point
 *
 * @param taskId - Parent issue identifier (e.g., "MOB-11")
 * @param options - Optional TUI configuration
 */
export async function tui(taskId: string, options?: TuiOptions): Promise<void> {
  // 1. Load configuration (needed for backend detection)
  const paths = resolvePaths();
  const config = readConfig(paths.configPath);
  const backend = resolveBackend(options?.backend, taskId, config.backend);

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

  // 3. Fetch parent issue from backend (or local state), always read sub-tasks locally
  let parentIssue: ParentIssue | null;

  if (backend === 'local') {
    // Local mode: read parent from .mobius/issues/{id}/parent.json
    console.log(chalk.gray(`Reading issue ${taskId} from local state...`));

    const parentSpec = readParentSpec(taskId);
    if (!parentSpec) {
      console.error(chalk.red(`No local state found for ${taskId}`));
      console.error(chalk.gray('Run /refine first to create local sub-tasks.'));
      process.exitCode = 1;
      return;
    }

    parentIssue = {
      id: parentSpec.id,
      identifier: parentSpec.identifier,
      title: parentSpec.title,
      gitBranchName: parentSpec.gitBranchName,
    };
  } else {
    // Remote mode: fetch parent from Linear/Jira API
    console.log(chalk.gray(`Fetching issue ${taskId} from ${backend}...`));

    parentIssue = await fetchParentIssue(taskId, backend);
    if (!parentIssue) {
      console.error(chalk.red(`Failed to fetch issue ${taskId} from ${backend}`));
      if (backend === 'jira') {
        console.error(
          chalk.gray(
            'Make sure JIRA_HOST, JIRA_EMAIL, and JIRA_API_TOKEN are set and the issue exists.'
          )
        );
      } else {
        console.error(chalk.gray('Make sure LINEAR_API_KEY is set and the issue exists.'));
      }
      process.exitCode = 1;
      return;
    }
  }

  // Always read sub-tasks from local state
  const subTasks = readLocalSubTasksAsLinearIssues(taskId);

  if (subTasks.length === 0) {
    console.error(chalk.yellow(`Issue ${taskId} has no sub-tasks.`));
    console.error(chalk.gray('Consider running /refine first to create sub-tasks.'));
    process.exitCode = 1;
    return;
  }

  // Build the task graph
  const graph = buildTaskGraph(parentIssue.id, parentIssue.identifier, subTasks);

  // Clear stale active tasks from any previous execution
  // The loop will re-populate this when tasks actually start running
  clearAllRuntimeActiveTasks(taskId);

  console.log(chalk.gray(`Found ${graph.tasks.size} sub-tasks. Starting TUI...`));
  console.log(''); // Empty line before TUI

  // 4. Initialize Ink render with Dashboard
  // Pass the API graph separately so we can show both local execution state
  // and backend state side-by-side in the TUI
  const { waitUntilExit, unmount } = render(
    React.createElement(Dashboard, {
      parentId: taskId,
      graph: graph,
      apiGraph: graph, // Unmodified API graph for backend status display
      backend: backend,
      config: tuiConfig,
    }),
    {
      // Intercept console output to prevent it from breaking Ink's layout
      patchConsole: true,
    }
  );

  // 5. Handle SIGINT (ctrl+c) by emitting exit-request event
  // This allows the Dashboard to show confirmation modal before exiting
  // Track if we've already started handling an exit to prevent multiple triggers
  let exitRequested = false;

  const handleSigInt = () => {
    if (exitRequested) {
      // Second ctrl+c - force exit immediately
      unmount();
      return;
    }
    exitRequested = true;
    // Emit event for Dashboard to handle (show confirmation modal)
    tuiEvents.emit(EXIT_REQUEST_EVENT);
  };

  // SIGTERM should still exit immediately (used by system/process managers)
  const handleSigTerm = () => {
    unmount();
  };

  process.on('SIGINT', handleSigInt);
  process.on('SIGTERM', handleSigTerm);

  // Wait for the TUI to exit
  await waitUntilExit();

  // Remove signal handlers after clean exit
  process.off('SIGINT', handleSigInt);
  process.off('SIGTERM', handleSigTerm);
  tuiEvents.removeAllListeners(EXIT_REQUEST_EVENT);
}

export default tui;
