/**
 * Nord color palette for TUI components
 *
 * @see https://www.nordtheme.com/docs/colors-and-palettes
 */

import type { TaskStatus } from '../lib/task-graph.js';

// Polar Night (dark backgrounds)
export const POLAR_NIGHT = {
  nord0: '#2E3440',
  nord1: '#3B4252',
  nord2: '#434C5E',
  nord3: '#4C566A',
} as const;

// Snow Storm (light text)
export const SNOW_STORM = {
  nord4: '#D8DEE9',
  nord5: '#E5E9F0',
  nord6: '#ECEFF4',
} as const;

// Frost (accent colors)
export const FROST = {
  nord7: '#8FBCBB',
  nord8: '#88C0D0',
  nord9: '#81A1C1',
  nord10: '#5E81AC',
} as const;

// Aurora (status colors)
export const AURORA = {
  red: '#BF616A',
  orange: '#D08770',
  yellow: '#EBCB8B',
  green: '#A3BE8C',
  purple: '#B48EAD',
} as const;

/**
 * Status color mappings using Nord Aurora palette
 */
export const STATUS_COLORS: Record<TaskStatus, string> = {
  done: AURORA.green,       // #A3BE8C
  ready: FROST.nord8,       // #88C0D0 (cyan)
  blocked: POLAR_NIGHT.nord3, // #4C566A (muted)
  in_progress: AURORA.yellow, // #EBCB8B
  pending: POLAR_NIGHT.nord3, // #4C566A (muted)
  failed: AURORA.red,       // #BF616A
} as const;

/**
 * Status icons consistent with tree-renderer.ts
 */
export const STATUS_ICONS: Record<TaskStatus, string> = {
  done: '[✓]',
  ready: '[→]',
  blocked: '[·]',
  in_progress: '[⟳]',
  pending: '[·]',
  failed: '[✗]',
} as const;

/**
 * Border and structural element colors
 */
export const STRUCTURE_COLORS = {
  border: FROST.nord9,      // #81A1C1
  header: FROST.nord8,      // #88C0D0
  text: SNOW_STORM.nord4,   // #D8DEE9
  muted: POLAR_NIGHT.nord3, // #4C566A
} as const;
