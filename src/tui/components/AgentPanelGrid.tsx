/**
 * AgentPanelGrid - 2x2 grid layout for AgentPanel components
 *
 * Maps active tasks from ExecutionState to panel slots, showing
 * "(available)" placeholder panels for unused slots.
 */

import { Box } from 'ink';
import { memo } from 'react';
import { AgentPanel } from './AgentPanel.js';
import type { ActiveTask } from '../../types.js';

export interface AgentPanelGridProps {
  activeTasks: ActiveTask[];
  maxPanels?: number; // default: 4
  panelLines?: number; // default: 8
  refreshMs?: number; // default: 300
}

/**
 * AgentPanelGrid component - displays up to 4 agent panels in a 2x2 grid
 * Memoized to prevent re-renders when props haven't changed.
 *
 * Layout:
 * ┌─ MOB-126 ─────────────────┬─ MOB-128 ─────────────────┐
 * │ ⟳ Reading src/parser...   │ ⟳ Editing cli/commands... │
 * ├───────────────────────────┼───────────────────────────┤
 * │ (available)               │ (available)               │
 * └───────────────────────────┴───────────────────────────┘
 */
export const AgentPanelGrid = memo(function AgentPanelGrid({
  activeTasks,
  maxPanels = 4,
  panelLines = 8,
  refreshMs = 300,
}: AgentPanelGridProps): JSX.Element {
  // Create slots array with tasks or undefined for empty slots
  const slots: (ActiveTask | undefined)[] = [];
  const panelCount = Math.min(maxPanels, 4); // Cap at 4 for 2x2 grid

  for (let i = 0; i < panelCount; i++) {
    slots.push(activeTasks[i]);
  }

  // Split into rows (2 panels per row for 2x2 grid)
  const rows: (ActiveTask | undefined)[][] = [];
  for (let i = 0; i < slots.length; i += 2) {
    rows.push(slots.slice(i, i + 2));
  }

  return (
    <Box flexDirection="column">
      {rows.map((row, rowIndex) => (
        <Box key={rowIndex} flexDirection="row">
          {row.map((task, colIndex) => (
            <Box key={`${rowIndex}-${colIndex}`} flexGrow={1}>
              <AgentPanel
                activeTask={task}
                lines={panelLines}
                refreshMs={refreshMs}
              />
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
});

export default AgentPanelGrid;
