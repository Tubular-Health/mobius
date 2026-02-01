import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { addShortcutsSourceLine, copyShortcuts } from '../lib/config.js';
import { getShortcutsInstallPath } from '../lib/paths.js';

export async function shortcuts(): Promise<void> {
  console.log(chalk.bold('\nInstalling Mobius shortcuts...\n'));

  // Copy shortcuts script to ~/.config/mobius/shortcuts.sh
  copyShortcuts();
  console.log(chalk.green(`✓ Shortcuts script installed at ${getShortcutsInstallPath()}`));

  // Prompt to add source line to shell rc file
  const addSourceLine = await confirm({
    message: 'Add source line to your shell rc file? (enables md/mr/me/ms shortcuts)',
    default: true,
  });

  if (addSourceLine) {
    const home = homedir();
    const zshrc = join(home, '.zshrc');
    const bashrc = join(home, '.bashrc');

    if (existsSync(zshrc)) {
      addShortcutsSourceLine(zshrc);
      console.log(chalk.gray(`  Added source line to ${zshrc}`));
    } else if (existsSync(bashrc)) {
      addShortcutsSourceLine(bashrc);
      console.log(chalk.gray(`  Added source line to ${bashrc}`));
    } else {
      console.log(chalk.yellow('  No .zshrc or .bashrc found. Add manually:'));
      console.log(chalk.cyan(`    source "${getShortcutsInstallPath()}"`));
    }
  } else {
    console.log(chalk.gray('  To enable shortcuts later, add to your shell rc file:'));
    console.log(chalk.cyan(`    source "${getShortcutsInstallPath()}"`));
  }

  console.log(chalk.bold('\nAvailable shortcuts:'));
  console.log(`  ${chalk.cyan('md')}  - Define a new issue (launches Claude /define)`);
  console.log(`  ${chalk.cyan('mr')}  - Refine the current issue into sub-tasks`);
  console.log(`  ${chalk.cyan('me')}  - Execute sub-tasks for the current issue`);
  console.log(`  ${chalk.cyan('ms')}  - Submit/PR the current issue`);
  console.log('');
}
