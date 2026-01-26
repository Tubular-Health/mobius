/**
 * Unit tests for the task-graph module
 */

import { describe, it, expect } from 'bun:test';
import {
  buildTaskGraph,
  mapLinearStatus,
  getReadyTasks,
  getBlockedTasks,
  getCompletedTasks,
  getInProgressTasks,
  updateTaskStatus,
  getTaskById,
  getTaskByIdentifier,
  getBlockers,
  getBlockedBy,
  getGraphStats,
  type LinearIssue,
} from './task-graph.js';

// Helper to create mock Linear issues
function createMockIssue(
  id: string,
  identifier: string,
  title: string,
  status: string,
  blockedBy: Array<{ id: string; identifier: string }> = [],
  blocks: Array<{ id: string; identifier: string }> = []
): LinearIssue {
  return {
    id,
    identifier,
    title,
    status,
    gitBranchName: `feature/${identifier.toLowerCase()}`,
    relations: {
      blockedBy,
      blocks,
    },
  };
}

describe('mapLinearStatus', () => {
  it('maps "Done" to done', () => {
    expect(mapLinearStatus('Done')).toBe('done');
  });

  it('maps "Completed" to done', () => {
    expect(mapLinearStatus('Completed')).toBe('done');
  });

  it('maps "Cancelled" to done', () => {
    expect(mapLinearStatus('Cancelled')).toBe('done');
  });

  it('maps "Canceled" to done', () => {
    expect(mapLinearStatus('Canceled')).toBe('done');
  });

  it('maps "In Progress" to in_progress', () => {
    expect(mapLinearStatus('In Progress')).toBe('in_progress');
  });

  it('maps "In Review" to in_progress', () => {
    expect(mapLinearStatus('In Review')).toBe('in_progress');
  });

  it('maps "Started" to in_progress', () => {
    expect(mapLinearStatus('Started')).toBe('in_progress');
  });

  it('maps "Backlog" to pending', () => {
    expect(mapLinearStatus('Backlog')).toBe('pending');
  });

  it('maps "Todo" to pending', () => {
    expect(mapLinearStatus('Todo')).toBe('pending');
  });

  it('is case-insensitive', () => {
    expect(mapLinearStatus('DONE')).toBe('done');
    expect(mapLinearStatus('done')).toBe('done');
    expect(mapLinearStatus('IN PROGRESS')).toBe('in_progress');
  });
});

describe('buildTaskGraph', () => {
  it('creates a graph from Linear sub-tasks', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Done'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'Backlog', [{ id: 'id-1', identifier: 'MOB-1' }]),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);

    expect(graph.parentId).toBe('parent-id');
    expect(graph.parentIdentifier).toBe('MOB-100');
    expect(graph.tasks.size).toBe(2);
  });

  it('maps Linear status to internal status', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Done task', 'Done'),
      createMockIssue('id-2', 'MOB-2', 'In progress task', 'In Progress'),
      createMockIssue('id-3', 'MOB-3', 'Backlog task', 'Backlog'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);

    expect(graph.tasks.get('id-1')?.status).toBe('done');
    expect(graph.tasks.get('id-2')?.status).toBe('in_progress');
    // id-3 has no blockers, so pending becomes ready
    expect(graph.tasks.get('id-3')?.status).toBe('ready');
  });

  it('builds edges from blockedBy relationships', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Done'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'Backlog', [{ id: 'id-1', identifier: 'MOB-1' }]),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);

    expect(graph.edges.get('id-2')).toEqual(['id-1']);
    expect(graph.edges.get('id-1')).toEqual([]);
  });

  it('calculates ready status for tasks with all blockers done', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Done'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'Done'),
      createMockIssue('id-3', 'MOB-3', 'Task 3', 'Backlog', [
        { id: 'id-1', identifier: 'MOB-1' },
        { id: 'id-2', identifier: 'MOB-2' },
      ]),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);

    expect(graph.tasks.get('id-3')?.status).toBe('ready');
  });

  it('calculates blocked status for tasks with unresolved blockers', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'In Progress'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'Backlog', [{ id: 'id-1', identifier: 'MOB-1' }]),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);

    expect(graph.tasks.get('id-2')?.status).toBe('blocked');
  });

  it('handles tasks with external blockers (not in graph)', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Backlog', [
        { id: 'external-id', identifier: 'OTHER-1' },
      ]),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);

    // External blockers are assumed done, so task becomes ready
    expect(graph.tasks.get('id-1')?.status).toBe('ready');
  });

  it('handles issues without relations', () => {
    const issue: LinearIssue = {
      id: 'id-1',
      identifier: 'MOB-1',
      title: 'Task 1',
      status: 'Backlog',
    };

    const graph = buildTaskGraph('parent-id', 'MOB-100', [issue]);

    expect(graph.tasks.get('id-1')?.blockedBy).toEqual([]);
    expect(graph.tasks.get('id-1')?.blocks).toEqual([]);
    expect(graph.tasks.get('id-1')?.status).toBe('ready');
  });
});

