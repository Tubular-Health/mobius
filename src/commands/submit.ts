import chalk from 'chalk';
import { execa } from 'execa';
import which from 'which';
import { readConfig } from '../lib/config.js';
import { resolvePaths } from '../lib/paths.js';
import type { Backend, Model } from '../types.js';
import { BACKEND_ID_PATTERNS } from '../types.js';

interface SubmitOptions {
  backend?: Backend;
  model?: Model;
  draft?: boolean;
}

async function hasCclean(): Promise<boolean> {
  try {
    await which('cclean');
    return true;
  } catch {
    return false;
  }
}

export async function submit(taskId: string | undefined, options: SubmitOptions): Promise<void> {
  const paths = resolvePaths();

  // Load config
  const config = readConfig(paths.configPath);
  const backend = options.backend ?? config.backend;
  const model = options.model ?? config.execution.model;

  // Validate task ID format if provided
  if (taskId) {
    const pattern = BACKEND_ID_PATTERNS[backend];
    if (!pattern.test(taskId)) {
      console.error(chalk.red(`Error: Invalid task ID format for ${backend}: ${taskId}`));
      console.error(chalk.gray('Expected format: PREFIX-NUMBER (e.g., VER-159)'));
      process.exit(1);
    }
  }

  console.log(chalk.cyan(`\n📤 Creating pull request${taskId ? ` for ${taskId}` : ''}...\n`));

  // Build skill invocation args
  const skillArgs: string[] = [];
  if (options.draft) {
    skillArgs.push('--draft');
  }

  // Build the prompt to invoke the PR skill
  // The skill auto-detects issue references from branch name, but we can provide context if taskId is specified
  const skillInvocation = `/pr${skillArgs.length > 0 ? ` ${skillArgs.join(' ')}` : ''}`;
  const contextNote = taskId
    ? `\n\nNote: This PR is for issue ${taskId}. Ensure this issue is linked in the PR.`
    : '';
  const fullPrompt = `Run the ${skillInvocation} skill to create a pull request.${contextNote}`;

  // Check if cclean is available for output formatting
  const useCclean = await hasCclean();

  // Build the command - use stream-json with cclean, or text format without
  const outputFormat = useCclean ? '--output-format=stream-json' : '--output-format=text';
  const claudeCmd = `claude -p --dangerously-skip-permissions --verbose ${outputFormat} --model ${model}`;
  const fullCmd = useCclean ? `${claudeCmd} | cclean` : claudeCmd;

  // Execute Claude with the PR skill invocation
  try {
    await execa('sh', ['-c', fullCmd], {
      input: fullPrompt,
      stdio: ['pipe', 'inherit', 'inherit'],
      reject: false,
    });

    console.log(chalk.green('\n✓ Submit complete'));
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red(`Error: ${error.message}`));
    }
    process.exit(1);
  }
}
