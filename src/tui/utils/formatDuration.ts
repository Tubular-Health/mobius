/**
 * Time formatting utilities for TUI dashboard
 *
 * Provides functions for formatting durations and calculating elapsed time.
 */

/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string (e.g., "45s", "2m 34s", "1h 5m")
 */
export function formatDuration(ms: number): string {
  if (ms < 0) {
    return '0s';
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${seconds}s`;
}

/**
 * Calculate elapsed milliseconds since an ISO timestamp.
 *
 * @param startedAt - ISO timestamp string
 * @returns Milliseconds elapsed since the timestamp
 */
export function getElapsedMs(startedAt: string): number {
  const startTime = new Date(startedAt).getTime();
  const now = Date.now();
  return Math.max(0, now - startTime);
}
