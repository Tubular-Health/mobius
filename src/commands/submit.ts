import { execa } from 'execa';
import which from 'which';
import chalk from 'chalk';
import { resolvePaths } from '../lib/paths.js';
import { readConfig } from '../lib/config.js';
import { BACKEND_ID_PATTERNS } from '../types.js';
import type { Backend, Model } from '../types.js';

interface SubmitOptions {
  backend?: Backend;
  model?: Model;
  draft?: boolean;
}

const SUBMIT_PROMPT = `You are creating a pull request for a completed task. Follow these steps:

1. First, get the issue details from Linear using the mcp__plugin_linear_linear__get_issue tool with the provided task ID.

2. Check git status to see what branch we're on and what changes exist:
   - Run: git status
   - Run: git log origin/main..HEAD --oneline (to see commits on this branch)
   - Run: git diff origin/main...HEAD --stat (to see files changed)

3. Check if a PR already exists for this branch:
   - Run: gh pr view --json number,title,url 2>/dev/null
   - If a PR exists, report it and exit

4. Create a pull request using gh pr create with:
   - Title: Use the Linear issue title prefixed with the issue ID (e.g., "VER-123: Issue title here")
   - Body: Include:
     - A summary section with bullet points of what was implemented
     - A "Linear Issue" section with a link to the Linear issue
     - The footer: "🤖 Generated with [Claude Code](https://claude.com/claude-code)"

5. After creating the PR, add the PR URL as a link attachment to the Linear issue using mcp__plugin_linear_linear__update_issue.

IMPORTANT:
- Use HEREDOC syntax for the PR body to handle multi-line content properly
- If there are no commits ahead of main, inform the user that there's nothing to submit
- The PR should be created against the main branch
`;

async function hasCclean(): Promise<boolean> {
  try {
    await which('cclean');
    return true;
  } catch {
    return false;
  }
}

export async function submit(
  taskId: string,
  options: SubmitOptions
): Promise<void> {
  const paths = resolvePaths();

  // Load config
  const config = readConfig(paths.configPath);
  const backend = options.backend ?? config.backend;
  const model = options.model ?? config.execution.model;

  // Validate task ID format
  const pattern = BACKEND_ID_PATTERNS[backend];
  if (!pattern.test(taskId)) {
    console.error(chalk.red(`Error: Invalid task ID format for ${backend}: ${taskId}`));
    console.error(chalk.gray('Expected format: PREFIX-NUMBER (e.g., VER-159)'));
    process.exit(1);
  }

  console.log(chalk.cyan(`\n📤 Submitting PR for ${taskId}...\n`));

  // Build the full prompt with the task ID
  const fullPrompt = `${SUBMIT_PROMPT}\n\nTask ID: ${taskId}${options.draft ? '\n\nCreate this as a DRAFT PR using the --draft flag.' : ''}`;

  // Check if cclean is available for output formatting
  const useCclean = await hasCclean();

  // Build the command - use stream-json with cclean, or text format without
  const outputFormat = useCclean ? '--output-format=stream-json' : '--output-format=text';
  const claudeCmd = `claude -p --dangerously-skip-permissions --verbose ${outputFormat} --model ${model}`;
  const fullCmd = useCclean ? `${claudeCmd} | cclean` : claudeCmd;

  // Execute Claude with the submit prompt
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
