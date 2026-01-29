/**
 * Debug logger utility for state drift diagnostics
 *
 * Provides a singleton DebugLogger class that:
 * - Maintains a ring buffer of recent events (for TUI display)
 * - Writes to log files at ~/.mobius/issues/{parentId}/execution/debug-{sessionId}.log
 * - Outputs to stderr in non-TUI mode with color-coded event types
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import type { DebugConfig, DebugEvent, DebugEventType } from '../types/debug.js';
import { VERBOSITY_LEVELS } from '../types/debug.js';
import { getExecutionPath } from './context-generator.js';

/** Maximum events to keep in ring buffer */
const RING_BUFFER_SIZE = 100;

/**
 * Color mappings for different event types
 */
const EVENT_COLORS: Record<DebugEventType, typeof chalk> = {
  runtime_state_write: chalk.blue,
  runtime_state_read: chalk.gray,
  runtime_watcher_trigger: chalk.magenta,
  task_state_change: chalk.yellow,
  pending_update_queue: chalk.cyan,
  pending_update_push: chalk.green,
  backend_status_update: chalk.greenBright,
  lock_acquire: chalk.gray,
  lock_release: chalk.gray,
  tui_state_receive: chalk.blueBright,
};

/**
 * Short labels for event types (for compact console output)
 */
const EVENT_LABELS: Record<DebugEventType, string> = {
  runtime_state_write: 'runtime:state:write',
  runtime_state_read: 'runtime:state:read',
  runtime_watcher_trigger: 'runtime:watcher',
  task_state_change: 'task:state:change',
  pending_update_queue: 'pending:update:queue',
  pending_update_push: 'pending:update:push',
  backend_status_update: 'backend:status:update',
  lock_acquire: 'lock:acquire',
  lock_release: 'lock:release',
  tui_state_receive: 'tui:state:receive',
};

/**
 * Singleton debug logger instance
 */
class DebugLogger {
  private config: DebugConfig = {
    enabled: false,
    verbosity: 'normal',
    logToFile: true,
  };

  private ringBuffer: DebugEvent[] = [];
  private logFilePath: string | null = null;

  /**
   * Initialize the debug logger for a session
   *
   * @param parentId - Parent issue identifier (e.g., "MOB-161")
   * @param verbosity - Logging verbosity level
   */
  initialize(parentId: string, verbosity: DebugConfig['verbosity'] = 'normal'): void {
    this.config = {
      enabled: true,
      verbosity,
      logToFile: true,
      sessionId: Date.now().toString(36),
    };

    // Set up log file
    const executionDir = getExecutionPath(parentId);
    if (!existsSync(executionDir)) {
      mkdirSync(executionDir, { recursive: true });
    }
    this.logFilePath = join(executionDir, `debug-${this.config.sessionId}.log`);

    // Log initialization
    this.log('task_state_change', 'loop', undefined, {
      event: 'debug_session_start',
      verbosity,
      logFile: this.logFilePath,
    });
  }

  /**
   * Check if debug logging is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the current verbosity level
   */
  getVerbosity(): DebugConfig['verbosity'] {
    return this.config.verbosity;
  }

  /**
   * Check if an event type should be logged at the current verbosity
   */
  shouldLog(eventType: DebugEventType): boolean {
    if (!this.config.enabled) return false;
    return VERBOSITY_LEVELS[this.config.verbosity].includes(eventType);
  }

  /**
   * Log a debug event
   *
   * @param type - Type of event
   * @param source - Source component (loop, tui, push, context-generator)
   * @param taskId - Optional task identifier
   * @param data - Event-specific data
   */
  log(
    type: DebugEventType,
    source: DebugEvent['source'],
    taskId?: string,
    data: Record<string, unknown> = {}
  ): void {
    if (!this.shouldLog(type)) return;

    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      type,
      source,
      taskId,
      data,
    };

    // Add to ring buffer
    this.ringBuffer.push(event);
    if (this.ringBuffer.length > RING_BUFFER_SIZE) {
      this.ringBuffer.shift();
    }

