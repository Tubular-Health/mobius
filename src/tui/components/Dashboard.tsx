/**
 * Dashboard layout component for TUI
 *
 * Composes TaskTree, AgentPanelGrid, and Legend components. Manages state
 * subscription and re-renders on execution state file changes.
 */

import { Box, Text, useApp, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getModalSummary,
  readPendingUpdates,
  readRuntimeState,
  watchRuntimeState,
} from '../../lib/context-generator.js';
import { debugLog, getRecentDebugEvents, isDebugEnabled } from '../../lib/debug-logger.js';
import type { TaskGraph } from '../../lib/task-graph.js';
import { getGraphStats } from '../../lib/task-graph.js';
import { getSessionName } from '../../lib/tmux-display.js';
import type { RuntimeState } from '../../types/context.js';
import type { Backend, TuiConfig } from '../../types.js';
import { EXIT_REQUEST_EVENT, tuiEvents } from '../events.js';
import { AURORA, STRUCTURE_COLORS } from '../theme.js';
import { formatDuration, getElapsedMs } from '../utils/formatDuration.js';
import { AgentSlots } from './AgentSlots.js';
import type { BackendTask } from './BackendStatusBox.js';
import { BackendStatusBox } from './BackendStatusBox.js';
import { DebugPanel } from './DebugPanel.js';
import { ExitConfirmationModal } from './ExitConfirmationModal.js';
import { Header } from './Header.js';
import { Legend } from './Legend.js';
import { TaskTree } from './TaskTree.js';

/** Single tick interval for all time-based updates - consolidates all timers */
const TICK_INTERVAL_MS = 1000;

export interface DashboardProps {
  parentId: string;
  graph: TaskGraph; // Local/execution state (merged with runtime state)
  apiGraph: TaskGraph; // Backend state (unmodified API data)
  backend: Backend; // Which backend we're connected to
  config?: TuiConfig;
  debugMode?: boolean; // Whether debug mode is enabled
}

/**
 * Check if all tasks are in a terminal state (done or failed)
 */
