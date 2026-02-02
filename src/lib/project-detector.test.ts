import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectProjectInfo, parseJustfileRecipes } from './project-detector.js';

describe('project-detector', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `project-detector-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  describe('parseJustfileRecipes', () => {
    it('extracts simple recipe names', () => {
      const content = `
build:
    npm run build

test *args:
    bun test {{args}}

typecheck:
    npm run typecheck
`;
      const recipes = parseJustfileRecipes(content);
      expect(recipes).toContain('build');
      expect(recipes).toContain('test');
      expect(recipes).toContain('typecheck');
    });

    it('excludes default recipe', () => {
      const content = `default:
    @just --list

build:
    npm run build
`;
      const recipes = parseJustfileRecipes(content);
      expect(recipes).not.toContain('default');
      expect(recipes).toContain('build');
    });

    it('handles recipes with arguments', () => {
      const content = `test-file pattern:
    bun test "{{pattern}}"

loop task-id *args:
    ./scripts/mobius.sh {{task-id}} {{args}}
`;
      const recipes = parseJustfileRecipes(content);
      expect(recipes).toContain('test-file');
      expect(recipes).toContain('loop');
    });

    it('returns empty array for empty content', () => {
      expect(parseJustfileRecipes('')).toEqual([]);
    });

    it('ignores comment lines', () => {
      const content = `# This is a comment
build:
    npm run build
`;
      const recipes = parseJustfileRecipes(content);
      expect(recipes).toEqual(['build']);
    });
  });

  describe('detectProjectInfo', () => {
    it('returns safe defaults for empty directory', () => {
      const result = detectProjectInfo(tempDir);
      expect(result.projectType).toBe('unknown');
      expect(result.buildSystem).toBe('unknown');
      expect(result.platformTargets).toEqual([]);
      expect(result.hasJustfile).toBe(false);
      expect(result.detectedConfigFiles).toEqual([]);
    });

    it('detects node project with package.json', () => {
      writeFileSync(
        join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          scripts: { test: 'jest', build: 'tsc', lint: 'eslint .' },
        })
      );
      const result = detectProjectInfo(tempDir);
      expect(result.projectType).toBe('node');
      expect(result.buildSystem).toBe('npm');
      expect(result.detectedConfigFiles).toContain('package.json');
      expect(result.availableCommands.test).toBe('npm run test');
      expect(result.availableCommands.build).toBe('npm run build');
      expect(result.availableCommands.lint).toBe('npm run lint');
    });

    it('detects justfile and extracts recipe-based commands', () => {
      writeFileSync(
        join(tempDir, 'justfile'),
        `default:
    @just --list

build:
    npm run build

typecheck:
    npm run typecheck

lint:
    npm run lint

test *args:
    bun test {{args}}
`
      );
      const result = detectProjectInfo(tempDir);
      expect(result.hasJustfile).toBe(true);
      expect(result.buildSystem).toBe('just');
      expect(result.detectedConfigFiles).toContain('justfile');
      expect(result.availableCommands.test).toBe('just test');
      expect(result.availableCommands.typecheck).toBe('just typecheck');
      expect(result.availableCommands.lint).toBe('just lint');
      expect(result.availableCommands.build).toBe('just build');
    });

    it('justfile commands take priority over package.json', () => {
      writeFileSync(
        join(tempDir, 'justfile'),
        `test:
    bun test
build:
    npm run build
`
      );
      writeFileSync(
        join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          scripts: { test: 'jest', build: 'tsc', lint: 'eslint .' },
        })
      );
      const result = detectProjectInfo(tempDir);
      // justfile commands should win for test and build
      expect(result.availableCommands.test).toBe('just test');
      expect(result.availableCommands.build).toBe('just build');
      // But lint should come from package.json since justfile doesn't have it
      expect(result.availableCommands.lint).toBe('npm run lint');
    });

    it('detects android project with build.gradle', () => {
      writeFileSync(join(tempDir, 'build.gradle'), 'android {}');
      const result = detectProjectInfo(tempDir);
      expect(result.projectType).toBe('android');
      expect(result.platformTargets).toContain('android');
      expect(result.detectedConfigFiles).toContain('build.gradle');
      expect(result.availableCommands.platformBuild?.android).toBeDefined();
    });

    it('detects android project in android/ subdirectory', () => {
      mkdirSync(join(tempDir, 'android'), { recursive: true });
      writeFileSync(join(tempDir, 'android', 'build.gradle'), 'android {}');
      const result = detectProjectInfo(tempDir);
      expect(result.platformTargets).toContain('android');
    });

    it('detects ios project with Podfile', () => {
      writeFileSync(join(tempDir, 'Podfile'), "platform :ios, '14.0'");
      const result = detectProjectInfo(tempDir);
      expect(result.platformTargets).toContain('ios');
      expect(result.detectedConfigFiles).toContain('Podfile');
    });

    it('detects ios project with xcworkspace', () => {
      mkdirSync(join(tempDir, 'ios', 'App.xcworkspace'), { recursive: true });
      const result = detectProjectInfo(tempDir);
      expect(result.platformTargets).toContain('ios');
    });

    it('detects rust project with Cargo.toml', () => {
      writeFileSync(join(tempDir, 'Cargo.toml'), '[package]\nname = "test"');
      const result = detectProjectInfo(tempDir);
      expect(result.projectType).toBe('rust');
      expect(result.buildSystem).toBe('cargo');
      expect(result.detectedConfigFiles).toContain('Cargo.toml');
    });

    it('detects python project with pyproject.toml', () => {
      writeFileSync(join(tempDir, 'pyproject.toml'), '[project]\nname = "test"');
      const result = detectProjectInfo(tempDir);
      expect(result.projectType).toBe('python');
      expect(result.detectedConfigFiles).toContain('pyproject.toml');
    });

    it('detects multi-platform when node + android present', () => {
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'test', scripts: {} }));
      writeFileSync(join(tempDir, 'build.gradle'), 'android {}');
      const result = detectProjectInfo(tempDir);
      expect(result.projectType).toBe('multi-platform');
      expect(result.platformTargets).toContain('android');
    });

    it('detects mobius project correctly', () => {
      const result = detectProjectInfo(process.cwd());
      expect(result.projectType).toBe('node');
      expect(result.buildSystem).toBe('just');
      expect(result.hasJustfile).toBe(true);
      expect(result.detectedConfigFiles).toContain('justfile');
      expect(result.detectedConfigFiles).toContain('package.json');
      expect(result.availableCommands.test).toBe('just test');
      expect(result.availableCommands.typecheck).toBe('just typecheck');
    });

    it('does not throw on non-existent directory', () => {
      const result = detectProjectInfo(join(tempDir, 'nonexistent'));
      expect(result.projectType).toBe('unknown');
      expect(result.hasJustfile).toBe(false);
    });

    it('uses no async operations', () => {
      // Verify the module source has no async/await
      const { readFileSync } = require('node:fs');
      const source = readFileSync(join(process.cwd(), 'src/lib/project-detector.ts'), 'utf-8');
      expect(source).not.toContain('async ');
      expect(source).not.toContain('await ');
    });
  });
});
