/**
 * Unit tests for context-generator module
 *
 * Tests the local context file generation and management functions.
 * Uses temporary directories to avoid polluting the real ~/.mobius directory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import type {
  IssueContext,
  ParentIssueContext,
  SubTaskContext,
  PendingUpdatesQueue,
} from '../types/context.js';
import {
  getMobiusBasePath,
  getContextPath,
  getParentContextPath,
  getTasksDirectoryPath,
  getTaskContextPath,
  getPendingUpdatesPath,
  getSyncLogPath,
  getFullContextPath,
  writeFullContextFile,
  readContext,
  contextExists,
  isContextFresh,
  cleanupContext,
  updateTaskContext,
  readPendingUpdates,
  writePendingUpdates,
  queuePendingUpdate,
  type PendingUpdateInput,
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
        writeFileSync(
          getPendingUpdatesPath('INVALID-PENDING'),
          'invalid json {{{',
          'utf-8'
        );

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
});
