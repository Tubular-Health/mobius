/**
 * Header component for TUI dashboard
 *
 * Displays the MOBIUS ASCII art logo with Nord theme colors and runtime.
 */

import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import { FROST } from '../theme.js';
import { formatDuration, getElapsedMs } from '../utils/formatDuration.js';

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
  startedAt?: string;
}

/**
 * Header component - displays MOBIUS logo and runtime
 */
export function Header({ parentId, startedAt }: HeaderProps): JSX.Element {
  const [elapsed, setElapsed] = useState<number>(
    startedAt ? getElapsedMs(startedAt) : 0
  );

  // Update elapsed time every second
  useEffect(() => {
    if (!startedAt) return;

    // Initial calculation
    setElapsed(getElapsedMs(startedAt));

    const interval = setInterval(() => {
      setElapsed(getElapsedMs(startedAt));
    }, 1000);

    return () => clearInterval(interval);
  }, [startedAt]);

  const runtimeDisplay = startedAt ? ` | Runtime: ${formatDuration(elapsed)}` : '';

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
}

export default Header;
