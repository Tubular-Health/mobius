/**
 * End-to-end tests for TUI with fake Linear issues and reloop mechanism
 *
 * Simulates the complete Mobius TUI flow with a fake Linear issue hierarchy,
 * mocking the verification gate → reloop → retrigger mechanism for previous subtasks.
 *
 * Uses module-level mocking to replace Linear SDK, parallel executor, worktree,
 * and tmux operations with controlled test doubles.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VerifiedResult } from '../lib/execution-tracker.js';
import type { ParentIssue } from '../lib/linear.js';
import type { ExecutionResult } from '../lib/parallel-executor.js';
import type { LinearIssue, SubTask, TaskGraph } from '../lib/task-graph.js';
import type { RuntimeState } from '../types/context.js';

// =============================================================================
// Test Data Structures
// =============================================================================

/** Fake parent issue for tests */
const fakeParentIssue: ParentIssue = {
  id: 'parent-uuid-12345',
  identifier: 'TEST-100',
  title: 'E2E Test Parent Issue',
  gitBranchName: 'feature/test-100',
};

/** Create fake subtasks with optional verification gate */
function createFakeSubTasks(options?: {
  includeVerificationGate?: boolean;
  taskCount?: number;
}): LinearIssue[] {
  const includeGate = options?.includeVerificationGate ?? false;
  const taskCount = options?.taskCount ?? 2;

  const tasks: LinearIssue[] = [];

  // Create regular tasks
  for (let i = 1; i <= taskCount; i++) {
    const blockedBy: Array<{ id: string; identifier: string }> = [];
    const blocks: Array<{ id: string; identifier: string }> = [];

    // Task 2+ is blocked by task 1 (simple linear dependency)
    if (i > 1) {
      blockedBy.push({ id: `subtask-uuid-${100 + i - 1}`, identifier: `TEST-${100 + i - 1}` });
    }
    if (i < taskCount) {
      blocks.push({ id: `subtask-uuid-${100 + i + 1}`, identifier: `TEST-${100 + i + 1}` });
    }

    tasks.push({
      id: `subtask-uuid-${100 + i}`,
      identifier: `TEST-${100 + i}`,
      title: `Implement feature ${String.fromCharCode(64 + i)}`,
      status: 'Backlog',
      gitBranchName: `feature/test-${100 + i}`,
      relations: { blockedBy, blocks },
    });
  }

  // Add verification gate if requested
  if (includeGate) {
    const gateId = 100 + taskCount + 1;
    tasks.push({
      id: `subtask-uuid-${gateId}`,
      identifier: `TEST-${gateId}`,
      title: 'Verification Gate - Final Review',
      status: 'Backlog',
      gitBranchName: `feature/test-${gateId}`,
      relations: {
        blockedBy: tasks.map((t) => ({ id: t.id, identifier: t.identifier })),
        blocks: [],
      },
    });
  }

  return tasks;
}

// =============================================================================
// Mock Task Outcome Types
// =============================================================================

/** Extended status type for mock outcomes (includes statuses the loop handles) */
type MockOutcomeStatus =
  | 'SUBTASK_COMPLETE'
  | 'VERIFICATION_FAILED'
  | 'NEEDS_WORK'
  | 'ERROR'
  | 'PASS'
  | 'FAIL';

interface MockTaskOutcome {
  success: boolean;
  status: MockOutcomeStatus;
  /** For NEEDS_WORK: the subtask that needs rework */
  needsWorkTarget?: string;
  /** Linear status to return for verification */
  linearStatus?: string;
  /** Whether Linear verifies the completion */
  linearVerified?: boolean;
  /** Raw output for skill parsing */
  rawOutput?: string;
}

// =============================================================================
// MockExecutionController
// =============================================================================

/**
 * Central controller to orchestrate mock behavior across iterations
 */
class MockExecutionController {
  private iteration = 0;
  private linearStatuses: Map<string, string[]> = new Map();
  private taskOutcomes: Map<string, MockTaskOutcome[]> = new Map();
  private executionCounts: Map<string, number> = new Map();
  private paneIdCounter = 0;

  /**
   * Configure what each task returns on each execution
   * @param taskIdentifier - e.g., "TEST-101"
   * @param outcomes - Array of outcomes for each execution (index = attempt number - 1)
   */
  setTaskOutcome(taskIdentifier: string, outcomes: MockTaskOutcome[]): void {
    this.taskOutcomes.set(taskIdentifier, outcomes);
  }

