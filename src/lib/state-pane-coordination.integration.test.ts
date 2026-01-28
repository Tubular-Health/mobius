/**
 * Integration tests for state and pane coordination
 *
 * Verifies that pane status updates and state file updates remain synchronized.
 * Uses mocked tmux commands while using real state file operations.
 *
 * Tests:
 * 1. addActiveTask correctly associates paneId
 * 2. State updates (completeTask) don't corrupt pane mappings
 * 3. updateActiveTaskPane correctly updates pane ID in state
 *
 * Uses a temp directory for isolation - no real tmux sessions created.
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
  updateActiveTaskPane,
  withExecutionState,
} from './execution-state.js';
import type { ActiveTask } from '../types.js';

// Test constants
const PARENT_ID = 'COORD-100';
const PARENT_TITLE = 'State Pane Coordination Test';

// Helper to create mock active tasks with pane ID
function createMockActiveTask(id: string, paneId: string): ActiveTask {
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

describe('state-pane-coordination', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a fresh temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'mobius-pane-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('addActiveTask paneId association', () => {
    it('stores paneId correctly when adding an active task', () => {
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 3,
      });

      const task = createMockActiveTask('COORD-101', '%0');
      const stateWithTask = addActiveTask(initialState, task, tempDir);

      // Verify paneId is stored correctly
      expect(stateWithTask.activeTasks.length).toBe(1);
      expect(stateWithTask.activeTasks[0].id).toBe('COORD-101');
      expect(stateWithTask.activeTasks[0].pane).toBe('%0');

      // Verify persisted to disk
      const diskState = readExecutionState(PARENT_ID, tempDir);
      expect(diskState?.activeTasks[0].pane).toBe('%0');
    });

    it('stores unique paneIds for multiple concurrent tasks', () => {
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 3,
      });

      // Add 3 tasks with different pane IDs (simulating parallel agents)
      const task1 = createMockActiveTask('COORD-101', '%0');
      const task2 = createMockActiveTask('COORD-102', '%1');
      const task3 = createMockActiveTask('COORD-103', '%2');

      let state = addActiveTask(initialState, task1, tempDir);
      state = addActiveTask(state, task2, tempDir);
      state = addActiveTask(state, task3, tempDir);

      // Verify each task has its unique paneId preserved
      const diskState = readExecutionState(PARENT_ID, tempDir);
      expect(diskState?.activeTasks.length).toBe(3);

      const paneMap = new Map(diskState!.activeTasks.map(t => [t.id, t.pane]));
      expect(paneMap.get('COORD-101')).toBe('%0');
      expect(paneMap.get('COORD-102')).toBe('%1');
      expect(paneMap.get('COORD-103')).toBe('%2');
    });

    it('preserves paneId when task has worktree path', () => {
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
      });

      const task: ActiveTask = {
        id: 'COORD-104',
        pid: 12345,
        pane: '%5',
        startedAt: new Date().toISOString(),
        worktree: '/home/user/repos/my-project-worktrees/COORD-104',
      };

      const stateWithTask = addActiveTask(initialState, task, tempDir);

      // Verify both pane and worktree are preserved
      expect(stateWithTask.activeTasks[0].pane).toBe('%5');
      expect(stateWithTask.activeTasks[0].worktree).toBe(
        '/home/user/repos/my-project-worktrees/COORD-104'
      );
    });

    it('handles empty paneId (placeholder before real pane assigned)', () => {
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
      });

      // Task added before tmux pane is created - empty pane placeholder
      const task = createMockActiveTask('COORD-105', '');
      const stateWithTask = addActiveTask(initialState, task, tempDir);

      expect(stateWithTask.activeTasks[0].pane).toBe('');

      // Later update with real pane ID
      const updatedState = updateActiveTaskPane(stateWithTask, 'COORD-105', '%3', tempDir);
      expect(updatedState.activeTasks[0].pane).toBe('%3');
    });
  });

  describe('state updates preserve pane mappings', () => {
    it('completeTask does not corrupt pane mappings of other active tasks', () => {
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 3,
      });

      // Add 3 active tasks
      const task1 = createMockActiveTask('COORD-201', '%0');
      const task2 = createMockActiveTask('COORD-202', '%1');
      const task3 = createMockActiveTask('COORD-203', '%2');

      let state = addActiveTask(initialState, task1, tempDir);
      state = addActiveTask(state, task2, tempDir);
      state = addActiveTask(state, task3, tempDir);

      // Complete task2 (middle one)
      state = completeTask(state, 'COORD-202', tempDir);

      // Verify remaining tasks still have correct pane mappings
      const diskState = readExecutionState(PARENT_ID, tempDir);
      expect(diskState?.activeTasks.length).toBe(2);

      const paneMap = new Map(diskState!.activeTasks.map(t => [t.id, t.pane]));
      expect(paneMap.get('COORD-201')).toBe('%0');
      expect(paneMap.get('COORD-203')).toBe('%2');
      expect(paneMap.has('COORD-202')).toBe(false); // Completed task removed
    });

    it('concurrent completions preserve remaining pane mappings', async () => {
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 4,
      });

      // Add 4 active tasks
      const tasks = [
        createMockActiveTask('COORD-211', '%0'),
        createMockActiveTask('COORD-212', '%1'),
        createMockActiveTask('COORD-213', '%2'),
        createMockActiveTask('COORD-214', '%3'),
      ];

      let state = initialState;
      for (const task of tasks) {
        state = addActiveTask(state, task, tempDir);
      }

      // Complete 2 tasks concurrently
      const completionPromises = [
        withExecutionState(
          PARENT_ID,
          (currentState) => {
            if (!currentState) throw new Error('State not found');
            const now = new Date();
            const activeTask = currentState.activeTasks.find(t => t.id === 'COORD-211');
            const duration = activeTask
              ? now.getTime() - new Date(activeTask.startedAt).getTime()
              : 0;
            return {
              ...currentState,
              activeTasks: currentState.activeTasks.filter(t => t.id !== 'COORD-211'),
              completedTasks: [
                ...currentState.completedTasks,
                { id: 'COORD-211', completedAt: now.toISOString(), duration },
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
            const activeTask = currentState.activeTasks.find(t => t.id === 'COORD-213');
            const duration = activeTask
              ? now.getTime() - new Date(activeTask.startedAt).getTime()
              : 0;
            return {
              ...currentState,
              activeTasks: currentState.activeTasks.filter(t => t.id !== 'COORD-213'),
              completedTasks: [
                ...currentState.completedTasks,
                { id: 'COORD-213', completedAt: now.toISOString(), duration },
              ],
            };
          },
          tempDir
        ),
      ];

      await Promise.all(completionPromises);

      // Verify remaining tasks have intact pane mappings
      const diskState = readExecutionState(PARENT_ID, tempDir);
      expect(diskState?.activeTasks.length).toBe(2);

      const paneMap = new Map(diskState!.activeTasks.map(t => [t.id, t.pane]));
      expect(paneMap.get('COORD-212')).toBe('%1');
      expect(paneMap.get('COORD-214')).toBe('%3');
    });

    it('failTask does not corrupt pane mappings of other active tasks', () => {
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 2,
      });

      const task1 = createMockActiveTask('COORD-221', '%0');
      const task2 = createMockActiveTask('COORD-222', '%1');

      let state = addActiveTask(initialState, task1, tempDir);
      state = addActiveTask(state, task2, tempDir);

      // Fail task1
      state = failTask(state, 'COORD-221', tempDir);

      // Verify task2 still has correct pane mapping
      const diskState = readExecutionState(PARENT_ID, tempDir);
      expect(diskState?.activeTasks.length).toBe(1);
      expect(diskState?.activeTasks[0].id).toBe('COORD-222');
      expect(diskState?.activeTasks[0].pane).toBe('%1');
    });

    it('rapid state transitions preserve all pane mappings', async () => {
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 5,
      });

      // Add 5 tasks with specific pane IDs
      const tasks = [
        createMockActiveTask('COORD-231', '%10'),
        createMockActiveTask('COORD-232', '%11'),
        createMockActiveTask('COORD-233', '%12'),
        createMockActiveTask('COORD-234', '%13'),
        createMockActiveTask('COORD-235', '%14'),
      ];

      let state = initialState;
      for (const task of tasks) {
        state = addActiveTask(state, task, tempDir);
      }

      // Complete tasks 1, 3, 5 concurrently
      const completionPromises = ['COORD-231', 'COORD-233', 'COORD-235'].map(taskId =>
        withExecutionState(
          PARENT_ID,
          (currentState) => {
            if (!currentState) throw new Error('State not found');
            const now = new Date();
            const activeTask = currentState.activeTasks.find(t => t.id === taskId);
            const duration = activeTask
              ? now.getTime() - new Date(activeTask.startedAt).getTime()
              : 0;
            return {
              ...currentState,
              activeTasks: currentState.activeTasks.filter(t => t.id !== taskId),
              completedTasks: [
                ...currentState.completedTasks,
                { id: taskId, completedAt: now.toISOString(), duration },
              ],
            };
          },
          tempDir
        )
      );

      await Promise.all(completionPromises);

      // Verify tasks 2 and 4 still have correct pane mappings
      const diskState = readExecutionState(PARENT_ID, tempDir);
      expect(diskState?.activeTasks.length).toBe(2);

      const paneMap = new Map(diskState!.activeTasks.map(t => [t.id, t.pane]));
      expect(paneMap.get('COORD-232')).toBe('%11');
      expect(paneMap.get('COORD-234')).toBe('%13');

      // Verify completed tasks
      expect(diskState?.completedTasks.length).toBe(3);
      const completedIds = getTaskIds(diskState!.completedTasks);
      expect(completedIds).toContain('COORD-231');
      expect(completedIds).toContain('COORD-233');
      expect(completedIds).toContain('COORD-235');
    });
  });

  describe('updateActiveTaskPane atomic updates', () => {
    it('atomically updates pane ID for a specific task', () => {
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
      });

      // Add task with placeholder pane
      const task = createMockActiveTask('COORD-301', '');
      const stateWithTask = addActiveTask(initialState, task, tempDir);

      expect(stateWithTask.activeTasks[0].pane).toBe('');

      // Update pane ID atomically
      const updatedState = updateActiveTaskPane(stateWithTask, 'COORD-301', '%7', tempDir);

      expect(updatedState.activeTasks[0].pane).toBe('%7');

      // Verify disk state
      const diskState = readExecutionState(PARENT_ID, tempDir);
      expect(diskState?.activeTasks[0].pane).toBe('%7');
    });

    it('does not affect other task pane mappings when updating one task', () => {
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
      });

      // Add multiple tasks
      const task1 = createMockActiveTask('COORD-311', '%0');
      const task2 = createMockActiveTask('COORD-312', ''); // Placeholder
      const task3 = createMockActiveTask('COORD-313', '%2');

      let state = addActiveTask(initialState, task1, tempDir);
      state = addActiveTask(state, task2, tempDir);
      state = addActiveTask(state, task3, tempDir);

      // Update task2's pane ID
      state = updateActiveTaskPane(state, 'COORD-312', '%5', tempDir);

      // Verify all pane mappings
      const diskState = readExecutionState(PARENT_ID, tempDir);
      const paneMap = new Map(diskState!.activeTasks.map(t => [t.id, t.pane]));

      expect(paneMap.get('COORD-311')).toBe('%0'); // Unchanged
      expect(paneMap.get('COORD-312')).toBe('%5'); // Updated
      expect(paneMap.get('COORD-313')).toBe('%2'); // Unchanged
    });

    it('handles updating pane ID for non-existent task gracefully', () => {
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
      });

      const task = createMockActiveTask('COORD-321', '%0');
      const stateWithTask = addActiveTask(initialState, task, tempDir);

      // Try to update non-existent task - should not throw, just no-op
      const updatedState = updateActiveTaskPane(stateWithTask, 'NON-EXISTENT', '%9', tempDir);

      // Original task should be unchanged
      expect(updatedState.activeTasks.length).toBe(1);
      expect(updatedState.activeTasks[0].id).toBe('COORD-321');
      expect(updatedState.activeTasks[0].pane).toBe('%0');
    });

    it('concurrent pane updates do not lose data', async () => {
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 3,
      });

      // Add 3 tasks with placeholder panes
      const tasks = [
        createMockActiveTask('COORD-331', ''),
        createMockActiveTask('COORD-332', ''),
        createMockActiveTask('COORD-333', ''),
      ];

      let state = initialState;
      for (const task of tasks) {
        state = addActiveTask(state, task, tempDir);
      }

      // Concurrently update all pane IDs (simulating parallel pane creation)
      const updatePromises = [
        withExecutionState(
          PARENT_ID,
          (currentState) => {
            if (!currentState) throw new Error('State not found');
            return {
              ...currentState,
              activeTasks: currentState.activeTasks.map(t =>
                t.id === 'COORD-331' ? { ...t, pane: '%10' } : t
              ),
            };
          },
          tempDir
        ),
        withExecutionState(
          PARENT_ID,
          (currentState) => {
            if (!currentState) throw new Error('State not found');
            return {
              ...currentState,
              activeTasks: currentState.activeTasks.map(t =>
                t.id === 'COORD-332' ? { ...t, pane: '%11' } : t
              ),
            };
          },
          tempDir
        ),
        withExecutionState(
          PARENT_ID,
          (currentState) => {
            if (!currentState) throw new Error('State not found');
            return {
              ...currentState,
              activeTasks: currentState.activeTasks.map(t =>
                t.id === 'COORD-333' ? { ...t, pane: '%12' } : t
              ),
            };
          },
          tempDir
        ),
      ];

      await Promise.all(updatePromises);

      // Verify all pane updates were applied
      const diskState = readExecutionState(PARENT_ID, tempDir);
      expect(diskState?.activeTasks.length).toBe(3);

      const paneMap = new Map(diskState!.activeTasks.map(t => [t.id, t.pane]));
      expect(paneMap.get('COORD-331')).toBe('%10');
      expect(paneMap.get('COORD-332')).toBe('%11');
      expect(paneMap.get('COORD-333')).toBe('%12');
    });

    it('pane update followed by completion preserves correct data', () => {
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
      });

      // Add task with placeholder pane
      const task = createMockActiveTask('COORD-341', '');
      let state = addActiveTask(initialState, task, tempDir);

      // Update pane ID
      state = updateActiveTaskPane(state, 'COORD-341', '%4', tempDir);

      // Verify pane is updated
      expect(state.activeTasks[0].pane).toBe('%4');

      // Complete the task
      state = completeTask(state, 'COORD-341', tempDir);

      // Verify task completed and not in active anymore
      expect(state.activeTasks.length).toBe(0);
      expect(state.completedTasks.length).toBe(1);

      const diskState = readExecutionState(PARENT_ID, tempDir);
      expect(diskState?.activeTasks.length).toBe(0);
      expect(diskState?.completedTasks.length).toBe(1);
    });

    it('updateActiveTaskPane is idempotent', () => {
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
      });

      const task = createMockActiveTask('COORD-351', '%0');
      let state = addActiveTask(initialState, task, tempDir);

      // Update to same value multiple times
      state = updateActiveTaskPane(state, 'COORD-351', '%5', tempDir);
      state = updateActiveTaskPane(state, 'COORD-351', '%5', tempDir);
      state = updateActiveTaskPane(state, 'COORD-351', '%5', tempDir);

      // Should still have exactly one task with correct pane
      const diskState = readExecutionState(PARENT_ID, tempDir);
      expect(diskState?.activeTasks.length).toBe(1);
      expect(diskState?.activeTasks[0].pane).toBe('%5');
    });
  });

  describe('integration: full workflow coordination', () => {
    it('simulates full parallel execution workflow with pane tracking', async () => {
      // Initialize state for parent issue
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
        loopPid: process.pid,
        totalTasks: 3,
      });

      // Step 1: Add tasks with placeholder panes (before tmux panes created)
      const tasks = [
        createMockActiveTask('COORD-401', ''),
        createMockActiveTask('COORD-402', ''),
        createMockActiveTask('COORD-403', ''),
      ];

      let state = initialState;
      for (const task of tasks) {
        state = addActiveTask(state, task, tempDir);
      }

      // Step 2: Update pane IDs after tmux panes are created
      state = updateActiveTaskPane(state, 'COORD-401', '%0', tempDir);
      state = updateActiveTaskPane(state, 'COORD-402', '%1', tempDir);
      state = updateActiveTaskPane(state, 'COORD-403', '%2', tempDir);

      // Verify panes are assigned
      let diskState = readExecutionState(PARENT_ID, tempDir);
      expect(diskState?.activeTasks.length).toBe(3);
      const initialPanes = new Map(diskState!.activeTasks.map(t => [t.id, t.pane]));
      expect(initialPanes.get('COORD-401')).toBe('%0');
      expect(initialPanes.get('COORD-402')).toBe('%1');
      expect(initialPanes.get('COORD-403')).toBe('%2');

      // Step 3: Task 1 completes
      state = completeTask(state, 'COORD-401', tempDir);

      // Verify remaining tasks still have panes
      diskState = readExecutionState(PARENT_ID, tempDir);
      expect(diskState?.activeTasks.length).toBe(2);
      const afterFirstComplete = new Map(diskState!.activeTasks.map(t => [t.id, t.pane]));
      expect(afterFirstComplete.get('COORD-402')).toBe('%1');
      expect(afterFirstComplete.get('COORD-403')).toBe('%2');

      // Step 4: Task 3 fails
      state = failTask(state, 'COORD-403', tempDir);

      // Verify task 2 still has its pane
      diskState = readExecutionState(PARENT_ID, tempDir);
      expect(diskState?.activeTasks.length).toBe(1);
      expect(diskState?.activeTasks[0].id).toBe('COORD-402');
      expect(diskState?.activeTasks[0].pane).toBe('%1');

      // Step 5: Task 2 completes
      state = completeTask(state, 'COORD-402', tempDir);

      // Final state verification
      diskState = readExecutionState(PARENT_ID, tempDir);
      expect(diskState?.activeTasks.length).toBe(0);
      expect(diskState?.completedTasks.length).toBe(2);
      expect(diskState?.failedTasks.length).toBe(1);

      const completedIds = getTaskIds(diskState!.completedTasks);
      const failedIds = getTaskIds(diskState!.failedTasks);
      expect(completedIds).toContain('COORD-401');
      expect(completedIds).toContain('COORD-402');
      expect(failedIds).toContain('COORD-403');
    });

    it('handles pane reassignment after task retry', () => {
      const initialState = initializeExecutionState(PARENT_ID, PARENT_TITLE, {
        stateDir: tempDir,
      });

      // Add task with initial pane
      const task = createMockActiveTask('COORD-411', '%0');
      let state = addActiveTask(initialState, task, tempDir);

      // Simulate task being retried - it might get a new pane
      state = updateActiveTaskPane(state, 'COORD-411', '%5', tempDir);

      // Verify new pane is recorded
      const diskState = readExecutionState(PARENT_ID, tempDir);
      expect(diskState?.activeTasks[0].pane).toBe('%5');
    });
  });
});
