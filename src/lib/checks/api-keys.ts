import type { CheckResult, Backend } from '../../types.js';

/**
 * Check API key configuration based on backend
 */
export async function checkApiKeys(backend: Backend): Promise<CheckResult> {
  if (backend === 'linear') {
    return checkLinearApiKey();
  } else if (backend === 'jira') {
    return checkJiraCredentials();
  }

  return {
    name: 'API Keys',
    status: 'skip',
    message: `Unknown backend: ${backend}`,
    required: false,
  };
}

function checkLinearApiKey(): CheckResult {
  const name = 'Linear API Key';
  const apiKey = process.env.LINEAR_API_KEY;

  if (!apiKey) {
    return {
      name,
      status: 'warn',
      message: 'LINEAR_API_KEY not set',
      required: false,
      details: 'Set: export LINEAR_API_KEY="lin_api_xxxxx" - Get key from https://linear.app/settings/api',
    };
  }

  // Basic format validation (Linear API keys start with "lin_api_")
  if (!apiKey.startsWith('lin_api_')) {
    return {
      name,
      status: 'warn',
      message: 'LINEAR_API_KEY may be invalid format',
      required: false,
      details: 'Linear API keys typically start with "lin_api_"',
    };
  }

  return {
    name,
    status: 'pass',
    message: 'Set (lin_api_***)',
    required: false,
  };
}

function checkJiraCredentials(): CheckResult {
  const name = 'Jira Credentials';
  const apiToken = process.env.JIRA_API_TOKEN;
  const email = process.env.JIRA_EMAIL;

  const missing: string[] = [];
  if (!apiToken) missing.push('JIRA_API_TOKEN');
  if (!email) missing.push('JIRA_EMAIL');

  if (missing.length > 0) {
    return {
      name,
      status: 'warn',
      message: `Missing: ${missing.join(', ')}`,
      required: false,
      details: `Set environment variables. Get API token from https://id.atlassian.com/manage-profile/security/api-tokens`,
    };
  }

  return {
    name,
    status: 'pass',
    message: 'Credentials configured',
    required: false,
  };
}
