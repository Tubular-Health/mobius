/**
 * End-to-end tests for worktree isolation between parallel loops
 *
 * Verifies that:
 * 1. Each parent task gets its own worktree directory
 * 2. Branch operations don't interfere between worktrees
 * 3. Git locks are per-worktree, not global
 *
 * Uses temp directories for isolation - no modification to main repository.
 * Does NOT test actual git push operations.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import type { ExecutionConfig } from '../types.js';
import { acquireLock, isLocked, releaseLock, withLock } from './git-lock.js';
import { getWorktreePath } from './worktree.js';

// Helper to create a working git repo with a branch
async function createWorkingGitRepo(path: string, branchName: string = 'main'): Promise<void> {
  mkdirSync(path, { recursive: true });
  await execa('git', ['init'], { cwd: path });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: path });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: path });
  // Create initial commit on the main branch
  await execa('git', ['checkout', '-b', branchName], { cwd: path });
  await execa('touch', ['README.md'], { cwd: path });
  await execa('git', ['add', 'README.md'], { cwd: path });
  await execa('git', ['commit', '-m', 'Initial commit'], { cwd: path });
}

// Helper to create a worktree from a main repo
async function createWorktreeFromRepo(
  mainRepoPath: string,
  worktreePath: string,
  branchName: string
): Promise<void> {
  await execa('git', ['worktree', 'add', worktreePath, '-b', branchName, 'main'], {
    cwd: mainRepoPath,
  });
}

// Helper to remove a worktree
async function removeWorktreeFromRepo(mainRepoPath: string, worktreePath: string): Promise<void> {
  try {
    await execa('git', ['worktree', 'remove', worktreePath, '--force'], {
      cwd: mainRepoPath,
    });
  } catch {
    // Ignore errors if worktree doesn't exist
  }
}

// Test configuration
const defaultConfig: ExecutionConfig = {
  delay_seconds: 3,
  max_iterations: 50,
  model: 'opus',
  sandbox: true,
  container_name: 'mobius-sandbox',
  max_parallel_agents: 3,
  worktree_path: '../<repo>-worktrees/',
  cleanup_on_success: true,
  base_branch: 'main',
};

describe('worktree-isolation e2e', () => {
  let tempDir: string;
  let mainRepoPath: string;
  let worktreeBasePath: string;

  beforeEach(async () => {
    // Create a fresh temp directory structure for each test
    tempDir = mkdtempSync(join(tmpdir(), 'mobius-worktree-isolation-'));
    mainRepoPath = join(tempDir, 'main-repo');
    worktreeBasePath = join(tempDir, 'worktrees');

    // Create a main git repo for worktree tests
    await createWorkingGitRepo(mainRepoPath);
    mkdirSync(worktreeBasePath, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('unique worktree paths per task ID', () => {
    it('getWorktreePath returns different paths for different task IDs', async () => {
      // Use a config with a specific worktree path template
      const config: ExecutionConfig = {
        ...defaultConfig,
        worktree_path: join(worktreeBasePath, '<repo>'),
      };

      const pathA = await getWorktreePath('TASK-A', config);
      const pathB = await getWorktreePath('TASK-B', config);

      // Paths should be unique
      expect(pathA).not.toBe(pathB);

      // Each path should contain the respective task ID
      expect(pathA).toContain('TASK-A');
      expect(pathB).toContain('TASK-B');
    });

    it('getWorktreePath is consistent for the same task ID', async () => {
      const config: ExecutionConfig = {
        ...defaultConfig,
        worktree_path: join(worktreeBasePath, '<repo>'),
      };

      const path1 = await getWorktreePath('TASK-A', config);
      const path2 = await getWorktreePath('TASK-A', config);

      expect(path1).toBe(path2);
    });

    it('supports multiple task ID formats', async () => {
      const config: ExecutionConfig = {
        ...defaultConfig,
        worktree_path: join(worktreeBasePath, '<repo>'),
      };

      const taskIds = ['MOB-123', 'JIRA-456', 'ABC-1', 'TEST-9999'];
      const paths = await Promise.all(taskIds.map((id) => getWorktreePath(id, config)));

      // All paths should be unique
      const uniquePaths = new Set(paths);
      expect(uniquePaths.size).toBe(taskIds.length);

      // Each path should end with its task ID
      for (let i = 0; i < taskIds.length; i++) {
        expect(paths[i].endsWith(taskIds[i])).toBe(true);
      }
    });
  });

  describe('worktree creation isolation', () => {
    it('creating worktree for TASK-A does not affect TASK-B worktree', async () => {
      const worktreeA = join(worktreeBasePath, 'TASK-A');
      const worktreeB = join(worktreeBasePath, 'TASK-B');

      // Create worktree for TASK-A
      await createWorktreeFromRepo(mainRepoPath, worktreeA, 'feature/TASK-A');

      // Verify TASK-A worktree exists and TASK-B doesn't
      expect(existsSync(worktreeA)).toBe(true);
      expect(existsSync(worktreeB)).toBe(false);

      // Create worktree for TASK-B
      await createWorktreeFromRepo(mainRepoPath, worktreeB, 'feature/TASK-B');

      // Verify both worktrees exist independently
      expect(existsSync(worktreeA)).toBe(true);
      expect(existsSync(worktreeB)).toBe(true);

      // Verify they have different branches
      const { stdout: branchA } = await execa('git', ['branch', '--show-current'], {
        cwd: worktreeA,
      });
      const { stdout: branchB } = await execa('git', ['branch', '--show-current'], {
        cwd: worktreeB,
      });

      expect(branchA.trim()).toBe('feature/TASK-A');
      expect(branchB.trim()).toBe('feature/TASK-B');
    });

    it('parallel worktree creation succeeds without interference', async () => {
      const tasks = ['TASK-1', 'TASK-2', 'TASK-3'];
      const worktrees = tasks.map((id) => ({
        id,
        path: join(worktreeBasePath, id),
        branch: `feature/${id}`,
      }));

      // Create all worktrees in parallel
      await Promise.all(
        worktrees.map((wt) => createWorktreeFromRepo(mainRepoPath, wt.path, wt.branch))
      );

      // Verify all worktrees were created successfully
      for (const wt of worktrees) {
        expect(existsSync(wt.path)).toBe(true);

        const { stdout: branch } = await execa('git', ['branch', '--show-current'], {
          cwd: wt.path,
        });
        expect(branch.trim()).toBe(wt.branch);
      }
    });

    it('modifying files in TASK-A worktree does not affect TASK-B', async () => {
      const worktreeA = join(worktreeBasePath, 'TASK-A');
      const worktreeB = join(worktreeBasePath, 'TASK-B');

      await createWorktreeFromRepo(mainRepoPath, worktreeA, 'feature/TASK-A');
      await createWorktreeFromRepo(mainRepoPath, worktreeB, 'feature/TASK-B');

      // Create a file in TASK-A worktree
      const testFileA = join(worktreeA, 'task-a-file.txt');
      await execa('touch', [testFileA]);
      await execa('git', ['add', 'task-a-file.txt'], { cwd: worktreeA });
      await execa('git', ['commit', '-m', 'Add TASK-A file'], { cwd: worktreeA });

      // Verify file exists in TASK-A but not in TASK-B
      expect(existsSync(testFileA)).toBe(true);
      expect(existsSync(join(worktreeB, 'task-a-file.txt'))).toBe(false);

      // Verify TASK-B is unaffected
      const { stdout: statusB } = await execa('git', ['status', '--porcelain'], {
        cwd: worktreeB,
      });
      expect(statusB.trim()).toBe('');
    });
  });

  describe('git locks are per-worktree', () => {
    it('acquiring lock in TASK-A worktree does not block TASK-B', async () => {
      const worktreeA = join(worktreeBasePath, 'TASK-A');
      const worktreeB = join(worktreeBasePath, 'TASK-B');

      // Create worktrees
      await createWorktreeFromRepo(mainRepoPath, worktreeA, 'feature/TASK-A');
      await createWorktreeFromRepo(mainRepoPath, worktreeB, 'feature/TASK-B');

      // Acquire lock in TASK-A worktree
      const lockA = await acquireLock(worktreeA);

      // Should be able to acquire lock in TASK-B immediately (no blocking)
      const startTime = Date.now();
      const lockB = await acquireLock(worktreeB, 1000); // 1 second timeout
      const elapsed = Date.now() - startTime;

      // Should have acquired almost immediately (< 200ms)
      expect(elapsed).toBeLessThan(200);

      // Verify both locks are held independently
      expect(await isLocked(worktreeA)).toBe(true);
      expect(await isLocked(worktreeB)).toBe(true);

      // Release both locks
      await releaseLock(lockA);
      await releaseLock(lockB);
    });

    it('parallel agents in different worktrees acquire locks independently', async () => {
      const tasks = ['TASK-1', 'TASK-2', 'TASK-3'];
      const worktreePaths: string[] = [];

      // Create worktrees
      for (const task of tasks) {
        const path = join(worktreeBasePath, task);
        await createWorktreeFromRepo(mainRepoPath, path, `feature/${task}`);
        worktreePaths.push(path);
      }

      // All agents try to acquire locks simultaneously
      const lockPromises = worktreePaths.map(async (path) => {
        const start = Date.now();
        const handle = await acquireLock(path, 2000);
        const elapsed = Date.now() - start;
        return { path, handle, elapsed };
      });

      const results = await Promise.all(lockPromises);

      // All locks should be acquired quickly (no blocking between worktrees)
      for (const result of results) {
        expect(result.elapsed).toBeLessThan(200);
        expect(await isLocked(result.path)).toBe(true);
      }

      // Release all locks
      for (const result of results) {
        await releaseLock(result.handle);
      }
    });

    it('releasing lock in TASK-A does not affect TASK-B lock', async () => {
      const worktreeA = join(worktreeBasePath, 'TASK-A');
      const worktreeB = join(worktreeBasePath, 'TASK-B');

      await createWorktreeFromRepo(mainRepoPath, worktreeA, 'feature/TASK-A');
      await createWorktreeFromRepo(mainRepoPath, worktreeB, 'feature/TASK-B');

      // Acquire both locks
      const lockA = await acquireLock(worktreeA);
      const lockB = await acquireLock(worktreeB);

      // Release TASK-A lock
      await releaseLock(lockA);

      // TASK-B should still be locked
      expect(await isLocked(worktreeA)).toBe(false);
      expect(await isLocked(worktreeB)).toBe(true);

      // Release TASK-B lock
      await releaseLock(lockB);
      expect(await isLocked(worktreeB)).toBe(false);
    });

    it('withLock in TASK-A does not serialize with TASK-B operations', async () => {
      const worktreeA = join(worktreeBasePath, 'TASK-A');
      const worktreeB = join(worktreeBasePath, 'TASK-B');

      await createWorktreeFromRepo(mainRepoPath, worktreeA, 'feature/TASK-A');
      await createWorktreeFromRepo(mainRepoPath, worktreeB, 'feature/TASK-B');

      const executionOrder: string[] = [];

      // Both operations should run concurrently, not serialized
      const operationA = withLock(worktreeA, async () => {
        executionOrder.push('A-start');
        await new Promise((resolve) => setTimeout(resolve, 100));
        executionOrder.push('A-end');
        return 'A';
      });

      const operationB = withLock(worktreeB, async () => {
        executionOrder.push('B-start');
        await new Promise((resolve) => setTimeout(resolve, 100));
        executionOrder.push('B-end');
        return 'B';
      });

      const results = await Promise.all([operationA, operationB]);

      expect(results).toEqual(['A', 'B']);

      // Both should start before either ends (concurrent execution)
      // Execution order should be A-start, B-start, then A-end, B-end (interleaved)
      const aStartIdx = executionOrder.indexOf('A-start');
      const bStartIdx = executionOrder.indexOf('B-start');
      const aEndIdx = executionOrder.indexOf('A-end');
      const bEndIdx = executionOrder.indexOf('B-end');

      // Both starts should happen before both ends
      expect(aStartIdx).toBeLessThan(aEndIdx);
      expect(bStartIdx).toBeLessThan(bEndIdx);
      // And crucially: both starts should happen early (concurrent)
      expect(Math.abs(aStartIdx - bStartIdx)).toBeLessThan(2);
    });
  });

  describe('worktree cleanup isolation', () => {
    it('removing TASK-A worktree does not affect TASK-B', async () => {
      const worktreeA = join(worktreeBasePath, 'TASK-A');
      const worktreeB = join(worktreeBasePath, 'TASK-B');

      await createWorktreeFromRepo(mainRepoPath, worktreeA, 'feature/TASK-A');
      await createWorktreeFromRepo(mainRepoPath, worktreeB, 'feature/TASK-B');

      // Remove TASK-A worktree
      await removeWorktreeFromRepo(mainRepoPath, worktreeA);

      // TASK-A should be removed, TASK-B should remain
      expect(existsSync(worktreeA)).toBe(false);
      expect(existsSync(worktreeB)).toBe(true);

      // TASK-B should still be functional
      const { stdout: branch } = await execa('git', ['branch', '--show-current'], {
        cwd: worktreeB,
      });
      expect(branch.trim()).toBe('feature/TASK-B');
    });

    it('parallel cleanup of multiple worktrees succeeds', async () => {
      const tasks = ['TASK-1', 'TASK-2', 'TASK-3'];
      const worktreePaths: string[] = [];

      // Create worktrees
      for (const task of tasks) {
        const path = join(worktreeBasePath, task);
        await createWorktreeFromRepo(mainRepoPath, path, `feature/${task}`);
        worktreePaths.push(path);
      }

      // All worktrees exist
      for (const path of worktreePaths) {
        expect(existsSync(path)).toBe(true);
      }

      // Remove all worktrees in parallel
      await Promise.all(worktreePaths.map((path) => removeWorktreeFromRepo(mainRepoPath, path)));

      // All should be removed
      for (const path of worktreePaths) {
        expect(existsSync(path)).toBe(false);
      }
    });

    it('cleanup does not affect active lock in another worktree', async () => {
      const worktreeA = join(worktreeBasePath, 'TASK-A');
      const worktreeB = join(worktreeBasePath, 'TASK-B');

      await createWorktreeFromRepo(mainRepoPath, worktreeA, 'feature/TASK-A');
      await createWorktreeFromRepo(mainRepoPath, worktreeB, 'feature/TASK-B');

      // Acquire lock in TASK-B
      const lockB = await acquireLock(worktreeB);

      // Remove TASK-A worktree while TASK-B has a lock
      await removeWorktreeFromRepo(mainRepoPath, worktreeA);

      // TASK-B lock should still be valid
      expect(await isLocked(worktreeB)).toBe(true);

      // Release TASK-B lock
      await releaseLock(lockB);
      expect(await isLocked(worktreeB)).toBe(false);
    });
  });

  describe('concurrent branch operations isolation', () => {
    it('commits in different worktrees do not interfere', async () => {
      const worktreeA = join(worktreeBasePath, 'TASK-A');
      const worktreeB = join(worktreeBasePath, 'TASK-B');

      await createWorktreeFromRepo(mainRepoPath, worktreeA, 'feature/TASK-A');
      await createWorktreeFromRepo(mainRepoPath, worktreeB, 'feature/TASK-B');

      // Make commits in parallel
      const commitA = async () => {
        await execa('touch', ['file-a.txt'], { cwd: worktreeA });
        await execa('git', ['add', 'file-a.txt'], { cwd: worktreeA });
        await execa('git', ['commit', '-m', 'Commit from TASK-A'], { cwd: worktreeA });
        const { stdout } = await execa('git', ['log', '--oneline', '-1'], { cwd: worktreeA });
        return stdout;
      };

      const commitB = async () => {
        await execa('touch', ['file-b.txt'], { cwd: worktreeB });
        await execa('git', ['add', 'file-b.txt'], { cwd: worktreeB });
        await execa('git', ['commit', '-m', 'Commit from TASK-B'], { cwd: worktreeB });
        const { stdout } = await execa('git', ['log', '--oneline', '-1'], { cwd: worktreeB });
        return stdout;
      };

      const [logA, logB] = await Promise.all([commitA(), commitB()]);

      // Each worktree should have its own commit
      expect(logA).toContain('Commit from TASK-A');
      expect(logB).toContain('Commit from TASK-B');

      // Verify the commits are on different branches
      const { stdout: branchListA } = await execa('git', ['log', '--oneline', '-2'], {
        cwd: worktreeA,
      });
      const { stdout: branchListB } = await execa('git', ['log', '--oneline', '-2'], {
        cwd: worktreeB,
      });

      expect(branchListA).toContain('Commit from TASK-A');
      expect(branchListA).not.toContain('Commit from TASK-B');
      expect(branchListB).toContain('Commit from TASK-B');
      expect(branchListB).not.toContain('Commit from TASK-A');
    });

    it('branch switching in one worktree does not affect another', async () => {
      const worktreeA = join(worktreeBasePath, 'TASK-A');
      const worktreeB = join(worktreeBasePath, 'TASK-B');

      await createWorktreeFromRepo(mainRepoPath, worktreeA, 'feature/TASK-A');
      await createWorktreeFromRepo(mainRepoPath, worktreeB, 'feature/TASK-B');

      // Create and checkout a new branch in TASK-A
      await execa('git', ['checkout', '-b', 'feature/TASK-A-new'], { cwd: worktreeA });

      // TASK-B should still be on its original branch
      const { stdout: branchB } = await execa('git', ['branch', '--show-current'], {
        cwd: worktreeB,
      });
      expect(branchB.trim()).toBe('feature/TASK-B');

      // Verify TASK-A is on the new branch
      const { stdout: branchA } = await execa('git', ['branch', '--show-current'], {
        cwd: worktreeA,
      });
      expect(branchA.trim()).toBe('feature/TASK-A-new');
    });
  });

  describe('full parallel loop simulation', () => {
    it('simulates 3 parallel loops with complete isolation', async () => {
      const tasks = ['LOOP-1', 'LOOP-2', 'LOOP-3'];
      const worktrees: Map<string, string> = new Map();

      // Phase 1: Create worktrees for all loops
      for (const task of tasks) {
        const path = join(worktreeBasePath, task);
        await createWorktreeFromRepo(mainRepoPath, path, `feature/${task}`);
        worktrees.set(task, path);
      }

      // Phase 2: Simulate parallel work with locks
      const results = await Promise.all(
        tasks.map(async (task) => {
          const path = worktrees.get(task) ?? '';

          // Acquire lock for git operations
          return await withLock(path, async () => {
            // Make changes
            await execa('touch', [`${task.toLowerCase()}.ts`], { cwd: path });
            await execa('git', ['add', '.'], { cwd: path });
            await execa('git', ['commit', '-m', `feat: implement ${task}`], { cwd: path });

            // Get commit hash
            const { stdout: hash } = await execa('git', ['rev-parse', 'HEAD'], { cwd: path });

            return {
              task,
              path,
              commitHash: hash.trim().substring(0, 7),
            };
          });
        })
      );

      // Phase 3: Verify each loop completed independently
      expect(results.length).toBe(3);

      // All commit hashes should be unique
      const hashes = results.map((r) => r.commitHash);
      expect(new Set(hashes).size).toBe(3);

      // Verify each worktree has only its own changes
      for (const result of results) {
        const { stdout: log } = await execa('git', ['log', '--oneline', '-2'], {
          cwd: result.path,
        });
        expect(log).toContain(`feat: implement ${result.task}`);

        // Should not contain other loop's commits
        const otherTasks = tasks.filter((t) => t !== result.task);
        for (const other of otherTasks) {
          expect(log).not.toContain(`feat: implement ${other}`);
        }
      }

      // Phase 4: Cleanup
      for (const path of worktrees.values()) {
        await removeWorktreeFromRepo(mainRepoPath, path);
      }

      // Verify cleanup
      for (const path of worktrees.values()) {
        expect(existsSync(path)).toBe(false);
      }
    });
  });
});
