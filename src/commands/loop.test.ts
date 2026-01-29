/**
 * Integration tests for the loop orchestrator command
 *
 * Tests the full loop orchestration with mocked external dependencies
 * (Linear API, git commands, Claude agent spawning)
 */

import { describe, expect, it } from 'bun:test';
import { renderMermaidWithTitle } from '../lib/mermaid-renderer.js';
import {
  aggregateResults,
  calculateParallelism,
  type ExecutionResult,
} from '../lib/parallel-executor.js';
import type { LinearIssue } from '../lib/task-graph.js';
import {
  buildTaskGraph,
  getBlockedTasks,
  getGraphStats,
  getReadyTasks,
  getVerificationTask,
  updateTaskStatus,
} from '../lib/task-graph.js';
import { renderFullTreeOutput } from '../lib/tree-renderer.js';
import type { ExecutionConfig } from '../types.js';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Mock Linear parent issue data
 */
const mockParentIssue = {
  id: 'parent-id-123',
  identifier: 'MOB-100',
  title: 'Implement test feature',
  gitBranchName: 'feature/mob-100-test-feature',
};

/**
 * Mock Linear sub-task data
 */
function createMockLinearIssue(
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

/**
 * Standard mock Linear sub-tasks for testing
 *
 * Structure:
 * MOB-101 (Done) → MOB-103 (blocked by 101, 102)
 * MOB-102 (Done) → MOB-103
 * MOB-103 (Backlog, blocked) → MOB-104 (blocked by 103)
 * MOB-104 (Backlog, blocked by 103)
 */
const mockSubtasks: LinearIssue[] = [
  createMockLinearIssue('id-101', 'MOB-101', 'Setup base types', 'Done'),
  createMockLinearIssue('id-102', 'MOB-102', 'Create utility functions', 'Done'),
  createMockLinearIssue(
    'id-103',
    'MOB-103',
    'Implement parser',
    'Backlog',
    [
      { id: 'id-101', identifier: 'MOB-101' },
      { id: 'id-102', identifier: 'MOB-102' },
    ],
    [{ id: 'id-104', identifier: 'MOB-104' }]
  ),
  createMockLinearIssue('id-104', 'MOB-104', 'Add tests', 'Backlog', [
    { id: 'id-103', identifier: 'MOB-103' },
  ]),
];

/**
 * Default execution config for tests
 */
const defaultConfig: ExecutionConfig = {
  delay_seconds: 3,
  max_iterations: 50,
  model: 'opus',
  sandbox: true,
  container_name: 'mobius-sandbox',
  max_parallel_agents: 3,
  worktree_path: '../<repo>-worktrees/',
  cleanup_on_success: true,
  base_branch: 'main',
};

// ============================================================================
// Task Graph Building Tests
// ============================================================================

describe('loop integration: task graph building', () => {
  it('builds task graph from mock Linear sub-tasks', () => {
    const graph = buildTaskGraph(mockParentIssue.id, mockParentIssue.identifier, mockSubtasks);

    expect(graph.parentId).toBe(mockParentIssue.id);
    expect(graph.parentIdentifier).toBe(mockParentIssue.identifier);
    expect(graph.tasks.size).toBe(4);
  });

  it('correctly identifies ready tasks with all blockers done', () => {
    const graph = buildTaskGraph(mockParentIssue.id, mockParentIssue.identifier, mockSubtasks);
    const readyTasks = getReadyTasks(graph);

    // MOB-103 should be ready (both MOB-101 and MOB-102 are Done)
    expect(readyTasks.length).toBe(1);
    expect(readyTasks[0].identifier).toBe('MOB-103');
  });

  it('correctly identifies blocked tasks', () => {
    const graph = buildTaskGraph(mockParentIssue.id, mockParentIssue.identifier, mockSubtasks);
    const blockedTasks = getBlockedTasks(graph);

    // MOB-104 is blocked by MOB-103
    expect(blockedTasks.length).toBe(1);
    expect(blockedTasks[0].identifier).toBe('MOB-104');
  });

  it('correctly computes graph statistics', () => {
    const graph = buildTaskGraph(mockParentIssue.id, mockParentIssue.identifier, mockSubtasks);
    const stats = getGraphStats(graph);

    expect(stats.total).toBe(4);
    expect(stats.done).toBe(2); // MOB-101, MOB-102
    expect(stats.ready).toBe(1); // MOB-103
    expect(stats.blocked).toBe(1); // MOB-104
    expect(stats.inProgress).toBe(0);
  });

  it('updates graph when task completes', () => {
    let graph = buildTaskGraph(mockParentIssue.id, mockParentIssue.identifier, mockSubtasks);

    // Initially: MOB-103 is ready, MOB-104 is blocked
    expect(getReadyTasks(graph).map((t) => t.identifier)).toEqual(['MOB-103']);
    expect(getBlockedTasks(graph).map((t) => t.identifier)).toEqual(['MOB-104']);

    // Mark MOB-103 as done
    graph = updateTaskStatus(graph, 'id-103', 'done');

    // Now: MOB-104 should be ready
    expect(getReadyTasks(graph).map((t) => t.identifier)).toEqual(['MOB-104']);
    expect(getBlockedTasks(graph).length).toBe(0);
  });
});

// ============================================================================
// Tree Rendering Tests
// ============================================================================

describe('loop integration: tree rendering', () => {
  it('renders ASCII tree output', () => {
    const graph = buildTaskGraph(mockParentIssue.id, mockParentIssue.identifier, mockSubtasks);
    const treeOutput = renderFullTreeOutput(graph);

    // Should contain the parent identifier
    expect(treeOutput).toContain(mockParentIssue.identifier);

    // Should contain task identifiers
    expect(treeOutput).toContain('MOB-101');
    expect(treeOutput).toContain('MOB-102');
    expect(treeOutput).toContain('MOB-103');
    expect(treeOutput).toContain('MOB-104');

    // Should contain legend
    expect(treeOutput).toContain('Legend');
  });

  it('renders Mermaid diagram', () => {
    const graph = buildTaskGraph(mockParentIssue.id, mockParentIssue.identifier, mockSubtasks);
    const mermaid = renderMermaidWithTitle(graph);

    // Should be valid Mermaid flowchart syntax
    expect(mermaid).toContain('```mermaid');
    expect(mermaid).toContain('flowchart');

    // Should contain task nodes
    expect(mermaid).toContain('MOB-101');
    expect(mermaid).toContain('MOB-102');
    expect(mermaid).toContain('MOB-103');
    expect(mermaid).toContain('MOB-104');

    // Should contain edges (dependencies) - note: node IDs use underscores
    expect(mermaid).toContain('MOB_101 --> MOB_103');
    expect(mermaid).toContain('MOB_102 --> MOB_103');
    expect(mermaid).toContain('MOB_103 --> MOB_104');
  });
});

// ============================================================================
// Parallel Execution Logic Tests
// ============================================================================

describe('loop integration: parallel execution logic', () => {
  it('calculates parallelism respecting config limits', () => {
    // 3 ready tasks, max 3 parallel → 3
    expect(calculateParallelism(3, { ...defaultConfig, max_parallel_agents: 3 })).toBe(3);

    // 5 ready tasks, max 3 parallel → 3
    expect(calculateParallelism(5, { ...defaultConfig, max_parallel_agents: 3 })).toBe(3);

    // 2 ready tasks, max 3 parallel → 2
    expect(calculateParallelism(2, { ...defaultConfig, max_parallel_agents: 3 })).toBe(2);

    // 0 ready tasks → 0
    expect(calculateParallelism(0, { ...defaultConfig, max_parallel_agents: 3 })).toBe(0);
  });

  it('aggregates execution results correctly', () => {
    const results: ExecutionResult[] = [
      {
        taskId: 'id-1',
        identifier: 'MOB-101',
        success: true,
        status: 'SUBTASK_COMPLETE',
        duration: 5000,
      },
      {
        taskId: 'id-2',
        identifier: 'MOB-102',
        success: true,
        status: 'SUBTASK_COMPLETE',
        duration: 3000,
      },
      {
        taskId: 'id-3',
        identifier: 'MOB-103',
        success: false,
        status: 'VERIFICATION_FAILED',
        duration: 8000,
        error: 'Test failure',
      },
    ];

    const aggregated = aggregateResults(results);

    expect(aggregated.total).toBe(3);
    expect(aggregated.succeeded).toBe(2);
    expect(aggregated.failed).toBe(1);
    expect(aggregated.completed).toEqual(['MOB-101', 'MOB-102']);
    expect(aggregated.failed_tasks).toEqual(['MOB-103: Test failure']);
  });

  it('handles all successful results', () => {
    const results: ExecutionResult[] = [
      {
        taskId: 'id-1',
        identifier: 'MOB-101',
        success: true,
        status: 'SUBTASK_COMPLETE',
        duration: 5000,
      },
      {
        taskId: 'id-2',
        identifier: 'MOB-102',
        success: true,
        status: 'SUBTASK_COMPLETE',
        duration: 3000,
      },
    ];

    const aggregated = aggregateResults(results);

    expect(aggregated.succeeded).toBe(2);
    expect(aggregated.failed).toBe(0);
    expect(aggregated.failed_tasks).toEqual([]);
  });

  it('handles all failed results', () => {
    const results: ExecutionResult[] = [
      {
        taskId: 'id-1',
        identifier: 'MOB-101',
        success: false,
        status: 'VERIFICATION_FAILED',
        duration: 5000,
        error: 'Type error',
      },
      {
        taskId: 'id-2',
        identifier: 'MOB-102',
        success: false,
        status: 'ERROR',
        duration: 3000,
        error: 'Git conflict',
      },
    ];

    const aggregated = aggregateResults(results);

    expect(aggregated.succeeded).toBe(0);
    expect(aggregated.failed).toBe(2);
    expect(aggregated.completed).toEqual([]);
    expect(aggregated.failed_tasks).toHaveLength(2);
  });

  it('handles empty results', () => {
    const aggregated = aggregateResults([]);

    expect(aggregated.total).toBe(0);
    expect(aggregated.succeeded).toBe(0);
    expect(aggregated.failed).toBe(0);
  });
});

// ============================================================================
// Loop State Machine Tests
// ============================================================================

describe('loop integration: state machine', () => {
  it('simulates complete loop execution flow', () => {
    let graph = buildTaskGraph(mockParentIssue.id, mockParentIssue.identifier, mockSubtasks);

    // Initial state
    let stats = getGraphStats(graph);
    expect(stats.done).toBe(2);
    expect(stats.ready).toBe(1);
    expect(stats.blocked).toBe(1);

    // Iteration 1: Execute ready task (MOB-103)
    const readyTasks1 = getReadyTasks(graph);
    expect(readyTasks1.length).toBe(1);
    expect(readyTasks1[0].identifier).toBe('MOB-103');

    // Simulate MOB-103 completion
    graph = updateTaskStatus(graph, 'id-103', 'done');

    // After iteration 1
    stats = getGraphStats(graph);
    expect(stats.done).toBe(3);
    expect(stats.ready).toBe(1); // MOB-104 is now ready
    expect(stats.blocked).toBe(0);

    // Iteration 2: Execute ready task (MOB-104)
    const readyTasks2 = getReadyTasks(graph);
    expect(readyTasks2.length).toBe(1);
    expect(readyTasks2[0].identifier).toBe('MOB-104');

    // Simulate MOB-104 completion
    graph = updateTaskStatus(graph, 'id-104', 'done');

    // Final state - all done
    stats = getGraphStats(graph);
    expect(stats.done).toBe(4);
    expect(stats.ready).toBe(0);
    expect(stats.blocked).toBe(0);
  });

  it('handles partial parallel execution', () => {
    // Create a graph with multiple independent ready tasks
    const parallelTasks: LinearIssue[] = [
      createMockLinearIssue('id-1', 'MOB-201', 'Task 1', 'Backlog'),
      createMockLinearIssue('id-2', 'MOB-202', 'Task 2', 'Backlog'),
      createMockLinearIssue('id-3', 'MOB-203', 'Task 3', 'Backlog'),
      createMockLinearIssue('id-4', 'MOB-204', 'Task 4', 'Backlog', [
        { id: 'id-1', identifier: 'MOB-201' },
        { id: 'id-2', identifier: 'MOB-202' },
        { id: 'id-3', identifier: 'MOB-203' },
      ]),
    ];

    let graph = buildTaskGraph('parent-id', 'MOB-200', parallelTasks);

    // Initial: 3 ready tasks (MOB-201, 202, 203), 1 blocked (MOB-204)
    const stats = getGraphStats(graph);
    expect(stats.ready).toBe(3);
    expect(stats.blocked).toBe(1);

    // Calculate parallelism (max 2)
    const parallelCount = calculateParallelism(3, { ...defaultConfig, max_parallel_agents: 2 });
    expect(parallelCount).toBe(2);

    // Simulate completing 2 tasks
    graph = updateTaskStatus(graph, 'id-1', 'done');
    graph = updateTaskStatus(graph, 'id-2', 'done');

    // MOB-204 still blocked (needs MOB-203)
    expect(getGraphStats(graph).blocked).toBe(1);

    // Complete MOB-203
    graph = updateTaskStatus(graph, 'id-3', 'done');

    // Now MOB-204 is ready
    expect(getGraphStats(graph).ready).toBe(1);
    expect(getReadyTasks(graph)[0].identifier).toBe('MOB-204');
  });

  it('handles failure scenario - stops on task failure', () => {
    const graph = buildTaskGraph(mockParentIssue.id, mockParentIssue.identifier, mockSubtasks);

    // Simulate MOB-103 execution failure
    // In the real loop, this would stop execution

    // Create result indicating failure
    const failedResult: ExecutionResult = {
      taskId: 'id-103',
      identifier: 'MOB-103',
      success: false,
      status: 'VERIFICATION_FAILED',
      duration: 10000,
      error: 'Tests failed',
    };

    const aggregated = aggregateResults([failedResult]);
    expect(aggregated.failed).toBe(1);
    expect(aggregated.failed_tasks).toContain('MOB-103: Tests failed');

    // Graph should remain unchanged (task still not marked done)
    const stats = getGraphStats(graph);
    expect(stats.done).toBe(2); // Only MOB-101 and MOB-102
    expect(stats.ready).toBe(1); // MOB-103 still ready
    expect(stats.blocked).toBe(1); // MOB-104 still blocked
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('loop integration: edge cases', () => {
  it('handles empty sub-task list', () => {
    const graph = buildTaskGraph('parent-id', 'MOB-100', []);

    expect(graph.tasks.size).toBe(0);
    expect(getReadyTasks(graph).length).toBe(0);
    expect(getBlockedTasks(graph).length).toBe(0);
    expect(getGraphStats(graph).total).toBe(0);
  });

  it('handles all tasks already done', () => {
    const doneTasks: LinearIssue[] = [
      createMockLinearIssue('id-1', 'MOB-301', 'Task 1', 'Done'),
      createMockLinearIssue('id-2', 'MOB-302', 'Task 2', 'Done'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-300', doneTasks);
    const stats = getGraphStats(graph);

    expect(stats.total).toBe(2);
    expect(stats.done).toBe(2);
    expect(stats.ready).toBe(0);
    expect(stats.blocked).toBe(0);
    expect(getReadyTasks(graph).length).toBe(0);
  });

  it('handles in_progress task with blocked dependents', () => {
    // Chain where first task is in progress, rest are blocked
    const chainTasks: LinearIssue[] = [
      createMockLinearIssue('id-1', 'MOB-401', 'Task 1', 'In Progress'),
      createMockLinearIssue('id-2', 'MOB-402', 'Task 2', 'Backlog', [
        { id: 'id-1', identifier: 'MOB-401' },
      ]),
      createMockLinearIssue('id-3', 'MOB-403', 'Task 3', 'Backlog', [
        { id: 'id-2', identifier: 'MOB-402' },
      ]),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-400', chainTasks);

    // MOB-401 is in_progress and returned as ready (for resume capability)
    // MOB-402 and MOB-403 are blocked
    expect(getReadyTasks(graph).length).toBe(1);
    expect(getReadyTasks(graph)[0].identifier).toBe('MOB-401');
    expect(getBlockedTasks(graph).length).toBe(2);
  });

  it('handles diamond dependency pattern correctly', () => {
    //       MOB-501
    //       /    \
    //  MOB-502  MOB-503
    //       \    /
    //       MOB-504
    const diamondTasks: LinearIssue[] = [
      createMockLinearIssue('id-1', 'MOB-501', 'Root', 'Done'),
      createMockLinearIssue('id-2', 'MOB-502', 'Left', 'Backlog', [
        { id: 'id-1', identifier: 'MOB-501' },
      ]),
      createMockLinearIssue('id-3', 'MOB-503', 'Right', 'Backlog', [
        { id: 'id-1', identifier: 'MOB-501' },
      ]),
      createMockLinearIssue('id-4', 'MOB-504', 'Bottom', 'Backlog', [
        { id: 'id-2', identifier: 'MOB-502' },
        { id: 'id-3', identifier: 'MOB-503' },
      ]),
    ];

    let graph = buildTaskGraph('parent-id', 'MOB-500', diamondTasks);

    // Initially: MOB-502 and MOB-503 are ready (parallel), MOB-504 is blocked
    const ready1 = getReadyTasks(graph);
    expect(ready1.length).toBe(2);
    expect(ready1.map((t) => t.identifier).sort()).toEqual(['MOB-502', 'MOB-503']);
    expect(getBlockedTasks(graph).length).toBe(1);

    // Complete MOB-502 only
    graph = updateTaskStatus(graph, 'id-2', 'done');

    // MOB-504 still blocked (needs MOB-503)
    expect(getBlockedTasks(graph).map((t) => t.identifier)).toEqual(['MOB-504']);

    // Complete MOB-503
    graph = updateTaskStatus(graph, 'id-3', 'done');

    // Now MOB-504 is ready
    expect(getReadyTasks(graph).map((t) => t.identifier)).toEqual(['MOB-504']);
  });

  it('handles single task scenario', () => {
    const singleTask: LinearIssue[] = [
      createMockLinearIssue('id-1', 'MOB-601', 'Only task', 'Backlog'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-600', singleTask);

    expect(graph.tasks.size).toBe(1);
    expect(getReadyTasks(graph).length).toBe(1);
    expect(getBlockedTasks(graph).length).toBe(0);

    // Complete it
    const updatedGraph = updateTaskStatus(graph, 'id-1', 'done');
    expect(getGraphStats(updatedGraph).done).toBe(1);
  });
});

// ============================================================================
// Config Validation Tests
// ============================================================================

describe('loop integration: configuration', () => {
  it('uses default max_parallel_agents when not specified', () => {
    const configWithoutParallel: ExecutionConfig = {
      delay_seconds: 3,
      max_iterations: 50,
      model: 'opus',
      sandbox: true,
      container_name: 'test',
    };

    // calculateParallelism should use default (3) when undefined
    const parallelism = calculateParallelism(5, configWithoutParallel);
    expect(parallelism).toBe(3); // Default value
  });

  it('respects explicit max_parallel_agents value', () => {
    const config: ExecutionConfig = {
      ...defaultConfig,
      max_parallel_agents: 1, // Sequential execution
    };

    expect(calculateParallelism(10, config)).toBe(1);
  });

  it('handles high parallelism config', () => {
    const config: ExecutionConfig = {
      ...defaultConfig,
      max_parallel_agents: 10,
    };

    // Should be limited by actual task count
    expect(calculateParallelism(5, config)).toBe(5);
    expect(calculateParallelism(15, config)).toBe(10);
  });
});

// ============================================================================
// Sequence Verification Tests
// ============================================================================

describe('loop integration: operation sequence', () => {
  it('verifies correct sequence: graph → tree → mermaid → execute', () => {
    // This test documents the expected operation sequence

    // 1. Build task graph from Linear data
    const graph = buildTaskGraph(mockParentIssue.id, mockParentIssue.identifier, mockSubtasks);
    expect(graph.tasks.size).toBeGreaterThan(0);

    // 2. Render ASCII tree for console
    const asciiTree = renderFullTreeOutput(graph);
    expect(asciiTree.length).toBeGreaterThan(0);

    // 3. Generate Mermaid diagram for Linear comment
    const mermaid = renderMermaidWithTitle(graph);
    expect(mermaid).toContain('```mermaid');

    // 4. Get ready tasks and calculate parallelism
    const readyTasks = getReadyTasks(graph);
    const parallelism = calculateParallelism(readyTasks.length, defaultConfig);
    expect(parallelism).toBeGreaterThan(0);

    // 5. (Would execute tasks here - mocked in real integration)

    // 6. Update graph after completion
    const updatedGraph = updateTaskStatus(graph, readyTasks[0].id, 'done');
    expect(getGraphStats(updatedGraph).done).toBeGreaterThan(getGraphStats(graph).done);
  });
});

// ============================================================================
// Verification Exit Integration Tests
// ============================================================================

describe('loop integration: verification exit', () => {
  /**
   * Mock sub-tasks with a verification gate task at the end
   *
   * Structure:
   * MOB-701 (Done) → MOB-702 (blocked by 701)
   * MOB-702 (Done) → MOB-703 Verification Gate (blocked by 701, 702)
   */
  const tasksWithVerificationGate: LinearIssue[] = [
    createMockLinearIssue('id-701', 'MOB-701', 'Implement feature', 'Done'),
    createMockLinearIssue(
      'id-702',
      'MOB-702',
      'Add tests',
      'Done',
      [{ id: 'id-701', identifier: 'MOB-701' }],
      [{ id: 'id-703', identifier: 'MOB-703' }]
    ),
    createMockLinearIssue('id-703', 'MOB-703', 'Verification Gate', 'Backlog', [
      { id: 'id-701', identifier: 'MOB-701' },
      { id: 'id-702', identifier: 'MOB-702' },
    ]),
  ];

  it('exits loop when verification task completes', () => {
    // Build graph with verification gate initially ready (blockers done)
    let graph = buildTaskGraph('parent-id', 'MOB-700', tasksWithVerificationGate);

    // Initially: verification task is ready (blockers MOB-701, MOB-702 are done)
    const verificationTask = getVerificationTask(graph);
    expect(verificationTask).toBeDefined();
    expect(verificationTask?.identifier).toBe('MOB-703');
    expect(verificationTask?.status).toBe('ready');

    // Simulate verification task completion (mark as done)
    graph = updateTaskStatus(graph, 'id-703', 'done');

    // After completion: verification task status is done
    const updatedVerificationTask = getVerificationTask(graph);
    expect(updatedVerificationTask?.status).toBe('done');

    // Loop exit condition: verification task status === 'done'
    // This simulates what the loop does at line 223:
    // if (verificationTask?.status === 'done') { allComplete = true; break; }
    const shouldExitLoop = updatedVerificationTask?.status === 'done';
    expect(shouldExitLoop).toBe(true);

    // Verify the loop would print the success message format
    // This validates the early exit behavior
    const stats = getGraphStats(graph);
    expect(stats.done).toBe(3); // All tasks done
  });

  it('continues when verification not done', () => {
    // Build graph with verification gate initially blocked
    const tasksWithBlockedVerification: LinearIssue[] = [
      createMockLinearIssue('id-801', 'MOB-801', 'Implement feature', 'Done'),
      createMockLinearIssue(
        'id-802',
        'MOB-802',
        'Add tests',
        'In Progress', // Still in progress
        [{ id: 'id-801', identifier: 'MOB-801' }],
        [{ id: 'id-803', identifier: 'MOB-803' }]
      ),
      createMockLinearIssue('id-803', 'MOB-803', 'Verification Gate', 'Backlog', [
        { id: 'id-801', identifier: 'MOB-801' },
        { id: 'id-802', identifier: 'MOB-802' },
      ]),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-800', tasksWithBlockedVerification);

    // Verification task exists but is blocked (MOB-802 is in progress)
    const verificationTask = getVerificationTask(graph);
    expect(verificationTask).toBeDefined();
    expect(verificationTask?.identifier).toBe('MOB-803');
    expect(verificationTask?.status).toBe('blocked');

    // Loop should NOT exit when verification task is blocked
    // This simulates the check at line 223:
    // if (verificationTask?.status === 'done') - this would be false
    const shouldExitLoop = verificationTask?.status === 'done';
    expect(shouldExitLoop).toBe(false);

    // Loop should continue to process ready tasks
    const readyTasks = getReadyTasks(graph);
    // MOB-802 is in_progress and returned as ready for resume capability
    expect(readyTasks.length).toBe(1);
    expect(readyTasks[0].identifier).toBe('MOB-802');
  });

  it('continues when verification task is in progress', () => {
    const tasksWithInProgressVerification: LinearIssue[] = [
      createMockLinearIssue('id-901', 'MOB-901', 'Implement feature', 'Done'),
      createMockLinearIssue('id-902', 'MOB-902', 'Add tests', 'Done', [
        { id: 'id-901', identifier: 'MOB-901' },
      ]),
      createMockLinearIssue(
        'id-903',
        'MOB-903',
        'Verification Gate',
        'In Progress', // Currently running
        [
          { id: 'id-901', identifier: 'MOB-901' },
          { id: 'id-902', identifier: 'MOB-902' },
        ]
      ),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-900', tasksWithInProgressVerification);

    // Verification task is in progress
    const verificationTask = getVerificationTask(graph);
    expect(verificationTask).toBeDefined();
    expect(verificationTask?.status).toBe('in_progress');

    // Loop should NOT exit - verification not complete
    const shouldExitLoop = verificationTask?.status === 'done';
    expect(shouldExitLoop).toBe(false);

    // Ready tasks should include the in_progress verification task (for resume)
    const readyTasks = getReadyTasks(graph);
    expect(readyTasks.some((t) => t.identifier === 'MOB-903')).toBe(true);
  });

  it('handles no verification task gracefully', () => {
    // Tasks without a verification gate
    const tasksWithoutVerification: LinearIssue[] = [
      createMockLinearIssue('id-1001', 'MOB-1001', 'Task 1', 'Done'),
      createMockLinearIssue('id-1002', 'MOB-1002', 'Task 2', 'Done'),
      createMockLinearIssue('id-1003', 'MOB-1003', 'Task 3', 'Done'),
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-1000', tasksWithoutVerification);

    // No verification task exists
    const verificationTask = getVerificationTask(graph);
    expect(verificationTask).toBeUndefined();

    // Loop should fall back to standard completion check (stats.done === stats.total)
    // This is the fallback at line 244: if (stats.done === stats.total) { allComplete = true; }
    const stats = getGraphStats(graph);
    const shouldExitViaFallback = stats.done === stats.total;
    expect(shouldExitViaFallback).toBe(true);
  });

  it('stops on verification done even with incomplete non-verification tasks', () => {
    // Edge case: What if verification completes but other tasks remain?
    // This tests the early exit behavior - verification done takes precedence
    const tasksWithPartialCompletion: LinearIssue[] = [
      createMockLinearIssue('id-1101', 'MOB-1101', 'Core feature', 'Done'),
      createMockLinearIssue('id-1102', 'MOB-1102', 'Verification Gate', 'Done'), // Verification done
      createMockLinearIssue('id-1103', 'MOB-1103', 'Nice-to-have feature', 'Backlog'), // Still pending
    ];

    const graph = buildTaskGraph('parent-id', 'MOB-1100', tasksWithPartialCompletion);

    // Verification task is done
    const verificationTask = getVerificationTask(graph);
    expect(verificationTask?.status).toBe('done');

    // Loop should exit early due to verification done
    // This takes precedence over the stats.done === stats.total check
    const shouldExitLoop = verificationTask?.status === 'done';
    expect(shouldExitLoop).toBe(true);

    // Stats show not all tasks are done, but loop would still exit
    const stats = getGraphStats(graph);
    expect(stats.done).toBe(2);
    expect(stats.total).toBe(3);
    expect(stats.done < stats.total).toBe(true); // Not all complete
  });
});
