/**
 * TUI event emitter module
 *
 * Provides a shared EventEmitter for TUI-level events.
 * Separated into its own module to avoid circular dependencies
 * between mobius-tui.ts (which imports Dashboard) and Dashboard.tsx
 * (which needs to listen for exit events).
 */

import { EventEmitter } from 'node:events';

/**
 * Event emitter for TUI-level events
 * Used to communicate between signal handlers and React components
 */
export const tuiEvents = new EventEmitter();

/** Event name for exit request (triggered by ctrl+c) */
export const EXIT_REQUEST_EVENT = 'exit-request';