describe('getReadyTasks', () => {
  it('returns tasks with no blockers', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Backlog'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'Backlog'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const ready = getReadyTasks(graph);

    expect(ready.length).toBe(2);
    expect(ready.map(t => t.identifier)).toContain('MOB-1');
    expect(ready.map(t => t.identifier)).toContain('MOB-2');
  });

  it('returns tasks whose blockers are all done', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Done'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'Backlog', [{ id: 'id-1', identifier: 'MOB-1' }]),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const ready = getReadyTasks(graph);

    expect(ready.length).toBe(1);
    expect(ready[0].identifier).toBe('MOB-2');
  });

  it('returns in_progress tasks as ready (for resume capability)', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'In Progress'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'Backlog', [{ id: 'id-1', identifier: 'MOB-1' }]),
      createMockIssue('id-3', 'MOB-3', 'Task 3', 'Backlog', [{ id: 'id-2', identifier: 'MOB-2' }]),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const ready = getReadyTasks(graph);

    // MOB-1 is in_progress and should be returned as ready (allows resuming)
    // MOB-2 and MOB-3 are blocked
    expect(ready.length).toBe(1);
    expect(ready[0].identifier).toBe('MOB-1');
    expect(ready[0].status).toBe('in_progress');
  });

  it('returns empty array when all tasks are done', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Done'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'Done'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const ready = getReadyTasks(graph);

    expect(ready.length).toBe(0);
  });

  it('sorts results by identifier', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-3', 'MOB-3', 'Task 3', 'Backlog'),
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Backlog'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'Backlog'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const ready = getReadyTasks(graph);

    expect(ready.map(t => t.identifier)).toEqual(['MOB-1', 'MOB-2', 'MOB-3']);
  });
});

describe('getBlockedTasks', () => {
  it('returns tasks with unresolved blockers', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'In Progress'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'Backlog', [{ id: 'id-1', identifier: 'MOB-1' }]),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const blocked = getBlockedTasks(graph);

    expect(blocked.length).toBe(1);
    expect(blocked[0].identifier).toBe('MOB-2');
  });

  it('returns empty array when no tasks are blocked', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Backlog'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'Done'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const blocked = getBlockedTasks(graph);

    expect(blocked.length).toBe(0);
  });
});

describe('getCompletedTasks', () => {
  it('returns tasks with done status', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Done'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'Completed'),
      createMockIssue('id-3', 'MOB-3', 'Task 3', 'In Progress'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const completed = getCompletedTasks(graph);

    expect(completed.length).toBe(2);
    expect(completed.map(t => t.identifier)).toContain('MOB-1');
    expect(completed.map(t => t.identifier)).toContain('MOB-2');
  });

  it('returns empty array when no tasks are completed', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Backlog'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'In Progress'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const completed = getCompletedTasks(graph);

    expect(completed.length).toBe(0);
  });
});

describe('getInProgressTasks', () => {
  it('returns tasks with in_progress status', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'In Progress'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'In Review'),
      createMockIssue('id-3', 'MOB-3', 'Task 3', 'Backlog'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const inProgress = getInProgressTasks(graph);

    expect(inProgress.length).toBe(2);
    expect(inProgress.map(t => t.identifier)).toContain('MOB-1');
    expect(inProgress.map(t => t.identifier)).toContain('MOB-2');
  });
});

