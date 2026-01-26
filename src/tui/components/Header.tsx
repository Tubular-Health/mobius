/**
 * Header component for TUI dashboard
 *
 * Displays the MOBIUS ASCII art logo with Nord theme colors and runtime.
 * Time display is driven by parent's tick to consolidate timers.
 */

import { Box, Text } from 'ink';
import { memo } from 'react';
import { FROST } from '../theme.js';
import { formatDuration } from '../utils/formatDuration.js';

const LOGO_LINES = [
  '███╗   ███╗ ██████╗ ██████╗ ██╗██╗   ██╗███████╗',
  '████╗ ████║██╔═══██╗██╔══██╗██║██║   ██║██╔════╝',
  '██╔████╔██║██║   ██║██████╔╝██║██║   ██║███████╗',
  '██║╚██╔╝██║██║   ██║██╔══██╗██║██║   ██║╚════██║',
  '██║ ╚═╝ ██║╚██████╔╝██████╔╝██║╚██████╔╝███████║',
  '╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝ ╚══════╝',
];

export interface HeaderProps {
  parentId?: string;
  /** Elapsed time in milliseconds - calculated by parent to consolidate timers */
  elapsedMs?: number;
}

/**
 * Header component - displays MOBIUS logo and runtime
 * Memoized to prevent unnecessary re-renders when props haven't changed.
 * No internal timer - elapsed time is passed from parent's consolidated tick.
 */
export const Header = memo(function Header({ parentId, elapsedMs }: HeaderProps): JSX.Element {
  const runtimeDisplay = elapsedMs !== undefined ? ` | Runtime: ${formatDuration(elapsedMs)}` : '';

  return (
    <Box flexDirection="column" alignItems="center" marginBottom={1}>
      {LOGO_LINES.map((line, index) => (
        <Text key={index} color={FROST.nord8}>
          {line}
        </Text>
      ))}
      {parentId && (
        <Text color={FROST.nord9} dimColor>
          Task Tree for {parentId}{runtimeDisplay}
        </Text>
      )}
    </Box>
  );
});

export default Header;
