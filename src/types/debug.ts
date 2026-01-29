/**
 * Debug mode type definitions for state drift diagnostics
 *
 * These types support the --debug flag which emits timestamped logs
 * of all state transitions to diagnose drift between local execution
 * state and backend status.
 */

/**
 * Types of debug events that can be logged
 */
export type DebugEventType =
  | 'runtime_state_write' // Writing to runtime.json
  | 'runtime_state_read' // Reading from runtime.json
  | 'runtime_watcher_trigger' // File watcher detected change
  | 'task_state_change' // Task status transition (active/complete/fail)
  | 'pending_update_queue' // Update added to pending-updates.json
  | 'pending_update_push' // Update pushed to backend
  | 'backend_status_update' // Backend status synced after push
  | 'lock_acquire' // Lock acquired for state mutation
  | 'lock_release' // Lock released after state mutation
  | 'tui_state_receive'; // TUI received state update

/**
 * A single debug event entry
 */
export interface DebugEvent {
  timestamp: string; // ISO timestamp with milliseconds
  type: DebugEventType;
  source: 'loop' | 'tui' | 'push' | 'context-generator';
  taskId?: string; // Task identifier if applicable (e.g., "MOB-124")
  data: Record<string, unknown>;
}

/**
 * Debug mode configuration
 */
export interface DebugConfig {
  enabled: boolean;
  verbosity: 'minimal' | 'normal' | 'verbose';
  logToFile: boolean;
  sessionId?: string; // Unique session ID for log file naming
}

/**
 * Debug verbosity levels determine what events are logged:
 * - minimal: Only task state changes and errors
 * - normal: Task changes, pending updates, backend status
 * - verbose: All events including lock operations and watcher triggers
 */
export const VERBOSITY_LEVELS: Record<DebugConfig['verbosity'], DebugEventType[]> = {
  minimal: ['task_state_change', 'backend_status_update'],
  normal: [
    'task_state_change',
    'pending_update_queue',
    'pending_update_push',
    'backend_status_update',
    'tui_state_receive',
  ],
  verbose: [
    'runtime_state_write',
    'runtime_state_read',
    'runtime_watcher_trigger',
    'task_state_change',
    'pending_update_queue',
    'pending_update_push',
    'backend_status_update',
    'lock_acquire',
    'lock_release',
    'tui_state_receive',
  ],
};
