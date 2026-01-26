/**
 * TaskTree Ink component
 *
 * Renders the full ASCII dependency graph using TaskNode components.
 * Reuses hierarchy building logic from tree-renderer.ts (first blocker = parent).
 */

import { Box, Text } from 'ink';
import { memo, useMemo } from 'react';
import type { SubTask, TaskGraph, TaskStatus } from '../../lib/task-graph.js';
import type { ActiveTask, CompletedTask, ExecutionState } from '../../types.js';
import { normalizeCompletedTask, getCompletedTaskId } from '../../lib/execution-state.js';
import { TaskNode } from './TaskNode.js';
import { STRUCTURE_COLORS } from '../theme.js';
import { getElapsedMs } from '../utils/formatDuration.js';

export interface TaskTreeProps {
  graph: TaskGraph;
  executionState?: ExecutionState;  // For live status updates
  /** Tick counter from parent - drives elapsed time recalculation */
  tick?: number;
}

/**
 * Build children map from task graph (first blocker = parent in tree)
 */
function buildChildrenMap(graph: TaskGraph): Map<string, SubTask[]> {
  const childrenMap = new Map<string, SubTask[]>();

  for (const task of graph.tasks.values()) {
    if (task.blockedBy.length > 0) {
      // Use first blocker as the "parent" for tree display
      const parentId = task.blockedBy[0];
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId)!.push(task);
    }
  }

  // Sort children by identifier for consistent ordering
  for (const children of childrenMap.values()) {
    children.sort((a, b) => a.identifier.localeCompare(b.identifier));
  }

  return childrenMap;
}

/**
 * Get root tasks (tasks with no blockers)
 */
function getRootTasks(graph: TaskGraph): SubTask[] {
  const tasks = Array.from(graph.tasks.values());
  const rootTasks = tasks.filter((task) => task.blockedBy.length === 0);

  // If no root tasks found, use all tasks as roots (defensive)
  const allRootNodes = rootTasks.length > 0 ? rootTasks : tasks;

  // Sort by identifier for consistent ordering
  return allRootNodes.sort((a, b) => a.identifier.localeCompare(b.identifier));
}

/**
 * Apply execution state updates to task status
 * Returns a map of taskId -> updated status
 */
function getStatusOverrides(
  graph: TaskGraph,
  executionState?: ExecutionState
): Map<string, TaskStatus> {
  const overrides = new Map<string, TaskStatus>();

  if (!executionState) {
    return overrides;
  }

  // Mark active tasks as in_progress
  for (const activeTask of executionState.activeTasks) {
    // Find task by identifier
    for (const task of graph.tasks.values()) {
      if (task.identifier === activeTask.id) {
        overrides.set(task.id, 'in_progress');
        break;
      }
    }
  }

  // Mark completed tasks as done
  for (const entry of executionState.completedTasks) {
    const taskIdentifier = getCompletedTaskId(entry);
    for (const task of graph.tasks.values()) {
      if (task.identifier === taskIdentifier) {
        overrides.set(task.id, 'done');
        break;
      }
    }
  }

  return overrides;
}

/**
 * Build lookup maps for task timing info from execution state
 * Returns maps from task identifier -> timing info
 */
function buildTimingMaps(
  executionState?: ExecutionState
): {
  completedTaskMap: Map<string, CompletedTask>;
  activeTaskMap: Map<string, ActiveTask>;
  failedTaskMap: Map<string, CompletedTask>;
} {
  const completedTaskMap = new Map<string, CompletedTask>();
  const activeTaskMap = new Map<string, ActiveTask>();
  const failedTaskMap = new Map<string, CompletedTask>();

  if (!executionState) {
    return { completedTaskMap, activeTaskMap, failedTaskMap };
  }

  // Build active task map (by identifier)
  for (const activeTask of executionState.activeTasks) {
    activeTaskMap.set(activeTask.id, activeTask);
  }

  // Build completed task map (by identifier)
  for (const entry of executionState.completedTasks) {
    const normalized = normalizeCompletedTask(entry);
    completedTaskMap.set(normalized.id, normalized);
  }

  // Build failed task map (by identifier)
  for (const entry of executionState.failedTasks) {
    const normalized = normalizeCompletedTask(entry);
    failedTaskMap.set(normalized.id, normalized);
  }

  return { completedTaskMap, activeTaskMap, failedTaskMap };
}

/**
 * Build elapsed time map for active tasks
 * Separated from buildTimingMaps so it can recalculate on tick without rebuilding other maps
 */
function buildElapsedMap(activeTaskMap: Map<string, ActiveTask>): Map<string, number> {
  const elapsedMap = new Map<string, number>();
  for (const [id, task] of activeTaskMap) {
    elapsedMap.set(id, getElapsedMs(task.startedAt));
  }
  return elapsedMap;
}

