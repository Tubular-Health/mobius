/**
 * TaskNode Ink component
 *
 * Renders a single task node in the tree with proper status icon,
 * identifier, title, runtime, and blocked-by suffix. Uses Nord colors based on status.
 */

import { Text } from 'ink';
import { memo, useState, useEffect } from 'react';
import type { SubTask, TaskGraph } from '../../lib/task-graph.js';
import { getBlockers } from '../../lib/task-graph.js';
import type { ActiveTask, CompletedTask } from '../../types.js';
import { STRUCTURE_COLORS } from '../theme.js';
import { StatusIndicator } from './StatusIndicator.js';
import { formatDuration, getElapsedMs } from '../utils/formatDuration.js';

export interface TaskNodeProps {
  task: SubTask;
  graph: TaskGraph;
  prefix: string;     // Box-drawing characters for indentation
  connector: string;  // "├── " or "└── "
  completedTaskInfo?: CompletedTask;  // Timing info for completed/failed tasks
  activeTaskInfo?: ActiveTask;        // Timing info for in-progress tasks
}

/**
 * Format the blocker suffix for a task, showing unresolved blocker identifiers
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
 * Format the runtime suffix for a task
 */
function formatRuntimeSuffix(
  completedTaskInfo?: CompletedTask,
  activeTaskInfo?: ActiveTask,
  elapsed?: number
): string {
  if (completedTaskInfo && completedTaskInfo.duration > 0) {
    return ` (${formatDuration(completedTaskInfo.duration)})`;
  }

  if (activeTaskInfo && elapsed !== undefined) {
    return ` (${formatDuration(elapsed)}...)`;
  }

  return '';
}

/**
 * TaskNode component renders a single task in the dependency tree.
 * Memoized to prevent unnecessary re-renders when props haven't changed.
 *
 * Output format examples:
 * - ├── [✓] MOB-124: Setup base types (2m 34s)
 * - ├── [⟳] MOB-126: Implement parser (1m 12s...)
 * - │   └── [·] MOB-127: Add tests (blocked by: MOB-126)
 */
export const TaskNode = memo(function TaskNode({
  task,
  graph,
  prefix,
  connector,
  completedTaskInfo,
  activeTaskInfo,
}: TaskNodeProps): JSX.Element {
  const blockerSuffix = formatBlockerSuffix(task, graph);

  // For active tasks, track elapsed time with live updates
  const [elapsed, setElapsed] = useState<number>(
    activeTaskInfo ? getElapsedMs(activeTaskInfo.startedAt) : 0
  );

  useEffect(() => {
    if (!activeTaskInfo) return;

    // Initial calculation
    setElapsed(getElapsedMs(activeTaskInfo.startedAt));

    const interval = setInterval(() => {
      setElapsed(getElapsedMs(activeTaskInfo.startedAt));
    }, 1000);

    return () => clearInterval(interval);
  }, [activeTaskInfo]);

  const runtimeSuffix = formatRuntimeSuffix(completedTaskInfo, activeTaskInfo, elapsed);

  return (
    <Text>
      <Text color={STRUCTURE_COLORS.muted}>{prefix}{connector}</Text>
      <StatusIndicator status={task.status} />
      <Text color={STRUCTURE_COLORS.text}> {task.identifier}: {task.title}</Text>
      {runtimeSuffix && (
        <Text color={STRUCTURE_COLORS.muted}>{runtimeSuffix}</Text>
      )}
      {blockerSuffix && (
        <Text color={STRUCTURE_COLORS.muted}>{blockerSuffix}</Text>
      )}
    </Text>
  );
});

export default TaskNode;
