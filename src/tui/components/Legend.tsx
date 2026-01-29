/**
 * Legend component for TUI dashboard
 *
 * Displays status icon legend at the bottom of the dashboard.
 */

import { Box, Text } from 'ink';
import { memo } from 'react';
import { STATUS_COLORS, STATUS_ICONS } from '../theme.js';

export interface LegendProps {
  visible?: boolean; // default: true
}

/**
 * Renders the status icon legend matching tree-renderer.ts format:
 * Legend: [✓] Done  [→] Ready  [·] Blocked  [⟳] In Progress
 *
 * Uses static icons (not StatusIndicator) to avoid spinner animation
 * causing constant re-renders.
 *
 * Memoized to prevent unnecessary re-renders from parent state changes
 * (e.g., spinner animations in sibling components).
 */
function LegendImpl({ visible = true }: LegendProps): JSX.Element | null {
  if (!visible) {
    return null;
  }

  return (
    <Box>
      <Text>Legend: </Text>
      <Text color={STATUS_COLORS.done}>{STATUS_ICONS.done}</Text>
      <Text> Done </Text>
      <Text color={STATUS_COLORS.ready}>{STATUS_ICONS.ready}</Text>
      <Text> Ready </Text>
      <Text color={STATUS_COLORS.blocked}>{STATUS_ICONS.blocked}</Text>
      <Text> Blocked </Text>
      <Text color={STATUS_COLORS.in_progress}>{STATUS_ICONS.in_progress}</Text>
      <Text> In Progress </Text>
      <Text color={STATUS_COLORS.failed}>{STATUS_ICONS.failed}</Text>
      <Text> Failed</Text>
    </Box>
  );
}

// Memoize to prevent re-renders when parent state changes
export const Legend = memo(LegendImpl);
