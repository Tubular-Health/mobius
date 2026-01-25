#!/usr/bin/env node

import { program } from 'commander';
import { doctor } from '../commands/doctor.js';
import { setup } from '../commands/setup.js';
import { run } from '../commands/run.js';
import { showConfig } from '../commands/config.js';
import type { Backend, Model } from '../types.js';

const version = '1.0.0';

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
  .command('run <task-id> [max-iterations]')
  .description('Execute sub-tasks of an issue')
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

// Default command: treat first arg as task ID if no command specified
program
  .argument('[task-id]', 'Task ID to execute (shorthand for "run")')
  .argument('[max-iterations]', 'Maximum iterations')
  .option('-l, --local', 'Run locally (bypass container sandbox)')
  .option('-b, --backend <backend>', 'Backend: linear or jira')
  .option('-m, --model <model>', 'Model: opus, sonnet, or haiku')
  .option('-d, --delay <seconds>', 'Delay between iterations', parseInt)
  .action(async (taskId: string | undefined, maxIterations: string | undefined, options) => {
    // If no task ID, show help
    if (!taskId) {
      program.help();
      return; // help() calls process.exit, but this satisfies the type checker
    }

    // If task ID looks like a command, let commander handle it
    if (['setup', 'doctor', 'config', 'run', 'help'].includes(taskId)) {
      return;
    }

    // Otherwise, treat as task ID
    const max = maxIterations ? parseInt(maxIterations, 10) : undefined;
    await run(taskId, max, {
      local: options.local,
      backend: options.backend as Backend | undefined,
      model: options.model as Model | undefined,
      delay: options.delay,
    });
  });

program.parse();
