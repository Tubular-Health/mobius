/**
 * Parallel agent executor module
 *
 * Spawns and manages parallel Claude agent processes for concurrent sub-task
 * execution, with output routed to tmux panes.
 */

import type { ExecutionConfig } from '../types.js';
import type { SubTask } from './task-graph.js';
import {
  type TmuxSession,
  type TmuxPane,
  createAgentPane,
  runInPane,
  capturePaneContent,
  layoutPanes,
  setPaneTitle,
} from './tmux-display.js';
import { BACKEND_SKILLS } from '../types.js';

export interface ExecutionResult {
  taskId: string;
  identifier: string;
  success: boolean;
  status: 'SUBTASK_COMPLETE' | 'VERIFICATION_FAILED' | 'ERROR';
  duration: number;
  error?: string;
}

interface AgentHandle {
  task: SubTask;
  pane: TmuxPane;
  startTime: number;
  command: string;
}

// Status markers from the execute-linear-issue skill
const STATUS_PATTERNS = {
  SUBTASK_COMPLETE: /STATUS:\s*SUBTASK_COMPLETE/,
  VERIFICATION_FAILED: /STATUS:\s*VERIFICATION_FAILED/,
  ALL_COMPLETE: /STATUS:\s*ALL_COMPLETE/,
  ALL_BLOCKED: /STATUS:\s*ALL_BLOCKED/,
  NO_SUBTASKS: /STATUS:\s*NO_SUBTASKS/,
  // Also detect the execution complete marker
  EXECUTION_COMPLETE: /EXECUTION_COMPLETE:\s*[\w-]+/,
};

// Polling configuration
const POLL_INTERVAL_MS = 2000; // Check every 2 seconds
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes per task

/**
 * Execute multiple sub-tasks in parallel using tmux panes
 *
 * @param tasks - Array of ready sub-tasks to execute
 * @param config - Execution configuration
 * @param worktreePath - Path to the shared worktree
 * @param session - The tmux session to use
 * @param parentId - The parent issue identifier (e.g., "MOB-123")
 * @param timeout - Maximum time to wait for each agent (default: 30 minutes)
 * @returns Array of execution results
 */
