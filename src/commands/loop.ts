/**
 * TypeScript loop orchestrator command
 *
 * Orchestrates parallel execution of sub-tasks with worktree isolation
 * and tmux-based display.
 */

import chalk from 'chalk';
import { execa } from 'execa';
import which from 'which';
import { resolvePaths } from '../lib/paths.js';
import { readConfig } from '../lib/config.js';
import { BACKEND_ID_PATTERNS } from '../types.js';
import type { Backend, Model, ExecutionConfig } from '../types.js';
import { createWorktree, removeWorktree } from '../lib/worktree.js';
import {
  buildTaskGraph,
  getReadyTasks,
  getBlockedTasks,
  getGraphStats,
  updateTaskStatus,
  type TaskGraph,
  type LinearIssue,
} from '../lib/task-graph.js';
import { renderFullTreeOutput } from '../lib/tree-renderer.js';
import { renderMermaidWithTitle } from '../lib/mermaid-renderer.js';
import {
  createSession,
  createStatusPane,
  destroySession,
  updateStatusPane,
  getSessionName,
  type TmuxSession,
  type TmuxPane,
  type LoopStatus,
} from '../lib/tmux-display.js';
import {
  executeParallel,
  aggregateResults,
  calculateParallelism,
} from '../lib/parallel-executor.js';

export interface LoopOptions {
  maxIterations?: number;
  local?: boolean;
  backend?: Backend;
  model?: Model;
  parallel?: number; // Override max_parallel_agents
  sequential?: boolean; // Use sequential bash loop instead
}

interface ParentIssue {
  id: string;
  identifier: string;
  title: string;
  gitBranchName: string;
}

/**
 * Main loop orchestrator function
 */
