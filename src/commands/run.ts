import { existsSync } from 'node:fs';
import { execa } from 'execa';
import chalk from 'chalk';
import { resolvePaths } from '../lib/paths.js';
import { readConfig } from '../lib/config.js';
import { BACKEND_ID_PATTERNS } from '../types.js';
import type { Backend, Model } from '../types.js';

interface RunOptions {
  local?: boolean;
  backend?: Backend;
  model?: Model;
  delay?: number;
}

export async function run(
  taskId: string,
  maxIterations: number | undefined,
  options: RunOptions
): Promise<void> {
  const paths = resolvePaths();

  // Verify script exists
  if (!existsSync(paths.scriptPath)) {
    console.error(chalk.red(`Error: Script not found at ${paths.scriptPath}`));
    console.error(chalk.gray("Run 'mobius setup' to install Mobius properly."));
    process.exit(1);
  }

  // Load config
  const config = readConfig(paths.configPath);
  const backend = options.backend ?? config.backend;

  // Validate task ID format
  const pattern = BACKEND_ID_PATTERNS[backend];
  if (!pattern.test(taskId)) {
    console.error(chalk.red(`Error: Invalid task ID format for ${backend}: ${taskId}`));
    console.error(chalk.gray('Expected format: PREFIX-NUMBER (e.g., VER-159)'));
    process.exit(1);
  }

  // Build arguments for bash script
  const args: string[] = [taskId];

  if (maxIterations !== undefined) {
    args.push(String(maxIterations));
  }

  if (options.local) {
    args.push('--local');
  }

  if (options.backend) {
    args.push(`--backend=${options.backend}`);
  }

  if (options.model) {
    args.push(`--model=${options.model}`);
  }

  if (options.delay !== undefined) {
    args.push(`--delay=${options.delay}`);
  }

  // Set config path environment variable for the bash script
  const env = {
    ...process.env,
    MOBIUS_CONFIG_FILE: paths.configPath,
  };

  // Execute the bash script
  try {
    await execa(paths.scriptPath, args, {
      env,
      stdio: 'inherit',
      reject: false,
    });
  } catch (error) {
    if (error instanceof Error && 'exitCode' in error) {
      process.exit((error as { exitCode: number }).exitCode);
    }
    throw error;
  }
}
