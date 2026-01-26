/**
 * TaskNode Ink component
 *
 * Renders a single task node in the tree with proper status icon,
 * identifier, title, and blocked-by suffix. Uses Nord colors based on status.
 */

import { Text } from 'ink';
import type { SubTask, TaskGraph } from '../../lib/task-graph.js';
import { getBlockers } from '../../lib/task-graph.js';
import { STRUCTURE_COLORS } from '../theme.js';
import { StatusIndicator } from './StatusIndicator.js';

export interface TaskNodeProps {
  task: SubTask;
  graph: TaskGraph;
  prefix: string;     // Box-drawing characters for indentation
  connector: string;  // "├── " or "└── "
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
 * TaskNode component renders a single task in the dependency tree.
 *
 * Output format examples:
 * - ├── [✓] MOB-124: Setup base types
 * - ├── [⟳] MOB-126: Implement parser
 * - │   └── [·] MOB-127: Add tests (blocked by: MOB-126)
 */
export function TaskNode({ task, graph, prefix, connector }: TaskNodeProps): JSX.Element {
  const blockerSuffix = formatBlockerSuffix(task, graph);

  return (
    <Text>
      <Text color={STRUCTURE_COLORS.muted}>{prefix}{connector}</Text>
      <StatusIndicator status={task.status} />
      <Text color={STRUCTURE_COLORS.text}> {task.identifier}: {task.title}</Text>
      {blockerSuffix && (
        <Text color={STRUCTURE_COLORS.muted}>{blockerSuffix}</Text>
      )}
    </Text>
  );
}

export default TaskNode;
