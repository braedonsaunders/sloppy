import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, LogLevel, type Logger } from '../utils/logger.js';

describe('Logger', () => {
  let logger: Logger;
  let consoleSpy: {
    debug: ReturnType<typeof vi.spyOn>;
    info: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createLogger', () => {
    it('should create logger with default options', () => {
      logger = createLogger();
      expect(logger).toBeDefined();
      expect(logger.debug).toBeInstanceOf(Function);
      expect(logger.info).toBeInstanceOf(Function);
      expect(logger.warn).toBeInstanceOf(Function);
      expect(logger.error).toBeInstanceOf(Function);
    });

    it('should create logger with custom name', () => {
      logger = createLogger({ name: 'test-logger' });
      logger.info('test message');

      expect(consoleSpy.info).toHaveBeenCalled();
      const callArg = consoleSpy.info.mock.calls[0]?.[0];
      expect(callArg).toContain('test-logger');
    });
  });

  describe('log levels', () => {
    it('should log debug messages when level is debug', () => {
      logger = createLogger({ level: LogLevel.DEBUG });
      logger.debug('debug message');

      expect(consoleSpy.debug).toHaveBeenCalled();
    });

    it('should not log debug messages when level is info', () => {
      logger = createLogger({ level: LogLevel.INFO });
      logger.debug('debug message');

      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    it('should log info messages when level is info', () => {
      logger = createLogger({ level: LogLevel.INFO });
      logger.info('info message');

      expect(consoleSpy.info).toHaveBeenCalled();
    });

    it('should log warn messages when level is warn', () => {
      logger = createLogger({ level: LogLevel.WARN });
      logger.warn('warn message');

      expect(consoleSpy.warn).toHaveBeenCalled();
    });

    it('should always log error messages', () => {
      logger = createLogger({ level: LogLevel.ERROR });
      logger.error('error message');

      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should not log info when level is warn', () => {
      logger = createLogger({ level: LogLevel.WARN });
      logger.info('info message');

      expect(consoleSpy.info).not.toHaveBeenCalled();
    });
  });

  describe('context data', () => {
    it('should include context data in log output', () => {
      logger = createLogger({ level: LogLevel.INFO });
      logger.info('message', { key: 'value' });

      expect(consoleSpy.info).toHaveBeenCalled();
      const callArgs = consoleSpy.info.mock.calls[0];
      expect(callArgs?.some((arg: unknown) =>
        typeof arg === 'string' && arg.includes('key')
      )).toBe(true);
    });

    it('should handle nested context data', () => {
      logger = createLogger({ level: LogLevel.INFO });
      logger.info('message', {
        nested: {
          deep: {
            value: 123,
          },
        },
      });

      expect(consoleSpy.info).toHaveBeenCalled();
    });

    it('should handle error objects in context', () => {
      logger = createLogger({ level: LogLevel.ERROR });
      const error = new Error('test error');
      logger.error('error occurred', { error });

      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });

  describe('child logger', () => {
    it('should create child logger with inherited settings', () => {
      logger = createLogger({ name: 'parent', level: LogLevel.INFO });
      const child = logger.child({ component: 'child' });

      child.info('child message');

      expect(consoleSpy.info).toHaveBeenCalled();
      const callArg = consoleSpy.info.mock.calls[0]?.[0];
      expect(callArg).toContain('parent');
    });

    it('should include child context in all logs', () => {
      logger = createLogger({ name: 'parent' });
      const child = logger.child({ requestId: 'abc123' });

      child.info('message');

      expect(consoleSpy.info).toHaveBeenCalled();
      const callArgs = consoleSpy.info.mock.calls[0];
      expect(callArgs?.some((arg: unknown) =>
        typeof arg === 'string' && arg.includes('abc123')
      )).toBe(true);
    });
  });

  describe('silent mode', () => {
    it('should not log anything when silent', () => {
      logger = createLogger({ silent: true });

      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');

      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(consoleSpy.info).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.error).not.toHaveBeenCalled();
    });
  });

  describe('timestamp', () => {
    it('should include timestamp when enabled', () => {
      logger = createLogger({ timestamp: true });
      logger.info('message');

      expect(consoleSpy.info).toHaveBeenCalled();
      const callArg = consoleSpy.info.mock.calls[0]?.[0];
      // Should contain ISO date pattern
      expect(callArg).toMatch(/\d{4}-\d{2}-\d{2}/);
    });
  });
});
