import { execa } from 'execa';
import type { CheckResult, Backend } from '../../types.js';

export async function checkJiraMcp(backend: Backend): Promise<CheckResult> {
  const name = 'Jira MCP';

  if (backend !== 'jira') {
    return {
      name,
      status: 'skip',
      message: `Not needed (using ${backend} backend)`,
      required: false,
    };
  }

  // Try to check if Claude can access Jira MCP tools
  // This is a lightweight check - we can't fully verify without running Claude
  try {
    // Check if claude has MCP configured by looking at settings
    const { stdout } = await execa('claude', ['mcp', 'list'], {
      timeout: 10000,
      reject: false,
    });

    if (stdout.toLowerCase().includes('jira')) {
      return {
        name,
        status: 'pass',
        message: 'Jira MCP tools available',
        required: false,
      };
    }

    return {
      name,
      status: 'warn',
      message: 'Jira MCP not detected in Claude config',
      required: false,
      details: 'Jira MCP may be configured at project level. Run a test task to verify.',
    };
  } catch {
    return {
      name,
      status: 'warn',
      message: 'Could not verify Jira MCP status',
      required: false,
      details: 'Jira MCP may still work - run a test task to verify',
    };
  }
}
