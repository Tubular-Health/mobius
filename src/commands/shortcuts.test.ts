/**
 * Tests for the shortcuts command
 *
 * Verifies that `mobius shortcuts` installs shortcut scripts and
 * configures shell rc files independently of `mobius setup`.
 */

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let testDir: string;

// Mock @inquirer/prompts
const confirmMock = mock(() => Promise.resolve(true));
mock.module('@inquirer/prompts', () => ({
  confirm: confirmMock,
}));

// Mock node:os to control homedir() — bun caches the real value
mock.module('node:os', () => ({
  homedir: () => testDir,
  tmpdir,
}));

describe('shortcuts command', () => {
  let originalXdgConfigHome: string | undefined;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleOutput: string[];

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `mobius-shortcuts-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });

    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

    // Point XDG_CONFIG_HOME to test dir so copyShortcuts installs there
    process.env.XDG_CONFIG_HOME = join(testDir, '.config');

    consoleOutput = [];
    consoleLogSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });

    // Default: user confirms
    confirmMock.mockImplementation(() => Promise.resolve(true));
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();

    if (originalXdgConfigHome !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('copies shortcuts script to install location', async () => {
    writeFileSync(join(testDir, '.zshrc'), '');

    const { shortcuts } = await import('./shortcuts.js');
    await shortcuts();

    const installPath = join(testDir, '.config', 'mobius', 'shortcuts.sh');
    expect(existsSync(installPath)).toBe(true);

    const content = readFileSync(installPath, 'utf-8');
    expect(content).toContain('task()');
    expect(content).toContain('md()');
  });

  it('adds source line to .zshrc when user confirms', async () => {
    const zshrcPath = join(testDir, '.zshrc');
    writeFileSync(zshrcPath, '# existing content\n');

    confirmMock.mockImplementation(() => Promise.resolve(true));

    const { shortcuts } = await import('./shortcuts.js');
    await shortcuts();

    const content = readFileSync(zshrcPath, 'utf-8');
    expect(content).toContain('source "');
    expect(content).toContain('shortcuts.sh"');
  });

  it('falls back to .bashrc when no .zshrc exists', async () => {
    const bashrcPath = join(testDir, '.bashrc');
    writeFileSync(bashrcPath, '# bash config\n');
    // Do NOT create .zshrc

    confirmMock.mockImplementation(() => Promise.resolve(true));

    const { shortcuts } = await import('./shortcuts.js');
    await shortcuts();

    const content = readFileSync(bashrcPath, 'utf-8');
    expect(content).toContain('source "');
    expect(content).toContain('shortcuts.sh"');
  });

  it('is idempotent (no duplicate source lines)', async () => {
    const zshrcPath = join(testDir, '.zshrc');
    writeFileSync(zshrcPath, '');

    confirmMock.mockImplementation(() => Promise.resolve(true));

    const { shortcuts } = await import('./shortcuts.js');
    await shortcuts();
    await shortcuts();

    const content = readFileSync(zshrcPath, 'utf-8');
    const matches = content.match(/source "/g);
    expect(matches?.length).toBe(1);
  });

  it('shows manual instructions when user declines', async () => {
    writeFileSync(join(testDir, '.zshrc'), '');

    confirmMock.mockImplementation(() => Promise.resolve(false));

    const { shortcuts } = await import('./shortcuts.js');
    await shortcuts();

    const output = consoleOutput.join('\n');
    expect(output).toContain('To enable shortcuts later');
    expect(output).toContain('source "');
  });

  it('shows manual instructions when no rc file found', async () => {
    // No .zshrc or .bashrc in testDir
    confirmMock.mockImplementation(() => Promise.resolve(true));

    const { shortcuts } = await import('./shortcuts.js');
    await shortcuts();

    const output = consoleOutput.join('\n');
    expect(output).toContain('No .zshrc or .bashrc found');
    expect(output).toContain('source "');
  });

  it('works without any config existing', async () => {
    // No mobius config anywhere, just a bare HOME with .zshrc
    writeFileSync(join(testDir, '.zshrc'), '');

    const { shortcuts } = await import('./shortcuts.js');

    // Should not throw
    await shortcuts();

    const output = consoleOutput.join('\n');
    expect(output).toContain('Shortcuts script installed');
    expect(output).toContain('Available shortcuts');
  });

  it('prints available shortcuts summary', async () => {
    writeFileSync(join(testDir, '.zshrc'), '');

    const { shortcuts } = await import('./shortcuts.js');
    await shortcuts();

    const output = consoleOutput.join('\n');
    expect(output).toContain('md');
    expect(output).toContain('mr');
    expect(output).toContain('me');
    expect(output).toContain('ms');
    expect(output).toContain('Define a new issue');
    expect(output).toContain('Refine');
    expect(output).toContain('Execute');
    expect(output).toContain('Submit');
  });
});
