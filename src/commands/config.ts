import { existsSync } from 'node:fs';
import chalk from 'chalk';
import { execa } from 'execa';
import { readConfig } from '../lib/config.js';
import { resolvePaths } from '../lib/paths.js';

interface ConfigOptions {
  edit?: boolean;
}

export async function showConfig(options: ConfigOptions): Promise<void> {
  const paths = resolvePaths();

  if (options.edit) {
    await editConfig(paths.configPath);
    return;
  }

  console.log(chalk.bold('\nMobius Configuration\n'));

  // Show config location
  console.log(chalk.gray('Config location:'));
  if (existsSync(paths.configPath)) {
    console.log(`  ${chalk.green('●')} ${paths.configPath} (${paths.type})`);
  } else {
    console.log(`  ${chalk.red('○')} ${paths.configPath} (not found)`);
    console.log(chalk.gray("\n  Run 'mobius setup' to create configuration.\n"));
    return;
  }

  // Show skills location
  console.log(chalk.gray('\nSkills location:'));
  if (existsSync(paths.skillsPath)) {
    console.log(`  ${chalk.green('●')} ${paths.skillsPath}`);
  } else {
    console.log(`  ${chalk.red('○')} ${paths.skillsPath} (not found)`);
  }

  // Read and display config
  try {
    const config = readConfig(paths.configPath);

    console.log(chalk.gray('\nCurrent settings:'));
    console.log(`  backend:         ${chalk.cyan(config.backend)}`);
    console.log(`  model:           ${chalk.cyan(config.execution.model)}`);
    console.log(`  delay_seconds:   ${chalk.cyan(config.execution.delay_seconds)}`);
    console.log(`  max_iterations:  ${chalk.cyan(config.execution.max_iterations)}`);
    console.log(`  sandbox:         ${chalk.cyan(config.execution.sandbox)}`);
    console.log(`  container:       ${chalk.cyan(config.execution.container_name)}`);

    console.log(chalk.gray('\nEnvironment overrides:'));
    const envVars = [
      'MOBIUS_BACKEND',
      'MOBIUS_DELAY_SECONDS',
      'MOBIUS_MAX_ITERATIONS',
      'MOBIUS_MODEL',
      'MOBIUS_SANDBOX_ENABLED',
      'MOBIUS_CONTAINER',
    ];

    let hasOverrides = false;
    for (const envVar of envVars) {
      if (process.env[envVar]) {
        console.log(`  ${envVar}=${chalk.yellow(process.env[envVar])}`);
        hasOverrides = true;
      }
    }
    if (!hasOverrides) {
      console.log(chalk.gray('  (none)'));
    }

    console.log('');
  } catch (error) {
    console.error(chalk.red('\nError reading config:'));
    console.error(chalk.gray(error instanceof Error ? error.message : 'Unknown error'));
    console.log('');
  }
}

async function editConfig(configPath: string): Promise<void> {
  if (!existsSync(configPath)) {
    console.error(chalk.red(`Config not found at ${configPath}`));
    console.error(chalk.gray("Run 'mobius setup' to create configuration."));
    process.exit(1);
  }

  // Determine editor
  const editor = process.env.VISUAL || process.env.EDITOR || 'vi';

  console.log(chalk.gray(`Opening ${configPath} in ${editor}...\n`));

  try {
    await execa(editor, [configPath], {
      stdio: 'inherit',
    });
  } catch (_error) {
    console.error(chalk.red(`Failed to open editor: ${editor}`));
    console.error(
      chalk.gray('Set EDITOR or VISUAL environment variable to your preferred editor.')
    );
    process.exit(1);
  }
}
