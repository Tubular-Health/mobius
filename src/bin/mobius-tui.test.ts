/**
 * Unit tests for mobius-tui module
 */

import { describe, expect, it } from 'bun:test';
import { validateTaskId } from './mobius-tui.js';

describe('validateTaskId', () => {
  describe('linear backend', () => {
    it('accepts valid Linear task IDs', () => {
      expect(validateTaskId('MOB-123', 'linear')).toBe(true);
      expect(validateTaskId('ABC-1', 'linear')).toBe(true);
      expect(validateTaskId('PROJ-9999', 'linear')).toBe(true);
    });

    it('rejects invalid Linear task IDs', () => {
      expect(validateTaskId('mob-123', 'linear')).toBe(false); // lowercase
      expect(validateTaskId('MOB123', 'linear')).toBe(false); // no dash
      expect(validateTaskId('MOB-', 'linear')).toBe(false); // no number
      expect(validateTaskId('-123', 'linear')).toBe(false); // no prefix
      expect(validateTaskId('MOB-abc', 'linear')).toBe(false); // letters instead of numbers
      expect(validateTaskId('', 'linear')).toBe(false); // empty
      expect(validateTaskId('MOB-123-456', 'linear')).toBe(false); // extra parts
    });
  });

  describe('jira backend', () => {
    it('accepts valid Jira task IDs', () => {
      expect(validateTaskId('PROJ-123', 'jira')).toBe(true);
      expect(validateTaskId('XYZ-1', 'jira')).toBe(true);
      expect(validateTaskId('MYPROJECT-9999', 'jira')).toBe(true);
    });

    it('rejects invalid Jira task IDs', () => {
      expect(validateTaskId('proj-123', 'jira')).toBe(false); // lowercase
      expect(validateTaskId('PROJ123', 'jira')).toBe(false); // no dash
      expect(validateTaskId('PROJ-', 'jira')).toBe(false); // no number
      expect(validateTaskId('-123', 'jira')).toBe(false); // no prefix
      expect(validateTaskId('PROJ-abc', 'jira')).toBe(false); // letters instead of numbers
      expect(validateTaskId('', 'jira')).toBe(false); // empty
      expect(validateTaskId('PROJ-123-456', 'jira')).toBe(false); // extra parts
    });
  });

  describe('both backends accept same format', () => {
    it('accepts PREFIX-NUMBER format for both backends', () => {
      const validIds = ['MOB-123', 'PROJ-456', 'ABC-1', 'XYZ-9999'];

      for (const id of validIds) {
        expect(validateTaskId(id, 'linear')).toBe(true);
        expect(validateTaskId(id, 'jira')).toBe(true);
      }
    });

    it('rejects invalid formats for both backends', () => {
      const invalidIds = ['lowercase-123', '123-MOB', 'MOB_123', 'MOB.123', 'just-text'];

      for (const id of invalidIds) {
        expect(validateTaskId(id, 'linear')).toBe(false);
        expect(validateTaskId(id, 'jira')).toBe(false);
      }
    });
  });
});
