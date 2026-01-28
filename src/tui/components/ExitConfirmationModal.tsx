/**
 * ExitConfirmationModal - Displays exit confirmation overlay
 *
 * Shows a modal when the user attempts to exit during active task execution.
 * Warns that exiting will kill the tmux session and stop all running agents.
 */

import { Box, Text, useInput } from 'ink';
import { memo } from 'react';
import type { ExecutionSummary } from '../../lib/context-generator.js';
import { formatDuration } from '../utils/formatDuration.js';
import { AURORA, STRUCTURE_COLORS } from '../theme.js';

export interface ExitConfirmationModalProps {
  /** The tmux session name (e.g., "mobius-MOB-123") */
  sessionName: string;
  /** Number of currently active/running agents */
  activeAgentCount: number;
  /** Execution summary with progress and elapsed time */
  summary: ExecutionSummary;
  /** Callback when user confirms exit (presses 'y') */
  onConfirm: () => void;
  /** Callback when user cancels exit (presses 'n') */
  onCancel: () => void;
}

/**
 * ExitConfirmationModal component - displays exit confirmation dialog
 *
 * ```
 * ╭──────────────────────────────────────────────╮
 * │                                              │
 * │            ⚠ Confirm Exit                    │
 * │                                              │
 * │  This will kill tmux session [mobius-MOB-1]  │
 * │  and stop 2 running agents.                  │
 * │                                              │
 * │  Progress: 3/5 completed, 0 failed           │
 * │  Runtime: 5m 23s                             │
 * │                                              │
 * │            [Y]es    [N]o                     │
 * │                                              │
 * ╰──────────────────────────────────────────────╯
 * ```
 */
function ExitConfirmationModalImpl({
  sessionName,
  activeAgentCount,
  summary,
  onConfirm,
  onCancel,
}: ExitConfirmationModalProps): JSX.Element {
  // Handle 'y'/'n' keypresses
  useInput((input, key) => {
    const lowerInput = input.toLowerCase();
    if (lowerInput === 'y') {
      onConfirm();
    } else if (lowerInput === 'n' || key.escape) {
      onCancel();
    }
  });

  const agentText = activeAgentCount === 1 ? 'agent' : 'agents';

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={AURORA.yellow}
      paddingX={2}
      paddingY={1}
    >
      {/* Header */}
      <Box justifyContent="center" marginBottom={1}>
        <Text color={AURORA.yellow} bold>
          ⚠ Confirm Exit
        </Text>
      </Box>

      {/* Warning message */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={STRUCTURE_COLORS.text}>
          This will kill tmux session [{sessionName}]
        </Text>
        <Text color={STRUCTURE_COLORS.text}>
          and stop {activeAgentCount} running {agentText}.
        </Text>
      </Box>

      {/* Execution summary */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={STRUCTURE_COLORS.muted}>
          Progress: {summary.completed}/{summary.total} completed
          {summary.failed > 0 && (
            <Text color={AURORA.red}>, {summary.failed} failed</Text>
          )}
        </Text>
        <Text color={STRUCTURE_COLORS.muted}>
          Runtime: {formatDuration(summary.elapsedMs)}
        </Text>
      </Box>

      {/* Action buttons */}
      <Box justifyContent="center" gap={2}>
        <Text>
          <Text color={AURORA.green} bold>[Y]</Text>
          <Text color={STRUCTURE_COLORS.text}>es</Text>
        </Text>
        <Text>
          <Text color={AURORA.red} bold>[N]</Text>
          <Text color={STRUCTURE_COLORS.text}>o</Text>
        </Text>
      </Box>
    </Box>
  );
}

// Memoize to prevent re-renders when props haven't changed
export const ExitConfirmationModal = memo(ExitConfirmationModalImpl);

export default ExitConfirmationModal;
