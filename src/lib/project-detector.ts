import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  BuildSystem,
  ProjectDetectionResult,
  ProjectType,
  VerificationCommands,
} from '../types.js';

/**
 * Parse justfile content and extract recipe names.
 * Matches lines like `recipe-name:` or `recipe-name arg:` at the start of a line.
 */
export function parseJustfileRecipes(content: string): string[] {
  const recipes: string[] = [];
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w[\w-]*)\s*.*:/);
    if (match && match[1] !== 'default') {
      recipes.push(match[1]);
    }
  }
  return recipes;
}

/**
 * Map justfile recipe names to verification commands.
 */
function mapRecipesToCommands(recipes: string[]): VerificationCommands {
  const commands: VerificationCommands = {};
  const recipeSet = new Set(recipes);

  if (recipeSet.has('test')) commands.test = 'just test';
  if (recipeSet.has('typecheck')) commands.typecheck = 'just typecheck';
  if (recipeSet.has('lint')) commands.lint = 'just lint';
  if (recipeSet.has('build')) commands.build = 'just build';
  if (recipeSet.has('validate')) commands.build ??= 'just validate';

  return commands;
}

/**
 * Read package.json scripts and fill in missing verification commands.
 */
function fillFromPackageJson(
  projectPath: string,
  commands: VerificationCommands
): VerificationCommands {
  const pkgPath = join(projectPath, 'package.json');
  if (!existsSync(pkgPath)) return commands;

  try {
    const content = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(content) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};

    if (!commands.test && 'test' in scripts) commands.test = 'npm run test';
    if (!commands.typecheck && 'typecheck' in scripts) commands.typecheck = 'npm run typecheck';
    if (!commands.lint && 'lint' in scripts) commands.lint = 'npm run lint';
    if (!commands.build && 'build' in scripts) commands.build = 'npm run build';
  } catch {
    // Ignore parse errors
  }

  return commands;
}

/**
 * Detect build system from project configuration files.
 */
function detectBuildSystem(projectPath: string, hasJustfile: boolean): BuildSystem {
  if (hasJustfile) return 'just';
  if (existsSync(join(projectPath, 'Cargo.toml'))) return 'cargo';
  if (existsSync(join(projectPath, 'Makefile'))) return 'make';
  if (existsSync(join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(projectPath, 'yarn.lock'))) return 'yarn';
  if (
    existsSync(join(projectPath, 'package-lock.json')) ||
    existsSync(join(projectPath, 'package.json'))
  )
    return 'npm';
  if (
    existsSync(join(projectPath, 'build.gradle')) ||
    existsSync(join(projectPath, 'build.gradle.kts'))
  )
    return 'gradle';
  if (existsSync(join(projectPath, 'pyproject.toml'))) {
    try {
      const content = readFileSync(join(projectPath, 'pyproject.toml'), 'utf-8');
      if (content.includes('[tool.poetry]')) return 'poetry';
    } catch {
      // Fall through
    }
    return 'pip';
  }
  return 'unknown';
}

/**
 * Detect project type and platform targets from filesystem markers.
 * Returns ProjectDetectionResult with all detected info.
 *
 * Uses synchronous fs operations following the pattern in src/lib/config.ts.
 */
export function detectProjectInfo(projectPath: string): ProjectDetectionResult {
  const detectedConfigFiles: string[] = [];
  const platformTargets: string[] = [];
  let projectType: ProjectType = 'unknown';

  // Check for justfile
  const hasJustfile = existsSync(join(projectPath, 'justfile'));
  if (hasJustfile) detectedConfigFiles.push('justfile');

  // Parse justfile recipes and map to commands
  let commands: VerificationCommands = {};
  if (hasJustfile) {
    try {
      const content = readFileSync(join(projectPath, 'justfile'), 'utf-8');
      const recipes = parseJustfileRecipes(content);
      commands = mapRecipesToCommands(recipes);
    } catch {
      // Ignore read errors
    }
  }

  // Check package.json
  if (existsSync(join(projectPath, 'package.json'))) {
    detectedConfigFiles.push('package.json');
    projectType = 'node';
    commands = fillFromPackageJson(projectPath, commands);
  }

  // Check for Android (build.gradle or android/build.gradle)
  if (
    existsSync(join(projectPath, 'build.gradle')) ||
    existsSync(join(projectPath, 'android', 'build.gradle'))
  ) {
    detectedConfigFiles.push('build.gradle');
    platformTargets.push('android');
    commands.platformBuild ??= {};
    commands.platformBuild.android = 'gradle assembleDebug';
    if (projectType === 'unknown') {
      projectType = 'android';
    } else {
      projectType = 'multi-platform';
    }
  }

  // Check for iOS (Podfile or ios/*.xcworkspace)
  const hasIos =
    existsSync(join(projectPath, 'Podfile')) ||
    (() => {
      try {
        const iosDir = join(projectPath, 'ios');
        if (!existsSync(iosDir)) return false;
        return readdirSync(iosDir).some((f) => f.endsWith('.xcworkspace'));
      } catch {
        return false;
      }
    })();

  if (hasIos) {
    if (existsSync(join(projectPath, 'Podfile'))) detectedConfigFiles.push('Podfile');
    platformTargets.push('ios');
    commands.platformBuild ??= {};
    commands.platformBuild.ios = 'xcodebuild -workspace ios/*.xcworkspace -scheme App build';
    if (projectType === 'unknown') {
      projectType = 'ios';
    } else if (projectType !== 'multi-platform') {
      projectType = 'multi-platform';
    }
  }

  // Check for Rust (Cargo.toml)
  if (existsSync(join(projectPath, 'Cargo.toml'))) {
    detectedConfigFiles.push('Cargo.toml');
    if (projectType === 'unknown') {
      projectType = 'rust';
    } else {
      projectType = 'multi-platform';
    }
  }

  // Check for Python (pyproject.toml)
  if (existsSync(join(projectPath, 'pyproject.toml'))) {
    detectedConfigFiles.push('pyproject.toml');
    if (projectType === 'unknown') {
      projectType = 'python';
    } else {
      projectType = 'multi-platform';
    }
  }

  const buildSystem = detectBuildSystem(projectPath, hasJustfile);

  return {
    projectType,
    buildSystem,
    platformTargets,
    availableCommands: commands,
    hasJustfile,
    detectedConfigFiles,
  };
}
