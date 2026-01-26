/**
 * TypeScript loop orchestrator command
 *
 * Orchestrates parallel execution of sub-tasks with worktree isolation
 * and tmux-based display.
 */

import chalk from 'chalk';
import which from 'which';
import { resolvePaths } from '../lib/paths.js';
import { readConfig } from '../lib/config.js';
import { BACKEND_ID_PATTERNS } from '../types.js';
import type { Backend, Model, ExecutionConfig } from '../types.js';
import { createWorktree, removeWorktree } from '../lib/worktree.js';
import { fetchLinearIssue, fetchLinearSubTasks, type ParentIssue } from '../lib/linear.js';
import {
  buildTaskGraph,
  getReadyTasks,
  getBlockedTasks,
  getGraphStats,
  updateTaskStatus,
  type TaskGraph,
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
  calculateParallelism,
} from '../lib/parallel-executor.js';
import {
  createTracker,
  assignTask,
  processResults,
  getRetryTasks,
  hasPermamentFailures,
} from '../lib/execution-tracker.js';
import type { SubTask } from '../lib/task-graph.js';

export interface LoopOptions {
  maxIterations?: number;
  local?: boolean;
  backend?: Backend;
  model?: Model;
  parallel?: number; // Override max_parallel_agents
  sequential?: boolean; // Use sequential bash loop instead
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

  // Initialize execution tracker for verification and retry logic
  const tracker = createTracker(
    executionConfig.max_retries ?? 2,
    executionConfig.verification_timeout ?? 5000
  );

  // Track tasks pending retry
  let retryQueue: SubTask[] = [];

  try {
    // Main execution loop
    while (iteration < maxIterations) {
      iteration++;

      // Get ready tasks (combine fresh ready tasks with retry queue)
      let readyTasks = getReadyTasks(graph);

      // Add retry tasks to ready queue if they're not already there
      for (const retryTask of retryQueue) {
        if (!readyTasks.some(t => t.id === retryTask.id)) {
          readyTasks.push(retryTask);
        }
      }
      retryQueue = []; // Clear retry queue after merging

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
      const tasksToExecute = readyTasks.slice(0, parallelCount);

      console.log(
        chalk.blue(
          `\nIteration ${iteration}: Executing ${parallelCount} task(s) in parallel...`
        )
      );
      console.log(
        chalk.gray(`  Tasks: ${tasksToExecute.map(t => t.identifier).join(', ')}`)
      );

      // Assign tasks to tracker before execution
      for (const task of tasksToExecute) {
        assignTask(tracker, task);
      }

      // Update status pane
      const loopStatus: LoopStatus = {
        totalTasks: stats.total,
        completedTasks: stats.done,
        activeAgents: tasksToExecute.map(t => ({
          taskId: t.id,
          identifier: t.identifier,
        })),
        blockedTasks: getBlockedTasks(graph).map(t => t.identifier),
        elapsed: Date.now() - startTime,
      };
      await updateStatusPane(statusPane, loopStatus, sessionName);

      // Execute tasks in parallel - each task carries its own identifier
      const results = await executeParallel(
        tasksToExecute,
        executionConfig,
        worktreeInfo.path,
        session
      );

      // Verify results via Linear SDK
      console.log(chalk.gray('Verifying results via Linear...'));
      const verifiedResults = await processResults(tracker, results);

      // Process verified results and update graph
      const verified = verifiedResults.filter(r => r.success && r.linearVerified);
      const needRetry = getRetryTasks(verifiedResults, tasksToExecute);
      const permanentFailures = verifiedResults.filter(r => !r.success && !r.shouldRetry);

      console.log(
        chalk.gray(
          `Verified: ${verified.length}/${verifiedResults.length} | ` +
          `Retry: ${needRetry.length} | Failed: ${permanentFailures.length}`
        )
      );

      // Update graph for verified successes only
      for (const result of verifiedResults) {
        if (result.success && result.linearVerified) {
          graph = updateTaskStatus(graph, result.taskId, 'done');
          console.log(chalk.green(`  ✓ ${result.identifier} (Linear: ${result.linearStatus})`));
        } else if (result.shouldRetry) {
          console.log(chalk.yellow(`  ↻ ${result.identifier}: Retrying (${result.error ?? 'verification pending'})`));
        } else {
          console.log(chalk.red(`  ✗ ${result.identifier}: ${result.error ?? result.status}`));
        }
      }

      // Queue tasks for retry
      retryQueue = needRetry;

      // Check for permanent failures
      if (hasPermamentFailures(verifiedResults)) {
        anyFailed = true;
        console.log(chalk.red('\nStopping due to permanent task failure (max retries exceeded).'));
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

  const { getLinearClient } = await import('../lib/linear.js');
  const client = getLinearClient();
  if (!client) {
    return;
  }

  try {
    const diagram = renderMermaidWithTitle(graph);

    // Find the issue by identifier
    const issue = await client.issue(taskId);
    if (!issue) {
      return;
    }

    await client.createComment({
      issueId: issue.id,
      body: diagram,
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
