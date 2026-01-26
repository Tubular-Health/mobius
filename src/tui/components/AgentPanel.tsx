/**
 * AgentPanel - Displays live agent output in a bordered panel
 *
 * Uses `tmux capture-pane` to fetch latest output lines and displays
 * with task identifier header. Refresh is driven by parent's tick to
 * consolidate all updates into a single render cycle.
 */

import { Box, Text } from 'ink';
import { memo } from 'react';
import { execa } from 'execa';
import type { ActiveTask } from '../../types.js';
import { FROST, STRUCTURE_COLORS, SNOW_STORM } from '../theme.js';

export interface AgentPanelProps {
  activeTask?: ActiveTask; // undefined = show "(available)"
  lines?: number; // default: 8
  /** Pre-fetched output lines from parent - no internal fetching */
  outputLines?: string[];
}

/**
 * Capture the last N lines from a tmux pane
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
 * AgentPanel component - displays output from a tmux pane
 * Pure display component - output is fetched by parent and passed as props.
 * This eliminates async state updates that cause flickering.
 */
function AgentPanelImpl({
  activeTask,
  lines = 8,
  outputLines = [],
}: AgentPanelProps): JSX.Element {
  // Header text - task identifier or "(available)"
  const headerText = activeTask ? activeTask.id : '(available)';

  // Pad output to fill panel height
  const paddedOutput = [...outputLines];
  while (paddedOutput.length < lines) {
    paddedOutput.push('');
  }

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

      {/* Output lines */}
      {paddedOutput.map((line, index) => (
        <Text key={index} color={SNOW_STORM.nord4} wrap="truncate">
          {line || ' '}
        </Text>
      ))}
    </Box>
  );
}

// Memoize to prevent re-renders when props haven't changed
export const AgentPanel = memo(AgentPanelImpl);

export default AgentPanel;
