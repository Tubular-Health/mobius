/**
 * Tree command - Display sub-task dependency tree without execution
 */

import chalk from 'chalk';
import ora from 'ora';
import { readConfig } from '../lib/config.js';
import { fetchJiraIssue } from '../lib/jira.js';
import type { ParentIssue } from '../lib/linear.js';
import { fetchLinearIssue } from '../lib/linear.js';
import { readLocalSubTasksAsLinearIssues, readParentSpec } from '../lib/local-state.js';
import { renderMermaidWithTitle } from '../lib/mermaid-renderer.js';
import { resolvePaths } from '../lib/paths.js';
import { buildTaskGraph, getGraphStats } from '../lib/task-graph.js';
import { renderFullTreeOutput } from '../lib/tree-renderer.js';
import type { Backend } from '../types.js';
import { BACKEND_ID_PATTERNS } from '../types.js';

export interface TreeOptions {
  backend?: Backend;
  mermaid?: boolean;
}

/**
 * Display sub-task dependency tree for a Linear issue
 */
export async function tree(taskId: string, options: TreeOptions): Promise<void> {
  const paths = resolvePaths();
  const config = readConfig(paths.configPath);
  const backend = options.backend ?? config.backend;

  // Validate task ID format
  const pattern = BACKEND_ID_PATTERNS[backend];
  if (!pattern.test(taskId)) {
    console.error(chalk.red(`Error: Invalid task ID format for ${backend}: ${taskId}`));
    console.error(chalk.gray('Expected format: PREFIX-NUMBER (e.g., MOB-123)'));
    process.exit(1);
  }

  // Fetch parent issue with spinner (backend-aware)
  const issueSpinner = ora({
    text: backend === 'local'
      ? `Reading issue ${taskId} from local state...`
      : `Fetching issue ${taskId} from ${backend}...`,
    color: 'blue',
  }).start();

  let parentIssue: ParentIssue | null = null;

  if (backend === 'local') {
    const parentSpec = readParentSpec(taskId);
    if (parentSpec) {
      parentIssue = {
        id: parentSpec.id,
        identifier: parentSpec.identifier,
        title: parentSpec.title,
        gitBranchName: parentSpec.gitBranchName,
      };
    }
  } else if (backend === 'jira') {
    parentIssue = await fetchJiraIssue(taskId);
  } else {
    parentIssue = await fetchLinearIssue(taskId);
  }

  if (!parentIssue) {
    issueSpinner.fail(`Could not fetch issue ${taskId}`);
    process.exit(1);
  }

  issueSpinner.succeed(`${parentIssue.identifier}: ${parentIssue.title}`);
  console.log(chalk.gray(`  Branch: ${parentIssue.gitBranchName}`));

  // Read sub-tasks from local state
  const subTasksSpinner = ora({
    text: `Reading sub-tasks from local state...`,
    color: 'blue',
  }).start();

  const subTasks = readLocalSubTasksAsLinearIssues(taskId);
  if (subTasks.length === 0) {
    subTasksSpinner.warn(`No sub-tasks found for ${taskId}`);
    return;
  }

  subTasksSpinner.succeed(`Found ${subTasks.length} sub-task${subTasks.length === 1 ? '' : 's'}`);

  // Build the graph
  const graph = buildTaskGraph(parentIssue.id, parentIssue.identifier, subTasks);

  // Display ASCII tree
  console.log('');
  console.log(renderFullTreeOutput(graph));

  // Optionally display Mermaid diagram
  if (options.mermaid) {
    console.log('');
    console.log(chalk.bold('Mermaid Diagram:'));
    console.log(renderMermaidWithTitle(graph));
  }

  // Display summary stats
  const stats = getGraphStats(graph);
  console.log('');
  console.log(chalk.bold('Summary:'));
  console.log(`  Total: ${stats.total}`);
  console.log(`  Done: ${chalk.green(stats.done.toString())}`);
  console.log(`  Ready: ${chalk.blue(stats.ready.toString())}`);
  console.log(`  Blocked: ${chalk.yellow(stats.blocked.toString())}`);
  console.log(`  In Progress: ${chalk.cyan(stats.inProgress.toString())}`);
}
