#!/usr/bin/env node

import { createRequire } from 'module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { program } from 'commander';
import { doctor } from '../commands/doctor.js';
import { setup } from '../commands/setup.js';
import { run } from '../commands/run.js';
import { loop } from '../commands/loop.js';
import { tree } from '../commands/tree.js';
import { showConfig } from '../commands/config.js';
import { submit } from '../commands/submit.js';
import { tui } from './mobius-tui.js';
import type { Backend, Model } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };
const version = pkg.version;

program
  .name('mobius')
  .description('AI-Powered Development Workflow Tool')
  .version(version);

program
  .command('setup')
  .description('Interactive setup wizard')
  .action(async () => {
    await setup();
  });

program
  .command('doctor')
  .description('Check system requirements and configuration')
  .action(async () => {
    await doctor();
  });

program
  .command('config')
  .description('Show current configuration')
  .option('-e, --edit', 'Open config in editor')
  .action(async (options) => {
    await showConfig(options);
  });

program
  .command('tree <task-id>')
  .description('Display sub-task dependency tree without execution')
  .option('-b, --backend <backend>', 'Backend: linear or jira')
  .option('-m, --mermaid', 'Also output Mermaid diagram')
  .action(async (taskId: string, options) => {
    await tree(taskId, {
      backend: options.backend as Backend | undefined,
      mermaid: options.mermaid,
    });
  });

program
  .command('run <task-id> [max-iterations]')
  .description('Execute sub-tasks sequentially (use "loop" for parallel execution)')
  .option('-l, --local', 'Run locally (bypass container sandbox)')
  .option('-b, --backend <backend>', 'Backend: linear or jira')
  .option('-m, --model <model>', 'Model: opus, sonnet, or haiku')
  .option('-d, --delay <seconds>', 'Delay between iterations', parseInt)
  .action(async (taskId: string, maxIterations: string | undefined, options) => {
    const max = maxIterations ? parseInt(maxIterations, 10) : undefined;
    await run(taskId, max, {
      local: options.local,
      backend: options.backend as Backend | undefined,
      model: options.model as Model | undefined,
      delay: options.delay,
    });
  });

program
  .command('loop <task-id>')
  .description('Execute sub-tasks with parallel execution and worktree isolation')
  .option('-l, --local', 'Run locally (bypass container sandbox)')
  .option('-b, --backend <backend>', 'Backend: linear or jira')
  .option('-m, --model <model>', 'Model: opus, sonnet, or haiku')
  .option('-p, --parallel <count>', 'Max parallel agents (overrides config)', parseInt)
  .option('-n, --max-iterations <count>', 'Maximum iterations', parseInt)
  .action(async (taskId: string, options) => {
    await loop(taskId, {
      local: options.local,
      backend: options.backend as Backend | undefined,
      model: options.model as Model | undefined,
      parallel: options.parallel,
      maxIterations: options.maxIterations,
    });
  });

program
  .command('submit <task-id>')
  .description('Create a pull request for a completed task')
  .option('-b, --backend <backend>', 'Backend: linear or jira')
  .option('-m, --model <model>', 'Model: opus, sonnet, or haiku')
  .option('-d, --draft', 'Create as draft PR')
  .action(async (taskId: string, options) => {
    await submit(taskId, {
      backend: options.backend as Backend | undefined,
      model: options.model as Model | undefined,
      draft: options.draft,
    });
  });

program
  .command('tui <task-id>')
  .description('Launch interactive TUI dashboard for monitoring task execution')
  .option('--no-legend', 'Hide the status legend')
  .option('--state-dir <path>', 'Directory for execution state files')
  .option('--refresh <ms>', 'Agent panel refresh interval in ms', parseInt)
  .option('--lines <count>', 'Number of output lines per agent panel', parseInt)
  .action(async (taskId: string, options) => {
    await tui(taskId, {
      showLegend: options.legend,
      stateDir: options.stateDir,
      panelRefreshMs: options.refresh,
      panelLines: options.lines,
    });
  });

// Default command: treat first arg as task ID if no command specified
// Uses parallel loop by default, --sequential falls back to run command
program
  .argument('[task-id]', 'Task ID to execute (uses parallel loop by default)')
  .option('-l, --local', 'Run locally (bypass container sandbox)')
  .option('-b, --backend <backend>', 'Backend: linear or jira')
  .option('-m, --model <model>', 'Model: opus, sonnet, or haiku')
  .option('-s, --sequential', 'Use sequential execution instead of parallel')
  .option('-p, --parallel <count>', 'Max parallel agents (overrides config)', parseInt)
  .option('-n, --max-iterations <count>', 'Maximum iterations', parseInt)
  .option('-d, --delay <seconds>', 'Delay between iterations (sequential mode)', parseInt)
  .option('--no-tui', 'Disable TUI dashboard (use traditional output)')
  .action(async (taskId: string | undefined, options) => {
    // If no task ID, show help
    if (!taskId) {
      program.help();
      return; // help() calls process.exit, but this satisfies the type checker
    }

    // If task ID looks like a command, let commander handle it
    if (['setup', 'doctor', 'config', 'tree', 'run', 'loop', 'submit', 'tui', 'help'].includes(taskId)) {
      return;
    }

    // Use sequential mode if --sequential flag is set
    if (options.sequential) {
      await run(taskId, options.maxIterations, {
        local: options.local,
        backend: options.backend as Backend | undefined,
        model: options.model as Model | undefined,
        delay: options.delay,
      });
      return;
    }

    // Parallel execution with optional TUI
    if (options.tui === false) {
      // Traditional loop output without TUI
      await loop(taskId, {
        local: options.local,
        backend: options.backend as Backend | undefined,
        model: options.model as Model | undefined,
        parallel: options.parallel,
        maxIterations: options.maxIterations,
      });
      return;
    }

    // Default: Run loop in background and TUI in foreground
    // Build args for the loop subprocess
    const loopArgs = ['loop', taskId];
    if (options.local) loopArgs.push('--local');
    if (options.backend) loopArgs.push('--backend', options.backend);
    if (options.model) loopArgs.push('--model', options.model);
    if (options.parallel) loopArgs.push('--parallel', String(options.parallel));
    if (options.maxIterations) loopArgs.push('--max-iterations', String(options.maxIterations));

    // Spawn the loop process in the background
    const loopProcess = spawn(process.execPath, [join(__dirname, 'mobius.js'), ...loopArgs], {
      detached: true,
      stdio: 'ignore',
    });

    const loopPid = loopProcess.pid;

    // Prevent the parent from waiting for the child
    loopProcess.unref();

    // Handle cleanup on SIGINT/SIGTERM - kill the loop process
    const cleanup = () => {
      if (loopPid) {
        try {
          process.kill(loopPid, 'SIGTERM');
        } catch {
          // Process may have already exited
        }
      }
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', cleanup);

    // Brief delay to allow loop to initialize state file
    await new Promise(resolve => setTimeout(resolve, 500));

    // Run the TUI in the foreground
    await tui(taskId, {
      showLegend: true,
    });

    // Clean up signal handlers after TUI exits
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
    process.off('exit', cleanup);
  });

program.parse();
