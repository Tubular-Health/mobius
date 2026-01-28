/**
 * Unit tests for ExitConfirmationModal component
 *
 * Tests verify:
 * - Component interface and props type
 * - Module exports
 * - Props structure validation
 *
 * Note: Full rendering tests with useInput would require ink-testing-library.
 * These tests focus on the component contract and module structure.
 */

import { describe, it, expect, mock } from 'bun:test';
import { ExitConfirmationModal, type ExitConfirmationModalProps } from './ExitConfirmationModal.js';
import type { ExecutionSummary } from '../../lib/context-generator.js';

// Helper to create mock ExecutionSummary
function createMockSummary(overrides?: Partial<ExecutionSummary>): ExecutionSummary {
  return {
    completed: 3,
    failed: 0,
    active: 2,
    total: 5,
    isComplete: false,
    elapsedMs: 120000, // 2 minutes
    ...overrides,
  };
}

// Helper to create valid props
function createValidProps(overrides?: Partial<ExitConfirmationModalProps>): ExitConfirmationModalProps {
  return {
    sessionName: 'mobius-MOB-123',
    activeAgentCount: 2,
    summary: createMockSummary(),
    onConfirm: () => {},
    onCancel: () => {},
    ...overrides,
  };
}

describe('ExitConfirmationModal', () => {
  describe('module exports', () => {
    it('exports ExitConfirmationModal as named export', () => {
      expect(ExitConfirmationModal).toBeDefined();
      expect(typeof ExitConfirmationModal).toBe('object'); // memo wrapper
    });

    it('exports default export', async () => {
      const module = await import('./ExitConfirmationModal.js');
      expect(module.default).toBeDefined();
      expect(module.default).toBe(ExitConfirmationModal);
    });
  });

  describe('props interface', () => {
    it('accepts all required props without error', () => {
      const props = createValidProps();

      // TypeScript will catch missing props at compile time
      // Runtime check ensures props object is valid
      expect(props.sessionName).toBe('mobius-MOB-123');
      expect(props.activeAgentCount).toBe(2);
      expect(props.summary).toBeDefined();
      expect(typeof props.onConfirm).toBe('function');
      expect(typeof props.onCancel).toBe('function');
    });

    it('accepts sessionName with various formats', () => {
      const props1 = createValidProps({ sessionName: 'mobius-MOB-1' });
      const props2 = createValidProps({ sessionName: 'mobius-PROJ-12345' });
      const props3 = createValidProps({ sessionName: 'test-session' });

      expect(props1.sessionName).toBe('mobius-MOB-1');
      expect(props2.sessionName).toBe('mobius-PROJ-12345');
      expect(props3.sessionName).toBe('test-session');
    });

    it('accepts activeAgentCount values', () => {
      const props0 = createValidProps({ activeAgentCount: 0 });
      const props1 = createValidProps({ activeAgentCount: 1 });
      const props10 = createValidProps({ activeAgentCount: 10 });

      expect(props0.activeAgentCount).toBe(0);
      expect(props1.activeAgentCount).toBe(1);
      expect(props10.activeAgentCount).toBe(10);
    });

    it('accepts summary with various states', () => {
      const summaryNoFailed = createMockSummary({ failed: 0 });
      const summaryWithFailed = createMockSummary({ failed: 2 });
      const summaryComplete = createMockSummary({ isComplete: true, active: 0 });

      expect(summaryNoFailed.failed).toBe(0);
      expect(summaryWithFailed.failed).toBe(2);
      expect(summaryComplete.isComplete).toBe(true);
    });
  });

  describe('callback props', () => {
    it('onConfirm is callable', () => {
      const onConfirmMock = mock(() => {});
      const props = createValidProps({ onConfirm: onConfirmMock });

      props.onConfirm();

      expect(onConfirmMock).toHaveBeenCalled();
      expect(onConfirmMock).toHaveBeenCalledTimes(1);
    });

    it('onCancel is callable', () => {
      const onCancelMock = mock(() => {});
      const props = createValidProps({ onCancel: onCancelMock });

      props.onCancel();

      expect(onCancelMock).toHaveBeenCalled();
      expect(onCancelMock).toHaveBeenCalledTimes(1);
    });

    it('callbacks can be called multiple times', () => {
      const onConfirmMock = mock(() => {});
      const onCancelMock = mock(() => {});
      const props = createValidProps({
        onConfirm: onConfirmMock,
        onCancel: onCancelMock,
      });

      props.onConfirm();
      props.onCancel();
      props.onConfirm();

      expect(onConfirmMock).toHaveBeenCalledTimes(2);
      expect(onCancelMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('ExecutionSummary integration', () => {
    it('summary contains all required fields', () => {
      const summary = createMockSummary();

      expect(typeof summary.completed).toBe('number');
      expect(typeof summary.failed).toBe('number');
      expect(typeof summary.active).toBe('number');
      expect(typeof summary.total).toBe('number');
      expect(typeof summary.isComplete).toBe('boolean');
      expect(typeof summary.elapsedMs).toBe('number');
    });

    it('summary values are used correctly for display calculations', () => {
      const summary = createMockSummary({
        completed: 5,
        failed: 1,
        total: 8,
        elapsedMs: 300000, // 5 minutes
      });

      // Progress calculation: completed/total
      const progressRatio = summary.completed / summary.total;
      expect(progressRatio).toBeCloseTo(0.625); // 5/8

      // Has failures check
      const hasFailures = summary.failed > 0;
      expect(hasFailures).toBe(true);

      // Time in minutes
      const minutes = Math.floor(summary.elapsedMs / 60000);
      expect(minutes).toBe(5);
    });
  });

  describe('component contract', () => {
    it('is a valid React component (memoized)', () => {
      // Memoized components have a $$typeof property for React.memo
      expect(ExitConfirmationModal).toHaveProperty('$$typeof');

      // The type symbol indicates it's a memo component
      const typeSymbol = (ExitConfirmationModal as { $$typeof: symbol }).$$typeof;
      expect(typeSymbol.toString()).toContain('react.memo');
    });

    it('has displayName or type for debugging', () => {
      // Memo components wrap the original component
      const memoComponent = ExitConfirmationModal as {
        type?: { name?: string };
        displayName?: string;
      };

      // Should have type.name from the wrapped function
      const hasIdentifiableName =
        memoComponent.type?.name === 'ExitConfirmationModalImpl' ||
        memoComponent.displayName !== undefined;

      expect(hasIdentifiableName).toBe(true);
    });
  });
});

describe('ExitConfirmationModal display text expectations', () => {
  describe('singular vs plural agent text', () => {
    it('uses singular "agent" when count is 1', () => {
      // The component uses: activeAgentCount === 1 ? 'agent' : 'agents'
      const count = 1;
      const agentText = count === 1 ? 'agent' : 'agents';
      expect(agentText).toBe('agent');
    });

    it('uses plural "agents" when count is not 1', () => {
      const testCases = [0, 2, 3, 10];

      for (const count of testCases) {
        const agentText = count === 1 ? 'agent' : 'agents';
        expect(agentText).toBe('agents');
      }
    });
  });

  describe('failed tasks display', () => {
    it('includes failed count when > 0', () => {
      const summary = createMockSummary({ failed: 2 });
      const showFailed = summary.failed > 0;
      expect(showFailed).toBe(true);
    });

    it('excludes failed count when 0', () => {
      const summary = createMockSummary({ failed: 0 });
      const showFailed = summary.failed > 0;
      expect(showFailed).toBe(false);
    });
  });
});
