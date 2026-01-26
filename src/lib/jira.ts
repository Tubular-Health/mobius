/**
 * Jira API integration for fetching issues and sub-tasks
 *
 * Uses execa to call Claude with Jira MCP tools since there's no
 * direct Jira SDK integration. This mirrors the pattern used for
 * Linear but via MCP tool calls through Claude.
 */

import chalk from 'chalk';
import { execa } from 'execa';
import type { ParentIssue } from './linear.js';
import type { LinearIssue } from './task-graph.js';

/**
 * Jira issue response structure from MCP tool
 */
interface JiraIssueResponse {
  key: string;
  id: string;
  fields: {
    summary: string;
    status: {
      name: string;
    };
    issuetype?: {
      name: string;
      subtask?: boolean;
    };
    parent?: {
      key: string;
      id: string;
    };
    issuelinks?: Array<{
      type: {
        name: string;
        inward: string;
        outward: string;
      };
      inwardIssue?: {
        key: string;
        id: string;
      };
      outwardIssue?: {
        key: string;
        id: string;
      };
    }>;
    subtasks?: Array<{
      key: string;
      id: string;
      fields: {
        summary: string;
        status: {
          name: string;
        };
      };
    }>;
  };
}

/**
 * Parse Claude MCP response to extract JSON result
 */
function parseMcpResponse<T>(response: string): T | null {
  try {
    // Claude with --output-format json returns structured response
    const parsed = JSON.parse(response);
    // The actual result may be nested in the response
    if (parsed.result) {
      return parsed.result as T;
    }
    return parsed as T;
  } catch {
    // Try to extract JSON from the response text
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Fetch a Jira issue by key (e.g., PROJ-123)
 */
export async function fetchJiraIssue(taskId: string): Promise<ParentIssue | null> {
  try {
    const prompt = `Use the mcp__plugin_jira_jira__get_issue tool to fetch the Jira issue with key "${taskId}". Return ONLY the raw JSON response from the tool, no additional text or formatting.`;

    const result = await execa('claude', ['-p', '--output-format', 'json'], {
      input: prompt,
      timeout: 30000,
    });

    const issue = parseMcpResponse<JiraIssueResponse>(result.stdout);
    if (!issue) {
      console.error(chalk.gray('Failed to parse Jira issue response'));
      return null;
    }

    // Generate a git branch name from the issue key
    const branchName = `feature/${taskId.toLowerCase()}`;

    return {
      id: issue.id,
      identifier: issue.key,
      title: issue.fields.summary,
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
  try {
    // First, get the parent issue to find its subtasks and linked issues
    const parentPrompt = `Use the mcp__plugin_jira_jira__get_issue tool to fetch the Jira issue with key "${parentKey}" including its subtasks and issue links. Return ONLY the raw JSON response from the tool, no additional text or formatting.`;

    const parentResult = await execa('claude', ['-p', '--output-format', 'json'], {
      input: parentPrompt,
      timeout: 30000,
    });

    const parentIssue = parseMcpResponse<JiraIssueResponse>(parentResult.stdout);
    if (!parentIssue) {
      console.error(chalk.gray('Failed to parse parent Jira issue'));
      return null;
    }

    const subTasks: LinearIssue[] = [];

    // Process direct subtasks
    if (parentIssue.fields.subtasks) {
      for (const subtask of parentIssue.fields.subtasks) {
        // Fetch full subtask details to get issue links
        const subtaskPrompt = `Use the mcp__plugin_jira_jira__get_issue tool to fetch the Jira issue with key "${subtask.key}" including its issue links. Return ONLY the raw JSON response from the tool, no additional text or formatting.`;

        const subtaskResult = await execa('claude', ['-p', '--output-format', 'json'], {
          input: subtaskPrompt,
          timeout: 30000,
        });

        const fullSubtask = parseMcpResponse<JiraIssueResponse>(subtaskResult.stdout);
        if (fullSubtask) {
          const blockedBy = extractBlockedByRelations(fullSubtask);

          subTasks.push({
            id: fullSubtask.id,
            identifier: fullSubtask.key,
            title: fullSubtask.fields.summary,
            status: fullSubtask.fields.status.name,
            gitBranchName: `feature/${fullSubtask.key.toLowerCase()}`,
            relations: {
              blockedBy,
            },
          });
        }
      }
    }

    // Also search for issues linked as sub-tasks via JQL
    // This handles cases where issues aren't true Jira subtasks but are linked
    const searchPrompt = `Use the mcp__plugin_jira_jira__search_issues tool with JQL "parent = ${parentKey}" to find all sub-tasks. Return ONLY the raw JSON response from the tool, no additional text or formatting.`;

    try {
      const searchResult = await execa('claude', ['-p', '--output-format', 'json'], {
        input: searchPrompt,
        timeout: 30000,
      });

      const searchResponse = parseMcpResponse<{ issues: JiraIssueResponse[] }>(searchResult.stdout);
      if (searchResponse?.issues) {
        for (const issue of searchResponse.issues) {
          // Skip if already added from subtasks array
          if (subTasks.some(t => t.id === issue.id)) {
            continue;
          }

          const blockedBy = extractBlockedByRelations(issue);

          subTasks.push({
            id: issue.id,
            identifier: issue.key,
            title: issue.fields.summary,
            status: issue.fields.status.name,
            gitBranchName: `feature/${issue.key.toLowerCase()}`,
            relations: {
              blockedBy,
            },
          });
        }
      }
    } catch {
      // JQL search may fail if no results, continue with subtasks we have
    }

    return subTasks;
  } catch (error) {
    console.error(
      chalk.gray(`Failed to fetch Jira sub-tasks: ${error instanceof Error ? error.message : String(error)}`)
    );
    return null;
  }
}

/**
 * Extract blockedBy relations from Jira issue links
 *
 * In Jira, blocking relationships are represented via issue links with
 * types like "Blocks" where the inward description is "is blocked by"
 */
function extractBlockedByRelations(issue: JiraIssueResponse): Array<{ id: string; identifier: string }> {
  const blockedBy: Array<{ id: string; identifier: string }> = [];

  if (!issue.fields.issuelinks) {
    return blockedBy;
  }

  for (const link of issue.fields.issuelinks) {
    // Check for "is blocked by" relationship (inward link)
    // The inward description typically contains "is blocked by"
    if (
      link.inwardIssue &&
      (link.type.inward.toLowerCase().includes('blocked by') ||
        link.type.name.toLowerCase() === 'blocks')
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
 * Post a Mermaid diagram as a comment on a Jira issue
 */
export async function postJiraDiagram(taskId: string, mermaidDiagram: string): Promise<void> {
  try {
    // Jira comments use Atlassian Document Format (ADF) or wiki markup
    // For simplicity, we'll post the mermaid as a code block
    const commentBody = `h3. Task Dependency Graph

{code:title=Mermaid Diagram}
${mermaidDiagram}
{code}

_Generated by Mobius Loop_`;

    const prompt = `Use the mcp__plugin_jira_jira__add_comment tool to add a comment to Jira issue "${taskId}" with the following body:

${commentBody}

Return ONLY the raw JSON response from the tool, no additional text or formatting.`;

    await execa('claude', ['-p', '--output-format', 'json'], {
      input: prompt,
      timeout: 30000,
    });

    console.log(chalk.gray('Posted task dependency diagram to Jira'));
  } catch (error) {
    // Non-fatal error
    console.log(chalk.gray('Could not post diagram to Jira'));
  }
}
