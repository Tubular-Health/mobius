/**
 * Integration tests for multiple agents operating within the same loop
 *
 * These tests simulate the lifecycle of 3+ agents completing tasks concurrently
 * within a single parent loop execution. Unlike parallel-state.integration.test.ts
 * which tests low-level state functions, these tests verify the higher-level
 * agent behavior patterns:
 *
 * 1. Multiple agents can register active tasks (addActiveTask)
 * 2. Multiple agents can complete/fail concurrently (completeTask/failTask)
 * 3. State consistency is maintained across all transitions
 * 4. No data loss or duplication occurs
 *
 * Uses temp directory for isolation - no real tmux, worktrees, or Linear API calls.
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
} from './execution-state.js';
import type { ActiveTask, CompletedTask } from '../types.js';

// Test constants
const PARENT_ID = 'AGENT-TEST-100';
const PARENT_TITLE = 'Multi-Agent Integration Test';

// Helper to create mock active task simulating what parallel-executor would create
function createAgentTask(
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

// Helper to get task IDs from completed/failed arrays
function getTaskIds(tasks: (string | CompletedTask)[]): string[] {
  return tasks.map(t => (typeof t === 'string' ? t : t.id));
}

// Helper to check for duplicates
function hasDuplicates(arr: string[]): boolean {
  return new Set(arr).size !== arr.length;
}

// Helper to delay execution (simulates agent processing time variance)
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('parallel agents integration', () => {
  let tempDir: string;
  let worktreeBase: string;

  beforeEach(() => {
    // Create fresh temp directories for each test
    tempDir = mkdtempSync(join(tmpdir(), 'mobius-agent-test-'));
    worktreeBase = mkdtempSync(join(tmpdir(), 'mobius-worktrees-'));
  });

  afterEach(() => {
    // Clean up temp directories
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    if (existsSync(worktreeBase)) {
      rmSync(worktreeBase, { recursive: true, force: true });
    }
  });

  describe('agent lifecycle simulation', () => {
    it('simulates 3 agents starting tasks then completing concurrently', async () => {
      // Phase 1: Initialize loop state (simulates mobius loop startup)
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 3,
      });

      expect(initialState.parentId).toBe(PARENT_ID);
      expect(initialState.activeTasks.length).toBe(0);

      // Phase 2: Agents register their tasks (simulates parallel-executor spawning)
      // In real execution, these would be called sequentially as agents spawn
      const agent1Task = createAgentTask('MOB-201', 0, worktreeBase);
      const agent2Task = createAgentTask('MOB-202', 1, worktreeBase);
      const agent3Task = createAgentTask('MOB-203', 2, worktreeBase);

      let state = addActiveTask(initialState, agent1Task, tempDir);
      state = addActiveTask(state, agent2Task, tempDir);
      state = addActiveTask(state, agent3Task, tempDir);

      // Verify all 3 agents are active
      const midState = readExecutionState(PARENT_ID, tempDir);
      expect(midState).not.toBeNull();
      expect(midState!.activeTasks.length).toBe(3);
      expect(midState!.activeTasks.map(t => t.id)).toEqual(['MOB-201', 'MOB-202', 'MOB-203']);

      // Phase 3: Agents complete their tasks concurrently
      // This simulates all 3 agents finishing around the same time
      // Using Promise.all exercises the locking mechanism
      const completionPromises = [
        // Agent 1 completes
        (async () => {
          await delay(Math.random() * 10); // Random delay simulates varying completion times
          const currentState = readExecutionState(PARENT_ID, tempDir)!;
          return completeTask(currentState, 'MOB-201', tempDir);
        })(),
        // Agent 2 completes
        (async () => {
          await delay(Math.random() * 10);
          const currentState = readExecutionState(PARENT_ID, tempDir)!;
          return completeTask(currentState, 'MOB-202', tempDir);
        })(),
        // Agent 3 completes
        (async () => {
          await delay(Math.random() * 10);
          const currentState = readExecutionState(PARENT_ID, tempDir)!;
          return completeTask(currentState, 'MOB-203', tempDir);
        })(),
      ];

      await Promise.all(completionPromises);

      // Phase 4: Verify final state
      const finalState = readExecutionState(PARENT_ID, tempDir);
      expect(finalState).not.toBeNull();

      // All agents should have completed
      const completedIds = getTaskIds(finalState!.completedTasks);
      expect(completedIds.length).toBe(3);
      expect(completedIds).toContain('MOB-201');
      expect(completedIds).toContain('MOB-202');
      expect(completedIds).toContain('MOB-203');

      // No duplicates
      expect(hasDuplicates(completedIds)).toBe(false);

      // No active tasks remaining
      expect(finalState!.activeTasks.length).toBe(0);

      // No failed tasks
      expect(finalState!.failedTasks.length).toBe(0);
    });

    it('simulates mixed outcomes: 2 agents complete, 1 agent fails', async () => {
      // Initialize loop state
      initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 3,
      });

      // Register 3 agent tasks
      const tasks = [
        createAgentTask('MOB-301', 0, worktreeBase),
        createAgentTask('MOB-302', 1, worktreeBase),
        createAgentTask('MOB-303', 2, worktreeBase),
      ];

      let state = readExecutionState(PARENT_ID, tempDir)!;
      for (const task of tasks) {
        state = addActiveTask(state, task, tempDir);
      }

      // Verify all active
      const beforeState = readExecutionState(PARENT_ID, tempDir);
      expect(beforeState?.activeTasks.length).toBe(3);

      // Mixed outcomes: MOB-301 completes, MOB-302 fails, MOB-303 completes
      const outcomePromises = [
        // Agent 1 completes successfully
        (async () => {
          await delay(Math.random() * 10);
          const currentState = readExecutionState(PARENT_ID, tempDir)!;
          return completeTask(currentState, 'MOB-301', tempDir);
        })(),
        // Agent 2 fails (e.g., verification failed)
        (async () => {
          await delay(Math.random() * 10);
          const currentState = readExecutionState(PARENT_ID, tempDir)!;
          return failTask(currentState, 'MOB-302', tempDir);
        })(),
        // Agent 3 completes successfully
        (async () => {
          await delay(Math.random() * 10);
          const currentState = readExecutionState(PARENT_ID, tempDir)!;
          return completeTask(currentState, 'MOB-303', tempDir);
        })(),
      ];

      await Promise.all(outcomePromises);

      // Verify final state
      const finalState = readExecutionState(PARENT_ID, tempDir);
      expect(finalState).not.toBeNull();

      // Check completed tasks
      const completedIds = getTaskIds(finalState!.completedTasks);
      expect(completedIds.length).toBe(2);
      expect(completedIds).toContain('MOB-301');
      expect(completedIds).toContain('MOB-303');

      // Check failed tasks
      const failedIds = getTaskIds(finalState!.failedTasks);
      expect(failedIds.length).toBe(1);
      expect(failedIds).toContain('MOB-302');

      // No duplicates across any array
      expect(hasDuplicates(completedIds)).toBe(false);
      expect(hasDuplicates(failedIds)).toBe(false);
      expect(hasDuplicates([...completedIds, ...failedIds])).toBe(false);

      // No active tasks
      expect(finalState!.activeTasks.length).toBe(0);
    });

    it('verifies activeTasks correctly transition to completedTasks', async () => {
      // Initialize
      initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 3,
      });

      // Create tasks with specific start times for duration tracking
      const tasks = [
        createAgentTask('MOB-401', 0, worktreeBase),
        createAgentTask('MOB-402', 1, worktreeBase),
        createAgentTask('MOB-403', 2, worktreeBase),
      ];

      // Register all tasks
      let state = readExecutionState(PARENT_ID, tempDir)!;
      for (const task of tasks) {
        state = addActiveTask(state, task, tempDir);
      }

      // Verify initial active state
      const initialActive = readExecutionState(PARENT_ID, tempDir)!.activeTasks;
      expect(initialActive.length).toBe(3);

      // Verify each active task has required fields
      for (const task of initialActive) {
        expect(task.id).toBeDefined();
        expect(task.pid).toBeGreaterThan(0);
        expect(task.pane).toMatch(/^%\d+$/);
        expect(task.startedAt).toBeDefined();
        expect(task.worktree).toBeDefined();
      }

      // Complete tasks one by one, verifying state at each step
      // Complete MOB-401
      const state1 = readExecutionState(PARENT_ID, tempDir)!;
      completeTask(state1, 'MOB-401', tempDir);

      const afterFirst = readExecutionState(PARENT_ID, tempDir)!;
      expect(afterFirst.activeTasks.length).toBe(2);
      expect(afterFirst.completedTasks.length).toBe(1);
      expect(getTaskIds(afterFirst.completedTasks)).toContain('MOB-401');
      expect(afterFirst.activeTasks.map(t => t.id)).not.toContain('MOB-401');

      // Complete MOB-402
      const state2 = readExecutionState(PARENT_ID, tempDir)!;
      completeTask(state2, 'MOB-402', tempDir);

      const afterSecond = readExecutionState(PARENT_ID, tempDir)!;
      expect(afterSecond.activeTasks.length).toBe(1);
      expect(afterSecond.completedTasks.length).toBe(2);
      expect(getTaskIds(afterSecond.completedTasks)).toContain('MOB-402');

      // Complete MOB-403
      const state3 = readExecutionState(PARENT_ID, tempDir)!;
      completeTask(state3, 'MOB-403', tempDir);

      const afterThird = readExecutionState(PARENT_ID, tempDir)!;
      expect(afterThird.activeTasks.length).toBe(0);
      expect(afterThird.completedTasks.length).toBe(3);
      expect(getTaskIds(afterThird.completedTasks)).toContain('MOB-403');
    });

    it('verifies activeTasks correctly transition to failedTasks', async () => {
      // Initialize
      initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 3,
      });

      // Register tasks
      const tasks = [
        createAgentTask('MOB-501', 0, worktreeBase),
        createAgentTask('MOB-502', 1, worktreeBase),
        createAgentTask('MOB-503', 2, worktreeBase),
      ];

      let state = readExecutionState(PARENT_ID, tempDir)!;
      for (const task of tasks) {
        state = addActiveTask(state, task, tempDir);
      }

      // Fail all tasks concurrently
      const failPromises = tasks.map(async task => {
        await delay(Math.random() * 10);
        const currentState = readExecutionState(PARENT_ID, tempDir)!;
        return failTask(currentState, task.id, tempDir);
      });

      await Promise.all(failPromises);

      // Verify final state
      const finalState = readExecutionState(PARENT_ID, tempDir);
      expect(finalState).not.toBeNull();

      // All tasks should be in failedTasks
      const failedIds = getTaskIds(finalState!.failedTasks);
      expect(failedIds.length).toBe(3);
      expect(failedIds).toContain('MOB-501');
      expect(failedIds).toContain('MOB-502');
      expect(failedIds).toContain('MOB-503');

      // No duplicates
      expect(hasDuplicates(failedIds)).toBe(false);

      // No active or completed tasks
      expect(finalState!.activeTasks.length).toBe(0);
      expect(finalState!.completedTasks.length).toBe(0);
    });
  });

  describe('concurrent completion stress test', () => {
    it('handles 5 agents completing simultaneously without data loss', async () => {
      // Initialize with 5 tasks
      initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 5,
      });

      // Register 5 agent tasks
      const tasks = Array.from({ length: 5 }, (_, i) =>
        createAgentTask(`MOB-60${i + 1}`, i, worktreeBase)
      );

      let state = readExecutionState(PARENT_ID, tempDir)!;
      for (const task of tasks) {
        state = addActiveTask(state, task, tempDir);
      }

      // Verify all 5 are active
      expect(readExecutionState(PARENT_ID, tempDir)?.activeTasks.length).toBe(5);

      // Complete all 5 concurrently (stress test for locking)
      const completionPromises = tasks.map(async task => {
        await delay(Math.random() * 20); // More variance for stress
        const currentState = readExecutionState(PARENT_ID, tempDir)!;
        return completeTask(currentState, task.id, tempDir);
      });

      await Promise.all(completionPromises);

      // Verify final state
      const finalState = readExecutionState(PARENT_ID, tempDir);
      expect(finalState).not.toBeNull();

      const completedIds = getTaskIds(finalState!.completedTasks);
      expect(completedIds.length).toBe(5);

      // All 5 tasks should be completed
      for (const task of tasks) {
        expect(completedIds).toContain(task.id);
      }

      expect(hasDuplicates(completedIds)).toBe(false);
      expect(finalState!.activeTasks.length).toBe(0);
    });

    it('handles interleaved completions and failures', async () => {
      // Initialize with 6 tasks
      initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 6,
      });

      // Register 6 agent tasks
      const tasks = Array.from({ length: 6 }, (_, i) =>
        createAgentTask(`MOB-70${i + 1}`, i, worktreeBase)
      );

      let state = readExecutionState(PARENT_ID, tempDir)!;
      for (const task of tasks) {
        state = addActiveTask(state, task, tempDir);
      }

      // Interleaved outcomes: odd indices complete, even indices fail
      const outcomePromises = tasks.map(async (task, index) => {
        await delay(Math.random() * 15);
        const currentState = readExecutionState(PARENT_ID, tempDir)!;
        if (index % 2 === 0) {
          return completeTask(currentState, task.id, tempDir);
        } else {
          return failTask(currentState, task.id, tempDir);
        }
      });

      await Promise.all(outcomePromises);

      // Verify final state
      const finalState = readExecutionState(PARENT_ID, tempDir);
      expect(finalState).not.toBeNull();

      const completedIds = getTaskIds(finalState!.completedTasks);
      const failedIds = getTaskIds(finalState!.failedTasks);

      // 3 completed (indices 0, 2, 4), 3 failed (indices 1, 3, 5)
      expect(completedIds.length).toBe(3);
      expect(failedIds.length).toBe(3);

      expect(completedIds).toContain('MOB-701');
      expect(completedIds).toContain('MOB-703');
      expect(completedIds).toContain('MOB-705');

      expect(failedIds).toContain('MOB-702');
      expect(failedIds).toContain('MOB-704');
      expect(failedIds).toContain('MOB-706');

      // No duplicates or cross-contamination
      const allIds = [...completedIds, ...failedIds];
      expect(hasDuplicates(allIds)).toBe(false);
      expect(allIds.length).toBe(6);

      expect(finalState!.activeTasks.length).toBe(0);
    });
  });

  describe('completed task metadata', () => {
    it('records duration for completed tasks', async () => {
      // Initialize
      initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 1,
      });

      // Create task and add to active
      const task = createAgentTask('MOB-801', 0, worktreeBase);
      let state = readExecutionState(PARENT_ID, tempDir)!;
      state = addActiveTask(state, task, tempDir);

      // Small delay to ensure duration > 0
      await delay(50);

      // Complete the task
      const currentState = readExecutionState(PARENT_ID, tempDir)!;
      completeTask(currentState, 'MOB-801', tempDir);

      // Verify completed task has duration
      const finalState = readExecutionState(PARENT_ID, tempDir)!;
      expect(finalState.completedTasks.length).toBe(1);

      const completedTask = finalState.completedTasks[0];
      expect(typeof completedTask).toBe('object');
      if (typeof completedTask === 'object') {
        expect(completedTask.id).toBe('MOB-801');
        expect(completedTask.duration).toBeGreaterThanOrEqual(0);
        expect(completedTask.completedAt).toBeDefined();
      }
    });

    it('records duration for failed tasks', async () => {
      // Initialize
      initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 1,
      });

      // Create task and add to active
      const task = createAgentTask('MOB-802', 0, worktreeBase);
      let state = readExecutionState(PARENT_ID, tempDir)!;
      state = addActiveTask(state, task, tempDir);

      // Small delay to ensure duration > 0
      await delay(50);

      // Fail the task
      const currentState = readExecutionState(PARENT_ID, tempDir)!;
      failTask(currentState, 'MOB-802', tempDir);

      // Verify failed task has duration
      const finalState = readExecutionState(PARENT_ID, tempDir)!;
      expect(finalState.failedTasks.length).toBe(1);

      const failedTask = finalState.failedTasks[0];
      expect(typeof failedTask).toBe('object');
      if (typeof failedTask === 'object') {
        expect(failedTask.id).toBe('MOB-802');
        expect(failedTask.duration).toBeGreaterThanOrEqual(0);
        expect(failedTask.completedAt).toBeDefined();
      }
    });
  });

  describe('state integrity', () => {
    it('maintains parent metadata through concurrent operations', async () => {
      // Initialize with specific metadata
      const loopPid = process.pid;
      const totalTasks = 3;

      initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid,
        totalTasks,
      });

      // Register and complete tasks
      const tasks = [
        createAgentTask('MOB-901', 0, worktreeBase),
        createAgentTask('MOB-902', 1, worktreeBase),
        createAgentTask('MOB-903', 2, worktreeBase),
      ];

      let state = readExecutionState(PARENT_ID, tempDir)!;
      for (const task of tasks) {
        state = addActiveTask(state, task, tempDir);
      }

      // Complete all concurrently
      const completionPromises = tasks.map(async task => {
        await delay(Math.random() * 10);
        const currentState = readExecutionState(PARENT_ID, tempDir)!;
        return completeTask(currentState, task.id, tempDir);
      });

      await Promise.all(completionPromises);

      // Verify parent metadata is preserved
      const finalState = readExecutionState(PARENT_ID, tempDir)!;
      expect(finalState.parentId).toBe(PARENT_ID);
      expect(finalState.parentTitle).toBe(PARENT_TITLE);
      expect(finalState.loopPid).toBe(loopPid);
      expect(finalState.totalTasks).toBe(totalTasks);
      expect(finalState.startedAt).toBeDefined();
      expect(finalState.updatedAt).toBeDefined();
    });

    it('preserves worktree paths in active tasks', async () => {
      // Initialize
      initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 2,
      });

      // Create tasks with specific worktree paths
      const task1 = createAgentTask('MOB-1001', 0, worktreeBase);
      const task2 = createAgentTask('MOB-1002', 1, worktreeBase);

      let state = readExecutionState(PARENT_ID, tempDir)!;
      state = addActiveTask(state, task1, tempDir);
      state = addActiveTask(state, task2, tempDir);

      // Verify worktree paths are preserved
      const activeState = readExecutionState(PARENT_ID, tempDir)!;
      expect(activeState.activeTasks.length).toBe(2);

      const activeTask1 = activeState.activeTasks.find(t => t.id === 'MOB-1001');
      const activeTask2 = activeState.activeTasks.find(t => t.id === 'MOB-1002');

      expect(activeTask1?.worktree).toBe(task1.worktree);
      expect(activeTask2?.worktree).toBe(task2.worktree);

      // Worktree paths should include the task identifier
      expect(activeTask1?.worktree).toContain('mob-1001');
      expect(activeTask2?.worktree).toContain('mob-1002');
    });
  });
});
