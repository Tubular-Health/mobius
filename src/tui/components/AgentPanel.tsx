/**
 * AgentPanel - Displays live agent output in a bordered panel
 *
 * Uses `tmux capture-pane` to fetch latest output lines and displays
 * with task identifier header.
 */

import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import { execa } from 'execa';
import type { ActiveTask } from '../../types.js';
import { FROST, STRUCTURE_COLORS, SNOW_STORM } from '../theme.js';

export interface AgentPanelProps {
  activeTask?: ActiveTask; // undefined = show "(available)"
  lines?: number; // default: 8
  refreshMs?: number; // default: 300
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
 * AgentPanel component - displays live output from a tmux pane
 */
export function AgentPanel({
  activeTask,
  lines = 8,
  refreshMs = 300,
}: AgentPanelProps): JSX.Element {
  const [output, setOutput] = useState<string[]>([]);

  useEffect(() => {
    if (!activeTask) {
      setOutput([]);
      return;
    }

    // Initial fetch
    const fetchOutput = async () => {
      const content = await captureTmuxPane(activeTask.pane, lines);
      const outputLines = content
        .split('\n')
        .filter(line => line.trim() !== '')
        .slice(-lines);
      setOutput(outputLines);
    };

    fetchOutput();

    // Set up polling interval
    const interval = setInterval(fetchOutput, refreshMs);

    return () => clearInterval(interval);
  }, [activeTask, lines, refreshMs]);

  // Header text - task identifier or "(available)"
  const headerText = activeTask ? activeTask.id : '(available)';

  // Pad output to fill panel height
  const paddedOutput = [...output];
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

export default AgentPanel;
