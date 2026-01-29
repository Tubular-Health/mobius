/**
 * Set-id command - Persist the current task ID
 *
 * Stores a task ID to ~/.mobius/current-task.json so other commands
 * can use it without requiring the ID to be passed explicitly.
 */

import chalk from 'chalk';
import { readConfig } from '../lib/config.js';
import {
  createSession,
  deleteSession,
  getCurrentSessionParentId,
  readSession,
  setCurrentSessionPointer,
} from '../lib/context-generator.js';
import { resolvePaths } from '../lib/paths.js';
import type { Backend } from '../types.js';
import { BACKEND_ID_PATTERNS } from '../types.js';

export interface SetIdOptions {
  backend?: Backend;
  clear?: boolean;
}

/**
 * Set or show the current task ID
 *
 * @param taskId - Optional task ID to set
 * @param options - Command options
 */
export async function setId(taskId: string | undefined, options: SetIdOptions): Promise<void> {
  // Handle --clear flag
  if (options.clear) {
    const currentId = getCurrentSessionParentId();
    if (currentId) {
      deleteSession(currentId);
    }
    console.log(chalk.green('Current task cleared'));
    return;
  }

  // If no task ID provided, show current task
  if (!taskId) {
    const currentId = getCurrentSessionParentId();

    if (!currentId) {
      console.log(chalk.yellow('No current task set'));
      console.log(chalk.gray('Usage: mobius set-id <task-id>'));
      return;
    }

    const session = readSession(currentId);
    if (!session) {
      console.log(chalk.yellow('No current task set'));
      console.log(chalk.gray('Usage: mobius set-id <task-id>'));
      return;
    }

    console.log(chalk.bold('Current task:'));
    console.log(`  ID:      ${chalk.cyan(session.parentId)}`);
    console.log(`  Backend: ${chalk.gray(session.backend)}`);
    console.log(`  Status:  ${chalk.gray(session.status)}`);
    console.log(`  Started: ${chalk.gray(session.startedAt)}`);
    if (session.worktreePath) {
      console.log(`  Worktree: ${chalk.gray(session.worktreePath)}`);
    }
    return;
  }

  // Resolve backend from options or config
  const paths = resolvePaths();
  const config = readConfig(paths.configPath);
  const backend = options.backend ?? config.backend;

  // Validate task ID format
  const pattern = BACKEND_ID_PATTERNS[backend];
  if (!pattern.test(taskId)) {
    console.error(chalk.red(`Error: Invalid task ID format for ${backend}: ${taskId}`));
    console.error(chalk.gray('Expected format: PREFIX-NUMBER (e.g., MOB-123)'));
    process.exit(1);
  }

  // Check if there's already a session for this task
  const existingSession = readSession(taskId);
  if (existingSession) {
    // Just update the current pointer to this existing session
    setCurrentSessionPointer(taskId);
    console.log(chalk.green(`Current task set to ${chalk.bold(taskId)} (existing session)`));
  } else {
    // Create a new session
    createSession(taskId, backend);
    console.log(chalk.green(`Current task set to ${chalk.bold(taskId)}`));
  }

  if (options.backend) {
    console.log(chalk.gray(`Backend: ${options.backend}`));
  }
}
