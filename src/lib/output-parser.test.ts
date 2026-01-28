/**
 * Unit tests for output-parser module
 */

import { describe, it, expect } from 'bun:test';
import {
  parseSkillOutput,
  extractStatus,
  isTerminalStatus,
  isSuccessStatus,
  isFailureStatus,
  SkillOutputParseError,
} from './output-parser.js';

describe('output-parser module', () => {
  describe('parseSkillOutput', () => {
    describe('JSON parsing', () => {
      it('parses valid JSON SUBTASK_COMPLETE output', () => {
        const input = JSON.stringify({
          status: 'SUBTASK_COMPLETE',
          timestamp: '2024-01-15T14:30:00Z',
          subtaskId: 'MOB-125',
          parentId: 'MOB-100',
          commitHash: 'abc123',
          filesModified: ['src/lib/test.ts'],
          verificationResults: {
            typecheck: 'PASS',
            tests: 'PASS',
            lint: 'PASS',
          },
        });

        const result = parseSkillOutput(input);

        expect(result.output.status).toBe('SUBTASK_COMPLETE');
        expect(result.output.timestamp).toBe('2024-01-15T14:30:00Z');
        if (result.output.status === 'SUBTASK_COMPLETE') {
          expect(result.output.subtaskId).toBe('MOB-125');
          expect(result.output.commitHash).toBe('abc123');
          expect(result.output.filesModified).toEqual(['src/lib/test.ts']);
        }
      });

      it('parses valid JSON SUBTASK_PARTIAL output', () => {
        const input = JSON.stringify({
          status: 'SUBTASK_PARTIAL',
          timestamp: '2024-01-15T14:30:00Z',
          subtaskId: 'MOB-125',
          progressMade: ['Created file', 'Added types'],
          remainingWork: ['Add tests'],
        });

        const result = parseSkillOutput(input);

        expect(result.output.status).toBe('SUBTASK_PARTIAL');
        if (result.output.status === 'SUBTASK_PARTIAL') {
          expect(result.output.subtaskId).toBe('MOB-125');
          expect(result.output.progressMade).toEqual(['Created file', 'Added types']);
          expect(result.output.remainingWork).toEqual(['Add tests']);
        }
      });

      it('parses valid JSON ALL_COMPLETE output', () => {
        const input = JSON.stringify({
          status: 'ALL_COMPLETE',
          timestamp: '2024-01-15T14:30:00Z',
          parentId: 'MOB-100',
          completedCount: 5,
        });

        const result = parseSkillOutput(input);

        expect(result.output.status).toBe('ALL_COMPLETE');
        if (result.output.status === 'ALL_COMPLETE') {
          expect(result.output.parentId).toBe('MOB-100');
          expect(result.output.completedCount).toBe(5);
        }
      });

      it('parses valid JSON ALL_BLOCKED output', () => {
        const input = JSON.stringify({
          status: 'ALL_BLOCKED',
          timestamp: '2024-01-15T14:30:00Z',
          parentId: 'MOB-100',
          blockedCount: 3,
          waitingOn: ['MOB-101', 'MOB-102'],
        });

        const result = parseSkillOutput(input);

        expect(result.output.status).toBe('ALL_BLOCKED');
        if (result.output.status === 'ALL_BLOCKED') {
          expect(result.output.blockedCount).toBe(3);
          expect(result.output.waitingOn).toEqual(['MOB-101', 'MOB-102']);
        }
      });

      it('parses valid JSON NO_SUBTASKS output', () => {
        const input = JSON.stringify({
          status: 'NO_SUBTASKS',
          timestamp: '2024-01-15T14:30:00Z',
          parentId: 'MOB-100',
        });

        const result = parseSkillOutput(input);

        expect(result.output.status).toBe('NO_SUBTASKS');
        if (result.output.status === 'NO_SUBTASKS') {
          expect(result.output.parentId).toBe('MOB-100');
        }
      });

      it('parses valid JSON VERIFICATION_FAILED output', () => {
        const input = JSON.stringify({
          status: 'VERIFICATION_FAILED',
          timestamp: '2024-01-15T14:30:00Z',
          subtaskId: 'MOB-125',
          errorType: 'tests',
          errorOutput: 'Test failed: expected 2 but got 3',
          attemptedFixes: ['Fix 1', 'Fix 2'],
          uncommittedFiles: ['src/lib/test.ts'],
        });

        const result = parseSkillOutput(input);

        expect(result.output.status).toBe('VERIFICATION_FAILED');
        if (result.output.status === 'VERIFICATION_FAILED') {
          expect(result.output.errorType).toBe('tests');
          expect(result.output.errorOutput).toContain('Test failed');
        }
      });

      it('parses valid JSON NEEDS_WORK output', () => {
        const input = JSON.stringify({
          status: 'NEEDS_WORK',
          timestamp: '2024-01-15T14:30:00Z',
          subtaskId: 'MOB-125',
          issues: ['Missing error handling'],
          suggestedFixes: ['Add try-catch block'],
        });

        const result = parseSkillOutput(input);

        expect(result.output.status).toBe('NEEDS_WORK');
        if (result.output.status === 'NEEDS_WORK') {
          expect(result.output.issues).toEqual(['Missing error handling']);
        }
      });

      it('parses valid JSON PASS output', () => {
        const input = JSON.stringify({
          status: 'PASS',
          timestamp: '2024-01-15T14:30:00Z',
          details: 'All checks passed',
        });

        const result = parseSkillOutput(input);

        expect(result.output.status).toBe('PASS');
        if (result.output.status === 'PASS') {
          expect(result.output.details).toBe('All checks passed');
        }
      });

      it('parses valid JSON FAIL output', () => {
        const input = JSON.stringify({
          status: 'FAIL',
          timestamp: '2024-01-15T14:30:00Z',
          reason: 'Tests are failing',
          details: 'See test output',
        });

        const result = parseSkillOutput(input);

        expect(result.output.status).toBe('FAIL');
        if (result.output.status === 'FAIL') {
          expect(result.output.reason).toBe('Tests are failing');
        }
      });
    });

    describe('YAML parsing', () => {
      it('parses valid YAML SUBTASK_COMPLETE output', () => {
        const input = `status: SUBTASK_COMPLETE
timestamp: "2024-01-15T14:30:00Z"
subtaskId: MOB-125
parentId: MOB-100
commitHash: abc123
filesModified:
  - src/lib/test.ts
verificationResults:
  typecheck: PASS
  tests: PASS
  lint: PASS`;

        const result = parseSkillOutput(input);

        expect(result.output.status).toBe('SUBTASK_COMPLETE');
        if (result.output.status === 'SUBTASK_COMPLETE') {
          expect(result.output.subtaskId).toBe('MOB-125');
          expect(result.output.commitHash).toBe('abc123');
        }
      });

      it('parses valid YAML ALL_BLOCKED output', () => {
        const input = `status: ALL_BLOCKED
timestamp: "2024-01-15T14:30:00Z"
parentId: MOB-100
blockedCount: 2
waitingOn:
  - MOB-101
  - MOB-102`;

        const result = parseSkillOutput(input);

        expect(result.output.status).toBe('ALL_BLOCKED');
        if (result.output.status === 'ALL_BLOCKED') {
          expect(result.output.waitingOn).toEqual(['MOB-101', 'MOB-102']);
        }
      });

      it('parses valid YAML PASS output with optional fields', () => {
        const input = `status: PASS
timestamp: "2024-01-15T14:30:00Z"
subtaskId: MOB-125`;

        const result = parseSkillOutput(input);

        expect(result.output.status).toBe('PASS');
        if (result.output.status === 'PASS') {
          expect(result.output.subtaskId).toBe('MOB-125');
        }
      });
    });

    describe('error handling', () => {
      it('throws SkillOutputParseError for empty input', () => {
        expect(() => parseSkillOutput('')).toThrow(SkillOutputParseError);
        expect(() => parseSkillOutput('')).toThrow('empty');
      });

      it('throws SkillOutputParseError for whitespace-only input', () => {
        expect(() => parseSkillOutput('   \n\t  ')).toThrow(SkillOutputParseError);
        expect(() => parseSkillOutput('   ')).toThrow('empty after trimming');
      });

      it('throws SkillOutputParseError for invalid JSON/YAML', () => {
        expect(() => parseSkillOutput('not valid { json or yaml')).toThrow(SkillOutputParseError);
        expect(() => parseSkillOutput('{ invalid json')).toThrow('Failed to parse');
      });

      it('throws SkillOutputParseError for array input', () => {
        expect(() => parseSkillOutput('["array", "input"]')).toThrow(SkillOutputParseError);
        expect(() => parseSkillOutput('[1, 2, 3]')).toThrow('must be an object');
      });

      it('throws SkillOutputParseError for missing status field', () => {
        const input = JSON.stringify({ timestamp: '2024-01-15T14:30:00Z' });
        expect(() => parseSkillOutput(input)).toThrow(SkillOutputParseError);
        expect(() => parseSkillOutput(input)).toThrow('missing required field: status');
      });

      it('throws SkillOutputParseError for invalid status value', () => {
        const input = JSON.stringify({
          status: 'INVALID_STATUS',
          timestamp: '2024-01-15T14:30:00Z',
        });
        expect(() => parseSkillOutput(input)).toThrow(SkillOutputParseError);
        expect(() => parseSkillOutput(input)).toThrow('Invalid status value');
      });

      it('throws SkillOutputParseError for missing timestamp', () => {
        const input = JSON.stringify({ status: 'PASS' });
        expect(() => parseSkillOutput(input)).toThrow(SkillOutputParseError);
        expect(() => parseSkillOutput(input)).toThrow('missing required field: timestamp');
      });

      it('throws SkillOutputParseError for missing status-specific fields', () => {
        const input = JSON.stringify({
          status: 'SUBTASK_COMPLETE',
          timestamp: '2024-01-15T14:30:00Z',
          // Missing: subtaskId, commitHash, filesModified, verificationResults
        });
        expect(() => parseSkillOutput(input)).toThrow(SkillOutputParseError);
        expect(() => parseSkillOutput(input)).toThrow('requires subtaskId');
      });

      it('includes raw output in error for debugging', () => {
        const badInput = 'invalid input';
        try {
          parseSkillOutput(badInput);
          expect(true).toBe(false); // Should not reach here
        } catch (error) {
          expect(error).toBeInstanceOf(SkillOutputParseError);
          expect((error as SkillOutputParseError).rawOutput).toBe(badInput);
        }
      });

      it('throws descriptive error for FAIL missing reason', () => {
        const input = JSON.stringify({
          status: 'FAIL',
          timestamp: '2024-01-15T14:30:00Z',
          // Missing: reason
        });
        expect(() => parseSkillOutput(input)).toThrow('FAIL requires reason');
      });
    });
  });

  describe('extractStatus', () => {
    it('extracts status from valid JSON', () => {
      const input = JSON.stringify({
        status: 'SUBTASK_COMPLETE',
        timestamp: '2024-01-15T14:30:00Z',
        subtaskId: 'MOB-125',
        commitHash: 'abc123',
        filesModified: [],
        verificationResults: {},
      });
      expect(extractStatus(input)).toBe('SUBTASK_COMPLETE');
    });

    it('extracts status from valid YAML', () => {
      const input = `status: ALL_COMPLETE
timestamp: "2024-01-15T14:30:00Z"
parentId: MOB-100
completedCount: 5`;
      expect(extractStatus(input)).toBe('ALL_COMPLETE');
    });

    it('returns null for empty input', () => {
      expect(extractStatus('')).toBeNull();
    });

    it('returns null for invalid input', () => {
      expect(extractStatus('not valid json or yaml {')).toBeNull();
    });

    it('returns null for missing status', () => {
      expect(extractStatus('{"timestamp": "2024-01-15T14:30:00Z"}')).toBeNull();
    });

    it('returns null for invalid status value', () => {
      expect(extractStatus('{"status": "INVALID"}')).toBeNull();
    });
  });

  describe('isTerminalStatus', () => {
    it('returns true for terminal statuses', () => {
      expect(isTerminalStatus('SUBTASK_COMPLETE')).toBe(true);
      expect(isTerminalStatus('ALL_COMPLETE')).toBe(true);
      expect(isTerminalStatus('ALL_BLOCKED')).toBe(true);
      expect(isTerminalStatus('NO_SUBTASKS')).toBe(true);
      expect(isTerminalStatus('VERIFICATION_FAILED')).toBe(true);
      expect(isTerminalStatus('PASS')).toBe(true);
      expect(isTerminalStatus('FAIL')).toBe(true);
    });

    it('returns false for non-terminal statuses', () => {
      expect(isTerminalStatus('SUBTASK_PARTIAL')).toBe(false);
      expect(isTerminalStatus('NEEDS_WORK')).toBe(false);
    });
  });

  describe('isSuccessStatus', () => {
    it('returns true for success statuses', () => {
      expect(isSuccessStatus('SUBTASK_COMPLETE')).toBe(true);
      expect(isSuccessStatus('ALL_COMPLETE')).toBe(true);
      expect(isSuccessStatus('PASS')).toBe(true);
    });

    it('returns false for non-success statuses', () => {
      expect(isSuccessStatus('SUBTASK_PARTIAL')).toBe(false);
      expect(isSuccessStatus('ALL_BLOCKED')).toBe(false);
      expect(isSuccessStatus('NO_SUBTASKS')).toBe(false);
      expect(isSuccessStatus('VERIFICATION_FAILED')).toBe(false);
      expect(isSuccessStatus('NEEDS_WORK')).toBe(false);
      expect(isSuccessStatus('FAIL')).toBe(false);
    });
  });

  describe('isFailureStatus', () => {
    it('returns true for failure statuses', () => {
      expect(isFailureStatus('VERIFICATION_FAILED')).toBe(true);
      expect(isFailureStatus('FAIL')).toBe(true);
    });

    it('returns false for non-failure statuses', () => {
      expect(isFailureStatus('SUBTASK_COMPLETE')).toBe(false);
      expect(isFailureStatus('SUBTASK_PARTIAL')).toBe(false);
      expect(isFailureStatus('ALL_COMPLETE')).toBe(false);
      expect(isFailureStatus('ALL_BLOCKED')).toBe(false);
      expect(isFailureStatus('NO_SUBTASKS')).toBe(false);
      expect(isFailureStatus('NEEDS_WORK')).toBe(false);
      expect(isFailureStatus('PASS')).toBe(false);
    });
  });
});
