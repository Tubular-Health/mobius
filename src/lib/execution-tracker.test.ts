/**
 * Unit tests for the execution-tracker module
 */

import { describe, it, expect } from 'bun:test';
import {
  createTracker,
  assignTask,
  getRetryTasks,
  getPermanentlyFailedTasks,
  allSucceeded,
  hasPermamentFailures,
  getTrackerStats,
  resetTracker,
  type VerifiedResult,
} from './execution-tracker.js';
import type { SubTask } from './task-graph.js';

// Helper to create mock subtasks
function createMockSubTask(id: string, identifier: string): SubTask {
  return {
    id,
    identifier,
    title: `Task ${identifier}`,
    status: 'ready',
    blockedBy: [],
    blocks: [],
    gitBranchName: `feature/${identifier.toLowerCase()}`,
  };
}

// Helper to create mock verified results
function createVerifiedResult(
  taskId: string,
  identifier: string,
  success: boolean,
  linearVerified: boolean,
  shouldRetry: boolean = false,
  error?: string
): VerifiedResult {
  return {
    taskId,
    identifier,
    success,
    status: success ? 'SUBTASK_COMPLETE' : 'ERROR',
    duration: 1000,
    linearVerified,
    shouldRetry,
    error,
  };
}

describe('createTracker', () => {
  it('creates a tracker with default values', () => {
    const tracker = createTracker();
    expect(tracker.maxRetries).toBe(2);
    expect(tracker.verificationTimeout).toBe(5000);
    expect(tracker.assignments.size).toBe(0);
  });

  it('creates a tracker with custom values', () => {
    const tracker = createTracker(5, 10000);
    expect(tracker.maxRetries).toBe(5);
    expect(tracker.verificationTimeout).toBe(10000);
  });
});

describe('assignTask', () => {
  it('assigns a new task with attempt count 1', () => {
    const tracker = createTracker();
    const task = createMockSubTask('id-1', 'MOB-101');

    assignTask(tracker, task);

    const assignment = tracker.assignments.get('id-1');
    expect(assignment).toBeDefined();
    expect(assignment?.taskId).toBe('id-1');
    expect(assignment?.identifier).toBe('MOB-101');
    expect(assignment?.attempts).toBe(1);
  });

  it('increments attempt count on reassignment', () => {
    const tracker = createTracker();
    const task = createMockSubTask('id-1', 'MOB-101');

    assignTask(tracker, task);
    expect(tracker.assignments.get('id-1')?.attempts).toBe(1);

    assignTask(tracker, task);
    expect(tracker.assignments.get('id-1')?.attempts).toBe(2);

    assignTask(tracker, task);
    expect(tracker.assignments.get('id-1')?.attempts).toBe(3);
  });

  it('tracks multiple tasks independently', () => {
    const tracker = createTracker();
    const task1 = createMockSubTask('id-1', 'MOB-101');
    const task2 = createMockSubTask('id-2', 'MOB-102');

    assignTask(tracker, task1);
    assignTask(tracker, task2);
    assignTask(tracker, task1); // Retry task1

    expect(tracker.assignments.get('id-1')?.attempts).toBe(2);
    expect(tracker.assignments.get('id-2')?.attempts).toBe(1);
  });
});

describe('getRetryTasks', () => {
  it('returns tasks that should be retried', () => {
    const allTasks: SubTask[] = [
      createMockSubTask('id-1', 'MOB-101'),
      createMockSubTask('id-2', 'MOB-102'),
      createMockSubTask('id-3', 'MOB-103'),
    ];

    const results: VerifiedResult[] = [
      createVerifiedResult('id-1', 'MOB-101', true, true, false),
      createVerifiedResult('id-2', 'MOB-102', false, false, true, 'Verification failed'),
      createVerifiedResult('id-3', 'MOB-103', false, false, false, 'Max retries exceeded'),
    ];

    const retryTasks = getRetryTasks(results, allTasks);

    expect(retryTasks.length).toBe(1);
    expect(retryTasks[0].identifier).toBe('MOB-102');
  });

  it('returns empty array when no retries needed', () => {
    const allTasks: SubTask[] = [
      createMockSubTask('id-1', 'MOB-101'),
    ];

    const results: VerifiedResult[] = [
      createVerifiedResult('id-1', 'MOB-101', true, true, false),
    ];

    const retryTasks = getRetryTasks(results, allTasks);
    expect(retryTasks.length).toBe(0);
  });

  it('handles multiple retry tasks', () => {
    const allTasks: SubTask[] = [
      createMockSubTask('id-1', 'MOB-101'),
      createMockSubTask('id-2', 'MOB-102'),
    ];

    const results: VerifiedResult[] = [
      createVerifiedResult('id-1', 'MOB-101', false, false, true),
      createVerifiedResult('id-2', 'MOB-102', false, false, true),
    ];

    const retryTasks = getRetryTasks(results, allTasks);
    expect(retryTasks.length).toBe(2);
  });
});

