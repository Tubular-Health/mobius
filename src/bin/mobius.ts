#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Option, program } from 'commander';
import { showConfig } from '../commands/config.js';
import { doctor } from '../commands/doctor.js';
import { loop } from '../commands/loop.js';
import { pull } from '../commands/pull.js';
import { push } from '../commands/push.js';
import { run } from '../commands/run.js';
import { setId } from '../commands/set-id.js';
import { setup } from '../commands/setup.js';
import { submit } from '../commands/submit.js';
import { tree } from '../commands/tree.js';
import type { Backend, Model } from '../types.js';
import { resolveBackend } from '../types.js';
import { tui } from './mobius-tui.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };
const version = pkg.version;

program.name('mobius').description('AI-Powered Development Workflow Tool').version(version);

program
  .command('setup')
  .description('Interactive setup wizard')
  .option('-u, --update-skills', 'Update skills/commands only (skip config wizard)')
  .option('-i, --install', 'Auto-install CLI tools with confirmation')
  .action(async (options: { updateSkills?: boolean; install?: boolean }) => {
    await setup({ updateSkills: options.updateSkills, install: options.install });
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
  .option('-b, --backend <backend>', 'Backend: linear, jira, or local')
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
  .option('--no-sandbox', 'Bypass container sandbox, run directly on host')
  .addOption(new Option('-l, --local', 'Bypass container sandbox (deprecated, use --no-sandbox)').hideHelp())
  .option('-b, --backend <backend>', 'Backend: linear, jira, or local')
  .option('-m, --model <model>', 'Model: opus, sonnet, or haiku')
  .option('-d, --delay <seconds>', 'Delay between iterations', parseInt)
  .action(async (taskId: string, maxIterations: string | undefined, options) => {
    if (options.local) {
      console.warn('Warning: --local is deprecated, use --no-sandbox instead');
    }
    const max = maxIterations ? parseInt(maxIterations, 10) : undefined;
    await run(taskId, max, {
      noSandbox: options.noSandbox || options.local,
      backend: options.backend as Backend | undefined,
      model: options.model as Model | undefined,
      delay: options.delay,
    });
  });

program
  .command('loop <task-id>')
  .description('Execute sub-tasks with parallel execution and worktree isolation')
  .option('--no-sandbox', 'Bypass container sandbox, run directly on host')
  .addOption(new Option('-l, --local', 'Bypass container sandbox (deprecated, use --no-sandbox)').hideHelp())
  .option('-b, --backend <backend>', 'Backend: linear, jira, or local')
  .option('-m, --model <model>', 'Model: opus, sonnet, or haiku')
  .option('-p, --parallel <count>', 'Max parallel agents (overrides config)', parseInt)
  .option('-n, --max-iterations <count>', 'Maximum iterations', parseInt)
  .option('-f, --fresh', 'Clear stale state from previous executions before starting')
  .option(
    '--debug [verbosity]',
    'Enable debug mode for state drift diagnostics (minimal|normal|verbose)'
  )
  .action(async (taskId: string, options) => {
    if (options.local) {
      console.warn('Warning: --local is deprecated, use --no-sandbox instead');
    }
    await loop(taskId, {
      backend: options.backend as Backend | undefined,
      model: options.model as Model | undefined,
      parallel: options.parallel,
      maxIterations: options.maxIterations,
      fresh: options.fresh,
      debug: options.debug,
    });
  });

program
  .command('submit [task-id]')
  .description('Create a pull request (auto-detects issue from branch name if not specified)')
  .option('-b, --backend <backend>', 'Backend: linear, jira, or local')
  .option('-m, --model <model>', 'Model: opus, sonnet, or haiku')
  .option('-d, --draft', 'Create as draft PR')
  .option('--skip-status-update', 'Skip automatic status update to "In Review" after PR creation')
  .action(async (taskId: string | undefined, options) => {
    await submit(taskId, {
      backend: options.backend as Backend | undefined,
      model: options.model as Model | undefined,
      draft: options.draft,
      skipStatusUpdate: options.skipStatusUpdate,
    });
  });

program
  .command('push [parent-id]')
  .description('Push pending local changes to Linear/Jira')
  .option('-b, --backend <backend>', 'Backend: linear, jira, or local')
  .option('--dry-run', 'Show pending changes without pushing')
  .option('-a, --all', 'Push all issues with pending updates')
  .option('--summary', 'Generate and push loop execution summary')
  .action(async (parentId: string | undefined, options) => {
    await push(parentId, {
      backend: options.backend as Backend | undefined,
      dryRun: options.dryRun,
      all: options.all,
      summary: options.summary,
    });
  });

program
  .command('pull [task-id]')
  .description('Fetch fresh context from Linear/Jira')
  .option('-b, --backend <backend>', 'Backend: linear, jira, or local')
  .action(async (taskId: string | undefined, options) => {
    await pull(taskId, {
      backend: options.backend as Backend | undefined,
    });
  });

program
  .command('set-id [task-id]')
  .description('Set or show the current task ID')
  .option('-b, --backend <backend>', 'Backend: linear, jira, or local')
  .option('-c, --clear', 'Clear the current task ID')
  .action(async (taskId: string | undefined, options) => {
    await setId(taskId, {
      backend: options.backend as Backend | undefined,
      clear: options.clear,
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
  .option('--no-sandbox', 'Bypass container sandbox, run directly on host')
  .addOption(new Option('-l, --local', 'Bypass container sandbox (deprecated, use --no-sandbox)').hideHelp())
  .option('-b, --backend <backend>', 'Backend: linear, jira, or local')
  .option('-m, --model <model>', 'Model: opus, sonnet, or haiku')
  .option('-s, --sequential', 'Use sequential execution instead of parallel')
  .option('-p, --parallel <count>', 'Max parallel agents (overrides config)', parseInt)
  .option('-n, --max-iterations <count>', 'Maximum iterations', parseInt)
  .option('-d, --delay <seconds>', 'Delay between iterations (sequential mode)', parseInt)
  .option('-f, --fresh', 'Clear stale state from previous executions before starting')
  .option('--no-tui', 'Disable TUI dashboard (use traditional output)')
  .option(
    '--debug [verbosity]',
    'Enable debug mode for state drift diagnostics (minimal|normal|verbose)'
  )
  .action(async (taskId: string | undefined, options) => {
    // If no task ID, show help
    if (!taskId) {
      program.help();
      return; // help() calls process.exit, but this satisfies the type checker
    }

    // If task ID looks like a command, let commander handle it
    if (
      [
        'setup',
        'doctor',
        'config',
        'tree',
        'run',
        'loop',
        'submit',
        'push',
        'pull',
        'set-id',
        'tui',
        'help',
      ].includes(taskId)
    ) {
      return;
    }

    if (options.local) {
      console.warn('Warning: --local is deprecated, use --no-sandbox instead');
    }

    // Resolve backend: explicit flag > auto-detect from task ID > config default
    const { readConfig } = await import('../lib/config.js');
    const { resolvePaths } = await import('../lib/paths.js');
    const paths = resolvePaths();
    const config = readConfig(paths.configPath);
    const resolvedBackend = resolveBackend(
      options.backend as Backend | undefined,
      taskId,
      config.backend
    );

    // Use sequential mode if --sequential flag is set
    if (options.sequential) {
      await run(taskId, options.maxIterations, {
        noSandbox: options.noSandbox || options.local,
        backend: resolvedBackend,
        model: options.model as Model | undefined,
        delay: options.delay,
      });
      return;
    }

    // Parallel execution with optional TUI
    if (options.tui === false) {
      // Traditional loop output without TUI
      await loop(taskId, {
        backend: resolvedBackend,
        model: options.model as Model | undefined,
        parallel: options.parallel,
        maxIterations: options.maxIterations,
        fresh: options.fresh,
        debug: options.debug,
      });
      return;
    }

    // Default: Run loop in background and TUI in foreground

    // Build args for the loop subprocess
    const loopArgs = ['loop', taskId];
    loopArgs.push('--backend', resolvedBackend);
    if (options.model) loopArgs.push('--model', options.model);
    if (options.parallel) loopArgs.push('--parallel', String(options.parallel));
    if (options.maxIterations) loopArgs.push('--max-iterations', String(options.maxIterations));
    if (options.fresh) loopArgs.push('--fresh');
    if (options.debug) loopArgs.push('--debug', options.debug === true ? 'normal' : options.debug);

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
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Run the TUI in the foreground
    await tui(taskId, {
      showLegend: true,
      backend: resolvedBackend,
    });

    // Clean up signal handlers after TUI exits
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
    process.off('exit', cleanup);
  });

program.parse();
