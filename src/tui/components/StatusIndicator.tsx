/**
 * StatusIndicator component for TUI task tree
 *
 * Renders status icons for tasks using stable static icons.
 */

import { Text } from 'ink';
import type { TaskStatus } from '../../lib/task-graph.js';
import { STATUS_COLORS, STATUS_ICONS } from '../theme.js';

export interface StatusIndicatorProps {
  status: TaskStatus;
}

/**
 * Renders a status indicator icon with appropriate color.
 * All statuses use static icons to avoid render glitches.
 */
export function StatusIndicator({ status }: StatusIndicatorProps): JSX.Element {
  return <Text color={STATUS_COLORS[status]}>{STATUS_ICONS[status]}</Text>;
}