export async function executeParallel(
  tasks: SubTask[],
  config: ExecutionConfig,
  worktreePath: string,
  session: TmuxSession,
  parentId: string,
  timeout: number = DEFAULT_TIMEOUT_MS
): Promise<ExecutionResult[]> {
  // Calculate actual parallelism
  const maxParallel = config.max_parallel_agents ?? 3;
  const actualParallel = Math.min(maxParallel, tasks.length);

  if (actualParallel === 0) {
    return [];
  }

  // Only take as many tasks as we can run in parallel
  const tasksToRun = tasks.slice(0, actualParallel);

  // Spawn agents in parallel
  const handles = await spawnAgents(tasksToRun, session, worktreePath, parentId, config);

  // Layout panes for visibility
  await layoutPanes(session, handles.length);

  // Wait for all agents to complete with Promise.allSettled
  const results = await Promise.allSettled(
    handles.map(handle => waitForAgent(handle, timeout))
  );

  // Process results
  const executionResults: ExecutionResult[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const handle = handles[i];

    if (result.status === 'fulfilled') {
      executionResults.push(result.value);
    } else {
      // Promise rejected - create error result
      executionResults.push({
        taskId: handle.task.id,
        identifier: handle.task.identifier,
        success: false,
        status: 'ERROR',
        duration: Date.now() - handle.startTime,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }

    // Clean up pane after completion (optional, keeps session clean)
    // await killPane(handle.pane);
  }

  return executionResults;
}

/**
 * Spawn Claude agents in tmux panes for each task
 */
async function spawnAgents(
  tasks: SubTask[],
  session: TmuxSession,
  worktreePath: string,
  parentId: string,
  config: ExecutionConfig
): Promise<AgentHandle[]> {
  const handles: AgentHandle[] = [];
  const skill = BACKEND_SKILLS.linear; // Currently only linear is supported

  for (const task of tasks) {
    // Create a pane for this agent
    const pane = await createAgentPane(session, task);

    // Build the Claude command
    // The command runs in the worktree directory and executes the skill
    const claudeCommand = buildClaudeCommand(parentId, skill, worktreePath, config);

    const handle: AgentHandle = {
      task,
      pane,
      startTime: Date.now(),
      command: claudeCommand,
    };

    // Run the command in the pane
    await runInPane(pane, claudeCommand);

    handles.push(handle);
  }

  return handles;
}

/**
 * Build the Claude command string for executing a skill
 */
function buildClaudeCommand(
  parentId: string,
  skill: string,
  worktreePath: string,
  config: ExecutionConfig
): string {
  // Build the model flag if specified
  const modelFlag = config.model ? `--model ${config.model}` : '';

  // The command:
  // 1. cd to worktree
  // 2. echo the skill invocation to claude
  // 3. pipe through cclean for clean output
  // Note: We use a subshell to change directory without affecting the parent shell
  const command = [
    `cd "${worktreePath}"`,
    '&&',
    `echo '${skill} ${parentId}'`,
    '|',
    `claude -p ${modelFlag}`.trim(),
    '|',
    'cclean',
  ].join(' ');

  return command;
}

/**
 * Wait for an agent to complete by monitoring its pane output
 */
async function waitForAgent(
  handle: AgentHandle,
  timeout: number
): Promise<ExecutionResult> {
  const startTime = handle.startTime;
  const deadline = startTime + timeout;

  while (Date.now() < deadline) {
    // Check pane content for completion markers
    const content = await capturePaneContent(handle.pane, 200);
    const result = parseAgentOutput(content, handle.task, startTime);

    if (result) {
      // Update pane title to show completion status
      const statusEmoji = result.success ? '✓' : '✗';
      await setPaneTitle(handle.pane, `${statusEmoji} ${handle.task.identifier}: ${result.status}`);
      return result;
    }

    // Wait before polling again
    await sleep(POLL_INTERVAL_MS);
  }

  // Timeout reached
  return {
    taskId: handle.task.id,
    identifier: handle.task.identifier,
    success: false,
    status: 'ERROR',
    duration: Date.now() - startTime,
    error: `Agent timed out after ${timeout}ms`,
  };
}

/**
 * Parse agent output to detect completion status
 */
function parseAgentOutput(
  content: string,
  task: SubTask,
  startTime: number
): ExecutionResult | null {
  const duration = Date.now() - startTime;

  // Check for successful completion
  if (STATUS_PATTERNS.SUBTASK_COMPLETE.test(content) || STATUS_PATTERNS.EXECUTION_COMPLETE.test(content)) {
    return {
      taskId: task.id,
      identifier: task.identifier,
      success: true,
      status: 'SUBTASK_COMPLETE',
      duration,
    };
  }

  // Check for verification failure
  if (STATUS_PATTERNS.VERIFICATION_FAILED.test(content)) {
    // Try to extract error details
    const errorMatch = content.match(/### Error Summary\n([^\n]+)/);
    const error = errorMatch ? errorMatch[1] : 'Verification failed';

    return {
      taskId: task.id,
      identifier: task.identifier,
      success: false,
      status: 'VERIFICATION_FAILED',
      duration,
      error,
    };
  }

  // Check for other terminal states (these indicate the parent issue state, not the agent failure)
  if (STATUS_PATTERNS.ALL_COMPLETE.test(content)) {
    return {
      taskId: task.id,
      identifier: task.identifier,
      success: true,
      status: 'SUBTASK_COMPLETE',
      duration,
    };
  }

  if (STATUS_PATTERNS.ALL_BLOCKED.test(content) || STATUS_PATTERNS.NO_SUBTASKS.test(content)) {
    return {
      taskId: task.id,
      identifier: task.identifier,
      success: false,
      status: 'ERROR',
      duration,
      error: 'No actionable sub-tasks available',
    };
  }

  // Not completed yet
  return null;
}

/**
 * Spawn a single agent in a specific pane (for cases where you want direct control)
 *
 * @param task - The sub-task for this agent
 * @param pane - The tmux pane to run in
 * @param worktreePath - Path to the shared worktree
 * @param config - Execution configuration
 * @param parentId - The parent issue identifier
 * @returns ExecutionResult when the agent completes
 */
export async function spawnAgentInPane(
  task: SubTask,
  pane: TmuxPane,
  worktreePath: string,
  config: ExecutionConfig,
  parentId: string
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const skill = BACKEND_SKILLS.linear;

  // Build and run the command
  const command = buildClaudeCommand(parentId, skill, worktreePath, config);
  await runInPane(pane, command);

  // Create handle for monitoring
  const handle: AgentHandle = {
    task,
    pane,
    startTime,
    command,
  };

  // Wait for completion
  return waitForAgent(handle, DEFAULT_TIMEOUT_MS);
}

/**
 * Calculate the effective parallelism for a batch of tasks
 *
 * @param readyTaskCount - Number of ready tasks
 * @param config - Execution configuration
 * @returns The actual number of parallel agents to spawn
 */
export function calculateParallelism(readyTaskCount: number, config: ExecutionConfig): number {
  const maxParallel = config.max_parallel_agents ?? 3;
  return Math.min(maxParallel, readyTaskCount);
}

/**
 * Check if an agent is still running by looking for activity markers
 */
export async function isAgentActive(pane: TmuxPane): Promise<boolean> {
  const content = await capturePaneContent(pane, 50);

  // Check for any of the terminal status markers
  for (const pattern of Object.values(STATUS_PATTERNS)) {
    if (pattern.test(content)) {
      return false; // Agent has finished
    }
  }

  return true;
}

/**
 * Get aggregated progress from multiple agents
 */
export function aggregateResults(results: ExecutionResult[]): {
  total: number;
  succeeded: number;
  failed: number;
  completed: string[];
  failed_tasks: string[];
} {
  const succeeded = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  return {
    total: results.length,
    succeeded: succeeded.length,
    failed: failed.length,
    completed: succeeded.map(r => r.identifier),
    failed_tasks: failed.map(r => `${r.identifier}: ${r.error ?? r.status}`),
  };
}

/**
 * Simple sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
