/**
 * Linear API integration for fetching issues and sub-tasks
 */

import chalk from 'chalk';
import { LinearClient } from '@linear/sdk';
import type { LinearIssue } from './task-graph.js';

export interface ParentIssue {
  id: string;
  identifier: string;
  title: string;
  gitBranchName: string;
}

/**
 * Get a Linear client instance
 */
export function getLinearClient(): LinearClient | null {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error(chalk.red('LINEAR_API_KEY environment variable is not set'));
    return null;
  }
  return new LinearClient({ apiKey });
}

/**
 * Fetch a Linear issue by identifier (e.g., MOB-123)
 */
export async function fetchLinearIssue(taskId: string): Promise<ParentIssue | null> {
  const client = getLinearClient();
  if (!client) {
    return null;
  }

  try {
    const issue = await client.issue(taskId);

    if (!issue) {
      return null;
    }

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      gitBranchName: issue.branchName || `feature/${taskId.toLowerCase()}`,
    };
  } catch (error) {
    console.error(chalk.gray(`Failed to fetch issue: ${error instanceof Error ? error.message : String(error)}`));
    return null;
  }
}

/**
 * Fetch Linear sub-tasks (children) of a parent issue
 */
export async function fetchLinearSubTasks(parentId: string): Promise<LinearIssue[] | null> {
  const client = getLinearClient();
  if (!client) {
    return null;
  }

  try {
    // Fetch all child issues of the parent
    const issuesResponse = await client.issues({
      filter: {
        parent: { id: { eq: parentId } },
      },
    });

    const subTasks: LinearIssue[] = [];

    for (const issue of issuesResponse.nodes) {
      // Get the issue state
      const state = await issue.state;

      // Get blocking relations
      // inverseRelations() returns relations where this issue is the target
      // When type === 'blocks', it means the relatedIssue blocks this issue
      const inverseRelations = await issue.inverseRelations();
      const blockedByRelations: Array<{ id: string; identifier: string }> = [];

      for (const relation of inverseRelations.nodes) {
        if (relation.type === 'blocks') {
          // The related issue blocks this issue
          const relatedIssue = await relation.issue;
          if (relatedIssue) {
            blockedByRelations.push({
              id: relatedIssue.id,
              identifier: relatedIssue.identifier,
            });
          }
        }
      }

      subTasks.push({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        status: state?.name || 'Backlog',
        gitBranchName: issue.branchName,
        relations: {
          blockedBy: blockedByRelations,
        },
      });
    }

    return subTasks;
  } catch (error) {
    console.error(chalk.gray(`Failed to fetch sub-tasks: ${error instanceof Error ? error.message : String(error)}`));
    return null;
  }
}
