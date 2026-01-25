import { execa } from 'execa';
import which from 'which';
import type { CheckResult } from '../../types.js';

export async function checkClaude(): Promise<CheckResult> {
  const name = 'Claude CLI';

  // Check if claude is in PATH
  try {
    await which('claude');
  } catch {
    return {
      name,
      status: 'fail',
      message: 'Claude CLI not found in PATH',
      required: true,
      details: 'Install with: npm install -g @anthropic-ai/claude-code',
    };
  }

  // Check if it's working
  try {
    const { stdout } = await execa('claude', ['--version'], { timeout: 10000 });
    return {
      name,
      status: 'pass',
      message: `Installed (${stdout.trim()})`,
      required: true,
    };
  } catch (error) {
    return {
      name,
      status: 'fail',
      message: 'Claude CLI found but not responding',
      required: true,
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
