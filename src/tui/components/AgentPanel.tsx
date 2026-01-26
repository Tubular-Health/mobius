/**
 * AgentPanel - Displays task activity status in a bordered panel
 *
 * Shows an ActivityIndicator with spinner, elapsed time, and process health
 * for active tasks. Shows "(available)" header with "Ready for work" for
 * empty slots.
 */

import { Box, Text } from 'ink';
import { memo } from 'react';
import { execa } from 'execa';
import type { ActiveTask } from '../../types.js';
import { ActivityIndicator } from './ActivityIndicator.js';
import { FROST, STRUCTURE_COLORS } from '../theme.js';

export interface AgentPanelProps {
  activeTask?: ActiveTask; // undefined = show "(available)"
  lines?: number; // default: 8
  /** Elapsed time in milliseconds for this task */
  elapsedMs?: number;
  /** Whether the task's process is still alive */
  isProcessAlive?: boolean;
}

/**
 * Capture the last N lines from a tmux pane
 *
 * Kept for potential future use (e.g., detailed view mode).
 *
 * @param paneId - tmux pane identifier (e.g., "%0")
 * @param lines - Number of lines to capture
 * @returns The captured output lines
 */
export async function captureTmuxPane(paneId: string, lines: number): Promise<string> {
  try {
    const { stdout } = await execa('tmux', [
      'capture-pane',
      '-t',
      paneId,
      '-p',
      '-S',
      `-${lines}`,
    ]);
    return stdout;
  } catch {
    // Pane may not exist (agent finished) - return empty
    return '';
  }
}

/**
 * AgentPanel component - displays activity status for a task slot
 *
 * Active task panel:
 * ```
 * ┌─ MOB-126 ─────────────────────────────────┐
 * │                                           │
 * │            ⠋ Running                      │
 * │            2m 34s                         │
 * │                                           │
 * │            Process: active                │
 * │                                           │
 * └───────────────────────────────────────────┘
 * ```
 *
 * Empty slot:
 * ```
 * ┌─ (available) ─────────────────────────────┐
 * │                                           │
 * │            Ready for work                 │
 * │                                           │
 * └───────────────────────────────────────────┘
 * ```
 */
function AgentPanelImpl({
  activeTask,
  lines = 8,
  elapsedMs,
  isProcessAlive,
}: AgentPanelProps): JSX.Element {
  // Header text - task identifier or "(available)"
  const headerText = activeTask ? activeTask.id : '(available)';

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={FROST.nord9}
      paddingX={1}
    >
      {/* Header */}
      <Box>
        <Text color={STRUCTURE_COLORS.header} bold>
          {headerText}
        </Text>
      </Box>

      {/* Activity Indicator */}
      <ActivityIndicator
        isActive={!!activeTask}
        elapsedMs={elapsedMs}
        isProcessAlive={isProcessAlive}
        lines={lines}
      />
    </Box>
  );
}

// Memoize to prevent re-renders when props haven't changed
export const AgentPanel = memo(AgentPanelImpl);

export default AgentPanel;
