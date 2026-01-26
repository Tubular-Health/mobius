/**
 * Mermaid diagram generator module
 *
 * Generates Mermaid flowchart diagrams from task dependency graphs for posting to Linear.
 */

import type { TaskGraph, TaskStatus } from './task-graph.js';

/**
 * Status icons for Mermaid node labels
 */
const STATUS_ICONS: Record<TaskStatus, string> = {
  done: '✓',
  ready: '→',
  blocked: '·',
  in_progress: '!',
  pending: '·',
  failed: '✗',
};

/**
 * Status colors for Mermaid node styling (hex colors)
 */
const STATUS_COLORS: Record<TaskStatus, string> = {
  done: '#90EE90', // Light green
  ready: '#87CEEB', // Light blue
  blocked: '#D3D3D3', // Light gray
  in_progress: '#FFE4B5', // Moccasin (yellow-ish)
  pending: '#D3D3D3', // Light gray
  failed: '#FF6B6B', // Light red
};

/**
 * Maximum title length before truncation
 */
const MAX_TITLE_LENGTH = 40;

/**
 * Truncate a title if it exceeds the maximum length
 */
function truncateTitle(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) {
    return title;
  }
  return title.slice(0, MAX_TITLE_LENGTH - 3) + '...';
}

/**
 * Escape special characters for Mermaid node labels
 * Mermaid uses specific characters that need escaping in labels
 */
function escapeLabel(text: string): string {
  return text
    .replace(/"/g, "'") // Replace double quotes with single quotes
    .replace(/[[\]]/g, '') // Remove square brackets
    .replace(/[()]/g, '') // Remove parentheses that could conflict with node syntax
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/&/g, 'and'); // Replace ampersand
}

/**
 * Generate a Mermaid flowchart diagram from a task graph
 *
 * @param graph - The task dependency graph
 * @returns Mermaid flowchart code (without markdown fence)
 */
export function renderMermaidDiagram(graph: TaskGraph): string {
  const lines: string[] = [];

  // Flowchart header (top-down orientation)
  lines.push('flowchart TD');

  // Get all tasks sorted by identifier for consistent output
  const tasks = Array.from(graph.tasks.values()).sort((a, b) =>
    a.identifier.localeCompare(b.identifier)
  );

  // Generate node definitions
  for (const task of tasks) {
    const nodeId = sanitizeNodeId(task.identifier);
    const icon = STATUS_ICONS[task.status];
    const truncatedTitle = truncateTitle(task.title);
    const escapedTitle = escapeLabel(truncatedTitle);
    const label = `${task.identifier}: ${escapedTitle} ${icon}`;

    lines.push(`    ${nodeId}["${label}"]`);
  }

  // Add blank line before edges
  lines.push('');

  // Generate edges (blocker --> blocked)
  // We iterate over each task and create edges from its blockers to it
  for (const task of tasks) {
    for (const blockerId of task.blockedBy) {
      const blockerTask = graph.tasks.get(blockerId);
      if (blockerTask) {
        const fromId = sanitizeNodeId(blockerTask.identifier);
        const toId = sanitizeNodeId(task.identifier);
        lines.push(`    ${fromId} --> ${toId}`);
      }
    }
  }

  // Add blank line before styles
  lines.push('');

  // Generate style definitions
  for (const task of tasks) {
    const nodeId = sanitizeNodeId(task.identifier);
    const color = STATUS_COLORS[task.status];
    lines.push(`    style ${nodeId} fill:${color}`);
  }

  return lines.join('\n');
}

/**
 * Sanitize an identifier for use as a Mermaid node ID
 * Mermaid node IDs have restrictions on characters
 */
function sanitizeNodeId(identifier: string): string {
  // Replace hyphens with underscores and remove any other special characters
  return identifier.replace(/-/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
}

/**
 * Generate a Mermaid diagram wrapped in a markdown code fence
 *
 * @param graph - The task dependency graph
 * @returns Mermaid diagram wrapped in markdown code fence
 */
export function renderMermaidMarkdown(graph: TaskGraph): string {
  const diagram = renderMermaidDiagram(graph);
  return `\`\`\`mermaid\n${diagram}\n\`\`\``;
}

/**
 * Generate a Mermaid diagram with a title header
 *
 * @param graph - The task dependency graph
 * @returns Mermaid diagram with title, wrapped in markdown code fence
 */
export function renderMermaidWithTitle(graph: TaskGraph): string {
  const title = `## Task Dependency Graph for ${graph.parentIdentifier}\n\n`;
  return title + renderMermaidMarkdown(graph);
}

/**
 * Get the status color for a task (useful for legends or external rendering)
 */
export function getStatusColor(status: TaskStatus): string {
  return STATUS_COLORS[status];
}

/**
 * Get all status colors (useful for building legends)
 */
export function getAllStatusColors(): Record<TaskStatus, string> {
  return { ...STATUS_COLORS };
}
