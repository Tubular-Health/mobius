/**
 * Execution tracker module
 *
 * Tracks task assignments and verifies completion via Linear SDK.
 * Handles retry logic for failed tasks.
 */

import { LinearClient } from '@linear/sdk';
import type { ExecutionResult } from './parallel-executor.js';
import type { SubTask } from './task-graph.js';

export interface TaskAssignment {
  taskId: string;
  identifier: string;
  attempts: number;
  lastResult?: ExecutionResult;
}

export interface ExecutionTracker {
  assignments: Map<string, TaskAssignment>;
  maxRetries: number;
  verificationTimeout: number;
}

export interface VerifiedResult extends ExecutionResult {
  linearVerified: boolean;
  linearStatus?: string;
  shouldRetry: boolean;
}

/**
 * Create a new execution tracker
 */
export function createTracker(
  maxRetries: number = 2,
  verificationTimeout: number = 5000
): ExecutionTracker {
  return {
    assignments: new Map(),
    maxRetries,
    verificationTimeout,
  };
}

/**
 * Assign a task to the tracker before execution
 */
export function assignTask(tracker: ExecutionTracker, task: SubTask): void {
  const existing = tracker.assignments.get(task.id);
  if (existing) {
    // Increment attempt count for retry
    existing.attempts += 1;
  } else {
    tracker.assignments.set(task.id, {
      taskId: task.id,
      identifier: task.identifier,
      attempts: 1,
    });
  }
}

/**
 * Verify task completion via Linear SDK
 *
 * Checks if the task status in Linear indicates completion (Done, Completed, etc.)
 */
export async function verifyLinearCompletion(
  taskIdentifier: string,
  timeout: number = 5000
): Promise<{ verified: boolean; status?: string; error?: string }> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    return { verified: false, error: 'LINEAR_API_KEY not set' };
  }

  try {
    const client = new LinearClient({ apiKey });

    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Verification timeout')), timeout);
    });

    // Race the API call against the timeout
    const issue = await Promise.race([
      client.issue(taskIdentifier),
      timeoutPromise,
    ]);

    if (!issue) {
      return { verified: false, error: 'Issue not found' };
    }

    const state = await Promise.race([
      issue.state,
      timeoutPromise,
    ]);

    const statusName = state?.name || 'Unknown';

    // Check if status indicates completion
    const completedStatuses = ['done', 'completed', 'cancelled', 'canceled'];
    const inProgressStatuses = ['in progress', 'in review', 'started'];

    const lowerStatus = statusName.toLowerCase();
    const isCompleted = completedStatuses.some(s => lowerStatus.includes(s));
    const isInProgress = inProgressStatuses.some(s => lowerStatus.includes(s));

    // Consider "In Progress" as verified since the skill moves tasks there after implementation
    const verified = isCompleted || isInProgress;

    return { verified, status: statusName };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { verified: false, error: errorMessage };
  }
}

/**
 * Process execution results with Linear verification
 *
 * For each successful result, verifies completion via Linear SDK.
 * Returns verified results with retry recommendations.
 */
export async function processResults(
  tracker: ExecutionTracker,
  results: ExecutionResult[]
): Promise<VerifiedResult[]> {
  const verifiedResults: VerifiedResult[] = [];

  for (const result of results) {
    const assignment = tracker.assignments.get(result.taskId);
    const attempts = assignment?.attempts ?? 1;

    // Store the result
    if (assignment) {
      assignment.lastResult = result;
    }

    if (result.success) {
      // Verify with Linear SDK
      const verification = await verifyLinearCompletion(
        result.identifier,
        tracker.verificationTimeout
      );

      if (verification.verified) {
        verifiedResults.push({
          ...result,
          linearVerified: true,
          linearStatus: verification.status,
          shouldRetry: false,
        });
      } else {
        // Agent reported success but Linear doesn't confirm
        // This could be a timing issue or actual failure
        const canRetry = attempts < tracker.maxRetries;
        verifiedResults.push({
          ...result,
          success: false, // Override to false
          linearVerified: false,
          linearStatus: verification.status,
          shouldRetry: canRetry,
          error: verification.error || 'Linear verification failed',
        });
      }
    } else {
      // Agent reported failure
      const canRetry = attempts < tracker.maxRetries;
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
 * Get tasks that should be retried based on verification results
 */
export function getRetryTasks(
  results: VerifiedResult[],
  allTasks: SubTask[]
): SubTask[] {
  const retryTaskIds = results
    .filter(r => r.shouldRetry)
    .map(r => r.taskId);

  return allTasks.filter(t => retryTaskIds.includes(t.id));
}

/**
 * Get tasks that permanently failed (exceeded max retries)
 */
export function getPermanentlyFailedTasks(
  results: VerifiedResult[]
): VerifiedResult[] {
  return results.filter(r => !r.success && !r.shouldRetry);
}

/**
 * Check if all verified results succeeded
 */
export function allSucceeded(results: VerifiedResult[]): boolean {
  return results.every(r => r.success && r.linearVerified);
}

/**
 * Check if any task has permanently failed
 */
export function hasPermamentFailures(results: VerifiedResult[]): boolean {
  return results.some(r => !r.success && !r.shouldRetry);
}

/**
 * Reset tracker for a new execution round
 */
export function resetTracker(tracker: ExecutionTracker): void {
  tracker.assignments.clear();
}

/**
 * Get summary statistics from tracker
 */
export function getTrackerStats(tracker: ExecutionTracker): {
  totalAssigned: number;
  retriedTasks: number;
  maxAttemptsReached: number;
} {
  let retriedTasks = 0;
  let maxAttemptsReached = 0;

  for (const assignment of tracker.assignments.values()) {
    if (assignment.attempts > 1) {
      retriedTasks++;
    }
    if (assignment.attempts >= tracker.maxRetries) {
      maxAttemptsReached++;
    }
  }

  return {
    totalAssigned: tracker.assignments.size,
    retriedTasks,
    maxAttemptsReached,
  };
}
