/**
 * ASCII tree visualization module
 *
 * Renders task dependency graphs as ASCII tree visualizations for console output.
 */

import type { TaskGraph, SubTask, TaskStatus } from './task-graph.js';
import { getReadyTasks, getBlockers } from './task-graph.js';

/**
 * Status icons for tree rendering
 */
const STATUS_ICONS: Record<TaskStatus, string> = {
  done: '[✓]',
  ready: '[→]',
  blocked: '[·]',
  in_progress: '[!]',
  pending: '[·]',
};

/**
 * Render a task dependency graph as an ASCII tree
 */
export function renderAsciiTree(graph: TaskGraph): string {
  const lines: string[] = [];
  lines.push(`Task Tree for ${graph.parentIdentifier}:`);

  // Get all tasks sorted by identifier
  const tasks = Array.from(graph.tasks.values()).sort((a, b) =>
    a.identifier.localeCompare(b.identifier)
  );

  // Build a hierarchy based on blocking relationships
  // Root tasks are those with no blockers (or all blockers done)
  const rootTasks = tasks.filter((task) => task.blockedBy.length === 0);
  const childTasks = tasks.filter((task) => task.blockedBy.length > 0);

  // Create a map of parent -> children relationships
  // A task's "parent" in the tree is its first blocker
  const childrenMap = new Map<string, SubTask[]>();

  for (const task of childTasks) {
    // Use first blocker as the "parent" for tree display
    const parentId = task.blockedBy[0];
    if (!childrenMap.has(parentId)) {
      childrenMap.set(parentId, []);
    }
    childrenMap.get(parentId)!.push(task);
  }

  // Sort children by identifier
  for (const children of childrenMap.values()) {
    children.sort((a, b) => a.identifier.localeCompare(b.identifier));
  }

  // Render the tree recursively
  const allRootNodes = rootTasks.length > 0 ? rootTasks : tasks;

  for (let i = 0; i < allRootNodes.length; i++) {
    const task = allRootNodes[i];
    const isLast = i === allRootNodes.length - 1;
    renderTaskNode(task, graph, childrenMap, '', isLast, lines);
  }

  return lines.join('\n');
}

/**
 * Recursively render a task node and its children
 */
function renderTaskNode(
  task: SubTask,
  graph: TaskGraph,
  childrenMap: Map<string, SubTask[]>,
  prefix: string,
  isLast: boolean,
  lines: string[]
): void {
  const connector = isLast ? '└── ' : '├── ';
  const icon = STATUS_ICONS[task.status];
  const blockerSuffix = formatBlockerSuffix(task, graph);

  lines.push(`${prefix}${connector}${icon} ${task.identifier}: ${task.title}${blockerSuffix}`);

  // Get children for this task
  const children = childrenMap.get(task.id) ?? [];

  // Determine the new prefix for children
  const childPrefix = prefix + (isLast ? '    ' : '│   ');

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const childIsLast = i === children.length - 1;
    renderTaskNode(child, graph, childrenMap, childPrefix, childIsLast, lines);
  }
}

/**
 * Format the blocker suffix for a task
 */
function formatBlockerSuffix(task: SubTask, graph: TaskGraph): string {
  if (task.blockedBy.length === 0) {
    return '';
  }

  const blockers = getBlockers(graph, task.id);
  const unresolvedBlockers = blockers.filter((b) => b.status !== 'done');

  if (unresolvedBlockers.length === 0) {
    return '';
  }

  const blockerIds = unresolvedBlockers.map((b) => b.identifier).join(', ');
  return ` (blocked by: ${blockerIds})`;
}

/**
 * Render the legend explaining status icons
 */
export function renderLegend(): string {
  return 'Legend: [✓] Done  [→] Ready  [·] Blocked  [!] In Progress';
}

/**
 * Render a summary of ready tasks for parallel execution
 */
export function renderReadySummary(graph: TaskGraph): string {
  const readyTasks = getReadyTasks(graph);

  if (readyTasks.length === 0) {
    return 'No tasks ready for execution';
  }

  const taskIds = readyTasks.map((t) => t.identifier).join(', ');
  const agentText = readyTasks.length === 1 ? '1 agent' : `${readyTasks.length} agents`;

  return `Ready for parallel execution: ${taskIds} (${agentText})`;
}

/**
 * Render the complete tree output including legend and summary
 */
export function renderFullTreeOutput(graph: TaskGraph): string {
  const parts = [renderAsciiTree(graph), '', renderLegend(), renderReadySummary(graph)];

  return parts.join('\n');
}
