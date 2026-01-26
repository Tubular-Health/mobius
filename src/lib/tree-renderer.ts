/**
 * ASCII tree visualization module
 *
 * Renders task dependency graphs as ASCII tree visualizations for console output.
 * Uses Nord color palette for visual distinction.
 */

import chalk from 'chalk';
import type { TaskGraph, SubTask, TaskStatus } from './task-graph.js';
import { getReadyTasks, getBlockers } from './task-graph.js';

/**
 * Nord color palette
 * https://www.nordtheme.com/docs/colors-and-palettes
 */
const NORD = {
  // Polar Night (dark)
  nord0: '#2E3440',
  nord1: '#3B4252',
  nord2: '#434C5E',
  nord3: '#4C566A',
  // Snow Storm (light)
  nord4: '#D8DEE9',
  nord5: '#E5E9F0',
  nord6: '#ECEFF4',
  // Frost (blues/cyans) - used for depth coloring
  nord7: '#8FBCBB',  // teal
  nord8: '#88C0D0',  // light blue
  nord9: '#81A1C1',  // blue
  nord10: '#5E81AC', // dark blue
  // Aurora (accent colors) - used for status
  nord11: '#BF616A', // red
  nord12: '#D08770', // orange
  nord13: '#EBCB8B', // yellow
  nord14: '#A3BE8C', // green
  nord15: '#B48EAD', // purple
};

/**
 * Depth colors cycle through Frost palette
 */
const DEPTH_COLORS = [
  NORD.nord8,  // light blue (depth 0)
  NORD.nord7,  // teal (depth 1)
  NORD.nord9,  // blue (depth 2)
  NORD.nord10, // dark blue (depth 3)
  NORD.nord15, // purple (depth 4)
];

/**
 * Status colors from Aurora palette
 */
const STATUS_COLORS: Record<TaskStatus, string> = {
  done: NORD.nord14,       // green
  ready: NORD.nord8,       // light blue
  blocked: NORD.nord13,    // yellow
  in_progress: NORD.nord12, // orange
  pending: NORD.nord3,     // gray
  failed: NORD.nord11,     // red
};

/**
 * Status icons for tree rendering (with colors)
 */
function getStatusIcon(status: TaskStatus): string {
  const color = STATUS_COLORS[status];
  const icons: Record<TaskStatus, string> = {
    done: '[✓]',
    ready: '[→]',
    blocked: '[·]',
    in_progress: '[!]',
    pending: '[·]',
    failed: '[✗]',
  };
  return chalk.hex(color)(icons[status]);
}

/**
 * Color a task identifier based on depth
 */
function colorIdentifier(identifier: string, depth: number): string {
  const colorIndex = depth % DEPTH_COLORS.length;
  const color = DEPTH_COLORS[colorIndex];
  return chalk.hex(color).bold(identifier);
}

/**
 * Render a task dependency graph as an ASCII tree
 */
export function renderAsciiTree(graph: TaskGraph): string {
  const lines: string[] = [];
  lines.push(chalk.hex(NORD.nord6).bold(`Task Tree for ${graph.parentIdentifier}:`));

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
    renderTaskNode(task, graph, childrenMap, '', isLast, 0, lines);
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
  depth: number,
  lines: string[]
): void {
  const connector = chalk.hex(NORD.nord3)(isLast ? '└── ' : '├── ');
  const icon = getStatusIcon(task.status);
  const identifier = colorIdentifier(task.identifier, depth);
  const title = chalk.hex(NORD.nord4)(task.title);
  const blockerSuffix = formatBlockerSuffix(task, graph);

  lines.push(`${prefix}${connector}${icon} ${identifier}: ${title}${blockerSuffix}`);

  // Get children for this task
  const children = childrenMap.get(task.id) ?? [];

  // Determine the new prefix for children
  const childPrefix = prefix + chalk.hex(NORD.nord3)(isLast ? '    ' : '│   ');

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const childIsLast = i === children.length - 1;
    renderTaskNode(child, graph, childrenMap, childPrefix, childIsLast, depth + 1, lines);
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

  const blockerIds = unresolvedBlockers.map((b) =>
    chalk.hex(NORD.nord11)(b.identifier)
  ).join(chalk.hex(NORD.nord3)(', '));

  return chalk.hex(NORD.nord3)(` (blocked by: `) + blockerIds + chalk.hex(NORD.nord3)(')');
}

/**
 * Render the legend explaining status icons
 */
export function renderLegend(): string {
  const done = chalk.hex(STATUS_COLORS.done)('[✓] Done');
  const ready = chalk.hex(STATUS_COLORS.ready)('[→] Ready');
  const blocked = chalk.hex(STATUS_COLORS.blocked)('[·] Blocked');
  const inProgress = chalk.hex(STATUS_COLORS.in_progress)('[!] In Progress');

  return chalk.hex(NORD.nord4)('Legend: ') + `${done}  ${ready}  ${blocked}  ${inProgress}`;
}

/**
 * Render a summary of ready tasks for parallel execution
 */
export function renderReadySummary(graph: TaskGraph): string {
  const readyTasks = getReadyTasks(graph);

  if (readyTasks.length === 0) {
    return chalk.hex(NORD.nord13)('No tasks ready for execution');
  }

  const taskIds = readyTasks.map((t) =>
    chalk.hex(NORD.nord8).bold(t.identifier)
  ).join(chalk.hex(NORD.nord3)(', '));

  const agentText = readyTasks.length === 1 ? '1 agent' : `${readyTasks.length} agents`;

  return chalk.hex(NORD.nord4)('Ready for parallel execution: ') +
         taskIds +
         chalk.hex(NORD.nord3)(` (${agentText})`);
}

/**
 * Render the complete tree output including legend and summary
 */
export function renderFullTreeOutput(graph: TaskGraph): string {
  const parts = [renderAsciiTree(graph), '', renderLegend(), renderReadySummary(graph)];

  return parts.join('\n');
}
