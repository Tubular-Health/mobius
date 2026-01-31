import which from 'which';
import type { Platform } from '../types.js';

/**
 * Get the current platform typed as Platform.
 * Defaults to 'linux' for unsupported platforms.
 */
export function getPlatform(): Platform {
  const p = process.platform;
  if (p === 'darwin' || p === 'linux' || p === 'win32') {
    return p;
  }
  return 'linux';
}

/**
 * Check if a command exists in PATH using the `which` package.
 * Returns true if found, false otherwise.
 */
export async function hasCommand(cmd: string): Promise<boolean> {
  try {
    await which(cmd);
    return true;
  } catch {
    return false;
  }
}