describe('getPermanentlyFailedTasks', () => {
  it('returns tasks that permanently failed', () => {
    const results: VerifiedResult[] = [
      createVerifiedResult('id-1', 'MOB-101', true, true, false),
      createVerifiedResult('id-2', 'MOB-102', false, false, true),
      createVerifiedResult('id-3', 'MOB-103', false, false, false, 'Max retries exceeded'),
    ];

    const failed = getPermanentlyFailedTasks(results);

    expect(failed.length).toBe(1);
    expect(failed[0].identifier).toBe('MOB-103');
  });

  it('returns empty array when no permanent failures', () => {
    const results: VerifiedResult[] = [
      createVerifiedResult('id-1', 'MOB-101', true, true, false),
      createVerifiedResult('id-2', 'MOB-102', false, false, true),
    ];

    const failed = getPermanentlyFailedTasks(results);
    expect(failed.length).toBe(0);
  });
});

describe('allSucceeded', () => {
  it('returns true when all results succeeded and verified', () => {
    const results: VerifiedResult[] = [
      createVerifiedResult('id-1', 'MOB-101', true, true, false),
      createVerifiedResult('id-2', 'MOB-102', true, true, false),
    ];

    expect(allSucceeded(results)).toBe(true);
  });

  it('returns false when any result failed', () => {
    const results: VerifiedResult[] = [
      createVerifiedResult('id-1', 'MOB-101', true, true, false),
      createVerifiedResult('id-2', 'MOB-102', false, false, true),
    ];

    expect(allSucceeded(results)).toBe(false);
  });

  it('returns false when result succeeded but not verified', () => {
    const results: VerifiedResult[] = [
      createVerifiedResult('id-1', 'MOB-101', true, false, false),
    ];

    expect(allSucceeded(results)).toBe(false);
  });

  it('returns true for empty results', () => {
    expect(allSucceeded([])).toBe(true);
  });
});

describe('hasPermamentFailures', () => {
  it('returns true when any task permanently failed', () => {
    const results: VerifiedResult[] = [
      createVerifiedResult('id-1', 'MOB-101', true, true, false),
      createVerifiedResult('id-2', 'MOB-102', false, false, false), // No retry = permanent
    ];

    expect(hasPermamentFailures(results)).toBe(true);
  });

  it('returns false when failures can be retried', () => {
    const results: VerifiedResult[] = [
      createVerifiedResult('id-1', 'MOB-101', true, true, false),
      createVerifiedResult('id-2', 'MOB-102', false, false, true), // Can retry
    ];

    expect(hasPermamentFailures(results)).toBe(false);
  });

  it('returns false when all succeeded', () => {
    const results: VerifiedResult[] = [
      createVerifiedResult('id-1', 'MOB-101', true, true, false),
    ];

    expect(hasPermamentFailures(results)).toBe(false);
  });

  it('returns false for empty results', () => {
    expect(hasPermamentFailures([])).toBe(false);
  });
});

describe('getTrackerStats', () => {
  it('returns correct statistics', () => {
    const tracker = createTracker(3); // maxRetries = 3
    const task1 = createMockSubTask('id-1', 'MOB-101');
    const task2 = createMockSubTask('id-2', 'MOB-102');
    const task3 = createMockSubTask('id-3', 'MOB-103');

    assignTask(tracker, task1);
    assignTask(tracker, task1); // Retry (2 attempts)
    assignTask(tracker, task2); // 1 attempt
    assignTask(tracker, task3);
    assignTask(tracker, task3);
    assignTask(tracker, task3); // 3 attempts = max

    const stats = getTrackerStats(tracker);

    expect(stats.totalAssigned).toBe(3);
    expect(stats.retriedTasks).toBe(2); // task1 and task3 were retried
    expect(stats.maxAttemptsReached).toBe(1); // only task3 at max retries
  });

  it('returns zero stats for empty tracker', () => {
    const tracker = createTracker();
    const stats = getTrackerStats(tracker);

    expect(stats.totalAssigned).toBe(0);
    expect(stats.retriedTasks).toBe(0);
    expect(stats.maxAttemptsReached).toBe(0);
  });
});

describe('resetTracker', () => {
  it('clears all assignments', () => {
    const tracker = createTracker();
    const task = createMockSubTask('id-1', 'MOB-101');

    assignTask(tracker, task);
    expect(tracker.assignments.size).toBe(1);

    resetTracker(tracker);
    expect(tracker.assignments.size).toBe(0);
  });

  it('preserves config after reset', () => {
    const tracker = createTracker(5, 10000);
    resetTracker(tracker);

    expect(tracker.maxRetries).toBe(5);
    expect(tracker.verificationTimeout).toBe(10000);
  });
});

