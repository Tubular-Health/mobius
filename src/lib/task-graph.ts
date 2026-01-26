/**
 * Task dependency graph parser module
 *
 * Builds and manages a dependency graph from Linear sub-tasks.
 * The graph structure is Linear-agnostic; only the input parsing is specific.
 */

// Task status types mapped from Linear states
export type TaskStatus = 'pending' | 'ready' | 'in_progress' | 'done' | 'blocked' | 'failed';

/**
 * Represents a sub-task in the dependency graph
 */
export interface SubTask {
  id: string;
  identifier: string; // e.g., "MOB-124"
  title: string;
  status: TaskStatus;
  blockedBy: string[]; // Task IDs
  blocks: string[]; // Task IDs this task blocks
  gitBranchName: string;
}

/**
 * The complete task dependency graph
 */
export interface TaskGraph {
  parentId: string;
  parentIdentifier: string;
  tasks: Map<string, SubTask>;
  edges: Map<string, string[]>; // taskId -> blockedBy taskIds
}

/**
 * Linear issue data structure (subset of what Linear MCP returns)
 */
export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  gitBranchName?: string;
  relations?: {
    blockedBy?: Array<{ id: string; identifier: string }>;
    blocks?: Array<{ id: string; identifier: string }>;
  };
}

/**
 * Map Linear status string to internal TaskStatus
 */
export function mapLinearStatus(linearStatus: string): TaskStatus {
  const statusLower = linearStatus.toLowerCase();

  // Done states
  if (statusLower === 'done' || statusLower === 'completed' || statusLower === 'cancelled' || statusLower === 'canceled') {
    return 'done';
  }

  // In progress states
  if (statusLower === 'in progress' || statusLower === 'in review' || statusLower === 'started') {
    return 'in_progress';
  }

  // Everything else is pending (will be calculated as ready/blocked later)
  return 'pending';
}

/**
 * Build a task graph from Linear issues
 *
 * @param parentId - The parent issue ID
 * @param parentIdentifier - The parent issue identifier (e.g., "MOB-100")
 * @param issues - Array of Linear sub-task issues
 * @returns TaskGraph with all tasks and dependency edges
 */
export function buildTaskGraph(
  parentId: string,
  parentIdentifier: string,
  issues: LinearIssue[]
): TaskGraph {
  const tasks = new Map<string, SubTask>();
  const edges = new Map<string, string[]>();

  // First pass: create all tasks
  for (const issue of issues) {
    const blockedByIds = issue.relations?.blockedBy?.map(b => b.id) ?? [];
    const blocksIds = issue.relations?.blocks?.map(b => b.id) ?? [];

    const task: SubTask = {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      status: mapLinearStatus(issue.status),
      blockedBy: blockedByIds,
      blocks: blocksIds,
      gitBranchName: issue.gitBranchName ?? '',
    };

    tasks.set(issue.id, task);
    edges.set(issue.id, blockedByIds);
  }

  // Second pass: calculate ready/blocked status for pending tasks
  for (const [, task] of tasks) {
    if (task.status === 'pending') {
      task.status = calculateTaskStatus(task, tasks);
    }
  }

  return {
    parentId,
    parentIdentifier,
    tasks,
    edges,
  };
}

/**
 * Calculate whether a pending task is ready or blocked
 */
function calculateTaskStatus(task: SubTask, allTasks: Map<string, SubTask>): TaskStatus {
  // If no blockers, it's ready
  if (task.blockedBy.length === 0) {
    return 'ready';
  }

  // Check if all blockers are done
  const allBlockersDone = task.blockedBy.every(blockerId => {
    const blocker = allTasks.get(blockerId);
    // If blocker not in our graph (external), assume it's done
    // This handles cases where blockedBy references tasks outside the parent
    return !blocker || blocker.status === 'done';
  });

  return allBlockersDone ? 'ready' : 'blocked';
}

/**
 * Get all tasks that are ready for execution (no unresolved blockers)
 *
 * Includes both 'ready' tasks and 'in_progress' tasks that haven't completed yet.
 * This allows mobius to resume tasks that were started but not finished.
 */
export function getReadyTasks(graph: TaskGraph): SubTask[] {
  const ready: SubTask[] = [];

  for (const task of graph.tasks.values()) {
    if (task.status === 'ready' || task.status === 'in_progress') {
      ready.push(task);
    }
  }

  // Sort by identifier for consistent ordering
  return ready.sort((a, b) => a.identifier.localeCompare(b.identifier));
}

/**
 * Get all tasks that are blocked (have unresolved blockers)
 */
