import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VerificationService, extractVerificationErrors } from '../services/verification.js';
import type { SessionConfig, VerificationResult, Logger } from '../services/types.js';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';
const mockSpawn = vi.mocked(spawn);

function createMockProcess(exitCode: number, stdout: string, stderr: string) {
  const mockProcess = {
    stdout: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data') {
          callback(Buffer.from(stdout));
        }
      }),
    },
    stderr: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data') {
          callback(Buffer.from(stderr));
        }
      }),
    },
    on: vi.fn((event: string, callback: (...args: any[]) => void) => {
      if (event === 'close') {
        setTimeout(() => callback(exitCode), 0);
      }
    }),
    kill: vi.fn(),
    killed: false,
  };
  return mockProcess as any;
}

// Create a mock logger for VerificationService constructor
function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('VerificationService', () => {
  let service: VerificationService;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    service = new VerificationService(mockLogger);
    vi.clearAllMocks();
  });

  describe('runTests', () => {
    it('should run test command and return pass status', async () => {
      mockSpawn.mockReturnValue(
        createMockProcess(0, 'All tests passed\n10 tests, 0 failures', '')
      );

      const result = await service.runTests('npm test', { cwd: '/test' });

      expect(result.status).toBe('pass');
      expect(result.output).toContain('All tests passed');
    });

    it('should return fail status when tests fail', async () => {
      mockSpawn.mockReturnValue(
        createMockProcess(1, '', 'Test failed: expected true, got false')
      );

      const result = await service.runTests('npm test', { cwd: '/test' });

      expect(result.status).toBe('fail');
      expect(result.output).toContain('Test failed');
    });
  });

  describe('runLint', () => {
    it('should run lint command and return pass status', async () => {
      mockSpawn.mockReturnValue(createMockProcess(0, 'No linting errors', ''));

      const result = await service.runLint('npm run lint', { cwd: '/test' });

      expect(result.status).toBe('pass');
    });

    it('should return fail status on lint errors', async () => {
      mockSpawn.mockReturnValue(createMockProcess(1, 'Lint errors found', ''));

      const result = await service.runLint('npm run lint', { cwd: '/test' });

      expect(result.status).toBe('fail');
    });
  });

  describe('runBuild', () => {
    it('should run build command and return pass status', async () => {
      mockSpawn.mockReturnValue(createMockProcess(0, 'Build complete', ''));

      const result = await service.runBuild('npm run build', { cwd: '/test' });

      expect(result.status).toBe('pass');
    });

    it('should return fail status on build error', async () => {
      mockSpawn.mockReturnValue(
        createMockProcess(1, '', "error TS2322: Type 'string' is not assignable to type 'number'")
      );

      const result = await service.runBuild('npm run build', { cwd: '/test' });

      expect(result.status).toBe('fail');
      expect(result.output).toContain('TS2322');
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
      expect(result.tests?.status).toBe('pass');
      expect(result.lint?.status).toBe('pass');
      expect(result.build?.status).toBe('pass');
    });

    it('should return fail if build fails', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess(1, '', 'Build error'));

      const config: Partial<SessionConfig> = {
        testCommand: 'npm test',
        lintCommand: 'npm run lint',
        buildCommand: 'npm run build',
      };

      const result = await service.runAll(config as SessionConfig, { cwd: '/test' });

      expect(result.overall).toBe('fail');
      expect(result.build?.status).toBe('fail');
    });

    it('should skip steps without commands', async () => {
      mockSpawn.mockReturnValue(createMockProcess(0, 'Success', ''));

      const config: Partial<SessionConfig> = {
        testCommand: 'npm test',
        lintCommand: null,
        buildCommand: null,
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
        status: 'fail',
        passed: 0,
        failed: 1,
        skipped: 0,
        total: 1,
        duration: 1000,
        output: 'Test output',
        errors: [
          { testName: 'should work', message: 'Test failed: expected true, got false' },
        ],
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
        status: 'fail',
        errorCount: 1,
        warningCount: 0,
        fixableErrorCount: 0,
        fixableWarningCount: 0,
        duration: 500,
        output: '',
        errors: [
          {
            filePath: '/test/file.ts',
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
        status: 'fail',
        duration: 2000,
        output: '',
        errors: [
          {
            message: "TS2322: Type 'string' is not assignable to type 'number'",
          },
        ],
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
        status: 'fail',
        passed: 0,
        failed: 1,
        skipped: 0,
        total: 1,
        duration: 1000,
        output: '',
        errors: [
          { testName: 'test1', message: 'Test error' },
        ],
      },
      lint: {
        status: 'fail',
        errorCount: 1,
        warningCount: 0,
        fixableErrorCount: 0,
        fixableWarningCount: 0,
        duration: 500,
        output: '',
        errors: [
          {
            filePath: '/test/file.ts',
            line: 1,
            column: 1,
            message: 'Lint error',
            rule: 'some-rule',
            severity: 'error',
          },
        ],
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
