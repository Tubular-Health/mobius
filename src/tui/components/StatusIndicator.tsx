/**
 * StatusIndicator component for TUI task tree
 *
 * Renders status icons with animated spinner for in-progress tasks.
 * Uses ink-spinner for spinning animation on active tasks.
 */

import { Text } from 'ink';
import Spinner from 'ink-spinner';
import type { TaskStatus } from '../../lib/task-graph.js';
import { STATUS_COLORS, STATUS_ICONS } from '../theme.js';

export interface StatusIndicatorProps {
  status: TaskStatus;
}

/**
 * Renders a status indicator icon with appropriate color.
 * In-progress tasks show an animated spinner wrapped in brackets.
 */
export function StatusIndicator({ status }: StatusIndicatorProps): JSX.Element {
  // For in_progress, show animated spinner instead of static icon
  if (status === 'in_progress') {
    return (
      <Text color={STATUS_COLORS.in_progress}>
        [<Spinner type="dots" />]
      </Text>
    );
  }

  // For all other statuses, show the static icon
  return (
    <Text color={STATUS_COLORS[status]}>
      {STATUS_ICONS[status]}
    </Text>
  );
}
