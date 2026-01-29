import { existsSync } from 'node:fs';
import type { CheckResult, LoopConfig, PathConfig } from '../../types.js';
import { readConfig, validateConfig } from '../config.js';

export async function checkConfig(paths: PathConfig): Promise<CheckResult> {
  const name = 'Configuration';

  if (!existsSync(paths.configPath)) {
    return {
      name,
      status: 'fail',
      message: `Config not found at ${paths.configPath}`,
      required: true,
      details: "Run 'loop setup' to create configuration",
    };
  }

  let config: LoopConfig;
  try {
    config = readConfig(paths.configPath);
  } catch (error) {
    return {
      name,
      status: 'fail',
      message: 'Failed to parse config file',
      required: true,
      details: error instanceof Error ? error.message : 'Invalid YAML',
    };
  }

  const { valid, errors } = validateConfig(config);
  if (!valid) {
    return {
      name,
      status: 'fail',
      message: 'Invalid configuration',
      required: true,
      details: errors.join('; '),
    };
  }

  const location = paths.type === 'local' ? 'local' : 'global';
  return {
    name,
    status: 'pass',
    message: `Valid (${location}: ${paths.configPath})`,
    required: true,
  };
}
