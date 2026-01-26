/**
 * Dashboard layout component for TUI
 *
 * Composes TaskTree, AgentPanelGrid, and Legend components. Manages state
 * subscription and re-renders on execution state file changes.
 */

import { Box, Text, useApp, useInput } from 'ink';
import { useState, useEffect, useCallback, useMemo } from 'react';
import type { TaskGraph } from '../../lib/task-graph.js';
import { getGraphStats } from '../../lib/task-graph.js';
import type { ExecutionState, TuiConfig } from '../../types.js';
import { readExecutionState, watchExecutionState, isProcessRunning } from '../../lib/execution-state.js';
import { TaskTree } from './TaskTree.js';
import { AgentPanelGrid } from './AgentPanelGrid.js';
import { Legend } from './Legend.js';
import { Header } from './Header.js';
import { STRUCTURE_COLORS, AURORA } from '../theme.js';
import { formatDuration, getElapsedMs } from '../utils/formatDuration.js';

/** Single tick interval for all time-based updates - consolidates all timers */
const TICK_INTERVAL_MS = 1000;

export interface DashboardProps {
  parentId: string;
  graph: TaskGraph;
  config?: TuiConfig;
}

/**
 * Check if all tasks are in a terminal state (done or failed)
 */
function isExecutionComplete(
  graph: TaskGraph,
  executionState: ExecutionState | null
): boolean {
  if (!executionState) {
    return false;
  }

  const totalTasks = graph.tasks.size;
  const completedCount = executionState.completedTasks.length;
  const failedCount = executionState.failedTasks.length;

  // All tasks are in a terminal state
  return completedCount + failedCount >= totalTasks;
}

/**
 * Dashboard component - main TUI layout
 *
 * Layout:
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  Task Tree for MOB-11:                                              │
 * │  ├── [✓] MOB-124: Setup base types                                  │
 * │  ...                                                                 │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ MOB-126                         │ MOB-128                           │
 * │      ⠋ Running                  │      ⠋ Running                    │
 * │      2m 34s                     │      1m 12s                       │
 * │      Process: active            │      Process: active              │
 * ├─────────────────────────────────┼───────────────────────────────────┤
 * │ (available)                     │ (available)                       │
 * │      Ready for work             │      Ready for work               │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │  Legend: [✓] Done  [→] Ready  [·] Blocked  [⟳] In Progress          │
 * └─────────────────────────────────────────────────────────────────────┘
 */
