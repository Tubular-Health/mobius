import { execa } from 'execa';
import type { Backend, CheckResult } from '../../types.js';

export async function checkLinearMcp(backend: Backend): Promise<CheckResult> {
  const name = 'Linear MCP';

  if (backend !== 'linear') {
    return {
      name,
      status: 'skip',
      message: `Not needed (using ${backend} backend)`,
      required: false,
    };
  }

  // Try to check if Claude can access Linear MCP tools
  // This is a lightweight check - we can't fully verify without running Claude
  try {
    // Check if claude has MCP configured by looking at settings
    const { stdout } = await execa('claude', ['mcp', 'list'], {
      timeout: 10000,
      reject: false,
    });

    if (stdout.toLowerCase().includes('linear')) {
      return {
        name,
        status: 'pass',
        message: 'Linear MCP tools available',
        required: false,
      };
    }

    return {
      name,
      status: 'warn',
      message: 'Linear MCP not detected in Claude config',
      required: false,
      details: 'Linear MCP may be configured at project level. Run a test task to verify.',
    };
  } catch {
    return {
      name,
      status: 'warn',
      message: 'Could not verify Linear MCP status',
      required: false,
      details: 'Linear MCP may still work - run a test task to verify',
    };
  }
}
