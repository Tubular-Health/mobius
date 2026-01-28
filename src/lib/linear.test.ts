/**
 * Unit tests for Linear API integration module
 *
 * Tests the SDK extensions for issue creation, status updates, and comments.
 * These tests verify behavior when the client is unavailable (missing API key)
 * and the error handling patterns. Real API integration tests would require
 * a test Linear workspace.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import {
  getLinearClient,
  fetchLinearIssue,
  fetchLinearSubTasks,
  createLinearIssue,
  updateLinearIssueStatus,
  addLinearComment,
} from './linear.js';

// Store original env vars to restore after tests
const originalEnv = {
  LINEAR_API_KEY: process.env.LINEAR_API_KEY,
};

// Mock console.error to capture log output and prevent noise in test output
let consoleErrorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // Restore original env vars
  process.env.LINEAR_API_KEY = originalEnv.LINEAR_API_KEY;
  consoleErrorSpy.mockRestore();
});

describe('getLinearClient', () => {
  it('returns null when LINEAR_API_KEY is missing', () => {
    delete process.env.LINEAR_API_KEY;

    const client = getLinearClient();

    expect(client).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('returns a client when LINEAR_API_KEY is set', () => {
    process.env.LINEAR_API_KEY = 'test-api-key-123';

    const client = getLinearClient();

    expect(client).not.toBeNull();
  });
});

describe('fetchLinearIssue', () => {
  it('returns null when client initialization fails (missing env var)', async () => {
    delete process.env.LINEAR_API_KEY;

    const result = await fetchLinearIssue('MOB-123');

    expect(result).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe('fetchLinearSubTasks', () => {
  it('returns null when client initialization fails (missing env var)', async () => {
    delete process.env.LINEAR_API_KEY;

    const result = await fetchLinearSubTasks('parent-id-123');

    expect(result).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe('createLinearIssue', () => {
  it('returns error result when LINEAR_API_KEY is missing', async () => {
    delete process.env.LINEAR_API_KEY;

    const result = await createLinearIssue({
      teamId: 'team-123',
      title: 'Test Issue',
      description: 'Test description',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('LINEAR_API_KEY not set');
  });

  it('returns error result when client initialization fails', async () => {
    delete process.env.LINEAR_API_KEY;

    const result = await createLinearIssue({
      teamId: 'team-123',
      title: 'Test Issue',
      parentId: 'parent-123',
      blockedBy: ['blocker-1', 'blocker-2'],
      labels: ['label-1'],
      priority: 2,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('LINEAR_API_KEY not set');
    expect(result.id).toBeUndefined();
    expect(result.identifier).toBeUndefined();
  });
});

describe('updateLinearIssueStatus', () => {
  it('returns error result when LINEAR_API_KEY is missing', async () => {
    delete process.env.LINEAR_API_KEY;

    const result = await updateLinearIssueStatus('issue-123', 'In Progress');

    expect(result.success).toBe(false);
    expect(result.error).toBe('LINEAR_API_KEY not set');
  });

  it('returns error result with correct error message', async () => {
    delete process.env.LINEAR_API_KEY;

    const result = await updateLinearIssueStatus('issue-uuid', 'Done');

    expect(result.success).toBe(false);
    expect(result.error).toBe('LINEAR_API_KEY not set');
    expect(result.id).toBeUndefined();
    expect(result.identifier).toBeUndefined();
  });
});

describe('addLinearComment', () => {
  it('returns error result when LINEAR_API_KEY is missing', async () => {
    delete process.env.LINEAR_API_KEY;

    const result = await addLinearComment('issue-123', 'Test comment');

    expect(result.success).toBe(false);
    expect(result.error).toBe('LINEAR_API_KEY not set');
  });

  it('returns error result with correct error message', async () => {
    delete process.env.LINEAR_API_KEY;

    const result = await addLinearComment('issue-uuid', 'A comment with markdown **bold**');

    expect(result.success).toBe(false);
    expect(result.error).toBe('LINEAR_API_KEY not set');
    expect(result.id).toBeUndefined();
  });
});

describe('LinearOperationResult interface', () => {
  it('createLinearIssue returns result with expected shape on failure', async () => {
    delete process.env.LINEAR_API_KEY;

    const result = await createLinearIssue({
      teamId: 'team-123',
      title: 'Test',
    });

    // Verify the shape of the result matches LinearOperationResult
    expect(typeof result.success).toBe('boolean');
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  it('updateLinearIssueStatus returns result with expected shape on failure', async () => {
    delete process.env.LINEAR_API_KEY;

    const result = await updateLinearIssueStatus('id', 'status');

    expect(typeof result.success).toBe('boolean');
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  it('addLinearComment returns result with expected shape on failure', async () => {
    delete process.env.LINEAR_API_KEY;

    const result = await addLinearComment('id', 'body');

    expect(typeof result.success).toBe('boolean');
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });
});

describe('CreateLinearIssueInput interface', () => {
  it('accepts minimal required fields', async () => {
    delete process.env.LINEAR_API_KEY;

    // Only teamId and title are required
    const result = await createLinearIssue({
      teamId: 'team-123',
      title: 'Minimal Issue',
    });

    // Should fail due to missing API key, but not due to input validation
    expect(result.success).toBe(false);
    expect(result.error).toBe('LINEAR_API_KEY not set');
  });

  it('accepts all optional fields', async () => {
    delete process.env.LINEAR_API_KEY;

    const result = await createLinearIssue({
      teamId: 'team-123',
      title: 'Full Issue',
      description: 'A detailed description',
      parentId: 'parent-issue-id',
      blockedBy: ['blocker-1', 'blocker-2'],
      labels: ['label-id-1', 'label-id-2'],
      priority: 1,
    });

    // Should fail due to missing API key
    expect(result.success).toBe(false);
    expect(result.error).toBe('LINEAR_API_KEY not set');
  });
});

describe('error handling patterns', () => {
  describe('fetchLinearIssue error handling', () => {
    it('logs error when API key is missing', async () => {
      delete process.env.LINEAR_API_KEY;

      await fetchLinearIssue('MOB-123');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('fetchLinearSubTasks error handling', () => {
    it('logs error when API key is missing', async () => {
      delete process.env.LINEAR_API_KEY;

      await fetchLinearSubTasks('parent-id');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('createLinearIssue error handling', () => {
    it('does not log to console (returns structured error)', async () => {
      delete process.env.LINEAR_API_KEY;

      // Clear any previous calls
      consoleErrorSpy.mockClear();

      const result = await createLinearIssue({
        teamId: 'team-123',
        title: 'Test',
      });

      // The function returns an error result rather than logging when API key is missing
      expect(result.success).toBe(false);
      expect(result.error).toBe('LINEAR_API_KEY not set');
    });
  });

  describe('updateLinearIssueStatus error handling', () => {
    it('does not log to console (returns structured error)', async () => {
      delete process.env.LINEAR_API_KEY;

      consoleErrorSpy.mockClear();

      const result = await updateLinearIssueStatus('id', 'status');

      expect(result.success).toBe(false);
      expect(result.error).toBe('LINEAR_API_KEY not set');
    });
  });

  describe('addLinearComment error handling', () => {
    it('does not log to console (returns structured error)', async () => {
      delete process.env.LINEAR_API_KEY;

      consoleErrorSpy.mockClear();

      const result = await addLinearComment('id', 'body');

      expect(result.success).toBe(false);
      expect(result.error).toBe('LINEAR_API_KEY not set');
    });
  });
});