    // Write to log file
    if (this.config.logToFile && this.logFilePath) {
      this.writeToFile(event);
    }

    // Write to stderr for non-TUI mode
    this.writeToStderr(event);
  }

  /**
   * Get recent events from the ring buffer
   *
   * @param count - Maximum number of events to return
   * @returns Array of recent debug events
   */
  getRecentEvents(count: number = 20): DebugEvent[] {
    return this.ringBuffer.slice(-count);
  }

  /**
   * Clear the ring buffer
   */
  clearBuffer(): void {
    this.ringBuffer = [];
  }

  /**
   * Disable the logger
   */
  disable(): void {
    this.config.enabled = false;
  }

  /**
   * Get the log file path
   */
  getLogFilePath(): string | null {
    return this.logFilePath;
  }

  /**
   * Format event for file output
   */
  private formatForFile(event: DebugEvent): string {
    const time = event.timestamp.split('T')[1].replace('Z', '');
    const taskPart = event.taskId ? ` [${event.taskId}]` : '';
    const dataStr = Object.keys(event.data).length > 0 ? ` ${JSON.stringify(event.data)}` : '';

    return `[DEBUG ${time}] ${EVENT_LABELS[event.type]}${taskPart}${dataStr}\n`;
  }

  /**
   * Format event for console (stderr) output
   */
  private formatForConsole(event: DebugEvent): string {
    const time = event.timestamp.split('T')[1].slice(0, 12); // HH:mm:ss.SSS
    const colorFn = EVENT_COLORS[event.type];
    const label = EVENT_LABELS[event.type].padEnd(22);
    const taskPart = event.taskId ? `${chalk.white(`[${event.taskId}]`)} ` : '';

    // Format data key=value pairs
    const dataParts: string[] = [];
    for (const [key, value] of Object.entries(event.data)) {
      if (value !== undefined && value !== null) {
        const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
        dataParts.push(`${key}=${valueStr}`);
      }
    }
    const dataStr = dataParts.join(' ');

    return `${chalk.gray(`[DEBUG ${time}]`)} ${colorFn(label)} ${taskPart}${chalk.gray(dataStr)}`;
  }

  /**
   * Write event to log file
   */
  private writeToFile(event: DebugEvent): void {
    if (!this.logFilePath) return;

    try {
      appendFileSync(this.logFilePath, this.formatForFile(event));
    } catch {
      // Silently ignore write errors
    }
  }

  /**
   * Write event to stderr
   */
  private writeToStderr(event: DebugEvent): void {
    // Only write to stderr if not in TUI mode
    // TUI will use getRecentEvents() to display in the DebugPanel
    if (process.env.MOBIUS_TUI_MODE !== 'true') {
      console.error(this.formatForConsole(event));
    }
  }
}

/**
 * Singleton instance
 */
export const debugLogger = new DebugLogger();

/**
 * Convenience function to initialize the debug logger
 *
 * @param parentId - Parent issue identifier
 * @param verbosity - Verbosity level (boolean true = 'normal', string = specific level)
 */
export function initializeDebugLogger(
  parentId: string,
  verbosity: boolean | 'minimal' | 'normal' | 'verbose'
): void {
  const level: DebugConfig['verbosity'] = typeof verbosity === 'boolean' ? 'normal' : verbosity;
  debugLogger.initialize(parentId, level);
}

/**
 * Convenience function to log a debug event
 *
 * @param type - Event type
 * @param source - Source component
 * @param taskId - Optional task identifier
 * @param data - Event data
 */
export function debugLog(
  type: DebugEventType,
  source: DebugEvent['source'],
  taskId?: string,
  data?: Record<string, unknown>
): void {
  debugLogger.log(type, source, taskId, data);
}

/**
 * Check if debug mode is enabled
 */
export function isDebugEnabled(): boolean {
  return debugLogger.isEnabled();
}

/**
 * Get recent debug events for TUI display
 */
export function getRecentDebugEvents(count?: number): DebugEvent[] {
  return debugLogger.getRecentEvents(count);
}
