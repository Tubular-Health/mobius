/**
 * tmux session manager for parallel agent display
 *
 * Manages tmux sessions and panes for displaying parallel agent output
 * in real-time during loop execution.
 */

import { execa } from 'execa';
import { writeFile, unlink } from 'node:fs/promises';
import type { SubTask } from './task-graph.js';

export interface TmuxSession {
  name: string;
  id: string;
  initialPaneId: string;
}

export interface TmuxPane {
  id: string;
  sessionId: string;
  taskId?: string;
  type: 'agent' | 'status';
}

export interface LoopStatus {
  totalTasks: number;
  completedTasks: number;
  activeAgents: Array<{ taskId: string; identifier: string }>;
  blockedTasks: string[];
  elapsed: number;
}

/**
 * Get the path to the status file for a session
 */
export function getStatusFilePath(sessionName: string): string {
  return `/tmp/mobius-status-${sessionName}.txt`;
}

/**
 * Check if currently running inside a tmux session
 */
export function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

/**
 * Check if a tmux session exists
 */
export async function sessionExists(sessionName: string): Promise<boolean> {
  try {
    await execa('tmux', ['has-session', '-t', sessionName]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new tmux session for the loop
 *
 * @param sessionName - Name for the session (e.g., "mobius-MOB-123")
 * @returns TmuxSession handle
 */
export async function createSession(sessionName: string): Promise<TmuxSession> {
  // Check if session already exists
  if (await sessionExists(sessionName)) {
    // Get existing session ID and current pane
    const { stdout } = await execa('tmux', [
      'display-message',
      '-t',
      sessionName,
      '-p',
      '#{session_id}:#{pane_id}',
    ]);
    const [sessionId, paneId] = stdout.trim().split(':');
    return {
      name: sessionName,
      id: sessionId,
      initialPaneId: paneId,
    };
  }

  // Create new detached session
  await execa('tmux', ['new-session', '-d', '-s', sessionName]);

  // Get the session ID and initial pane ID
  const { stdout } = await execa('tmux', [
    'display-message',
    '-t',
    sessionName,
    '-p',
    '#{session_id}:#{pane_id}',
  ]);
  const [sessionId, paneId] = stdout.trim().split(':');

  return {
    name: sessionName,
    id: sessionId,
    initialPaneId: paneId,
  };
}

/**
 * Create a pane for an agent in the session
 *
 * @param session - The tmux session
 * @param task - The sub-task this agent will work on
 * @param sourcePaneId - Optional pane ID to split from (defaults to initial pane)
 * @returns TmuxPane handle
 */
export async function createAgentPane(
  session: TmuxSession,
  task: SubTask,
  sourcePaneId?: string
): Promise<TmuxPane> {
  // Split horizontally from the specified pane (or initial pane if not specified)
  const targetPane = sourcePaneId ?? session.initialPaneId;
  const { stdout } = await execa('tmux', [
    'split-window',
    '-t',
    targetPane,
    '-h',
    '-P',
    '-F',
    '#{pane_id}',
  ]);

  const paneId = stdout.trim();

  // Set the pane title
  await execa('tmux', ['select-pane', '-t', paneId, '-T', `${task.identifier}: ${task.title}`]);

  return {
    id: paneId,
    sessionId: session.id,
    taskId: task.id,
    type: 'agent',
  };
}

/**
 * Create a status bar pane at the bottom of the session
 *
 * @param session - The tmux session
 * @returns TmuxPane handle for the status pane
 */
export async function createStatusPane(session: TmuxSession): Promise<TmuxPane> {
  const statusFile = getStatusFilePath(session.name);

  // Create empty status file
  await execa('touch', [statusFile]);

  // Split vertically at the bottom for status bar (15% height)
  const { stdout } = await execa('tmux', [
    'split-window',
    '-t',
    session.name,
    '-v',
    '-l',
    '15%',
    '-P',
    '-F',
    '#{pane_id}',
  ]);

  const paneId = stdout.trim();

  // Set the pane title
  await execa('tmux', ['select-pane', '-t', paneId, '-T', 'Status']);

  // Start watch command to display status file with 0.5s refresh
  await execa('tmux', [
    'send-keys',
    '-t',
    paneId,
    `watch -t -n 0.5 cat ${statusFile}`,
    'Enter',
  ]);

  return {
    id: paneId,
    sessionId: session.id,
    type: 'status',
  };
}

/**
 * Execute a command in a specific pane
 *
 * @param pane - The pane to execute in
 * @param command - The command string to execute
 */
export async function runInPane(pane: TmuxPane, command: string): Promise<void> {
  await execa('tmux', ['send-keys', '-t', pane.id, command, 'Enter']);
}

/**
 * Update the status pane with current loop status
 *
 * @param pane - The status pane
 * @param status - Current loop status
 * @param sessionName - The tmux session name (for status file path)
 */
export async function updateStatusPane(
  _pane: TmuxPane,
  status: LoopStatus,
  sessionName: string
): Promise<void> {
  // Format elapsed time
  const elapsed = formatElapsed(status.elapsed);

  // Format active agents list
  const agentsList =
    status.activeAgents.length > 0
      ? status.activeAgents.map(a => a.identifier).join(', ')
      : 'none';

  // Format blocked tasks list
  const blockedList =
    status.blockedTasks.length > 0 ? status.blockedTasks.join(', ') : 'none';

  // Build status content
  const content = [
    `Progress: ${status.completedTasks}/${status.totalTasks} tasks completed`,
    `Active agents: ${agentsList}`,
    `Blocked: ${blockedList}`,
    `Elapsed: ${elapsed}`,
  ].join('\n');

  // Write to status file (watch command will auto-refresh)
  const statusFile = getStatusFilePath(sessionName);
  await writeFile(statusFile, content + '\n');
}

/**
 * Arrange panes in a grid layout suitable for the number of agents
 *
 * Layout patterns:
 * - 1 agent: single pane
 * - 2 agents: horizontal split
 * - 3 agents: 3 columns
 * - 4+ agents: 2x2 grid (or larger)
 *
 * @param session - The tmux session
 * @param paneCount - Number of agent panes (excluding status)
 */
export async function layoutPanes(session: TmuxSession, paneCount: number): Promise<void> {
  if (paneCount <= 1) {
    // No layout needed for single pane
    return;
  }

  // Use tmux's built-in layout algorithms
  const layout = paneCount <= 2 ? 'even-horizontal' : paneCount <= 4 ? 'tiled' : 'tiled';

  await execa('tmux', ['select-layout', '-t', session.name, layout]);
}

/**
 * Destroy the tmux session
 *
 * @param session - The session to destroy
 */
export async function destroySession(session: TmuxSession): Promise<void> {
  // Clean up status file
  try {
    await unlink(getStatusFilePath(session.name));
  } catch {
    // File may not exist, ignore
  }

  try {
    await execa('tmux', ['kill-session', '-t', session.name]);
  } catch {
    // Session may already be destroyed, ignore errors
  }
}

/**
 * Attach to an existing tmux session
 *
 * @param sessionName - Name of the session to attach to
 */
export async function attachToSession(sessionName: string): Promise<void> {
  // If already inside tmux, switch client
  if (isInsideTmux()) {
    await execa('tmux', ['switch-client', '-t', sessionName]);
  } else {
    // Attach to the session
    await execa('tmux', ['attach-session', '-t', sessionName], {
      stdio: 'inherit',
    });
  }
}

/**
 * Kill a specific pane
 *
 * @param pane - The pane to kill
 */
export async function killPane(pane: TmuxPane): Promise<void> {
  try {
    await execa('tmux', ['kill-pane', '-t', pane.id]);
  } catch {
    // Pane may already be dead, ignore errors
  }
}

/**
 * List all panes in a session
 *
 * @param session - The tmux session
 * @returns Array of pane IDs
 */
export async function listPanes(session: TmuxSession): Promise<string[]> {
  try {
    const { stdout } = await execa('tmux', [
      'list-panes',
      '-t',
      session.name,
      '-F',
      '#{pane_id}',
    ]);
    return stdout
      .trim()
      .split('\n')
      .filter(id => id.length > 0);
  } catch {
    return [];
  }
}

/**
 * Get the content of a pane (last N lines)
 *
 * @param pane - The pane to read from
 * @param lines - Number of lines to capture (default: 100)
 * @returns The pane content
 */
export async function capturePaneContent(pane: TmuxPane, lines: number = 100): Promise<string> {
  try {
    const { stdout } = await execa('tmux', [
      'capture-pane',
      '-t',
      pane.id,
      '-p',
      '-S',
      `-${lines}`,
    ]);
    return stdout;
  } catch {
    return '';
  }
}

/**
 * Check if a pane contains a specific pattern (useful for detecting completion)
 *
 * @param pane - The pane to check
 * @param pattern - Regex pattern to search for
 * @param lines - Number of recent lines to search (default: 50)
 * @returns True if pattern is found
 */
export async function paneContains(
  pane: TmuxPane,
  pattern: RegExp,
  lines: number = 50
): Promise<boolean> {
  const content = await capturePaneContent(pane, lines);
  return pattern.test(content);
}

/**
 * Wait for a pane to contain a specific pattern
 *
 * @param pane - The pane to monitor
 * @param pattern - Regex pattern to wait for
 * @param timeout - Maximum time to wait in ms (default: 5 minutes)
 * @param pollInterval - How often to check in ms (default: 1 second)
 * @returns True if pattern found, false if timeout
 */
export async function waitForPanePattern(
  pane: TmuxPane,
  pattern: RegExp,
  timeout: number = 5 * 60 * 1000,
  pollInterval: number = 1000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await paneContains(pane, pattern)) {
      return true;
    }
    await sleep(pollInterval);
  }

  return false;
}

/**
 * Send Ctrl+C to a pane to interrupt the running process
 *
 * @param pane - The pane to interrupt
 */
export async function interruptPane(pane: TmuxPane): Promise<void> {
  await execa('tmux', ['send-keys', '-t', pane.id, 'C-c']);
}

/**
 * Rename a pane's title
 *
 * @param pane - The pane to rename
 * @param title - New title for the pane
 */
export async function setPaneTitle(pane: TmuxPane, title: string): Promise<void> {
  await execa('tmux', ['select-pane', '-t', pane.id, '-T', title]);
}

/**
 * Get session name from task ID
 *
 * @param taskId - The Linear task ID (e.g., "MOB-123")
 * @returns Session name (e.g., "mobius-MOB-123")
 */
export function getSessionName(taskId: string): string {
  return `mobius-${taskId}`;
}

/**
 * Format elapsed time for display
 */
function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Simple sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
