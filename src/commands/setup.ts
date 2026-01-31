import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { confirm, input, select } from '@inquirer/prompts';
import chalk from 'chalk';
import {
  detectCli,
  getInstallInstructions,
  promptAutoInstall,
  showCliStatus,
} from '../lib/cli-installer.js';
import {
  configExists,
  copyAgentsTemplate,
  copyCommands,
  copySkills,
  writeConfig,
} from '../lib/config.js';
import {
  findLocalConfig,
  getBundledSkillsDir,
  getGlobalConfigDir,
  getPathsForType,
  resolvePaths,
} from '../lib/paths.js';
import { getPlatform } from '../lib/platform-detect.js';
import type { Backend, LoopConfig, Model } from '../types.js';
import { DEFAULT_CONFIG } from '../types.js';

export interface SetupOptions {
  updateSkills?: boolean;
  install?: boolean;
}

export async function setup(options: SetupOptions = {}): Promise<void> {
  // Check if bundled skills exist
  const bundledSkills = getBundledSkillsDir();
  if (!existsSync(bundledSkills)) {
    console.log(chalk.red('Error: Bundled skills not found.'));
    console.log(chalk.gray('This may indicate a corrupted installation.'));
    process.exit(1);
  }

  // --update-skills: Skip config wizard, just update skills/commands
  if (options.updateSkills) {
    // Auto-detect install type: check local config first, then global
    const localConfig = findLocalConfig();
    const globalConfigPath = join(getGlobalConfigDir(), 'config.yaml');
    const hasGlobalConfig = configExists(globalConfigPath);

    if (!localConfig && !hasGlobalConfig) {
      console.log(chalk.red('\nError: No existing Mobius installation found.'));
      console.log(chalk.gray('Run `mobius setup` first to create a configuration.\n'));
      process.exit(1);
    }

    console.log(chalk.bold('\nUpdating skills and commands...\n'));

    // Use existing installation paths (auto-detect local vs global)
    const paths = resolvePaths();

    // Copy skills
    console.log(chalk.gray(`Copying skills to ${paths.skillsPath}...`));
    copySkills(paths.skillsPath);

    // Copy commands
    console.log(chalk.gray('Copying commands...'));
    copyCommands(paths);

    console.log(chalk.green('\n✓ Skills and commands updated!\n'));

    if (paths.type === 'local') {
      console.log(chalk.gray(`Skills updated at: ${paths.skillsPath}`));
    } else {
      console.log(chalk.gray(`Skills updated at: ${paths.skillsPath}`));
    }

    console.log('');
    return;
  }

  console.log(chalk.bold('\nMobius Setup Wizard\n'));

  // 1. Installation type
  const installType = await select<'local' | 'global'>({
    message: 'Installation type:',
    choices: [
      {
        value: 'local',
        name: 'Local (this project)',
        description: 'Config at ./mobius.config.yaml, skills at ./.claude/skills/',
      },
      {
        value: 'global',
        name: 'Global (user-wide)',
        description: `Config at ${getGlobalConfigDir()}/config.yaml, skills at ~/.claude/skills/`,
      },
    ],
  });

  const paths = getPathsForType(installType);

  // Check for existing config
  if (configExists(paths.configPath)) {
    const overwrite = await confirm({
      message: `Config already exists at ${paths.configPath}. Overwrite?`,
      default: false,
    });

    if (!overwrite) {
      console.log(chalk.yellow('\nSetup cancelled. Existing config preserved.'));
      return;
    }
  }

  // 2. Backend
  const backend = await select<Backend>({
    message: 'Issue tracker backend:',
    choices: [
      { value: 'linear', name: 'Linear', description: 'Recommended - native MCP integration' },
      { value: 'jira', name: 'Jira', description: 'Coming soon' },
      {
        value: 'local',
        name: 'Local',
        description: 'No external issue tracker — issues stored in .mobius/',
      },
    ],
  });

  // 3. Model
  const model = await select<Model>({
    message: 'Claude model:',
    choices: [
      { value: 'opus', name: 'Opus', description: 'Most capable, best for complex tasks' },
      { value: 'sonnet', name: 'Sonnet', description: 'Balanced speed and capability' },
      { value: 'haiku', name: 'Haiku', description: 'Fastest, good for simple tasks' },
    ],
  });

  // 4. Delay
  const delayStr = await input({
    message: 'Delay between iterations (seconds):',
    default: String(DEFAULT_CONFIG.execution.delay_seconds),
    validate: (value) => {
      const num = parseInt(value, 10);
      if (Number.isNaN(num) || num < 0) {
        return 'Please enter a non-negative number';
      }
      return true;
    },
  });
  const delaySeconds = parseInt(delayStr, 10);

  // 5. Max iterations
  const maxIterStr = await input({
    message: 'Maximum iterations per run (0 = unlimited):',
    default: String(DEFAULT_CONFIG.execution.max_iterations),
    validate: (value) => {
      const num = parseInt(value, 10);
      if (Number.isNaN(num) || num < 0) {
        return 'Please enter a non-negative number';
      }
      return true;
    },
  });
  const maxIterations = parseInt(maxIterStr, 10);

  // 6. Sandbox
  const sandbox = await confirm({
    message: 'Enable Docker sandbox mode?',
    default: DEFAULT_CONFIG.execution.sandbox,
  });

  // Build config
  const config: LoopConfig = {
    backend,
    execution: {
      delay_seconds: delaySeconds,
      max_iterations: maxIterations,
      model,
      sandbox,
      container_name: DEFAULT_CONFIG.execution.container_name,
    },
  };

  // Write config
  console.log(chalk.gray(`\nWriting config to ${paths.configPath}...`));
  writeConfig(paths.configPath, config);

  // Copy skills
  console.log(chalk.gray(`Copying skills to ${paths.skillsPath}...`));
  copySkills(paths.skillsPath);

  // Copy commands
  console.log(chalk.gray('Copying commands...'));
  copyCommands(paths);

  // For local install, also copy AGENTS.md if it doesn't exist
  if (installType === 'local') {
    const projectDir = dirname(paths.configPath);
    console.log(chalk.gray('Checking AGENTS.md template...'));
    copyAgentsTemplate(projectDir);
  }

  console.log(chalk.green('\n✓ Setup complete!\n'));

  // CLI detection (skip for local backend)
  if (backend !== 'local') {
    const cliResult = await detectCli(backend);
    showCliStatus(cliResult);

    if (!cliResult.installed) {
      if (options.install) {
        await promptAutoInstall(backend);
      } else {
        const platform = getPlatform();
        const instructions = getInstallInstructions(backend, platform);
        if (instructions.length > 0) {
          console.log(chalk.bold('\n  Install the CLI to enable full functionality:'));
          for (const method of instructions) {
            if (method.command) {
              console.log(`    ${chalk.cyan(method.method)}: ${method.command}`);
            }
            if (method.url) {
              console.log(`    ${chalk.cyan(method.method)}: ${chalk.underline(method.url)}`);
            }
          }
        }
      }
    }
    console.log('');
  }

  console.log(chalk.bold('Next steps:'));
  console.log(`  1. Run ${chalk.cyan('mobius doctor')} to verify installation`);
  console.log(`  2. Run ${chalk.cyan('mobius <TASK-ID>')} to start executing tasks`);

  if (backend === 'linear') {
    console.log(`\n${chalk.gray('Note: Linear MCP should be auto-configured in Claude Code.')}`);
  }

  if (installType === 'local') {
    console.log(`\n${chalk.gray('Tip: Review AGENTS.md and customize for your project.')}`);
  }

  console.log('');
}
