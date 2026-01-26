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
  /** Elapsed time per task (keyed by task id) */
  taskElapsedMs?: Map<string, number>;
  /** Process health per task (keyed by task id) */
  taskProcessHealth?: Map<string, boolean>;
}

/**
 * AgentPanelGrid component - displays up to 4 agent panels in a 2x2 grid
 * Memoized to prevent re-renders when props haven't changed.
 *
 * Layout:
 * ┌─ MOB-126 ─────────────────┬─ MOB-128 ─────────────────┐
 * │      ⠋ Running            │      ⠋ Running            │
 * │      2m 34s               │      1m 12s               │
 * │      Process: active      │      Process: active      │
 * ├───────────────────────────┼───────────────────────────┤
 * │ (available)               │ (available)               │
 * │      Ready for work       │      Ready for work       │
 * └───────────────────────────┴───────────────────────────┘
 */
export const AgentPanelGrid = memo(function AgentPanelGrid({
  activeTasks,
  maxPanels = 4,
  panelLines = 8,
  taskElapsedMs,
  taskProcessHealth,
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
                elapsedMs={task ? taskElapsedMs?.get(task.id) : undefined}
                isProcessAlive={task ? taskProcessHealth?.get(task.id) : undefined}
              />
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
});

export default AgentPanelGrid;
