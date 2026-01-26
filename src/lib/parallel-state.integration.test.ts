/**
 * Integration tests for parallel state consistency
 *
 * These tests verify that concurrent state updates don't corrupt each other.
 * Simulates multiple agents completing simultaneously and verifies:
 * 1. No task is lost from completed/failed arrays
 * 2. No duplicate entries in any array
 * 3. Active tasks are correctly transitioned
 *
 * Uses a temp directory for isolation - no real tmux or Linear API calls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  initializeExecutionState,
  addActiveTask,
  completeTask,
  failTask,
  removeActiveTask,
  readExecutionState,
  withExecutionState,
  getStateFilePath,
} from './execution-state.js';
import type { ActiveTask } from '../types.js';

// Test constants
const PARENT_ID = 'TEST-100';
const PARENT_TITLE = 'Test Parent Issue';

// Helper to create mock active tasks
function createMockActiveTask(id: string, paneId: string = '%0'): ActiveTask {
  return {
    id,
    pid: Math.floor(Math.random() * 100000) + 1000,
    pane: paneId,
    startedAt: new Date().toISOString(),
    worktree: `/tmp/worktree-${id}`,
  };
}

// Helper to get task IDs from completed/failed arrays
function getTaskIds(tasks: (string | { id: string })[]): string[] {
  return tasks.map(t => (typeof t === 'string' ? t : t.id));
}

// Helper to check for duplicates in an array
function hasDuplicates(arr: string[]): boolean {
  return new Set(arr).size !== arr.length;
}

describe('parallel state consistency', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a fresh temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'mobius-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('concurrent task completion', () => {
    it('handles 3 agents completing tasks simultaneously without data loss', async () => {
      // Initialize state with 3 active tasks
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 3,
      });

      // Add 3 active tasks
      const task1 = createMockActiveTask('TEST-101', '%1');
      const task2 = createMockActiveTask('TEST-102', '%2');
      const task3 = createMockActiveTask('TEST-103', '%3');

      let state = addActiveTask(initialState, task1, tempDir);
      state = addActiveTask(state, task2, tempDir);
      state = addActiveTask(state, task3, tempDir);

      // Verify initial state
      const beforeState = readExecutionState(PARENT_ID, tempDir);
      expect(beforeState?.activeTasks.length).toBe(3);
      expect(beforeState?.completedTasks.length).toBe(0);

      // Simulate 3 agents completing simultaneously using async withExecutionState
      // This tests the locking mechanism under concurrent access
      const completionPromises = [
        withExecutionState(
          PARENT_ID,
          (currentState) => {
            if (!currentState) throw new Error('State not found');
            const now = new Date();
            const activeTask = currentState.activeTasks.find(t => t.id === 'TEST-101');
            const duration = activeTask
              ? now.getTime() - new Date(activeTask.startedAt).getTime()
              : 0;
            return {
              ...currentState,
              activeTasks: currentState.activeTasks.filter(t => t.id !== 'TEST-101'),
              completedTasks: [
                ...currentState.completedTasks,
                { id: 'TEST-101', completedAt: now.toISOString(), duration },
              ],
            };
          },
          tempDir
        ),
        withExecutionState(
          PARENT_ID,
          (currentState) => {
            if (!currentState) throw new Error('State not found');
            const now = new Date();
            const activeTask = currentState.activeTasks.find(t => t.id === 'TEST-102');
            const duration = activeTask
              ? now.getTime() - new Date(activeTask.startedAt).getTime()
              : 0;
            return {
              ...currentState,
              activeTasks: currentState.activeTasks.filter(t => t.id !== 'TEST-102'),
              completedTasks: [
                ...currentState.completedTasks,
                { id: 'TEST-102', completedAt: now.toISOString(), duration },
              ],
            };
          },
          tempDir
        ),
        withExecutionState(
          PARENT_ID,
          (currentState) => {
            if (!currentState) throw new Error('State not found');
            const now = new Date();
            const activeTask = currentState.activeTasks.find(t => t.id === 'TEST-103');
            const duration = activeTask
              ? now.getTime() - new Date(activeTask.startedAt).getTime()
              : 0;
            return {
              ...currentState,
              activeTasks: currentState.activeTasks.filter(t => t.id !== 'TEST-103'),
              completedTasks: [
                ...currentState.completedTasks,
                { id: 'TEST-103', completedAt: now.toISOString(), duration },
              ],
            };
          },
          tempDir
        ),
      ];

      // Wait for all completions
      await Promise.all(completionPromises);

      // Verify final state
      const finalState = readExecutionState(PARENT_ID, tempDir);
      expect(finalState).not.toBeNull();

      // 1. No task is lost - all 3 should be in completedTasks
      const completedIds = getTaskIds(finalState!.completedTasks);
      expect(completedIds.length).toBe(3);
      expect(completedIds).toContain('TEST-101');
      expect(completedIds).toContain('TEST-102');
      expect(completedIds).toContain('TEST-103');

      // 2. No duplicate entries
      expect(hasDuplicates(completedIds)).toBe(false);

      // 3. Active tasks are correctly transitioned (should be empty)
      expect(finalState!.activeTasks.length).toBe(0);
    });

    it('handles mixed completion and failure outcomes without data loss', async () => {
      // Initialize state
      initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 3,
      });

      // Add 3 active tasks using the synchronous helper
      const task1 = createMockActiveTask('TEST-201', '%1');
      const task2 = createMockActiveTask('TEST-202', '%2');
      const task3 = createMockActiveTask('TEST-203', '%3');

      let state = readExecutionState(PARENT_ID, tempDir)!;
      state = addActiveTask(state, task1, tempDir);
      state = addActiveTask(state, task2, tempDir);
      state = addActiveTask(state, task3, tempDir);

      // Verify initial state
      const beforeState = readExecutionState(PARENT_ID, tempDir);
      expect(beforeState?.activeTasks.length).toBe(3);

      // Simulate mixed outcomes: 2 complete, 1 fails
      const outcomePromises = [
        // TEST-201 completes
        withExecutionState(
          PARENT_ID,
          (currentState) => {
            if (!currentState) throw new Error('State not found');
            const now = new Date();
            const activeTask = currentState.activeTasks.find(t => t.id === 'TEST-201');
            const duration = activeTask
              ? now.getTime() - new Date(activeTask.startedAt).getTime()
              : 0;
            return {
              ...currentState,
              activeTasks: currentState.activeTasks.filter(t => t.id !== 'TEST-201'),
              completedTasks: [
                ...currentState.completedTasks,
                { id: 'TEST-201', completedAt: now.toISOString(), duration },
              ],
            };
          },
          tempDir
        ),
        // TEST-202 fails
        withExecutionState(
          PARENT_ID,
          (currentState) => {
            if (!currentState) throw new Error('State not found');
            const now = new Date();
            const activeTask = currentState.activeTasks.find(t => t.id === 'TEST-202');
            const duration = activeTask
              ? now.getTime() - new Date(activeTask.startedAt).getTime()
              : 0;
            return {
              ...currentState,
              activeTasks: currentState.activeTasks.filter(t => t.id !== 'TEST-202'),
              failedTasks: [
                ...currentState.failedTasks,
                { id: 'TEST-202', completedAt: now.toISOString(), duration },
              ],
            };
          },
          tempDir
        ),
        // TEST-203 completes
        withExecutionState(
          PARENT_ID,
          (currentState) => {
            if (!currentState) throw new Error('State not found');
            const now = new Date();
            const activeTask = currentState.activeTasks.find(t => t.id === 'TEST-203');
            const duration = activeTask
              ? now.getTime() - new Date(activeTask.startedAt).getTime()
              : 0;
            return {
              ...currentState,
              activeTasks: currentState.activeTasks.filter(t => t.id !== 'TEST-203'),
              completedTasks: [
                ...currentState.completedTasks,
                { id: 'TEST-203', completedAt: now.toISOString(), duration },
              ],
            };
          },
          tempDir
        ),
      ];

      await Promise.all(outcomePromises);

      // Verify final state
      const finalState = readExecutionState(PARENT_ID, tempDir);
      expect(finalState).not.toBeNull();

      // 1. No task is lost
      const completedIds = getTaskIds(finalState!.completedTasks);
      const failedIds = getTaskIds(finalState!.failedTasks);
      const allFinishedIds = [...completedIds, ...failedIds];

      expect(allFinishedIds.length).toBe(3);
      expect(completedIds).toContain('TEST-201');
      expect(completedIds).toContain('TEST-203');
      expect(failedIds).toContain('TEST-202');

      // 2. No duplicate entries in any array
      expect(hasDuplicates(completedIds)).toBe(false);
      expect(hasDuplicates(failedIds)).toBe(false);
      expect(hasDuplicates(allFinishedIds)).toBe(false);

      // 3. Active tasks are correctly transitioned
      expect(finalState!.activeTasks.length).toBe(0);
    });

    it('handles rapid sequential state updates without race conditions', async () => {
      // Initialize state
      initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 5,
      });

      // Add 5 active tasks
      const tasks = [
        createMockActiveTask('TEST-301', '%1'),
        createMockActiveTask('TEST-302', '%2'),
        createMockActiveTask('TEST-303', '%3'),
        createMockActiveTask('TEST-304', '%4'),
        createMockActiveTask('TEST-305', '%5'),
      ];

      let state = readExecutionState(PARENT_ID, tempDir)!;
      for (const task of tasks) {
        state = addActiveTask(state, task, tempDir);
      }

      // Verify initial state
      const beforeState = readExecutionState(PARENT_ID, tempDir);
      expect(beforeState?.activeTasks.length).toBe(5);

      // Complete all tasks concurrently
      const completionPromises = tasks.map(task =>
        withExecutionState(
          PARENT_ID,
          (currentState) => {
            if (!currentState) throw new Error('State not found');
            const now = new Date();
            const activeTask = currentState.activeTasks.find(t => t.id === task.id);
            const duration = activeTask
              ? now.getTime() - new Date(activeTask.startedAt).getTime()
              : 0;
            return {
              ...currentState,
              activeTasks: currentState.activeTasks.filter(t => t.id !== task.id),
              completedTasks: [
                ...currentState.completedTasks,
                { id: task.id, completedAt: now.toISOString(), duration },
              ],
            };
          },
          tempDir
        )
      );

      await Promise.all(completionPromises);

      // Verify final state
      const finalState = readExecutionState(PARENT_ID, tempDir);
      expect(finalState).not.toBeNull();

      const completedIds = getTaskIds(finalState!.completedTasks);

      // All 5 tasks should be completed, none lost
      expect(completedIds.length).toBe(5);
      for (const task of tasks) {
        expect(completedIds).toContain(task.id);
      }

      // No duplicates
      expect(hasDuplicates(completedIds)).toBe(false);

      // No active tasks remaining
      expect(finalState!.activeTasks.length).toBe(0);
    });
  });

  describe('state transitions', () => {
    it('correctly transitions task from active to completed using completeTask()', () => {
      // Initialize state with one active task
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
      });

      const task = createMockActiveTask('TEST-401', '%1');
      const stateWithTask = addActiveTask(initialState, task, tempDir);

      // Verify task is in activeTasks
      expect(stateWithTask.activeTasks.length).toBe(1);
      expect(stateWithTask.activeTasks[0].id).toBe('TEST-401');

      // Complete the task
      const finalState = completeTask(stateWithTask, 'TEST-401', tempDir);

      // Verify transition
      expect(finalState.activeTasks.length).toBe(0);
      expect(finalState.completedTasks.length).toBe(1);
      expect(getTaskIds(finalState.completedTasks)).toContain('TEST-401');
    });

    it('correctly transitions task from active to failed using failTask()', () => {
      // Initialize state with one active task
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
      });

      const task = createMockActiveTask('TEST-402', '%1');
      const stateWithTask = addActiveTask(initialState, task, tempDir);

      // Verify task is in activeTasks
      expect(stateWithTask.activeTasks.length).toBe(1);

      // Fail the task
      const finalState = failTask(stateWithTask, 'TEST-402', tempDir);

      // Verify transition
      expect(finalState.activeTasks.length).toBe(0);
      expect(finalState.failedTasks.length).toBe(1);
      expect(getTaskIds(finalState.failedTasks)).toContain('TEST-402');
    });

    it('correctly removes task from active without completion (for retries)', () => {
      // Initialize state with one active task
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
      });

      const task = createMockActiveTask('TEST-403', '%1');
      const stateWithTask = addActiveTask(initialState, task, tempDir);

      // Remove for retry (not complete or fail)
      const finalState = removeActiveTask(stateWithTask, 'TEST-403', tempDir);

      // Verify task is removed but not in completed or failed
      expect(finalState.activeTasks.length).toBe(0);
      expect(finalState.completedTasks.length).toBe(0);
      expect(finalState.failedTasks.length).toBe(0);
    });

    it('maintains state consistency when completing non-existent task', () => {
      // Initialize state with one active task
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
      });

      const task = createMockActiveTask('TEST-404', '%1');
      const stateWithTask = addActiveTask(initialState, task, tempDir);

      // Try to complete a task that doesn't exist
      const finalState = completeTask(stateWithTask, 'NON-EXISTENT', tempDir);

      // Original task should still be active
      expect(finalState.activeTasks.length).toBe(1);
      expect(finalState.activeTasks[0].id).toBe('TEST-404');

      // Completed should have an entry (with 0 duration since task wasn't found)
      expect(finalState.completedTasks.length).toBe(1);
      expect(getTaskIds(finalState.completedTasks)).toContain('NON-EXISTENT');
    });
  });

  describe('lock file behavior', () => {
    it('lock file is cleaned up after successful operation', async () => {
      initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
      });

      const filePath = getStateFilePath(PARENT_ID, tempDir);
      const lockPath = `${filePath}.lock`;

      // Perform an operation
      await withExecutionState(
        PARENT_ID,
        (state) => {
          if (!state) throw new Error('State not found');
          return state;
        },
        tempDir
      );

      // Lock file should not exist after operation
      expect(existsSync(lockPath)).toBe(false);
    });

    it('handles concurrent access with proper locking', async () => {
      initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
      });

      let operationOrder: number[] = [];

      // Run 3 operations concurrently that track their execution order
      const promises = [1, 2, 3].map(n =>
        withExecutionState(
          PARENT_ID,
          (state) => {
            if (!state) throw new Error('State not found');
            operationOrder.push(n);
            return state;
          },
          tempDir
        )
      );

      await Promise.all(promises);

      // All 3 operations should have completed
      expect(operationOrder.length).toBe(3);
      // Each operation should appear exactly once
      expect(operationOrder.sort()).toEqual([1, 2, 3]);
    });
  });

  describe('data integrity', () => {
    it('preserves all task metadata through transitions', () => {
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: 12345,
        totalTasks: 1,
      });

      // Create task with specific metadata
      const task: ActiveTask = {
        id: 'TEST-501',
        pid: 54321,
        pane: '%99',
        startedAt: '2024-01-01T00:00:00.000Z',
        worktree: '/custom/worktree/path',
      };

      const stateWithTask = addActiveTask(initialState, task, tempDir);

      // Verify task metadata preserved
      expect(stateWithTask.activeTasks[0]).toEqual(task);

      // Complete task and verify duration is calculated correctly
      const finalState = completeTask(stateWithTask, 'TEST-501', tempDir);

      const completedTask = finalState.completedTasks[0];
      expect(typeof completedTask).toBe('object');
      if (typeof completedTask === 'object') {
        expect(completedTask.id).toBe('TEST-501');
        expect(completedTask.duration).toBeGreaterThanOrEqual(0);
        expect(completedTask.completedAt).toBeDefined();
      }
    });

    it('maintains parent issue metadata through operations', async () => {
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: 12345,
        totalTasks: 10,
      });

      // Perform several operations
      const task = createMockActiveTask('TEST-502', '%1');
      let state = addActiveTask(initialState, task, tempDir);
      state = completeTask(state, 'TEST-502', tempDir);

      // Verify parent metadata is preserved
      const finalState = readExecutionState(PARENT_ID, tempDir);
      expect(finalState?.parentId).toBe(PARENT_ID);
      expect(finalState?.parentTitle).toBe(PARENT_TITLE);
      expect(finalState?.loopPid).toBe(12345);
      expect(finalState?.totalTasks).toBe(10);
    });

    it('does not create duplicate completed entries for same task', async () => {
      initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
      });

      const task = createMockActiveTask('TEST-503', '%1');
      let state = readExecutionState(PARENT_ID, tempDir)!;
      state = addActiveTask(state, task, tempDir);

      // Try to complete the same task multiple times concurrently
      // This simulates a race condition where multiple agents might try to
      // mark the same task as complete
      const completionPromises = [1, 2, 3].map(() =>
        withExecutionState(
          PARENT_ID,
          (currentState) => {
            if (!currentState) throw new Error('State not found');

            // Check if already completed (idempotency check)
            const alreadyCompleted = currentState.completedTasks.some(t =>
              (typeof t === 'string' ? t : t.id) === 'TEST-503'
            );

            if (alreadyCompleted) {
              return currentState; // No change
            }

            const now = new Date();
            const activeTask = currentState.activeTasks.find(t => t.id === 'TEST-503');
            const duration = activeTask
              ? now.getTime() - new Date(activeTask.startedAt).getTime()
              : 0;

            return {
              ...currentState,
              activeTasks: currentState.activeTasks.filter(t => t.id !== 'TEST-503'),
              completedTasks: [
                ...currentState.completedTasks,
                { id: 'TEST-503', completedAt: now.toISOString(), duration },
              ],
            };
          },
          tempDir
        )
      );

      await Promise.all(completionPromises);

      // Verify only one completion entry
      const finalState = readExecutionState(PARENT_ID, tempDir);
      const completedIds = getTaskIds(finalState!.completedTasks);

      expect(completedIds.filter(id => id === 'TEST-503').length).toBe(1);
      expect(hasDuplicates(completedIds)).toBe(false);
    });
  });
});
