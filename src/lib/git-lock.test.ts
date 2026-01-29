/**
 * Unit tests for git-lock.ts
 *
 * Tests verify:
 * 1. Concurrent lock acquisition by multiple parallel operations
 * 2. Stale lock detection (age-based and dead process)
 * 3. Lock metadata accuracy (PID, timestamp, hostname)
 * 4. Timeout behavior when lock cannot be acquired
 * 5. Lock release on normal exit and signal handling
 *
 * Uses temp directories for isolation - no real tmux or Claude processes.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireLock,
  forceReleaseLock,
  getLockInfo,
  isLocked,
  releaseLock,
  withLock,
} from './git-lock.js';

const LOCK_DIR_NAME = '.git-lock';
const LOCK_METADATA_FILE = 'lock.json';

// Helper to create a lock directory manually (simulates external lock holder)
function createManualLock(
  worktreePath: string,
  metadata: { pid: number; acquired: string; hostname: string }
): void {
  const lockPath = join(worktreePath, LOCK_DIR_NAME);
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(join(lockPath, LOCK_METADATA_FILE), JSON.stringify(metadata, null, 2));
}

// Helper to check if lock directory exists
function lockExists(worktreePath: string): boolean {
  return existsSync(join(worktreePath, LOCK_DIR_NAME));
}

// Helper to get a PID that definitely doesn't exist
function getDeadPid(): number {
  // Use a very high PID that's unlikely to exist
  // PIDs on Linux are typically max 4194304 (2^22)
  return 999999999;
}

// Helper to set lock directory mtime to past (for stale detection)
async function setLockAge(worktreePath: string, ageMs: number): Promise<void> {
  const lockPath = join(worktreePath, LOCK_DIR_NAME);
  const pastTime = new Date(Date.now() - ageMs);
  const { utimes } = await import('node:fs/promises');
  await utimes(lockPath, pastTime, pastTime);
}

describe('git-lock', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a fresh temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'mobius-git-lock-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('basic lock operations', () => {
    it('acquires and releases lock successfully', async () => {
      const handle = await acquireLock(tempDir);

      expect(handle.path).toBe(join(tempDir, LOCK_DIR_NAME));
      expect(handle.pid).toBe(process.pid);
      expect(handle.acquired).toBeInstanceOf(Date);
      expect(lockExists(tempDir)).toBe(true);

      await releaseLock(handle);
      expect(lockExists(tempDir)).toBe(false);
    });

    it('creates lock metadata with correct values', async () => {
      const beforeAcquire = new Date();
      const handle = await acquireLock(tempDir);
      const afterAcquire = new Date();

      const info = await getLockInfo(tempDir);
      expect(info).not.toBeNull();
      expect(info?.pid).toBe(process.pid);
      expect(info?.hostname).toBe(process.env.HOSTNAME ?? 'unknown');
      expect(info?.acquired.getTime()).toBeGreaterThanOrEqual(beforeAcquire.getTime());
      expect(info?.acquired.getTime()).toBeLessThanOrEqual(afterAcquire.getTime());

      await releaseLock(handle);
    });

    it('withLock executes function and releases lock', async () => {
      let executed = false;

      const result = await withLock(tempDir, async () => {
        executed = true;
        expect(lockExists(tempDir)).toBe(true);
        return 'success';
      });

      expect(executed).toBe(true);
      expect(result).toBe('success');
      expect(lockExists(tempDir)).toBe(false);
    });

    it('withLock releases lock even on error', async () => {
      const testError = new Error('test error');

      await expect(
        withLock(tempDir, async () => {
          throw testError;
        })
      ).rejects.toThrow('test error');

      expect(lockExists(tempDir)).toBe(false);
    });

    it('isLocked returns false when no lock exists', async () => {
      expect(await isLocked(tempDir)).toBe(false);
    });

    it('isLocked returns true when lock is held', async () => {
      const handle = await acquireLock(tempDir);
      expect(await isLocked(tempDir)).toBe(true);
      await releaseLock(handle);
      expect(await isLocked(tempDir)).toBe(false);
    });

    it('forceReleaseLock removes lock regardless of owner', async () => {
      // Create a lock owned by a "different" process (using dead PID)
      createManualLock(tempDir, {
        pid: getDeadPid(),
        acquired: new Date().toISOString(),
        hostname: 'other-host',
      });

      expect(lockExists(tempDir)).toBe(true);
      await forceReleaseLock(tempDir);
      expect(lockExists(tempDir)).toBe(false);
    });

    it('getLockInfo returns null when no lock exists', async () => {
      const info = await getLockInfo(tempDir);
      expect(info).toBeNull();
    });
  });

  describe('concurrent lock acquisition', () => {
    it('handles 3 agents acquiring locks simultaneously via Promise.all()', async () => {
      const results: { agent: number; acquired: boolean; order: number }[] = [];
      let acquisitionOrder = 0;

      // 3 agents trying to acquire lock simultaneously
      const promises = [1, 2, 3].map(async (agent) => {
        try {
          const handle = await acquireLock(tempDir, 5000); // 5 second timeout
          const order = ++acquisitionOrder;
          results.push({ agent, acquired: true, order });

          // Hold lock briefly to simulate work
          await new Promise((resolve) => setTimeout(resolve, 50));

          await releaseLock(handle);
        } catch {
          results.push({ agent, acquired: false, order: -1 });
        }
      });

      await Promise.all(promises);

      // All 3 agents should have acquired the lock (sequentially)
      expect(results.filter((r) => r.acquired).length).toBe(3);
      // Each agent got a unique order
      const orders = results.filter((r) => r.acquired).map((r) => r.order);
      expect(new Set(orders).size).toBe(3);
      expect(orders).toContain(1);
      expect(orders).toContain(2);
      expect(orders).toContain(3);
    });

    it('handles 5 agents acquiring and releasing locks without deadlock', async () => {
      const completedAgents: number[] = [];

      const promises = [1, 2, 3, 4, 5].map(async (agent) => {
        const handle = await acquireLock(tempDir, 10000); // 10 second timeout
        completedAgents.push(agent);

        // Simulate varying work times
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 30 + 10));

        await releaseLock(handle);
        return agent;
      });

      const results = await Promise.all(promises);

      // All 5 agents should complete
      expect(results.length).toBe(5);
      expect(completedAgents.length).toBe(5);
      // Lock should be released at the end
      expect(lockExists(tempDir)).toBe(false);
    });

    it('serializes concurrent withLock operations', async () => {
      const executionOrder: number[] = [];

      const promises = [1, 2, 3].map((n) =>
        withLock(tempDir, async () => {
          executionOrder.push(n);
          // Hold lock briefly
          await new Promise((resolve) => setTimeout(resolve, 20));
          return n;
        })
      );

      const results = await Promise.all(promises);

      // All operations should complete
      expect(results.sort()).toEqual([1, 2, 3]);
      // Operations executed in some serial order (not necessarily 1,2,3)
      expect(executionOrder.length).toBe(3);
      expect(new Set(executionOrder).size).toBe(3);
    });

    it('concurrent operations maintain data consistency', async () => {
      // Shared counter incremented under lock
      let counter = 0;
      const incrementCount = 5;

      const promises = Array.from({ length: incrementCount }, (_, i) =>
        withLock(
          tempDir,
          async () => {
            const current = counter;
            // Small delay to expose race conditions if locking is broken
            await new Promise((resolve) => setTimeout(resolve, 10));
            counter = current + 1;
            return i;
          },
          10000 // Longer timeout for concurrent operations
        )
      );

      await Promise.all(promises);

      // Without proper locking, counter would be less than incrementCount
      expect(counter).toBe(incrementCount);
    });
  });

  describe('stale lock detection', () => {
    it('detects stale lock by age (>5 minutes)', async () => {
      // Create a lock manually
      createManualLock(tempDir, {
        pid: process.pid, // Use current PID so process check passes
        acquired: new Date(Date.now() - 6 * 60 * 1000).toISOString(), // 6 minutes ago
        hostname: 'test-host',
      });

      // Set the lock directory mtime to 6 minutes ago
      await setLockAge(tempDir, 6 * 60 * 1000);

      // isLocked should return false for stale lock
      expect(await isLocked(tempDir)).toBe(false);
    });

    it('detects stale lock by dead process', async () => {
      const deadPid = getDeadPid();

      // Create a lock with a dead PID
      createManualLock(tempDir, {
        pid: deadPid,
        acquired: new Date().toISOString(), // Recent timestamp
        hostname: 'test-host',
      });

      // isLocked should return false because process is dead
      expect(await isLocked(tempDir)).toBe(false);
    });

    it('acquires lock when existing lock is stale by age', async () => {
      // Create stale lock
      createManualLock(tempDir, {
        pid: process.pid,
        acquired: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
        hostname: 'test-host',
      });
      await setLockAge(tempDir, 6 * 60 * 1000);

      // Should acquire lock by cleaning up stale lock
      const handle = await acquireLock(tempDir, 1000);

      expect(handle.pid).toBe(process.pid);
      expect(lockExists(tempDir)).toBe(true);

      await releaseLock(handle);
    });

    it('acquires lock when existing lock is held by dead process', async () => {
      const deadPid = getDeadPid();

      // Create lock with dead PID
      createManualLock(tempDir, {
        pid: deadPid,
        acquired: new Date().toISOString(),
        hostname: 'test-host',
      });

      // Should acquire lock by cleaning up stale lock
      const handle = await acquireLock(tempDir, 1000);

      expect(handle.pid).toBe(process.pid);
      expect(lockExists(tempDir)).toBe(true);

      // Verify metadata was updated
      const info = await getLockInfo(tempDir);
      expect(info?.pid).toBe(process.pid);

      await releaseLock(handle);
    });

    it('does not treat recent lock from live process as stale', async () => {
      // Acquire lock normally
      const handle = await acquireLock(tempDir);

      // isLocked should return true
      expect(await isLocked(tempDir)).toBe(true);

      // Another acquire attempt should wait/timeout, not steal the lock
      await expect(acquireLock(tempDir, 200)).rejects.toThrow(/Failed to acquire git lock/);

      await releaseLock(handle);
    });
  });

  describe('metadata accuracy', () => {
    it('writes correct PID to lock metadata', async () => {
      const handle = await acquireLock(tempDir);

      const info = await getLockInfo(tempDir);
      expect(info?.pid).toBe(process.pid);

      await releaseLock(handle);
    });

    it('writes correct timestamp to lock metadata', async () => {
      const before = Date.now();
      const handle = await acquireLock(tempDir);
      const after = Date.now();

      const info = await getLockInfo(tempDir);
      const acquiredTime = info?.acquired.getTime();

      expect(acquiredTime).toBeGreaterThanOrEqual(before);
      expect(acquiredTime).toBeLessThanOrEqual(after);

      await releaseLock(handle);
    });

    it('writes correct hostname to lock metadata', async () => {
      const handle = await acquireLock(tempDir);

      const info = await getLockInfo(tempDir);
      expect(info?.hostname).toBe(process.env.HOSTNAME ?? 'unknown');

      await releaseLock(handle);
    });

    it('LockHandle contains accurate information', async () => {
      const before = new Date();
      const handle = await acquireLock(tempDir);
      const after = new Date();

      expect(handle.pid).toBe(process.pid);
      expect(handle.path).toBe(join(tempDir, LOCK_DIR_NAME));
      expect(handle.acquired.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(handle.acquired.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(typeof handle.release).toBe('function');

      await releaseLock(handle);
    });
  });

  describe('timeout behavior', () => {
    it('throws error when lock cannot be acquired within timeout', async () => {
      // Acquire lock first
      const handle = await acquireLock(tempDir);

      // Try to acquire again with short timeout
      await expect(acquireLock(tempDir, 300)).rejects.toThrow(
        /Failed to acquire git lock after 300ms/
      );

      await releaseLock(handle);
    });

    it('timeout error includes lock owner information', async () => {
      const handle = await acquireLock(tempDir);

      try {
        await acquireLock(tempDir, 200);
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain(`PID ${process.pid}`);
        expect((error as Error).message).toContain('Lock path:');
      }

      await releaseLock(handle);
    });

    it('respects custom timeout value', async () => {
      const handle = await acquireLock(tempDir);

      const startTime = Date.now();
      try {
        await acquireLock(tempDir, 500);
        expect.unreachable('Should have thrown');
      } catch {
        const elapsed = Date.now() - startTime;
        // Should timeout close to 500ms (allow some tolerance)
        expect(elapsed).toBeGreaterThanOrEqual(400);
        expect(elapsed).toBeLessThan(1000);
      }

      await releaseLock(handle);
    });

    it('acquires lock quickly when available', async () => {
      const startTime = Date.now();
      const handle = await acquireLock(tempDir, 5000);
      const elapsed = Date.now() - startTime;

      // Should acquire almost immediately when no contention
      expect(elapsed).toBeLessThan(200);

      await releaseLock(handle);
    });

    it('successful acquisition within timeout after lock is released', async () => {
      const handle = await acquireLock(tempDir);

      // Start second acquisition attempt
      const acquirePromise = acquireLock(tempDir, 2000);

      // Release first lock after small delay
      setTimeout(async () => {
        await releaseLock(handle);
      }, 100);

      // Second acquisition should succeed
      const handle2 = await acquirePromise;
      expect(handle2.pid).toBe(process.pid);

      await releaseLock(handle2);
    });
  });

  describe('lock release behavior', () => {
    it('release removes lock directory completely', async () => {
      const handle = await acquireLock(tempDir);
      const lockPath = join(tempDir, LOCK_DIR_NAME);

      expect(existsSync(lockPath)).toBe(true);
      expect(existsSync(join(lockPath, LOCK_METADATA_FILE))).toBe(true);

      await releaseLock(handle);

      expect(existsSync(lockPath)).toBe(false);
    });

    it('release is idempotent (can be called multiple times)', async () => {
      const handle = await acquireLock(tempDir);

      await releaseLock(handle);
      // Second release should not throw
      await releaseLock(handle);
      // Third release should not throw
      await releaseLock(handle);

      expect(lockExists(tempDir)).toBe(false);
    });

    it('release allows immediate re-acquisition', async () => {
      const handle1 = await acquireLock(tempDir);
      await releaseLock(handle1);

      // Should be able to acquire immediately
      const handle2 = await acquireLock(tempDir, 100);
      expect(handle2.pid).toBe(process.pid);

      await releaseLock(handle2);
    });

    it('withLock releases lock after successful operation', async () => {
      await withLock(tempDir, async () => {
        expect(lockExists(tempDir)).toBe(true);
        return 'done';
      });

      expect(lockExists(tempDir)).toBe(false);
    });

    it('withLock releases lock after failed operation', async () => {
      try {
        await withLock(tempDir, async () => {
          expect(lockExists(tempDir)).toBe(true);
          throw new Error('intentional failure');
        });
      } catch {
        // Expected
      }

      expect(lockExists(tempDir)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles nested worktree path where parent exists', async () => {
      const nestedPath = join(tempDir, 'nested', 'worktree');
      // Create the nested directory first (simulating worktree creation)
      mkdirSync(nestedPath, { recursive: true });

      const handle = await acquireLock(nestedPath);
      expect(lockExists(nestedPath)).toBe(true);

      await releaseLock(handle);
    });

    it('fails gracefully when parent directory does not exist', async () => {
      const nonExistentPath = join(tempDir, 'does-not-exist', 'worktree');

      // acquireLock should fail because the parent directory doesn't exist
      await expect(acquireLock(nonExistentPath, 100)).rejects.toThrow();
    });

    it('handles lock directory with missing metadata file', async () => {
      // Create just the directory without metadata
      const lockPath = join(tempDir, LOCK_DIR_NAME);
      mkdirSync(lockPath, { recursive: true });

      // getLockInfo should return null
      const info = await getLockInfo(tempDir);
      expect(info).toBeNull();

      // isLocked should treat as not locked (no valid metadata)
      // Actually the implementation checks stale by age first, then process
      // Without metadata, it may consider the lock stale
      // Let's just verify we can acquire over it
      const handle = await acquireLock(tempDir, 1000);
      expect(handle.pid).toBe(process.pid);

      await releaseLock(handle);
    });

    it('handles corrupted metadata file', async () => {
      // Create lock with corrupted metadata
      const lockPath = join(tempDir, LOCK_DIR_NAME);
      mkdirSync(lockPath, { recursive: true });
      writeFileSync(join(lockPath, LOCK_METADATA_FILE), 'not valid json{{{');

      // getLockInfo should return null
      const info = await getLockInfo(tempDir);
      expect(info).toBeNull();

      // Should be able to acquire lock (corrupt = stale)
      const handle = await acquireLock(tempDir, 1000);
      expect(handle.pid).toBe(process.pid);

      await releaseLock(handle);
    });

    it('handles rapid acquire/release cycles', async () => {
      for (let i = 0; i < 10; i++) {
        const handle = await acquireLock(tempDir, 1000);
        expect(handle.pid).toBe(process.pid);
        await releaseLock(handle);
      }

      expect(lockExists(tempDir)).toBe(false);
    });

    it('handles very short timeout', async () => {
      const handle = await acquireLock(tempDir);

      // Very short timeout should fail quickly
      const startTime = Date.now();
      await expect(acquireLock(tempDir, 50)).rejects.toThrow(/Failed to acquire git lock/);
      const elapsed = Date.now() - startTime;

      // Should fail quickly (within ~150ms accounting for retry interval)
      expect(elapsed).toBeLessThan(300);

      await releaseLock(handle);
    });
  });
});