export async function loop(taskId: string, options: LoopOptions): Promise<void> {
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

  // Check for tmux availability
  const tmuxAvailable = await checkTmuxAvailable();
  if (!tmuxAvailable) {
    console.error(chalk.red('Error: tmux is required for parallel execution mode'));
    console.error(chalk.gray('Install with: brew install tmux (macOS) or apt install tmux (Linux)'));
    console.error(chalk.gray("Alternatively, use '--sequential' flag for sequential execution."));
    process.exit(1);
  }

  // Apply option overrides to config
  const executionConfig: ExecutionConfig = {
    ...config.execution,
    ...(options.parallel !== undefined && { max_parallel_agents: options.parallel }),
    ...(options.model !== undefined && { model: options.model }),
  };

  const maxIterations = options.maxIterations ?? config.execution.max_iterations;

  console.log(chalk.blue(`Starting parallel loop for ${taskId}...`));

  // Fetch parent issue to get git branch name
  const parentIssue = await fetchParentIssue(taskId, backend);
  if (!parentIssue) {
    console.error(chalk.red(`Error: Could not fetch issue ${taskId}`));
    process.exit(1);
  }

  console.log(chalk.gray(`Issue: ${parentIssue.title}`));
  console.log(chalk.gray(`Branch: ${parentIssue.gitBranchName}`));

  // Create or resume worktree
  const worktreeInfo = await createWorktree(
    taskId,
    parentIssue.gitBranchName,
    executionConfig
  );

  if (worktreeInfo.created) {
    console.log(chalk.green(`Created worktree at ${worktreeInfo.path}`));
  } else {
    console.log(chalk.yellow(`Resuming existing worktree at ${worktreeInfo.path}`));
  }

  // Create tmux session
  const sessionName = getSessionName(taskId);
  let session: TmuxSession;
  let statusPane: TmuxPane;

  try {
    session = await createSession(sessionName);
    statusPane = await createStatusPane(session);
    console.log(chalk.green(`Created tmux session: ${sessionName}`));
  } catch (error) {
    console.error(chalk.red('Error: Failed to create tmux session'));
    console.error(chalk.gray(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }

  // Build initial task graph
  let graph = await buildInitialGraph(taskId, parentIssue, backend);
  if (!graph) {
    console.error(chalk.red('Error: Failed to build task graph'));
    await destroySession(session);
    process.exit(1);
  }

  // Display ASCII tree
  console.log('');
  console.log(renderFullTreeOutput(graph));
  console.log('');

  // Post Mermaid diagram to parent issue
  await postMermaidDiagram(taskId, graph, backend);

  // Track loop state
  const startTime = Date.now();
  let iteration = 0;
  let allComplete = false;
  let anyFailed = false;

  try {
    // Main execution loop
    while (iteration < maxIterations) {
      iteration++;

      // Get ready tasks
      const readyTasks = getReadyTasks(graph);
      const stats = getGraphStats(graph);

      // Check completion conditions
      if (stats.done === stats.total) {
        allComplete = true;
        console.log(chalk.green('\nAll tasks completed!'));
        break;
      }

      if (readyTasks.length === 0) {
        const blockedTasks = getBlockedTasks(graph);
        if (blockedTasks.length > 0) {
          console.log(chalk.yellow('\nNo tasks ready. All remaining tasks are blocked.'));
          console.log(
            chalk.gray(`Blocked: ${blockedTasks.map(t => t.identifier).join(', ')}`)
          );
        }
        break;
      }

      // Calculate parallelism
      const parallelCount = calculateParallelism(readyTasks.length, executionConfig);
      console.log(
        chalk.blue(
          `\nIteration ${iteration}: Executing ${parallelCount} task(s) in parallel...`
        )
      );

      // Update status pane
      const loopStatus: LoopStatus = {
        totalTasks: stats.total,
        completedTasks: stats.done,
        activeAgents: readyTasks.slice(0, parallelCount).map(t => ({
          taskId: t.id,
          identifier: t.identifier,
        })),
        blockedTasks: getBlockedTasks(graph).map(t => t.identifier),
        elapsed: Date.now() - startTime,
      };
      await updateStatusPane(statusPane, loopStatus);

      // Execute tasks in parallel
      const results = await executeParallel(
        readyTasks,
        executionConfig,
        worktreeInfo.path,
        session,
        taskId
      );

      // Process results and update graph
      const aggregated = aggregateResults(results);
      console.log(
        chalk.gray(
          `Completed: ${aggregated.succeeded}/${aggregated.total} succeeded`
        )
      );

      for (const result of results) {
        if (result.success) {
          graph = updateTaskStatus(graph, result.taskId, 'done');
          console.log(chalk.green(`  ✓ ${result.identifier}`));
        } else {
          anyFailed = true;
          console.log(chalk.red(`  ✗ ${result.identifier}: ${result.error ?? result.status}`));
        }
      }

      // If any task failed, stop the loop
      if (anyFailed) {
        console.log(chalk.red('\nStopping due to task failure.'));
        break;
      }

      // Re-render ASCII tree with updated status
      console.log('');
      console.log(renderFullTreeOutput(graph));
    }

    // Final status
    const finalStats = getGraphStats(graph);
    console.log('');
    console.log(chalk.bold('Loop completed:'));
    console.log(`  Iterations: ${iteration}`);
    console.log(`  Tasks: ${finalStats.done}/${finalStats.total} completed`);
    console.log(`  Time: ${formatElapsed(Date.now() - startTime)}`);

    // Cleanup on success
    if (allComplete && executionConfig.cleanup_on_success !== false) {
      console.log(chalk.gray('\nCleaning up worktree...'));
      await removeWorktree(taskId, executionConfig);
      console.log(chalk.green('Worktree removed.'));

      // Destroy session on success
      await destroySession(session);
      console.log(chalk.green('tmux session destroyed.'));
    } else if (anyFailed) {
      console.log(chalk.yellow('\nWorktree preserved for debugging at:'));
      console.log(chalk.gray(`  ${worktreeInfo.path}`));
      console.log(chalk.yellow('tmux session preserved. Attach with:'));
      console.log(chalk.gray(`  tmux attach -t ${sessionName}`));
    } else {
      // Not all complete, but no failures (e.g., all blocked)
      console.log(chalk.yellow('\nWorktree preserved at:'));
      console.log(chalk.gray(`  ${worktreeInfo.path}`));
      console.log(chalk.yellow('tmux session:'));
      console.log(chalk.gray(`  tmux attach -t ${sessionName}`));
    }
  } catch (error) {
    console.error(chalk.red('\nLoop error:'));
    console.error(chalk.gray(error instanceof Error ? error.message : String(error)));
    console.log(chalk.yellow('\nWorktree preserved for debugging at:'));
    console.log(chalk.gray(`  ${worktreeInfo.path}`));
    console.log(chalk.yellow('tmux session preserved. Attach with:'));
    console.log(chalk.gray(`  tmux attach -t ${sessionName}`));
    process.exit(1);
  }
}

/**
 * Check if tmux is available
 */
async function checkTmuxAvailable(): Promise<boolean> {
  try {
    await which('tmux');
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch parent issue from Linear (or Jira)
 */
async function fetchParentIssue(
  taskId: string,
  backend: Backend
): Promise<ParentIssue | null> {
  if (backend === 'linear') {
    return fetchLinearIssue(taskId);
  }
  // TODO: Implement Jira support
  console.error(chalk.red(`Backend ${backend} not yet supported for parallel execution`));
  return null;
}

/**
 * Fetch a Linear issue using the Claude MCP bridge
 *
 * This function invokes Claude with a simple prompt to fetch issue data
 * via the Linear MCP tool.
 */
async function fetchLinearIssue(taskId: string): Promise<ParentIssue | null> {
  try {
    // Use Claude with --print to get the issue data
    const prompt = `Get the Linear issue ${taskId} using mcp__plugin_linear_linear__get_issue. Return ONLY a JSON object with these fields: id, identifier, title, gitBranchName. No explanation, just the JSON.`;

    const { stdout } = await execa('claude', ['-p', '--output-format', 'json'], {
      input: prompt,
      timeout: 30000,
    });

    // Parse the response - Claude's JSON output format wraps the result
    const response = JSON.parse(stdout);
    const result = response.result || response;

    // Try to extract JSON from the result if it's a string
    let issueData: { id?: string; identifier?: string; title?: string; gitBranchName?: string };
    if (typeof result === 'string') {
      // Find JSON in the string
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        issueData = JSON.parse(jsonMatch[0]);
      } else {
        return null;
      }
    } else {
      issueData = result;
    }

    if (!issueData.id || !issueData.identifier) {
      return null;
    }

    return {
      id: issueData.id,
      identifier: issueData.identifier,
      title: issueData.title || '',
      gitBranchName: issueData.gitBranchName || `feature/${taskId.toLowerCase()}`,
    };
  } catch (error) {
    console.error(chalk.gray(`Failed to fetch issue: ${error instanceof Error ? error.message : String(error)}`));
    return null;
  }
}

/**
 * Build the initial task graph from Linear sub-tasks
 */
async function buildInitialGraph(
  taskId: string,
  parentIssue: ParentIssue,
  backend: Backend
): Promise<TaskGraph | null> {
  if (backend !== 'linear') {
    console.error(chalk.red(`Backend ${backend} not yet supported for task graph`));
    return null;
  }

  try {
    // Fetch sub-tasks
    const subTasks = await fetchLinearSubTasks(parentIssue.id);
    if (!subTasks || subTasks.length === 0) {
      console.log(chalk.yellow(`No sub-tasks found for ${taskId}`));
      return null;
    }

    // Build the graph
    return buildTaskGraph(parentIssue.id, parentIssue.identifier, subTasks);
  } catch (error) {
    console.error(chalk.gray(`Failed to build task graph: ${error instanceof Error ? error.message : String(error)}`));
    return null;
  }
}

/**
 * Fetch Linear sub-tasks using the Claude MCP bridge
 */
async function fetchLinearSubTasks(parentId: string): Promise<LinearIssue[] | null> {
  try {
    const prompt = `List all sub-tasks of Linear issue with ID "${parentId}" using mcp__plugin_linear_linear__list_issues with parentId parameter, then for each sub-task get its relations using mcp__plugin_linear_linear__get_issue with includeRelations: true. Return ONLY a JSON array of objects with these fields: id, identifier, title, status, gitBranchName, relations (containing blockedBy array with id and identifier). No explanation, just the JSON array.`;

    const { stdout } = await execa('claude', ['-p', '--output-format', 'json'], {
      input: prompt,
      timeout: 60000, // Longer timeout for multiple API calls
    });

    const response = JSON.parse(stdout);
    const result = response.result || response;

    let subTasks: LinearIssue[];
    if (typeof result === 'string') {
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        subTasks = JSON.parse(jsonMatch[0]);
      } else {
        return null;
      }
    } else if (Array.isArray(result)) {
      subTasks = result;
    } else {
      return null;
    }

    return subTasks;
  } catch (error) {
    console.error(chalk.gray(`Failed to fetch sub-tasks: ${error instanceof Error ? error.message : String(error)}`));
    return null;
  }
}

/**
 * Post Mermaid diagram as comment on parent Linear issue
 */
async function postMermaidDiagram(
  taskId: string,
  graph: TaskGraph,
  backend: Backend
): Promise<void> {
  if (backend !== 'linear') {
    return;
  }

  try {
    const diagram = renderMermaidWithTitle(graph);
    const prompt = `Create a comment on Linear issue ${taskId} with this content:\n\n${diagram}\n\nUse mcp__plugin_linear_linear__create_comment. Just confirm it was posted.`;

    await execa('claude', ['-p'], {
      input: prompt,
      timeout: 15000,
    });

    console.log(chalk.gray('Posted task dependency diagram to Linear'));
  } catch (error) {
    // Non-fatal error
    console.log(chalk.gray('Could not post diagram to Linear'));
  }
}

/**
 * Format elapsed time for display
 */
function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
