/**
 * BackendStatusBox component for TUI
 *
 * Displays backend (Linear/Jira) status for tasks in a compact right-aligned box.
 * Shows the actual API state separate from local execution state.
 */

import { Box, Text } from 'ink';
import { memo } from 'react';
import type { TaskStatus } from '../../lib/task-graph.js';
import type { Backend } from '../../types.js';
import { STATUS_COLORS, STATUS_ICONS, STRUCTURE_COLORS } from '../theme.js';

export interface BackendTask {
  identifier: string;
  status: TaskStatus;
}

export interface BackendStatusBoxProps {
  tasks: BackendTask[];
  backend: Backend;
}

/**
 * Compact status box showing backend state per task
 *
 * Layout:
 * ┌──────────────────────┐
 * │ Backend (Linear)     │
 * │ [→] MOB-188          │
 * │ [→] MOB-189          │
 * │ [✓] MOB-190          │
 * └──────────────────────┘
 */
export const BackendStatusBox = memo(function BackendStatusBox({
  tasks,
  backend,
}: BackendStatusBoxProps): JSX.Element {
  const backendLabel = backend === 'linear' ? 'Linear' : 'Jira';

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={STRUCTURE_COLORS.border}
      paddingX={1}
    >
      {/* Header */}
      <Text color={STRUCTURE_COLORS.header} bold>
        Backend ({backendLabel})
      </Text>

      {/* Task list */}
      {tasks.map((task) => (
        <Box key={task.identifier}>
          <Text color={STATUS_COLORS[task.status]}>{STATUS_ICONS[task.status]}</Text>
          <Text color={STRUCTURE_COLORS.text}> {task.identifier}</Text>
        </Box>
      ))}

      {/* Empty state */}
      {tasks.length === 0 && <Text color={STRUCTURE_COLORS.muted}>No tasks</Text>}
    </Box>
  );
});

export default BackendStatusBox;