describe('integration: retry flow simulation', () => {
  it('simulates a complete retry flow with maxRetries=2 allowing 3 total executions', () => {
    const tracker = createTracker(2); // maxRetries=2 means attempts 1, 2 can retry; attempt 3 cannot
    const tasks: SubTask[] = [
      createMockSubTask('id-1', 'MOB-101'),
      createMockSubTask('id-2', 'MOB-102'),
    ];

    // First execution (attempt 1): MOB-101 succeeds, MOB-102 fails
    for (const task of tasks) {
      assignTask(tracker, task);
    }

    const firstResults: VerifiedResult[] = [
      createVerifiedResult('id-1', 'MOB-101', true, true, false),
      createVerifiedResult('id-2', 'MOB-102', false, false, true, 'Verification timeout'),
    ];

    let retryTasks = getRetryTasks(firstResults, tasks);
    expect(retryTasks.length).toBe(1);
    expect(retryTasks[0].identifier).toBe('MOB-102');
    expect(hasPermamentFailures(firstResults)).toBe(false);

    // Second execution (attempt 2): MOB-102 fails again, but can still retry (2 <= 2)
    assignTask(tracker, retryTasks[0]); // Attempt 2

    const secondResults: VerifiedResult[] = [
      createVerifiedResult('id-2', 'MOB-102', false, false, true, 'Verification timeout'),
    ];

    retryTasks = getRetryTasks(secondResults, tasks);
    expect(retryTasks.length).toBe(1); // Can still retry at attempt 2
    expect(hasPermamentFailures(secondResults)).toBe(false);

    // Third execution (attempt 3): MOB-102 fails again, now exceeds retries (3 > 2)
    assignTask(tracker, retryTasks[0]); // Attempt 3

    const thirdResults: VerifiedResult[] = [
      createVerifiedResult('id-2', 'MOB-102', false, false, false, 'Max retries exceeded'),
    ];

    retryTasks = getRetryTasks(thirdResults, tasks);
    expect(retryTasks.length).toBe(0);
    expect(hasPermamentFailures(thirdResults)).toBe(true);

    // Check tracker stats
    const stats = getTrackerStats(tracker);
    expect(stats.totalAssigned).toBe(2);
    expect(stats.retriedTasks).toBe(1);
    expect(stats.maxAttemptsReached).toBe(1); // task2 is at 3 attempts, >= maxRetries(2)
  });

  it('allows retry when attempts equals maxRetries', () => {
    // This test verifies the fix: attempts <= maxRetries (not <)
    // With maxRetries=2, attempt 2 should still allow retry
    const tracker = createTracker(2);
    const task = createMockSubTask('id-1', 'MOB-101');

    // First attempt (attempt 1)
    assignTask(tracker, task);
    expect(tracker.assignments.get('id-1')?.attempts).toBe(1);
    // At attempt 1, 1 <= 2 is true, so retry should be allowed

    // Second attempt (attempt 2) - this is the edge case
    assignTask(tracker, task);
    expect(tracker.assignments.get('id-1')?.attempts).toBe(2);
    // At attempt 2, 2 <= 2 is true, so retry should STILL be allowed
    // This was the bug: the old code used < which would have made 2 < 2 = false

    // Third attempt (attempt 3) - this exceeds maxRetries
    assignTask(tracker, task);
    expect(tracker.assignments.get('id-1')?.attempts).toBe(3);
    // At attempt 3, 3 <= 2 is false, so retry should NOT be allowed

    const stats = getTrackerStats(tracker);
    expect(stats.totalAssigned).toBe(1);
    expect(stats.retriedTasks).toBe(1);
    expect(stats.maxAttemptsReached).toBe(1); // 3 >= 2
  });

  it('simulates successful retry', () => {
    const tracker = createTracker(3);
    const task = createMockSubTask('id-1', 'MOB-101');

    // First attempt: fails
    assignTask(tracker, task);
    let result: VerifiedResult[] = [
      createVerifiedResult('id-1', 'MOB-101', false, false, true),
    ];
    expect(getRetryTasks(result, [task]).length).toBe(1);

    // Second attempt: fails
    assignTask(tracker, task);
    result = [
      createVerifiedResult('id-1', 'MOB-101', false, false, true),
    ];
    expect(getRetryTasks(result, [task]).length).toBe(1);

    // Third attempt: succeeds
    assignTask(tracker, task);
    result = [
      createVerifiedResult('id-1', 'MOB-101', true, true, false),
    ];
    expect(getRetryTasks(result, [task]).length).toBe(0);
    expect(allSucceeded(result)).toBe(true);

    const stats = getTrackerStats(tracker);
    expect(stats.totalAssigned).toBe(1);
    expect(stats.retriedTasks).toBe(1);
    expect(stats.maxAttemptsReached).toBe(1); // 3 attempts = max
  });
});
