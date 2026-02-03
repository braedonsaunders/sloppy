import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VerificationService, extractVerificationErrors } from '../services/verification.js';
import type { SessionConfig, VerificationResult } from '../services/types.js';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';
const mockSpawn = vi.mocked(spawn);

function createMockProcess(exitCode: number, stdout: string, stderr: string) {
  const mockProcess = {
    stdout: {
      on: vi.fn((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from(stdout));
        }
      }),
    },
    stderr: {
      on: vi.fn((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from(stderr));
        }
      }),
    },
    on: vi.fn((event, callback) => {
      if (event === 'close') {
        setTimeout(() => callback(exitCode), 0);
      }
    }),
  };
  return mockProcess as any;
}

describe('VerificationService', () => {
  let service: VerificationService;

  beforeEach(() => {
    service = new VerificationService();
    vi.clearAllMocks();
  });

  describe('runTests', () => {
    it('should run test command and return success', async () => {
      mockSpawn.mockReturnValue(
        createMockProcess(0, 'All tests passed\n10 tests, 0 failures', '')
      );

      const result = await service.runTests('npm test', { cwd: '/test' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('All tests passed');
      expect(mockSpawn).toHaveBeenCalledWith('npm', ['test'], expect.any(Object));
    });

    it('should return failure when tests fail', async () => {
      mockSpawn.mockReturnValue(
        createMockProcess(1, '', 'Test failed: expected true, got false')
      );

      const result = await service.runTests('npm test', { cwd: '/test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Test failed');
    });

    it('should handle timeout', async () => {
      const neverEndingProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(), // Never calls the close callback
        kill: vi.fn(),
      };
      mockSpawn.mockReturnValue(neverEndingProcess as any);

      const result = await service.runTests('npm test', {
        cwd: '/test',
        timeout: 100,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });
  });

  describe('runLint', () => {
    it('should run lint command and return success', async () => {
      mockSpawn.mockReturnValue(createMockProcess(0, 'No linting errors', ''));

      const result = await service.runLint('npm run lint', { cwd: '/test' });

      expect(result.success).toBe(true);
    });

    it('should parse lint errors', async () => {
      const lintOutput = `
        /test/file.ts:10:5 error Unexpected any. Use unknown instead. @typescript-eslint/no-explicit-any
        /test/file.ts:15:10 warning Missing return type on function @typescript-eslint/explicit-function-return-type
      `;
      mockSpawn.mockReturnValue(createMockProcess(1, lintOutput, ''));

      const result = await service.runLint('npm run lint', { cwd: '/test' });

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
    });
  });

  describe('runBuild', () => {
    it('should run build command and return success', async () => {
      mockSpawn.mockReturnValue(createMockProcess(0, 'Build complete', ''));

      const result = await service.runBuild('npm run build', { cwd: '/test' });

      expect(result.success).toBe(true);
    });

    it('should return failure on build error', async () => {
      mockSpawn.mockReturnValue(
        createMockProcess(1, '', "error TS2322: Type 'string' is not assignable to type 'number'")
      );

      const result = await service.runBuild('npm run build', { cwd: '/test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('TS2322');
    });
  });

  describe('runAll', () => {
    it('should run all verification steps', async () => {
      mockSpawn.mockReturnValue(createMockProcess(0, 'Success', ''));

      const config: Partial<SessionConfig> = {
        testCommand: 'npm test',
        lintCommand: 'npm run lint',
        buildCommand: 'npm run build',
      };

      const result = await service.runAll(config as SessionConfig, { cwd: '/test' });

      expect(result.overall).toBe('pass');
      expect(result.tests?.success).toBe(true);
      expect(result.lint?.success).toBe(true);
      expect(result.build?.success).toBe(true);
    });

    it('should return fail if any step fails', async () => {
      mockSpawn
        .mockReturnValueOnce(createMockProcess(0, 'Tests pass', ''))
        .mockReturnValueOnce(createMockProcess(1, '', 'Lint error'))
        .mockReturnValueOnce(createMockProcess(0, 'Build pass', ''));

      const config: Partial<SessionConfig> = {
        testCommand: 'npm test',
        lintCommand: 'npm run lint',
        buildCommand: 'npm run build',
      };

      const result = await service.runAll(config as SessionConfig, { cwd: '/test' });

      expect(result.overall).toBe('fail');
      expect(result.lint?.success).toBe(false);
    });

    it('should skip steps without commands', async () => {
      mockSpawn.mockReturnValue(createMockProcess(0, 'Success', ''));

      const config: Partial<SessionConfig> = {
        testCommand: 'npm test',
        // No lint or build commands
      };

      const result = await service.runAll(config as SessionConfig, { cwd: '/test' });

      expect(result.tests).toBeDefined();
      expect(result.lint).toBeNull();
      expect(result.build).toBeNull();
    });
  });
});

describe('extractVerificationErrors', () => {
  it('should extract test errors', () => {
    const result: VerificationResult = {
      overall: 'fail',
      tests: {
        success: false,
        output: 'Test output',
        error: 'Test failed: expected true, got false',
        duration: 1000,
      },
      lint: null,
      build: null,
      duration: 1000,
      timestamp: new Date(),
    };

    const errors = extractVerificationErrors(result);

    expect(errors).toContain('Test failed');
  });

  it('should extract lint errors', () => {
    const result: VerificationResult = {
      overall: 'fail',
      tests: null,
      lint: {
        success: false,
        output: '',
        error: 'Unexpected any type',
        duration: 500,
        errors: [
          {
            file: '/test/file.ts',
            line: 10,
            column: 5,
            message: 'Unexpected any',
            rule: 'no-explicit-any',
            severity: 'error',
          },
        ],
      },
      build: null,
      duration: 500,
      timestamp: new Date(),
    };

    const errors = extractVerificationErrors(result);

    expect(errors).toContain('Unexpected any');
  });

  it('should extract build errors', () => {
    const result: VerificationResult = {
      overall: 'fail',
      tests: null,
      lint: null,
      build: {
        success: false,
        output: '',
        error: "TS2322: Type 'string' is not assignable to type 'number'",
        duration: 2000,
      },
      duration: 2000,
      timestamp: new Date(),
    };

    const errors = extractVerificationErrors(result);

    expect(errors).toContain('TS2322');
  });

  it('should combine multiple errors', () => {
    const result: VerificationResult = {
      overall: 'fail',
      tests: {
        success: false,
        output: '',
        error: 'Test error',
        duration: 1000,
      },
      lint: {
        success: false,
        output: '',
        error: 'Lint error',
        duration: 500,
      },
      build: null,
      duration: 1500,
      timestamp: new Date(),
    };

    const errors = extractVerificationErrors(result);

    expect(errors).toContain('Test error');
    expect(errors).toContain('Lint error');
  });
});