  /**
   * Configure what Linear verification returns for each iteration
   * @param taskIdentifier - e.g., "TEST-101"
   * @param statuses - Array of Linear status strings for each verification call
   */
  setLinearStatuses(taskIdentifier: string, statuses: string[]): void {
    this.linearStatuses.set(taskIdentifier, statuses);
  }

  /**
   * Get result for executeParallel mock
   */
  getExecutionResult(task: SubTask): ExecutionResult {
    const count = this.executionCounts.get(task.identifier) ?? 0;
    this.executionCounts.set(task.identifier, count + 1);

    const outcomes = this.taskOutcomes.get(task.identifier) ?? [];
    const outcome = outcomes[count] ?? {
      success: true,
      status: 'SUBTASK_COMPLETE' as const,
      linearStatus: 'Done',
      linearVerified: true,
    };

    const paneId = `%${this.paneIdCounter++}`;

    // Map outcome status to ExecutionResult status type
    let resultStatus: 'SUBTASK_COMPLETE' | 'VERIFICATION_FAILED' | 'ERROR';
    if (outcome.status === 'PASS' || outcome.status === 'SUBTASK_COMPLETE') {
      resultStatus = 'SUBTASK_COMPLETE';
    } else if (outcome.status === 'FAIL' || outcome.status === 'VERIFICATION_FAILED') {
      resultStatus = 'VERIFICATION_FAILED';
    } else if (outcome.status === 'NEEDS_WORK') {
      // NEEDS_WORK is treated as a special success case (verification found issues)
      resultStatus = 'SUBTASK_COMPLETE';
    } else {
      resultStatus = 'ERROR';
    }

    return {
      taskId: task.id,
      identifier: task.identifier,
      success: outcome.success,
      status: resultStatus,
      duration: 1000,
      pane: paneId,
      rawOutput: outcome.rawOutput ?? this.buildRawOutput(outcome, task.identifier),
    };
  }

  /**
   * Get result for verifyLinearCompletion mock
   */
  getVerificationResult(taskIdentifier: string): {
    verified: boolean;
    status?: string;
    error?: string;
  } {
    const count = this.executionCounts.get(taskIdentifier) ?? 1;
    const statuses = this.linearStatuses.get(taskIdentifier) ?? ['Done'];
    const statusIndex = Math.min(count - 1, statuses.length - 1);
    const status = statuses[statusIndex];

    const isComplete = ['Done', 'Completed'].includes(status);
    return { verified: isComplete, status };
  }

  /**
   * Get execution count for a task
   */
  getExecutionCount(taskIdentifier: string): number {
    return this.executionCounts.get(taskIdentifier) ?? 0;
  }

  /**
   * Advance to next iteration
   */
  nextIteration(): void {
    this.iteration++;
  }

  /**
   * Get current iteration number
   */
  getCurrentIteration(): number {
    return this.iteration;
  }

  /**
   * Reset controller state
   */
  reset(): void {
    this.iteration = 0;
    this.linearStatuses.clear();
    this.taskOutcomes.clear();
    this.executionCounts.clear();
    this.paneIdCounter = 0;
  }

  /**
   * Build raw output string for skill parsing
   */
  private buildRawOutput(outcome: MockTaskOutcome, subtaskId: string): string {
    const timestamp = new Date().toISOString();

    switch (outcome.status) {
      case 'SUBTASK_COMPLETE':
        return `---
status: SUBTASK_COMPLETE
timestamp: ${timestamp}
subtaskId: ${subtaskId}
commitHash: abc1234
filesModified:
  - src/feature.ts
verificationResults:
  typecheck: PASS
  tests: PASS
  lint: PASS
---`;

      case 'NEEDS_WORK':
        return `---
status: NEEDS_WORK
timestamp: ${timestamp}
subtaskId: ${outcome.needsWorkTarget ?? subtaskId}
issues:
  - Test coverage insufficient
  - Missing edge case handling
suggestedFixes:
  - Add tests for edge cases
  - Handle null input
---`;

      case 'VERIFICATION_FAILED':
        return `---
status: VERIFICATION_FAILED
timestamp: ${timestamp}
subtaskId: ${subtaskId}
errorType: tests
errorOutput: "Test failed: expected 2 but got 1"
attemptedFixes:
  - Fixed calculation
uncommittedFiles:
  - src/feature.ts
---`;

      case 'PASS':
        return `---
status: PASS
timestamp: ${timestamp}
subtaskId: ${subtaskId}
details: All verification checks passed
---`;

      case 'FAIL':
        return `---
status: FAIL
timestamp: ${timestamp}
subtaskId: ${subtaskId}
reason: Verification gate found critical issues
---`;

      default:
        return '';
    }
  }
}

