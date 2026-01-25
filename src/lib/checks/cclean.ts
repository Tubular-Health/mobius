import which from 'which';
import type { CheckResult } from '../../types.js';

export async function checkCclean(): Promise<CheckResult> {
  const name = 'cclean utility';

  try {
    await which('cclean');
    return {
      name,
      status: 'pass',
      message: 'Installed',
      required: false,
    };
  } catch {
    return {
      name,
      status: 'warn',
      message: 'Not found (output formatting will be basic)',
      required: false,
      details: 'Optional: Provides cleaner Claude output formatting',
    };
  }
}