describe('updateTaskStatus', () => {
  it('updates task status immutably', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Backlog'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const newGraph = updateTaskStatus(graph, 'id-1', 'in_progress');

    // Original graph unchanged
    expect(graph.tasks.get('id-1')?.status).toBe('ready');
    // New graph has updated status
    expect(newGraph.tasks.get('id-1')?.status).toBe('in_progress');
  });

  it('recalculates blocked tasks when blocker is marked done', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'In Progress'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'Backlog', [{ id: 'id-1', identifier: 'MOB-1' }]),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    expect(graph.tasks.get('id-2')?.status).toBe('blocked');

    const newGraph = updateTaskStatus(graph, 'id-1', 'done');

    expect(newGraph.tasks.get('id-2')?.status).toBe('ready');
  });

  it('returns same graph if task not found', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Backlog'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const newGraph = updateTaskStatus(graph, 'non-existent', 'done');

    expect(newGraph).toBe(graph);
  });

  it('handles complex dependency chains', () => {
    // MOB-1 -> MOB-2 -> MOB-3
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'In Progress'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'Backlog', [{ id: 'id-1', identifier: 'MOB-1' }]),
      createMockIssue('id-3', 'MOB-3', 'Task 3', 'Backlog', [{ id: 'id-2', identifier: 'MOB-2' }]),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    expect(graph.tasks.get('id-2')?.status).toBe('blocked');
    expect(graph.tasks.get('id-3')?.status).toBe('blocked');

    // Mark MOB-1 as done
    const graph2 = updateTaskStatus(graph, 'id-1', 'done');
    expect(graph2.tasks.get('id-2')?.status).toBe('ready');
    // MOB-3 is still blocked by MOB-2
    expect(graph2.tasks.get('id-3')?.status).toBe('blocked');

    // Mark MOB-2 as done
    const graph3 = updateTaskStatus(graph2, 'id-2', 'done');
    expect(graph3.tasks.get('id-3')?.status).toBe('ready');
  });
});

describe('getTaskById', () => {
  it('returns task by ID', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Backlog'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const task = getTaskById(graph, 'id-1');

    expect(task?.identifier).toBe('MOB-1');
  });

  it('returns undefined for non-existent ID', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Backlog'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const task = getTaskById(graph, 'non-existent');

    expect(task).toBeUndefined();
  });
});

describe('getTaskByIdentifier', () => {
  it('returns task by identifier', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Backlog'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const task = getTaskByIdentifier(graph, 'MOB-1');

    expect(task?.id).toBe('id-1');
  });

  it('returns undefined for non-existent identifier', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Backlog'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const task = getTaskByIdentifier(graph, 'NON-EXISTENT');

    expect(task).toBeUndefined();
  });
});

describe('getBlockers', () => {
  it('returns blocker tasks', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Done'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'Done'),
      createMockIssue('id-3', 'MOB-3', 'Task 3', 'Backlog', [
        { id: 'id-1', identifier: 'MOB-1' },
        { id: 'id-2', identifier: 'MOB-2' },
      ]),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const blockers = getBlockers(graph, 'id-3');

    expect(blockers.length).toBe(2);
    expect(blockers.map(t => t.identifier)).toContain('MOB-1');
    expect(blockers.map(t => t.identifier)).toContain('MOB-2');
  });

  it('returns empty array for task with no blockers', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Backlog'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const blockers = getBlockers(graph, 'id-1');

    expect(blockers.length).toBe(0);
  });

  it('returns empty array for non-existent task', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Backlog'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const blockers = getBlockers(graph, 'non-existent');

    expect(blockers.length).toBe(0);
  });
});

