/**
 * Unit tests for context-generator module
 *
 * Tests the local context file generation and management functions.
 * Uses temporary directories to avoid polluting the real ~/.mobius directory.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  IssueContext,
  ParentIssueContext,
  PendingUpdatesQueue,
  RuntimeActiveTask,
  RuntimeState,
  SessionInfo,
  SubTaskContext,
} from '../types/context.js';
import {
  addRuntimeActiveTask,
  cleanupContext,
  clearAllRuntimeActiveTasks,
  clearCurrentSessionPointer,
  completeRuntimeTask,
  contextExists,
  // Session management
  createSession,
  deleteRuntimeState,
  deleteSession,
  endSession,
  failRuntimeTask,
  getContextPath,
  getCurrentSessionParentId,
  getCurrentSessionPointerPath,
  getExecutionPath,
  getFullContextPath,
  getMobiusBasePath,
  getModalSummary,
  getParentContextPath,
  getPendingUpdatesPath,
  getProgressSummary,
  getRuntimePath,
  getSessionPath,
  getSyncLogPath,
  getTaskContextPath,
  getTasksDirectoryPath,
  // Runtime state management
  initializeRuntimeState,
  isContextFresh,
  type PendingUpdateInput,
  queuePendingUpdate,
  readContext,
  readPendingUpdates,
  readRuntimeState,
  readSession,
  removeRuntimeActiveTask,
  resolveTaskContext,
  resolveTaskId,
  setCurrentSessionPointer,
  updateBackendStatus,
  updateRuntimeTaskPane,
  updateSession,
  updateTaskContext,
  writeFullContextFile,
  writePendingUpdates,
  writeRuntimeState,
  writeSession,
} from './context-generator.js';

describe('context-generator module', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `context-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  describe('path helper functions', () => {
    describe('getMobiusBasePath', () => {
      it('returns path under home directory', () => {
        const basePath = getMobiusBasePath();
        expect(basePath).toContain('.mobius');
        expect(basePath.startsWith(homedir())).toBe(true);
      });
    });

    describe('getContextPath', () => {
      it('returns path for parent issue context directory', () => {
        const contextPath = getContextPath('MOB-161');
        expect(contextPath).toContain('issues');
        expect(contextPath).toContain('MOB-161');
      });

      it('handles different issue identifier formats', () => {
        expect(getContextPath('PROJECT-123')).toContain('PROJECT-123');
        expect(getContextPath('ABC-1')).toContain('ABC-1');
        expect(getContextPath('LONG-PROJECT-99999')).toContain('LONG-PROJECT-99999');
      });
    });

    describe('getParentContextPath', () => {
      it('returns path to parent.json file', () => {
        const parentPath = getParentContextPath('MOB-161');
        expect(parentPath).toEndWith('parent.json');
        expect(parentPath).toContain('MOB-161');
      });
    });

    describe('getTasksDirectoryPath', () => {
      it('returns path to tasks subdirectory', () => {
        const tasksPath = getTasksDirectoryPath('MOB-161');
        expect(tasksPath).toEndWith('tasks');
        expect(tasksPath).toContain('MOB-161');
      });
    });

    describe('getTaskContextPath', () => {
      it('returns path to specific task JSON file', () => {
        const taskPath = getTaskContextPath('MOB-161', 'MOB-172');
        expect(taskPath).toEndWith('MOB-172.json');
        expect(taskPath).toContain('tasks');
        expect(taskPath).toContain('MOB-161');
      });

      it('constructs correct paths for different task identifiers', () => {
        const taskPath1 = getTaskContextPath('PROJ-100', 'PROJ-125');
        const taskPath2 = getTaskContextPath('PROJ-100', 'PROJ-126');

        expect(taskPath1).toContain('PROJ-125.json');
        expect(taskPath2).toContain('PROJ-126.json');
        expect(taskPath1).not.toBe(taskPath2);
      });
    });

    describe('getPendingUpdatesPath', () => {
      it('returns path to pending-updates.json file', () => {
        const pendingPath = getPendingUpdatesPath('MOB-161');
        expect(pendingPath).toEndWith('pending-updates.json');
        expect(pendingPath).toContain('MOB-161');
      });
    });

    describe('getSyncLogPath', () => {
      it('returns path to sync-log.json file', () => {
        const syncLogPath = getSyncLogPath('MOB-161');
        expect(syncLogPath).toEndWith('sync-log.json');
        expect(syncLogPath).toContain('MOB-161');
      });
    });

    describe('getFullContextPath', () => {
      it('returns path to context.json file', () => {
        const fullContextPath = getFullContextPath('MOB-161');
        expect(fullContextPath).toEndWith('context.json');
        expect(fullContextPath).toContain('MOB-161');
      });
    });
  });

  describe('writeFullContextFile', () => {
    it('writes context to JSON file and returns path', () => {
      const context: IssueContext = {
        parent: {
          id: 'parent-uuid',
          identifier: 'TEST-1',
          title: 'Test Parent',
          description: 'Test description',
          gitBranchName: 'feature/test',
          status: 'Backlog',
          labels: [],
          url: 'https://example.com/TEST-1',
        },
        subTasks: [],
        metadata: {
          fetchedAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          backend: 'linear',
        },
      };

      // Use the actual function but check it creates the file correctly
      const contextPath = writeFullContextFile('TEST-1', context);

      expect(contextPath).toContain('TEST-1');
      expect(contextPath).toEndWith('context.json');
      expect(existsSync(contextPath)).toBe(true);

      // Verify content
      const written = JSON.parse(readFileSync(contextPath, 'utf-8'));
      expect(written.parent.identifier).toBe('TEST-1');
      expect(written.metadata.backend).toBe('linear');

      // Cleanup
      cleanupContext('TEST-1');
    });

    it('creates parent directories if they do not exist', () => {
      const context: IssueContext = {
        parent: {
          id: 'parent-uuid-2',
          identifier: 'TEST-NEW',
          title: 'New Test',
          description: '',
          gitBranchName: 'feature/new',
          status: 'Backlog',
          labels: [],
          url: '',
        },
        subTasks: [],
        metadata: {
          fetchedAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          backend: 'jira',
        },
      };

      const contextPath = writeFullContextFile('TEST-NEW', context);
      expect(existsSync(contextPath)).toBe(true);

      // Cleanup
      cleanupContext('TEST-NEW');
    });

    it('includes subTasks in written context', () => {
      const context: IssueContext = {
        parent: {
          id: 'parent-uuid-3',
          identifier: 'TEST-SUB',
          title: 'Test with Subtasks',
          description: '',
          gitBranchName: 'feature/subtasks',
          status: 'Backlog',
          labels: ['feature'],
          url: '',
        },
        subTasks: [
          {
            id: 'subtask-1',
            identifier: 'TEST-SUB-1',
            title: 'First subtask',
            description: 'Do the first thing',
            status: 'pending',
            gitBranchName: 'feature/subtask-1',
            blockedBy: [],
            blocks: [],
          },
          {
            id: 'subtask-2',
            identifier: 'TEST-SUB-2',
            title: 'Second subtask',
            description: 'Do the second thing',
            status: 'pending',
            gitBranchName: 'feature/subtask-2',
            blockedBy: [{ id: 'subtask-1', identifier: 'TEST-SUB-1' }],
            blocks: [],
          },
        ],
        metadata: {
          fetchedAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          backend: 'linear',
        },
      };

      const contextPath = writeFullContextFile('TEST-SUB', context);
      const written = JSON.parse(readFileSync(contextPath, 'utf-8'));

      expect(written.subTasks).toHaveLength(2);
      expect(written.subTasks[0].identifier).toBe('TEST-SUB-1');
      expect(written.subTasks[1].blockedBy).toHaveLength(1);

      // Cleanup
      cleanupContext('TEST-SUB');
    });
  });

  describe('contextExists', () => {
    it('returns false when context does not exist', () => {
      expect(contextExists('NONEXISTENT-123')).toBe(false);
    });

    it('returns true when parent.json exists', () => {
      // Create the context first
      const context: IssueContext = {
        parent: {
          id: 'exists-uuid',
          identifier: 'EXISTS-1',
          title: 'Existing Issue',
          description: '',
          gitBranchName: 'feature/exists',
          status: 'Backlog',
          labels: [],
          url: '',
        },
        subTasks: [],
        metadata: {
          fetchedAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          backend: 'linear',
        },
      };

      writeFullContextFile('EXISTS-1', context);

      // Write parent.json explicitly
      const parentPath = getParentContextPath('EXISTS-1');
      writeFileSync(parentPath, JSON.stringify(context.parent, null, 2), 'utf-8');

      expect(contextExists('EXISTS-1')).toBe(true);

      // Cleanup
      cleanupContext('EXISTS-1');
    });
  });

  describe('cleanupContext', () => {
    it('removes context directory and all contents', () => {
      const context: IssueContext = {
        parent: {
          id: 'cleanup-uuid',
          identifier: 'CLEANUP-1',
          title: 'To Be Cleaned',
          description: '',
          gitBranchName: 'feature/cleanup',
          status: 'Backlog',
          labels: [],
          url: '',
        },
        subTasks: [],
        metadata: {
          fetchedAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          backend: 'linear',
        },
      };

      writeFullContextFile('CLEANUP-1', context);
      const parentPath = getParentContextPath('CLEANUP-1');
      writeFileSync(parentPath, JSON.stringify(context.parent, null, 2), 'utf-8');

      expect(existsSync(getContextPath('CLEANUP-1'))).toBe(true);

      cleanupContext('CLEANUP-1');

      expect(existsSync(getContextPath('CLEANUP-1'))).toBe(false);
    });

    it('handles non-existent context gracefully', () => {
      // Should not throw
      expect(() => cleanupContext('NONEXISTENT-999')).not.toThrow();
    });
  });

  describe('updateTaskContext', () => {
    it('creates task file in tasks directory', () => {
      const task: SubTaskContext = {
        id: 'task-uuid-1',
        identifier: 'UPDATE-TASK-1',
        title: 'Task to Update',
        description: 'Task description',
        status: 'pending',
        gitBranchName: 'feature/task-1',
        blockedBy: [],
        blocks: [],
      };

      // First create the parent context directory
      const parentContext: IssueContext = {
        parent: {
          id: 'update-parent',
          identifier: 'UPDATE-PARENT',
          title: 'Parent for Update',
          description: '',
          gitBranchName: 'feature/parent',
          status: 'Backlog',
          labels: [],
          url: '',
        },
        subTasks: [],
        metadata: {
          fetchedAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          backend: 'linear',
        },
      };
      writeFullContextFile('UPDATE-PARENT', parentContext);

      updateTaskContext('UPDATE-PARENT', task);

      const taskPath = getTaskContextPath('UPDATE-PARENT', 'UPDATE-TASK-1');
      expect(existsSync(taskPath)).toBe(true);

      const written = JSON.parse(readFileSync(taskPath, 'utf-8'));
      expect(written.identifier).toBe('UPDATE-TASK-1');
      expect(written.status).toBe('pending');

      // Cleanup
      cleanupContext('UPDATE-PARENT');
    });

    it('updates existing task file', () => {
      const parentContext: IssueContext = {
        parent: {
          id: 'update-parent-2',
          identifier: 'UPDATE-PARENT-2',
          title: 'Parent for Update 2',
          description: '',
          gitBranchName: 'feature/parent-2',
          status: 'Backlog',
          labels: [],
          url: '',
        },
        subTasks: [],
        metadata: {
          fetchedAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          backend: 'linear',
        },
      };
      writeFullContextFile('UPDATE-PARENT-2', parentContext);

      const task: SubTaskContext = {
        id: 'task-uuid-2',
        identifier: 'UPDATE-TASK-2',
        title: 'Task to Update',
        description: 'Initial description',
        status: 'pending',
        gitBranchName: 'feature/task-2',
        blockedBy: [],
        blocks: [],
      };

      updateTaskContext('UPDATE-PARENT-2', task);

      // Update the task
      const updatedTask: SubTaskContext = {
        ...task,
        status: 'done',
        description: 'Updated description',
      };

      updateTaskContext('UPDATE-PARENT-2', updatedTask);

      const taskPath = getTaskContextPath('UPDATE-PARENT-2', 'UPDATE-TASK-2');
      const written = JSON.parse(readFileSync(taskPath, 'utf-8'));

      expect(written.status).toBe('done');
      expect(written.description).toBe('Updated description');

      // Cleanup
      cleanupContext('UPDATE-PARENT-2');
    });

    it('creates tasks directory if it does not exist', () => {
      // Manually create just the context directory without tasks
      const contextPath = getContextPath('NO-TASKS-DIR');
      mkdirSync(contextPath, { recursive: true });

      const task: SubTaskContext = {
        id: 'task-uuid-3',
        identifier: 'NEW-TASK',
        title: 'New Task',
        description: '',
        status: 'pending',
        gitBranchName: 'feature/new-task',
        blockedBy: [],
        blocks: [],
      };

      updateTaskContext('NO-TASKS-DIR', task);

      const tasksDir = getTasksDirectoryPath('NO-TASKS-DIR');
      expect(existsSync(tasksDir)).toBe(true);

      // Cleanup
      cleanupContext('NO-TASKS-DIR');
    });
  });

  describe('pending updates queue', () => {
    describe('readPendingUpdates', () => {
      it('returns empty queue when file does not exist', () => {
        const queue = readPendingUpdates('NO-PENDING-FILE');
        expect(queue.updates).toEqual([]);
      });

      it('reads existing pending updates', () => {
        const parentContext: IssueContext = {
          parent: {
            id: 'pending-parent',
            identifier: 'PENDING-1',
            title: 'Parent with Pending',
            description: '',
            gitBranchName: 'feature/pending',
            status: 'Backlog',
            labels: [],
            url: '',
          },
          subTasks: [],
          metadata: {
            fetchedAt: '2024-01-15T10:00:00Z',
            updatedAt: '2024-01-15T10:00:00Z',
            backend: 'linear',
          },
        };
        writeFullContextFile('PENDING-1', parentContext);

        const pendingQueue: PendingUpdatesQueue = {
          updates: [
            {
              id: 'update-1',
              type: 'status_change',
              issueId: 'issue-uuid',
              identifier: 'PENDING-1-TASK',
              oldStatus: 'pending',
              newStatus: 'done',
              createdAt: '2024-01-15T10:00:00Z',
            },
          ],
        };

        writeFileSync(
          getPendingUpdatesPath('PENDING-1'),
          JSON.stringify(pendingQueue, null, 2),
          'utf-8'
        );

        const queue = readPendingUpdates('PENDING-1');
        expect(queue.updates).toHaveLength(1);
        expect(queue.updates[0].type).toBe('status_change');

        // Cleanup
        cleanupContext('PENDING-1');
      });

      it('returns empty queue on parse error', () => {
        const contextPath = getContextPath('INVALID-PENDING');
        mkdirSync(contextPath, { recursive: true });

        // Write invalid JSON
        writeFileSync(getPendingUpdatesPath('INVALID-PENDING'), 'invalid json {{{', 'utf-8');

        const queue = readPendingUpdates('INVALID-PENDING');
        expect(queue.updates).toEqual([]);

        // Cleanup
        cleanupContext('INVALID-PENDING');
      });
    });

    describe('writePendingUpdates', () => {
      it('writes pending updates queue to file', () => {
        const queue: PendingUpdatesQueue = {
          updates: [
            {
              id: 'write-update-1',
              type: 'add_comment',
              issueId: 'issue-uuid',
              identifier: 'WRITE-1-TASK',
              body: 'Test comment',
              createdAt: '2024-01-15T10:00:00Z',
            },
          ],
          lastSyncAttempt: '2024-01-15T09:00:00Z',
        };

        writePendingUpdates('WRITE-PENDING', queue);

        const path = getPendingUpdatesPath('WRITE-PENDING');
        expect(existsSync(path)).toBe(true);

        const written = JSON.parse(readFileSync(path, 'utf-8'));
        expect(written.updates).toHaveLength(1);
        expect(written.updates[0].body).toBe('Test comment');
        expect(written.lastSyncAttempt).toBe('2024-01-15T09:00:00Z');

        // Cleanup
        cleanupContext('WRITE-PENDING');
      });

      it('creates directories if needed', () => {
        const queue: PendingUpdatesQueue = {
          updates: [],
        };

        writePendingUpdates('NEW-PENDING-DIR', queue);

        const path = getPendingUpdatesPath('NEW-PENDING-DIR');
        expect(existsSync(path)).toBe(true);

        // Cleanup
        cleanupContext('NEW-PENDING-DIR');
      });
    });

    describe('queuePendingUpdate', () => {
      it('adds status_change update to queue', () => {
        const parentContext: IssueContext = {
          parent: {
            id: 'queue-parent',
            identifier: 'QUEUE-1',
            title: 'Parent for Queue',
            description: '',
            gitBranchName: 'feature/queue',
            status: 'Backlog',
            labels: [],
            url: '',
          },
          subTasks: [],
          metadata: {
            fetchedAt: '2024-01-15T10:00:00Z',
            updatedAt: '2024-01-15T10:00:00Z',
            backend: 'linear',
          },
        };
        writeFullContextFile('QUEUE-1', parentContext);

        const update: PendingUpdateInput = {
          type: 'status_change',
          issueId: 'task-uuid',
          identifier: 'QUEUE-1-TASK',
          oldStatus: 'pending',
          newStatus: 'in_progress',
        };

        queuePendingUpdate('QUEUE-1', update);

        const queue = readPendingUpdates('QUEUE-1');
        expect(queue.updates).toHaveLength(1);
        expect(queue.updates[0].type).toBe('status_change');
        expect(queue.updates[0].id).toBeDefined();
        expect(queue.updates[0].createdAt).toBeDefined();
        if (queue.updates[0].type === 'status_change') {
          expect(queue.updates[0].newStatus).toBe('in_progress');
        }

        // Cleanup
        cleanupContext('QUEUE-1');
      });

      it('adds add_comment update to queue', () => {
        const parentContext: IssueContext = {
          parent: {
            id: 'queue-parent-2',
            identifier: 'QUEUE-2',
            title: 'Parent for Queue 2',
            description: '',
            gitBranchName: 'feature/queue-2',
            status: 'Backlog',
            labels: [],
            url: '',
          },
          subTasks: [],
          metadata: {
            fetchedAt: '2024-01-15T10:00:00Z',
            updatedAt: '2024-01-15T10:00:00Z',
            backend: 'linear',
          },
        };
        writeFullContextFile('QUEUE-2', parentContext);

        const update: PendingUpdateInput = {
          type: 'add_comment',
          issueId: 'task-uuid-2',
          identifier: 'QUEUE-2-TASK',
          body: 'Implementation complete',
        };

        queuePendingUpdate('QUEUE-2', update);

        const queue = readPendingUpdates('QUEUE-2');
        expect(queue.updates).toHaveLength(1);
        if (queue.updates[0].type === 'add_comment') {
          expect(queue.updates[0].body).toBe('Implementation complete');
        }

        // Cleanup
        cleanupContext('QUEUE-2');
      });

      it('appends to existing updates', () => {
        const parentContext: IssueContext = {
          parent: {
            id: 'queue-parent-3',
            identifier: 'QUEUE-3',
            title: 'Parent for Queue 3',
            description: '',
            gitBranchName: 'feature/queue-3',
            status: 'Backlog',
            labels: [],
            url: '',
          },
          subTasks: [],
          metadata: {
            fetchedAt: '2024-01-15T10:00:00Z',
            updatedAt: '2024-01-15T10:00:00Z',
            backend: 'linear',
          },
        };
        writeFullContextFile('QUEUE-3', parentContext);

        // Add first update
        queuePendingUpdate('QUEUE-3', {
          type: 'status_change',
          issueId: 'task-1',
          identifier: 'QUEUE-3-TASK-1',
          oldStatus: 'pending',
          newStatus: 'in_progress',
        });

        // Add second update
        queuePendingUpdate('QUEUE-3', {
          type: 'add_comment',
          issueId: 'task-1',
          identifier: 'QUEUE-3-TASK-1',
          body: 'Started work',
        });

        const queue = readPendingUpdates('QUEUE-3');
        expect(queue.updates).toHaveLength(2);
        expect(queue.updates[0].type).toBe('status_change');
        expect(queue.updates[1].type).toBe('add_comment');

        // Cleanup
        cleanupContext('QUEUE-3');
      });

      it('generates unique IDs for each update', () => {
        const parentContext: IssueContext = {
          parent: {
            id: 'queue-parent-4',
            identifier: 'QUEUE-4',
            title: 'Parent for Queue 4',
            description: '',
            gitBranchName: 'feature/queue-4',
            status: 'Backlog',
            labels: [],
            url: '',
          },
          subTasks: [],
          metadata: {
            fetchedAt: '2024-01-15T10:00:00Z',
            updatedAt: '2024-01-15T10:00:00Z',
            backend: 'linear',
          },
        };
        writeFullContextFile('QUEUE-4', parentContext);

        // Add multiple updates
        queuePendingUpdate('QUEUE-4', {
          type: 'add_label',
          issueId: 'task-1',
          identifier: 'QUEUE-4-TASK-1',
          label: 'bug',
        });

        queuePendingUpdate('QUEUE-4', {
          type: 'add_label',
          issueId: 'task-1',
          identifier: 'QUEUE-4-TASK-1',
          label: 'urgent',
        });

        const queue = readPendingUpdates('QUEUE-4');
        const ids = queue.updates.map((u) => u.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);

        // Cleanup
        cleanupContext('QUEUE-4');
      });

      it('adds create_subtask update', () => {
        const parentContext: IssueContext = {
          parent: {
            id: 'queue-parent-5',
            identifier: 'QUEUE-5',
            title: 'Parent for Queue 5',
            description: '',
            gitBranchName: 'feature/queue-5',
            status: 'Backlog',
            labels: [],
            url: '',
          },
          subTasks: [],
          metadata: {
            fetchedAt: '2024-01-15T10:00:00Z',
            updatedAt: '2024-01-15T10:00:00Z',
            backend: 'linear',
          },
        };
        writeFullContextFile('QUEUE-5', parentContext);

        queuePendingUpdate('QUEUE-5', {
          type: 'create_subtask',
          parentId: 'parent-uuid',
          title: 'New subtask',
          description: 'Do something',
          blockedBy: ['existing-task-id'],
        });

        const queue = readPendingUpdates('QUEUE-5');
        expect(queue.updates).toHaveLength(1);
        if (queue.updates[0].type === 'create_subtask') {
          expect(queue.updates[0].title).toBe('New subtask');
          expect(queue.updates[0].blockedBy).toEqual(['existing-task-id']);
        }

        // Cleanup
        cleanupContext('QUEUE-5');
      });

      it('adds update_description update', () => {
        const parentContext: IssueContext = {
          parent: {
            id: 'queue-parent-6',
            identifier: 'QUEUE-6',
            title: 'Parent for Queue 6',
            description: '',
            gitBranchName: 'feature/queue-6',
            status: 'Backlog',
            labels: [],
            url: '',
          },
          subTasks: [],
          metadata: {
            fetchedAt: '2024-01-15T10:00:00Z',
            updatedAt: '2024-01-15T10:00:00Z',
            backend: 'linear',
          },
        };
        writeFullContextFile('QUEUE-6', parentContext);

        queuePendingUpdate('QUEUE-6', {
          type: 'update_description',
          issueId: 'task-uuid',
          identifier: 'QUEUE-6-TASK',
          description: 'Updated task description with more details',
        });

        const queue = readPendingUpdates('QUEUE-6');
        expect(queue.updates).toHaveLength(1);
        if (queue.updates[0].type === 'update_description') {
          expect(queue.updates[0].description).toContain('Updated task description');
        }

        // Cleanup
        cleanupContext('QUEUE-6');
      });

      it('adds remove_label update', () => {
        const parentContext: IssueContext = {
          parent: {
            id: 'queue-parent-7',
            identifier: 'QUEUE-7',
            title: 'Parent for Queue 7',
            description: '',
            gitBranchName: 'feature/queue-7',
            status: 'Backlog',
            labels: [],
            url: '',
          },
          subTasks: [],
          metadata: {
            fetchedAt: '2024-01-15T10:00:00Z',
            updatedAt: '2024-01-15T10:00:00Z',
            backend: 'linear',
          },
        };
        writeFullContextFile('QUEUE-7', parentContext);

        queuePendingUpdate('QUEUE-7', {
          type: 'remove_label',
          issueId: 'task-uuid',
          identifier: 'QUEUE-7-TASK',
          label: 'wontfix',
        });

        const queue = readPendingUpdates('QUEUE-7');
        expect(queue.updates).toHaveLength(1);
        if (queue.updates[0].type === 'remove_label') {
          expect(queue.updates[0].label).toBe('wontfix');
        }

        // Cleanup
        cleanupContext('QUEUE-7');
      });

      it('skips duplicate status_change updates', () => {
        const parentContext: IssueContext = {
          parent: {
            id: 'dup-parent',
            identifier: 'DUP-1',
            title: 'Duplicate Test',
            description: '',
            gitBranchName: 'feature/dup',
            status: 'Backlog',
            labels: [],
            url: '',
          },
          subTasks: [],
          metadata: {
            fetchedAt: '2024-01-15T10:00:00Z',
            updatedAt: '2024-01-15T10:00:00Z',
            backend: 'linear',
          },
        };
        writeFullContextFile('DUP-1', parentContext);

        const update = {
          type: 'status_change' as const,
          issueId: 'task-uuid',
          identifier: 'DUP-1-TASK',
          oldStatus: 'pending',
          newStatus: 'in_progress',
        };

        // Queue first update
        queuePendingUpdate('DUP-1', update);

        // Queue identical update - should be skipped
        queuePendingUpdate('DUP-1', update);

        const queue = readPendingUpdates('DUP-1');
        expect(queue.updates).toHaveLength(1);

        // Cleanup
        cleanupContext('DUP-1');
      });

      it('skips duplicate add_comment updates', () => {
        const parentContext: IssueContext = {
          parent: {
            id: 'dup-parent-2',
            identifier: 'DUP-2',
            title: 'Duplicate Comment Test',
            description: '',
            gitBranchName: 'feature/dup2',
            status: 'Backlog',
            labels: [],
            url: '',
          },
          subTasks: [],
          metadata: {
            fetchedAt: '2024-01-15T10:00:00Z',
            updatedAt: '2024-01-15T10:00:00Z',
            backend: 'linear',
          },
        };
        writeFullContextFile('DUP-2', parentContext);

        const update = {
          type: 'add_comment' as const,
          issueId: 'task-uuid',
          identifier: 'DUP-2-TASK',
          body: 'Task completed successfully',
        };

        // Queue same comment multiple times
        queuePendingUpdate('DUP-2', update);
        queuePendingUpdate('DUP-2', update);
        queuePendingUpdate('DUP-2', update);

        const queue = readPendingUpdates('DUP-2');
        expect(queue.updates).toHaveLength(1);
        expect(queue.updates[0].type).toBe('add_comment');

        // Cleanup
        cleanupContext('DUP-2');
      });

      it('allows different updates of same type', () => {
        const parentContext: IssueContext = {
          parent: {
            id: 'dup-parent-3',
            identifier: 'DUP-3',
            title: 'Different Updates Test',
            description: '',
            gitBranchName: 'feature/dup3',
            status: 'Backlog',
            labels: [],
            url: '',
          },
          subTasks: [],
          metadata: {
            fetchedAt: '2024-01-15T10:00:00Z',
            updatedAt: '2024-01-15T10:00:00Z',
            backend: 'linear',
          },
        };
        writeFullContextFile('DUP-3', parentContext);

        // Queue two different status changes
        queuePendingUpdate('DUP-3', {
          type: 'status_change',
          issueId: 'task-uuid',
          identifier: 'DUP-3-TASK',
          oldStatus: 'pending',
          newStatus: 'in_progress',
        });

        queuePendingUpdate('DUP-3', {
          type: 'status_change',
          issueId: 'task-uuid',
          identifier: 'DUP-3-TASK',
          oldStatus: 'in_progress',
          newStatus: 'done',
        });

        const queue = readPendingUpdates('DUP-3');
        expect(queue.updates).toHaveLength(2);

        // Cleanup
        cleanupContext('DUP-3');
      });

      it('allows re-queueing after previous was synced', () => {
        const parentContext: IssueContext = {
          parent: {
            id: 'dup-parent-4',
            identifier: 'DUP-4',
            title: 'Synced Update Test',
            description: '',
            gitBranchName: 'feature/dup4',
            status: 'Backlog',
            labels: [],
            url: '',
          },
          subTasks: [],
          metadata: {
            fetchedAt: '2024-01-15T10:00:00Z',
            updatedAt: '2024-01-15T10:00:00Z',
            backend: 'linear',
          },
        };
        writeFullContextFile('DUP-4', parentContext);

        const update = {
          type: 'add_comment' as const,
          issueId: 'task-uuid',
          identifier: 'DUP-4-TASK',
          body: 'Same comment twice',
        };

        // Queue first update
        queuePendingUpdate('DUP-4', update);

        // Mark it as synced
        const queue = readPendingUpdates('DUP-4');
        queue.updates[0].syncedAt = new Date().toISOString();
        writePendingUpdates('DUP-4', queue);

        // Queue same update again - should be allowed since previous was synced
        // (e.g., status might have been changed externally and needs re-applying)
        queuePendingUpdate('DUP-4', update);

        const finalQueue = readPendingUpdates('DUP-4');
        expect(finalQueue.updates).toHaveLength(2);
        expect(finalQueue.updates[0].syncedAt).toBeDefined();
        expect(finalQueue.updates[1].syncedAt).toBeUndefined();

        // Cleanup
        cleanupContext('DUP-4');
      });

      it('skips duplicate create_subtask updates', () => {
        const parentContext: IssueContext = {
          parent: {
            id: 'dup-parent-5',
            identifier: 'DUP-5',
            title: 'Duplicate Subtask Test',
            description: '',
            gitBranchName: 'feature/dup5',
            status: 'Backlog',
            labels: [],
            url: '',
          },
          subTasks: [],
          metadata: {
            fetchedAt: '2024-01-15T10:00:00Z',
            updatedAt: '2024-01-15T10:00:00Z',
            backend: 'linear',
          },
        };
        writeFullContextFile('DUP-5', parentContext);

        const update = {
          type: 'create_subtask' as const,
          parentId: 'parent-uuid',
          title: 'New subtask',
          description: 'Do something',
        };

        queuePendingUpdate('DUP-5', update);
        queuePendingUpdate('DUP-5', update);

        const queue = readPendingUpdates('DUP-5');
        expect(queue.updates).toHaveLength(1);

        // Cleanup
        cleanupContext('DUP-5');
      });

      it('skips duplicate add_label updates', () => {
        const parentContext: IssueContext = {
          parent: {
            id: 'dup-parent-6',
            identifier: 'DUP-6',
            title: 'Duplicate Label Test',
            description: '',
            gitBranchName: 'feature/dup6',
            status: 'Backlog',
            labels: [],
            url: '',
          },
          subTasks: [],
          metadata: {
            fetchedAt: '2024-01-15T10:00:00Z',
            updatedAt: '2024-01-15T10:00:00Z',
            backend: 'linear',
          },
        };
        writeFullContextFile('DUP-6', parentContext);

        const update = {
          type: 'add_label' as const,
          issueId: 'task-uuid',
          identifier: 'DUP-6-TASK',
          label: 'urgent',
        };

        queuePendingUpdate('DUP-6', update);
        queuePendingUpdate('DUP-6', update);

        const queue = readPendingUpdates('DUP-6');
        expect(queue.updates).toHaveLength(1);

        // Cleanup
        cleanupContext('DUP-6');
      });
    });
  });

  describe('readContext', () => {
    it('returns null when context directory does not exist', () => {
      const context = readContext('NONEXISTENT-READ');
      expect(context).toBeNull();
    });

    it('returns null when parent.json does not exist', () => {
      const contextPath = getContextPath('NO-PARENT');
      mkdirSync(contextPath, { recursive: true });

      const context = readContext('NO-PARENT');
      expect(context).toBeNull();

      // Cleanup
      cleanupContext('NO-PARENT');
    });

    it('reads context with parent and no subtasks', () => {
      const parent: ParentIssueContext = {
        id: 'read-parent',
        identifier: 'READ-1',
        title: 'Readable Parent',
        description: 'Test description',
        gitBranchName: 'feature/read',
        status: 'In Progress',
        labels: ['feature'],
        url: 'https://example.com/READ-1',
      };

      // Set up context
      const contextPath = getContextPath('READ-1');
      mkdirSync(contextPath, { recursive: true });
      writeFileSync(getParentContextPath('READ-1'), JSON.stringify(parent, null, 2), 'utf-8');

      const context = readContext('READ-1');
      expect(context).not.toBeNull();
      expect(context?.parent.identifier).toBe('READ-1');
      expect(context?.parent.status).toBe('In Progress');
      expect(context?.subTasks).toEqual([]);

      // Cleanup
      cleanupContext('READ-1');
    });

    it('reads context with parent and subtasks', () => {
      const parent: ParentIssueContext = {
        id: 'read-parent-2',
        identifier: 'READ-2',
        title: 'Parent with Subtasks',
        description: '',
        gitBranchName: 'feature/read-2',
        status: 'Backlog',
        labels: [],
        url: '',
      };

      const subtask: SubTaskContext = {
        id: 'read-subtask',
        identifier: 'READ-2-SUB',
        title: 'A subtask',
        description: 'Subtask description',
        status: 'pending',
        gitBranchName: 'feature/subtask',
        blockedBy: [],
        blocks: [],
      };

      // Set up context
      const tasksPath = getTasksDirectoryPath('READ-2');
      mkdirSync(tasksPath, { recursive: true });
      writeFileSync(getParentContextPath('READ-2'), JSON.stringify(parent, null, 2), 'utf-8');
      writeFileSync(
        getTaskContextPath('READ-2', 'READ-2-SUB'),
        JSON.stringify(subtask, null, 2),
        'utf-8'
      );

      const context = readContext('READ-2');
      expect(context).not.toBeNull();
      expect(context?.subTasks).toHaveLength(1);
      expect(context?.subTasks[0].identifier).toBe('READ-2-SUB');

      // Cleanup
      cleanupContext('READ-2');
    });

    it('returns null on invalid JSON in parent.json', () => {
      const contextPath = getContextPath('INVALID-PARENT');
      mkdirSync(contextPath, { recursive: true });
      writeFileSync(getParentContextPath('INVALID-PARENT'), 'not valid json', 'utf-8');

      const context = readContext('INVALID-PARENT');
      expect(context).toBeNull();

      // Cleanup
      cleanupContext('INVALID-PARENT');
    });
  });

  describe('isContextFresh', () => {
    it('returns false when parent.json does not exist', () => {
      expect(isContextFresh('NONEXISTENT-FRESH')).toBe(false);
    });

    it('returns true for recently created context', () => {
      const parent: ParentIssueContext = {
        id: 'fresh-parent',
        identifier: 'FRESH-1',
        title: 'Fresh Parent',
        description: '',
        gitBranchName: 'feature/fresh',
        status: 'Backlog',
        labels: [],
        url: '',
      };

      const contextPath = getContextPath('FRESH-1');
      mkdirSync(contextPath, { recursive: true });
      writeFileSync(getParentContextPath('FRESH-1'), JSON.stringify(parent, null, 2), 'utf-8');

      // Just created, should be fresh
      expect(isContextFresh('FRESH-1')).toBe(true);
      expect(isContextFresh('FRESH-1', 60 * 60 * 1000)).toBe(true); // 1 hour

      // Cleanup
      cleanupContext('FRESH-1');
    });

    it('returns false for very short maxAge', () => {
      const parent: ParentIssueContext = {
        id: 'old-parent',
        identifier: 'OLD-1',
        title: 'Old Parent',
        description: '',
        gitBranchName: 'feature/old',
        status: 'Backlog',
        labels: [],
        url: '',
      };

      const contextPath = getContextPath('OLD-1');
      mkdirSync(contextPath, { recursive: true });
      writeFileSync(getParentContextPath('OLD-1'), JSON.stringify(parent, null, 2), 'utf-8');

      // With 0ms maxAge, file is always stale
      expect(isContextFresh('OLD-1', 0)).toBe(false);

      // Cleanup
      cleanupContext('OLD-1');
    });
  });

  describe('Runtime State Management', () => {
    const testParentId = 'RUNTIME-TEST';

    afterEach(() => {
      // Clean up runtime state files
      cleanupContext(testParentId);
      cleanupContext('RUNTIME-TEST-2');
      cleanupContext('RUNTIME-CLEAR');
    });

    describe('initializeRuntimeState', () => {
      it('creates state with correct structure', () => {
        const state = initializeRuntimeState(testParentId, 'Test Parent Issue');

        expect(state.parentId).toBe(testParentId);
        expect(state.parentTitle).toBe('Test Parent Issue');
        expect(state.activeTasks).toEqual([]);
        expect(state.completedTasks).toEqual([]);
        expect(state.failedTasks).toEqual([]);
        expect(state.startedAt).toBeDefined();
        expect(state.updatedAt).toBeDefined();
        expect(state.loopPid).toBeUndefined();
        expect(state.totalTasks).toBeUndefined();
      });

      it('sets loopPid and totalTasks from options', () => {
        const state = initializeRuntimeState(testParentId, 'Test Issue', {
          loopPid: 12345,
          totalTasks: 5,
        });

        expect(state.loopPid).toBe(12345);
        expect(state.totalTasks).toBe(5);
      });

      it('writes state to runtime.json file', () => {
        initializeRuntimeState(testParentId, 'Test Issue');

        const runtimePath = getRuntimePath(testParentId);
        expect(existsSync(runtimePath)).toBe(true);

        const written = JSON.parse(readFileSync(runtimePath, 'utf-8'));
        expect(written.parentId).toBe(testParentId);
      });

      it('rebuilds backendStatuses from synced pending updates', () => {
        // Setup: write pending-updates.json with synced status changes
        const queue: PendingUpdatesQueue = {
          updates: [
            {
              id: 'update-1',
              type: 'status_change',
              issueId: 'issue-uuid-1',
              identifier: 'RUNTIME-TEST-1',
              oldStatus: 'pending',
              newStatus: 'In Progress',
              createdAt: '2024-01-15T10:00:00Z',
              syncedAt: '2024-01-15T10:01:00Z',
            },
            {
              id: 'update-2',
              type: 'status_change',
              issueId: 'issue-uuid-2',
              identifier: 'RUNTIME-TEST-2',
              oldStatus: 'In Progress',
              newStatus: 'Done',
              createdAt: '2024-01-15T11:00:00Z',
              syncedAt: '2024-01-15T11:01:00Z',
            },
          ],
        };
        writePendingUpdates(testParentId, queue);

        // Call initializeRuntimeState
        const state = initializeRuntimeState(testParentId, 'Rebuild Test');

        // Assert backendStatuses is populated with mapped TaskStatus values
        expect(state.backendStatuses).toBeDefined();
        expect(state.backendStatuses?.['RUNTIME-TEST-1']).toEqual({
          identifier: 'RUNTIME-TEST-1',
          status: 'in_progress', // Mapped from "In Progress"
          syncedAt: '2024-01-15T10:01:00Z',
        });
        expect(state.backendStatuses?.['RUNTIME-TEST-2']).toEqual({
          identifier: 'RUNTIME-TEST-2',
          status: 'done', // Mapped from "Done"
          syncedAt: '2024-01-15T11:01:00Z',
        });

        // Assert completedTasks includes tasks with "done" status
        expect(state.completedTasks).toContain('RUNTIME-TEST-2');
        expect(state.completedTasks).not.toContain('RUNTIME-TEST-1'); // in_progress, not done
      });

      it('keeps only the most recent synced status for each task', () => {
        // Setup: multiple status changes for same task, only synced ones count
        const queue: PendingUpdatesQueue = {
          updates: [
            {
              id: 'update-1',
              type: 'status_change',
              issueId: 'issue-uuid',
              identifier: 'RUNTIME-TEST-MULTI',
              oldStatus: 'pending',
              newStatus: 'In Progress',
              createdAt: '2024-01-15T10:00:00Z',
              syncedAt: '2024-01-15T10:01:00Z',
            },
            {
              id: 'update-2',
              type: 'status_change',
              issueId: 'issue-uuid',
              identifier: 'RUNTIME-TEST-MULTI',
              oldStatus: 'In Progress',
              newStatus: 'Done',
              createdAt: '2024-01-15T11:00:00Z',
              syncedAt: '2024-01-15T11:01:00Z', // More recent
            },
          ],
        };
        writePendingUpdates(testParentId, queue);

        const state = initializeRuntimeState(testParentId, 'Multi Status Test');

        // Should have the most recent status (mapped to TaskStatus)
        expect(state.backendStatuses?.['RUNTIME-TEST-MULTI'].status).toBe('done');
        expect(state.backendStatuses?.['RUNTIME-TEST-MULTI'].syncedAt).toBe('2024-01-15T11:01:00Z');

        // Should be in completedTasks since final status is done
        expect(state.completedTasks).toContain('RUNTIME-TEST-MULTI');
      });

      it('ignores unsynced pending updates', () => {
        // Setup: mix of synced and unsynced updates
        const queue: PendingUpdatesQueue = {
          updates: [
            {
              id: 'update-synced',
              type: 'status_change',
              issueId: 'issue-uuid-1',
              identifier: 'RUNTIME-TEST-SYNCED',
              oldStatus: 'pending',
              newStatus: 'Done',
              createdAt: '2024-01-15T10:00:00Z',
              syncedAt: '2024-01-15T10:01:00Z',
            },
            {
              id: 'update-pending',
              type: 'status_change',
              issueId: 'issue-uuid-2',
              identifier: 'RUNTIME-TEST-PENDING',
              oldStatus: 'pending',
              newStatus: 'In Progress',
              createdAt: '2024-01-15T11:00:00Z',
              // No syncedAt - not synced yet
            },
          ],
        };
        writePendingUpdates(testParentId, queue);

        const state = initializeRuntimeState(testParentId, 'Unsynced Test');

        // Only synced update should be in backendStatuses
        expect(state.backendStatuses?.['RUNTIME-TEST-SYNCED']).toBeDefined();
        expect(state.backendStatuses?.['RUNTIME-TEST-PENDING']).toBeUndefined();

        // completedTasks should include synced Done task
        expect(state.completedTasks).toContain('RUNTIME-TEST-SYNCED');
        expect(state.completedTasks).not.toContain('RUNTIME-TEST-PENDING');
      });

      it('returns undefined backendStatuses when no synced status updates exist', () => {
        // Setup: only non-status updates
        const queue: PendingUpdatesQueue = {
          updates: [
            {
              id: 'update-comment',
              type: 'add_comment',
              issueId: 'issue-uuid',
              identifier: 'RUNTIME-TEST-COMMENT',
              body: 'A comment',
              createdAt: '2024-01-15T10:00:00Z',
              syncedAt: '2024-01-15T10:01:00Z',
            },
          ],
        };
        writePendingUpdates(testParentId, queue);

        const state = initializeRuntimeState(testParentId, 'No Status Test');

        // Should be undefined since no status_change updates
        expect(state.backendStatuses).toBeUndefined();
        // completedTasks should be empty
        expect(state.completedTasks).toEqual([]);
      });
    });

    describe('readRuntimeState', () => {
      it('reads state from file', () => {
        const _original = initializeRuntimeState(testParentId, 'Test Issue', {
          loopPid: 999,
        });

        const read = readRuntimeState(testParentId);

        expect(read).not.toBeNull();
        expect(read?.parentId).toBe(testParentId);
        expect(read?.loopPid).toBe(999);
      });

      it('returns null when file does not exist', () => {
        const result = readRuntimeState('NONEXISTENT-RUNTIME');
        expect(result).toBeNull();
      });

      it('returns null for invalid JSON', () => {
        const executionPath = getExecutionPath(testParentId);
        mkdirSync(executionPath, { recursive: true });
        writeFileSync(getRuntimePath(testParentId), 'not valid json', 'utf-8');

        const result = readRuntimeState(testParentId);
        expect(result).toBeNull();
      });

      it('returns null for invalid state structure', () => {
        const executionPath = getExecutionPath(testParentId);
        mkdirSync(executionPath, { recursive: true });
        writeFileSync(
          getRuntimePath(testParentId),
          JSON.stringify({ invalid: 'structure' }),
          'utf-8'
        );

        const result = readRuntimeState(testParentId);
        expect(result).toBeNull();
      });
    });

    describe('writeRuntimeState', () => {
      it('writes state to runtime.json', () => {
        const state: RuntimeState = {
          parentId: testParentId,
          parentTitle: 'Write Test',
          activeTasks: [],
          completedTasks: [],
          failedTasks: [],
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        writeRuntimeState(state);

        const runtimePath = getRuntimePath(testParentId);
        expect(existsSync(runtimePath)).toBe(true);

        const written = JSON.parse(readFileSync(runtimePath, 'utf-8'));
        expect(written.parentTitle).toBe('Write Test');
      });

      it('updates the updatedAt timestamp', () => {
        const oldTimestamp = '2020-01-01T00:00:00Z';
        const state: RuntimeState = {
          parentId: testParentId,
          parentTitle: 'Timestamp Test',
          activeTasks: [],
          completedTasks: [],
          failedTasks: [],
          startedAt: oldTimestamp,
          updatedAt: oldTimestamp,
        };

        writeRuntimeState(state);

        const written = JSON.parse(readFileSync(getRuntimePath(testParentId), 'utf-8'));
        expect(written.updatedAt).not.toBe(oldTimestamp);
      });
    });

    describe('deleteRuntimeState', () => {
      it('removes runtime.json file', () => {
        initializeRuntimeState(testParentId, 'To Delete');
        expect(existsSync(getRuntimePath(testParentId))).toBe(true);

        const result = deleteRuntimeState(testParentId);

        expect(result).toBe(true);
        expect(existsSync(getRuntimePath(testParentId))).toBe(false);
      });

      it('returns false when file does not exist', () => {
        const result = deleteRuntimeState('NONEXISTENT-DELETE');
        expect(result).toBe(false);
      });
    });

    describe('updateBackendStatus', () => {
      it('adds backend status to runtime state with mapped TaskStatus', () => {
        initializeRuntimeState(testParentId, 'Backend Status Test');

        updateBackendStatus(testParentId, 'MOB-124', 'Done');

        const state = readRuntimeState(testParentId);
        expect(state?.backendStatuses).toBeDefined();
        expect(state?.backendStatuses?.['MOB-124']).toBeDefined();
        expect(state?.backendStatuses?.['MOB-124'].status).toBe('done'); // Mapped from "Done"
        expect(state?.backendStatuses?.['MOB-124'].identifier).toBe('MOB-124');
        expect(state?.backendStatuses?.['MOB-124'].syncedAt).toBeDefined();
      });

      it('updates existing backend status', () => {
        initializeRuntimeState(testParentId, 'Backend Status Update Test');

        updateBackendStatus(testParentId, 'MOB-125', 'In Progress');
        updateBackendStatus(testParentId, 'MOB-125', 'Done');

        const state = readRuntimeState(testParentId);
        expect(state?.backendStatuses?.['MOB-125'].status).toBe('done'); // Mapped from "Done"
      });

      it('preserves other backend statuses when updating one', () => {
        initializeRuntimeState(testParentId, 'Backend Status Preserve Test');

        updateBackendStatus(testParentId, 'MOB-126', 'Done');
        updateBackendStatus(testParentId, 'MOB-127', 'In Progress');
        updateBackendStatus(testParentId, 'MOB-126', 'Reopened');

        const state = readRuntimeState(testParentId);
        expect(state?.backendStatuses?.['MOB-126'].status).toBe('pending'); // "Reopened" maps to pending
        expect(state?.backendStatuses?.['MOB-127'].status).toBe('in_progress'); // Mapped from "In Progress"
      });

      it('does nothing if runtime state does not exist', () => {
        // Should not throw
        updateBackendStatus('NONEXISTENT-BACKEND', 'MOB-999', 'Done');

        const state = readRuntimeState('NONEXISTENT-BACKEND');
        expect(state).toBeNull();
      });
    });

    describe('addRuntimeActiveTask', () => {
      it('adds task to activeTasks', () => {
        const state = initializeRuntimeState(testParentId, 'Add Task Test');

        const task: RuntimeActiveTask = {
          id: 'TASK-1',
          pid: 1234,
          pane: '%0',
          startedAt: new Date().toISOString(),
        };

        const updated = addRuntimeActiveTask(state, task);

        expect(updated.activeTasks).toHaveLength(1);
        expect(updated.activeTasks[0].id).toBe('TASK-1');
        expect(updated.activeTasks[0].pid).toBe(1234);
      });

      it('preserves existing active tasks', () => {
        const state = initializeRuntimeState(testParentId, 'Preserve Test');

        const task1: RuntimeActiveTask = {
          id: 'TASK-1',
          pid: 1111,
          pane: '%0',
          startedAt: new Date().toISOString(),
        };

        const task2: RuntimeActiveTask = {
          id: 'TASK-2',
          pid: 2222,
          pane: '%1',
          startedAt: new Date().toISOString(),
        };

        let updated = addRuntimeActiveTask(state, task1);
        updated = addRuntimeActiveTask(updated, task2);

        expect(updated.activeTasks).toHaveLength(2);
        expect(updated.activeTasks[0].id).toBe('TASK-1');
        expect(updated.activeTasks[1].id).toBe('TASK-2');
      });
    });

    describe('completeRuntimeTask', () => {
      it('moves task to completedTasks with duration', () => {
        const state = initializeRuntimeState(testParentId, 'Complete Test');

        const task: RuntimeActiveTask = {
          id: 'TASK-1',
          pid: 1234,
          pane: '%0',
          startedAt: new Date(Date.now() - 5000).toISOString(), // 5 seconds ago
        };

        let updated = addRuntimeActiveTask(state, task);
        updated = completeRuntimeTask(updated, 'TASK-1');

        expect(updated.activeTasks).toHaveLength(0);
        expect(updated.completedTasks).toHaveLength(1);

        const completed = updated.completedTasks[0];
        expect(typeof completed).toBe('object');
        if (typeof completed === 'object') {
          expect(completed.id).toBe('TASK-1');
          expect(completed.duration).toBeGreaterThanOrEqual(0);
          expect(completed.completedAt).toBeDefined();
        }
      });

      it('removes task from activeTasks', () => {
        const state = initializeRuntimeState(testParentId, 'Remove Test');

        const task1: RuntimeActiveTask = {
          id: 'TASK-1',
          pid: 1111,
          pane: '%0',
          startedAt: new Date().toISOString(),
        };

        const task2: RuntimeActiveTask = {
          id: 'TASK-2',
          pid: 2222,
          pane: '%1',
          startedAt: new Date().toISOString(),
        };

        let updated = addRuntimeActiveTask(state, task1);
        updated = addRuntimeActiveTask(updated, task2);
        updated = completeRuntimeTask(updated, 'TASK-1');

        expect(updated.activeTasks).toHaveLength(1);
        expect(updated.activeTasks[0].id).toBe('TASK-2');
      });

      it('prevents duplicate entries in completedTasks', () => {
        const state = initializeRuntimeState(testParentId, 'Duplicate Prevention Test');

        const task: RuntimeActiveTask = {
          id: 'TASK-DUP',
          pid: 1234,
          pane: '%0',
          startedAt: new Date(Date.now() - 5000).toISOString(),
        };

        // Add and complete the task
        let updated = addRuntimeActiveTask(state, task);
        updated = completeRuntimeTask(updated, 'TASK-DUP');

        // Try to complete the same task again
        updated = completeRuntimeTask(updated, 'TASK-DUP');

        // Should still only have one entry
        expect(updated.completedTasks).toHaveLength(1);
        expect(updated.completedTasks[0]).toMatchObject({ id: 'TASK-DUP' });
      });

      it('prevents duplicates when task is already in completedTasks as string', () => {
        const state = initializeRuntimeState(testParentId, 'String Duplicate Test');

        // Manually set up state with a string-based completed task (legacy format)
        const stateWithStringCompleted: RuntimeState = {
          ...state,
          completedTasks: ['TASK-LEGACY'] as unknown as RuntimeState['completedTasks'],
        };

        // Try to complete the same task
        const updated = completeRuntimeTask(stateWithStringCompleted, 'TASK-LEGACY');

        // Should still only have one entry
        expect(updated.completedTasks).toHaveLength(1);
      });
    });

    describe('failRuntimeTask', () => {
      it('moves task to failedTasks', () => {
        const state = initializeRuntimeState(testParentId, 'Fail Test');

        const task: RuntimeActiveTask = {
          id: 'TASK-1',
          pid: 1234,
          pane: '%0',
          startedAt: new Date(Date.now() - 3000).toISOString(),
        };

        let updated = addRuntimeActiveTask(state, task);
        updated = failRuntimeTask(updated, 'TASK-1');

        expect(updated.activeTasks).toHaveLength(0);
        expect(updated.failedTasks).toHaveLength(1);

        const failed = updated.failedTasks[0];
        expect(typeof failed).toBe('object');
        if (typeof failed === 'object') {
          expect(failed.id).toBe('TASK-1');
          expect(failed.duration).toBeGreaterThanOrEqual(0);
        }
      });
    });

    describe('removeRuntimeActiveTask', () => {
      it('removes without marking complete/failed', () => {
        const state = initializeRuntimeState(testParentId, 'Remove Only Test');

        const task: RuntimeActiveTask = {
          id: 'TASK-1',
          pid: 1234,
          pane: '%0',
          startedAt: new Date().toISOString(),
        };

        let updated = addRuntimeActiveTask(state, task);
        updated = removeRuntimeActiveTask(updated, 'TASK-1');

        expect(updated.activeTasks).toHaveLength(0);
        expect(updated.completedTasks).toHaveLength(0);
        expect(updated.failedTasks).toHaveLength(0);
      });
    });

    describe('updateRuntimeTaskPane', () => {
      it('updates pane ID for active task', () => {
        const state = initializeRuntimeState(testParentId, 'Pane Update Test');

        const task: RuntimeActiveTask = {
          id: 'TASK-1',
          pid: 1234,
          pane: '%0',
          startedAt: new Date().toISOString(),
        };

        let updated = addRuntimeActiveTask(state, task);
        updated = updateRuntimeTaskPane(updated, 'TASK-1', '%5');

        expect(updated.activeTasks[0].pane).toBe('%5');
      });

      it('does not affect other tasks', () => {
        const state = initializeRuntimeState(testParentId, 'Other Tasks Test');

        const task1: RuntimeActiveTask = {
          id: 'TASK-1',
          pid: 1111,
          pane: '%0',
          startedAt: new Date().toISOString(),
        };

        const task2: RuntimeActiveTask = {
          id: 'TASK-2',
          pid: 2222,
          pane: '%1',
          startedAt: new Date().toISOString(),
        };

        let updated = addRuntimeActiveTask(state, task1);
        updated = addRuntimeActiveTask(updated, task2);
        updated = updateRuntimeTaskPane(updated, 'TASK-1', '%10');

        expect(updated.activeTasks[0].pane).toBe('%10');
        expect(updated.activeTasks[1].pane).toBe('%1');
      });
    });

    describe('clearAllRuntimeActiveTasks', () => {
      it('removes all active tasks', () => {
        const parentId = 'RUNTIME-CLEAR';
        const state = initializeRuntimeState(parentId, 'Clear Test');

        const task1: RuntimeActiveTask = {
          id: 'TASK-1',
          pid: 1111,
          pane: '%0',
          startedAt: new Date().toISOString(),
        };

        const task2: RuntimeActiveTask = {
          id: 'TASK-2',
          pid: 2222,
          pane: '%1',
          startedAt: new Date().toISOString(),
        };

        addRuntimeActiveTask(state, task1);
        addRuntimeActiveTask(state, task2);

        const cleared = clearAllRuntimeActiveTasks(parentId);

        expect(cleared).not.toBeNull();
        expect(cleared?.activeTasks).toHaveLength(0);
      });

      it('returns null when no state exists', () => {
        const result = clearAllRuntimeActiveTasks('NONEXISTENT-CLEAR');
        expect(result).toBeNull();
      });
    });

    describe('getProgressSummary', () => {
      it('returns correct metrics', () => {
        const state = initializeRuntimeState(testParentId, 'Progress Test');

        const task1: RuntimeActiveTask = {
          id: 'TASK-1',
          pid: 1111,
          pane: '%0',
          startedAt: new Date().toISOString(),
        };

        let updated = addRuntimeActiveTask(state, task1);
        updated = completeRuntimeTask(updated, 'TASK-1');

        const task2: RuntimeActiveTask = {
          id: 'TASK-2',
          pid: 2222,
          pane: '%1',
          startedAt: new Date().toISOString(),
        };

        updated = addRuntimeActiveTask(updated, task2);

        const summary = getProgressSummary(updated);

        expect(summary.completed).toBe(1);
        expect(summary.active).toBe(1);
        expect(summary.failed).toBe(0);
        expect(summary.total).toBe(2);
        expect(summary.isComplete).toBe(false);
      });

      it('returns zeros for null state', () => {
        const summary = getProgressSummary(null);

        expect(summary.completed).toBe(0);
        expect(summary.failed).toBe(0);
        expect(summary.active).toBe(0);
        expect(summary.total).toBe(0);
        expect(summary.isComplete).toBe(false);
      });

      it('isComplete is true when no active tasks and some completed', () => {
        const state = initializeRuntimeState(testParentId, 'Complete Check');

        const task: RuntimeActiveTask = {
          id: 'TASK-1',
          pid: 1111,
          pane: '%0',
          startedAt: new Date().toISOString(),
        };

        let updated = addRuntimeActiveTask(state, task);
        updated = completeRuntimeTask(updated, 'TASK-1');

        const summary = getProgressSummary(updated);
        expect(summary.isComplete).toBe(true);
      });
    });

    describe('getModalSummary', () => {
      it('returns formatted summary with elapsed time', () => {
        const state = initializeRuntimeState(testParentId, 'Modal Test');

        const summary = getModalSummary(state, 5000);

        expect(summary.elapsedMs).toBe(5000);
        expect(summary.completed).toBe(0);
        expect(summary.active).toBe(0);
        expect(summary.failed).toBe(0);
      });
    });
  });

  describe('Session Management', () => {
    const testParentId = 'SESSION-TEST';

    afterEach(() => {
      // Clean up session files
      cleanupContext(testParentId);
      cleanupContext('SESSION-TEST-2');
      cleanupContext('SESSION-RESOLVE');

      // Clean up current session pointer
      const pointerPath = getCurrentSessionPointerPath();
      if (existsSync(pointerPath)) {
        try {
          unlinkSync(pointerPath);
        } catch {
          // Ignore errors
        }
      }
    });

    describe('createSession', () => {
      it('creates new session file', () => {
        const session = createSession(testParentId, 'linear', '/path/to/worktree');

        expect(session.parentId).toBe(testParentId);
        expect(session.backend).toBe('linear');
        expect(session.worktreePath).toBe('/path/to/worktree');
        expect(session.status).toBe('active');
        expect(session.startedAt).toBeDefined();

        // Verify file was created
        expect(existsSync(getSessionPath(testParentId))).toBe(true);
      });

      it('sets current session pointer', () => {
        createSession(testParentId, 'jira');

        const currentId = getCurrentSessionParentId();
        expect(currentId).toBe(testParentId);
      });
    });

    describe('readSession', () => {
      it('returns session data', () => {
        createSession(testParentId, 'linear');

        const session = readSession(testParentId);

        expect(session).not.toBeNull();
        expect(session?.parentId).toBe(testParentId);
        expect(session?.backend).toBe('linear');
      });

      it('returns null when file does not exist', () => {
        const session = readSession('NONEXISTENT-SESSION');
        expect(session).toBeNull();
      });

      it('returns null for invalid JSON', () => {
        const executionPath = getExecutionPath(testParentId);
        mkdirSync(executionPath, { recursive: true });
        writeFileSync(getSessionPath(testParentId), 'invalid json', 'utf-8');

        const session = readSession(testParentId);
        expect(session).toBeNull();
      });
    });

    describe('writeSession', () => {
      it('writes session to file', () => {
        const session: SessionInfo = {
          parentId: testParentId,
          backend: 'jira',
          startedAt: new Date().toISOString(),
          status: 'active',
        };

        writeSession(testParentId, session);

        const read = readSession(testParentId);
        expect(read).not.toBeNull();
        expect(read?.backend).toBe('jira');
      });
    });

    describe('updateSession', () => {
      it('modifies existing session', () => {
        createSession(testParentId, 'linear');

        const updated = updateSession(testParentId, {
          worktreePath: '/new/worktree',
          status: 'paused',
        });

        expect(updated).not.toBeNull();
        expect(updated?.worktreePath).toBe('/new/worktree');
        expect(updated?.status).toBe('paused');
        expect(updated?.backend).toBe('linear'); // Preserved
      });

      it('returns null when session does not exist', () => {
        const result = updateSession('NONEXISTENT-UPDATE', { status: 'completed' });
        expect(result).toBeNull();
      });
    });

    describe('endSession', () => {
      it('sets status to completed', () => {
        createSession(testParentId, 'linear');

        endSession(testParentId, 'completed');

        const session = readSession(testParentId);
        expect(session?.status).toBe('completed');
      });

      it('sets status to failed', () => {
        createSession(testParentId, 'linear');

        endSession(testParentId, 'failed');

        const session = readSession(testParentId);
        expect(session?.status).toBe('failed');
      });

      it('clears current session pointer', () => {
        createSession(testParentId, 'linear');
        expect(getCurrentSessionParentId()).toBe(testParentId);

        endSession(testParentId, 'completed');

        expect(getCurrentSessionParentId()).toBeNull();
      });
    });

    describe('deleteSession', () => {
      it('removes session file', () => {
        createSession(testParentId, 'linear');
        expect(existsSync(getSessionPath(testParentId))).toBe(true);

        deleteSession(testParentId);

        expect(existsSync(getSessionPath(testParentId))).toBe(false);
      });

      it('clears current session pointer', () => {
        createSession(testParentId, 'linear');

        deleteSession(testParentId);

        expect(getCurrentSessionParentId()).toBeNull();
      });

      it('handles non-existent session gracefully', () => {
        expect(() => deleteSession('NONEXISTENT-DELETE')).not.toThrow();
      });
    });

    describe('setCurrentSessionPointer', () => {
      it('writes pointer file', () => {
        setCurrentSessionPointer(testParentId);

        const pointerPath = getCurrentSessionPointerPath();
        expect(existsSync(pointerPath)).toBe(true);

        const content = readFileSync(pointerPath, 'utf-8');
        expect(content).toBe(testParentId);
      });
    });

    describe('getCurrentSessionParentId', () => {
      it('reads from pointer', () => {
        createSession(testParentId, 'linear');
        setCurrentSessionPointer(testParentId);

        const result = getCurrentSessionParentId();
        expect(result).toBe(testParentId);
      });

      it('returns null when no pointer exists', () => {
        const pointerPath = getCurrentSessionPointerPath();
        if (existsSync(pointerPath)) {
          unlinkSync(pointerPath);
        }

        const result = getCurrentSessionParentId();
        expect(result).toBeNull();
      });

      it('returns null when pointed session does not exist', () => {
        setCurrentSessionPointer('GHOST-SESSION');

        const result = getCurrentSessionParentId();
        expect(result).toBeNull();
      });
    });

    describe('clearCurrentSessionPointer', () => {
      it('removes pointer file when matching', () => {
        createSession(testParentId, 'linear');

        clearCurrentSessionPointer(testParentId);

        expect(getCurrentSessionParentId()).toBeNull();
      });

      it('does not remove pointer for different session', () => {
        createSession(testParentId, 'linear');
        createSession('SESSION-TEST-2', 'jira');
        setCurrentSessionPointer('SESSION-TEST-2');

        clearCurrentSessionPointer(testParentId);

        // Pointer should still point to SESSION-TEST-2
        expect(getCurrentSessionParentId()).toBe('SESSION-TEST-2');
      });
    });

    describe('resolveTaskId', () => {
      it('returns provided taskId when given', () => {
        const result = resolveTaskId('PROVIDED-ID');
        expect(result).toBe('PROVIDED-ID');
      });

      it('falls back to current session', () => {
        createSession(testParentId, 'linear');

        const result = resolveTaskId();
        expect(result).toBe(testParentId);
      });

      it('returns null when no taskId and no session', () => {
        const pointerPath = getCurrentSessionPointerPath();
        if (existsSync(pointerPath)) {
          unlinkSync(pointerPath);
        }

        const result = resolveTaskId();
        expect(result).toBeNull();
      });
    });

    describe('resolveTaskContext', () => {
      it('returns taskId and provided backend', () => {
        const result = resolveTaskContext('TASK-123', 'jira');

        expect(result.taskId).toBe('TASK-123');
        expect(result.backend).toBe('jira');
      });

      it('gets backend from session when not provided', () => {
        const parentId = 'SESSION-RESOLVE';
        createSession(parentId, 'linear');

        const result = resolveTaskContext(parentId);

        expect(result.taskId).toBe(parentId);
        expect(result.backend).toBe('linear');
      });

      it('returns undefined backend when no session', () => {
        const result = resolveTaskContext('TASK-NO-SESSION');

        expect(result.taskId).toBe('TASK-NO-SESSION');
        expect(result.backend).toBeUndefined();
      });
    });
  });
});
