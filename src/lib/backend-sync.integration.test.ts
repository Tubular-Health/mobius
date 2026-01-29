/**
 * Integration tests for backend sync workflow
 *
 * Tests the complete flow:
 * 1. Task completes → skill output parsed → status update queued
 * 2. Push command syncs updates to Linear/Jira
 * 3. Verification checks Linear confirms completion
 *
 * This test catches the gap where:
 * - Unit tests pass (individual functions work)
 * - But real behavior fails (push never called, verification fails)
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  cleanupContext,
  queuePendingUpdate,
  readPendingUpdates,
  writePendingUpdates,
} from './context-generator.js';
import {
  assignTask,
  createTracker,
  getRetryTasks,
  hasPermamentFailures,
  type VerifiedResult,
  verifyLinearCompletion,
} from './execution-tracker.js';
import { extractStatus, isTerminalStatus, parseSkillOutput } from './output-parser.js';
import type { ExecutionResult } from './parallel-executor.js';
import {
  buildTaskGraph,
  getGraphStats,
  getReadyTasks,
  type LinearIssue,
  type SubTask,
  updateTaskStatus,
} from './task-graph.js';

// =============================================================================
// Test Helpers and Mocks
// =============================================================================

/** Create a unique test parent ID to avoid conflicts */
function createTestParentId(): string {
  return `TEST-SYNC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Create fake subtasks for testing */
function createFakeSubTasks(count: number = 2): LinearIssue[] {
  const tasks: LinearIssue[] = [];

  for (let i = 1; i <= count; i++) {
    const blockedBy: Array<{ id: string; identifier: string }> = [];
    if (i > 1) {
      blockedBy.push({ id: `uuid-${i - 1}`, identifier: `SYNC-${100 + i - 1}` });
    }

    tasks.push({
      id: `uuid-${i}`,
      identifier: `SYNC-${100 + i}`,
      title: `Task ${i}`,
      status: 'Backlog',
      gitBranchName: `feature/sync-${100 + i}`,
      relations: { blockedBy, blocks: [] },
    });
  }

  return tasks;
}

/** Create skill output for SUBTASK_COMPLETE status */
function createCompleteOutput(subtaskId: string, commitHash: string = 'abc1234'): string {
  return `---
status: SUBTASK_COMPLETE
timestamp: ${new Date().toISOString()}
subtaskId: ${subtaskId}
commitHash: ${commitHash}
filesModified:
  - src/feature.ts
  - src/feature.test.ts
verificationResults:
  typecheck: PASS
  tests: PASS
  lint: PASS
---`;
}

/** Create skill output for NEEDS_WORK status */
function createNeedsWorkOutput(_subtaskId: string, targetId: string): string {
  return `---
status: NEEDS_WORK
timestamp: ${new Date().toISOString()}
subtaskId: ${targetId}
issues:
  - Test coverage insufficient
  - Missing edge case handling
suggestedFixes:
  - Add tests for edge cases
  - Handle null input
---`;
}

/**
 * Mock Linear SDK state tracker
 * Simulates Linear's actual state to test the full sync flow
 */
class MockLinearBackend {
  private issueStatuses: Map<string, string> = new Map();
  private issueComments: Map<string, string[]> = new Map();
  private updateCalls: Array<{ type: string; id: string; data: unknown }> = [];

  constructor() {
    this.reset();
  }

  reset(): void {
    this.issueStatuses.clear();
    this.issueComments.clear();
    this.updateCalls = [];
  }

  /** Initialize an issue with a status */
  initIssue(identifier: string, status: string = 'In Progress'): void {
    this.issueStatuses.set(identifier, status);
    this.issueComments.set(identifier, []);
  }

  /** Get current status of an issue */
  getStatus(identifier: string): string | undefined {
    return this.issueStatuses.get(identifier);
  }

  /** Update issue status (simulates SDK call) */
  updateStatus(identifier: string, newStatus: string): { success: boolean; error?: string } {
    this.updateCalls.push({ type: 'status_change', id: identifier, data: newStatus });

    if (!this.issueStatuses.has(identifier)) {
      return { success: false, error: 'Issue not found' };
    }

    this.issueStatuses.set(identifier, newStatus);
    return { success: true };
  }

  /** Add comment to issue (simulates SDK call) */
  addComment(identifier: string, body: string): { success: boolean; error?: string } {
    this.updateCalls.push({ type: 'add_comment', id: identifier, data: body });

    const comments = this.issueComments.get(identifier);
    if (!comments) {
      return { success: false, error: 'Issue not found' };
    }

    comments.push(body);
    return { success: true };
  }

  /** Get all update calls for verification */
  getUpdateCalls(): Array<{ type: string; id: string; data: unknown }> {
    return [...this.updateCalls];
  }

  /** Get comments for an issue */
  getComments(identifier: string): string[] {
    return this.issueComments.get(identifier) ?? [];
  }

  /** Verify issue is complete (simulates verification check) */
  verifyCompletion(identifier: string): { verified: boolean; status?: string } {
    const status = this.issueStatuses.get(identifier);
    if (!status) {
      return { verified: false };
    }

    const completedStatuses = ['Done', 'Completed', 'Cancelled'];
    const isComplete = completedStatuses.some((s) =>
      status.toLowerCase().includes(s.toLowerCase())
    );

    return { verified: isComplete, status };
  }
}

/**
 * Simulates the push command logic with mock backend
 */
async function simulatePush(
  parentId: string,
  backend: MockLinearBackend
): Promise<{ success: number; failed: number }> {
  const queue = readPendingUpdates(parentId);
  const pending = queue.updates.filter((u) => !u.syncedAt && !u.error);

  let success = 0;
  let failed = 0;

  for (const update of pending) {
    let result: { success: boolean; error?: string };

    switch (update.type) {
      case 'status_change':
        result = backend.updateStatus(update.identifier, update.newStatus);
        break;
      case 'add_comment':
        result = backend.addComment(update.identifier, update.body);
        break;
      default:
        result = { success: false, error: `Unsupported update type: ${update.type}` };
    }

    if (result.success) {
      success++;
      // Mark as synced
      update.syncedAt = new Date().toISOString();
    } else {
      failed++;
      update.error = result.error;
    }
  }

  // Write updated queue back
  writePendingUpdates(parentId, queue);

  return { success, failed };
}

/**
 * Simulates processResults with mock backend verification
 */
async function simulateProcessResults(
  tracker: ReturnType<typeof createTracker>,
  results: ExecutionResult[],
  backend: MockLinearBackend
): Promise<VerifiedResult[]> {
  const verifiedResults: VerifiedResult[] = [];

  for (const result of results) {
    const assignment = tracker.assignments.get(result.taskId);
    const attempts = assignment?.attempts ?? 1;

    if (assignment) {
      assignment.lastResult = result;
    }

    if (result.success) {
      // Verify with mock backend
      const verification = backend.verifyCompletion(result.identifier);

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
          error: 'Linear verification failed - status not Done',
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

/**
 * Process skill output and queue updates (mirrors loop.ts logic)
 *
 * Note: NEEDS_WORK is handled specially - it's not a "terminal" status
 * but we still need to queue comments for it. The loop.ts handles this
 * in a separate code path (lines 366-382).
 */
function processSkillOutputAndQueue(
  rawOutput: string,
  parentId: string
): { processed: boolean; status?: string } {
  const status = extractStatus(rawOutput);
  if (!status) {
    return { processed: false };
  }

  // NEEDS_WORK is special - not terminal but still needs processing
  const isProcessable = isTerminalStatus(status) || status === 'NEEDS_WORK';
  if (!isProcessable) {
    return { processed: false };
  }

  try {
    const parsed = parseSkillOutput(rawOutput);
    const output = parsed.output;

    switch (output.status) {
      case 'SUBTASK_COMPLETE': {
        if (output.subtaskId) {
          // Queue status change
          queuePendingUpdate(parentId, {
            type: 'status_change',
            issueId: output.subtaskId,
            identifier: output.subtaskId,
            oldStatus: 'In Progress',
            newStatus: 'Done',
          });

          // Queue completion comment
          queuePendingUpdate(parentId, {
            type: 'add_comment',
            issueId: output.subtaskId,
            identifier: output.subtaskId,
            body: `## ✅ Subtask Completed\n\n**Commit**: \`${output.commitHash}\``,
          });
        }
        return { processed: true, status };
      }

      case 'VERIFICATION_FAILED': {
        if (output.subtaskId) {
          queuePendingUpdate(parentId, {
            type: 'add_comment',
            issueId: output.subtaskId,
            identifier: output.subtaskId,
            body: `## ❌ Verification Failed\n\n**Error**: ${output.errorType}`,
          });
        }
        return { processed: true, status };
      }

      case 'NEEDS_WORK': {
        // Support both execute-issue format (subtaskId) and verify-issue format (failingSubtasks)
        const failingTasks: Array<{ id: string; identifier: string }> = [];

        if ('subtaskId' in output && output.subtaskId) {
          failingTasks.push({ id: output.subtaskId, identifier: output.subtaskId });
        }
        if ('failingSubtasks' in output && Array.isArray(output.failingSubtasks)) {
          for (const task of output.failingSubtasks) {
            failingTasks.push({ id: task.id, identifier: task.identifier });
          }
        }

        // Queue status change for each failing task
        for (const task of failingTasks) {
          queuePendingUpdate(parentId, {
            type: 'status_change',
            issueId: task.id,
            identifier: task.identifier,
            oldStatus: 'Done',
            newStatus: 'Todo',
          });
        }

        // Queue feedback comments
        if ('feedbackComments' in output && Array.isArray(output.feedbackComments)) {
          for (const fc of output.feedbackComments) {
            queuePendingUpdate(parentId, {
              type: 'add_comment',
              issueId: fc.subtaskId,
              identifier: fc.subtaskId,
              body: fc.comment,
            });
          }
        } else if (
          'subtaskId' in output &&
          output.subtaskId &&
          'issues' in output &&
          Array.isArray(output.issues)
        ) {
          queuePendingUpdate(parentId, {
            type: 'add_comment',
            issueId: output.subtaskId,
            identifier: output.subtaskId,
            body: `## 🔧 Needs Rework\n\n### Issues\n${output.issues.map((i: string) => `- ${i}`).join('\n')}`,
          });
        }
        return { processed: true, status };
      }

      default:
        return { processed: true, status };
    }
  } catch {
    return { processed: false };
  }
}