export function getBlockedTasks(graph: TaskGraph): SubTask[] {
  const blocked: SubTask[] = [];

  for (const task of graph.tasks.values()) {
    if (task.status === 'blocked') {
      blocked.push(task);
    }
  }

  return blocked.sort((a, b) => a.identifier.localeCompare(b.identifier));
}

/**
 * Get all tasks that are completed
 */
export function getCompletedTasks(graph: TaskGraph): SubTask[] {
  const completed: SubTask[] = [];

  for (const task of graph.tasks.values()) {
    if (task.status === 'done') {
      completed.push(task);
    }
  }

  return completed.sort((a, b) => a.identifier.localeCompare(b.identifier));
}

/**
 * Get all tasks that are in progress
 */
export function getInProgressTasks(graph: TaskGraph): SubTask[] {
  const inProgress: SubTask[] = [];

  for (const task of graph.tasks.values()) {
    if (task.status === 'in_progress') {
      inProgress.push(task);
    }
  }

  return inProgress.sort((a, b) => a.identifier.localeCompare(b.identifier));
}

/**
 * Get all pending tasks (not yet started, not done)
 */
export function getPendingTasks(graph: TaskGraph): SubTask[] {
  const pending: SubTask[] = [];

  for (const task of graph.tasks.values()) {
    if (task.status === 'pending') {
      pending.push(task);
    }
  }

  return pending.sort((a, b) => a.identifier.localeCompare(b.identifier));
}

/**
 * Immutably update a task's status in the graph
 *
 * @param graph - The current task graph
 * @param taskId - The task ID to update
 * @param newStatus - The new status to set
 * @returns A new TaskGraph with the updated status and recalculated dependencies
 */
export function updateTaskStatus(
  graph: TaskGraph,
  taskId: string,
  newStatus: TaskStatus
): TaskGraph {
  const task = graph.tasks.get(taskId);
  if (!task) {
    return graph;
  }

  // Create new tasks map with the updated task
  const newTasks = new Map(graph.tasks);
  newTasks.set(taskId, { ...task, status: newStatus });

  // If task was marked done, recalculate status for tasks blocked by it
  if (newStatus === 'done') {
    for (const [id, t] of newTasks) {
      if (t.blockedBy.includes(taskId) && (t.status === 'blocked' || t.status === 'pending')) {
        // Recalculate status
        const newTaskStatus = calculateTaskStatus(t, newTasks);
        if (newTaskStatus !== t.status) {
          newTasks.set(id, { ...t, status: newTaskStatus });
        }
      }
    }
  }

  return {
    ...graph,
    tasks: newTasks,
  };
}

/**
 * Get a task by its ID
 */
export function getTaskById(graph: TaskGraph, taskId: string): SubTask | undefined {
  return graph.tasks.get(taskId);
}

/**
 * Get a task by its identifier (e.g., "MOB-124")
 */
export function getTaskByIdentifier(graph: TaskGraph, identifier: string): SubTask | undefined {
  for (const task of graph.tasks.values()) {
    if (task.identifier === identifier) {
      return task;
    }
  }
  return undefined;
}

/**
 * Get the blockers for a specific task
 */
export function getBlockers(graph: TaskGraph, taskId: string): SubTask[] {
  const task = graph.tasks.get(taskId);
  if (!task) {
    return [];
  }

  const blockers: SubTask[] = [];
  for (const blockerId of task.blockedBy) {
    const blocker = graph.tasks.get(blockerId);
    if (blocker) {
      blockers.push(blocker);
    }
  }

  return blockers;
}

/**
 * Get tasks that are blocked by a specific task
 */
export function getBlockedBy(graph: TaskGraph, taskId: string): SubTask[] {
  const task = graph.tasks.get(taskId);
  if (!task) {
    return [];
  }

  const blockedTasks: SubTask[] = [];
  for (const blockedId of task.blocks) {
    const blocked = graph.tasks.get(blockedId);
    if (blocked) {
      blockedTasks.push(blocked);
    }
  }

  return blockedTasks;
}

/**
 * Get summary statistics for the graph
 */
export function getGraphStats(graph: TaskGraph): {
  total: number;
  done: number;
  ready: number;
  blocked: number;
  inProgress: number;
} {
  let done = 0;
  let ready = 0;
  let blocked = 0;
  let inProgress = 0;

  for (const task of graph.tasks.values()) {
    switch (task.status) {
      case 'done':
        done++;
        break;
      case 'ready':
        ready++;
        break;
      case 'blocked':
        blocked++;
        break;
      case 'in_progress':
        inProgress++;
        break;
    }
  }

  return {
    total: graph.tasks.size,
    done,
    ready,
    blocked,
    inProgress,
  };
}
