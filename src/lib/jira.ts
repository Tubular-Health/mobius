/**
 * Jira API integration for fetching issues and sub-tasks
 *
 * Uses the jira.js SDK (Version3Client) for direct Jira API access.
 * Credentials are read from environment variables:
 * - JIRA_HOST: Jira instance hostname (e.g., "yourcompany.atlassian.net")
 * - JIRA_EMAIL: User email for API authentication
 * - JIRA_API_TOKEN: Jira API token
 */

import chalk from 'chalk';
import { Version3Client } from 'jira.js';
import type { ParentIssue } from './linear.js';
import type { LinearIssue } from './task-graph.js';

/**
 * Jira issue link structure from SDK response
 */
interface JiraIssueLink {
  type?: {
    name?: string;
    inward?: string;
    outward?: string;
  };
  inwardIssue?: {
    key?: string;
    id?: string;
  };
  outwardIssue?: {
    key?: string;
    id?: string;
  };
}

/**
 * Get a Jira client instance
 *
 * Reads credentials from environment variables:
 * - JIRA_HOST: Jira instance hostname (e.g., "yourcompany.atlassian.net")
 * - JIRA_EMAIL: User email for API authentication
 * - JIRA_API_TOKEN: Jira API token
 */
export function getJiraClient(): Version3Client | null {
  const host = process.env.JIRA_HOST;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;

  if (!host) {
    console.error(chalk.red('JIRA_HOST environment variable is not set'));
    return null;
  }
  if (!email) {
    console.error(chalk.red('JIRA_EMAIL environment variable is not set'));
    return null;
  }
  if (!apiToken) {
    console.error(chalk.red('JIRA_API_TOKEN environment variable is not set'));
    return null;
  }

  // Normalize host - ensure it has https:// prefix
  const normalizedHost = host.startsWith('https://') ? host : `https://${host}`;

  return new Version3Client({
    host: normalizedHost,
    authentication: {
      basic: {
        email,
        apiToken,
      },
    },
  });
}

/**
 * Fetch a Jira issue by key (e.g., PROJ-123)
 */
export async function fetchJiraIssue(taskId: string): Promise<ParentIssue | null> {
  const client = getJiraClient();
  if (!client) {
    return null;
  }

  try {
    const issue = await client.issues.getIssue({
      issueIdOrKey: taskId,
    });

    if (!issue) {
      return null;
    }

    // Generate a git branch name from the issue key
    const branchName = `feature/${taskId.toLowerCase()}`;

    return {
      id: issue.id ?? taskId,
      identifier: issue.key ?? taskId,
      title: issue.fields?.summary ?? '',
      gitBranchName: branchName,
    };
  } catch (error) {
    console.error(
      chalk.gray(`Failed to fetch Jira issue: ${error instanceof Error ? error.message : String(error)}`)
    );
    return null;
  }
}

/**
 * Fetch Jira sub-tasks (children) of a parent issue
 *
 * In Jira, sub-tasks can be:
 * 1. Issues with issuetype.subtask = true and a parent reference
 * 2. Issues linked via "Blocks" link type
 *
 * This function fetches both and maps them to the LinearIssue structure
 * for compatibility with the task graph.
 */
export async function fetchJiraSubTasks(parentKey: string): Promise<LinearIssue[] | null> {
  const client = getJiraClient();
  if (!client) {
    return null;
  }

  try {
    // Use the new JQL enhanced search API (the old /rest/api/3/search was deprecated Aug 2025)
    // See: https://developer.atlassian.com/changelog/#CHANGE-2046
    const searchResponse = await client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
      jql: `parent = ${parentKey}`,
      fields: ['summary', 'status', 'issuelinks', 'issuetype'],
    });

    const subTasks: LinearIssue[] = [];

    if (searchResponse.issues) {
      for (const issue of searchResponse.issues) {
        const blockedBy = extractBlockedByRelations(issue.fields?.issuelinks as JiraIssueLink[] | undefined);

        subTasks.push({
          id: issue.id ?? '',
          identifier: issue.key ?? '',
          title: issue.fields?.summary ?? '',
          status: (issue.fields?.status as { name?: string })?.name ?? 'To Do',
          gitBranchName: `feature/${(issue.key ?? '').toLowerCase()}`,
          relations: {
            blockedBy,
          },
        });
      }
    }

    return subTasks;
  } catch (error) {
    // Provide detailed error info for debugging
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.gray(`Failed to fetch Jira sub-tasks: ${errorMessage}`));

    // Try to extract HTTP status from jira.js error object
    const httpError = error as { status?: number; response?: { status?: number; data?: unknown } };
    const status = httpError.status ?? httpError.response?.status;
    if (status) {
      console.error(chalk.gray(`  → HTTP status: ${status}`));
    }

    // Check for common Jira API error patterns
    if (status === 401 || errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
      console.error(chalk.gray('  → Authentication failed. Check JIRA_EMAIL and JIRA_API_TOKEN'));
    } else if (status === 403 || errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
      console.error(chalk.gray('  → Permission denied. The API token may lack search permissions'));
    } else if (status === 404 || errorMessage.includes('404') || errorMessage.includes('not found')) {
      console.error(chalk.gray(`  → Issue ${parentKey} not found or not accessible`));
    } else if (errorMessage.includes('JQL')) {
      console.error(chalk.gray('  → JQL query error. The issue may not support sub-tasks'));
    }

    // Log response data if available for debugging
    if (httpError.response?.data) {
      console.error(chalk.gray(`  → Response: ${JSON.stringify(httpError.response.data)}`));
    }

    return null;
  }
}

/**
 * Extract blockedBy relations from Jira issue links
 *
 * In Jira, blocking relationships are represented via issue links with
 * types like "Blocks" where the inward description is "is blocked by"
 */
function extractBlockedByRelations(issuelinks: JiraIssueLink[] | undefined): Array<{ id: string; identifier: string }> {
  const blockedBy: Array<{ id: string; identifier: string }> = [];

  if (!issuelinks) {
    return blockedBy;
  }

  for (const link of issuelinks) {
    // Check for "is blocked by" relationship (inward link)
    // The inward description typically contains "is blocked by"
    if (
      link.inwardIssue &&
      link.inwardIssue.id &&
      link.inwardIssue.key &&
      (link.type?.inward?.toLowerCase().includes('blocked by') ||
        link.type?.name?.toLowerCase() === 'blocks')
    ) {
      blockedBy.push({
        id: link.inwardIssue.id,
        identifier: link.inwardIssue.key,
      });
    }
  }

  return blockedBy;
}