// =============================================================================
// Test Setup Helpers
// =============================================================================

let tempDir: string;
let mockController: MockExecutionController;

// Spies for console output
let consoleLogSpy: ReturnType<typeof spyOn>;
let consoleErrorSpy: ReturnType<typeof spyOn>;

/**
 * Create temp directory structure for test isolation
 */
function setupTempDirectories(): void {
  tempDir = mkdtempSync(join(tmpdir(), 'mobius-tui-reloop-'));
  const mobiusDir = join(tempDir, '.mobius');
  mkdirSync(mobiusDir, { recursive: true });
}

/**
 * Clean up temp directories
 */
function cleanupTempDirectories(): void {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// =============================================================================
// Core Loop Logic (Simplified for Testing)
// =============================================================================

import {
  addRuntimeActiveTask,
  cleanupContext,
  completeRuntimeTask,
  failRuntimeTask,
  initializeRuntimeState,
  queuePendingUpdate,
  readPendingUpdates,
  removeRuntimeActiveTask,
  watchRuntimeState,
  writePendingUpdates,
} from '../lib/context-generator.js';
import {
  assignTask,
  createTracker,
  getRetryTasks,
  hasPermamentFailures,
} from '../lib/execution-tracker.js';
import { extractStatus } from '../lib/output-parser.js';
import {
  buildTaskGraph,
  getGraphStats,
  getReadyTasks,
  getTaskByIdentifier,
  getVerificationTask,
  updateTaskStatus,
} from '../lib/task-graph.js';

interface LoopState {
  graph: TaskGraph;
  runtimeState: RuntimeState;
  iteration: number;
  allComplete: boolean;
  anyFailed: boolean;
  retryQueue: SubTask[];
  /** Collected pending updates for test assertions */
  pendingUpdates: Array<{ type: string; identifier: string; body?: string }>;
  /** Persistent execution tracker for retry counting */
  tracker: ReturnType<typeof createTracker>;
}

/**
 * Simplified loop iteration for testing
 * Returns state changes without real tmux/worktree operations
 */
async function runLoopIteration(
  state: LoopState,
  controller: MockExecutionController,
  _maxRetries: number = 2
): Promise<LoopState> {
  const { graph, runtimeState, pendingUpdates, tracker } = state;
  let newGraph = graph;
  let newRuntimeState = runtimeState;
  const newPendingUpdates = [...pendingUpdates];
  const iteration = state.iteration + 1;
  let { retryQueue } = state;

  controller.nextIteration();

  // Check if verification task is complete
  const verificationTask = getVerificationTask(newGraph);
  if (verificationTask?.status === 'done') {
    return {
      ...state,
      iteration,
      allComplete: true,
    };
  }

  // Get ready tasks + retry queue
  const readyTasks = getReadyTasks(newGraph);
  for (const retryTask of retryQueue) {
    if (!readyTasks.some((t) => t.id === retryTask.id)) {
      readyTasks.push(retryTask);
    }
  }
  retryQueue = [];

  const stats = getGraphStats(newGraph);
  if (stats.done === stats.total) {
    return {
      ...state,
      graph: newGraph,
      runtimeState: newRuntimeState,
      iteration,
      allComplete: true,
      retryQueue,
      pendingUpdates: newPendingUpdates,
      tracker,
    };
  }

  if (readyTasks.length === 0) {
    return {
      ...state,
      graph: newGraph,
      runtimeState: newRuntimeState,
      iteration,
      retryQueue,
      pendingUpdates: newPendingUpdates,
      tracker,
    };
  }

  // Execute tasks (mock) - use persistent tracker from state
  for (const task of readyTasks) {
    assignTask(tracker, task);
    newRuntimeState = addRuntimeActiveTask(newRuntimeState, {
      id: task.identifier,
      pid: 0,
      pane: '',
      startedAt: new Date().toISOString(),
    });
  }

  const results = readyTasks.map((task) => controller.getExecutionResult(task));

  // Process skill outputs - check for NEEDS_WORK status
  for (const result of results) {
    if (result.rawOutput) {
      const status = extractStatus(result.rawOutput);
      if (status === 'NEEDS_WORK') {
        // Parse NEEDS_WORK output to find target subtask
        const match = result.rawOutput.match(/subtaskId:\s*(\S+)/);
        const targetSubtaskId = match ? match[1] : result.identifier;

        // Queue rework comment (in-memory for test)
        newPendingUpdates.push({
          type: 'add_comment',
          identifier: targetSubtaskId,
          body: '## 🔧 Needs Rework\n\nVerification gate found issues.',
        });

        // Reset target task to ready for re-execution
        // Look up the task from the ENTIRE graph, not just ready tasks
        const targetTask = getTaskByIdentifier(newGraph, targetSubtaskId);
        if (targetTask) {
          // Mark as ready (even if it was 'done')
          newGraph = updateTaskStatus(newGraph, targetTask.id, 'ready');
          // Add to retry queue if not already there
          if (!retryQueue.some((t) => t.identifier === targetSubtaskId)) {
            // Get the updated task from the new graph
            const updatedTask = getTaskByIdentifier(newGraph, targetSubtaskId);
            if (updatedTask) {
              retryQueue.push(updatedTask);
            }
          }
        }
      }
    }
  }

  // Verify results (mock)
  const verifiedResults = await processResultsWithMock(tracker, results, controller);

  // Process verified results
  for (const result of verifiedResults) {
    if (result.success && result.linearVerified) {
      newGraph = updateTaskStatus(newGraph, result.taskId, 'done');
      newRuntimeState = completeRuntimeTask(newRuntimeState, result.identifier);
    } else if (result.shouldRetry) {
      newRuntimeState = removeRuntimeActiveTask(newRuntimeState, result.identifier);
      const task = readyTasks.find((t) => t.identifier === result.identifier);
      if (task && !retryQueue.some((t) => t.identifier === result.identifier)) {
        retryQueue.push(task);
      }
    } else {
      newRuntimeState = failRuntimeTask(newRuntimeState, result.identifier);
    }
  }

  // Check for permanent failures
  if (hasPermamentFailures(verifiedResults)) {
    return {
      graph: newGraph,
      runtimeState: newRuntimeState,
      iteration,
      allComplete: false,
      anyFailed: true,
      retryQueue,
      pendingUpdates: newPendingUpdates,
      tracker,
    };
  }

  // Add retry tasks
  const needRetry = getRetryTasks(verifiedResults, readyTasks);
  for (const task of needRetry) {
    if (!retryQueue.some((t) => t.identifier === task.identifier)) {
      retryQueue.push(task);
    }
  }

  return {
    graph: newGraph,
    runtimeState: newRuntimeState,
    iteration,
    allComplete: false,
    anyFailed: false,
    retryQueue,
    pendingUpdates: newPendingUpdates,
    tracker,
  };
}

/**
 * Process results with mocked Linear verification
 */
async function processResultsWithMock(
  tracker: ReturnType<typeof createTracker>,
  results: ExecutionResult[],
  controller: MockExecutionController
): Promise<VerifiedResult[]> {
  const verifiedResults: VerifiedResult[] = [];

  for (const result of results) {
    const assignment = tracker.assignments.get(result.taskId);
    const attempts = assignment?.attempts ?? 1;

    if (assignment) {
      assignment.lastResult = result;
    }

    if (result.success) {
      const verification = controller.getVerificationResult(result.identifier);

      if (verification.verified) {
        verifiedResults.push({
          ...result,
          linearVerified: true,
          linearStatus: verification.status,
          shouldRetry: false,
        });
      } else {
        const canRetry = attempts <= tracker.maxRetries;
        verifiedResults.push({
          ...result,
          success: false,
          linearVerified: false,
          linearStatus: verification.status,
          shouldRetry: canRetry,
          error: verification.error || 'Linear verification failed',
        });
      }
    } else {
      const canRetry = attempts <= tracker.maxRetries;
      verifiedResults.push({
        ...result,
        linearVerified: false,
        shouldRetry: canRetry,
      });
    }
  }

  return verifiedResults;
}

// =============================================================================
// Tests
// =============================================================================

describe('TUI Reloop E2E Tests', () => {
  beforeEach(() => {
    setupTempDirectories();
    mockController = new MockExecutionController();

    // Suppress console output during tests
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Clean up context files before removing temp dir
    cleanupContext(fakeParentIssue.identifier);
    cleanupTempDirectories();
    mockController.reset();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('Scenario 1: Basic Task Execution', () => {
    it('executes 2 subtasks without verification gate', async () => {
      // Setup: 2 tasks, both complete successfully
      const subTasks = createFakeSubTasks({ taskCount: 2, includeVerificationGate: false });
      const graph = buildTaskGraph(fakeParentIssue.id, fakeParentIssue.identifier, subTasks);

      // Configure outcomes: both tasks succeed
      mockController.setTaskOutcome('TEST-101', [
        { success: true, status: 'SUBTASK_COMPLETE', linearVerified: true },
      ]);
      mockController.setTaskOutcome('TEST-102', [
        { success: true, status: 'SUBTASK_COMPLETE', linearVerified: true },
      ]);

      // Configure Linear verification
      mockController.setLinearStatuses('TEST-101', ['Done']);
      mockController.setLinearStatuses('TEST-102', ['Done']);

      // Initialize runtime state
      const runtimeState = initializeRuntimeState(
        fakeParentIssue.identifier,
        fakeParentIssue.title,
        { totalTasks: 2 }
      );

      let state: LoopState = {
        graph,
        runtimeState,
        iteration: 0,
        allComplete: false,
        anyFailed: false,
        retryQueue: [],
        pendingUpdates: [],
        tracker: createTracker(2, 5000),
      };

      // Run iterations
      // First iteration: TEST-101 becomes ready and executes
      state = await runLoopIteration(state, mockController);
      expect(state.iteration).toBe(1);

      // Second iteration: TEST-102 becomes unblocked and executes
      state = await runLoopIteration(state, mockController);
      expect(state.iteration).toBe(2);

      // Check final state
      const stats = getGraphStats(state.graph);
      expect(stats.done).toBe(2);
      expect(stats.total).toBe(2);

      // Verify execution counts
      expect(mockController.getExecutionCount('TEST-101')).toBe(1);
      expect(mockController.getExecutionCount('TEST-102')).toBe(1);
    });
  });

  describe('Scenario 2: Verification Gate Completes Successfully', () => {
    it('exits early when verification gate completes', async () => {
      // Setup: 2 tasks + verification gate
      const subTasks = createFakeSubTasks({ taskCount: 2, includeVerificationGate: true });
      const graph = buildTaskGraph(fakeParentIssue.id, fakeParentIssue.identifier, subTasks);

      // Configure outcomes: all tasks succeed
      mockController.setTaskOutcome('TEST-101', [
        { success: true, status: 'SUBTASK_COMPLETE', linearVerified: true },
      ]);
      mockController.setTaskOutcome('TEST-102', [
        { success: true, status: 'SUBTASK_COMPLETE', linearVerified: true },
      ]);
      mockController.setTaskOutcome('TEST-103', [
        { success: true, status: 'PASS', linearVerified: true },
      ]);

      // Configure Linear verification
      mockController.setLinearStatuses('TEST-101', ['Done']);
      mockController.setLinearStatuses('TEST-102', ['Done']);
      mockController.setLinearStatuses('TEST-103', ['Done']);

      const runtimeState = initializeRuntimeState(
        fakeParentIssue.identifier,
        fakeParentIssue.title,
        { totalTasks: 3 }
      );

      let state: LoopState = {
        graph,
        runtimeState,
        iteration: 0,
        allComplete: false,
        anyFailed: false,
        retryQueue: [],
        pendingUpdates: [],
        tracker: createTracker(2, 5000),
      };

      // Run iterations until complete
      const maxIterations = 10;
      while (!state.allComplete && state.iteration < maxIterations) {
        state = await runLoopIteration(state, mockController);
      }

      expect(state.allComplete).toBe(true);
      expect(state.anyFailed).toBe(false);

      // Verify verification gate was the last to complete
      const verificationTask = getVerificationTask(state.graph);
      expect(verificationTask?.status).toBe('done');
    });
  });

  describe('Scenario 3: Verification Gate Retriggers Previous Subtask (KEY TEST)', () => {
    it('re-executes subtask when verification gate outputs NEEDS_WORK', async () => {
      // Setup: 2 tasks + verification gate
      const subTasks = createFakeSubTasks({ taskCount: 2, includeVerificationGate: true });
      const graph = buildTaskGraph(fakeParentIssue.id, fakeParentIssue.identifier, subTasks);

      // Configure outcomes:
      // TEST-101: First execution completes, second execution also completes (after rework)
      mockController.setTaskOutcome('TEST-101', [
        { success: true, status: 'SUBTASK_COMPLETE', linearVerified: true },
        { success: true, status: 'SUBTASK_COMPLETE', linearVerified: true },
      ]);

      // TEST-102: Completes successfully
      mockController.setTaskOutcome('TEST-102', [
        { success: true, status: 'SUBTASK_COMPLETE', linearVerified: true },
      ]);

      // TEST-103 (verification gate): First execution outputs NEEDS_WORK for TEST-101
      // Second execution passes
      mockController.setTaskOutcome('TEST-103', [
        {
          success: true, // Verification gate "succeeded" in finding issues
          status: 'NEEDS_WORK',
          needsWorkTarget: 'TEST-101',
          linearVerified: false, // Not verified as "done" yet
        },
        {
          success: true,
          status: 'PASS',
          linearVerified: true,
        },
      ]);

      // Configure Linear verification
      mockController.setLinearStatuses('TEST-101', ['Done', 'Done']); // Done after both executions
      mockController.setLinearStatuses('TEST-102', ['Done']);
      mockController.setLinearStatuses('TEST-103', ['In Progress', 'Done']); // In Progress first, then Done

      const runtimeState = initializeRuntimeState(
        fakeParentIssue.identifier,
        fakeParentIssue.title,
        { totalTasks: 3 }
      );

      let state: LoopState = {
        graph,
        runtimeState,
        iteration: 0,
        allComplete: false,
        anyFailed: false,
        retryQueue: [],
        pendingUpdates: [],
        tracker: createTracker(2, 5000),
      };

      // Run iterations until complete or max reached
      const maxIterations = 10;
      while (!state.allComplete && !state.anyFailed && state.iteration < maxIterations) {
        state = await runLoopIteration(state, mockController);
      }

      // Assertions
      expect(state.allComplete).toBe(true);
      expect(state.anyFailed).toBe(false);

      // KEY ASSERTION: TEST-101 should have been executed twice
      expect(mockController.getExecutionCount('TEST-101')).toBe(2);

      // TEST-102 should have been executed once
      expect(mockController.getExecutionCount('TEST-102')).toBe(1);

      // TEST-103 (verification gate) should have been executed twice
      expect(mockController.getExecutionCount('TEST-103')).toBe(2);

      // Verify rework comment was queued (in-memory)
      const reworkComments = state.pendingUpdates.filter(
        (u) => u.type === 'add_comment' && u.identifier === 'TEST-101'
      );
      expect(reworkComments.length).toBeGreaterThanOrEqual(1);

      // Verify final state
      const stats = getGraphStats(state.graph);
      expect(stats.done).toBe(3);
    });
  });

  describe('Scenario 4: Max Retries Exceeded', () => {
    it('permanently fails task after max retries', async () => {
      const subTasks = createFakeSubTasks({ taskCount: 1, includeVerificationGate: false });
      const graph = buildTaskGraph(fakeParentIssue.id, fakeParentIssue.identifier, subTasks);

      // Configure outcomes: task fails repeatedly
      mockController.setTaskOutcome('TEST-101', [
        { success: false, status: 'VERIFICATION_FAILED', linearVerified: false },
        { success: false, status: 'VERIFICATION_FAILED', linearVerified: false },
        { success: false, status: 'VERIFICATION_FAILED', linearVerified: false },
        { success: false, status: 'VERIFICATION_FAILED', linearVerified: false },
      ]);

      // Linear never verifies as done
      mockController.setLinearStatuses('TEST-101', [
        'In Progress',
        'In Progress',
        'In Progress',
        'In Progress',
      ]);

      const runtimeState = initializeRuntimeState(
        fakeParentIssue.identifier,
        fakeParentIssue.title,
        { totalTasks: 1 }
      );

      let state: LoopState = {
        graph,
        runtimeState,
        iteration: 0,
        allComplete: false,
        anyFailed: false,
        retryQueue: [],
        pendingUpdates: [],
        tracker: createTracker(2, 5000), // max_retries = 2
      };

      // Run with max_retries = 2 (means 3 total attempts: initial + 2 retries)
      const maxIterations = 10;
      while (!state.allComplete && !state.anyFailed && state.iteration < maxIterations) {
        state = await runLoopIteration(state, mockController, 2);
      }

      // Should have failed permanently
      expect(state.anyFailed).toBe(true);
      expect(state.allComplete).toBe(false);

      // Task should have been executed up to max_retries + 1 times (3)
      expect(mockController.getExecutionCount('TEST-101')).toBe(3);
    });
  });

  describe('Scenario 5: Runtime State File Watching', () => {
    it('watchRuntimeState callback fires on state changes', async () => {
      const parentId = 'TEST-WATCH';
      const parentTitle = 'Watch Test Issue';

      // Initialize state
      const initialState = initializeRuntimeState(parentId, parentTitle, { totalTasks: 2 });

      // Track callback invocations
      const callbackStates: (RuntimeState | null)[] = [];
      let cleanupFn: (() => void) | null = null;

      // Start watching
      cleanupFn = watchRuntimeState(parentId, (state) => {
        callbackStates.push(state);
      });

      // Initial read should have triggered callback
      expect(callbackStates.length).toBeGreaterThanOrEqual(1);
      expect(callbackStates[0]?.parentId).toBe(parentId);

      // Modify state
      const updatedState = addRuntimeActiveTask(initialState, {
        id: 'TEST-101',
        pid: 12345,
        pane: '%0',
        startedAt: new Date().toISOString(),
      });

      // Wait a bit for watcher to pick up changes
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Complete the task
      completeRuntimeTask(updatedState, 'TEST-101');

      // Wait for watcher
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Cleanup
      if (cleanupFn) {
        cleanupFn();
      }

      // Clean up context for this test
      cleanupContext(parentId);

      // Verify callbacks were received
      expect(callbackStates.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Task Graph Operations', () => {
    it('correctly identifies verification gate task', () => {
      const subTasks = createFakeSubTasks({ taskCount: 2, includeVerificationGate: true });
      const graph = buildTaskGraph(fakeParentIssue.id, fakeParentIssue.identifier, subTasks);

      const verificationTask = getVerificationTask(graph);

      expect(verificationTask).toBeDefined();
      expect(verificationTask?.identifier).toBe('TEST-103');
      expect(verificationTask?.title).toContain('Verification Gate');
    });

    it('correctly calculates ready tasks based on dependencies', () => {
      const subTasks = createFakeSubTasks({ taskCount: 3, includeVerificationGate: true });
      const graph = buildTaskGraph(fakeParentIssue.id, fakeParentIssue.identifier, subTasks);

      // Initially only TEST-101 should be ready (no blockers)
      const readyTasks = getReadyTasks(graph);

      expect(readyTasks.length).toBe(1);
      expect(readyTasks[0].identifier).toBe('TEST-101');
    });

    it('updates task status immutably', () => {
      const subTasks = createFakeSubTasks({ taskCount: 2, includeVerificationGate: false });
      const graph = buildTaskGraph(fakeParentIssue.id, fakeParentIssue.identifier, subTasks);

      const originalStats = getGraphStats(graph);
      expect(originalStats.done).toBe(0);

      // Update first task to done
      const updatedGraph = updateTaskStatus(graph, 'subtask-uuid-101', 'done');
      const updatedStats = getGraphStats(updatedGraph);

      expect(updatedStats.done).toBe(1);

      // Original graph unchanged
      expect(getGraphStats(graph).done).toBe(0);

      // TEST-102 should now be ready (unblocked)
      const readyAfter = getReadyTasks(updatedGraph);
      expect(readyAfter.some((t) => t.identifier === 'TEST-102')).toBe(true);
    });
  });

  describe('Pending Updates Queue', () => {
    it('queues rework comment on NEEDS_WORK status', async () => {
      // Use isolated parent ID for this test
      const isolatedParentId = `TEST-QUEUE-${Date.now()}`;

      // Ensure clean state
      writePendingUpdates(isolatedParentId, { updates: [] });

      queuePendingUpdate(isolatedParentId, {
        type: 'add_comment',
        issueId: 'TEST-101',
        identifier: 'TEST-101',
        body: '## 🔧 Needs Rework\n\n### Issues Found\n- Missing test coverage',
      });

      const queue = readPendingUpdates(isolatedParentId);

      expect(queue.updates.length).toBe(1);
      expect(queue.updates[0].type).toBe('add_comment');

      // Use type guard for type-safe access
      const update = queue.updates[0];
      if (update.type === 'add_comment') {
        expect(update.identifier).toBe('TEST-101');
        expect(update.body).toContain('Needs Rework');
      }

      // Cleanup
      cleanupContext(isolatedParentId);
    });

    it('accumulates multiple updates', async () => {
      // Use isolated parent ID for this test
      const isolatedParentId = `TEST-QUEUE-MULTI-${Date.now()}`;

      // Ensure clean state
      writePendingUpdates(isolatedParentId, { updates: [] });

      queuePendingUpdate(isolatedParentId, {
        type: 'status_change',
        issueId: 'TEST-101',
        identifier: 'TEST-101',
        oldStatus: 'In Progress',
        newStatus: 'Done',
      });

      queuePendingUpdate(isolatedParentId, {
        type: 'add_comment',
        issueId: 'TEST-101',
        identifier: 'TEST-101',
        body: 'Completion comment',
      });

      queuePendingUpdate(isolatedParentId, {
        type: 'add_comment',
        issueId: 'TEST-102',
        identifier: 'TEST-102',
        body: 'Another comment',
      });

      const queue = readPendingUpdates(isolatedParentId);

      expect(queue.updates.length).toBe(3);
      expect(queue.updates.filter((u) => u.type === 'add_comment').length).toBe(2);
      expect(queue.updates.filter((u) => u.type === 'status_change').length).toBe(1);

      // Cleanup
      cleanupContext(isolatedParentId);
    });
  });

  describe('Mock Execution Controller', () => {
    it('tracks execution counts per task', () => {
      const task: SubTask = {
        id: 'subtask-uuid-101',
        identifier: 'TEST-101',
        title: 'Test task',
        status: 'ready',
        blockedBy: [],
        blocks: [],
        gitBranchName: 'feature/test-101',
      };

      mockController.setTaskOutcome('TEST-101', [
        { success: true, status: 'SUBTASK_COMPLETE', linearVerified: true },
        { success: true, status: 'SUBTASK_COMPLETE', linearVerified: true },
      ]);

      expect(mockController.getExecutionCount('TEST-101')).toBe(0);

      mockController.getExecutionResult(task);
      expect(mockController.getExecutionCount('TEST-101')).toBe(1);

      mockController.getExecutionResult(task);
      expect(mockController.getExecutionCount('TEST-101')).toBe(2);
    });

    it('returns different outcomes for each execution', () => {
      const task: SubTask = {
        id: 'subtask-uuid-101',
        identifier: 'TEST-101',
        title: 'Test task',
        status: 'ready',
        blockedBy: [],
        blocks: [],
        gitBranchName: 'feature/test-101',
      };

      mockController.setTaskOutcome('TEST-101', [
        { success: false, status: 'VERIFICATION_FAILED', linearVerified: false },
        { success: true, status: 'SUBTASK_COMPLETE', linearVerified: true },
      ]);

      const result1 = mockController.getExecutionResult(task);
      expect(result1.success).toBe(false);
      expect(result1.status).toBe('VERIFICATION_FAILED');

      const result2 = mockController.getExecutionResult(task);
      expect(result2.success).toBe(true);
      expect(result2.status).toBe('SUBTASK_COMPLETE');
    });

    it('generates appropriate raw output for each status', () => {
      const task: SubTask = {
        id: 'subtask-uuid-101',
        identifier: 'TEST-101',
        title: 'Test task',
        status: 'ready',
        blockedBy: [],
        blocks: [],
        gitBranchName: 'feature/test-101',
      };

      mockController.setTaskOutcome('TEST-101', [
        { success: true, status: 'NEEDS_WORK', needsWorkTarget: 'TEST-100' },
      ]);

      const result = mockController.getExecutionResult(task);

      expect(result.rawOutput).toContain('status: NEEDS_WORK');
      expect(result.rawOutput).toContain('subtaskId: TEST-100');
      expect(result.rawOutput).toContain('issues:');
      expect(result.rawOutput).toContain('suggestedFixes:');
    });
  });

  describe('Output Parser Integration', () => {
    it('extracts status from NEEDS_WORK output', () => {
      const output = `---
status: NEEDS_WORK
timestamp: 2024-01-01T00:00:00Z
subtaskId: TEST-101
issues:
  - Issue 1
suggestedFixes:
  - Fix 1
---`;

      const status = extractStatus(output);
      expect(status).toBe('NEEDS_WORK');
    });

    it('extracts status from SUBTASK_COMPLETE output', () => {
      const output = `---
status: SUBTASK_COMPLETE
timestamp: 2024-01-01T00:00:00Z
subtaskId: TEST-101
commitHash: abc1234
filesModified:
  - src/file.ts
verificationResults:
  typecheck: PASS
  tests: PASS
  lint: PASS
---`;

      const status = extractStatus(output);
      expect(status).toBe('SUBTASK_COMPLETE');
    });
  });
});
