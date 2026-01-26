import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { execa } from 'execa';
import type { ExecutionConfig } from '../types.js';

export interface WorktreeInfo {
  path: string;
  branch: string;
  taskId: string;
  created: boolean; // false if resumed existing worktree
}

/**
 * Get repository name from git remote or current directory
 */
export async function getRepoName(): Promise<string> {
  try {
    // Try to get repo name from git remote
    const { stdout } = await execa('git', ['remote', 'get-url', 'origin']);
    const url = stdout.trim();

    // Extract repo name from URL (handles both HTTPS and SSH)
    // https://github.com/user/repo.git -> repo
    // git@github.com:user/repo.git -> repo
    const match = url.match(/\/([^/]+?)(?:\.git)?$/) || url.match(/:([^/]+?)(?:\.git)?$/);
    if (match) {
      return match[1];
    }
  } catch {
    // No remote, fall back to directory name
  }

  // Fall back to current directory name
  return basename(process.cwd());
}

/**
 * Get the worktree path for a given task
 */
export async function getWorktreePath(taskId: string, config: ExecutionConfig): Promise<string> {
  const worktreePathTemplate = config.worktree_path ?? '../<repo>-worktrees/';
  const repoName = await getRepoName();

  // Replace <repo> placeholder with actual repo name
  const basePath = worktreePathTemplate.replace('<repo>', repoName);

  // Resolve path relative to current working directory
  return resolve(process.cwd(), basePath, taskId);
}

/**
 * Check if a worktree already exists for the given task
 */
export async function worktreeExists(taskId: string, config: ExecutionConfig): Promise<boolean> {
  const worktreePath = await getWorktreePath(taskId, config);
  return existsSync(worktreePath);
}

/**
 * Check if a git branch exists (locally or remotely)
 */
async function branchExists(branchName: string): Promise<{ local: boolean; remote: boolean }> {
  let local = false;
  let remote = false;

  try {
    // Check local branches
    const { stdout: localBranches } = await execa('git', ['branch', '--list', branchName]);
    local = localBranches.trim().length > 0;
  } catch {
    // Ignore errors
  }

  try {
    // Check remote branches
    const { stdout: remoteBranches } = await execa('git', [
      'branch',
      '-r',
      '--list',
      `origin/${branchName}`,
    ]);
    remote = remoteBranches.trim().length > 0;
  } catch {
    // Ignore errors
  }

  return { local, remote };
}

/**
 * Create a worktree for the given task
 */
export async function createWorktree(
  taskId: string,
  branchName: string,
  config: ExecutionConfig
): Promise<WorktreeInfo> {
  const worktreePath = await getWorktreePath(taskId, config);
  const baseBranch = config.base_branch ?? 'main';

  // Check if worktree already exists (resume scenario)
  if (existsSync(worktreePath)) {
    return {
      path: worktreePath,
      branch: branchName,
      taskId,
      created: false,
    };
  }

  // Check if branch already exists
  const branch = await branchExists(branchName);

  if (branch.local) {
    // Branch exists locally, create worktree pointing to it
    await execa('git', ['worktree', 'add', worktreePath, branchName]);
  } else if (branch.remote) {
    // Branch exists on remote, create worktree tracking remote
    await execa('git', ['worktree', 'add', worktreePath, branchName]);
  } else {
    // Create new branch off base branch
    await execa('git', ['worktree', 'add', worktreePath, '-b', branchName, baseBranch]);
  }

  return {
    path: worktreePath,
    branch: branchName,
    taskId,
    created: true,
  };
}

/**
 * Remove a worktree for the given task
 */
export async function removeWorktree(taskId: string, config: ExecutionConfig): Promise<void> {
  const worktreePath = await getWorktreePath(taskId, config);

  if (!existsSync(worktreePath)) {
    return; // Already removed or never existed
  }

  await execa('git', ['worktree', 'remove', worktreePath, '--force']);
}

/**
 * List all existing worktrees
 */
export async function listWorktrees(): Promise<
  Array<{ path: string; branch: string; head: string }>
> {
  const { stdout } = await execa('git', ['worktree', 'list', '--porcelain']);

  const worktrees: Array<{ path: string; branch: string; head: string }> = [];
  let current: { path?: string; branch?: string; head?: string } = {};

  for (const line of stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      current.path = line.substring(9);
    } else if (line.startsWith('HEAD ')) {
      current.head = line.substring(5);
    } else if (line.startsWith('branch ')) {
      current.branch = line.substring(7).replace('refs/heads/', '');
    } else if (line === '') {
      if (current.path && current.branch && current.head) {
        worktrees.push({
          path: current.path,
          branch: current.branch,
          head: current.head,
        });
      }
      current = {};
    }
  }

  return worktrees;
}

/**
 * Prune stale worktree references
 */
export async function pruneWorktrees(): Promise<void> {
  await execa('git', ['worktree', 'prune']);
}
