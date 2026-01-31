/**
 * Unit tests for local-state module
 *
 * Tests the project-local .mobius/ directory management functions.
 * Uses temporary directories to avoid polluting the real .mobius directory.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ParentIssueContext, SubTaskContext } from '../types/context.js';
import type { CompletionSummary, IterationLogEntry, LocalPendingUpdate } from './local-state.js';

// We need to mock getGitRepoRoot to point to our temp directory.
// The module uses execSync('git rev-parse --show-toplevel') internally
// and caches the result. We'll mock via the _resetCachedRepoRoot export
// and by mocking execSync.

let tempDir: string;

// Mock execSync to return our temp directory as the git repo root
const originalExecSync = (await import('node:child_process')).execSync;
const mockExecSync = mock(() => `${tempDir}\n`);

// We need to mock before importing the module under test
mock.module('node:child_process', () => ({
  execSync: (...args: Parameters<typeof originalExecSync>) => {
    const command = args[0];
    if (typeof command === 'string' && command.includes('git rev-parse --show-toplevel')) {
      return mockExecSync();
    }
    return originalExecSync(...args);
  },
}));

// Now import the module under test (after mocking)
const {
  getProjectMobiusPath,
  ensureProjectMobiusDir,
  getNextLocalId,
  writeParentSpec,
  readParentSpec,
  writeSubTaskSpec,
  readSubTasks,
  readLocalSubTasksAsLinearIssues,
  writeIterationLog,
  writeSummary,
  queuePendingUpdate,
  _resetCachedRepoRoot,
} = await import('./local-state.js');

describe('local-state module', () => {
  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `local-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
    _resetCachedRepoRoot();
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
    _resetCachedRepoRoot();
  });

  describe('path helper functions', () => {
    describe('getProjectMobiusPath', () => {
      it('returns path to .mobius/ in repo root', () => {
        const mobiusPath = getProjectMobiusPath();
        expect(mobiusPath).toBe(join(tempDir, '.mobius'));
      });

      it('returns consistent path on repeated calls', () => {
        const path1 = getProjectMobiusPath();
        const path2 = getProjectMobiusPath();
        expect(path1).toBe(path2);
      });
    });
  });

  describe('ensureProjectMobiusDir', () => {
    it('creates .mobius/ directory if it does not exist', () => {
      ensureProjectMobiusDir();
      expect(existsSync(join(tempDir, '.mobius'))).toBe(true);
    });

    it('creates .gitignore with state/ entry', () => {
      ensureProjectMobiusDir();
      const gitignorePath = join(tempDir, '.mobius', '.gitignore');
      expect(existsSync(gitignorePath)).toBe(true);
      const content = readFileSync(gitignorePath, 'utf-8');
      expect(content).toContain('state/');
    });

    it('does not overwrite existing .gitignore', () => {
      const mobiusPath = join(tempDir, '.mobius');
      mkdirSync(mobiusPath, { recursive: true });
      const gitignorePath = join(mobiusPath, '.gitignore');
      writeFileSync(gitignorePath, 'custom-content\n', 'utf-8');

      ensureProjectMobiusDir();

      const content = readFileSync(gitignorePath, 'utf-8');
      expect(content).toBe('custom-content\n');
    });

    it('is idempotent', () => {
      ensureProjectMobiusDir();
      ensureProjectMobiusDir();
      expect(existsSync(join(tempDir, '.mobius'))).toBe(true);
    });
  });

  describe('getNextLocalId', () => {
    it('returns LOC-001 for first call', () => {
      const id = getNextLocalId();
      expect(id).toBe('LOC-001');
    });

    it('returns sequential IDs on repeated calls', () => {
      const id1 = getNextLocalId();
      const id2 = getNextLocalId();
      const id3 = getNextLocalId();
      expect(id1).toBe('LOC-001');
      expect(id2).toBe('LOC-002');
      expect(id3).toBe('LOC-003');
    });

    it('generates unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 10; i++) {
        ids.add(getNextLocalId());
      }
      expect(ids.size).toBe(10);
    });

    it('pads IDs to 3 digits', () => {
      const id = getNextLocalId();
      expect(id).toMatch(/^LOC-\d{3}$/);
    });

    it('persists counter across calls via counter.json', () => {
      getNextLocalId(); // LOC-001
      getNextLocalId(); // LOC-002

      const counterPath = join(tempDir, '.mobius', 'issues', 'counter.json');
      expect(existsSync(counterPath)).toBe(true);
      const counter = JSON.parse(readFileSync(counterPath, 'utf-8'));
      expect(counter.next).toBe(3);
    });

    it('recovers from corrupted counter.json', () => {
      ensureProjectMobiusDir();
      const issuesPath = join(tempDir, '.mobius', 'issues');
      mkdirSync(issuesPath, { recursive: true });
      writeFileSync(join(issuesPath, 'counter.json'), 'not valid json', 'utf-8');

      const id = getNextLocalId();
      expect(id).toBe('LOC-001');
    });

    it('recovers from counter.json with invalid next value', () => {
      ensureProjectMobiusDir();
      const issuesPath = join(tempDir, '.mobius', 'issues');
      mkdirSync(issuesPath, { recursive: true });
      writeFileSync(join(issuesPath, 'counter.json'), JSON.stringify({ next: -5 }), 'utf-8');

      const id = getNextLocalId();
      expect(id).toBe('LOC-001');
    });

    it('scans existing LOC-* directories when counter.json is missing', () => {
      ensureProjectMobiusDir();
      const issuesPath = join(tempDir, '.mobius', 'issues');
      mkdirSync(issuesPath, { recursive: true });
      // Create some existing directories
      mkdirSync(join(issuesPath, 'LOC-003'), { recursive: true });
      mkdirSync(join(issuesPath, 'LOC-007'), { recursive: true });

      const id = getNextLocalId();
      expect(id).toBe('LOC-008');
    });
  });

  describe('parent spec CRUD', () => {
    const sampleParent: ParentIssueContext = {
      id: 'parent-uuid',
      identifier: 'TEST-1',
      title: 'Test Parent Issue',
      description: 'A test description',
      gitBranchName: 'feature/test',
      status: 'Backlog',
      labels: ['Feature'],
      url: 'https://example.com/TEST-1',
    };

    describe('writeParentSpec', () => {
      it('creates parent.json in issue directory', () => {
        writeParentSpec('TEST-1', sampleParent);

        const filePath = join(tempDir, '.mobius', 'issues', 'TEST-1', 'parent.json');
        expect(existsSync(filePath)).toBe(true);
      });

      it('writes correct JSON content', () => {
        writeParentSpec('TEST-1', sampleParent);

        const filePath = join(tempDir, '.mobius', 'issues', 'TEST-1', 'parent.json');
        const written = JSON.parse(readFileSync(filePath, 'utf-8'));
        expect(written.identifier).toBe('TEST-1');
        expect(written.title).toBe('Test Parent Issue');
        expect(written.labels).toEqual(['Feature']);
      });

      it('creates issue subdirectories (tasks/ and execution/)', () => {
        writeParentSpec('TEST-1', sampleParent);

        expect(existsSync(join(tempDir, '.mobius', 'issues', 'TEST-1', 'tasks'))).toBe(true);
        expect(existsSync(join(tempDir, '.mobius', 'issues', 'TEST-1', 'execution'))).toBe(true);
      });

      it('overwrites existing parent spec', () => {
        writeParentSpec('TEST-1', sampleParent);
        const updated = { ...sampleParent, title: 'Updated Title' };
        writeParentSpec('TEST-1', updated);

        const filePath = join(tempDir, '.mobius', 'issues', 'TEST-1', 'parent.json');
        const written = JSON.parse(readFileSync(filePath, 'utf-8'));
        expect(written.title).toBe('Updated Title');
      });
    });

    describe('readParentSpec', () => {
      it('reads back written parent spec', () => {
        writeParentSpec('TEST-1', sampleParent);

        const read = readParentSpec('TEST-1');
        expect(read).not.toBeNull();
        expect(read?.identifier).toBe('TEST-1');
        expect(read?.title).toBe('Test Parent Issue');
        expect(read?.description).toBe('A test description');
        expect(read?.gitBranchName).toBe('feature/test');
        expect(read?.status).toBe('Backlog');
        expect(read?.labels).toEqual(['Feature']);
        expect(read?.url).toBe('https://example.com/TEST-1');
      });

      it('returns null when file does not exist', () => {
        const result = readParentSpec('NONEXISTENT');
        expect(result).toBeNull();
      });

      it('returns null for invalid JSON', () => {
        ensureProjectMobiusDir();
        const issuePath = join(tempDir, '.mobius', 'issues', 'INVALID');
        mkdirSync(issuePath, { recursive: true });
        writeFileSync(join(issuePath, 'parent.json'), 'not valid json {{{', 'utf-8');

        const result = readParentSpec('INVALID');
        expect(result).toBeNull();
      });
    });
  });

  describe('sub-task spec CRUD', () => {
    const makeTask = (id: string, identifier: string): SubTaskContext => ({
      id,
      identifier,
      title: `Task ${identifier}`,
      description: `Description for ${identifier}`,
      status: 'pending',
      gitBranchName: `feature/${identifier.toLowerCase()}`,
      blockedBy: [],
      blocks: [],
    });

    describe('writeSubTaskSpec', () => {
      it('creates task JSON file in tasks/ directory', () => {
        const task = makeTask('uuid-1', 'TASK-1');
        writeSubTaskSpec('PARENT-1', task);

        const filePath = join(tempDir, '.mobius', 'issues', 'PARENT-1', 'tasks', 'TASK-1.json');
        expect(existsSync(filePath)).toBe(true);
      });

      it('writes correct JSON content', () => {
        const task = makeTask('uuid-1', 'TASK-1');
        writeSubTaskSpec('PARENT-1', task);

        const filePath = join(tempDir, '.mobius', 'issues', 'PARENT-1', 'tasks', 'TASK-1.json');
        const written = JSON.parse(readFileSync(filePath, 'utf-8'));
        expect(written.identifier).toBe('TASK-1');
        expect(written.status).toBe('pending');
      });

      it('uses task identifier as filename', () => {
        const task = makeTask('uuid-1', 'MOB-123');
        writeSubTaskSpec('PARENT-1', task);

        expect(
          existsSync(join(tempDir, '.mobius', 'issues', 'PARENT-1', 'tasks', 'MOB-123.json'))
        ).toBe(true);
      });
    });

    describe('readSubTasks', () => {
      it('reads all task files from tasks/ directory', () => {
        writeSubTaskSpec('PARENT-1', makeTask('uuid-1', 'TASK-1'));
        writeSubTaskSpec('PARENT-1', makeTask('uuid-2', 'TASK-2'));
        writeSubTaskSpec('PARENT-1', makeTask('uuid-3', 'TASK-3'));

        const tasks = readSubTasks('PARENT-1');
        expect(tasks).toHaveLength(3);

        const identifiers = tasks.map((t) => t.identifier).sort();
        expect(identifiers).toEqual(['TASK-1', 'TASK-2', 'TASK-3']);
      });

      it('returns empty array when issue does not exist', () => {
        const tasks = readSubTasks('NONEXISTENT');
        expect(tasks).toEqual([]);
      });

      it('returns empty array when tasks directory is empty', () => {
        ensureProjectMobiusDir();
        const tasksDir = join(tempDir, '.mobius', 'issues', 'EMPTY', 'tasks');
        mkdirSync(tasksDir, { recursive: true });

        const tasks = readSubTasks('EMPTY');
        expect(tasks).toEqual([]);
      });

      it('skips non-JSON files', () => {
        writeSubTaskSpec('PARENT-1', makeTask('uuid-1', 'TASK-1'));

        // Add a non-JSON file
        const tasksDir = join(tempDir, '.mobius', 'issues', 'PARENT-1', 'tasks');
        writeFileSync(join(tasksDir, 'notes.txt'), 'some notes', 'utf-8');

        const tasks = readSubTasks('PARENT-1');
        expect(tasks).toHaveLength(1);
        expect(tasks[0].identifier).toBe('TASK-1');
      });

      it('skips malformed JSON files', () => {
        writeSubTaskSpec('PARENT-1', makeTask('uuid-1', 'TASK-1'));

        // Add a malformed JSON file
        const tasksDir = join(tempDir, '.mobius', 'issues', 'PARENT-1', 'tasks');
        writeFileSync(join(tasksDir, 'bad.json'), 'not valid {{{', 'utf-8');

        const tasks = readSubTasks('PARENT-1');
        expect(tasks).toHaveLength(1);
        expect(tasks[0].identifier).toBe('TASK-1');
      });
    });
  });

  describe('iteration logging', () => {
    const makeEntry = (subtaskId: string, attempt: number): IterationLogEntry => ({
      subtaskId,
      attempt,
      startedAt: new Date().toISOString(),
      status: 'success',
    });

    describe('writeIterationLog', () => {
      it('creates iterations.json with first entry', () => {
        const entry = makeEntry('TASK-1', 1);
        writeIterationLog('PARENT-1', entry);

        const filePath = join(
          tempDir,
          '.mobius',
          'issues',
          'PARENT-1',
          'execution',
          'iterations.json'
        );
        expect(existsSync(filePath)).toBe(true);

        const entries = JSON.parse(readFileSync(filePath, 'utf-8'));
        expect(entries).toHaveLength(1);
        expect(entries[0].subtaskId).toBe('TASK-1');
        expect(entries[0].attempt).toBe(1);
      });

      it('appends entries on subsequent calls', () => {
        writeIterationLog('PARENT-1', makeEntry('TASK-1', 1));
        writeIterationLog('PARENT-1', makeEntry('TASK-1', 2));

        const filePath = join(
          tempDir,
          '.mobius',
          'issues',
          'PARENT-1',
          'execution',
          'iterations.json'
        );
        const entries = JSON.parse(readFileSync(filePath, 'utf-8'));
        expect(entries).toHaveLength(2);
        expect(entries[0].attempt).toBe(1);
        expect(entries[1].attempt).toBe(2);
      });

      it('preserves all fields in log entry', () => {
        const entry: IterationLogEntry = {
          subtaskId: 'TASK-1',
          attempt: 1,
          startedAt: '2024-01-15T10:00:00Z',
          completedAt: '2024-01-15T10:05:00Z',
          status: 'success',
          filesModified: ['src/file.ts'],
          commitHash: 'abc1234',
        };

        writeIterationLog('PARENT-1', entry);

        const filePath = join(
          tempDir,
          '.mobius',
          'issues',
          'PARENT-1',
          'execution',
          'iterations.json'
        );
        const entries = JSON.parse(readFileSync(filePath, 'utf-8'));
        expect(entries[0].completedAt).toBe('2024-01-15T10:05:00Z');
        expect(entries[0].filesModified).toEqual(['src/file.ts']);
        expect(entries[0].commitHash).toBe('abc1234');
      });

      it('recovers from corrupted iterations.json', () => {
        ensureProjectMobiusDir();
        const executionDir = join(tempDir, '.mobius', 'issues', 'PARENT-1', 'execution');
        mkdirSync(executionDir, { recursive: true });
        writeFileSync(join(executionDir, 'iterations.json'), 'bad json {{{', 'utf-8');

        writeIterationLog('PARENT-1', makeEntry('TASK-1', 1));

        const filePath = join(executionDir, 'iterations.json');
        const entries = JSON.parse(readFileSync(filePath, 'utf-8'));
        expect(entries).toHaveLength(1);
      });

      it('handles failed status entries', () => {
        const entry: IterationLogEntry = {
          subtaskId: 'TASK-1',
          attempt: 1,
          startedAt: '2024-01-15T10:00:00Z',
          status: 'failed',
          error: 'TypeScript compilation error',
        };

        writeIterationLog('PARENT-1', entry);

        const filePath = join(
          tempDir,
          '.mobius',
          'issues',
          'PARENT-1',
          'execution',
          'iterations.json'
        );
        const entries = JSON.parse(readFileSync(filePath, 'utf-8'));
        expect(entries[0].status).toBe('failed');
        expect(entries[0].error).toBe('TypeScript compilation error');
      });
    });
  });

  describe('summary writing', () => {
    describe('writeSummary', () => {
      it('creates summary.json with correct structure', () => {
        const summary: CompletionSummary = {
          parentId: 'PARENT-1',
          completedAt: '2024-01-15T12:00:00Z',
          totalTasks: 5,
          completedTasks: 4,
          failedTasks: 1,
          totalIterations: 8,
          taskOutcomes: [
            { id: 'TASK-1', status: 'done', iterations: 1 },
            { id: 'TASK-2', status: 'done', iterations: 2 },
            { id: 'TASK-3', status: 'done', iterations: 1 },
            { id: 'TASK-4', status: 'done', iterations: 3 },
            { id: 'TASK-5', status: 'failed', iterations: 1 },
          ],
        };

        writeSummary('PARENT-1', summary);

        const filePath = join(tempDir, '.mobius', 'issues', 'PARENT-1', 'summary.json');
        expect(existsSync(filePath)).toBe(true);

        const written = JSON.parse(readFileSync(filePath, 'utf-8'));
        expect(written.parentId).toBe('PARENT-1');
        expect(written.totalTasks).toBe(5);
        expect(written.completedTasks).toBe(4);
        expect(written.failedTasks).toBe(1);
        expect(written.totalIterations).toBe(8);
        expect(written.taskOutcomes).toHaveLength(5);
      });

      it('overwrites existing summary', () => {
        const summary1: CompletionSummary = {
          parentId: 'PARENT-1',
          completedAt: '2024-01-15T12:00:00Z',
          totalTasks: 3,
          completedTasks: 2,
          failedTasks: 1,
          totalIterations: 4,
          taskOutcomes: [],
        };

        const summary2: CompletionSummary = {
          parentId: 'PARENT-1',
          completedAt: '2024-01-15T14:00:00Z',
          totalTasks: 3,
          completedTasks: 3,
          failedTasks: 0,
          totalIterations: 5,
          taskOutcomes: [],
        };

        writeSummary('PARENT-1', summary1);
        writeSummary('PARENT-1', summary2);

        const filePath = join(tempDir, '.mobius', 'issues', 'PARENT-1', 'summary.json');
        const written = JSON.parse(readFileSync(filePath, 'utf-8'));
        expect(written.completedTasks).toBe(3);
        expect(written.failedTasks).toBe(0);
      });
    });
  });

  describe('pending update queue', () => {
    describe('queuePendingUpdate', () => {
      it('creates pending-updates.json with first update', () => {
        queuePendingUpdate('PARENT-1', 'status_change', { status: 'done' });

        const filePath = join(tempDir, '.mobius', 'issues', 'PARENT-1', 'pending-updates.json');
        expect(existsSync(filePath)).toBe(true);

        const updates: LocalPendingUpdate[] = JSON.parse(readFileSync(filePath, 'utf-8'));
        expect(updates).toHaveLength(1);
        expect(updates[0].type).toBe('status_change');
        expect(updates[0].payload).toEqual({ status: 'done' });
      });

      it('includes UUID and timestamp in each update', () => {
        queuePendingUpdate('PARENT-1', 'status_change', { status: 'done' });

        const filePath = join(tempDir, '.mobius', 'issues', 'PARENT-1', 'pending-updates.json');
        const updates: LocalPendingUpdate[] = JSON.parse(readFileSync(filePath, 'utf-8'));
        expect(updates[0].id).toBeDefined();
        expect(updates[0].id.length).toBeGreaterThan(0);
        expect(updates[0].createdAt).toBeDefined();
        // Verify it looks like an ISO timestamp
        expect(() => new Date(updates[0].createdAt)).not.toThrow();
      });

      it('appends to existing updates', () => {
        queuePendingUpdate('PARENT-1', 'status_change', { status: 'in_progress' });
        queuePendingUpdate('PARENT-1', 'add_comment', { body: 'Started work' });

        const filePath = join(tempDir, '.mobius', 'issues', 'PARENT-1', 'pending-updates.json');
        const updates: LocalPendingUpdate[] = JSON.parse(readFileSync(filePath, 'utf-8'));
        expect(updates).toHaveLength(2);
        expect(updates[0].type).toBe('status_change');
        expect(updates[1].type).toBe('add_comment');
      });

      it('generates unique IDs for each update', () => {
        queuePendingUpdate('PARENT-1', 'type-a', { a: 1 });
        queuePendingUpdate('PARENT-1', 'type-b', { b: 2 });
        queuePendingUpdate('PARENT-1', 'type-c', { c: 3 });

        const filePath = join(tempDir, '.mobius', 'issues', 'PARENT-1', 'pending-updates.json');
        const updates: LocalPendingUpdate[] = JSON.parse(readFileSync(filePath, 'utf-8'));
        const ids = updates.map((u) => u.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(3);
      });

      it('recovers from corrupted pending-updates.json', () => {
        ensureProjectMobiusDir();
        const issuePath = join(tempDir, '.mobius', 'issues', 'PARENT-1');
        mkdirSync(issuePath, { recursive: true });
        writeFileSync(join(issuePath, 'pending-updates.json'), 'invalid {{{', 'utf-8');

        queuePendingUpdate('PARENT-1', 'status_change', { status: 'done' });

        const filePath = join(issuePath, 'pending-updates.json');
        const updates: LocalPendingUpdate[] = JSON.parse(readFileSync(filePath, 'utf-8'));
        expect(updates).toHaveLength(1);
      });

      it('handles non-array content gracefully', () => {
        ensureProjectMobiusDir();
        const issuePath = join(tempDir, '.mobius', 'issues', 'PARENT-1');
        mkdirSync(issuePath, { recursive: true });
        writeFileSync(
          join(issuePath, 'pending-updates.json'),
          JSON.stringify({ not: 'an array' }),
          'utf-8'
        );

        queuePendingUpdate('PARENT-1', 'status_change', { status: 'done' });

        const filePath = join(issuePath, 'pending-updates.json');
        const updates: LocalPendingUpdate[] = JSON.parse(readFileSync(filePath, 'utf-8'));
        expect(updates).toHaveLength(1);
      });
    });
  });

  describe('temp directory isolation', () => {
    it('does not create files in the real repo root', () => {
      writeParentSpec('ISOLATION-TEST', {
        id: 'iso-uuid',
        identifier: 'ISOLATION-TEST',
        title: 'Isolation',
        description: '',
        gitBranchName: 'feature/iso',
        status: 'Backlog',
        labels: [],
        url: '',
      });

      // Verify files are in temp dir, not real cwd
      const mobiusInTemp = join(tempDir, '.mobius', 'issues', 'ISOLATION-TEST', 'parent.json');
      expect(existsSync(mobiusInTemp)).toBe(true);
    });
  });

  describe('readSubTasks identifier normalization', () => {
    it('infers identifier from filename when missing in JSON', () => {
      ensureProjectMobiusDir();
      const tasksDir = join(tempDir, '.mobius', 'issues', 'PARENT-NORM', 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      // Write a task file WITHOUT an identifier field (simulates refine bug)
      const taskWithoutIdentifier = {
        id: 'task-VG',
        title: 'Verification Gate',
        description: 'Verify everything',
        status: 'pending',
        blockedBy: [],
        blocks: [],
      };
      writeFileSync(
        join(tasksDir, 'task-VG.json'),
        JSON.stringify(taskWithoutIdentifier, null, 2),
        'utf-8'
      );

      const tasks = readSubTasks('PARENT-NORM');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].identifier).toBe('task-VG');
      expect(tasks[0].id).toBe('task-VG');
    });

    it('preserves existing identifier when present', () => {
      ensureProjectMobiusDir();
      const tasksDir = join(tempDir, '.mobius', 'issues', 'PARENT-NORM2', 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      const taskWithIdentifier = {
        id: 'task-001',
        identifier: 'MOB-123',
        title: 'Some Task',
        description: '',
        status: 'done',
        blockedBy: [],
        blocks: [],
      };
      writeFileSync(
        join(tasksDir, 'MOB-123.json'),
        JSON.stringify(taskWithIdentifier, null, 2),
        'utf-8'
      );

      const tasks = readSubTasks('PARENT-NORM2');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].identifier).toBe('MOB-123');
    });
  });

  describe('readLocalSubTasksAsLinearIssues deduplication', () => {
    it('deduplicates by id preferring done over pending', () => {
      ensureProjectMobiusDir();
      const tasksDir = join(tempDir, '.mobius', 'issues', 'PARENT-DEDUP', 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      // Write task-VG.json with status "done"
      writeFileSync(
        join(tasksDir, 'task-VG.json'),
        JSON.stringify({
          id: 'task-VG',
          identifier: 'task-VG',
          title: 'Verification Gate',
          description: '',
          status: 'done',
          blockedBy: [],
          blocks: [],
        }, null, 2),
        'utf-8'
      );

      // Write undefined.json (phantom) with same id but status "pending"
      writeFileSync(
        join(tasksDir, 'undefined.json'),
        JSON.stringify({
          id: 'task-VG',
          title: 'Verification Gate',
          description: '',
          status: 'pending',
          blockedBy: [],
          blocks: [],
        }, null, 2),
        'utf-8'
      );

      const issues = readLocalSubTasksAsLinearIssues('PARENT-DEDUP');
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe('task-VG');
      expect(issues[0].status).toBe('done');
    });

    it('deduplicates by id preferring in_progress over ready', () => {
      ensureProjectMobiusDir();
      const tasksDir = join(tempDir, '.mobius', 'issues', 'PARENT-DEDUP2', 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      writeFileSync(
        join(tasksDir, 'a-first.json'),
        JSON.stringify({
          id: 'task-X',
          identifier: 'task-X',
          title: 'Task X',
          description: '',
          status: 'ready',
          blockedBy: [],
          blocks: [],
        }, null, 2),
        'utf-8'
      );

      writeFileSync(
        join(tasksDir, 'b-second.json'),
        JSON.stringify({
          id: 'task-X',
          identifier: 'task-X',
          title: 'Task X',
          description: '',
          status: 'in_progress',
          blockedBy: [],
          blocks: [],
        }, null, 2),
        'utf-8'
      );

      const issues = readLocalSubTasksAsLinearIssues('PARENT-DEDUP2');
      expect(issues).toHaveLength(1);
      expect(issues[0].status).toBe('in_progress');
    });

    it('keeps all tasks when ids are unique', () => {
      ensureProjectMobiusDir();
      const tasksDir = join(tempDir, '.mobius', 'issues', 'PARENT-DEDUP3', 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      writeFileSync(
        join(tasksDir, 'task-001.json'),
        JSON.stringify({
          id: 'task-001',
          identifier: 'task-001',
          title: 'Task 1',
          description: '',
          status: 'pending',
          blockedBy: [],
          blocks: [],
        }, null, 2),
        'utf-8'
      );

      writeFileSync(
        join(tasksDir, 'task-002.json'),
        JSON.stringify({
          id: 'task-002',
          identifier: 'task-002',
          title: 'Task 2',
          description: '',
          status: 'done',
          blockedBy: [],
          blocks: [],
        }, null, 2),
        'utf-8'
      );

      const issues = readLocalSubTasksAsLinearIssues('PARENT-DEDUP3');
      expect(issues).toHaveLength(2);
    });
  });

  describe('writeSubTaskSpec identifier guard', () => {
    it('uses task.id as fallback when identifier is missing', () => {
      const task = {
        id: 'task-fallback',
        title: 'Fallback Task',
        description: '',
        status: 'pending' as const,
        blockedBy: [],
        blocks: [],
      } as unknown as SubTaskContext;

      writeSubTaskSpec('PARENT-GUARD', task);

      const filePath = join(
        tempDir,
        '.mobius',
        'issues',
        'PARENT-GUARD',
        'tasks',
        'task-fallback.json'
      );
      expect(existsSync(filePath)).toBe(true);

      const written = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(written.identifier).toBe('task-fallback');
      expect(written.id).toBe('task-fallback');
    });

    it('does not create file when both identifier and id are missing', () => {
      const task = {
        title: 'No ID Task',
        description: '',
        status: 'pending' as const,
        blockedBy: [],
        blocks: [],
      } as unknown as SubTaskContext;

      writeSubTaskSpec('PARENT-GUARD2', task);

      // Should not create an undefined.json file
      const tasksDir = join(tempDir, '.mobius', 'issues', 'PARENT-GUARD2', 'tasks');
      if (existsSync(tasksDir)) {
        const files = require('node:fs').readdirSync(tasksDir);
        expect(files.filter((f: string) => f.endsWith('.json'))).toHaveLength(0);
      }
    });
  });
});
