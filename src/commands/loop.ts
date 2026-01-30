/**
 * TypeScript loop orchestrator command
 *
 * Orchestrates parallel execution of sub-tasks with worktree isolation
 * and tmux-based display.
 */

import chalk from 'chalk';
import which from 'which';
import { readConfig } from '../lib/config.js';
import {
  addRuntimeActiveTask,
  clearAllRuntimeActiveTasks,
  completeRuntimeTask,
  createSession as createMobiusSession,
  deleteRuntimeState,
  endSession as endMobiusSession,
  failRuntimeTask,
  generateContext,
  initializeRuntimeState,
  queuePendingUpdate,
  removeRuntimeActiveTask,
  updateRuntimeTaskPane,
  writeFullContextFile,
} from '../lib/context-generator.js';
import { debugLog, initializeDebugLogger } from '../lib/debug-logger.js';
import {
  assignTask,
  createTracker,
  getRetryTasks,
  hasPermamentFailures,
  processResults,
} from '../lib/execution-tracker.js';
import { fetchJiraIssue, fetchJiraSubTasks } from '../lib/jira.js';
import { fetchLinearIssue, fetchLinearSubTasks, type ParentIssue } from '../lib/linear.js';
import {
  extractStatus,
  isTerminalStatus,
  parseSkillOutput,
  SkillOutputParseError,
} from '../lib/output-parser.js';
import {
  calculateParallelism,
  executeParallel,
  isPaneStillRunning,
} from '../lib/parallel-executor.js';
import { resolvePaths } from '../lib/paths.js';
import type { SubTask } from '../lib/task-graph.js';
import {
  buildTaskGraph,
  getBlockedTasks,
  getGraphStats,
  getReadyTasks,
  getTaskByIdentifier,
  getVerificationTask,
  type TaskGraph,
  updateTaskStatus,
} from '../lib/task-graph.js';
import {
  createSession,
  createStatusPane,
  destroySession,
  getSessionName,
  type LoopStatus,
  type TmuxPane,
  type TmuxSession,
  updateStatusPane,
} from '../lib/tmux-display.js';
import { renderFullTreeOutput } from '../lib/tree-renderer.js';
import { createWorktree, removeWorktree } from '../lib/worktree.js';
import type { IssueContext, RuntimeState } from '../types/context.js';
import type { Backend, ExecutionConfig, Model } from '../types.js';
import { BACKEND_ID_PATTERNS } from '../types.js';
import { pushPendingUpdatesForTask } from './push.js';

/**
 * Type alias for NEEDS_WORK output from execute skill
 * (has subtaskId, issues, suggestedFixes)
 */
type NeedsWorkExecuteOutput = {
  status: 'NEEDS_WORK';
  timestamp: string;
  subtaskId: string;
  issues: string[];
  suggestedFixes: string[];
};

export interface LoopOptions {
  maxIterations?: number;
  local?: boolean;
  backend?: Backend;
  model?: Model;
  parallel?: number; // Override max_parallel_agents
  sequential?: boolean; // Use sequential bash loop instead
  fresh?: boolean; // Clear stale state before starting
  debug?: boolean | 'minimal' | 'normal' | 'verbose'; // Enable debug logging
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

  // Initialize debug logger if enabled
  if (options.debug) {
    initializeDebugLogger(taskId, options.debug);
    debugLog('task_state_change', 'loop', taskId, {
      event: 'loop_start',
      backend,
      parallel: options.parallel,
      maxIterations: options.maxIterations,
    });
  }

