/**
 * Linear API integration for fetching issues and sub-tasks
 */

import { IssueRelationType, LinearClient } from '@linear/sdk';
import chalk from 'chalk';
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
    console.error(
      chalk.gray(`Failed to fetch issue: ${error instanceof Error ? error.message : String(error)}`)
    );
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
    console.error(
      chalk.gray(
        `Failed to fetch sub-tasks: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    return null;
  }
}

/**
 * Result type for SDK operations
 */
export interface LinearOperationResult {
  success: boolean;
  id?: string;
  identifier?: string;
  error?: string;
}

/**
 * Input for creating a Linear issue
 */
export interface CreateLinearIssueInput {
  teamId: string;
  title: string;
  description?: string;
  parentId?: string;
  blockedBy?: string[];
  labels?: string[];
  priority?: number;
}

/**
 * Create a new Linear issue (typically a sub-task)
 */
export async function createLinearIssue(
  input: CreateLinearIssueInput
): Promise<LinearOperationResult> {
  const client = getLinearClient();
  if (!client) {
    return { success: false, error: 'LINEAR_API_KEY not set' };
  }

  try {
    const issuePayload = await client.createIssue({
      teamId: input.teamId,
      title: input.title,
      description: input.description,
      parentId: input.parentId,
      priority: input.priority,
      labelIds: input.labels,
    });

    const issue = await issuePayload.issue;

    if (!issue) {
      return { success: false, error: 'Failed to create issue - no issue returned' };
    }

    // Add blocking relations if specified
    // Note: We want to create relations where the blocker blocks the new issue
    // So we set the blocker as the issue that blocks, and the new issue as the one being blocked
    if (input.blockedBy && input.blockedBy.length > 0) {
      for (const blockerId of input.blockedBy) {
        await client.createIssueRelation({
          issueId: blockerId,
          relatedIssueId: issue.id,
          type: IssueRelationType.Blocks,
        });
      }
    }

    return {
      success: true,
      id: issue.id,
      identifier: issue.identifier,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.gray(`Failed to create issue: ${errorMessage}`));
    return { success: false, error: errorMessage };
  }
}

/**
 * Update the status of a Linear issue
 *
 * @param issueId - The Linear issue ID (UUID)
 * @param newStatus - The target status name (e.g., "In Progress", "Done")
 */
export async function updateLinearIssueStatus(
  issueId: string,
  newStatus: string
): Promise<LinearOperationResult> {
  const client = getLinearClient();
  if (!client) {
    return { success: false, error: 'LINEAR_API_KEY not set' };
  }

  try {
    // First, get the issue to find its team
    const issue = await client.issue(issueId);
    if (!issue) {
      return { success: false, error: `Issue not found: ${issueId}` };
    }

    const team = await issue.team;
    if (!team) {
      return { success: false, error: 'Could not determine issue team' };
    }

    // Get team's workflow states to find the target state ID
    const states = await team.states();
    const targetState = states.nodes.find(
      (state) => state.name.toLowerCase() === newStatus.toLowerCase()
    );

    if (!targetState) {
      const availableStates = states.nodes.map((s) => s.name).join(', ');
      return {
        success: false,
        error: `Status "${newStatus}" not found. Available: ${availableStates}`,
      };
    }

    // Update the issue status
    await client.updateIssue(issueId, {
      stateId: targetState.id,
    });

    return {
      success: true,
      id: issueId,
      identifier: issue.identifier,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.gray(`Failed to update issue status: ${errorMessage}`));
    return { success: false, error: errorMessage };
  }
}

/**
 * Add a comment to a Linear issue
 *
 * @param issueId - The Linear issue ID (UUID)
 * @param body - The comment body (supports Markdown)
 */
export async function addLinearComment(
  issueId: string,
  body: string
): Promise<LinearOperationResult> {
  const client = getLinearClient();
  if (!client) {
    return { success: false, error: 'LINEAR_API_KEY not set' };
  }

  try {
    const commentPayload = await client.createComment({
      issueId,
      body,
    });

    const comment = await commentPayload.comment;

    if (!comment) {
      return { success: false, error: 'Failed to create comment - no comment returned' };
    }

    return {
      success: true,
      id: comment.id,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.gray(`Failed to add comment: ${errorMessage}`));
    return { success: false, error: errorMessage };
  }
}
