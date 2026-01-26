/**
 * Legend component for TUI dashboard
 *
 * Displays status icon legend at the bottom of the dashboard.
 */

import { Text, Box } from 'ink';
import { StatusIndicator } from './StatusIndicator.js';

export interface LegendProps {
  visible?: boolean; // default: true
}

/**
 * Renders the status icon legend matching tree-renderer.ts format:
 * Legend: [✓] Done  [→] Ready  [·] Blocked  [⟳] In Progress
 *
 * Note: In-progress uses static icon here, not spinner (legend is static).
 */
export function Legend({ visible = true }: LegendProps): JSX.Element | null {
  if (!visible) {
    return null;
  }

  return (
    <Box>
      <Text>Legend: </Text>
      <StatusIndicator status="done" />
      <Text> Done  </Text>
      <StatusIndicator status="ready" />
      <Text> Ready  </Text>
      <StatusIndicator status="blocked" />
      <Text> Blocked  </Text>
      <StatusIndicator status="in_progress" />
      <Text> In Progress</Text>
    </Box>
  );
}
