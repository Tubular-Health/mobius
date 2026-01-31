/**
 * Type definitions for the local context system
 *
 * These types support the SDK-based approach where agents read from and write to
 * local JSON files during execution, with changes synced back to Linear/Jira
 * via explicit `mobius sync` command.
 */

import type { TaskStatus } from '../lib/task-graph.js';

/**
 * Parent issue details stored in local context
 */
export interface ParentIssueContext {
  id: string;
  identifier: string;
  title: string;
  description: string;
  gitBranchName: string;
  status: string;
  labels: string[];
  url: string;
}

/**
 * Sub-task stored in local context
 */
export interface SubTaskContext {
  id: string;
  identifier: string;
  title: string;
  description: string;
  status: TaskStatus;
  gitBranchName: string;
  blockedBy: Array<{ id: string; identifier: string }>;
  blocks: Array<{ id: string; identifier: string }>;
}

/**
 * Local-only issue specification for issues not backed by Linear/Jira
 */
export interface LocalIssueSpec {
  localId: string; // LOC-{N} format identifier
  title: string;
  description: string;
  status: TaskStatus;
}

/**
 * Summary of a single execution iteration in the loop
 */
export interface IterationSummary {
  iterationNumber: number;
  startedAt: string; // ISO timestamp
  completedAt: string; // ISO timestamp
  tasksCompleted: string[]; // Task identifiers completed in this iteration
  keyChanges: string[]; // Summary of significant changes made
  nextSteps: string[]; // Recommended actions for next iteration
}

/**
 * Counter for generating LOC-{N} local issue identifiers
 */
export interface LocalCounter {
  nextTaskNumber: number;
  lastUpdated: string; // ISO timestamp
}

/**
 * Metadata about the local context
 */
export interface ContextMetadata {
  fetchedAt: string; // ISO timestamp when context was fetched from backend
  updatedAt: string; // ISO timestamp when context was last modified locally
  backend: 'linear' | 'jira' | 'local';
  syncedAt?: string; // ISO timestamp of last successful sync
}

/**
 * Session information for the active working session
 * Stored at ~/.mobius/issues/{parentId}/execution/session.json
 *
 * This replaces the old ~/.mobius/current-task.json file.
 * Session data is tied to a specific parent issue rather than being global.
 */
export interface SessionInfo {
  parentId: string; // Parent issue identifier (e.g., "MOB-161")
  backend: 'linear' | 'jira' | 'local';
  startedAt: string; // ISO timestamp when session started
  worktreePath?: string; // Path to worktree if created
  status: 'active' | 'completed' | 'failed' | 'paused';
}

/**
 * Active task running in a pane
 * Used for TUI monitoring of parallel execution
 */
export interface RuntimeActiveTask {
  id: string; // Task identifier (e.g., "MOB-126")
  pid: number; // Claude process ID
  pane: string; // tmux pane identifier (e.g., "%0")
  startedAt: string; // ISO timestamp
  worktree?: string; // Worktree path if applicable
}

/**
 * Completed or failed task with timing info
 */
export interface RuntimeCompletedTask {
  id: string; // Task identifier (e.g., "MOB-126")
  completedAt: string; // ISO timestamp when task finished
  duration: number; // Duration in milliseconds
}

/**
 * Runtime execution state for TUI monitoring
 * Stored at ~/.mobius/issues/{parentId}/execution/runtime.json
 *
 * This replaces the old ~/.mobius/state/{parentId}.json file.
 * Runtime state is ephemeral and tied to a specific parent issue context.
 */
/**
 * Backend status entry for tracking synced status
 */
export interface BackendStatusEntry {
  identifier: string; // Task identifier (e.g., "MOB-124")
  status: string; // Backend status (e.g., "Done", "In Progress")
  syncedAt: string; // ISO timestamp of last successful sync
}

export interface RuntimeState {
  parentId: string; // Parent issue identifier (e.g., "MOB-11")
  parentTitle: string; // Parent issue title for display

  activeTasks: RuntimeActiveTask[];
  completedTasks: (string | RuntimeCompletedTask)[]; // Supports legacy string format
  failedTasks: (string | RuntimeCompletedTask)[]; // Supports legacy string format

  startedAt: string; // ISO timestamp - loop start
  updatedAt: string; // ISO timestamp - last update

