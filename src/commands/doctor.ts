import chalk from 'chalk';
import { checkApiKeys } from '../lib/checks/api-keys.js';
import { checkCclean } from '../lib/checks/cclean.js';
import { checkClaude } from '../lib/checks/claude.js';
import { checkConfig } from '../lib/checks/config.js';
import { checkDocker } from '../lib/checks/docker.js';
import { checkGit } from '../lib/checks/git.js';
import { checkJiraMcp } from '../lib/checks/jira-mcp.js';
import { checkLinearMcp } from '../lib/checks/linear-mcp.js';
import { checkJq, checkNodeVersion } from '../lib/checks/optional.js';
import { checkPath, checkSkills } from '../lib/checks/path.js';
import { checkTmux } from '../lib/checks/tmux.js';
import { readConfig } from '../lib/config.js';
import { resolvePaths } from '../lib/paths.js';
import type { CheckResult } from '../types.js';
import { DEFAULT_CONFIG } from '../types.js';

function formatResult(result: CheckResult): string {
  const icon =
    result.status === 'pass'
      ? chalk.green('✓')
      : result.status === 'fail'
        ? chalk.red('✗')
        : result.status === 'warn'
          ? chalk.yellow('!')
          : chalk.gray('○');

  const required = result.required ? '' : chalk.gray(' (optional)');
  const message = result.status === 'fail' ? chalk.red(result.message) : result.message;

  let line = `  ${icon} ${result.name}: ${message}${required}`;

  if (result.details && result.status !== 'pass') {
    line += `\n      ${chalk.gray(result.details)}`;
  }

  return line;
}

export async function doctor(): Promise<void> {
  console.log(chalk.bold('\nLoop Doctor\n'));
  console.log('Checking system requirements...\n');

  const paths = resolvePaths();

  // Try to read config for sandbox setting, use defaults if not available
  let sandboxEnabled = DEFAULT_CONFIG.execution.sandbox;
  let backend = DEFAULT_CONFIG.backend;

  try {
    const config = readConfig(paths.configPath);
    sandboxEnabled = config.execution?.sandbox ?? sandboxEnabled;
    backend = config.backend ?? backend;
  } catch {
    // Use defaults if config can't be read
  }

  // Run all checks
  const results: CheckResult[] = [];

  // Required checks
  console.log(chalk.bold('Required:'));
  const claudeResult = await checkClaude();
  results.push(claudeResult);
  console.log(formatResult(claudeResult));

  const configResult = await checkConfig(paths);
  results.push(configResult);
  console.log(formatResult(configResult));

  const pathResult = await checkPath(paths);
  results.push(pathResult);
  console.log(formatResult(pathResult));

  const skillsResult = await checkSkills(paths);
  results.push(skillsResult);
  console.log(formatResult(skillsResult));

  const gitResult = await checkGit();
  results.push(gitResult);
  console.log(formatResult(gitResult));

  const apiKeysResult = await checkApiKeys(backend);
  results.push(apiKeysResult);
  console.log(formatResult(apiKeysResult));

  // Optional checks
  console.log(chalk.bold('\nOptional:'));

  const linearResult = await checkLinearMcp(backend);
  results.push(linearResult);
  console.log(formatResult(linearResult));

  const jiraResult = await checkJiraMcp(backend);
  results.push(jiraResult);
  console.log(formatResult(jiraResult));

  const dockerResult = await checkDocker(sandboxEnabled);
  results.push(dockerResult);
  console.log(formatResult(dockerResult));

  const ccleanResult = await checkCclean();
  results.push(ccleanResult);
  console.log(formatResult(ccleanResult));

  const tmuxResult = await checkTmux();
  results.push(tmuxResult);
  console.log(formatResult(tmuxResult));

  const nodeResult = await checkNodeVersion();
  results.push(nodeResult);
  console.log(formatResult(nodeResult));

  const jqResult = await checkJq();
  results.push(jqResult);
  console.log(formatResult(jqResult));

  // Summary
  console.log('');
  const failed = results.filter((r) => r.status === 'fail' && r.required);
  const warnings = results.filter(
    (r) => r.status === 'warn' || (r.status === 'fail' && !r.required)
  );

  if (failed.length > 0) {
    console.log(chalk.red(`✗ ${failed.length} required check(s) failed`));
    console.log(chalk.gray("  Run 'loop setup' to fix configuration issues\n"));
    process.exit(1);
  } else if (warnings.length > 0) {
    console.log(chalk.yellow(`! All required checks passed, ${warnings.length} warning(s)`));
    console.log(chalk.green('  Loop should work, but some features may be limited\n'));
  } else {
    console.log(chalk.green('✓ All checks passed! Loop is ready to use.\n'));
  }
}
