/**
 * Unit tests for tmux-display.ts
 *
 * Tests verify:
 * 1. Session naming includes task ID (mobius-${taskId})
 * 2. Pane creation commands are correct
 * 3. Status file path generation
 * 4. Pane title formatting
 *
 * Uses mocked shell execution - no actual tmux sessions created.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import type { SubTask } from './task-graph.js';
import type { TmuxSession, TmuxPane } from './tmux-display.js';

// Track execa calls for verification
let execaCalls: Array<{ command: string; args: string[] }> = [];
let execaResponses: Map<string, string> = new Map();

// Mock the execa module before importing tmux-display
mock.module('execa', () => ({
  execa: async (command: string, args: string[]): Promise<{ stdout: string }> => {
    execaCalls.push({ command, args });

    const key = `${command}:${args.join(',')}`;
    if (execaResponses.has(key)) {
      return { stdout: execaResponses.get(key)! };
    }

    // Default responses based on command patterns
    if (command === 'tmux') {
      const subCmd = args[0];

      switch (subCmd) {
        case 'has-session':
          // Default: session doesn't exist (throw to simulate)
          throw new Error('session not found');

        case 'new-session':
          return { stdout: '' };

        case 'display-message':
          return { stdout: '$1:%0' };

        case 'split-window':
          return { stdout: '%1' };

        case 'select-pane':
        case 'send-keys':
        case 'kill-session':
        case 'kill-pane':
        case 'select-layout':
          return { stdout: '' };

        case 'list-panes':
          return { stdout: '%0\n%1\n%2' };

        case 'capture-pane':
          return { stdout: 'line 1\nline 2\nline 3' };

        default:
          return { stdout: '' };
      }
    }

    if (command === 'touch') {
      return { stdout: '' };
    }

    return { stdout: '' };
  },
}));

// Import after mocking
const tmuxDisplay = await import('./tmux-display.js');

// Store the original env
const originalEnv = { ...process.env };

describe('tmux-display', () => {
  beforeEach(() => {
    // Reset state
    execaCalls = [];
    execaResponses = new Map();
    process.env = { ...originalEnv };
    delete process.env.TMUX;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getSessionName', () => {
    it('generates correct session name format with task ID', () => {
      expect(tmuxDisplay.getSessionName('MOB-123')).toBe('mobius-MOB-123');
    });

    it('handles different task ID formats', () => {
      expect(tmuxDisplay.getSessionName('PROJ-456')).toBe('mobius-PROJ-456');
      expect(tmuxDisplay.getSessionName('TEST-1')).toBe('mobius-TEST-1');
      expect(tmuxDisplay.getSessionName('ABC-99999')).toBe('mobius-ABC-99999');
    });

    it('includes full task ID in session name', () => {
      const taskId = 'MOB-73';
      const sessionName = tmuxDisplay.getSessionName(taskId);

      expect(sessionName).toContain(taskId);
      expect(sessionName).toMatch(/^mobius-/);
    });

    it('uses mobius- prefix for session isolation', () => {
      const sessionName = tmuxDisplay.getSessionName('TASK-1');
      expect(sessionName.startsWith('mobius-')).toBe(true);
    });
  });

  describe('getStatusFilePath', () => {
    it('generates status file path in /tmp', () => {
      const path = tmuxDisplay.getStatusFilePath('mobius-MOB-123');
      expect(path).toBe('/tmp/mobius-status-mobius-MOB-123.txt');
    });

    it('includes session name in file path', () => {
      const sessionName = 'mobius-PROJ-456';
      const path = tmuxDisplay.getStatusFilePath(sessionName);

      expect(path).toContain(sessionName);
      expect(path).toMatch(/^\/tmp\//);
      expect(path).toMatch(/\.txt$/);
    });

    it('generates unique paths for different sessions', () => {
      const path1 = tmuxDisplay.getStatusFilePath('mobius-MOB-1');
      const path2 = tmuxDisplay.getStatusFilePath('mobius-MOB-2');

      expect(path1).not.toBe(path2);
    });

    it('uses mobius-status- prefix for status file naming', () => {
      const path = tmuxDisplay.getStatusFilePath('my-session');
      expect(path).toBe('/tmp/mobius-status-my-session.txt');
    });
  });

  describe('isInsideTmux', () => {
    it('returns false when TMUX env is not set', () => {
      delete process.env.TMUX;
      expect(tmuxDisplay.isInsideTmux()).toBe(false);
    });

    it('returns true when TMUX env is set', () => {
      process.env.TMUX = '/tmp/tmux-1000/default,12345,0';
      expect(tmuxDisplay.isInsideTmux()).toBe(true);
    });

    it('returns true for any non-empty TMUX value', () => {
      process.env.TMUX = 'some-value';
      expect(tmuxDisplay.isInsideTmux()).toBe(true);
    });

    it('returns false for empty string TMUX value', () => {
      process.env.TMUX = '';
      expect(tmuxDisplay.isInsideTmux()).toBe(false);
    });
  });

  describe('sessionExists', () => {
    it('returns false when session does not exist', async () => {
      const exists = await tmuxDisplay.sessionExists('nonexistent-session');
      expect(exists).toBe(false);
    });

    it('calls tmux has-session with correct session name', async () => {
      await tmuxDisplay.sessionExists('my-session');

      const hasSessionCall = execaCalls.find(
        c => c.command === 'tmux' && c.args[0] === 'has-session'
      );
      expect(hasSessionCall).toBeDefined();
      expect(hasSessionCall?.args).toContain('my-session');
      expect(hasSessionCall?.args).toContain('-t');
    });
  });

  describe('createSession', () => {
    it('creates session with correct name format', async () => {
      const sessionName = 'mobius-MOB-123';
      const session = await tmuxDisplay.createSession(sessionName);

      expect(session.name).toBe(sessionName);
    });

    it('returns session object with id and initialPaneId', async () => {
      execaResponses.set('tmux:display-message,-t,mobius-MOB-456,-p,#{session_id}:#{pane_id}', '$5:%10');

      const session = await tmuxDisplay.createSession('mobius-MOB-456');

      expect(session.id).toBe('$5');
      expect(session.initialPaneId).toBe('%10');
    });

    it('calls tmux new-session with detached flag and session name', async () => {
      await tmuxDisplay.createSession('mobius-MOB-789');

      const newSessionCall = execaCalls.find(
        c => c.command === 'tmux' && c.args[0] === 'new-session'
      );
      expect(newSessionCall).toBeDefined();
      expect(newSessionCall?.args).toContain('-d');
      expect(newSessionCall?.args).toContain('-s');
      expect(newSessionCall?.args).toContain('mobius-MOB-789');
    });

    it('retrieves session and pane IDs after creation', async () => {
      await tmuxDisplay.createSession('mobius-TEST');

      const displayMsgCall = execaCalls.find(
        c => c.command === 'tmux' && c.args[0] === 'display-message'
      );
      expect(displayMsgCall).toBeDefined();
      expect(displayMsgCall?.args).toContain('#{session_id}:#{pane_id}');
    });
  });

  describe('createAgentPane', () => {
    const mockSession: TmuxSession = {
      name: 'mobius-MOB-100',
      id: '$1',
      initialPaneId: '%0',
    };

    const mockTask: SubTask = {
      id: 'task-uuid-123',
      identifier: 'MOB-124',
      title: 'Implement feature X',
      status: 'ready',
      blockedBy: [],
      blocks: [],
      gitBranchName: 'feature/mob-124',
    };

    it('produces correct pane creation command with horizontal split', async () => {
      await tmuxDisplay.createAgentPane(mockSession, mockTask);

      const splitCall = execaCalls.find(
        c => c.command === 'tmux' && c.args[0] === 'split-window'
      );
      expect(splitCall).toBeDefined();
      expect(splitCall?.args).toContain('-h'); // horizontal split
      expect(splitCall?.args).toContain('-P'); // print pane info
      expect(splitCall?.args).toContain('#{pane_id}');
    });

    it('returns pane with correct taskId', async () => {
      const pane = await tmuxDisplay.createAgentPane(mockSession, mockTask);

      expect(pane.taskId).toBe(mockTask.id);
      expect(pane.type).toBe('agent');
    });

    it('sets pane title with task identifier and title', async () => {
      await tmuxDisplay.createAgentPane(mockSession, mockTask);

      const selectPaneCall = execaCalls.find(
        c => c.command === 'tmux' && c.args[0] === 'select-pane' && c.args.includes('-T')
      );
      expect(selectPaneCall).toBeDefined();
      expect(selectPaneCall?.args).toContain('MOB-124: Implement feature X');
    });

    it('uses sourcePaneId when provided', async () => {
      await tmuxDisplay.createAgentPane(mockSession, mockTask, '%3');

      const splitCall = execaCalls.find(
        c => c.command === 'tmux' && c.args[0] === 'split-window'
      );
      expect(splitCall?.args).toContain('%3');
    });

    it('defaults to initialPaneId when sourcePaneId not provided', async () => {
      await tmuxDisplay.createAgentPane(mockSession, mockTask);

      const splitCall = execaCalls.find(
        c => c.command === 'tmux' && c.args[0] === 'split-window'
      );
      expect(splitCall?.args).toContain('%0'); // initialPaneId
    });

    it('targets correct pane in split command', async () => {
      await tmuxDisplay.createAgentPane(mockSession, mockTask);

      const splitCall = execaCalls.find(
        c => c.command === 'tmux' && c.args[0] === 'split-window'
      );
      expect(splitCall?.args).toContain('-t');
    });
  });

  describe('createStatusPane', () => {
    const mockSession: TmuxSession = {
      name: 'mobius-MOB-200',
      id: '$2',
      initialPaneId: '%0',
    };

    it('creates status file at correct path', async () => {
      await tmuxDisplay.createStatusPane(mockSession);

      const touchCall = execaCalls.find(c => c.command === 'touch');
      expect(touchCall).toBeDefined();
      expect(touchCall?.args).toContain('/tmp/mobius-status-mobius-MOB-200.txt');
    });

    it('creates vertical split with 15% height', async () => {
      await tmuxDisplay.createStatusPane(mockSession);

      const splitCall = execaCalls.find(
        c => c.command === 'tmux' && c.args[0] === 'split-window'
      );
      expect(splitCall).toBeDefined();
      expect(splitCall?.args).toContain('-v'); // vertical split
      expect(splitCall?.args).toContain('-l');
      expect(splitCall?.args).toContain('15%');
    });

    it('sets pane title to Status', async () => {
      await tmuxDisplay.createStatusPane(mockSession);

      const selectPaneCall = execaCalls.find(
        c => c.command === 'tmux' && c.args[0] === 'select-pane' && c.args.includes('Status')
      );
      expect(selectPaneCall).toBeDefined();
    });

    it('starts watch command to display status file', async () => {
      await tmuxDisplay.createStatusPane(mockSession);

      const sendKeysCall = execaCalls.find(
        c =>
          c.command === 'tmux' &&
          c.args[0] === 'send-keys' &&
          c.args.some(a => a.includes('watch'))
      );
      expect(sendKeysCall).toBeDefined();
      expect(sendKeysCall?.args.some(a => a.includes('/tmp/mobius-status-mobius-MOB-200.txt'))).toBe(
        true
      );
    });

    it('returns pane with type status', async () => {
      const pane = await tmuxDisplay.createStatusPane(mockSession);

      expect(pane.type).toBe('status');
      expect(pane.taskId).toBeUndefined();
    });
  });

  describe('setPaneTitle', () => {
    const mockPane: TmuxPane = {
      id: '%5',
      sessionId: '$1',
      taskId: 'task-123',
      type: 'agent',
    };

    it('formats title correctly with task identifier', async () => {
      await tmuxDisplay.setPaneTitle(mockPane, 'MOB-125: New title');

      const selectPaneCall = execaCalls.find(c => c.command === 'tmux' && c.args[0] === 'select-pane');
      expect(selectPaneCall).toBeDefined();
      expect(selectPaneCall?.args).toContain('-t');
      expect(selectPaneCall?.args).toContain('%5');
      expect(selectPaneCall?.args).toContain('-T');
      expect(selectPaneCall?.args).toContain('MOB-125: New title');
    });

    it('handles title with special characters', async () => {
      await tmuxDisplay.setPaneTitle(mockPane, 'Task: Fix "issue" & cleanup');

      const selectPaneCall = execaCalls.find(c => c.command === 'tmux' && c.args[0] === 'select-pane');
      expect(selectPaneCall?.args).toContain('Task: Fix "issue" & cleanup');
    });

    it('uses correct pane ID from pane object', async () => {
      const customPane: TmuxPane = { ...mockPane, id: '%99' };
      await tmuxDisplay.setPaneTitle(customPane, 'Test');

      const selectPaneCall = execaCalls.find(c => c.command === 'tmux' && c.args[0] === 'select-pane');
      expect(selectPaneCall?.args).toContain('%99');
    });
  });

  describe('capturePaneContent', () => {
    const mockPane: TmuxPane = {
      id: '%3',
      sessionId: '$1',
      type: 'agent',
    };

    it('returns expected content from pane', async () => {
      const content = await tmuxDisplay.capturePaneContent(mockPane);

      expect(content).toBe('line 1\nline 2\nline 3');
    });

    it('uses default line count of 100', async () => {
      await tmuxDisplay.capturePaneContent(mockPane);

      const captureCall = execaCalls.find(c => c.command === 'tmux' && c.args[0] === 'capture-pane');
      expect(captureCall).toBeDefined();
      expect(captureCall?.args).toContain('-S');
      expect(captureCall?.args).toContain('-100');
    });

    it('respects custom line count parameter', async () => {
      await tmuxDisplay.capturePaneContent(mockPane, 50);

      const captureCall = execaCalls.find(c => c.command === 'tmux' && c.args[0] === 'capture-pane');
      expect(captureCall?.args).toContain('-50');
    });

    it('targets correct pane ID', async () => {
      await tmuxDisplay.capturePaneContent(mockPane);

      const captureCall = execaCalls.find(c => c.command === 'tmux' && c.args[0] === 'capture-pane');
      expect(captureCall?.args).toContain('-t');
      expect(captureCall?.args).toContain('%3');
    });
  });

  describe('runInPane', () => {
    const mockPane: TmuxPane = {
      id: '%7',
      sessionId: '$2',
      type: 'agent',
    };

    it('sends command with Enter to pane', async () => {
      await tmuxDisplay.runInPane(mockPane, 'claude execute MOB-123');

      const sendKeysCall = execaCalls.find(c => c.command === 'tmux' && c.args[0] === 'send-keys');
      expect(sendKeysCall).toBeDefined();
      expect(sendKeysCall?.args).toContain('%7');
      expect(sendKeysCall?.args).toContain('claude execute MOB-123');
      expect(sendKeysCall?.args).toContain('Enter');
    });

    it('uses correct pane ID', async () => {
      const customPane: TmuxPane = { ...mockPane, id: '%42' };
      await tmuxDisplay.runInPane(customPane, 'ls -la');

      const sendKeysCall = execaCalls.find(c => c.command === 'tmux' && c.args[0] === 'send-keys');
      expect(sendKeysCall?.args).toContain('%42');
    });
  });

  describe('killPane', () => {
    it('calls tmux kill-pane with correct pane ID', async () => {
      const pane: TmuxPane = { id: '%8', sessionId: '$1', type: 'agent' };

      await tmuxDisplay.killPane(pane);

      const killCall = execaCalls.find(c => c.command === 'tmux' && c.args[0] === 'kill-pane');
      expect(killCall).toBeDefined();
      expect(killCall?.args).toContain('-t');
      expect(killCall?.args).toContain('%8');
    });
  });

  describe('listPanes', () => {
    it('returns array of pane IDs', async () => {
      const session: TmuxSession = { name: 'test', id: '$1', initialPaneId: '%0' };
      const panes = await tmuxDisplay.listPanes(session);

      expect(panes).toEqual(['%0', '%1', '%2']);
    });

    it('calls tmux list-panes with correct format', async () => {
      const session: TmuxSession = { name: 'test-session', id: '$1', initialPaneId: '%0' };
      await tmuxDisplay.listPanes(session);

      const listCall = execaCalls.find(c => c.command === 'tmux' && c.args[0] === 'list-panes');
      expect(listCall).toBeDefined();
      expect(listCall?.args).toContain('-t');
      expect(listCall?.args).toContain('test-session');
      expect(listCall?.args).toContain('-F');
      expect(listCall?.args).toContain('#{pane_id}');
    });
  });

  describe('destroySession', () => {
    it('kills session with correct name', async () => {
      const session: TmuxSession = { name: 'mobius-MOB-999', id: '$9', initialPaneId: '%0' };

      await tmuxDisplay.destroySession(session);

      const killCall = execaCalls.find(c => c.command === 'tmux' && c.args[0] === 'kill-session');
      expect(killCall).toBeDefined();
      expect(killCall?.args).toContain('-t');
      expect(killCall?.args).toContain('mobius-MOB-999');
    });
  });

  describe('layoutPanes', () => {
    const mockSession: TmuxSession = { name: 'test-session', id: '$1', initialPaneId: '%0' };

    it('does not call select-layout for single pane', async () => {
      await tmuxDisplay.layoutPanes(mockSession, 1);

      const layoutCall = execaCalls.find(c => c.command === 'tmux' && c.args[0] === 'select-layout');
      expect(layoutCall).toBeUndefined();
    });

    it('uses even-horizontal layout for 2 panes', async () => {
      await tmuxDisplay.layoutPanes(mockSession, 2);

      const layoutCall = execaCalls.find(c => c.command === 'tmux' && c.args[0] === 'select-layout');
      expect(layoutCall).toBeDefined();
      expect(layoutCall?.args).toContain('even-horizontal');
    });

    it('uses tiled layout for 3 panes', async () => {
      await tmuxDisplay.layoutPanes(mockSession, 3);

      const layoutCall = execaCalls.find(c => c.command === 'tmux' && c.args[0] === 'select-layout');
      expect(layoutCall?.args).toContain('tiled');
    });

    it('uses tiled layout for 4+ panes', async () => {
      await tmuxDisplay.layoutPanes(mockSession, 5);

      const layoutCall = execaCalls.find(c => c.command === 'tmux' && c.args[0] === 'select-layout');
      expect(layoutCall?.args).toContain('tiled');
    });
  });

  describe('integration: session naming with task ID', () => {
    it('full workflow uses task ID consistently', async () => {
      const taskId = 'MOB-555';
      const sessionName = tmuxDisplay.getSessionName(taskId);
      const statusPath = tmuxDisplay.getStatusFilePath(sessionName);

      // Verify naming conventions
      expect(sessionName).toBe('mobius-MOB-555');
      expect(statusPath).toContain('MOB-555');

      // Create session and verify name is used
      const session = await tmuxDisplay.createSession(sessionName);
      expect(session.name).toBe(sessionName);

      // Verify tmux commands used the session name
      const newSessionCall = execaCalls.find(
        c => c.command === 'tmux' && c.args[0] === 'new-session'
      );
      expect(newSessionCall?.args).toContain(sessionName);
    });

    it('different tasks get isolated session names', () => {
      const session1 = tmuxDisplay.getSessionName('MOB-A');
      const session2 = tmuxDisplay.getSessionName('MOB-B');

      expect(session1).not.toBe(session2);
      expect(session1).toBe('mobius-MOB-A');
      expect(session2).toBe('mobius-MOB-B');
    });

    it('different tasks get isolated status file paths', () => {
      const path1 = tmuxDisplay.getStatusFilePath(tmuxDisplay.getSessionName('MOB-A'));
      const path2 = tmuxDisplay.getStatusFilePath(tmuxDisplay.getSessionName('MOB-B'));

      expect(path1).not.toBe(path2);
    });
  });
});
