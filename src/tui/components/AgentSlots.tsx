/**
 * AgentSlots - Simple inline display of agent slot status
 *
 * Shows filled (●) or empty (○) indicators with task IDs for active slots.
 * Example: Agents: ● MOB-123  ● MOB-456  ○  ○
 */

import { Box, Text } from 'ink';
import { memo } from 'react';
import type { ActiveTask } from '../../types.js';
import { AURORA, POLAR_NIGHT, SNOW_STORM } from '../theme.js';

export interface AgentSlotsProps {
  activeTasks: ActiveTask[];
  maxSlots?: number;
}

/**
 * AgentSlots component - displays agent slot status inline
 */
export const AgentSlots = memo(function AgentSlots({
  activeTasks,
  maxSlots = 4,
}: AgentSlotsProps): JSX.Element {
  const slots: (ActiveTask | undefined)[] = [];

  for (let i = 0; i < maxSlots; i++) {
    slots.push(activeTasks[i]);
  }

  return (
    <Box>
      <Text color={SNOW_STORM.nord4}>Agents: </Text>
      {slots.map((task, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: slots are fixed positional items
        <Box key={i} marginRight={2}>
          {task ? (
            <Text>
              <Text color={AURORA.green}>●</Text>
              <Text color={SNOW_STORM.nord6}> {task.id}</Text>
            </Text>
          ) : (
            <Text color={POLAR_NIGHT.nord3}>○</Text>
          )}
        </Box>
      ))}
    </Box>
  );
});

export default AgentSlots;
