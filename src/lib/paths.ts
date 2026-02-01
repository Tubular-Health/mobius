import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PathConfig } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Package root directory (where package.json lives) */
export function getPackageRoot(): string {
  // In dist/lib/paths.js, go up two levels to package root
  return resolve(__dirname, '..', '..');
}

/** Global config directory (~/.config/mobius) */
export function getGlobalConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdgConfig, 'mobius');
}

/** Global skills directory (~/.claude/skills) */
export function getGlobalSkillsDir(): string {
  return join(homedir(), '.claude', 'skills');
}

/** Global commands directory (~/.claude/commands) */
export function getGlobalCommandsDir(): string {
  return join(homedir(), '.claude', 'commands');
}

/**
 * Walk up from startDir looking for mobius.config.yaml
 */
export function findLocalConfig(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir);
  const root = dirname(dir);

  while (dir !== root) {
    const configPath = join(dir, 'mobius.config.yaml');
    if (existsSync(configPath)) {
      return configPath;
    }
    dir = dirname(dir);
  }

  // Check root as well
  const rootConfig = join(root, 'mobius.config.yaml');
  if (existsSync(rootConfig)) {
    return rootConfig;
  }

  return null;
}

/**
 * Resolve paths for local or global installation
 * Priority: local config (walk up tree) > global config
 */
export function resolvePaths(): PathConfig {
  const packageRoot = getPackageRoot();

  // Check for local config first
  const localConfig = findLocalConfig();
  if (localConfig) {
    const projectRoot = dirname(localConfig);
    return {
      type: 'local',
      configPath: localConfig,
      skillsPath: join(projectRoot, '.claude', 'skills'),
      scriptPath: join(packageRoot, 'scripts', 'mobius.sh'),
    };
  }

  // Fall back to global config
  const globalConfigDir = getGlobalConfigDir();
  return {
    type: 'global',
    configPath: join(globalConfigDir, 'config.yaml'),
    skillsPath: getGlobalSkillsDir(),
    scriptPath: join(packageRoot, 'scripts', 'mobius.sh'),
  };
}

/**
 * Get paths for a specific installation type (used by setup)
 */
export function getPathsForType(type: 'local' | 'global', projectDir?: string): PathConfig {
  const packageRoot = getPackageRoot();

  if (type === 'local') {
    const dir = projectDir || process.cwd();
    return {
      type: 'local',
      configPath: join(dir, 'mobius.config.yaml'),
      skillsPath: join(dir, '.claude', 'skills'),
      scriptPath: join(packageRoot, 'scripts', 'mobius.sh'),
    };
  }

  const globalConfigDir = getGlobalConfigDir();
  return {
    type: 'global',
    configPath: join(globalConfigDir, 'config.yaml'),
    skillsPath: getGlobalSkillsDir(),
    scriptPath: join(packageRoot, 'scripts', 'mobius.sh'),
  };
}

/**
 * Get bundled skills directory from package
 */
export function getBundledSkillsDir(): string {
  return join(getPackageRoot(), '.claude', 'skills');
}

/**
 * Get bundled commands directory from package
 */
export function getBundledCommandsDir(): string {
  return join(getPackageRoot(), '.claude', 'commands');
}

/** Bundled shortcuts script path (scripts/shortcuts.sh in package) */
export function getBundledShortcutsPath(): string {
  return join(getPackageRoot(), 'scripts', 'shortcuts.sh');
}

/** Installed shortcuts script path (~/.config/mobius/shortcuts.sh) */
export function getShortcutsInstallPath(): string {
  return join(getGlobalConfigDir(), 'shortcuts.sh');
}

/**
 * Get default config template path
 */
export function getDefaultConfigPath(): string {
  return join(getPackageRoot(), 'mobius.config.yaml');
}

/**
 * Get AGENTS.md template path
 */
export function getAgentsTemplatePath(): string {
  return join(getPackageRoot(), 'templates', 'AGENTS.md');
}
