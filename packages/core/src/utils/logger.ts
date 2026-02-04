/**
 * Logger Utility
 *
 * Provides a simple, formatted logging interface for Sloppy components.
 * Supports multiple log levels and optional metadata.
 */

/**
 * Log levels in order of severity.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Numeric values for log levels (for comparison).
 */
const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * ANSI color codes for terminal output.
 */
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
} as const;

/**
 * Colors for each log level.
 */
const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: COLORS.dim,
  info: COLORS.blue,
  warn: COLORS.yellow,
  error: COLORS.red,
};

/**
 * Symbols for each log level.
 */
const LEVEL_SYMBOLS: Record<LogLevel, string> = {
  debug: '[DEBUG]',
  info: '[INFO] ',
  warn: '[WARN] ',
  error: '[ERROR]',
};

/**
 * Logger configuration options.
 */
export interface LoggerOptions {
  /**
   * Minimum log level to output.
   * @default 'info'
   */
  level?: LogLevel;

  /**
   * Logger name/prefix for messages.
   */
  name?: string;

  /**
   * Whether to include timestamps.
   * @default true
   */
  timestamps?: boolean;

  /**
   * Whether to use colors in output.
   * @default true (auto-detected based on TTY)
   */
  colors?: boolean;

  /**
   * Custom output function (for testing or custom transports).
   * @default console.log/console.error
   */
  output?: (level: LogLevel, message: string) => void;
}

/**
 * Logger instance interface.
 */
export interface Logger {
  /**
   * Log a debug message.
   */
  debug(message: string, meta?: Record<string, unknown>): void;

  /**
   * Log an info message.
   */
  info(message: string, meta?: Record<string, unknown>): void;

  /**
   * Log a warning message.
   */
  warn(message: string, meta?: Record<string, unknown>): void;

  /**
   * Log an error message.
   */
  error(message: string, meta?: Record<string, unknown>): void;

  /**
   * Create a child logger with a new name prefix.
   */
  child(name: string): Logger;

  /**
   * Set the minimum log level.
   */
  setLevel(level: LogLevel): void;

  /**
   * Get the current log level.
   */
  getLevel(): LogLevel;
}

/**
 * Format metadata object for logging.
 *
 * @param meta - Metadata to format
 * @param useColors - Whether to use colors
 * @returns Formatted string
 */
function formatMeta(meta: Record<string, unknown>, useColors: boolean): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(meta)) {
    let formatted: string;

    if (value === null || value === undefined) {
      formatted = String(value);
    } else if (typeof value === 'object') {
      try {
        formatted = JSON.stringify(value);
      } catch {
        formatted = '[Circular]';
      }
    } else {
      // Value is a primitive (string, number, boolean, symbol, bigint)
      formatted = String(value as string | number | boolean | symbol | bigint);
    }

    if (useColors) {
      parts.push(`${COLORS.cyan}${key}${COLORS.reset}=${formatted}`);
    } else {
      parts.push(`${key}=${formatted}`);
    }
  }

  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

/**
 * Format a timestamp for logging.
 *
 * @param date - Date to format
 * @param useColors - Whether to use colors
 * @returns Formatted timestamp string
 */
function formatTimestamp(date: Date, useColors: boolean): string {
  const time = date.toISOString().replace('T', ' ').slice(0, 23);
  return useColors ? `${COLORS.dim}${time}${COLORS.reset}` : time;
}

