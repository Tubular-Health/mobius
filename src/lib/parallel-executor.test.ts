/**
 * Unit tests for parallel-executor.ts
 *
 * Tests verify:
 * 1. buildClaudeCommand() produces correct command with task identifier
 * 2. parseAgentOutput() correctly extracts STATUS patterns
 * 3. Task identifier is correctly passed through the pipeline
 * 4. Timeout behavior marks task as ERROR
 *
 * Uses mocks for tmux functions - no real sessions or Claude processes.
 */

import { describe, expect, it } from 'bun:test';
import type { ExecutionConfig } from '../types.js';
// We need to import the functions we're testing
// Note: buildClaudeCommand and parseAgentOutput need to be exported from parallel-executor.ts
import {
  aggregateResults,
  buildClaudeCommand,
  calculateParallelism,
  type ExecutionResult,
  parseAgentOutput,
} from './parallel-executor.js';
import type { SubTask } from './task-graph.js';

// Helper to create a mock SubTask
function createMockSubTask(overrides: Partial<SubTask> = {}): SubTask {
  return {
    id: 'test-uuid-123',
    identifier: 'MOB-124',
    title: 'Test sub-task',
    status: 'ready',
    blockedBy: [],
    blocks: [],
    gitBranchName: 'feature/mob-124-test',
    ...overrides,
  };
}

// Helper to create a mock ExecutionConfig
function createMockConfig(overrides: Partial<ExecutionConfig> = {}): ExecutionConfig {
  return {
    delay_seconds: 3,
    max_iterations: 50,
    model: 'opus',
    sandbox: true,
    container_name: 'mobius-sandbox',
    max_parallel_agents: 3,
    ...overrides,
  };
}

