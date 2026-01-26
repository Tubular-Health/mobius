import { execa } from 'execa';
import which from 'which';
import type { CheckResult } from '../../types.js';

/**
 * Check Node.js version (warn if < 18)
 */
export async function checkNodeVersion(): Promise<CheckResult> {
  const name = 'Node.js Version';

  try {
    const { stdout } = await execa('node', ['--version'], { timeout: 5000 });
    const version = stdout.trim().replace('v', '');
    const major = parseInt(version.split('.')[0], 10);

    if (major >= 18) {
      return {
        name,
        status: 'pass',
        message: `v${version}`,
        required: false,
      };
    }

    return {
      name,
      status: 'warn',
      message: `v${version} (18+ recommended)`,
      required: false,
      details: 'Some features may not work correctly with older Node.js versions',
    };
  } catch {
    return {
      name,
      status: 'warn',
      message: 'Could not determine Node.js version',
      required: false,
    };
  }
}

/**
 * Check if jq is available (used in bash scripts for state tracking)
 */
export async function checkJq(): Promise<CheckResult> {
  const name = 'jq Utility';

  try {
    await which('jq');
    const { stdout } = await execa('jq', ['--version'], { timeout: 5000 });
    return {
      name,
      status: 'pass',
      message: `Installed (${stdout.trim()})`,
      required: false,
    };
  } catch {
    return {
      name,
      status: 'warn',
      message: 'Not found',
      required: false,
      details: 'jq is used for state file operations. Install: brew install jq (macOS) or apt install jq (Linux)',
    };
  }
}