export function Dashboard({ parentId, graph, config }: DashboardProps): JSX.Element {
  const { exit } = useApp();
  const [executionState, setExecutionState] = useState<ExecutionState | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  // Single tick counter that drives all time-based updates
  // This consolidates Header and TaskNode timers into one batched update
  const [tick, setTick] = useState(0);
  // Task elapsed times and process health - updated synchronously on each tick
  const [taskElapsedMs, setTaskElapsedMs] = useState<Map<string, number>>(new Map());
  const [taskProcessHealth, setTaskProcessHealth] = useState<Map<string, boolean>>(new Map());

  // Config defaults
  const showLegend = config?.show_legend ?? true;
  const stateDir = config?.state_dir;
  const panelLines = config?.panel_lines ?? 8;

  // Memoize the state change handler to prevent recreating on each render
  // This callback is passed to watchExecutionState and called when state file changes
  const handleStateChange = useCallback(
    (state: ExecutionState | null) => {
      setExecutionState(state);
      setIsComplete(isExecutionComplete(graph, state));
    },
    [graph]
  );

  // Subscribe to execution state file changes
  useEffect(() => {
    // Read initial state
    const initialState = readExecutionState(parentId, stateDir);
    handleStateChange(initialState);

    // Watch for changes - uses memoized callback
    const cleanup = watchExecutionState(parentId, handleStateChange, stateDir);

    return cleanup;
  }, [parentId, stateDir, handleStateChange]);

  // Single consolidated timer for all time-based updates
  // Computes elapsed times and checks process health synchronously (no async tmux capture)
  useEffect(() => {
    const interval = setInterval(() => {
      // Update elapsed times and process health for active tasks
      if (executionState?.activeTasks.length) {
        const elapsedMap = new Map<string, number>();
        const healthMap = new Map<string, boolean>();

        for (const task of executionState.activeTasks) {
          // Compute elapsed time from task's startedAt timestamp
          elapsedMap.set(task.id, getElapsedMs(task.startedAt));
          // Check if process is still running
          healthMap.set(task.id, isProcessRunning(task.pid));
        }

        setTaskElapsedMs(elapsedMap);
        setTaskProcessHealth(healthMap);
      }
      setTick((t) => t + 1);
    }, TICK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [executionState?.activeTasks]);

  // Memoize the exit handler to prevent recreating on each render
  // Used by both auto-exit effect and keypress handler
  const handleExit = useCallback(() => {
    // Kill the loop process if still running
    if (executionState?.loopPid) {
      try {
        process.kill(executionState.loopPid, 'SIGTERM');
      } catch {
        // Process may have already exited
      }
    }

    // Determine exit code based on failures
    const hasFailures = (executionState?.failedTasks.length ?? 0) > 0;
    exit();
    process.exitCode = hasFailures ? 1 : 0;
  }, [executionState?.loopPid, executionState?.failedTasks.length, exit]);

  // Auto-exit when execution completes
  useEffect(() => {
    if (!isComplete) return;

    // Brief delay to show completion summary before exiting
    const exitTimer = setTimeout(handleExit, 2000);

    return () => clearTimeout(exitTimer);
  }, [isComplete, handleExit]);

  // Handle keypress for immediate exit when complete
  useInput(
    useCallback(
      (input, key) => {
        if (isComplete && (key.return || input === 'q' || input === ' ')) {
          handleExit();
        }
      },
      [isComplete, handleExit]
    )
  );

  // Memoize stats calculation to avoid recalculating on each render
  const stats = useMemo(() => getGraphStats(graph), [graph]);
  const completedCount = executionState?.completedTasks.length ?? 0;
  const failedCount = executionState?.failedTasks.length ?? 0;

  // Calculate elapsed time - recalculates on each tick
  // This consolidates the timer that was previously in Header
  const elapsedMs = useMemo(() => {
    if (!executionState?.startedAt) return undefined;
    return getElapsedMs(executionState.startedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick drives updates
  }, [executionState?.startedAt, tick]);

  // Show "Waiting for execution..." when state file missing
  if (!executionState) {
    return (
      <Box flexDirection="column" padding={1} >
        <Header parentId={parentId} elapsedMs={undefined} />
        <TaskTree graph={graph} executionState={undefined} tick={tick} />
        <Box marginTop={1}>
          <Text color={STRUCTURE_COLORS.muted}>
            Waiting for execution... (watching for state file)
          </Text>
        </Box>
        {showLegend && (
          <Box marginTop={1}>
            <Legend visible={showLegend} />
          </Box>
        )}
      </Box>
    );
  }

  // Show completion summary when all tasks done/failed
  if (isComplete) {
    const hasFailures = failedCount > 0;
    const summaryColor = hasFailures ? AURORA.red : AURORA.green;
    const statusText = hasFailures ? 'completed with failures' : 'completed successfully';

    return (
      <Box flexDirection="column" padding={1} >
        <Header parentId={parentId} elapsedMs={elapsedMs} />
        <TaskTree graph={graph} executionState={executionState} tick={tick} />

        {/* Completion Summary */}
        <Box marginTop={1} flexDirection="column">
          <Text color={summaryColor} bold>
            Execution {statusText}
          </Text>
          <Text color={STRUCTURE_COLORS.text}>
            Total: {stats.total} | Done: {completedCount} | Failed: {failedCount} | Runtime: {formatDuration(elapsedMs ?? 0)}
          </Text>
        </Box>

        {/* Exit instruction */}
        <Box marginTop={1}>
          <Text color={STRUCTURE_COLORS.muted}>
            Exiting in 2s... (press any key to exit now)
          </Text>
        </Box>

        {showLegend && (
          <Box marginTop={1}>
            <Legend visible={showLegend} />
          </Box>
        )}
      </Box>
    );
  }

  // Normal running state - show full dashboard
  return (
    <Box flexDirection="column" padding={1} >
      {/* Header */}
      <Header parentId={parentId} elapsedMs={elapsedMs} />

      {/* Task Tree */}
      <TaskTree graph={graph} executionState={executionState} tick={tick} />

      {/* Agent Panel Grid */}
      <Box marginTop={1}>
        <AgentPanelGrid
          activeTasks={executionState.activeTasks}
          maxPanels={4}
          panelLines={panelLines}
          taskElapsedMs={taskElapsedMs}
          taskProcessHealth={taskProcessHealth}
        />
      </Box>

      {/* Legend */}
      {showLegend && (
        <Box marginTop={1}>
          <Legend visible={showLegend} />
        </Box>
      )}
    </Box>
  );
}

export default Dashboard;
