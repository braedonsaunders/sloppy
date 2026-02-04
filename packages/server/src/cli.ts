#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';

interface CliOptions {
  port: number;
  host: string;
  dbPath: string;
  logLevel: string;
}

function parseCliArgs(): CliOptions {
  const { values } = parseArgs({
    options: {
      port: {
        type: 'string',
        short: 'p',
        default: process.env['PORT'] ?? '7749',
      },
      host: {
        type: 'string',
        short: 'h',
        default: process.env['HOST'] ?? '0.0.0.0',
      },
      'db-path': {
        type: 'string',
        short: 'd',
        default: process.env['DATABASE_PATH'] ?? './data/sloppy.db',
      },
      'log-level': {
        type: 'string',
        short: 'l',
        default: process.env['LOG_LEVEL'] ?? 'info',
      },
      help: {
        type: 'boolean',
        default: false,
      },
      version: {
        type: 'boolean',
        short: 'v',
        default: false,
      },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values['help']) {
    printHelp();
    process.exit(0);
  }

  if (values['version']) {
    console.log('sloppy v1.0.0');
    process.exit(0);
  }

  return {
    port: parseInt(values['port'] as string, 10),
    host: values['host'] as string,
    dbPath: resolve(values['db-path'] as string),
    logLevel: values['log-level'] as string,
  };
}

function printHelp(): void {
  console.log(`
Sloppy - Transform AI-generated code into production-ready quality

Usage: sloppy [options]

Options:
  -p, --port <port>        Server port (default: 7749)
  -h, --host <host>        Server host (default: 0.0.0.0)
  -d, --db-path <path>     SQLite database path (default: ./data/sloppy.db)
  -l, --log-level <level>  Log level: debug, info, warn, error (default: info)
  -v, --version            Show version
      --help               Show this help message

Environment variables:
  PORT              Server port
  HOST              Server host
  DATABASE_PATH     SQLite database path
  LOG_LEVEL         Log level
  ANTHROPIC_API_KEY API key for Claude
  OPENAI_API_KEY    API key for OpenAI
  OLLAMA_HOST       Ollama server URL (default: http://localhost:11434)

Examples:
  sloppy                          Start with defaults
  sloppy -p 3000                  Start on port 3000
  sloppy --db-path /var/sloppy.db Use custom database path

Documentation: https://github.com/sloppy/sloppy
`);
}

async function main(): Promise<void> {
  const options = parseCliArgs();

  // Set environment variables for the server
  process.env['PORT'] = options.port.toString();
  process.env['HOST'] = options.host;
  process.env['DATABASE_PATH'] = options.dbPath;
  process.env['LOG_LEVEL'] = options.logLevel;

  // Dynamic import to allow env vars to be set first
  const { startServer } = await import('./server.js');
  await startServer();
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
