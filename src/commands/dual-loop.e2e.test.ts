/**
 * E2E tests for dual (parallel) mobius loop execution
 *
 * Verifies that two separate mobius loops can run simultaneously without
 * interference. Tests state isolation between loops by mocking Linear API
 * responses and tmux sessions while using real state file operations.
 *
 * Key scenarios tested:
 * 1. mobius-TASK-A and mobius-TASK-B create separate state files
 * 2. Completing TASK-A doesn't affect TASK-B state
 * 3. Both loops can complete successfully without conflicts
 * 4. Clean shutdown of one loop doesn't affect the other
 *
 * Uses temp directories for isolation - no real tmux sessions, Claude processes,
 * or Linear API calls are made.
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
  readExecutionState,
  clearAllActiveTasks,
  deleteExecutionState,
  getStateFilePath,
} from '../lib/execution-state.js';
import type { ActiveTask, CompletedTask } from '../types.js';

// Test constants for two independent loops
const LOOP_A = {
  parentId: 'DUAL-100',
  parentTitle: 'Loop A: Feature Implementation',
  tasks: ['DUAL-101', 'DUAL-102', 'DUAL-103'],
};

const LOOP_B = {
  parentId: 'DUAL-200',
  parentTitle: 'Loop B: Bug Fixes',
  tasks: ['DUAL-201', 'DUAL-202', 'DUAL-203'],
};

// Helper to create mock active task
function createMockActiveTask(
  identifier: string,
  paneIndex: number,
  worktreeBase: string
): ActiveTask {
  return {
    id: identifier,
    pid: Math.floor(Math.random() * 100000) + 1000,
    pane: `%${paneIndex}`,
    startedAt: new Date().toISOString(),
    worktree: join(worktreeBase, identifier.toLowerCase()),
  };
}

// Helper to extract task IDs from completed/failed arrays
function getTaskIds(tasks: (string | CompletedTask)[]): string[] {
  return tasks.map(t => (typeof t === 'string' ? t : t.id));
}

// Helper to check for duplicates
function hasDuplicates(arr: string[]): boolean {
  return new Set(arr).size !== arr.length;
}

// Helper for async delays
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('dual-loop e2e', () => {
  let tempDir: string;
  let worktreeBaseA: string;
  let worktreeBaseB: string;

  beforeEach(() => {
    // Create separate temp directories for state and worktrees
    tempDir = mkdtempSync(join(tmpdir(), 'mobius-dual-test-'));
    worktreeBaseA = mkdtempSync(join(tmpdir(), 'mobius-worktrees-a-'));
    worktreeBaseB = mkdtempSync(join(tmpdir(), 'mobius-worktrees-b-'));
  });

  afterEach(() => {
    // Clean up temp directories
    for (const dir of [tempDir, worktreeBaseA, worktreeBaseB]) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  describe('separate state files per parent task', () => {
    it('creates distinct state files for TASK-A and TASK-B', () => {
      // Initialize both loops
      initializeExecutionState(LOOP_A.parentId, LOOP_A.parentTitle, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: LOOP_A.tasks.length,
      });

      initializeExecutionState(LOOP_B.parentId, LOOP_B.parentTitle, {
        stateDir: tempDir,
        loopPid: process.pid + 1, // Simulate separate process
        totalTasks: LOOP_B.tasks.length,
      });

      // Verify separate state files exist
      const stateFileA = getStateFilePath(LOOP_A.parentId, tempDir);
      const stateFileB = getStateFilePath(LOOP_B.parentId, tempDir);

      expect(existsSync(stateFileA)).toBe(true);
      expect(existsSync(stateFileB)).toBe(true);
      expect(stateFileA).not.toBe(stateFileB);

      // Verify state content is independent
      const stateA = readExecutionState(LOOP_A.parentId, tempDir);
      const stateB = readExecutionState(LOOP_B.parentId, tempDir);

      expect(stateA).not.toBeNull();
      expect(stateB).not.toBeNull();
      expect(stateA!.parentId).toBe(LOOP_A.parentId);
      expect(stateB!.parentId).toBe(LOOP_B.parentId);
      expect(stateA!.parentTitle).toBe(LOOP_A.parentTitle);
      expect(stateB!.parentTitle).toBe(LOOP_B.parentTitle);
    });

    it('maintains independent task arrays for each loop', () => {
      // Initialize both loops
      let stateA = initializeExecutionState(LOOP_A.parentId, LOOP_A.parentTitle, {
        stateDir: tempDir,
        totalTasks: LOOP_A.tasks.length,
      });

      let stateB = initializeExecutionState(LOOP_B.parentId, LOOP_B.parentTitle, {
        stateDir: tempDir,
        totalTasks: LOOP_B.tasks.length,
      });

      // Add tasks to Loop A
      for (let i = 0; i < LOOP_A.tasks.length; i++) {
        const task = createMockActiveTask(LOOP_A.tasks[i], i, worktreeBaseA);
        stateA = addActiveTask(stateA, task, tempDir);
      }

      // Add tasks to Loop B
      for (let i = 0; i < LOOP_B.tasks.length; i++) {
        const task = createMockActiveTask(LOOP_B.tasks[i], i, worktreeBaseB);
        stateB = addActiveTask(stateB, task, tempDir);
      }

      // Verify each loop has only its own tasks
      const diskStateA = readExecutionState(LOOP_A.parentId, tempDir);
      const diskStateB = readExecutionState(LOOP_B.parentId, tempDir);

      expect(diskStateA!.activeTasks.length).toBe(LOOP_A.tasks.length);
      expect(diskStateB!.activeTasks.length).toBe(LOOP_B.tasks.length);

      // Verify no cross-contamination
      const taskIdsA = diskStateA!.activeTasks.map(t => t.id);
      const taskIdsB = diskStateB!.activeTasks.map(t => t.id);

      for (const taskId of taskIdsA) {
        expect(taskId.startsWith('DUAL-1')).toBe(true); // Loop A tasks
        expect(taskIdsB).not.toContain(taskId);
      }

      for (const taskId of taskIdsB) {
        expect(taskId.startsWith('DUAL-2')).toBe(true); // Loop B tasks
        expect(taskIdsA).not.toContain(taskId);
      }
    });
  });

  describe('state isolation (A completion does not affect B)', () => {
    it('completing all tasks in Loop A leaves Loop B unchanged', async () => {
      // Initialize both loops
      let stateA = initializeExecutionState(LOOP_A.parentId, LOOP_A.parentTitle, {
        stateDir: tempDir,
        totalTasks: LOOP_A.tasks.length,
      });

      let stateB = initializeExecutionState(LOOP_B.parentId, LOOP_B.parentTitle, {
        stateDir: tempDir,
        totalTasks: LOOP_B.tasks.length,
      });

      // Add tasks to both loops
      for (let i = 0; i < LOOP_A.tasks.length; i++) {
        stateA = addActiveTask(
          stateA,
          createMockActiveTask(LOOP_A.tasks[i], i, worktreeBaseA),
          tempDir
        );
      }

      for (let i = 0; i < LOOP_B.tasks.length; i++) {
        stateB = addActiveTask(
          stateB,
          createMockActiveTask(LOOP_B.tasks[i], i, worktreeBaseB),
          tempDir
        );
      }

      // Take snapshot of Loop B state before Loop A completes
      const snapshotB = readExecutionState(LOOP_B.parentId, tempDir);
      expect(snapshotB!.activeTasks.length).toBe(3);
      expect(snapshotB!.completedTasks.length).toBe(0);

      // Complete all tasks in Loop A
      for (const taskId of LOOP_A.tasks) {
        stateA = completeTask(stateA, taskId, tempDir);
      }

      // Verify Loop A is fully complete
      const finalStateA = readExecutionState(LOOP_A.parentId, tempDir);
      expect(finalStateA!.activeTasks.length).toBe(0);
      expect(finalStateA!.completedTasks.length).toBe(3);

      // Verify Loop B is completely unchanged
      const afterStateB = readExecutionState(LOOP_B.parentId, tempDir);
      expect(afterStateB!.activeTasks.length).toBe(3);
      expect(afterStateB!.completedTasks.length).toBe(0);

      // Verify same task IDs in Loop B
      const beforeIds = snapshotB!.activeTasks.map(t => t.id).sort();
      const afterIds = afterStateB!.activeTasks.map(t => t.id).sort();
      expect(afterIds).toEqual(beforeIds);
    });

    it('failing tasks in Loop A does not affect Loop B', async () => {
      // Initialize both loops
      let stateA = initializeExecutionState(LOOP_A.parentId, LOOP_A.parentTitle, {
        stateDir: tempDir,
        totalTasks: LOOP_A.tasks.length,
      });

      let stateB = initializeExecutionState(LOOP_B.parentId, LOOP_B.parentTitle, {
        stateDir: tempDir,
        totalTasks: LOOP_B.tasks.length,
      });

      // Add tasks to both loops
      for (let i = 0; i < LOOP_A.tasks.length; i++) {
        stateA = addActiveTask(
          stateA,
          createMockActiveTask(LOOP_A.tasks[i], i, worktreeBaseA),
          tempDir
        );
      }

      for (let i = 0; i < LOOP_B.tasks.length; i++) {
        stateB = addActiveTask(
          stateB,
          createMockActiveTask(LOOP_B.tasks[i], i, worktreeBaseB),
          tempDir
        );
      }

      // Fail all tasks in Loop A
      for (const taskId of LOOP_A.tasks) {
        stateA = failTask(stateA, taskId, tempDir);
      }

      // Verify Loop A has all failures
      const finalStateA = readExecutionState(LOOP_A.parentId, tempDir);
      expect(finalStateA!.activeTasks.length).toBe(0);
      expect(finalStateA!.failedTasks.length).toBe(3);

      // Verify Loop B is unchanged (still all active)
      const afterStateB = readExecutionState(LOOP_B.parentId, tempDir);
      expect(afterStateB!.activeTasks.length).toBe(3);
      expect(afterStateB!.failedTasks.length).toBe(0);
      expect(afterStateB!.completedTasks.length).toBe(0);
    });

    it('concurrent operations on both loops maintain isolation', async () => {
      // Initialize both loops
      let stateA = initializeExecutionState(LOOP_A.parentId, LOOP_A.parentTitle, {
        stateDir: tempDir,
        totalTasks: LOOP_A.tasks.length,
      });

      let stateB = initializeExecutionState(LOOP_B.parentId, LOOP_B.parentTitle, {
        stateDir: tempDir,
        totalTasks: LOOP_B.tasks.length,
      });

      // Add tasks to both loops
      for (let i = 0; i < LOOP_A.tasks.length; i++) {
        stateA = addActiveTask(
          stateA,
          createMockActiveTask(LOOP_A.tasks[i], i, worktreeBaseA),
          tempDir
        );
      }

      for (let i = 0; i < LOOP_B.tasks.length; i++) {
        stateB = addActiveTask(
          stateB,
          createMockActiveTask(LOOP_B.tasks[i], i, worktreeBaseB),
          tempDir
        );
      }

      // Perform concurrent operations on both loops
      const operations = [
        // Loop A operations
        (async () => {
          await delay(Math.random() * 10);
          const currentState = readExecutionState(LOOP_A.parentId, tempDir)!;
          return completeTask(currentState, 'DUAL-101', tempDir);
        })(),
        (async () => {
          await delay(Math.random() * 10);
          const currentState = readExecutionState(LOOP_A.parentId, tempDir)!;
          return failTask(currentState, 'DUAL-102', tempDir);
        })(),
        // Loop B operations
        (async () => {
          await delay(Math.random() * 10);
          const currentState = readExecutionState(LOOP_B.parentId, tempDir)!;
          return completeTask(currentState, 'DUAL-201', tempDir);
        })(),
        (async () => {
          await delay(Math.random() * 10);
          const currentState = readExecutionState(LOOP_B.parentId, tempDir)!;
          return completeTask(currentState, 'DUAL-202', tempDir);
        })(),
      ];

      await Promise.all(operations);

      // Verify Loop A state
      const finalStateA = readExecutionState(LOOP_A.parentId, tempDir);
      expect(finalStateA!.activeTasks.length).toBe(1); // DUAL-103 still active
      expect(getTaskIds(finalStateA!.completedTasks)).toContain('DUAL-101');
      expect(getTaskIds(finalStateA!.failedTasks)).toContain('DUAL-102');
      expect(finalStateA!.activeTasks[0].id).toBe('DUAL-103');

      // Verify Loop B state
      const finalStateB = readExecutionState(LOOP_B.parentId, tempDir);
      expect(finalStateB!.activeTasks.length).toBe(1); // DUAL-203 still active
      expect(getTaskIds(finalStateB!.completedTasks)).toContain('DUAL-201');
      expect(getTaskIds(finalStateB!.completedTasks)).toContain('DUAL-202');
      expect(finalStateB!.activeTasks[0].id).toBe('DUAL-203');

      // Verify no cross-contamination
      const allCompletedA = getTaskIds(finalStateA!.completedTasks);
      const allCompletedB = getTaskIds(finalStateB!.completedTasks);
      const allFailedA = getTaskIds(finalStateA!.failedTasks);

      // A's completed should not appear in B
      for (const id of allCompletedA) {
        expect(allCompletedB).not.toContain(id);
      }

      // B's completed should not appear in A
      for (const id of allCompletedB) {
        expect(allCompletedA).not.toContain(id);
        expect(allFailedA).not.toContain(id);
      }
    });
  });

  describe('both loops complete successfully', () => {
    it('both loops can independently reach full completion', async () => {
      // Initialize both loops
      let stateA = initializeExecutionState(LOOP_A.parentId, LOOP_A.parentTitle, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: LOOP_A.tasks.length,
      });

      let stateB = initializeExecutionState(LOOP_B.parentId, LOOP_B.parentTitle, {
        stateDir: tempDir,
        loopPid: process.pid + 1,
        totalTasks: LOOP_B.tasks.length,
      });

      // Add all tasks to both loops
      for (let i = 0; i < LOOP_A.tasks.length; i++) {
        stateA = addActiveTask(
          stateA,
          createMockActiveTask(LOOP_A.tasks[i], i, worktreeBaseA),
          tempDir
        );
      }

      for (let i = 0; i < LOOP_B.tasks.length; i++) {
        stateB = addActiveTask(
          stateB,
          createMockActiveTask(LOOP_B.tasks[i], i, worktreeBaseB),
          tempDir
        );
      }

      // Complete all tasks in both loops concurrently
      const completionPromises = [
        // Loop A completions
        ...LOOP_A.tasks.map(async taskId => {
          await delay(Math.random() * 15);
          const currentState = readExecutionState(LOOP_A.parentId, tempDir)!;
          return completeTask(currentState, taskId, tempDir);
        }),
        // Loop B completions
        ...LOOP_B.tasks.map(async taskId => {
          await delay(Math.random() * 15);
          const currentState = readExecutionState(LOOP_B.parentId, tempDir)!;
          return completeTask(currentState, taskId, tempDir);
        }),
      ];

      await Promise.all(completionPromises);

      // Verify both loops are fully complete
      const finalStateA = readExecutionState(LOOP_A.parentId, tempDir);
      const finalStateB = readExecutionState(LOOP_B.parentId, tempDir);

      // Loop A assertions
      expect(finalStateA!.activeTasks.length).toBe(0);
      expect(finalStateA!.failedTasks.length).toBe(0);
      expect(finalStateA!.completedTasks.length).toBe(3);

      const completedIdsA = getTaskIds(finalStateA!.completedTasks);
      expect(completedIdsA).toContain('DUAL-101');
      expect(completedIdsA).toContain('DUAL-102');
      expect(completedIdsA).toContain('DUAL-103');
      expect(hasDuplicates(completedIdsA)).toBe(false);

      // Loop B assertions
      expect(finalStateB!.activeTasks.length).toBe(0);
      expect(finalStateB!.failedTasks.length).toBe(0);
      expect(finalStateB!.completedTasks.length).toBe(3);

      const completedIdsB = getTaskIds(finalStateB!.completedTasks);
      expect(completedIdsB).toContain('DUAL-201');
      expect(completedIdsB).toContain('DUAL-202');
      expect(completedIdsB).toContain('DUAL-203');
      expect(hasDuplicates(completedIdsB)).toBe(false);
    });

    it('loops complete with mixed outcomes without interference', async () => {
      // Initialize both loops
      let stateA = initializeExecutionState(LOOP_A.parentId, LOOP_A.parentTitle, {
        stateDir: tempDir,
        totalTasks: LOOP_A.tasks.length,
      });

      let stateB = initializeExecutionState(LOOP_B.parentId, LOOP_B.parentTitle, {
        stateDir: tempDir,
        totalTasks: LOOP_B.tasks.length,
      });

      // Add tasks
      for (let i = 0; i < LOOP_A.tasks.length; i++) {
        stateA = addActiveTask(
          stateA,
          createMockActiveTask(LOOP_A.tasks[i], i, worktreeBaseA),
          tempDir
        );
      }

      for (let i = 0; i < LOOP_B.tasks.length; i++) {
        stateB = addActiveTask(
          stateB,
          createMockActiveTask(LOOP_B.tasks[i], i, worktreeBaseB),
          tempDir
        );
      }

      // Loop A: 2 complete, 1 fail
      // Loop B: 1 complete, 2 fail
      const outcomePromises = [
        // Loop A outcomes
        (async () => {
          await delay(Math.random() * 10);
          const state = readExecutionState(LOOP_A.parentId, tempDir)!;
          return completeTask(state, 'DUAL-101', tempDir);
        })(),
        (async () => {
          await delay(Math.random() * 10);
          const state = readExecutionState(LOOP_A.parentId, tempDir)!;
          return completeTask(state, 'DUAL-102', tempDir);
        })(),
        (async () => {
          await delay(Math.random() * 10);
          const state = readExecutionState(LOOP_A.parentId, tempDir)!;
          return failTask(state, 'DUAL-103', tempDir);
        })(),
        // Loop B outcomes
        (async () => {
          await delay(Math.random() * 10);
          const state = readExecutionState(LOOP_B.parentId, tempDir)!;
          return completeTask(state, 'DUAL-201', tempDir);
        })(),
        (async () => {
          await delay(Math.random() * 10);
          const state = readExecutionState(LOOP_B.parentId, tempDir)!;
          return failTask(state, 'DUAL-202', tempDir);
        })(),
        (async () => {
          await delay(Math.random() * 10);
          const state = readExecutionState(LOOP_B.parentId, tempDir)!;
          return failTask(state, 'DUAL-203', tempDir);
        })(),
      ];

      await Promise.all(outcomePromises);

      // Verify Loop A: 2 completed, 1 failed
      const finalStateA = readExecutionState(LOOP_A.parentId, tempDir);
      expect(finalStateA!.activeTasks.length).toBe(0);
      expect(finalStateA!.completedTasks.length).toBe(2);
      expect(finalStateA!.failedTasks.length).toBe(1);

      // Verify Loop B: 1 completed, 2 failed
      const finalStateB = readExecutionState(LOOP_B.parentId, tempDir);
      expect(finalStateB!.activeTasks.length).toBe(0);
      expect(finalStateB!.completedTasks.length).toBe(1);
      expect(finalStateB!.failedTasks.length).toBe(2);

      // Verify correct task categorization
      expect(getTaskIds(finalStateA!.completedTasks)).toContain('DUAL-101');
      expect(getTaskIds(finalStateA!.completedTasks)).toContain('DUAL-102');
      expect(getTaskIds(finalStateA!.failedTasks)).toContain('DUAL-103');

      expect(getTaskIds(finalStateB!.completedTasks)).toContain('DUAL-201');
      expect(getTaskIds(finalStateB!.failedTasks)).toContain('DUAL-202');
      expect(getTaskIds(finalStateB!.failedTasks)).toContain('DUAL-203');
    });
  });

  describe('clean shutdown isolation', () => {
    it('clearAllActiveTasks for Loop A does not affect Loop B', () => {
      // Initialize both loops
      let stateA = initializeExecutionState(LOOP_A.parentId, LOOP_A.parentTitle, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: LOOP_A.tasks.length,
      });

      let stateB = initializeExecutionState(LOOP_B.parentId, LOOP_B.parentTitle, {
        stateDir: tempDir,
        loopPid: process.pid + 1,
        totalTasks: LOOP_B.tasks.length,
      });

      // Add active tasks to both loops
      for (let i = 0; i < LOOP_A.tasks.length; i++) {
        stateA = addActiveTask(
          stateA,
          createMockActiveTask(LOOP_A.tasks[i], i, worktreeBaseA),
          tempDir
        );
      }

      for (let i = 0; i < LOOP_B.tasks.length; i++) {
        stateB = addActiveTask(
          stateB,
          createMockActiveTask(LOOP_B.tasks[i], i, worktreeBaseB),
          tempDir
        );
      }

      // Verify both have active tasks
      expect(readExecutionState(LOOP_A.parentId, tempDir)!.activeTasks.length).toBe(3);
      expect(readExecutionState(LOOP_B.parentId, tempDir)!.activeTasks.length).toBe(3);

      // Simulate clean shutdown of Loop A
      clearAllActiveTasks(LOOP_A.parentId, tempDir);

      // Verify Loop A is cleared
      const afterA = readExecutionState(LOOP_A.parentId, tempDir);
      expect(afterA!.activeTasks.length).toBe(0);

      // Verify Loop B is unchanged
      const afterB = readExecutionState(LOOP_B.parentId, tempDir);
      expect(afterB!.activeTasks.length).toBe(3);
      expect(afterB!.activeTasks.map(t => t.id)).toEqual(LOOP_B.tasks);
    });

    it('deleteExecutionState for Loop A preserves Loop B state file', () => {
      // Initialize both loops
      initializeExecutionState(LOOP_A.parentId, LOOP_A.parentTitle, {
        stateDir: tempDir,
        totalTasks: LOOP_A.tasks.length,
      });

      initializeExecutionState(LOOP_B.parentId, LOOP_B.parentTitle, {
        stateDir: tempDir,
        totalTasks: LOOP_B.tasks.length,
      });

      // Verify both state files exist
      expect(existsSync(getStateFilePath(LOOP_A.parentId, tempDir))).toBe(true);
      expect(existsSync(getStateFilePath(LOOP_B.parentId, tempDir))).toBe(true);

      // Delete Loop A's state (simulating --fresh flag on restart)
      const deleted = deleteExecutionState(LOOP_A.parentId, tempDir);
      expect(deleted).toBe(true);

      // Verify Loop A's state file is gone
      expect(existsSync(getStateFilePath(LOOP_A.parentId, tempDir))).toBe(false);
      expect(readExecutionState(LOOP_A.parentId, tempDir)).toBeNull();

      // Verify Loop B's state file still exists and is intact
      expect(existsSync(getStateFilePath(LOOP_B.parentId, tempDir))).toBe(true);
      const stateB = readExecutionState(LOOP_B.parentId, tempDir);
      expect(stateB).not.toBeNull();
      expect(stateB!.parentId).toBe(LOOP_B.parentId);
      expect(stateB!.parentTitle).toBe(LOOP_B.parentTitle);
    });

    it('shutdown during concurrent operations preserves other loop integrity', async () => {
      // Initialize both loops
      let stateA = initializeExecutionState(LOOP_A.parentId, LOOP_A.parentTitle, {
        stateDir: tempDir,
        totalTasks: LOOP_A.tasks.length,
      });

      let stateB = initializeExecutionState(LOOP_B.parentId, LOOP_B.parentTitle, {
        stateDir: tempDir,
        totalTasks: LOOP_B.tasks.length,
      });

      // Add tasks to both loops
      for (let i = 0; i < LOOP_A.tasks.length; i++) {
        stateA = addActiveTask(
          stateA,
          createMockActiveTask(LOOP_A.tasks[i], i, worktreeBaseA),
          tempDir
        );
      }

      for (let i = 0; i < LOOP_B.tasks.length; i++) {
        stateB = addActiveTask(
          stateB,
          createMockActiveTask(LOOP_B.tasks[i], i, worktreeBaseB),
          tempDir
        );
      }

      // Simulate concurrent operations while Loop A shuts down
      const operations = [
        // Loop B completes a task
        (async () => {
          await delay(5);
          const state = readExecutionState(LOOP_B.parentId, tempDir)!;
          return completeTask(state, 'DUAL-201', tempDir);
        })(),
        // Loop A shuts down mid-operation
        (async () => {
          await delay(10);
          clearAllActiveTasks(LOOP_A.parentId, tempDir);
        })(),
        // Loop B completes another task after A's shutdown
        (async () => {
          await delay(15);
          const state = readExecutionState(LOOP_B.parentId, tempDir)!;
          return completeTask(state, 'DUAL-202', tempDir);
        })(),
      ];

      await Promise.all(operations);

      // Verify Loop A is shutdown (no active tasks)
      const finalStateA = readExecutionState(LOOP_A.parentId, tempDir);
      expect(finalStateA!.activeTasks.length).toBe(0);

      // Verify Loop B operations completed successfully
      const finalStateB = readExecutionState(LOOP_B.parentId, tempDir);
      expect(finalStateB!.activeTasks.length).toBe(1); // DUAL-203 still active
      expect(finalStateB!.completedTasks.length).toBe(2);
      expect(getTaskIds(finalStateB!.completedTasks)).toContain('DUAL-201');
      expect(getTaskIds(finalStateB!.completedTasks)).toContain('DUAL-202');
    });
  });

  describe('worktree path isolation', () => {
    it('active tasks reference distinct worktree paths per loop', () => {
      // Initialize both loops
      let stateA = initializeExecutionState(LOOP_A.parentId, LOOP_A.parentTitle, {
        stateDir: tempDir,
      });

      let stateB = initializeExecutionState(LOOP_B.parentId, LOOP_B.parentTitle, {
        stateDir: tempDir,
      });

      // Add tasks with explicit worktree paths
      const taskA = createMockActiveTask('DUAL-101', 0, worktreeBaseA);
      const taskB = createMockActiveTask('DUAL-201', 0, worktreeBaseB);

      stateA = addActiveTask(stateA, taskA, tempDir);
      stateB = addActiveTask(stateB, taskB, tempDir);

      // Verify worktree paths are different
      const diskStateA = readExecutionState(LOOP_A.parentId, tempDir);
      const diskStateB = readExecutionState(LOOP_B.parentId, tempDir);

      expect(diskStateA!.activeTasks[0].worktree).toContain(worktreeBaseA);
      expect(diskStateB!.activeTasks[0].worktree).toContain(worktreeBaseB);
      expect(diskStateA!.activeTasks[0].worktree).not.toBe(
        diskStateB!.activeTasks[0].worktree
      );
    });
  });

  describe('stress test: rapid interleaved operations', () => {
    it('handles many rapid concurrent operations across both loops', async () => {
      // Initialize both loops
      let stateA = initializeExecutionState(LOOP_A.parentId, LOOP_A.parentTitle, {
        stateDir: tempDir,
        totalTasks: 5,
      });

      let stateB = initializeExecutionState(LOOP_B.parentId, LOOP_B.parentTitle, {
        stateDir: tempDir,
        totalTasks: 5,
      });

      // Expanded task lists for stress testing
      const tasksA = ['DUAL-101', 'DUAL-102', 'DUAL-103', 'DUAL-104', 'DUAL-105'];
      const tasksB = ['DUAL-201', 'DUAL-202', 'DUAL-203', 'DUAL-204', 'DUAL-205'];

      // Add all tasks
      for (let i = 0; i < tasksA.length; i++) {
        stateA = addActiveTask(
          stateA,
          createMockActiveTask(tasksA[i], i, worktreeBaseA),
          tempDir
        );
      }

      for (let i = 0; i < tasksB.length; i++) {
        stateB = addActiveTask(
          stateB,
          createMockActiveTask(tasksB[i], i, worktreeBaseB),
          tempDir
        );
      }

      // Rapid interleaved completions
      const operations = [
        ...tasksA.map(async (taskId, i) => {
          await delay(Math.random() * 20);
          const state = readExecutionState(LOOP_A.parentId, tempDir)!;
          // Alternate between complete and fail
          return i % 2 === 0
            ? completeTask(state, taskId, tempDir)
            : failTask(state, taskId, tempDir);
        }),
        ...tasksB.map(async (taskId, i) => {
          await delay(Math.random() * 20);
          const state = readExecutionState(LOOP_B.parentId, tempDir)!;
          // Different pattern: first 3 complete, last 2 fail
          return i < 3
            ? completeTask(state, taskId, tempDir)
            : failTask(state, taskId, tempDir);
        }),
      ];

      await Promise.all(operations);

      // Verify final states
      const finalStateA = readExecutionState(LOOP_A.parentId, tempDir);
      const finalStateB = readExecutionState(LOOP_B.parentId, tempDir);

      // All tasks should be processed (no active tasks)
      expect(finalStateA!.activeTasks.length).toBe(0);
      expect(finalStateB!.activeTasks.length).toBe(0);

      // Verify task counts match expected outcomes
      // Loop A: indices 0,2,4 complete (3), indices 1,3 fail (2)
      expect(finalStateA!.completedTasks.length).toBe(3);
      expect(finalStateA!.failedTasks.length).toBe(2);

      // Loop B: indices 0,1,2 complete (3), indices 3,4 fail (2)
      expect(finalStateB!.completedTasks.length).toBe(3);
      expect(finalStateB!.failedTasks.length).toBe(2);

      // Verify no duplicates in either loop
      const allIdsA = [
        ...getTaskIds(finalStateA!.completedTasks),
        ...getTaskIds(finalStateA!.failedTasks),
      ];
      const allIdsB = [
        ...getTaskIds(finalStateB!.completedTasks),
        ...getTaskIds(finalStateB!.failedTasks),
      ];

      expect(hasDuplicates(allIdsA)).toBe(false);
      expect(hasDuplicates(allIdsB)).toBe(false);

      // Verify no cross-contamination
      for (const id of allIdsA) {
        expect(id.startsWith('DUAL-1')).toBe(true);
        expect(allIdsB).not.toContain(id);
      }

      for (const id of allIdsB) {
        expect(id.startsWith('DUAL-2')).toBe(true);
        expect(allIdsA).not.toContain(id);
      }
    });
  });
});