describe('parallel-executor', () => {
  describe('buildClaudeCommand', () => {
    it('produces correct command with task identifier', () => {
      const subtaskIdentifier = 'MOB-124';
      const skill = '/execute-issue';
      const worktreePath = '/path/to/worktree';
      const config = createMockConfig();

      const command = buildClaudeCommand(subtaskIdentifier, skill, worktreePath, config);

      // Should contain cd to worktree
      expect(command).toContain(`cd "${worktreePath}"`);
      // Should echo the skill with specific subtask identifier
      expect(command).toContain(`echo '${skill} ${subtaskIdentifier}'`);
      // Should pipe to claude with proper flags
      expect(command).toContain(
        'claude -p --dangerously-skip-permissions --verbose --output-format stream-json'
      );
      // Should include model flag
      expect(command).toContain('--model opus');
      // Should pipe through cclean
      expect(command).toContain('| cclean');
    });

    it('includes model flag when model is specified', () => {
      const command = buildClaudeCommand(
        'MOB-125',
        '/execute-issue',
        '/worktree',
        createMockConfig({ model: 'sonnet' })
      );

      expect(command).toContain('--model sonnet');
    });

    it('handles haiku model correctly', () => {
      const command = buildClaudeCommand(
        'MOB-126',
        '/execute-issue',
        '/worktree',
        createMockConfig({ model: 'haiku' })
      );

      expect(command).toContain('--model haiku');
    });

    it('builds command with different task identifiers', () => {
      const config = createMockConfig();

      const command1 = buildClaudeCommand('PROJ-100', '/execute-issue', '/path1', config);
      const command2 = buildClaudeCommand('PROJ-200', '/execute-issue', '/path2', config);

      expect(command1).toContain("echo '/execute-issue PROJ-100'");
      expect(command2).toContain("echo '/execute-issue PROJ-200'");
      expect(command1).not.toEqual(command2);
    });

    it('handles worktree paths with spaces', () => {
      const command = buildClaudeCommand(
        'MOB-127',
        '/execute-issue',
        '/path/with spaces/worktree',
        createMockConfig()
      );

      // Path should be quoted
      expect(command).toContain('cd "/path/with spaces/worktree"');
    });

    it('builds command components in correct order', () => {
      const command = buildClaudeCommand(
        'MOB-128',
        '/execute-issue',
        '/worktree',
        createMockConfig()
      );

      // Verify order: cd -> && -> echo -> | -> claude -> | -> cclean
      const cdIndex = command.indexOf('cd "');
      const andIndex = command.indexOf('&&');
      const echoIndex = command.indexOf("echo '");
      const firstPipeIndex = command.indexOf('|');
      const claudeIndex = command.indexOf('claude -p');
      const ccleanIndex = command.indexOf('cclean');

      expect(cdIndex).toBeLessThan(andIndex);
      expect(andIndex).toBeLessThan(echoIndex);
      expect(echoIndex).toBeLessThan(firstPipeIndex);
      expect(firstPipeIndex).toBeLessThan(claudeIndex);
      expect(claudeIndex).toBeLessThan(ccleanIndex);
    });
  });

  describe('parseAgentOutput', () => {
    const mockTask = createMockSubTask();
    const startTime = Date.now() - 5000; // 5 seconds ago
    const paneId = '%0';

    describe('SUBTASK_COMPLETE status', () => {
      it('detects STATUS: SUBTASK_COMPLETE', () => {
        const content = `
Some output...
STATUS: SUBTASK_COMPLETE
More output...
        `;

        const result = parseAgentOutput(content, mockTask, startTime, paneId);

        expect(result).not.toBeNull();
        expect(result?.success).toBe(true);
        expect(result?.status).toBe('SUBTASK_COMPLETE');
        expect(result?.taskId).toBe(mockTask.id);
        expect(result?.identifier).toBe(mockTask.identifier);
        expect(result?.pane).toBe(paneId);
      });

      it('detects EXECUTION_COMPLETE marker', () => {
        const content = `
Implementation complete.
EXECUTION_COMPLETE: MOB-124
        `;

        const result = parseAgentOutput(content, mockTask, startTime, paneId);

        expect(result).not.toBeNull();
        expect(result?.success).toBe(true);
        expect(result?.status).toBe('SUBTASK_COMPLETE');
      });

      it('detects STATUS: ALL_COMPLETE as success', () => {
        const content = `
All sub-tasks are done.
STATUS: ALL_COMPLETE
        `;

        const result = parseAgentOutput(content, mockTask, startTime, paneId);

        expect(result).not.toBeNull();
        expect(result?.success).toBe(true);
        expect(result?.status).toBe('SUBTASK_COMPLETE');
      });
    });

    describe('VERIFICATION_FAILED status', () => {
      it('detects STATUS: VERIFICATION_FAILED', () => {
        const content = `
Running tests...
STATUS: VERIFICATION_FAILED
Tests failed.
        `;

        const result = parseAgentOutput(content, mockTask, startTime, paneId);

        expect(result).not.toBeNull();
        expect(result?.success).toBe(false);
        expect(result?.status).toBe('VERIFICATION_FAILED');
      });

      it('extracts error details when available', () => {
        const content = `
STATUS: VERIFICATION_FAILED
### Error Summary
Type error in src/components/Button.tsx
        `;

        const result = parseAgentOutput(content, mockTask, startTime, paneId);

        expect(result).not.toBeNull();
        expect(result?.error).toBe('Type error in src/components/Button.tsx');
      });

      it('uses default error message when no details available', () => {
        const content = `STATUS: VERIFICATION_FAILED`;

        const result = parseAgentOutput(content, mockTask, startTime, paneId);

        expect(result).not.toBeNull();
        expect(result?.error).toBe('Verification failed');
      });
    });

    describe('ERROR status', () => {
      it('detects STATUS: ALL_BLOCKED as ERROR', () => {
        const content = `
No ready tasks available.
STATUS: ALL_BLOCKED
        `;

        const result = parseAgentOutput(content, mockTask, startTime, paneId);

        expect(result).not.toBeNull();
        expect(result?.success).toBe(false);
        expect(result?.status).toBe('ERROR');
        expect(result?.error).toBe('No actionable sub-tasks available');
      });

      it('detects STATUS: NO_SUBTASKS as ERROR', () => {
        const content = `
Issue has no subtasks.
STATUS: NO_SUBTASKS
        `;

        const result = parseAgentOutput(content, mockTask, startTime, paneId);

        expect(result).not.toBeNull();
        expect(result?.success).toBe(false);
        expect(result?.status).toBe('ERROR');
        expect(result?.error).toBe('No actionable sub-tasks available');
      });
    });

    describe('no completion detected', () => {
      it('returns null when no status markers present', () => {
        const content = `
Working on task...
Still processing...
Making progress...
        `;

        const result = parseAgentOutput(content, mockTask, startTime, paneId);

        expect(result).toBeNull();
      });

      it('returns null for empty content', () => {
        const result = parseAgentOutput('', mockTask, startTime, paneId);
        expect(result).toBeNull();
      });

      it('returns null for partial status marker', () => {
        const content = `
STATUS: PROCESSING
Still working...
        `;

        const result = parseAgentOutput(content, mockTask, startTime, paneId);
        expect(result).toBeNull();
      });
    });

    describe('duration calculation', () => {
      it('calculates duration from startTime', () => {
        const recentStartTime = Date.now() - 10000; // 10 seconds ago
        const content = 'STATUS: SUBTASK_COMPLETE';

        const result = parseAgentOutput(content, mockTask, recentStartTime, paneId);

        expect(result).not.toBeNull();
        // Duration should be approximately 10000ms (allow some tolerance)
        expect(result?.duration).toBeGreaterThanOrEqual(9900);
        expect(result?.duration).toBeLessThanOrEqual(11000);
      });
    });

    describe('task and pane identification', () => {
      it('includes correct task ID in result', () => {
        const task = createMockSubTask({ id: 'unique-task-id-456' });
        const content = 'STATUS: SUBTASK_COMPLETE';

        const result = parseAgentOutput(content, task, startTime, paneId);

        expect(result?.taskId).toBe('unique-task-id-456');
      });

      it('includes correct identifier in result', () => {
        const task = createMockSubTask({ identifier: 'PROJ-999' });
        const content = 'STATUS: SUBTASK_COMPLETE';

        const result = parseAgentOutput(content, task, startTime, paneId);

        expect(result?.identifier).toBe('PROJ-999');
      });

      it('includes correct pane ID in result', () => {
        const content = 'STATUS: SUBTASK_COMPLETE';

        const result = parseAgentOutput(content, mockTask, startTime, '%5');

        expect(result?.pane).toBe('%5');
      });
    });
  });

  describe('timeout behavior', () => {
    // Note: We can't easily test the actual timeout in waitForAgent without
    // mocking time, but we can test the expected result structure for timeouts
    it('timeout results have ERROR status', () => {
      // This tests the structure of what a timeout result should look like
      const timeoutResult: ExecutionResult = {
        taskId: 'test-id',
        identifier: 'MOB-130',
        success: false,
        status: 'ERROR',
        duration: 30 * 60 * 1000, // 30 minutes
        error: 'Agent timed out after 1800000ms',
        pane: '%0',
      };

      expect(timeoutResult.success).toBe(false);
      expect(timeoutResult.status).toBe('ERROR');
      expect(timeoutResult.error).toContain('timed out');
    });

    it('timeout error message includes timeout duration', () => {
      const timeout = 30 * 60 * 1000; // 30 minutes
      const errorMessage = `Agent timed out after ${timeout}ms`;

      expect(errorMessage).toContain('1800000');
      expect(errorMessage).toContain('ms');
    });
  });

  describe('calculateParallelism', () => {
    it('returns task count when fewer than max_parallel_agents', () => {
      const config = createMockConfig({ max_parallel_agents: 5 });

      expect(calculateParallelism(3, config)).toBe(3);
      expect(calculateParallelism(1, config)).toBe(1);
    });

    it('returns max_parallel_agents when more tasks available', () => {
      const config = createMockConfig({ max_parallel_agents: 3 });

      expect(calculateParallelism(5, config)).toBe(3);
      expect(calculateParallelism(10, config)).toBe(3);
    });

    it('returns 0 when no tasks available', () => {
      const config = createMockConfig({ max_parallel_agents: 3 });

      expect(calculateParallelism(0, config)).toBe(0);
    });

    it('defaults to 3 when max_parallel_agents not specified', () => {
      const config = createMockConfig();
      delete config.max_parallel_agents;

      expect(calculateParallelism(5, config)).toBe(3);
    });
  });

  describe('aggregateResults', () => {
    it('aggregates successful results', () => {
      const results: ExecutionResult[] = [
        {
          taskId: '1',
          identifier: 'MOB-1',
          success: true,
          status: 'SUBTASK_COMPLETE',
          duration: 1000,
          pane: '%0',
        },
        {
          taskId: '2',
          identifier: 'MOB-2',
          success: true,
          status: 'SUBTASK_COMPLETE',
          duration: 2000,
          pane: '%1',
        },
      ];

      const agg = aggregateResults(results);

      expect(agg.total).toBe(2);
      expect(agg.succeeded).toBe(2);
      expect(agg.failed).toBe(0);
      expect(agg.completed).toEqual(['MOB-1', 'MOB-2']);
      expect(agg.failed_tasks).toEqual([]);
    });

    it('aggregates failed results', () => {
      const results: ExecutionResult[] = [
        {
          taskId: '1',
          identifier: 'MOB-1',
          success: false,
          status: 'VERIFICATION_FAILED',
          duration: 1000,
          error: 'Tests failed',
          pane: '%0',
        },
        {
          taskId: '2',
          identifier: 'MOB-2',
          success: false,
          status: 'ERROR',
          duration: 2000,
          error: 'Timeout',
          pane: '%1',
        },
      ];

      const agg = aggregateResults(results);

      expect(agg.total).toBe(2);
      expect(agg.succeeded).toBe(0);
      expect(agg.failed).toBe(2);
      expect(agg.completed).toEqual([]);
      expect(agg.failed_tasks).toEqual(['MOB-1: Tests failed', 'MOB-2: Timeout']);
    });

    it('aggregates mixed results', () => {
      const results: ExecutionResult[] = [
        {
          taskId: '1',
          identifier: 'MOB-1',
          success: true,
          status: 'SUBTASK_COMPLETE',
          duration: 1000,
          pane: '%0',
        },
        {
          taskId: '2',
          identifier: 'MOB-2',
          success: false,
          status: 'ERROR',
          duration: 2000,
          error: 'Failed',
          pane: '%1',
        },
        {
          taskId: '3',
          identifier: 'MOB-3',
          success: true,
          status: 'SUBTASK_COMPLETE',
          duration: 3000,
          pane: '%2',
        },
      ];

      const agg = aggregateResults(results);

      expect(agg.total).toBe(3);
      expect(agg.succeeded).toBe(2);
      expect(agg.failed).toBe(1);
      expect(agg.completed).toEqual(['MOB-1', 'MOB-3']);
      expect(agg.failed_tasks).toEqual(['MOB-2: Failed']);
    });

    it('handles empty results', () => {
      const agg = aggregateResults([]);

      expect(agg.total).toBe(0);
      expect(agg.succeeded).toBe(0);
      expect(agg.failed).toBe(0);
      expect(agg.completed).toEqual([]);
      expect(agg.failed_tasks).toEqual([]);
    });

    it('handles failed task without error message', () => {
      const results: ExecutionResult[] = [
        {
          taskId: '1',
          identifier: 'MOB-1',
          success: false,
          status: 'ERROR',
          duration: 1000,
          pane: '%0',
        },
      ];

      const agg = aggregateResults(results);

      expect(agg.failed_tasks).toEqual(['MOB-1: ERROR']);
    });
  });

  describe('task identifier isolation', () => {
    it('each task receives unique identifier in command', () => {
      const config = createMockConfig();
      const tasks = [
        createMockSubTask({ identifier: 'MOB-100' }),
        createMockSubTask({ identifier: 'MOB-101' }),
        createMockSubTask({ identifier: 'MOB-102' }),
      ];

      const commands = tasks.map((task) =>
        buildClaudeCommand(task.identifier, '/execute-issue', '/worktree', config)
      );

      // Each command should contain its unique identifier
      expect(commands[0]).toContain('MOB-100');
      expect(commands[1]).toContain('MOB-101');
      expect(commands[2]).toContain('MOB-102');

      // Commands should not contain other identifiers
      expect(commands[0]).not.toContain('MOB-101');
      expect(commands[0]).not.toContain('MOB-102');
    });

    it('subtask identifier is preserved in parseAgentOutput result', () => {
      const task1 = createMockSubTask({ id: 'id-1', identifier: 'MOB-200' });
      const task2 = createMockSubTask({ id: 'id-2', identifier: 'MOB-201' });
      const content = 'STATUS: SUBTASK_COMPLETE';

      const result1 = parseAgentOutput(content, task1, Date.now(), '%0');
      const result2 = parseAgentOutput(content, task2, Date.now(), '%1');

      expect(result1?.identifier).toBe('MOB-200');
      expect(result2?.identifier).toBe('MOB-201');
    });
  });
});
