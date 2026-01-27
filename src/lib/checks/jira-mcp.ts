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

  // Try to check if Claude can access Atlassian Jira plugin tools
  // This is a lightweight check - we can't fully verify without running Claude
  try {
    // Check if claude has MCP configured by looking at settings
    const { stdout } = await execa('claude', ['mcp', 'list'], {
      timeout: 10000,
      reject: false,
    });

    if (stdout.toLowerCase().includes('atlassian')) {
      return {
        name,
        status: 'pass',
        message: 'Atlassian Jira plugin available',
        required: false,
      };
    }

    return {
      name,
      status: 'warn',
      message: 'Atlassian Jira plugin not detected in Claude config',
      required: false,
      details: 'Atlassian plugin may be configured at project level. Run a test task to verify.',
    };
  } catch {
    return {
      name,
      status: 'warn',
      message: 'Could not verify Atlassian Jira plugin status',
      required: false,
      details: 'Atlassian Jira plugin may still work - run a test task to verify',
    };
  }
}