  // Check for tmux availability
  const tmuxAvailable = await checkTmuxAvailable();
  if (!tmuxAvailable) {
    console.error(chalk.red('Error: tmux is required for parallel execution mode'));
    console.error(
      chalk.gray('Install with: brew install tmux (macOS) or apt install tmux (Linux)')
    );
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

  // Set up signal handlers to clean up active tasks on exit
  const cleanupOnSignal = () => {
    clearAllRuntimeActiveTasks(taskId);
    process.exit(130); // 128 + SIGINT (2)
  };
  process.on('SIGINT', cleanupOnSignal);
  process.on('SIGTERM', cleanupOnSignal);

  // Clear stale state if --fresh flag is set
  if (options.fresh) {
    const deleted = deleteRuntimeState(taskId);
    if (deleted) {
      console.log(chalk.yellow('Cleared stale state from previous execution.'));
    }
  }

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
  const worktreeInfo = await createWorktree(taskId, parentIssue.gitBranchName, executionConfig);

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

  // Generate local context for skills to read
  console.log(chalk.gray('Generating local context for skills...'));
  const issueContext: IssueContext | null = await generateContext(taskId, {
    projectPath: worktreeInfo.path,
  });
  if (!issueContext) {
    console.error(chalk.red('Error: Failed to generate issue context'));
    await destroySession(session);
    process.exit(1);
  }

  // Write full context file for skills to read via MOBIUS_CONTEXT_FILE
  const contextFilePath = writeFullContextFile(taskId, issueContext);
  console.log(chalk.gray(`Context file: ${contextFilePath}`));

  // Display ASCII tree
  console.log('');
  console.log(renderFullTreeOutput(graph));
  console.log('');

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

  // Create session in context system
  createMobiusSession(taskId, backend, worktreeInfo.path);

  // Initialize TUI runtime state for file-based monitoring
  let runtimeState: RuntimeState = initializeRuntimeState(taskId, parentIssue.title, {
    loopPid: process.pid,
    totalTasks: graph.tasks.size,
  });

  // Pre-populate completedTasks with tasks already done in Linear
  // This handles the case where we're called on an already-completed task
  for (const task of graph.tasks.values()) {
    if (task.status === 'done') {
      runtimeState = completeRuntimeTask(runtimeState, task.identifier);
    }
  }

  try {
    // Main execution loop
    while (iteration < maxIterations) {
      iteration++;

      // Re-sync task graph from backend to pick up external status changes
      graph = await syncGraphFromBackend(graph, parentIssue, backend);

      // Check if verification task is complete - exit early with success
      const verificationTask = getVerificationTask(graph);
      if (verificationTask?.status === 'done') {
        allComplete = true;
        console.log(chalk.green('\n✓ Verification task completed successfully!'));
        console.log(chalk.green(`  ${verificationTask.identifier}: ${verificationTask.title}`));
        break;
      }

      // Get ready tasks (combine fresh ready tasks with retry queue)
      const readyTasks = getReadyTasks(graph);

      // Add retry tasks to ready queue if they're not already there
      for (const retryTask of retryQueue) {
        if (!readyTasks.some((t) => t.id === retryTask.id)) {
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
          console.log(chalk.gray(`Blocked: ${blockedTasks.map((t) => t.identifier).join(', ')}`));
        }
        break;
      }

      // Calculate parallelism
      const parallelCount = calculateParallelism(readyTasks.length, executionConfig);
      const tasksToExecute = readyTasks.slice(0, parallelCount);

      console.log(
        chalk.blue(`\nIteration ${iteration}: Executing ${parallelCount} task(s) in parallel...`)
      );
      console.log(chalk.gray(`  Tasks: ${tasksToExecute.map((t) => t.identifier).join(', ')}`));

      // Assign tasks to tracker before execution
      for (const task of tasksToExecute) {
        assignTask(tracker, task);
      }

      // Update runtime state with active tasks (for TUI monitoring)
      // Initially set pane to empty string - will be updated with real pane IDs after executeParallel
      for (const task of tasksToExecute) {
        runtimeState = addRuntimeActiveTask(runtimeState, {
          id: task.identifier,
          pid: 0, // Will be updated when process spawns
          pane: '', // Placeholder until real pane ID is available
          startedAt: new Date().toISOString(),
          worktree: worktreeInfo.path,
        });
      }

      // Update status pane
      const loopStatus: LoopStatus = {
        totalTasks: stats.total,
        completedTasks: stats.done,
        activeAgents: tasksToExecute.map((t) => ({
          taskId: t.id,
          identifier: t.identifier,
        })),
        blockedTasks: getBlockedTasks(graph).map((t) => t.identifier),
        elapsed: Date.now() - startTime,
      };
      await updateStatusPane(statusPane, loopStatus, sessionName);

      // Execute tasks in parallel - each task carries its own identifier
      // Pass context file path so skills can read issue context via MOBIUS_CONTEXT_FILE
      const results = await executeParallel(
        tasksToExecute,
        executionConfig,
        worktreeInfo.path,
        session,
        contextFilePath
      );

      // Update runtime state with real pane IDs from execution results
      for (const result of results) {
        if (result.pane) {
          runtimeState = updateRuntimeTaskPane(runtimeState, result.identifier, result.pane);
        }
      }

      // Parse skill outputs and queue updates for later sync via `mobius push`
      for (const result of results) {
        if (result.rawOutput) {
          const skillResult = processSkillOutput(
            result.rawOutput,
            backend,
            taskId,
            result.identifier
          );
          if (skillResult.processed) {
            console.log(
              chalk.gray(`Queued updates for ${result.identifier}: ${skillResult.status}`)
            );
          }

          // Handle NEEDS_WORK status: reset target task(s) and queue for re-execution
          if (skillResult.status === 'NEEDS_WORK') {
            // Parse target subtask(s) from raw output
            const parsed = parseSkillOutput(result.rawOutput);
            if (parsed.output.status === 'NEEDS_WORK') {
              // Collect all target task identifiers from either format
              const targetIds: string[] = [];

              // Execute-issue format: single subtaskId
              if ('subtaskId' in parsed.output && parsed.output.subtaskId) {
                targetIds.push(parsed.output.subtaskId);
              }

              // Verify-issue format: failingSubtasks array
              if (
                'failingSubtasks' in parsed.output &&
                Array.isArray(parsed.output.failingSubtasks)
              ) {
                for (const task of parsed.output.failingSubtasks) {
                  targetIds.push(task.identifier);
                }
              }

              // Fallback: use the current result identifier
              if (targetIds.length === 0) {
                targetIds.push(result.identifier);
              }

              // Find and queue each target task for retry
              for (const targetId of targetIds) {
                const targetTask = getTaskByIdentifier(graph, targetId);
                if (targetTask && !retryQueue.some((t) => t.identifier === targetId)) {
                  graph = updateTaskStatus(graph, targetTask.id, 'ready');
                  retryQueue.push(targetTask);
                  console.log(
                    chalk.yellow(`  ↻ ${targetId}: NEEDS_WORK detected, queuing for rework`)
                  );
                }
              }
            }
          }
        }
      }

      // Auto-push queued updates to backend BEFORE verification
      // This fixes the gap where verification fails because Linear wasn't updated yet
      const pushResult = await pushPendingUpdatesForTask(taskId, backend);
      if (pushResult.success > 0 || pushResult.failed > 0) {
        console.log(
          chalk.gray(`Pushed updates: ${pushResult.success} succeeded, ${pushResult.failed} failed`)
        );
        if (pushResult.errors.length > 0) {
          for (const error of pushResult.errors) {
            console.log(chalk.yellow(`  ⚠ ${error}`));
          }
        }
      }

      // Verify results via Linear SDK
      console.log(chalk.gray('Verifying results via Linear...'));
      const verifiedResults = await processResults(tracker, results);

      // Process verified results and update graph
      const verified = verifiedResults.filter((r) => r.success && r.linearVerified);
      const needRetry = getRetryTasks(verifiedResults, tasksToExecute);
      const permanentFailures = verifiedResults.filter((r) => !r.success && !r.shouldRetry);

      console.log(
        chalk.gray(
          `Verified: ${verified.length}/${verifiedResults.length} | ` +
            `Retry: ${needRetry.length} | Failed: ${permanentFailures.length}`
        )
      );

      // Update graph and runtime state for verified results
      for (const result of verifiedResults) {
        if (result.success && result.linearVerified) {
          graph = updateTaskStatus(graph, result.taskId, 'done');
          runtimeState = completeRuntimeTask(runtimeState, result.identifier);
          console.log(chalk.green(`  ✓ ${result.identifier} (Linear: ${result.linearStatus})`));
        } else if (result.shouldRetry) {
          // Remove from active tasks for retry (will be re-added next iteration)
          runtimeState = removeRuntimeActiveTask(runtimeState, result.identifier);
          console.log(
            chalk.yellow(
              `  ↻ ${result.identifier}: Retrying (${result.error ?? 'verification pending'})`
            )
          );
        } else {
          // Check if pane is still running before marking as permanent failure
          // This handles cases where Linear verification times out but the agent is still working
          const paneStillRunning = result.pane ? await isPaneStillRunning(result.pane) : false;

          if (paneStillRunning) {
            // Pane is still active - override permanent failure, queue for retry
            // Mark as retriable so hasPermamentFailures() returns false
            result.shouldRetry = true;
            const task = tasksToExecute.find((t) => t.identifier === result.identifier);
            if (task && !retryQueue.some((t) => t.identifier === result.identifier)) {
              retryQueue.push(task);
            }
            // Remove from active tasks for retry (will be re-added next iteration)
            runtimeState = removeRuntimeActiveTask(runtimeState, result.identifier);
            console.log(chalk.yellow(`  ↻ ${result.identifier}: Pane still active, queuing retry`));
          } else {
            // Permanent failure - pane is actually dead
            runtimeState = failRuntimeTask(runtimeState, result.identifier);
            console.log(chalk.red(`  ✗ ${result.identifier}: ${result.error ?? result.status}`));
          }
        }
      }

      // Queue tasks for retry (merge with pane-still-running additions)
      for (const task of needRetry) {
        if (!retryQueue.some((t) => t.id === task.id)) {
          retryQueue.push(task);
        }
      }

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

    // Clear active tasks from runtime state since loop is done
    clearAllRuntimeActiveTasks(taskId);

    // Mark mobius session as completed or failed based on outcome
    if (allComplete) {
      endMobiusSession(taskId, 'completed');
    } else if (anyFailed) {
      endMobiusSession(taskId, 'failed');
    }

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
    // Clear active tasks from runtime state on error
    clearAllRuntimeActiveTasks(taskId);
    endMobiusSession(taskId, 'failed');

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
 * Fetch parent issue from Linear or Jira
 */
async function fetchParentIssue(taskId: string, backend: Backend): Promise<ParentIssue | null> {
  if (backend === 'linear') {
    return fetchLinearIssue(taskId);
  }
  if (backend === 'jira') {
    return fetchJiraIssue(taskId);
  }
  console.error(chalk.red(`Backend ${backend} not supported`));
  return null;
}

/**
 * Re-sync the task graph from the backend with fresh status data
 *
 * This enables the loop to see external status changes (e.g., from verify agents).
 * On fetch failure, returns the existing graph (graceful degradation).
 */
async function syncGraphFromBackend(
  graph: TaskGraph,
  parentIssue: ParentIssue,
  backend: Backend
): Promise<TaskGraph> {
  try {
    const subTasks = await fetchSubTasks(parentIssue.id, parentIssue.identifier, backend);
    if (!subTasks || subTasks.length === 0) {
      // No sub-tasks returned, keep existing graph
      return graph;
    }
    return buildTaskGraph(parentIssue.id, parentIssue.identifier, subTasks);
  } catch (error) {
    // Graceful degradation: return existing graph on fetch failure
    console.log(
      chalk.gray(
        `Graph sync failed, using cached state: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    return graph;
  }
}

/**
 * Fetch sub-tasks from Linear or Jira
 */
async function fetchSubTasks(
  parentId: string,
  parentIdentifier: string,
  backend: Backend
): Promise<ReturnType<typeof fetchLinearSubTasks>> {
  if (backend === 'linear') {
    return fetchLinearSubTasks(parentId);
  }
  if (backend === 'jira') {
    // For Jira, use the identifier (key) instead of internal ID
    return fetchJiraSubTasks(parentIdentifier);
  }
  return null;
}

/**
 * Build the initial task graph from Linear or Jira sub-tasks
 */
async function buildInitialGraph(
  taskId: string,
  parentIssue: ParentIssue,
  backend: Backend
): Promise<TaskGraph | null> {
  try {
    // Fetch sub-tasks using the appropriate backend
    const subTasks = await fetchSubTasks(parentIssue.id, parentIssue.identifier, backend);
    if (!subTasks || subTasks.length === 0) {
      console.log(chalk.yellow(`No sub-tasks found for ${taskId}`));
      return null;
    }

    // Build the graph
    return buildTaskGraph(parentIssue.id, parentIssue.identifier, subTasks);
  } catch (error) {
    console.error(
      chalk.gray(
        `Failed to build task graph: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    return null;
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

/**
 * Process skill output and queue updates for later sync
 *
 * Parses the structured output from a skill and queues appropriate
 * updates to pending-updates.json for later sync via `mobius push`.
 *
 * @param rawOutput - The raw output string from the skill (pane content)
 * @param backend - The backend to use for SDK calls (linear or jira)
 * @param parentId - The parent issue identifier for queuing updates
 * @param taskIdentifier - The actual task that executed (source of truth for updates)
 * @returns Whether the skill output was successfully processed
 */
function processSkillOutput(
  rawOutput: string,
  backend: Backend,
  parentId: string,
  taskIdentifier: string
): { processed: boolean; status?: string; error?: string } {
  // Try to extract just the status for quick check
  const status = extractStatus(rawOutput);
  if (!status) {
    // No structured output found - this is normal for in-progress agents
    return { processed: false };
  }

  // Only process terminal statuses that require updates
  // NEEDS_WORK is special - not terminal but still needs processing for rework
  if (!isTerminalStatus(status) && status !== 'NEEDS_WORK') {
    return { processed: true, status };
  }

  // For full processing, parse the complete output
  try {
    const parsed = parseSkillOutput(rawOutput);
    const output = parsed.output;

    // Queue updates for later sync via `mobius push`
    if (backend === 'linear') {
      queueLinearUpdates(output, parentId, taskIdentifier);
    }
    // TODO: Add Jira support when needed

    return { processed: true, status };
  } catch (error) {
    if (error instanceof SkillOutputParseError) {
      // Partial or malformed output - log but don't fail
      return {
        processed: false,
        error: `Failed to parse skill output: ${error.message}`,
      };
    }
    throw error;
  }
}

/**
 * Queue Linear updates for later sync via `mobius push`
 *
 * Instead of making direct SDK calls, this queues updates to
 * pending-updates.json for batch sync.
 *
 * @param output - Parsed skill output
 * @param parentId - The parent issue identifier for queuing updates
 * @param taskIdentifier - The actual task that executed (source of truth for which task to update)
 */
function queueLinearUpdates(
  output: ReturnType<typeof parseSkillOutput>['output'],
  parentId: string,
  taskIdentifier: string
): void {
  switch (output.status) {
    case 'SUBTASK_COMPLETE': {
      // Use taskIdentifier as source of truth, not output.subtaskId
      // This prevents stale pane content from causing updates to the wrong task
      queuePendingUpdate(parentId, {
        type: 'status_change',
        issueId: taskIdentifier,
        identifier: taskIdentifier,
        oldStatus: 'In Progress',
        newStatus: 'Done',
      });
      console.log(chalk.gray(`  Queued: ${taskIdentifier} status -> Done`));

      // Queue completion comment with details
      const commentBody = buildCompletionComment(output);
      queuePendingUpdate(parentId, {
        type: 'add_comment',
        issueId: taskIdentifier,
        identifier: taskIdentifier,
        body: commentBody,
      });
      console.log(chalk.gray(`  Queued: ${taskIdentifier} completion comment`));
      break;
    }

    case 'VERIFICATION_FAILED': {
      // Queue failure comment (keep subtask in progress)
      // Use taskIdentifier as source of truth
      const commentBody = buildFailureComment(output);
      queuePendingUpdate(parentId, {
        type: 'add_comment',
        issueId: taskIdentifier,
        identifier: taskIdentifier,
        body: commentBody,
      });
      console.log(chalk.gray(`  Queued: ${taskIdentifier} failure comment`));
      break;
    }

    case 'NEEDS_WORK': {
      // Support both execute format (single subtaskId) and verify format (failingSubtasks array)
      const failingTasks: Array<{ id: string; identifier: string }> = [];

      // Execute-issue format: single subtaskId
      if ('subtaskId' in output && output.subtaskId) {
        failingTasks.push({ id: output.subtaskId, identifier: output.subtaskId });
      }

      // Verify-issue format: failingSubtasks array
      if ('failingSubtasks' in output && Array.isArray(output.failingSubtasks)) {
        for (const task of output.failingSubtasks) {
          failingTasks.push({ id: task.id, identifier: task.identifier });
        }
      }

      // Queue updates for each failing task
      for (const task of failingTasks) {
        // Queue status change to reopen the failing task
        queuePendingUpdate(parentId, {
          type: 'status_change',
          issueId: task.id,
          identifier: task.identifier,
          oldStatus: 'Done',
          newStatus: 'Todo',
        });
        console.log(chalk.gray(`  Queued: ${task.identifier} status -> Todo (rework)`));
      }

      // Queue feedback comments (from verify format)
      if ('feedbackComments' in output && Array.isArray(output.feedbackComments)) {
        for (const fc of output.feedbackComments) {
          queuePendingUpdate(parentId, {
            type: 'add_comment',
            issueId: fc.subtaskId,
            identifier: fc.subtaskId,
            body: fc.comment,
          });
          console.log(chalk.gray(`  Queued: ${fc.subtaskId} rework comment`));
        }
      } else if ('subtaskId' in output && output.subtaskId && 'issues' in output) {
        // Fallback: build comment from issues/suggestedFixes (execute format)
        const commentBody = buildNeedsWorkComment(output as NeedsWorkExecuteOutput);
        queuePendingUpdate(parentId, {
          type: 'add_comment',
          issueId: output.subtaskId,
          identifier: output.subtaskId,
          body: commentBody,
        });
        console.log(chalk.gray(`  Queued: ${output.subtaskId} rework comment`));
      }
      break;
    }

    // Other statuses (ALL_COMPLETE, ALL_BLOCKED, NO_SUBTASKS, PASS, FAIL)
    // don't require updates at the subtask level
    default:
      break;
  }
}

/**
 * Build a completion comment for a successful subtask
 */
function buildCompletionComment(
  output: Extract<ReturnType<typeof parseSkillOutput>['output'], { status: 'SUBTASK_COMPLETE' }>
): string {
  const lines = [
    '## ✅ Subtask Completed',
    '',
    `**Commit**: \`${output.commitHash}\``,
    '',
    '### Files Modified',
    ...output.filesModified.map((f) => `- \`${f}\``),
    '',
    '### Verification Results',
    `- Typecheck: ${output.verificationResults.typecheck}`,
    `- Tests: ${output.verificationResults.tests}`,
    `- Lint: ${output.verificationResults.lint}`,
  ];

  if (output.verificationResults.subtaskVerify) {
    lines.push(`- Subtask Verify: ${output.verificationResults.subtaskVerify}`);
  }

  lines.push('', '---', '*Generated by mobius loop*');

  return lines.join('\n');
}

/**
 * Build a failure comment for a verification failure
 */
function buildFailureComment(
  output: Extract<ReturnType<typeof parseSkillOutput>['output'], { status: 'VERIFICATION_FAILED' }>
): string {
  const lines = [
    '## ❌ Verification Failed',
    '',
    `**Error Type**: ${output.errorType}`,
    '',
    '### Error Output',
    '```',
    output.errorOutput.slice(0, 500), // Truncate for readability
    '```',
    '',
    '### Attempted Fixes',
    ...output.attemptedFixes.map((f) => `- ${f}`),
    '',
    '### Uncommitted Files',
    ...output.uncommittedFiles.map((f) => `- \`${f}\``),
    '',
    '---',
    '*Generated by mobius loop*',
  ];

  return lines.join('\n');
}

/**
 * Build a rework comment when verification finds issues (execute format)
 */
function buildNeedsWorkComment(output: NeedsWorkExecuteOutput): string {
  const lines = [
    '## 🔧 Needs Rework',
    '',
    '### Issues Found',
    ...output.issues.map((i: string) => `- ${i}`),
    '',
    '### Suggested Fixes',
    ...output.suggestedFixes.map((f: string) => `- ${f}`),
    '',
    '---',
    '*Generated by mobius loop*',
  ];

  return lines.join('\n');
}