/**
 * Create a logger instance.
 *
 * @param options - Logger configuration
 * @returns Logger instance
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const {
    level = 'info',
    name,
    timestamps = true,
    colors = process.stdout.isTTY,
    output,
  } = options;

  let currentLevel = level;

  /**
   * Default output function using console.
   */
  const defaultOutput = (logLevel: LogLevel, message: string): void => {
    if (logLevel === 'error') {
      console.error(message);
    } else {
      // eslint-disable-next-line no-console -- Logger utility intentionally uses console.log
      console.log(message);
    }
  };

  const outputFn = output ?? defaultOutput;

  /**
   * Core logging function.
   */
  const log = (
    logLevel: LogLevel,
    message: string,
    meta?: Record<string, unknown>
  ): void => {
    // Check if this level should be logged
    if (LOG_LEVEL_VALUES[logLevel] < LOG_LEVEL_VALUES[currentLevel]) {
      return;
    }

    const parts: string[] = [];

    // Add timestamp
    if (timestamps) {
      parts.push(formatTimestamp(new Date(), colors));
    }

    // Add level indicator
    const levelStr = LEVEL_SYMBOLS[logLevel];
    if (colors) {
      parts.push(`${LEVEL_COLORS[logLevel]}${levelStr}${COLORS.reset}`);
    } else {
      parts.push(levelStr);
    }

    // Add logger name
    if (name !== undefined && name !== '') {
      if (colors) {
        parts.push(`${COLORS.magenta}[${name}]${COLORS.reset}`);
      } else {
        parts.push(`[${name}]`);
      }
    }

    // Add message
    parts.push(message);

    // Add metadata
    if (meta && Object.keys(meta).length > 0) {
      parts.push(formatMeta(meta, colors));
    }

    outputFn(logLevel, parts.join(' '));
  };

  return {
    debug(message: string, meta?: Record<string, unknown>): void {
      log('debug', message, meta);
    },

    info(message: string, meta?: Record<string, unknown>): void {
      log('info', message, meta);
    },

    warn(message: string, meta?: Record<string, unknown>): void {
      log('warn', message, meta);
    },

    error(message: string, meta?: Record<string, unknown>): void {
      log('error', message, meta);
    },

    child(childName: string): Logger {
      const fullName = name !== undefined && name !== '' ? `${name}:${childName}` : childName;
      const childOptions: LoggerOptions = {
        level: currentLevel,
        name: fullName,
        timestamps,
        colors,
      };

      if (output) {
        childOptions.output = output;
      }

      return createLogger(childOptions);
    },

    setLevel(newLevel: LogLevel): void {
      currentLevel = newLevel;
    },

    getLevel(): LogLevel {
      return currentLevel;
    },
  };
}

/**
 * Default logger instance.
 */
export const logger = createLogger({ name: 'sloppy' });

/**
 * Parse a log level string.
 *
 * @param level - Level string to parse
 * @returns Parsed log level or undefined
 */
export function parseLogLevel(level: string): LogLevel | undefined {
  const normalized = level.toLowerCase().trim();
  if (normalized in LOG_LEVEL_VALUES) {
    return normalized as LogLevel;
  }
  return undefined;
}

/**
 * Get log level from environment variable.
 *
 * @param envVar - Environment variable name
 * @param defaultLevel - Default level if not set
 * @returns Log level
 */
export function getLogLevelFromEnv(
  envVar = 'LOG_LEVEL',
  defaultLevel: LogLevel = 'info'
): LogLevel {
  const envValue = process.env[envVar];
  if (envValue !== undefined && envValue !== '') {
    const parsed = parseLogLevel(envValue);
    if (parsed) {
      return parsed;
    }
  }
  return defaultLevel;
}

/**
 * Create a silent logger (for testing).
 *
 * @returns Logger that discards all output
 */
export function createSilentLogger(): Logger {
  return createLogger({
    output: () => {
      /* discard */
    },
  });
}

/**
 * Create a logger that collects messages (for testing).
 *
 * @returns Logger and array of collected messages
 */
export function createTestLogger(): {
  logger: Logger;
  messages: { level: LogLevel; message: string }[];
} {
  const messages: { level: LogLevel; message: string }[] = [];

  const testLogger = createLogger({
    level: 'debug',
    colors: false,
    timestamps: false,
    output: (level, message) => {
      messages.push({ level, message });
    },
  });

  return { logger: testLogger, messages };
}
