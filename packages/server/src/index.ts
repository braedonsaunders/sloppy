/**
 * @sloppy/server - Main entry point
 *
 * Starts the Sloppy backend server with Fastify, WebSocket, and SQLite
 */

import { createServer } from './server.js';

// Configuration from environment variables
const config = {
  host: process.env['SLOPPY_HOST'] ?? '0.0.0.0',
  port: parseInt(process.env['SLOPPY_PORT'] ?? '3000', 10),
  dbPath: process.env['SLOPPY_DB_PATH'],
  staticDir: process.env['SLOPPY_STATIC_DIR'],
  corsOrigin: process.env['SLOPPY_CORS_ORIGIN'] ?? true,
  logLevel: (process.env['SLOPPY_LOG_LEVEL'] ?? 'info') as
    | 'fatal'
    | 'error'
    | 'warn'
    | 'info'
    | 'debug'
    | 'trace'
    | 'silent',
};

// Start server
async function main(): Promise<void> {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ███████╗██╗      ██████╗ ██████╗ ██████╗ ██╗   ██╗          ║
║   ██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗╚██╗ ██╔╝          ║
║   ███████╗██║     ██║   ██║██████╔╝██████╔╝ ╚████╔╝           ║
║   ╚════██║██║     ██║   ██║██╔═══╝ ██╔═══╝   ╚██╔╝            ║
║   ███████║███████╗╚██████╔╝██║     ██║        ██║             ║
║   ╚══════╝╚══════╝ ╚═════╝ ╚═╝     ╚═╝        ╚═╝             ║
║                                                               ║
║   Code Quality Improvement Server                             ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`);

  try {
    const server = await createServer(config);
    const address = await server.start();

    console.log(`
🚀 Server started successfully!

   API:       ${address}/api
   WebSocket: ${address.replace('http', 'ws')}/ws
   Health:    ${address}/health

   Press Ctrl+C to stop
`);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Run main
void main();

// Re-export for programmatic usage
export { createServer } from './server.js';
export type { ServerOptions, SloppyServer } from './server.js';

export { SloppyDatabase, getDatabase, closeDatabase } from './db/database.js';
export type {
  Session,
  Issue,
  Commit,
  Metric,
  SessionStatus,
  IssueStatus,
  IssueSeverity,
  IssueType,
  CreateSessionInput,
  CreateIssueInput,
  CreateCommitInput,
  CreateMetricInput,
  UpdateSessionInput,
  UpdateIssueInput,
} from './db/database.js';

export { WebSocketHandler, getWebSocketHandler, closeWebSocketHandler } from './websocket/handler.js';
export type { OutgoingEvent, OutgoingEventType, IncomingMessage } from './websocket/handler.js';

export { SessionManager, getSessionManager, closeSessionManager } from './services/session-manager.js';
export type { CreateSessionRequest, SessionWithStats } from './services/session-manager.js';
