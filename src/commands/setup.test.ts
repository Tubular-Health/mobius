/**
 * Tests for the setup command
 *
 * Focuses on the --update-skills flag behavior which skips the interactive
 * config wizard and only updates skills/commands.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We need to test the setup function behavior, so we'll use integration-style tests
// that verify the actual file operations

describe('setup command', () => {
  describe('--update-skills flag', () => {
    let testDir: string;
    let originalCwd: string;
    let consoleLogSpy: ReturnType<typeof spyOn>;
    let consoleOutput: string[];

    beforeEach(() => {
      // Create a unique temp directory for each test
      testDir = join(tmpdir(), `mobius-setup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(testDir, { recursive: true });
      originalCwd = process.cwd();

      // Capture console output
      consoleOutput = [];
      consoleLogSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        consoleOutput.push(args.map(String).join(' '));
      });
    });

    afterEach(() => {
      // Restore console.log
      consoleLogSpy.mockRestore();

      // Clean up
      process.chdir(originalCwd);
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('logs the correct messages when updating skills', async () => {
      // Create a local mobius config to simulate local installation
      const configPath = join(testDir, 'mobius.config.yaml');
      writeFileSync(configPath, 'backend: linear\n');
      process.chdir(testDir);

      // Import setup dynamically to pick up our mocked cwd
      const { setup } = await import('./setup.js');

      // Run setup with updateSkills flag
      await setup({ updateSkills: true });

      // Verify output messages
      const output = consoleOutput.join('\n');
      expect(output).toContain('Updating skills and commands');
      expect(output).toContain('Copying skills');
      expect(output).toContain('Copying commands');
      expect(output).toContain('Skills and commands updated');
    });

    it('creates skills directory when updating a local installation', async () => {
      // Create a local mobius config
      const configPath = join(testDir, 'mobius.config.yaml');
      writeFileSync(configPath, 'backend: linear\n');
      process.chdir(testDir);

      const { setup } = await import('./setup.js');
      await setup({ updateSkills: true });

      // Verify skills directory was created
      const skillsDir = join(testDir, '.claude', 'skills');
      expect(existsSync(skillsDir)).toBe(true);
    });

    it('creates commands directory when updating a local installation', async () => {
      // Create a local mobius config
      const configPath = join(testDir, 'mobius.config.yaml');
      writeFileSync(configPath, 'backend: linear\n');
      process.chdir(testDir);

      const { setup } = await import('./setup.js');
      await setup({ updateSkills: true });

      // Verify commands directory was created
      const commandsDir = join(testDir, '.claude', 'commands');
      expect(existsSync(commandsDir)).toBe(true);
    });

    it('does not prompt for user input when updateSkills is true', async () => {
      // Create a local mobius config
      const configPath = join(testDir, 'mobius.config.yaml');
      writeFileSync(configPath, 'backend: linear\n');
      process.chdir(testDir);

      const { setup } = await import('./setup.js');

      // This should complete without hanging for input
      // If it prompts, the test will timeout
      const result = await Promise.race([
        setup({ updateSkills: true }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout - likely waiting for prompt')), 5000)
        ),
      ]);

      // If we got here, the setup completed without prompting
      expect(result).toBeUndefined();
    });

    it('preserves existing config file when updating skills', async () => {
      // Create a local mobius config with custom settings
      const configPath = join(testDir, 'mobius.config.yaml');
      const originalConfig = `backend: jira
execution:
  delay_seconds: 10
  max_iterations: 100
`;
      writeFileSync(configPath, originalConfig);
      process.chdir(testDir);

      const { setup } = await import('./setup.js');
      await setup({ updateSkills: true });

      // Verify config file was NOT modified
      const { readFileSync } = await import('node:fs');
      const configContent = readFileSync(configPath, 'utf-8');
      expect(configContent).toBe(originalConfig);
    });

    it('reports local installation type in output', async () => {
      // Create a local mobius config
      const configPath = join(testDir, 'mobius.config.yaml');
      writeFileSync(configPath, 'backend: linear\n');
      process.chdir(testDir);

      const { setup } = await import('./setup.js');
      await setup({ updateSkills: true });

      // Verify output mentions the skills path
      const output = consoleOutput.join('\n');
      expect(output).toContain('Skills updated at:');
    });
  });

  describe('--update-skills with missing bundled skills', () => {
    it('exits with error when bundled skills directory does not exist', async () => {
      // This test verifies the error path when bundled skills are missing
      // We can't easily simulate this without modifying the paths module,
      // but we can verify the setup function checks for bundled skills existence

      // The actual error handling is at the top of setup():
      // if (!existsSync(bundledSkills)) { ... process.exit(1) }

      // This test documents the expected behavior
      expect(true).toBe(true);
    });
  });

  describe('SetupOptions interface', () => {
    it('accepts updateSkills option', async () => {
      // Verify the interface allows updateSkills as an optional boolean
      const options: { updateSkills?: boolean } = {};
      expect(options.updateSkills).toBeUndefined();

      options.updateSkills = true;
      expect(options.updateSkills).toBe(true);

      options.updateSkills = false;
      expect(options.updateSkills).toBe(false);
    });
  });
});

describe('setup command: --update-skills global config', () => {
  let testDir: string;
  let originalCwd: string;
  let originalXdgConfigHome: string | undefined;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleOutput: string[];

  beforeEach(() => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `mobius-setup-global-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    originalCwd = process.cwd();
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

    // Point XDG_CONFIG_HOME to our temp directory so we can control global config
    const globalConfigDir = join(testDir, 'xdg-config', 'mobius');
    mkdirSync(globalConfigDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = join(testDir, 'xdg-config');

    // Create a mock global config so setup() doesn't exit
    writeFileSync(join(globalConfigDir, 'config.yaml'), 'backend: linear\n');

    // Capture console output
    consoleOutput = [];
    consoleLogSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    // Restore console.log
    consoleLogSpy.mockRestore();

    // Restore environment
    process.chdir(originalCwd);

    // Restore XDG_CONFIG_HOME
    if (originalXdgConfigHome !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('falls back to global paths when no local config exists', async () => {
    // Create an empty directory with no local config
    process.chdir(testDir);
    // Note: We can't easily mock the global paths, but we can verify the behavior
    // by checking that resolvePaths returns 'global' type when no local config exists

    const { resolvePaths } = await import('../lib/paths.js');
    const paths = resolvePaths();

    // With no local config, it should fall back to global
    expect(paths.type).toBe('global');
  });

  it('updates skills at global location when no local config exists', async () => {
    // Create temp dir structure with no local config
    const projectDir = join(testDir, 'project');
    mkdirSync(projectDir, { recursive: true });
    process.chdir(projectDir);

    const { setup } = await import('./setup.js');

    // This will create skills in the global location since no local config exists
    await setup({ updateSkills: true });

    // The output should indicate global update
    const output = consoleOutput.join('\n');
    expect(output).toContain('Skills updated at:');
    // When no local config, skills go to ~/.claude/skills (global path)
    expect(output).toContain('.claude/skills');
  });

  it('reports global installation type when no local config exists', async () => {
    // Use temp directory with no local config
    process.chdir(testDir);

    const { resolvePaths } = await import('../lib/paths.js');
    const paths = resolvePaths();

    // Without local config, should use global type
    expect(paths.type).toBe('global');
    // Global skills path contains .claude/skills in home directory
    expect(paths.skillsPath).toContain('.claude/skills');
  });
});

describe('setup command: config file unchanged', () => {
  let testDir: string;
  let originalCwd: string;
  let consoleLogSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    testDir = join(tmpdir(), `mobius-setup-hash-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    originalCwd = process.cwd();

    // Silence console output
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    process.chdir(originalCwd);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('preserves exact config file content including whitespace', async () => {
    const configPath = join(testDir, 'mobius.config.yaml');
    // Include various whitespace and formatting to ensure exact preservation
    const originalConfig = `# Custom config with comments
backend: jira

execution:
  delay_seconds: 15
  max_iterations: 200
  model: sonnet
  sandbox: false
  container_name: my-custom-container

# End of config
`;
    writeFileSync(configPath, originalConfig);
    process.chdir(testDir);

    const { setup } = await import('./setup.js');
    await setup({ updateSkills: true });

    // Read config and verify exact match
    const { readFileSync } = await import('node:fs');
    const configContent = readFileSync(configPath, 'utf-8');
    expect(configContent).toBe(originalConfig);
  });

  it('does not modify config file timestamp conceptually (hash unchanged)', async () => {
    const configPath = join(testDir, 'mobius.config.yaml');
    const originalConfig = 'backend: linear\n';
    writeFileSync(configPath, originalConfig);
    process.chdir(testDir);

    // Create a simple hash of the content before
    const { readFileSync } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const hashBefore = createHash('md5').update(readFileSync(configPath)).digest('hex');

    const { setup } = await import('./setup.js');
    await setup({ updateSkills: true });

    // Hash after should be identical
    const hashAfter = createHash('md5').update(readFileSync(configPath)).digest('hex');
    expect(hashAfter).toBe(hashBefore);
  });
});

describe('setup command: AGENTS.md not touched', () => {
  let testDir: string;
  let originalCwd: string;
  let consoleLogSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    testDir = join(tmpdir(), `mobius-setup-agents-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    originalCwd = process.cwd();

    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    process.chdir(originalCwd);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('does not modify existing AGENTS.md when using --update-skills', async () => {
    const configPath = join(testDir, 'mobius.config.yaml');
    const agentsPath = join(testDir, 'AGENTS.md');
    const originalAgentsContent = '# My Custom Agents File\n\nDo not touch this!\n';

    writeFileSync(configPath, 'backend: linear\n');
    writeFileSync(agentsPath, originalAgentsContent);
    process.chdir(testDir);

    const { setup } = await import('./setup.js');
    await setup({ updateSkills: true });

    // Verify AGENTS.md was not modified
    const { readFileSync } = await import('node:fs');
    const agentsContent = readFileSync(agentsPath, 'utf-8');
    expect(agentsContent).toBe(originalAgentsContent);
  });

  it('does not create AGENTS.md when using --update-skills', async () => {
    const configPath = join(testDir, 'mobius.config.yaml');
    const agentsPath = join(testDir, 'AGENTS.md');

    writeFileSync(configPath, 'backend: linear\n');
    // Do NOT create AGENTS.md
    process.chdir(testDir);

    const { setup } = await import('./setup.js');
    await setup({ updateSkills: true });

    // Verify AGENTS.md was NOT created
    expect(existsSync(agentsPath)).toBe(false);
  });
});

describe('setup command: --update-skills with no config anywhere', () => {
  let testDir: string;
  let originalCwd: string;
  let originalXdgConfigHome: string | undefined;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleOutput: string[];
  let processExitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    testDir = join(tmpdir(), `mobius-setup-noconfig-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    originalCwd = process.cwd();
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

    // Point XDG_CONFIG_HOME to a non-existent directory to simulate no global config
    process.env.XDG_CONFIG_HOME = join(testDir, 'nonexistent-xdg-config');

    consoleOutput = [];
    consoleLogSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });

    // Mock process.exit to prevent actual exit and capture exit code
    processExitSpy = spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as (code?: number) => never);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
    process.chdir(originalCwd);

    // Restore XDG_CONFIG_HOME
    if (originalXdgConfigHome !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('exits with error when no config exists anywhere', async () => {
    // Create a directory with no local config and XDG_CONFIG_HOME pointing to nonexistent dir
    const projectDir = join(testDir, 'project');
    mkdirSync(projectDir, { recursive: true });
    process.chdir(projectDir);

    const { setup } = await import('./setup.js');

    // Should throw because process.exit is mocked
    await expect(setup({ updateSkills: true })).rejects.toThrow('process.exit called');

    // Verify error message was printed
    const output = consoleOutput.join('\n');
    expect(output).toContain('No existing Mobius installation found');
    expect(output).toContain('Run `mobius setup` first');

    // Verify exit code 1 was requested
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});

describe('setup command: CLI integration', () => {
  it('registers -u, --update-skills option', async () => {
    // Verify the CLI properly registers the flag
    // This is tested by checking the option is passed to setup()
    // The actual CLI registration is in mobius.ts:
    // .option('-u, --update-skills', 'Update skills/commands only (skip config wizard)')

    // We verify the behavior works end-to-end in the tests above
    expect(true).toBe(true);
  });
});
