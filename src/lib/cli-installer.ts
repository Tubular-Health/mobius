import { confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { execa } from 'execa';
import type { Backend, CliDetectionResult, InstallMethod, Platform } from '../types.js';
import { getPlatform, hasCommand } from './platform-detect.js';

const CLI_COMMANDS: Record<Exclude<Backend, 'local'>, string> = {
  linear: 'linear',
  jira: 'acli',
};

/**
 * Detect whether the CLI tool for a given backend is installed.
 * Returns immediately for 'local' backend (no CLI needed).
 */
export async function detectCli(backend: Backend): Promise<CliDetectionResult> {
  if (backend === 'local') {
    return { tool: 'none', installed: true };
  }

  const tool = CLI_COMMANDS[backend];
  const installed = await hasCommand(tool);

  return { tool, installed };
}

/**
 * Get platform-specific installation instructions for a backend's CLI.
 */
export function getInstallInstructions(backend: Backend, platform: Platform): InstallMethod[] {
  if (backend === 'local') return [];

  if (backend === 'linear') {
    return getLinearInstallMethods(platform);
  }

  return getJiraInstallMethods(platform);
}

function getLinearInstallMethods(platform: Platform): InstallMethod[] {
  const methods: InstallMethod[] = [];

  if (platform === 'darwin') {
    methods.push({
      platform,
      method: 'Homebrew',
      command: 'brew install schpet/tap/linear',
    });
  }

  methods.push({
    platform,
    method: 'npm',
    command: 'npm install -g @linear/cli',
  });

  methods.push({
    platform,
    method: 'GitHub Releases',
    command: '',
    url: 'https://github.com/linear/linear-cli/releases',
  });

  return methods;
}

function getJiraInstallMethods(platform: Platform): InstallMethod[] {
  const methods: InstallMethod[] = [];

  methods.push({
    platform,
    method: 'npm',
    command: 'npm install -g acli',
  });

  methods.push({
    platform,
    method: 'Atlassian Documentation',
    command: '',
    url: 'https://developer.atlassian.com/cloud/jira/platform/rest/v3/',
  });

  return methods;
}

/**
 * Display CLI detection status with colored output.
 * Green checkmark for installed, yellow warning for missing.
 */
export function showCliStatus(result: CliDetectionResult): void {
  if (result.installed) {
    console.log(chalk.green(`  ✓ ${result.tool} CLI detected`));
  } else {
    console.log(chalk.yellow(`  ⚠ ${result.tool} CLI not found`));
  }
}

/**
 * Prompt the user to auto-install the CLI tool for a backend.
 * If declined, shows manual installation instructions.
 */
export async function promptAutoInstall(backend: Backend): Promise<void> {
  if (backend === 'local') return;

  const platform = getPlatform();
  const instructions = getInstallInstructions(backend, platform);

  if (instructions.length === 0) return;

  // Pick the first method with a command as the auto-install option
  const autoMethod = instructions.find((m) => m.command !== '');
  if (!autoMethod) {
    showManualInstructions(instructions);
    return;
  }

  const shouldInstall = await confirm({
    message: `Install ${CLI_COMMANDS[backend]} via ${autoMethod.method}? (${autoMethod.command})`,
    default: true,
  });

  if (shouldInstall) {
    try {
      const [cmd, ...args] = autoMethod.command.split(' ');
      console.log(chalk.gray(`  Running: ${autoMethod.command}`));
      await execa(cmd, args, { stdio: 'inherit' });
      console.log(chalk.green(`  ✓ ${CLI_COMMANDS[backend]} installed successfully`));
    } catch {
      console.log(chalk.red(`  ✗ Installation failed`));
      showManualInstructions(instructions);
    }
  } else {
    showManualInstructions(instructions);
  }
}

function showManualInstructions(instructions: InstallMethod[]): void {
  console.log(chalk.bold('\n  Manual installation options:'));
  for (const method of instructions) {
    if (method.command) {
      console.log(`    ${chalk.cyan(method.method)}: ${method.command}`);
    }
    if (method.url) {
      console.log(`    ${chalk.cyan(method.method)}: ${chalk.underline(method.url)}`);
    }
  }
}
