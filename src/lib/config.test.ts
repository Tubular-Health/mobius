/**
 * Unit tests for config module - verification config loading and validation
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LoopConfig } from '../types.js';
import { DEFAULT_CONFIG } from '../types.js';
import { readConfig, validateConfig } from './config.js';

describe('config module', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `config-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  describe('verification config defaults', () => {
    it('uses default verification config when config file does not exist', () => {
      const configPath = join(tempDir, 'nonexistent.yaml');
      const config = readConfig(configPath);

      expect(config.execution.verification).toEqual(DEFAULT_CONFIG.execution.verification);
    });

    it('provides default verification.coverage_threshold of 80', () => {
      const configPath = join(tempDir, 'nonexistent.yaml');
      const config = readConfig(configPath);

      expect(config.execution.verification?.coverage_threshold).toBe(80);
    });

    it('provides default verification.require_all_tests_pass of true', () => {
      const configPath = join(tempDir, 'nonexistent.yaml');
      const config = readConfig(configPath);

      expect(config.execution.verification?.require_all_tests_pass).toBe(true);
    });

    it('provides default verification.performance_check of true', () => {
      const configPath = join(tempDir, 'nonexistent.yaml');
      const config = readConfig(configPath);

      expect(config.execution.verification?.performance_check).toBe(true);
    });

    it('provides default verification.security_check of true', () => {
      const configPath = join(tempDir, 'nonexistent.yaml');
      const config = readConfig(configPath);

      expect(config.execution.verification?.security_check).toBe(true);
    });

    it('provides default verification.max_rework_iterations of 3', () => {
      const configPath = join(tempDir, 'nonexistent.yaml');
      const config = readConfig(configPath);

      expect(config.execution.verification?.max_rework_iterations).toBe(3);
    });

    it('uses defaults when execution section is empty in config file', () => {
      const configPath = join(tempDir, 'config.yaml');
      writeFileSync(
        configPath,
        `backend: linear
execution:
  delay_seconds: 5
`
      );

      const config = readConfig(configPath);

      // Should merge with defaults, including verification
      expect(config.execution.delay_seconds).toBe(5);
      expect(config.execution.verification).toEqual(DEFAULT_CONFIG.execution.verification);
    });
  });

  describe('verification config parsing', () => {
    it('parses valid verification config from file', () => {
      const configPath = join(tempDir, 'config.yaml');
      writeFileSync(
        configPath,
        `backend: linear
execution:
  delay_seconds: 3
  max_iterations: 50
  model: opus
  sandbox: true
  container_name: mobius-sandbox
  verification:
    coverage_threshold: 90
    require_all_tests_pass: true
    performance_check: false
    security_check: true
    max_rework_iterations: 5
`
      );

      const config = readConfig(configPath);

      expect(config.execution.verification?.coverage_threshold).toBe(90);
      expect(config.execution.verification?.require_all_tests_pass).toBe(true);
      expect(config.execution.verification?.performance_check).toBe(false);
      expect(config.execution.verification?.security_check).toBe(true);
      expect(config.execution.verification?.max_rework_iterations).toBe(5);
    });

    it('parses partial verification config and preserves specified values', () => {
      const configPath = join(tempDir, 'config.yaml');
      writeFileSync(
        configPath,
        `backend: linear
execution:
  delay_seconds: 3
  max_iterations: 50
  model: opus
  sandbox: true
  container_name: mobius-sandbox
  verification:
    coverage_threshold: 70
`
      );

      const config = readConfig(configPath);

      expect(config.execution.verification?.coverage_threshold).toBe(70);
    });

    it('handles missing verification section gracefully', () => {
      const configPath = join(tempDir, 'config.yaml');
      writeFileSync(
        configPath,
        `backend: linear
execution:
  delay_seconds: 3
  max_iterations: 50
  model: opus
  sandbox: true
  container_name: mobius-sandbox
`
      );

      const config = readConfig(configPath);

      // Should still have defaults from DEFAULT_CONFIG
      expect(config.execution.verification).toEqual(DEFAULT_CONFIG.execution.verification);
    });

    it('handles empty config file gracefully', () => {
      const configPath = join(tempDir, 'config.yaml');
      writeFileSync(configPath, '');

      const config = readConfig(configPath);

      // Should return defaults
      expect(config.backend).toBe(DEFAULT_CONFIG.backend);
      expect(config.execution.verification).toEqual(DEFAULT_CONFIG.execution.verification);
    });
  });

  describe('verification config validation', () => {
    it('validates config with valid verification values', () => {
      const config: LoopConfig = {
        backend: 'linear',
        execution: {
          delay_seconds: 3,
          max_iterations: 50,
          model: 'opus',
          sandbox: true,
          container_name: 'mobius-sandbox',
          verification: {
            coverage_threshold: 80,
            require_all_tests_pass: true,
            performance_check: true,
            security_check: true,
            max_rework_iterations: 3,
          },
        },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('validates config without verification section', () => {
      const config: LoopConfig = {
        backend: 'linear',
        execution: {
          delay_seconds: 3,
          max_iterations: 50,
          model: 'opus',
          sandbox: true,
          container_name: 'mobius-sandbox',
        },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    describe('coverage_threshold validation', () => {
      it('rejects coverage_threshold below 0', () => {
        const config: LoopConfig = {
          backend: 'linear',
          execution: {
            delay_seconds: 3,
            max_iterations: 50,
            model: 'opus',
            sandbox: true,
            container_name: 'mobius-sandbox',
            verification: {
              coverage_threshold: -1,
              require_all_tests_pass: true,
              performance_check: true,
              security_check: true,
              max_rework_iterations: 3,
            },
          },
        };

        const result = validateConfig(config);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'execution.verification.coverage_threshold must be a number between 0 and 100'
        );
      });

      it('rejects coverage_threshold above 100', () => {
        const config: LoopConfig = {
          backend: 'linear',
          execution: {
            delay_seconds: 3,
            max_iterations: 50,
            model: 'opus',
            sandbox: true,
            container_name: 'mobius-sandbox',
            verification: {
              coverage_threshold: 101,
              require_all_tests_pass: true,
              performance_check: true,
              security_check: true,
              max_rework_iterations: 3,
            },
          },
        };

        const result = validateConfig(config);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'execution.verification.coverage_threshold must be a number between 0 and 100'
        );
      });

      it('rejects non-numeric coverage_threshold', () => {
        const config: LoopConfig = {
          backend: 'linear',
          execution: {
            delay_seconds: 3,
            max_iterations: 50,
            model: 'opus',
            sandbox: true,
            container_name: 'mobius-sandbox',
            verification: {
              coverage_threshold: 'high' as unknown as number,
              require_all_tests_pass: true,
              performance_check: true,
              security_check: true,
              max_rework_iterations: 3,
            },
          },
        };

        const result = validateConfig(config);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'execution.verification.coverage_threshold must be a number between 0 and 100'
        );
      });

      it('accepts coverage_threshold at boundary values (0 and 100)', () => {
        const configAtZero: LoopConfig = {
          backend: 'linear',
          execution: {
            delay_seconds: 3,
            max_iterations: 50,
            model: 'opus',
            sandbox: true,
            container_name: 'mobius-sandbox',
            verification: {
              coverage_threshold: 0,
              require_all_tests_pass: true,
              performance_check: true,
              security_check: true,
              max_rework_iterations: 3,
            },
          },
        };

        const configAt100: LoopConfig = {
          backend: 'linear',
          execution: {
            delay_seconds: 3,
            max_iterations: 50,
            model: 'opus',
            sandbox: true,
            container_name: 'mobius-sandbox',
            verification: {
              coverage_threshold: 100,
              require_all_tests_pass: true,
              performance_check: true,
              security_check: true,
              max_rework_iterations: 3,
            },
          },
        };

        expect(validateConfig(configAtZero).valid).toBe(true);
        expect(validateConfig(configAt100).valid).toBe(true);
      });
    });

    describe('require_all_tests_pass validation', () => {
      it('rejects non-boolean require_all_tests_pass', () => {
        const config: LoopConfig = {
          backend: 'linear',
          execution: {
            delay_seconds: 3,
            max_iterations: 50,
            model: 'opus',
            sandbox: true,
            container_name: 'mobius-sandbox',
            verification: {
              coverage_threshold: 80,
              require_all_tests_pass: 'yes' as unknown as boolean,
              performance_check: true,
              security_check: true,
              max_rework_iterations: 3,
            },
          },
        };

        const result = validateConfig(config);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'execution.verification.require_all_tests_pass must be a boolean'
        );
      });

      it('accepts boolean require_all_tests_pass values', () => {
        const configTrue: LoopConfig = {
          backend: 'linear',
          execution: {
            delay_seconds: 3,
            max_iterations: 50,
            model: 'opus',
            sandbox: true,
            container_name: 'mobius-sandbox',
            verification: {
              coverage_threshold: 80,
              require_all_tests_pass: true,
              performance_check: true,
              security_check: true,
              max_rework_iterations: 3,
            },
          },
        };

        const configFalse: LoopConfig = {
          backend: 'linear',
          execution: {
            delay_seconds: 3,
            max_iterations: 50,
            model: 'opus',
            sandbox: true,
            container_name: 'mobius-sandbox',
            verification: {
              coverage_threshold: 80,
              require_all_tests_pass: false,
              performance_check: true,
              security_check: true,
              max_rework_iterations: 3,
            },
          },
        };

        expect(validateConfig(configTrue).valid).toBe(true);
        expect(validateConfig(configFalse).valid).toBe(true);
      });
    });

    describe('performance_check validation', () => {
      it('rejects non-boolean performance_check', () => {
        const config: LoopConfig = {
          backend: 'linear',
          execution: {
            delay_seconds: 3,
            max_iterations: 50,
            model: 'opus',
            sandbox: true,
            container_name: 'mobius-sandbox',
            verification: {
              coverage_threshold: 80,
              require_all_tests_pass: true,
              performance_check: 1 as unknown as boolean,
              security_check: true,
              max_rework_iterations: 3,
            },
          },
        };

        const result = validateConfig(config);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'execution.verification.performance_check must be a boolean'
        );
      });
    });

    describe('security_check validation', () => {
      it('rejects non-boolean security_check', () => {
        const config: LoopConfig = {
          backend: 'linear',
          execution: {
            delay_seconds: 3,
            max_iterations: 50,
            model: 'opus',
            sandbox: true,
            container_name: 'mobius-sandbox',
            verification: {
              coverage_threshold: 80,
              require_all_tests_pass: true,
              performance_check: true,
              security_check: 'enabled' as unknown as boolean,
              max_rework_iterations: 3,
            },
          },
        };

        const result = validateConfig(config);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('execution.verification.security_check must be a boolean');
      });
    });

    describe('max_rework_iterations validation', () => {
      it('rejects max_rework_iterations below 1', () => {
        const config: LoopConfig = {
          backend: 'linear',
          execution: {
            delay_seconds: 3,
            max_iterations: 50,
            model: 'opus',
            sandbox: true,
            container_name: 'mobius-sandbox',
            verification: {
              coverage_threshold: 80,
              require_all_tests_pass: true,
              performance_check: true,
              security_check: true,
              max_rework_iterations: 0,
            },
          },
        };

        const result = validateConfig(config);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'execution.verification.max_rework_iterations must be an integer between 1 and 10'
        );
      });

      it('rejects max_rework_iterations above 10', () => {
        const config: LoopConfig = {
          backend: 'linear',
          execution: {
            delay_seconds: 3,
            max_iterations: 50,
            model: 'opus',
            sandbox: true,
            container_name: 'mobius-sandbox',
            verification: {
              coverage_threshold: 80,
              require_all_tests_pass: true,
              performance_check: true,
              security_check: true,
              max_rework_iterations: 11,
            },
          },
        };

        const result = validateConfig(config);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'execution.verification.max_rework_iterations must be an integer between 1 and 10'
        );
      });

      it('rejects non-integer max_rework_iterations', () => {
        const config: LoopConfig = {
          backend: 'linear',
          execution: {
            delay_seconds: 3,
            max_iterations: 50,
            model: 'opus',
            sandbox: true,
            container_name: 'mobius-sandbox',
            verification: {
              coverage_threshold: 80,
              require_all_tests_pass: true,
              performance_check: true,
              security_check: true,
              max_rework_iterations: 3.5,
            },
          },
        };

        const result = validateConfig(config);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'execution.verification.max_rework_iterations must be an integer between 1 and 10'
        );
      });

      it('accepts max_rework_iterations at boundary values (1 and 10)', () => {
        const configAt1: LoopConfig = {
          backend: 'linear',
          execution: {
            delay_seconds: 3,
            max_iterations: 50,
            model: 'opus',
            sandbox: true,
            container_name: 'mobius-sandbox',
            verification: {
              coverage_threshold: 80,
              require_all_tests_pass: true,
              performance_check: true,
              security_check: true,
              max_rework_iterations: 1,
            },
          },
        };

        const configAt10: LoopConfig = {
          backend: 'linear',
          execution: {
            delay_seconds: 3,
            max_iterations: 50,
            model: 'opus',
            sandbox: true,
            container_name: 'mobius-sandbox',
            verification: {
              coverage_threshold: 80,
              require_all_tests_pass: true,
              performance_check: true,
              security_check: true,
              max_rework_iterations: 10,
            },
          },
        };

        expect(validateConfig(configAt1).valid).toBe(true);
        expect(validateConfig(configAt10).valid).toBe(true);
      });
    });

    describe('multiple validation errors', () => {
      it('reports multiple validation errors at once', () => {
        const config: LoopConfig = {
          backend: 'linear',
          execution: {
            delay_seconds: 3,
            max_iterations: 50,
            model: 'opus',
            sandbox: true,
            container_name: 'mobius-sandbox',
            verification: {
              coverage_threshold: 150,
              require_all_tests_pass: 'yes' as unknown as boolean,
              performance_check: true,
              security_check: true,
              max_rework_iterations: 0,
            },
          },
        };

        const result = validateConfig(config);

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBe(3);
        expect(result.errors).toContain(
          'execution.verification.coverage_threshold must be a number between 0 and 100'
        );
        expect(result.errors).toContain(
          'execution.verification.require_all_tests_pass must be a boolean'
        );
        expect(result.errors).toContain(
          'execution.verification.max_rework_iterations must be an integer between 1 and 10'
        );
      });
    });
  });
});