  loopPid?: number; // PID of the loop process (for cleanup)
  totalTasks?: number; // Total number of tasks (for completion detection)

  /**
   * Backend status map - updated when push succeeds
   * Key is task identifier (e.g., "MOB-124"), value is status entry
   * TUI watches this to show real-time backend status without re-fetching
   */
  backendStatuses?: Record<string, BackendStatusEntry>;
}

/**
 * Complete issue context stored locally
 *
 * Structure on disk:
 * ~/.mobius/issues/{parentId}/
 * ├── parent.json          # Parent issue details
 * ├── tasks/
 * │   ├── {taskId}.json    # Individual sub-task files
 * │   └── ...
 * ├── pending-updates.json # Queue of changes to sync
 * └── sync-log.json        # History of sync operations
 */
export interface IssueContext {
  parent: ParentIssueContext;
  subTasks: SubTaskContext[];
  metadata: ContextMetadata;
}

/**
 * Status values for skill output discriminated union
 */
export type SkillOutputStatus =
  | 'SUBTASK_COMPLETE' // Sub-task fully implemented and verified
  | 'SUBTASK_PARTIAL' // Partial progress, continuing next loop
  | 'ALL_COMPLETE' // All sub-tasks done
  | 'ALL_BLOCKED' // Remaining sub-tasks are blocked
  | 'NO_SUBTASKS' // No sub-tasks exist
  | 'VERIFICATION_FAILED' // Tests/typecheck failed after retries
  | 'NEEDS_WORK' // Verification found issues needing rework
  | 'PASS' // Verification passed
  | 'FAIL'; // Verification failed definitively

/**
 * Base fields present in all skill outputs
 */
interface SkillOutputBase {
  status: SkillOutputStatus;
  timestamp: string; // ISO timestamp when output was generated
  subtaskId?: string; // Sub-task identifier if applicable
  parentId?: string; // Parent issue identifier
}

/**
 * Output for successful sub-task completion
 */
interface SubtaskCompleteOutput extends SkillOutputBase {
  status: 'SUBTASK_COMPLETE';
  subtaskId: string;
  commitHash: string;
  filesModified: string[];
  verificationResults: {
    typecheck: 'PASS' | 'FAIL';
    tests: 'PASS' | 'FAIL';
    lint: 'PASS' | 'FAIL';
    subtaskVerify?: 'PASS' | 'FAIL' | 'N/A';
  };
}

/**
 * Output for partial sub-task progress
 */
interface SubtaskPartialOutput extends SkillOutputBase {
  status: 'SUBTASK_PARTIAL';
  subtaskId: string;
  progressMade: string[];
  remainingWork: string[];
  commitHash?: string;
}

/**
 * Output when all sub-tasks are complete
 */
interface AllCompleteOutput extends SkillOutputBase {
  status: 'ALL_COMPLETE';
  parentId: string;
  completedCount: number;
}

/**
 * Output when all remaining sub-tasks are blocked
 */
interface AllBlockedOutput extends SkillOutputBase {
  status: 'ALL_BLOCKED';
  parentId: string;
  blockedCount: number;
  waitingOn: string[]; // List of blocking issue identifiers
}

/**
 * Output when no sub-tasks exist
 */
interface NoSubtasksOutput extends SkillOutputBase {
  status: 'NO_SUBTASKS';
  parentId: string;
}

/**
 * Output when verification fails after retries
 */
interface VerificationFailedOutput extends SkillOutputBase {
  status: 'VERIFICATION_FAILED';
  subtaskId: string;
  errorType: 'typecheck' | 'tests' | 'lint' | 'subtask_verify';
  errorOutput: string;
  attemptedFixes: string[];
  uncommittedFiles: string[];
}

/**
 * Output when verification finds issues needing rework (execute format)
 */
interface NeedsWorkOutput extends SkillOutputBase {
  status: 'NEEDS_WORK';
  subtaskId: string;
  issues: string[];
  suggestedFixes: string[];
}

/**
 * Output when verification gate finds issues needing rework (verify format)
 *
 * This format supports multiple failing subtasks with detailed issue tracking
 * and feedback comments for the rework loop.
 */
