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
import { Version3Client, type Version3Parameters } from 'jira.js';
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
      chalk.gray(
        `Failed to fetch Jira issue: ${error instanceof Error ? error.message : String(error)}`
      )
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
        const blockedBy = extractBlockedByRelations(
          issue.fields?.issuelinks as JiraIssueLink[] | undefined
        );

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
    } else if (
      status === 403 ||
      errorMessage.includes('403') ||
      errorMessage.includes('Forbidden')
    ) {
      console.error(chalk.gray('  → Permission denied. The API token may lack search permissions'));
    } else if (
      status === 404 ||
      errorMessage.includes('404') ||
      errorMessage.includes('not found')
    ) {
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
function extractBlockedByRelations(
  issuelinks: JiraIssueLink[] | undefined
): Array<{ id: string; identifier: string }> {
  const blockedBy: Array<{ id: string; identifier: string }> = [];

  if (!issuelinks) {
    return blockedBy;
  }

  for (const link of issuelinks) {
    // Check for "is blocked by" relationship (inward link)
    // The inward description typically contains "is blocked by"
    if (
      link.inwardIssue?.id &&
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

/**
 * Create a single Jira issue link (blocking relationship)
 *
 * Creates a "Blocks" link where the blocker issue blocks the blocked issue.
 * In Jira terminology:
 * - outwardIssue = the blocker (this issue "blocks" the other)
 * - inwardIssue = the blocked issue (this issue "is blocked by" the blocker)
 *
 * @param blockerKey - The issue key that is blocking (e.g., "PROJ-123")
 * @param blockedKey - The issue key that is blocked (e.g., "PROJ-124")
 * @returns true if link was created successfully, false otherwise
 */
export async function createJiraIssueLink(
  blockerKey: string,
  blockedKey: string
): Promise<boolean> {
  const client = getJiraClient();
  if (!client) {
    return false;
  }

  try {
    await client.issueLinks.linkIssues({
      type: { name: 'Blocks' },
      outwardIssue: { key: blockerKey },
      inwardIssue: { key: blockedKey },
    });

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.gray(`Failed to create Jira issue link: ${errorMessage}`));

    const httpError = error as { status?: number; response?: { status?: number; data?: unknown } };
    const status = httpError.status ?? httpError.response?.status;
    if (status) {
      console.error(chalk.gray(`  → HTTP status: ${status}`));
    }

    if (status === 401 || errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
      console.error(chalk.gray('  → Authentication failed. Check JIRA_EMAIL and JIRA_API_TOKEN'));
    } else if (
      status === 403 ||
      errorMessage.includes('403') ||
      errorMessage.includes('Forbidden')
    ) {
      console.error(
        chalk.gray('  → Permission denied. The API token may lack link creation permissions')
      );
    } else if (
      status === 404 ||
      errorMessage.includes('404') ||
      errorMessage.includes('not found')
    ) {
      console.error(
        chalk.gray(`  → Issue ${blockerKey} or ${blockedKey} not found or not accessible`)
      );
    }

    if (httpError.response?.data) {
      console.error(chalk.gray(`  → Response: ${JSON.stringify(httpError.response.data)}`));
    }

    return false;
  }
}

/**
 * Create multiple Jira issue links (batch operation)
 *
 * Creates "Blocks" links for an array of blocker/blocked pairs.
 * Continues processing even if individual links fail, returning aggregate results.
 *
 * @param links - Array of link objects with blocker and blocked issue keys
 * @returns Object with success and failed counts
 */
export async function createJiraIssueLinks(
  links: Array<{ blocker: string; blocked: string }>
): Promise<{ success: number; failed: number }> {
  const results = { success: 0, failed: 0 };

  for (const link of links) {
    const created = await createJiraIssueLink(link.blocker, link.blocked);
    if (created) {
      results.success++;
    } else {
      results.failed++;
    }
  }

  return results;
}

/**
 * Result of a Jira issue creation
 */
export interface JiraCreatedIssue {
  id: string;
  key: string;
  self: string;
}

/**
 * Options for creating a Jira issue
 */
export interface CreateJiraIssueOptions {
  projectKey: string;
  issueTypeName: string;
  summary: string;
  description?: string;
  parentKey?: string;
  labels?: string[];
  assigneeId?: string;
}

/**
 * Create a new Jira issue
 *
 * Creates an issue with the specified fields. For sub-tasks, provide a parentKey.
 * The SDK automatically converts string descriptions to Atlassian Document Format.
 *
 * @param options - Issue creation options
 * @returns Created issue details or null on failure
 */
export async function createJiraIssue(
  options: CreateJiraIssueOptions
): Promise<JiraCreatedIssue | null> {
  const client = getJiraClient();
  if (!client) {
    return null;
  }

  try {
    const fields: Record<string, unknown> = {
      project: { key: options.projectKey },
      issuetype: { name: options.issueTypeName },
      summary: options.summary,
    };

    if (options.description) {
      fields.description = options.description;
    }

    if (options.parentKey) {
      fields.parent = { key: options.parentKey };
    }

    if (options.labels && options.labels.length > 0) {
      fields.labels = options.labels;
    }

    if (options.assigneeId) {
      fields.assignee = { id: options.assigneeId };
    }

    const result = await client.issues.createIssue({
      fields: fields as Version3Parameters.CreateIssue['fields'],
    });

    return {
      id: result.id,
      key: result.key,
      self: result.self,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.gray(`Failed to create Jira issue: ${errorMessage}`));

    const httpError = error as { status?: number; response?: { status?: number; data?: unknown } };
    const status = httpError.status ?? httpError.response?.status;
    if (status) {
      console.error(chalk.gray(`  → HTTP status: ${status}`));
    }

    if (status === 401 || errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
      console.error(chalk.gray('  → Authentication failed. Check JIRA_EMAIL and JIRA_API_TOKEN'));
    } else if (
      status === 403 ||
      errorMessage.includes('403') ||
      errorMessage.includes('Forbidden')
    ) {
      console.error(
        chalk.gray('  → Permission denied. The API token may lack issue creation permissions')
      );
    } else if (status === 400 || errorMessage.includes('400')) {
      console.error(
        chalk.gray('  → Invalid request. Check project key, issue type, and required fields')
      );
    }

    if (httpError.response?.data) {
      console.error(chalk.gray(`  → Response: ${JSON.stringify(httpError.response.data)}`));
    }

    return null;
  }
}

/**
 * Update a Jira issue's status using the transitions API
 *
 * Jira status changes require using transitions. This function:
 * 1. Fetches available transitions for the issue
 * 2. Finds a transition matching the target status name
 * 3. Performs the transition
 *
 * @param issueKeyOrId - The issue key (e.g., "PROJ-123") or ID
 * @param targetStatusName - The target status name (e.g., "In Progress", "Done")
 * @returns true if transition succeeded, false otherwise
 */
export async function updateJiraIssueStatus(
  issueKeyOrId: string,
  targetStatusName: string
): Promise<boolean> {
  const client = getJiraClient();
  if (!client) {
    return false;
  }

  try {
    // Get available transitions for this issue
    const transitionsResponse = await client.issues.getTransitions({
      issueIdOrKey: issueKeyOrId,
    });

    const transitions = transitionsResponse.transitions ?? [];

    // Find the transition that leads to the target status
    // Match by transition name or target status name (case-insensitive)
    const targetLower = targetStatusName.toLowerCase();
    const matchingTransition = transitions.find(
      (t) => t.name?.toLowerCase() === targetLower || t.to?.name?.toLowerCase() === targetLower
    );

    if (!matchingTransition || !matchingTransition.id) {
      const availableTransitions = transitions.map((t) => `${t.name} → ${t.to?.name}`).join(', ');
      console.error(
        chalk.gray(
          `No transition found to status "${targetStatusName}". Available: ${availableTransitions || 'none'}`
        )
      );
      return false;
    }

    // Perform the transition
    await client.issues.doTransition({
      issueIdOrKey: issueKeyOrId,
      transition: { id: matchingTransition.id },
    });

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.gray(`Failed to update Jira issue status: ${errorMessage}`));

    const httpError = error as { status?: number; response?: { status?: number; data?: unknown } };
    const status = httpError.status ?? httpError.response?.status;
    if (status) {
      console.error(chalk.gray(`  → HTTP status: ${status}`));
    }

    if (status === 401 || errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
      console.error(chalk.gray('  → Authentication failed. Check JIRA_EMAIL and JIRA_API_TOKEN'));
    } else if (
      status === 403 ||
      errorMessage.includes('403') ||
      errorMessage.includes('Forbidden')
    ) {
      console.error(
        chalk.gray('  → Permission denied. The API token may lack transition permissions')
      );
    } else if (
      status === 404 ||
      errorMessage.includes('404') ||
      errorMessage.includes('not found')
    ) {
      console.error(chalk.gray(`  → Issue ${issueKeyOrId} not found or not accessible`));
    }

    if (httpError.response?.data) {
      console.error(chalk.gray(`  → Response: ${JSON.stringify(httpError.response.data)}`));
    }

    return false;
  }
}

/**
 * Result of adding a comment to a Jira issue
 */
export interface JiraCommentResult {
  id: string;
  self: string;
}

/**
 * Add a comment to a Jira issue
 *
 * The SDK automatically converts string comments to Atlassian Document Format.
 *
 * @param issueKeyOrId - The issue key (e.g., "PROJ-123") or ID
 * @param body - The comment body (plain text or markdown)
 * @returns Comment details or null on failure
 */
export async function addJiraComment(
  issueKeyOrId: string,
  body: string
): Promise<JiraCommentResult | null> {
  const client = getJiraClient();
  if (!client) {
    return null;
  }

  try {
    const result = await client.issueComments.addComment({
      issueIdOrKey: issueKeyOrId,
      comment: body,
    });

    return {
      id: result.id ?? '',
      self: result.self ?? '',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.gray(`Failed to add Jira comment: ${errorMessage}`));

    const httpError = error as { status?: number; response?: { status?: number; data?: unknown } };
    const status = httpError.status ?? httpError.response?.status;
    if (status) {
      console.error(chalk.gray(`  → HTTP status: ${status}`));
    }

    if (status === 401 || errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
      console.error(chalk.gray('  → Authentication failed. Check JIRA_EMAIL and JIRA_API_TOKEN'));
    } else if (
      status === 403 ||
      errorMessage.includes('403') ||
      errorMessage.includes('Forbidden')
    ) {
      console.error(
        chalk.gray('  → Permission denied. The API token may lack comment permissions')
      );
    } else if (
      status === 404 ||
      errorMessage.includes('404') ||
      errorMessage.includes('not found')
    ) {
      console.error(chalk.gray(`  → Issue ${issueKeyOrId} not found or not accessible`));
    }

    if (httpError.response?.data) {
      console.error(chalk.gray(`  → Response: ${JSON.stringify(httpError.response.data)}`));
    }

    return null;
  }
}