// =============================================================================
// Integration Tests
// =============================================================================

describe('Backend Sync Integration Tests', () => {
  let testParentId: string;
  let mockBackend: MockLinearBackend;

  beforeEach(() => {
    testParentId = createTestParentId();
    mockBackend = new MockLinearBackend();

    // Initialize pending updates queue
    writePendingUpdates(testParentId, { updates: [] });
  });

  afterEach(() => {
    cleanupContext(testParentId);
    mockBackend.reset();
  });

  describe('Complete Sync Flow: Queue → Push → Verify', () => {
    it('full workflow: task completes, push syncs, verification succeeds', async () => {
      // Setup: Initialize issue in mock backend
      mockBackend.initIssue('SYNC-101', 'In Progress');

      const tracker = createTracker(2, 5000);
      const task: SubTask = {
        id: 'uuid-1',
        identifier: 'SYNC-101',
        title: 'Test Task',
        status: 'ready',
        blockedBy: [],
        blocks: [],
        gitBranchName: 'feature/sync-101',
      };

      // Step 1: Assign and execute task
      assignTask(tracker, task);

      const rawOutput = createCompleteOutput('SYNC-101', 'def5678');
      const executionResult: ExecutionResult = {
        taskId: task.id,
        identifier: task.identifier,
        success: true,
        status: 'SUBTASK_COMPLETE',
        duration: 1000,
        rawOutput,
      };

      // Step 2: Process skill output and queue updates
      const processResult = processSkillOutputAndQueue(rawOutput, testParentId);
      expect(processResult.processed).toBe(true);
      expect(processResult.status).toBe('SUBTASK_COMPLETE');

      // Verify updates were queued
      const queueBefore = readPendingUpdates(testParentId);
      expect(queueBefore.updates.length).toBe(2); // status_change + add_comment
      expect(queueBefore.updates[0].type).toBe('status_change');
      expect(queueBefore.updates[1].type).toBe('add_comment');

      // Step 3: Verify FAILS before push (Linear not updated yet)
      const verifyBeforePush = await simulateProcessResults(
        tracker,
        [executionResult],
        mockBackend
      );
      expect(verifyBeforePush[0].linearVerified).toBe(false);
      expect(verifyBeforePush[0].shouldRetry).toBe(true);
      expect(verifyBeforePush[0].error).toContain('Linear verification failed');

      // Step 4: Push updates to backend
      const pushResult = await simulatePush(testParentId, mockBackend);
      expect(pushResult.success).toBe(2);
      expect(pushResult.failed).toBe(0);

      // Verify backend was updated
      expect(mockBackend.getStatus('SYNC-101')).toBe('Done');
      expect(mockBackend.getComments('SYNC-101').length).toBe(1);
      expect(mockBackend.getComments('SYNC-101')[0]).toContain('Subtask Completed');

      // Step 5: Verify SUCCEEDS after push
      const verifyAfterPush = await simulateProcessResults(tracker, [executionResult], mockBackend);
      expect(verifyAfterPush[0].linearVerified).toBe(true);
      expect(verifyAfterPush[0].linearStatus).toBe('Done');
      expect(verifyAfterPush[0].shouldRetry).toBe(false);

      // Step 6: Verify pending updates are marked as synced
      const queueAfter = readPendingUpdates(testParentId);
      const syncedUpdates = queueAfter.updates.filter((u) => u.syncedAt);
      expect(syncedUpdates.length).toBe(2);
    });

    it('detects gap: verification fails when push is never called', async () => {
      // This test reproduces the exact bug seen in production
      mockBackend.initIssue('SYNC-101', 'In Progress');

      const tracker = createTracker(2, 5000);
      const task: SubTask = {
        id: 'uuid-1',
        identifier: 'SYNC-101',
        title: 'Test Task',
        status: 'ready',
        blockedBy: [],
        blocks: [],
        gitBranchName: 'feature/sync-101',
      };

      assignTask(tracker, task);

      const rawOutput = createCompleteOutput('SYNC-101');
      const executionResult: ExecutionResult = {
        taskId: task.id,
        identifier: task.identifier,
        success: true,
        status: 'SUBTASK_COMPLETE',
        duration: 1000,
        rawOutput,
      };

      // Queue updates but DON'T push (this is the bug)
      processSkillOutputAndQueue(rawOutput, testParentId);

      // Verify pending queue has updates
      const queue = readPendingUpdates(testParentId);
      expect(queue.updates.length).toBe(2);
      expect(queue.updates.every((u) => !u.syncedAt)).toBe(true); // None synced

      // Verification fails because Linear was never updated
      const verification = await simulateProcessResults(tracker, [executionResult], mockBackend);

      expect(verification[0].linearVerified).toBe(false);
      expect(verification[0].shouldRetry).toBe(true);

      // Backend still shows "In Progress"
      expect(mockBackend.getStatus('SYNC-101')).toBe('In Progress');

      // This is the key assertion: updates are queued but not pushed
      const queueCheck = readPendingUpdates(testParentId);
      const pendingCount = queueCheck.updates.filter((u) => !u.syncedAt).length;
      expect(pendingCount).toBe(2); // Still pending!
    });

    it('retry loop exhausts attempts when push is never called', async () => {
      // Simulates the exact failure mode: task keeps retrying because Linear never updated
      mockBackend.initIssue('SYNC-101', 'In Progress');

      const tracker = createTracker(2, 5000); // max 2 retries = 3 total attempts
      const task: SubTask = {
        id: 'uuid-1',
        identifier: 'SYNC-101',
        title: 'Test Task',
        status: 'ready',
        blockedBy: [],
        blocks: [],
        gitBranchName: 'feature/sync-101',
      };

      const rawOutput = createCompleteOutput('SYNC-101');

      // Simulate 3 attempts without pushing
      for (let attempt = 1; attempt <= 3; attempt++) {
        assignTask(tracker, task);

        const executionResult: ExecutionResult = {
          taskId: task.id,
          identifier: task.identifier,
          success: true,
          status: 'SUBTASK_COMPLETE',
          duration: 1000,
          rawOutput,
        };

        // Queue updates (duplicates accumulate - this is the bug symptom)
        processSkillOutputAndQueue(rawOutput, testParentId);

        // Verification fails
        const verification = await simulateProcessResults(tracker, [executionResult], mockBackend);

        if (attempt < 3) {
          expect(verification[0].shouldRetry).toBe(true);
        } else {
          // After max retries, shouldRetry becomes false (permanent failure)
          expect(verification[0].shouldRetry).toBe(false);
        }
      }

      // Check that deduplication prevented duplicate accumulation
      // (Only 2 unique updates should exist, not 6)
      const queue = readPendingUpdates(testParentId);
      expect(queue.updates.length).toBe(2); // Deduplication works correctly

      // All still pending
      expect(queue.updates.every((u) => !u.syncedAt)).toBe(true);
    });
  });

  describe('Push Before Verify Pattern (The Fix)', () => {
    it('push-before-verify pattern succeeds on first attempt', async () => {
      mockBackend.initIssue('SYNC-101', 'In Progress');

      const tracker = createTracker(2, 5000);
      const task: SubTask = {
        id: 'uuid-1',
        identifier: 'SYNC-101',
        title: 'Test Task',
        status: 'ready',
        blockedBy: [],
        blocks: [],
        gitBranchName: 'feature/sync-101',
      };

      assignTask(tracker, task);

      const rawOutput = createCompleteOutput('SYNC-101');
      const executionResult: ExecutionResult = {
        taskId: task.id,
        identifier: task.identifier,
        success: true,
        status: 'SUBTASK_COMPLETE',
        duration: 1000,
        rawOutput,
      };

      // Process skill output
      processSkillOutputAndQueue(rawOutput, testParentId);

      // THE FIX: Push BEFORE verification
      const pushResult = await simulatePush(testParentId, mockBackend);
      expect(pushResult.success).toBe(2);

      // Now verification succeeds
      const verification = await simulateProcessResults(tracker, [executionResult], mockBackend);

      expect(verification[0].linearVerified).toBe(true);
      expect(verification[0].shouldRetry).toBe(false);

      // No retry needed
      const retryTasks = getRetryTasks(verification, [task]);
      expect(retryTasks.length).toBe(0);

      // No permanent failures
      expect(hasPermamentFailures(verification)).toBe(false);
    });

    it('auto-push after queueing updates succeeds', async () => {
      // This tests the "auto-push" fix pattern
      mockBackend.initIssue('SYNC-101', 'In Progress');
      mockBackend.initIssue('SYNC-102', 'In Progress');

      const tracker = createTracker(2, 5000);
      const subTasks = createFakeSubTasks(2);
      const graph = buildTaskGraph('parent-uuid', testParentId, subTasks);

      // Execute first task
      const task1 = getReadyTasks(graph)[0];
      assignTask(tracker, task1);

      const output1 = createCompleteOutput(task1.identifier);
      processSkillOutputAndQueue(output1, testParentId);

      // Auto-push immediately after queueing
      await simulatePush(testParentId, mockBackend);

      const result1: ExecutionResult = {
        taskId: task1.id,
        identifier: task1.identifier,
        success: true,
        status: 'SUBTASK_COMPLETE',
        duration: 1000,
        rawOutput: output1,
      };

      const verification1 = await simulateProcessResults(tracker, [result1], mockBackend);
      expect(verification1[0].linearVerified).toBe(true);

      // Update graph
      const updatedGraph = updateTaskStatus(graph, task1.id, 'done');

      // Execute second task (now unblocked)
      const task2 = getReadyTasks(updatedGraph)[0];
      assignTask(tracker, task2);

      const output2 = createCompleteOutput(task2.identifier);
      processSkillOutputAndQueue(output2, testParentId);

      // Auto-push again
      await simulatePush(testParentId, mockBackend);

      const result2: ExecutionResult = {
        taskId: task2.id,
        identifier: task2.identifier,
        success: true,
        status: 'SUBTASK_COMPLETE',
        duration: 1000,
        rawOutput: output2,
      };

      const verification2 = await simulateProcessResults(tracker, [result2], mockBackend);
      expect(verification2[0].linearVerified).toBe(true);

      // All updates synced
      const queue = readPendingUpdates(testParentId);
      const allSynced = queue.updates.every((u) => u.syncedAt);
      expect(allSynced).toBe(true);

      // Both issues marked Done in backend
      expect(mockBackend.getStatus('SYNC-101')).toBe('Done');
      expect(mockBackend.getStatus('SYNC-102')).toBe('Done');
    });
  });

  describe('Error Handling in Sync Flow', () => {
    it('handles push failure gracefully', async () => {
      // Issue doesn't exist in backend
      const tracker = createTracker(2, 5000);
      const task: SubTask = {
        id: 'uuid-1',
        identifier: 'SYNC-MISSING',
        title: 'Missing Task',
        status: 'ready',
        blockedBy: [],
        blocks: [],
        gitBranchName: 'feature/sync-missing',
      };

      assignTask(tracker, task);

      const rawOutput = createCompleteOutput('SYNC-MISSING');
      processSkillOutputAndQueue(rawOutput, testParentId);

      // Push fails because issue doesn't exist
      const pushResult = await simulatePush(testParentId, mockBackend);
      expect(pushResult.success).toBe(0);
      expect(pushResult.failed).toBe(2);

      // Updates marked with error
      const queue = readPendingUpdates(testParentId);
      const failedUpdates = queue.updates.filter((u) => u.error);
      expect(failedUpdates.length).toBe(2);
      expect(failedUpdates[0].error).toContain('Issue not found');
    });

    it('partial push failure: some updates succeed, some fail', async () => {
      mockBackend.initIssue('SYNC-101', 'In Progress');
      // SYNC-102 doesn't exist

      // Queue updates for both issues
      queuePendingUpdate(testParentId, {
        type: 'status_change',
        issueId: 'SYNC-101',
        identifier: 'SYNC-101',
        oldStatus: 'In Progress',
        newStatus: 'Done',
      });

      queuePendingUpdate(testParentId, {
        type: 'status_change',
        issueId: 'SYNC-102',
        identifier: 'SYNC-102',
        oldStatus: 'In Progress',
        newStatus: 'Done',
      });

      const pushResult = await simulatePush(testParentId, mockBackend);
      expect(pushResult.success).toBe(1);
      expect(pushResult.failed).toBe(1);

      // One synced, one failed
      const queue = readPendingUpdates(testParentId);
      expect(queue.updates[0].syncedAt).toBeDefined();
      expect(queue.updates[1].error).toBeDefined();
    });
  });

  describe('NEEDS_WORK Flow', () => {
    it('NEEDS_WORK queues status change and rework comment', async () => {
      mockBackend.initIssue('SYNC-101', 'Done'); // Already completed
      mockBackend.initIssue('SYNC-VERIFY', 'In Progress');

      const rawOutput = createNeedsWorkOutput('SYNC-VERIFY', 'SYNC-101');

      // Process NEEDS_WORK output
      const result = processSkillOutputAndQueue(rawOutput, testParentId);
      expect(result.processed).toBe(true);
      expect(result.status).toBe('NEEDS_WORK');

      // Status change and rework comment queued
      const queue = readPendingUpdates(testParentId);
      expect(queue.updates.length).toBe(2);

      // First update: status change to reopen the task
      expect(queue.updates[0].type).toBe('status_change');
      if (queue.updates[0].type === 'status_change') {
        expect(queue.updates[0].identifier).toBe('SYNC-101');
        expect(queue.updates[0].oldStatus).toBe('Done');
        expect(queue.updates[0].newStatus).toBe('Todo');
      }

      // Second update: rework comment
      expect(queue.updates[1].type).toBe('add_comment');
      if (queue.updates[1].type === 'add_comment') {
        expect(queue.updates[1].body).toContain('Needs Rework');
        expect(queue.updates[1].identifier).toBe('SYNC-101');
      }

      // Push the updates
      await simulatePush(testParentId, mockBackend);

      // Status changed to Todo
      expect(mockBackend.getStatus('SYNC-101')).toBe('Todo');

      // Comment added to target issue
      const comments = mockBackend.getComments('SYNC-101');
      expect(comments.length).toBe(1);
      expect(comments[0]).toContain('Needs Rework');
    });

    it('NEEDS_WORK with verify-issue format handles multiple failing subtasks', async () => {
      mockBackend.initIssue('SYNC-101', 'Done');
      mockBackend.initIssue('SYNC-102', 'Done');
      mockBackend.initIssue('SYNC-VERIFY', 'In Progress');

      // Verify-issue format output with multiple failing subtasks
      const rawOutput = `---
status: NEEDS_WORK
timestamp: ${new Date().toISOString()}
parentId: SYNC-PARENT
verificationTaskId: SYNC-VERIFY
failingSubtasks:
  - id: SYNC-101
    identifier: SYNC-101
    issues:
      - type: critical
        description: Missing tests
  - id: SYNC-102
    identifier: SYNC-102
    issues:
      - type: important
        description: Code style issues
reworkIteration: 1
feedbackComments:
  - subtaskId: SYNC-101
    comment: "## Rework: Missing tests"
  - subtaskId: SYNC-102
    comment: "## Rework: Code style issues"
---`;

      const result = processSkillOutputAndQueue(rawOutput, testParentId);
      expect(result.processed).toBe(true);
      expect(result.status).toBe('NEEDS_WORK');

      // Should have 4 updates: 2 status changes + 2 comments
      const queue = readPendingUpdates(testParentId);
      expect(queue.updates.length).toBe(4);

      // Status changes for both tasks
      const statusChanges = queue.updates.filter((u) => u.type === 'status_change');
      expect(statusChanges.length).toBe(2);
      expect(statusChanges.map((u) => u.identifier).sort()).toEqual(['SYNC-101', 'SYNC-102']);

      // Comments for both tasks
      const comments = queue.updates.filter((u) => u.type === 'add_comment');
      expect(comments.length).toBe(2);
      expect(comments.map((u) => u.identifier).sort()).toEqual(['SYNC-101', 'SYNC-102']);

      // Push the updates
      await simulatePush(testParentId, mockBackend);

      // Both tasks reopened
      expect(mockBackend.getStatus('SYNC-101')).toBe('Todo');
      expect(mockBackend.getStatus('SYNC-102')).toBe('Todo');
    });
  });

  describe('Graph Sync After Push', () => {
    it('graph reflects correct status after push-verify cycle', async () => {
      mockBackend.initIssue('SYNC-101', 'In Progress');
      mockBackend.initIssue('SYNC-102', 'Backlog');

      const subTasks = createFakeSubTasks(2);
      let graph = buildTaskGraph('parent-uuid', testParentId, subTasks);

      const tracker = createTracker(2, 5000);

      // Initial state
      let stats = getGraphStats(graph);
      expect(stats.done).toBe(0);
      expect(stats.ready).toBe(1); // Only first task ready

      // Execute first task
      const task1 = getReadyTasks(graph)[0];
      assignTask(tracker, task1);

      const output1 = createCompleteOutput(task1.identifier);
      processSkillOutputAndQueue(output1, testParentId);
      await simulatePush(testParentId, mockBackend);

      const result1: ExecutionResult = {
        taskId: task1.id,
        identifier: task1.identifier,
        success: true,
        status: 'SUBTASK_COMPLETE',
        duration: 1000,
        rawOutput: output1,
      };

      const verification1 = await simulateProcessResults(tracker, [result1], mockBackend);
      expect(verification1[0].linearVerified).toBe(true);

      // Update local graph
      graph = updateTaskStatus(graph, task1.id, 'done');

      // Second task should now be ready
      stats = getGraphStats(graph);
      expect(stats.done).toBe(1);
      expect(stats.ready).toBe(1); // Second task now ready

      const readyAfter = getReadyTasks(graph);
      expect(readyAfter.length).toBe(1);
      expect(readyAfter[0].identifier).toBe('SYNC-102');
    });
  });
});

describe('Real verifyLinearCompletion Behavior', () => {
  const originalEnv = process.env.LINEAR_API_KEY;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.LINEAR_API_KEY = originalEnv;
    } else {
      delete process.env.LINEAR_API_KEY;
    }
  });

  it('returns error when LINEAR_API_KEY not set', async () => {
    delete process.env.LINEAR_API_KEY;

    const result = await verifyLinearCompletion('MOB-123');

    expect(result.verified).toBe(false);
    expect(result.error).toBe('LINEAR_API_KEY not set');
  });

  it('fails with invalid API key', async () => {
    process.env.LINEAR_API_KEY = 'invalid-key';

    const result = await verifyLinearCompletion('MOB-123', 2000);

    expect(result.verified).toBe(false);
    expect(result.error).toBeDefined();
  });
});
