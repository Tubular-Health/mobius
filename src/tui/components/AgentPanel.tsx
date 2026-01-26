/**
 * AgentPanel - Displays live agent output in a bordered panel
 *
 * Uses `tmux capture-pane` to fetch latest output lines and displays
 * with task identifier header.
 */

import { Box, Text } from 'ink';
import { useState, useEffect, useRef, memo } from 'react';
import { execa } from 'execa';
import type { ActiveTask } from '../../types.js';
import { FROST, STRUCTURE_COLORS, SNOW_STORM } from '../theme.js';

export interface AgentPanelProps {
  activeTask?: ActiveTask; // undefined = show "(available)"
  lines?: number; // default: 8
  refreshMs?: number; // default: 500
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
function AgentPanelImpl({
  activeTask,
  lines = 8,
  refreshMs = 500,
}: AgentPanelProps): JSX.Element {
  const [output, setOutput] = useState<string[]>([]);
  const prevContentRef = useRef<string>('');

  // Extract pane ID for explicit dependency tracking
  // This ensures we re-subscribe when pane ID becomes available after agent spawn
  const paneId = activeTask?.pane;

  useEffect(() => {
    if (!activeTask) {
      if (prevContentRef.current !== '') {
        prevContentRef.current = '';
        setOutput([]);
      }
      return;
    }

    // Skip capture if pane ID is empty (agent starting, pane not yet assigned)
    if (!paneId) {
      setOutput(['(starting agent...)']);
      return;
    }

    // Reset previous content when pane changes to show fresh output immediately
    prevContentRef.current = '';

    // Fetch and only update if content changed
    const fetchOutput = async () => {
      const content = await captureTmuxPane(paneId, lines);

      // Skip update if content hasn't changed
      if (content === prevContentRef.current) {
        return;
      }
      prevContentRef.current = content;

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
  }, [activeTask, paneId, lines, refreshMs]);

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

// Memoize to prevent re-renders when props haven't changed
export const AgentPanel = memo(AgentPanelImpl);

export default AgentPanel;