interface VerificationNeedsWorkOutput extends SkillOutputBase {
  status: 'NEEDS_WORK';
  parentId: string;
  verificationTaskId: string;
  criteriaResults?: {
    met: number;
    total: number;
    details: Array<{ criterion: string; status: string; evidence: string }>;
  };
  failingSubtasks: Array<{
    id: string;
    identifier: string;
    issues: Array<{ type: string; description: string; file?: string; line?: number }>;
  }>;
  reworkIteration: number;
  feedbackComments: Array<{ subtaskId: string; comment: string }>;
}

/**
 * Output for verification pass
 */
interface PassOutput extends SkillOutputBase {
  status: 'PASS';
  subtaskId?: string;
  details?: string;
}

/**
 * Output for definitive verification failure
 */
interface FailOutput extends SkillOutputBase {
  status: 'FAIL';
  subtaskId?: string;
  reason: string;
  details?: string;
}

/**
 * Discriminated union of all skill output types
 */
export interface SkillOutput {
  output:
    | SubtaskCompleteOutput
    | SubtaskPartialOutput
    | AllCompleteOutput
    | AllBlockedOutput
    | NoSubtasksOutput
    | VerificationFailedOutput
    | NeedsWorkOutput
    | VerificationNeedsWorkOutput
    | PassOutput
    | FailOutput;
}

/**
 * Types of pending updates that can be synced to the backend
 */
export type PendingUpdateType =
  | 'status_change' // Change issue status (e.g., Backlog -> In Progress -> Done)
  | 'add_comment' // Add a comment to an issue
  | 'create_subtask' // Create a new sub-task
  | 'update_description' // Update issue description
  | 'add_label' // Add label to issue
  | 'remove_label'; // Remove label from issue

/**
 * Pending update for status change
 */
interface StatusChangeUpdate {
  type: 'status_change';
  issueId: string;
  identifier: string;
  oldStatus: string;
  newStatus: string;
}

/**
 * Pending update for adding a comment
 */
interface AddCommentUpdate {
  type: 'add_comment';
  issueId: string;
  identifier: string;
  body: string;
}

/**
 * Pending update for creating a sub-task
 */
interface CreateSubtaskUpdate {
  type: 'create_subtask';
  parentId: string;
  title: string;
  description: string;
  blockedBy?: string[]; // Issue IDs that block this task
}

/**
 * Pending update for description change
 */
interface UpdateDescriptionUpdate {
  type: 'update_description';
  issueId: string;
  identifier: string;
  description: string;
}

/**
 * Pending update for adding a label
 */
interface AddLabelUpdate {
  type: 'add_label';
  issueId: string;
  identifier: string;
  label: string;
}

/**
 * Pending update for removing a label
 */
interface RemoveLabelUpdate {
  type: 'remove_label';
  issueId: string;
  identifier: string;
  label: string;
}

/**
 * A pending update to be synced to the backend
 *
 * Updates are queued locally and pushed to Linear/Jira via `mobius sync`.
 * Each update is timestamped and given a unique ID for tracking.
 */
export type PendingUpdate = {
  id: string; // Unique ID for this update (UUID)
  createdAt: string; // ISO timestamp when update was queued
  syncedAt?: string; // ISO timestamp when successfully synced (undefined if pending)
  error?: string; // Error message if sync failed
} & (
  | StatusChangeUpdate
  | AddCommentUpdate
  | CreateSubtaskUpdate
  | UpdateDescriptionUpdate
  | AddLabelUpdate
  | RemoveLabelUpdate
);

/**
 * Queue of pending updates waiting to be synced
 */
export interface PendingUpdatesQueue {
  updates: PendingUpdate[];
  lastSyncAttempt?: string; // ISO timestamp of last sync attempt
  lastSyncSuccess?: string; // ISO timestamp of last successful sync
}

/**
 * Entry in the sync log for audit trail
 */
export interface SyncLogEntry {
  timestamp: string; // ISO timestamp of sync
  updateId: string; // ID of the update that was synced
  type: PendingUpdateType; // Type of update
  issueIdentifier: string; // Issue identifier (e.g., "MOB-123")
  success: boolean; // Whether sync succeeded
  error?: string; // Error message if failed
  backendResponse?: string; // Raw response from backend (for debugging)
}

/**
 * Complete sync log file structure
 */
export interface SyncLog {
  entries: SyncLogEntry[];
}
