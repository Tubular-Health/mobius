import { execa } from 'execa';
import which from 'which';
import type { CheckResult } from '../../types.js';

/**
 * Check git installation and repository configuration
 */
export async function checkGit(): Promise<CheckResult> {
  const name = 'Git';

  // Check 1: git command exists
  try {
    await which('git');
  } catch {
    return {
      name,
      status: 'fail',
      message: 'Git not found in PATH',
      required: true,
      details: 'Install Git from https://git-scm.com',
    };
  }

  // Check 2: we're in a git repository
  try {
    await execa('git', ['rev-parse', '--git-dir'], { timeout: 5000 });
  } catch {
    return {
      name,
      status: 'fail',
      message: 'Not in a git repository',
      required: true,
      details: 'Run mobius from within a git repository',
    };
  }

  // Check 3: git remote is configured (needed for worktree naming)
  try {
    const { stdout } = await execa('git', ['remote', 'get-url', 'origin'], { timeout: 5000 });
    const remote = stdout.trim();

    // Extract repo name for display (handles both HTTPS and SSH URLs)
    const match = remote.match(/\/([^/]+?)(?:\.git)?$/) || remote.match(/:([^/]+?)(?:\.git)?$/);
    const repoName = match ? match[1] : 'configured';

    return {
      name,
      status: 'pass',
      message: `Repository: ${repoName}`,
      required: true,
    };
  } catch {
    return {
      name,
      status: 'fail',
      message: 'No git remote configured',
      required: true,
      details: 'Run: git remote add origin <your-repo-url>',
    };
  }
}