function isExecutionComplete(graph: TaskGraph, executionState: RuntimeState | null): boolean {
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
export function Dashboard({
  parentId,
  graph,
  apiGraph,
  backend,
  config,
  debugMode,
}: DashboardProps): JSX.Element {
  const { exit } = useApp();
  const [executionState, setRuntimeState] = useState<RuntimeState | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  // Single tick counter that drives all time-based updates
  // This consolidates Header and TaskNode timers into one batched update
  const [tick, setTick] = useState(0);
  // Exit confirmation modal state
  const [showExitModal, setShowExitModal] = useState(false);
  // Debug events for the panel
  const [debugEvents, setDebugEvents] = useState(getRecentDebugEvents());
  // Pending update count for drift indicator
  const [pendingCount, setPendingCount] = useState(0);

  // Config defaults
  const showLegend = config?.show_legend ?? true;
  // Debug mode enabled if prop is true or global debug is enabled
  const showDebugPanel = debugMode || isDebugEnabled();

  // Memoize the state change handler to prevent recreating on each render
  // This callback is passed to watchRuntimeState and called when state file changes
  const handleStateChange = useCallback(
    (state: RuntimeState | null) => {
      // Log TUI state receive event for debugging
      if (showDebugPanel) {
        debugLog('tui_state_receive', 'tui', parentId, {
          activeTasks: state?.activeTasks.length ?? 0,
          completedTasks: state?.completedTasks.length ?? 0,
          failedTasks: state?.failedTasks.length ?? 0,
        });
        // Update debug events from ring buffer
        setDebugEvents(getRecentDebugEvents());
        // Update pending count for drift indicator
        const queue = readPendingUpdates(parentId);
        setPendingCount(queue.updates.filter((u) => !u.syncedAt && !u.error).length);
      }

      setRuntimeState(state);
      setIsComplete(isExecutionComplete(graph, state));
    },
    [graph, parentId, showDebugPanel]
  );

  // Subscribe to runtime state file changes
  useEffect(() => {
    // Read initial state
    const initialState = readRuntimeState(parentId);
    handleStateChange(initialState);

    // Watch for changes - uses memoized callback
    const cleanup = watchRuntimeState(parentId, handleStateChange);

    return cleanup;
  }, [parentId, handleStateChange]);

  // Single consolidated timer for header elapsed time
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, TICK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

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

  // Handle exit confirmation from modal
  const handleExitConfirm = useCallback(() => {
    setShowExitModal(false);
    handleExit();
  }, [handleExit]);

  // Handle exit cancellation from modal
  const handleExitCancel = useCallback(() => {
    setShowExitModal(false);
  }, []);

  // Count of active tasks - needed for exit confirmation logic
  const activeTaskCount = executionState?.activeTasks.length ?? 0;

  // Auto-exit when execution completes
  useEffect(() => {
    if (!isComplete) return;

    // Brief delay to show completion summary before exiting
    const exitTimer = setTimeout(handleExit, 2000);

    return () => clearTimeout(exitTimer);
  }, [isComplete, handleExit]);

  // Listen for exit request events (from ctrl+c / SIGINT)
  // This allows the signal handler to trigger the same exit flow as pressing 'q'
  useEffect(() => {
    const handleExitRequest = () => {
      if (isComplete) {
        // Execution complete - exit immediately
        handleExit();
      } else if (activeTaskCount > 0) {
        // Active tasks running - show confirmation modal
        setShowExitModal(true);
      } else {
        // No active tasks - exit immediately
        handleExit();
      }
    };

    tuiEvents.on(EXIT_REQUEST_EVENT, handleExitRequest);

    return () => {
      tuiEvents.off(EXIT_REQUEST_EVENT, handleExitRequest);
    };
  }, [isComplete, activeTaskCount, handleExit]);

  // Handle keypress for exit
  // - When complete: exit immediately on 'q', Enter, or Space
  // - When active tasks: show confirmation modal on 'q'
  // - When no active tasks (waiting): exit immediately on 'q'
  useInput(
    useCallback(
      (input, key) => {
        // Modal is showing - let it handle its own input
        if (showExitModal) {
          return;
        }

        if (isComplete && (key.return || input === 'q' || input === ' ')) {
          // Execution complete - exit immediately
          handleExit();
        } else if (!isComplete && input === 'q') {
          // Not complete - check if there are active tasks
          if (activeTaskCount > 0) {
            // Show confirmation modal
            setShowExitModal(true);
          } else {
            // No active tasks - exit immediately (waiting state)
            handleExit();
          }
        }
      },
      [isComplete, handleExit, showExitModal, activeTaskCount]
    )
  );

  // Memoize stats calculation to avoid recalculating on each render
  const stats = useMemo(() => getGraphStats(graph), [graph]);
  const completedCount = executionState?.completedTasks.length ?? 0;
  const failedCount = executionState?.failedTasks.length ?? 0;

  // Extract backend tasks from the unmodified API graph for the status box
  // Merge in real-time backend statuses from runtime state when available
  // This enables immediate status updates after push without re-fetching the graph
  const apiTasks: BackendTask[] = useMemo(
    () =>
      Array.from(apiGraph.tasks.values())
        .map((t) => {
          // Check if we have a more recent status from push
          const pushedStatus = executionState?.backendStatuses?.[t.identifier];
          return {
            identifier: t.identifier,
            // Use pushed status if available, otherwise fall back to API graph
            status: pushedStatus ? (pushedStatus.status as typeof t.status) : t.status,
          };
        })
        .sort((a, b) => a.identifier.localeCompare(b.identifier)),
    [apiGraph, executionState?.backendStatuses]
  );

  // Calculate elapsed time - recalculates on each tick
  // This consolidates the timer that was previously in Header
  const elapsedMs = useMemo(() => {
    if (!executionState?.startedAt) return undefined;
    return getElapsedMs(executionState.startedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick drives updates
  }, [executionState?.startedAt]);

  // Show "Waiting for execution..." when state file missing
  if (!executionState) {
    return (
      <Box flexDirection="column" padding={1}>
        <Header parentId={parentId} elapsedMs={undefined} />
        {/* Side-by-side: Task Tree + Backend Status */}
        <Box flexDirection="row">
          <Box flexGrow={1}>
            <TaskTree graph={graph} executionState={undefined} tick={tick} />
          </Box>
          <Box width={24} marginLeft={1}>
            <BackendStatusBox tasks={apiTasks} backend={backend} />
          </Box>
        </Box>
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
      <Box flexDirection="column" padding={1}>
        <Header parentId={parentId} elapsedMs={elapsedMs} />
        {/* Side-by-side: Task Tree + Backend Status */}
        <Box flexDirection="row">
          <Box flexGrow={1}>
            <TaskTree graph={graph} executionState={executionState} tick={tick} />
          </Box>
          <Box width={24} marginLeft={1}>
            <BackendStatusBox tasks={apiTasks} backend={backend} />
          </Box>
        </Box>

        {/* Completion Summary */}
        <Box marginTop={1} flexDirection="column">
          <Text color={summaryColor} bold>
            Execution {statusText}
          </Text>
          <Text color={STRUCTURE_COLORS.text}>
            Total: {stats.total} | Done: {completedCount} | Failed: {failedCount} | Runtime:{' '}
            {formatDuration(elapsedMs ?? 0)}
          </Text>
        </Box>

        {/* Exit instruction */}
        <Box marginTop={1}>
          <Text color={STRUCTURE_COLORS.muted}>Exiting in 2s... (press any key to exit now)</Text>
        </Box>

        {showLegend && (
          <Box marginTop={1}>
            <Legend visible={showLegend} />
          </Box>
        )}
      </Box>
    );
  }

  // Compute modal summary (only needed when modal is shown, but always available)
  const sessionName = getSessionName(parentId);
  const modalSummary = getModalSummary(executionState, elapsedMs ?? 0);

  // Normal running state - show full dashboard
  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Header parentId={parentId} elapsedMs={elapsedMs} />

      {/* Side-by-side: Task Tree + Backend Status */}
      <Box flexDirection="row">
        <Box flexGrow={1}>
          <TaskTree graph={graph} executionState={executionState} tick={tick} />
        </Box>
        <Box width={24} marginLeft={1}>
          <BackendStatusBox tasks={apiTasks} backend={backend} />
        </Box>
      </Box>

      {/* Agent Slots */}
      <Box marginTop={1}>
        <AgentSlots activeTasks={executionState.activeTasks} maxSlots={4} />
      </Box>

      {/* Legend */}
      {showLegend && (
        <Box marginTop={1}>
          <Legend visible={showLegend} />
        </Box>
      )}

      {/* Debug Panel - shown when debug mode is enabled */}
      {showDebugPanel && (
        <Box marginTop={1}>
          <DebugPanel events={debugEvents} pendingCount={pendingCount} maxLines={8} />
        </Box>
      )}

      {/* Exit Confirmation Modal */}
      {showExitModal && (
        <Box marginTop={1}>
          <ExitConfirmationModal
            sessionName={sessionName}
            activeAgentCount={activeTaskCount}
            summary={modalSummary}
            onConfirm={handleExitConfirm}
            onCancel={handleExitCancel}
          />
        </Box>
      )}
    </Box>
  );
}

export default Dashboard;
