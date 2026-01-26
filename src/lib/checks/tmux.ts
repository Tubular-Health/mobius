import { execa } from 'execa';
import which from 'which';
import type { CheckResult } from '../../types.js';

export async function checkTmux(): Promise<CheckResult> {
  const name = 'tmux';

  // Check if tmux is in PATH
  try {
    await which('tmux');
  } catch {
    return {
      name,
      status: 'fail',
      message: 'Not found',
      required: false,
      details:
        'Required for parallel execution mode. Install with: brew install tmux (macOS) or apt install tmux (Linux)',
    };
  }

  // Check if it's working and get version
  try {
    const { stdout } = await execa('tmux', ['-V'], { timeout: 5000 });
    const version = stdout.trim();
    return {
      name,
      status: 'pass',
      message: `Available (${version})`,
      required: false,
    };
  } catch (error) {
    return {
      name,
      status: 'fail',
      message: 'Found but not responding',
      required: false,
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
