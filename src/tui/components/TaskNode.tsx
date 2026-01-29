/**
 * TaskNode Ink component
 *
 * Renders a single task node in the tree with proper status icon,
 * identifier, title, runtime, and blocked-by suffix. Uses Nord colors based on status.
 * Time display is driven by parent's tick to consolidate timers.
 */

import { Text } from 'ink';
import { memo } from 'react';
import type { SubTask, TaskGraph, TaskStatus } from '../../lib/task-graph.js';
import { getBlockers } from '../../lib/task-graph.js';
import type { CompletedTask } from '../../types.js';
import { STRUCTURE_COLORS } from '../theme.js';
import { formatDuration } from '../utils/formatDuration.js';
import { StatusIndicator } from './StatusIndicator.js';

export interface TaskNodeProps {
  task: SubTask;
  graph: TaskGraph;
  statusOverrides?: Map<string, TaskStatus>; // Runtime status overrides from execution state
  prefix: string; // Box-drawing characters for indentation
  connector: string; // "├── " or "└── "
  completedTaskInfo?: CompletedTask; // Timing info for completed/failed tasks
  /** Elapsed time in ms for active tasks - calculated by parent to consolidate timers */
  activeElapsedMs?: number;
}

/**
 * Get effective status for a task, considering runtime overrides
 */
function getEffectiveStatus(task: SubTask, overrides?: Map<string, TaskStatus>): TaskStatus {
  return overrides?.get(task.id) ?? task.status;
}

/**
 * Format the blocker suffix for a task, showing unresolved blocker identifiers
 * Uses status overrides to correctly identify blockers that completed at runtime
 */
function formatBlockerSuffix(
  task: SubTask,
  graph: TaskGraph,
  statusOverrides?: Map<string, TaskStatus>
): string {
  if (task.blockedBy.length === 0) {
    return '';
  }

  const blockers = getBlockers(graph, task.id);
  // Check effective status (with overrides) to correctly identify completed blockers
  const unresolvedBlockers = blockers.filter(
    (b) => getEffectiveStatus(b, statusOverrides) !== 'done'
  );

  if (unresolvedBlockers.length === 0) {
    return '';
  }

  const blockerIds = unresolvedBlockers.map((b) => b.identifier).join(', ');
  return ` (blocked by: ${blockerIds})`;
}

/**
 * Format the runtime suffix for a task
 */
function formatRuntimeSuffix(completedTaskInfo?: CompletedTask, activeElapsedMs?: number): string {
  if (completedTaskInfo && completedTaskInfo.duration > 0) {
    return ` (${formatDuration(completedTaskInfo.duration)})`;
  }

  if (activeElapsedMs !== undefined) {
    return ` (${formatDuration(activeElapsedMs)}...)`;
  }

  return '';
}

/**
 * TaskNode component renders a single task in the dependency tree.
 * Memoized to prevent unnecessary re-renders when props haven't changed.
 * No internal timer - elapsed time is passed from parent's consolidated tick.
 *
 * Output format examples:
 * - ├── [✓] MOB-124: Setup base types (2m 34s)
 * - ├── [⟳] MOB-126: Implement parser (1m 12s...)
 * - │   └── [·] MOB-127: Add tests (blocked by: MOB-126)
 */
export const TaskNode = memo(function TaskNode({
  task,
  graph,
  statusOverrides,
  prefix,
  connector,
  completedTaskInfo,
  activeElapsedMs,
}: TaskNodeProps): JSX.Element {
  const blockerSuffix = formatBlockerSuffix(task, graph, statusOverrides);
  const runtimeSuffix = formatRuntimeSuffix(completedTaskInfo, activeElapsedMs);

  return (
    <Text>
      <Text color={STRUCTURE_COLORS.muted}>
        {prefix}
        {connector}
      </Text>
      <StatusIndicator status={task.status} />
      <Text color={STRUCTURE_COLORS.text}>
        {' '}
        {task.identifier}: {task.title}
      </Text>
      {runtimeSuffix && <Text color={STRUCTURE_COLORS.muted}>{runtimeSuffix}</Text>}
      {blockerSuffix && <Text color={STRUCTURE_COLORS.muted}>{blockerSuffix}</Text>}
    </Text>
  );
});

export default TaskNode;
