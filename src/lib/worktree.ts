import { existsSync, symlinkSync, lstatSync } from 'node:fs';
import { basename, resolve, join } from 'node:path';
import { execa } from 'execa';
import type { ExecutionConfig } from '../types.js';

/** Directories to symlink from source repo to worktree (gitignored but needed) */
const SYMLINK_DIRS = ['.claude'];

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
 * Get the git repository root (handles both main repo and worktrees)
 *
 * If we're in a worktree, this returns the main repo's path, not the worktree path.
 * This ensures consistent worktree path calculation regardless of where mobius is run from.
 */
async function getGitRepoRoot(): Promise<string> {
  try {
    // First check if we're in a worktree
    const { stdout: gitDir } = await execa('git', ['rev-parse', '--git-dir']);
    const gitDirPath = gitDir.trim();

    // If .git is a file (not a directory), we're in a worktree
    // The file contains: "gitdir: /path/to/main/repo/.git/worktrees/xxx"
    if (!gitDirPath.startsWith('/') && gitDirPath !== '.git') {
      // Relative path like ".git" means we're in the main repo
      const { stdout: toplevel } = await execa('git', ['rev-parse', '--show-toplevel']);
      return toplevel.trim();
    }

    // Check if this is a worktree by looking for commondir
    try {
      const { stdout: commonDir } = await execa('git', ['rev-parse', '--git-common-dir']);
      const commonDirPath = commonDir.trim();

      // If common dir is different from git dir, we're in a worktree
      // The common dir points to the main repo's .git directory
      if (commonDirPath !== gitDirPath && commonDirPath !== '.git') {
        // Get the main repo root from the common dir
        // commonDir is like "/path/to/main/repo/.git"
        return resolve(commonDirPath, '..');
      }
    } catch {
      // No common dir, we're in main repo
    }

    // We're in the main repo
    const { stdout: toplevel } = await execa('git', ['rev-parse', '--show-toplevel']);
    return toplevel.trim();
  } catch {
    // Fallback to cwd if git commands fail
    return process.cwd();
  }
}

/**
 * Get the worktree path for a given task
 */
export async function getWorktreePath(taskId: string, config: ExecutionConfig): Promise<string> {
  const worktreePathTemplate = config.worktree_path ?? '../<repo>-worktrees/';
  const repoName = await getRepoName();

  // Replace <repo> placeholder with actual repo name
  const basePath = worktreePathTemplate.replace('<repo>', repoName);

  // Get the main repo root (not the worktree we might be in)
  const repoRoot = await getGitRepoRoot();

  // Resolve path relative to the main repo root
  return resolve(repoRoot, basePath, taskId);
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
 * Symlink gitignored directories from source repo to worktree
 *
 * This ensures directories like .claude (which are typically gitignored)
 * are available in the worktree for Claude Code to use.
 */
function symlinkGitignored(sourceRepo: string, worktreePath: string): void {
  for (const dir of SYMLINK_DIRS) {
    const sourcePath = join(sourceRepo, dir);
    const targetPath = join(worktreePath, dir);

    // Only symlink if source exists and target doesn't
    if (existsSync(sourcePath) && !existsSync(targetPath)) {
      try {
        // Check if source is a directory
        const stat = lstatSync(sourcePath);
        if (stat.isDirectory()) {
          symlinkSync(sourcePath, targetPath, 'dir');
        }
      } catch {
        // Non-fatal - continue without symlink
      }
    }
  }
}

/**
 * Get the actual default branch name from the repo
 */
async function getDefaultBranchName(): Promise<string | null> {
  try {
    // Try to get from origin HEAD reference
    const { stdout } = await execa('git', ['symbolic-ref', 'refs/remotes/origin/HEAD']);
    return stdout.trim().replace('refs/remotes/origin/', '');
  } catch {
    // Fall back to checking common branch names
    const commonBranches = ['main', 'master', 'develop'];
    for (const branch of commonBranches) {
      const exists = await branchExists(branch);
      if (exists.local || exists.remote) {
        return branch;
      }
    }
    return null;
  }
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
    // Need to create a new branch - determine the base branch
    let baseBranch = config.base_branch;

    if (!baseBranch) {
      // Try to auto-detect the default branch
      const detected = await getDefaultBranchName();
      if (detected) {
        baseBranch = detected;
      } else {
        // Could not detect - provide helpful error
        throw new Error(
          `Could not determine base branch for worktree creation.\n\n` +
          `This repository does not have a 'main' branch, and the default branch could not be detected.\n\n` +
          `Please set 'base_branch' in your mobius config:\n` +
          `  1. Run: mobius config -e\n` +
          `  2. Add under [execution]:\n` +
          `     base_branch = "master"  # or your default branch name\n`
        );
      }
    }

    // Verify the base branch exists before attempting to create worktree
    const baseExists = await branchExists(baseBranch);
    if (!baseExists.local && !baseExists.remote) {
      const detected = await getDefaultBranchName();
      const suggestion = detected ? `\n\nDetected '${detected}' as a possible default branch.` : '';

      throw new Error(
        `Base branch '${baseBranch}' does not exist in this repository.${suggestion}\n\n` +
        `Please update 'base_branch' in your mobius config:\n` +
        `  1. Run: mobius config -e\n` +
        `  2. Update under [execution]:\n` +
        `     base_branch = "${detected ?? 'your-default-branch'}"\n`
      );
    }

    // Create new branch off base branch
    await execa('git', ['worktree', 'add', worktreePath, '-b', branchName, baseBranch]);
  }

  // Symlink gitignored directories (like .claude) from source repo
  symlinkGitignored(process.cwd(), worktreePath);

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
