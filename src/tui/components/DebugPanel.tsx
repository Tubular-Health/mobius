/**
 * Debug panel component for TUI
 *
 * Displays recent debug events in a collapsible panel.
 * Shows timestamps, event types, and highlights drift indicators.
 */

import { Box, Text, useInput } from 'ink';
import { useCallback, useState } from 'react';
import type { DebugEvent, DebugEventType } from '../../types/debug.js';
import { AURORA, FROST, POLAR_NIGHT, SNOW_STORM } from '../theme.js';

/**
 * Color mappings for different event types
 */
const EVENT_COLORS: Record<DebugEventType, string> = {
  runtime_state_write: FROST.nord10,
  runtime_state_read: POLAR_NIGHT.nord3,
  runtime_watcher_trigger: AURORA.purple,
  task_state_change: AURORA.yellow,
  pending_update_queue: FROST.nord8,
  pending_update_push: AURORA.green,
  backend_status_update: AURORA.green,
  lock_acquire: POLAR_NIGHT.nord3,
  lock_release: POLAR_NIGHT.nord3,
  tui_state_receive: FROST.nord9,
};

/**
 * Short labels for event types
 */
const EVENT_LABELS: Record<DebugEventType, string> = {
  runtime_state_write: 'STATE:WRITE',
  runtime_state_read: 'STATE:READ',
  runtime_watcher_trigger: 'WATCHER',
  task_state_change: 'TASK',
  pending_update_queue: 'QUEUE',
  pending_update_push: 'PUSH',
  backend_status_update: 'BACKEND',
  lock_acquire: 'LOCK+',
  lock_release: 'LOCK-',
  tui_state_receive: 'TUI:RECV',
};

export interface DebugPanelProps {
  events: DebugEvent[];
  pendingCount?: number;
  maxLines?: number;
}

/**
 * Format timestamp for display (HH:mm:ss.SSS)
 */
function formatTimestamp(isoTimestamp: string): string {
  return isoTimestamp.split('T')[1]?.slice(0, 12) ?? '';
}

/**
 * Format event data for compact display
 */
function formatEventData(data: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
    // Truncate long values
    const truncated = valueStr.length > 30 ? `${valueStr.slice(0, 27)}...` : valueStr;
    parts.push(`${key}=${truncated}`);
  }
  return parts.join(' ');
}

/**
 * Single event row component
 */
function EventRow({ event }: { event: DebugEvent }): JSX.Element {
  const time = formatTimestamp(event.timestamp);
  const label = EVENT_LABELS[event.type].padEnd(12);
  const color = EVENT_COLORS[event.type];
  const taskPart = event.taskId ? `[${event.taskId}] ` : '';
  const dataStr = formatEventData(event.data);

  return (
    <Box>
      <Text color={POLAR_NIGHT.nord3}>[{time}]</Text>
      <Text color={color}> {label}</Text>
      <Text color={SNOW_STORM.nord4}> {taskPart}</Text>
      <Text color={POLAR_NIGHT.nord3}>{dataStr}</Text>
    </Box>
  );
}

/**
 * Debug panel component
 *
 * Displays recent debug events with color-coded event types.
 * Press 'd' to toggle visibility.
 */
export function DebugPanel({
  events,
  pendingCount = 0,
  maxLines = 8,
}: DebugPanelProps): JSX.Element {
  const [expanded, setExpanded] = useState(true);

  // Toggle panel visibility with 'd' key
  useInput(
    useCallback((input) => {
      if (input === 'd') {
        setExpanded((prev) => !prev);
      }
    }, [])
  );

  // Get recent events (limited to maxLines)
  const recentEvents = events.slice(-maxLines);

  // Drift indicator - show when pending updates exist
  const hasDrift = pendingCount > 0;

  if (!expanded) {
    return (
      <Box>
        <Text color={POLAR_NIGHT.nord3}>[Debug panel collapsed - press 'd' to expand]</Text>
        {hasDrift && <Text color={AURORA.orange}> ({pendingCount} pending)</Text>}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={FROST.nord9} paddingX={1}>
      {/* Header */}
      <Box justifyContent="space-between">
        <Text color={FROST.nord8} bold>
          Debug Events
        </Text>
        <Box>
          {hasDrift && (
            <Text color={AURORA.orange} bold>
              DRIFT: {pendingCount} pending
            </Text>
          )}
          <Text color={POLAR_NIGHT.nord3}> [d] toggle</Text>
        </Box>
      </Box>

      {/* Events list */}
      <Box flexDirection="column" marginTop={1}>
        {recentEvents.length === 0 ? (
          <Text color={POLAR_NIGHT.nord3}>No events yet...</Text>
        ) : (
          recentEvents.map((event, index) => (
            <EventRow key={`${event.timestamp}-${index}`} event={event} />
          ))
        )}
      </Box>

      {/* Footer with count */}
      {events.length > maxLines && (
        <Box marginTop={1}>
          <Text color={POLAR_NIGHT.nord3}>
            Showing {recentEvents.length} of {events.length} events
          </Text>
        </Box>
      )}
    </Box>
  );
}

export default DebugPanel;
