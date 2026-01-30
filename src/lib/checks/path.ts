import { existsSync } from 'node:fs';
import type { CheckResult, PathConfig } from '../../types.js';

export async function checkPath(paths: PathConfig): Promise<CheckResult> {
  const name = 'Script path';

  if (!existsSync(paths.scriptPath)) {
    return {
      name,
      status: 'fail',
      message: 'issue-loop.sh script not found',
      required: true,
      details: `Expected at: ${paths.scriptPath}`,
    };
  }

  return {
    name,
    status: 'pass',
    message: `Found at ${paths.scriptPath}`,
    required: true,
  };
}

export async function checkSkills(paths: PathConfig): Promise<CheckResult> {
  const name = 'Skills';

  if (!existsSync(paths.skillsPath)) {
    return {
      name,
      status: 'fail',
      message: `Skills directory not found at ${paths.skillsPath}`,
      required: true,
      details: "Run 'loop setup' to install skills",
    };
  }

  // Check for execute skill
  const executeSkill = `${paths.skillsPath}/execute`;
  if (!existsSync(executeSkill)) {
    return {
      name,
      status: 'warn',
      message: 'Execute skill not found',
      required: false,
      details: "Run 'loop setup' to install skills",
    };
  }

  return {
    name,
    status: 'pass',
    message: `Installed at ${paths.skillsPath}`,
    required: true,
  };
}
