/**
 * ActivityIndicator - Displays task activity status with spinner and elapsed time
 *
 * Shows animated spinner, runtime duration, and process health status
 * for active tasks. Shows "Ready for work" for empty slots.
 */

import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { memo } from 'react';
import { formatDuration } from '../utils/formatDuration.js';
import { FROST, SNOW_STORM, AURORA } from '../theme.js';

export interface ActivityIndicatorProps {
  /** Whether this slot has an active task */
  isActive: boolean;
  /** Elapsed time in milliseconds (only used when isActive) */
  elapsedMs?: number;
  /** Whether the process is still alive (only used when isActive) */
  isProcessAlive?: boolean;
  /** Number of lines to fill for consistent panel height */
  lines?: number;
}

/**
 * ActivityIndicator component - shows task activity status
 *
 * Active task:
 * ```
 *            ⠋ Running
 *            2m 34s
 *
 *            Process: active
 * ```
 *
 * Empty slot:
 * ```
 *            Ready for work
 * ```
 */
function ActivityIndicatorImpl({
  isActive,
  elapsedMs = 0,
  isProcessAlive = false,
  lines = 8,
}: ActivityIndicatorProps): JSX.Element {
  if (!isActive) {
    // Empty slot - show "Ready for work" centered
    const emptyLines = Math.floor((lines - 1) / 2);
    const paddingTop = Array(emptyLines).fill('');
    const paddingBottom = Array(lines - emptyLines - 1).fill('');

    return (
      <Box flexDirection="column" alignItems="center">
        {paddingTop.map((_, i) => (
          <Text key={`top-${i}`}> </Text>
        ))}
        <Text color={SNOW_STORM.nord4}>Ready for work</Text>
        {paddingBottom.map((_, i) => (
          <Text key={`bottom-${i}`}> </Text>
        ))}
      </Box>
    );
  }

  // Active task - show spinner, elapsed time, and process status
  const processColor = isProcessAlive ? AURORA.green : AURORA.yellow;
  const processStatus = isProcessAlive ? 'active' : 'stale';

  // Center content vertically (spinner + time + blank + process status = 4 lines)
  const contentLines = 4;
  const paddingTop = Math.floor((lines - contentLines) / 2);
  const paddingBottom = lines - contentLines - paddingTop;

  return (
    <Box flexDirection="column" alignItems="center">
      {/* Top padding */}
      {Array(paddingTop)
        .fill('')
        .map((_, i) => (
          <Text key={`top-${i}`}> </Text>
        ))}

      {/* Spinner with "Running" label */}
      <Box>
        <Text color={FROST.nord8}>
          <Spinner type="dots" />
        </Text>
        <Text color={SNOW_STORM.nord6}> Running</Text>
      </Box>

      {/* Elapsed time */}
      <Text color={SNOW_STORM.nord4}>{formatDuration(elapsedMs)}</Text>

      {/* Blank line */}
      <Text> </Text>

      {/* Process health status */}
      <Text>
        <Text color={SNOW_STORM.nord4}>Process: </Text>
        <Text color={processColor}>{processStatus}</Text>
      </Text>

      {/* Bottom padding */}
      {Array(paddingBottom)
        .fill('')
        .map((_, i) => (
          <Text key={`bottom-${i}`}> </Text>
        ))}
    </Box>
  );
}

// Memoize to prevent unnecessary re-renders
export const ActivityIndicator = memo(ActivityIndicatorImpl);

export default ActivityIndicator;