/**
 * Create a task with potentially overridden status
 */
function applyStatusOverride(task: SubTask, overrides: Map<string, TaskStatus>): SubTask {
  const overriddenStatus = overrides.get(task.id);
  if (overriddenStatus && overriddenStatus !== task.status) {
    return { ...task, status: overriddenStatus };
  }
  return task;
}

interface TaskTreeNodeProps {
  task: SubTask;
  graph: TaskGraph;
  childrenMap: Map<string, SubTask[]>;
  statusOverrides: Map<string, TaskStatus>;
  completedTaskMap: Map<string, CompletedTask>;
  activeElapsedMap: Map<string, number>;
  failedTaskMap: Map<string, CompletedTask>;
  prefix: string;
  isLast: boolean;
}

/**
 * Recursively render a task node and its children
 * Memoized to prevent unnecessary re-renders when props haven't changed
 */
const TaskTreeNode = memo(function TaskTreeNode({
  task,
  graph,
  childrenMap,
  statusOverrides,
  completedTaskMap,
  activeElapsedMap,
  failedTaskMap,
  prefix,
  isLast,
}: TaskTreeNodeProps): JSX.Element {
  const connector = isLast ? '└── ' : '├── ';
  const taskWithOverride = applyStatusOverride(task, statusOverrides);

  // Get children for this task
  const children = childrenMap.get(task.id) ?? [];

  // Determine the new prefix for children
  const childPrefix = prefix + (isLast ? '    ' : '│   ');

  // Get timing info for this task (use task.identifier to look up)
  const completedTaskInfo = completedTaskMap.get(task.identifier) ?? failedTaskMap.get(task.identifier);
  const activeElapsedMs = activeElapsedMap.get(task.identifier);

  return (
    <Box flexDirection="column">
      <TaskNode
        task={taskWithOverride}
        graph={graph}
        prefix={prefix}
        connector={connector}
        completedTaskInfo={completedTaskInfo}
        activeElapsedMs={activeElapsedMs}
      />
      {children.map((child, index) => {
        const childIsLast = index === children.length - 1;
        return (
          <TaskTreeNode
            key={child.id}
            task={child}
            graph={graph}
            childrenMap={childrenMap}
            statusOverrides={statusOverrides}
            completedTaskMap={completedTaskMap}
            activeElapsedMap={activeElapsedMap}
            failedTaskMap={failedTaskMap}
            prefix={childPrefix}
            isLast={childIsLast}
          />
        );
      })}
    </Box>
  );
});

/**
 * TaskTree component renders the full dependency tree.
 * Memoized to prevent re-renders when props haven't changed.
 *
 * Output format:
 * ```
 * Task Tree for MOB-11:
 * ├── [✓] MOB-124: Setup base types
 * ├── [✓] MOB-125: Create utility functions
 * ├── [⟳] MOB-126: Implement parser
 * │   └── [·] MOB-127: Add tests (blocked by: MOB-126)
 * ├── [⟳] MOB-128: Build CLI interface
 * └── [·] MOB-129: Integration tests (blocked by: 126, 128)
 * ```
 */
export const TaskTree = memo(function TaskTree({ graph, executionState, tick }: TaskTreeProps): JSX.Element {
  // Memoize expensive computations to avoid recalculating on every render
  const childrenMap = useMemo(() => buildChildrenMap(graph), [graph]);
  const rootTasks = useMemo(() => getRootTasks(graph), [graph]);
  const statusOverrides = useMemo(
    () => getStatusOverrides(graph, executionState),
    [graph, executionState]
  );

  // Build timing maps for task runtime display
  const { completedTaskMap, activeTaskMap, failedTaskMap } = useMemo(
    () => buildTimingMaps(executionState),
    [executionState]
  );

  // Build elapsed time map - recalculates on each tick
  // This consolidates the timers that were previously in each TaskNode
  const activeElapsedMap = useMemo(
    () => buildElapsedMap(activeTaskMap),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick drives updates
    [activeTaskMap, tick]
  );

  return (
    <Box flexDirection="column">
      <Text color={STRUCTURE_COLORS.header}>
        Task Tree for {graph.parentIdentifier}:
      </Text>
      {rootTasks.map((task, index) => {
        const isLast = index === rootTasks.length - 1;
        return (
          <TaskTreeNode
            key={task.id}
            task={task}
            graph={graph}
            childrenMap={childrenMap}
            statusOverrides={statusOverrides}
            completedTaskMap={completedTaskMap}
            activeElapsedMap={activeElapsedMap}
            failedTaskMap={failedTaskMap}
            prefix=""
            isLast={isLast}
          />
        );
      })}
    </Box>
  );
});

export default TaskTree;