describe('getBlockedBy', () => {
  it('returns tasks blocked by the given task', () => {
    const issues: LinearIssue[] = [
      createMockIssue(
        'id-1',
        'MOB-1',
        'Task 1',
        'In Progress',
        [],
        [
          { id: 'id-2', identifier: 'MOB-2' },
          { id: 'id-3', identifier: 'MOB-3' },
        ]
      ),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'Backlog', [{ id: 'id-1', identifier: 'MOB-1' }]),
      createMockIssue('id-3', 'MOB-3', 'Task 3', 'Backlog', [{ id: 'id-1', identifier: 'MOB-1' }]),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const blockedBy = getBlockedBy(graph, 'id-1');

    expect(blockedBy.length).toBe(2);
    expect(blockedBy.map(t => t.identifier)).toContain('MOB-2');
    expect(blockedBy.map(t => t.identifier)).toContain('MOB-3');
  });

  it('returns empty array for task that blocks nothing', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Backlog'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const blockedBy = getBlockedBy(graph, 'id-1');

    expect(blockedBy.length).toBe(0);
  });
});

describe('getGraphStats', () => {
  it('returns correct statistics', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Done'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'In Progress'),
      createMockIssue('id-3', 'MOB-3', 'Task 3', 'Backlog'), // Will become ready (no blockers)
      createMockIssue('id-4', 'MOB-4', 'Task 4', 'Backlog', [{ id: 'id-2', identifier: 'MOB-2' }]), // Blocked
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const stats = getGraphStats(graph);

    expect(stats.total).toBe(4);
    expect(stats.done).toBe(1);
    expect(stats.inProgress).toBe(1);
    expect(stats.ready).toBe(1);
    expect(stats.blocked).toBe(1);
  });

  it('handles empty graph', () => {
    const graph = buildTaskGraph('parent-id', 'MOB-100', []);
    const stats = getGraphStats(graph);

    expect(stats.total).toBe(0);
    expect(stats.done).toBe(0);
    expect(stats.inProgress).toBe(0);
    expect(stats.ready).toBe(0);
    expect(stats.blocked).toBe(0);
  });
});

describe('edge cases', () => {
  it('handles empty sub-task list', () => {
    const graph = buildTaskGraph('parent-id', 'MOB-100', []);

    expect(graph.tasks.size).toBe(0);
    expect(getReadyTasks(graph).length).toBe(0);
    expect(getBlockedTasks(graph).length).toBe(0);
  });

  it('handles single task with no dependencies', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Backlog'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);

    expect(graph.tasks.size).toBe(1);
    expect(getReadyTasks(graph).length).toBe(1);
    expect(getBlockedTasks(graph).length).toBe(0);
  });

  it('handles task with missing gitBranchName', () => {
    const issue: LinearIssue = {
      id: 'id-1',
      identifier: 'MOB-1',
      title: 'Task 1',
      status: 'Backlog',
      // No gitBranchName
    };

    const graph = buildTaskGraph('parent-id', 'MOB-100', [issue]);

    expect(graph.tasks.get('id-1')?.gitBranchName).toBe('');
  });

  it('handles multiple independent tasks (parallel ready)', () => {
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Backlog'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'Backlog'),
      createMockIssue('id-3', 'MOB-3', 'Task 3', 'Backlog'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);
    const ready = getReadyTasks(graph);

    expect(ready.length).toBe(3);
  });

  it('handles diamond dependency pattern', () => {
    // MOB-1 and MOB-2 both block MOB-3
    //   MOB-1
    //         \
    //          MOB-3
    //         /
    //   MOB-2
    const issues: LinearIssue[] = [
      createMockIssue('id-1', 'MOB-1', 'Task 1', 'Done'),
      createMockIssue('id-2', 'MOB-2', 'Task 2', 'In Progress'),
      createMockIssue('id-3', 'MOB-3', 'Task 3', 'Backlog', [
        { id: 'id-1', identifier: 'MOB-1' },
        { id: 'id-2', identifier: 'MOB-2' },
      ]),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-100', issues);

    // MOB-3 is blocked because MOB-2 is not done
    expect(graph.tasks.get('id-3')?.status).toBe('blocked');

    // Mark MOB-2 as done
    const newGraph = updateTaskStatus(graph, 'id-2', 'done');

    // Now MOB-3 should be ready
    expect(newGraph.tasks.get('id-3')?.status).toBe('ready');
  });
});
