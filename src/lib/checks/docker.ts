import { execa } from 'execa';
import which from 'which';
import type { CheckResult } from '../../types.js';

export async function checkDocker(sandboxEnabled: boolean): Promise<CheckResult> {
  const name = 'Docker';

  if (!sandboxEnabled) {
    return {
      name,
      status: 'skip',
      message: 'Sandbox disabled in config',
      required: false,
    };
  }

  // Check if docker is in PATH
  try {
    await which('docker');
  } catch {
    return {
      name,
      status: 'warn',
      message: 'Docker not found (sandbox mode unavailable)',
      required: false,
      details: 'Install Docker for isolated sandbox execution',
    };
  }

  // Check if daemon is running
  try {
    await execa('docker', ['info'], { timeout: 10000 });
    return {
      name,
      status: 'pass',
      message: 'Running',
      required: false,
    };
  } catch {
    return {
      name,
      status: 'warn',
      message: 'Docker installed but daemon not running',
      required: false,
      details: 'Start Docker to enable sandbox mode, or use --local flag',
    };
  }
}
