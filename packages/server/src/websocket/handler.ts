/**
 * WebSocket handler for real-time updates
 * Manages connections, room-based subscriptions, and event broadcasting
 */

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { nanoid } from 'nanoid';
import { z } from 'zod';

// Message schemas
const SubscribeMessageSchema = z.object({
  type: z.literal('subscribe'),
  sessionId: z.string(),
});

const UnsubscribeMessageSchema = z.object({
  type: z.literal('unsubscribe'),
  sessionId: z.string(),
});

const PingMessageSchema = z.object({
  type: z.literal('ping'),
});

const IncomingMessageSchema = z.discriminatedUnion('type', [
  SubscribeMessageSchema,
  UnsubscribeMessageSchema,
  PingMessageSchema,
]);

export type IncomingMessage = z.infer<typeof IncomingMessageSchema>;

// Outgoing event types
export type OutgoingEventType =
  | 'session:updated'
  | 'session:started'
  | 'session:paused'
  | 'session:resumed'
  | 'session:stopped'
  | 'session:completed'
  | 'session:failed'
  | 'issue:created'
  | 'issue:updated'
  | 'issue:resolved'
  | 'commit:created'
  | 'commit:reverted'
  | 'metrics:updated'
  | 'error'
  | 'subscribed'
  | 'unsubscribed'
  | 'pong';

export interface OutgoingEvent<T = unknown> {
  type: OutgoingEventType;
  sessionId?: string;
  data?: T;
  timestamp: string;
}

interface ClientConnection {
  id: string;
  socket: WebSocket;
  subscriptions: Set<string>;
  lastPing: number;
}

/**
 * WebSocket handler for managing real-time client connections
 */
export class WebSocketHandler {
  private clients: Map<string, ClientConnection> = new Map();
  private rooms: Map<string, Set<string>> = new Map(); // sessionId -> clientIds
  private logger: Console;
  private pingInterval: NodeJS.Timeout | null = null;
  private readonly PING_INTERVAL = 30000; // 30 seconds
  private readonly PING_TIMEOUT = 60000; // 60 seconds

  constructor(logger?: Console) {
    this.logger = logger ?? console;
  }

  /**
   * Start the ping interval to keep connections alive
   */
  start(): void {
    this.pingInterval = setInterval(() => {
      this.checkConnections();
    }, this.PING_INTERVAL);
    this.logger.info('[websocket] Handler started');
  }

  /**
   * Stop the handler and close all connections
   */
  stop(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // Close all connections
    for (const client of this.clients.values()) {
      try {
        client.socket.close(1001, 'Server shutting down');
      } catch {
        // Ignore close errors
      }
    }

    this.clients.clear();
    this.rooms.clear();
    this.logger.info('[websocket] Handler stopped');
  }

  /**
   * Check connections and remove stale ones
   */
  private checkConnections(): void {
    const now = Date.now();
    const stale: string[] = [];

    for (const [clientId, client] of this.clients) {
      if (now - client.lastPing > this.PING_TIMEOUT) {
        stale.push(clientId);
      }
    }

    for (const clientId of stale) {
      this.logger.info(`[websocket] Removing stale client: ${clientId}`);
      this.removeClient(clientId);
    }
  }

  /**
   * Handle a new WebSocket connection
   */
  handleConnection(socket: WebSocket): string {
    const clientId = nanoid();

    const client: ClientConnection = {
      id: clientId,
      socket,
      subscriptions: new Set(),
      lastPing: Date.now(),
    };

    this.clients.set(clientId, client);
    this.logger.info(`[websocket] Client connected: ${clientId}`);

    // Set up message handler
    socket.on('message', (data: Buffer | string) => {
      this.handleMessage(clientId, data);
    });

    // Set up close handler
    socket.on('close', () => {
      this.removeClient(clientId);
    });

    // Set up error handler
    socket.on('error', (error: Error) => {
      this.logger.error(`[websocket] Client error (${clientId}):`, error.message);
      this.removeClient(clientId);
    });

    return clientId;
  }

  /**
   * Handle incoming message from a client
   */
  private handleMessage(clientId: string, data: Buffer | string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Update last ping time
    client.lastPing = Date.now();

    try {
      const messageStr = typeof data === 'string' ? data : data.toString('utf-8');
      const parsed = JSON.parse(messageStr) as unknown;
      const result = IncomingMessageSchema.safeParse(parsed);

      if (!result.success) {
        this.sendToClient(clientId, {
          type: 'error',
          data: { message: 'Invalid message format', errors: result.error.errors },
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const message = result.data;

      switch (message.type) {
        case 'subscribe':
          this.subscribeClient(clientId, message.sessionId);
          break;
        case 'unsubscribe':
          this.unsubscribeClient(clientId, message.sessionId);
          break;
        case 'ping':
          this.sendToClient(clientId, {
            type: 'pong',
            timestamp: new Date().toISOString(),
          });
          break;
      }
    } catch (error) {
      this.logger.error(`[websocket] Error parsing message from ${clientId}:`, error);
      this.sendToClient(clientId, {
        type: 'error',
        data: { message: 'Failed to parse message' },
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Subscribe a client to a session room
   */
  private subscribeClient(clientId: string, sessionId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Add to client's subscriptions
    client.subscriptions.add(sessionId);

    // Add to room
    if (!this.rooms.has(sessionId)) {
      this.rooms.set(sessionId, new Set());
    }
    this.rooms.get(sessionId)!.add(clientId);

    this.logger.info(`[websocket] Client ${clientId} subscribed to session ${sessionId}`);

    this.sendToClient(clientId, {
      type: 'subscribed',
      sessionId,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Unsubscribe a client from a session room
   */
  private unsubscribeClient(clientId: string, sessionId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove from client's subscriptions
    client.subscriptions.delete(sessionId);

    // Remove from room
    const room = this.rooms.get(sessionId);
    if (room) {
      room.delete(clientId);
      if (room.size === 0) {
        this.rooms.delete(sessionId);
      }
    }

    this.logger.info(`[websocket] Client ${clientId} unsubscribed from session ${sessionId}`);

    this.sendToClient(clientId, {
      type: 'unsubscribed',
      sessionId,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Remove a client and clean up their subscriptions
   */
  private removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove from all rooms
    for (const sessionId of client.subscriptions) {
      const room = this.rooms.get(sessionId);
      if (room) {
        room.delete(clientId);
        if (room.size === 0) {
          this.rooms.delete(sessionId);
        }
      }
    }

    // Close socket if still open
    try {
      if (client.socket.readyState === 1) {
        client.socket.close();
      }
    } catch {
      // Ignore close errors
    }

    this.clients.delete(clientId);
    this.logger.info(`[websocket] Client disconnected: ${clientId}`);
  }

  /**
   * Send an event to a specific client
   */
  sendToClient(clientId: string, event: OutgoingEvent): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;

    try {
      if (client.socket.readyState === 1) {
        client.socket.send(JSON.stringify(event));
        return true;
      }
    } catch (error) {
      this.logger.error(`[websocket] Error sending to client ${clientId}:`, error);
      this.removeClient(clientId);
    }

    return false;
  }

  /**
   * Broadcast an event to all clients subscribed to a session
   */
  broadcastToSession<T>(sessionId: string, event: Omit<OutgoingEvent<T>, 'timestamp' | 'sessionId'>): number {
    const room = this.rooms.get(sessionId);
    if (!room || room.size === 0) return 0;

    const fullEvent: OutgoingEvent<T> = {
      ...event,
      sessionId,
      timestamp: new Date().toISOString(),
    } as OutgoingEvent<T>;

    let sent = 0;
    for (const clientId of room) {
      if (this.sendToClient(clientId, fullEvent)) {
        sent++;
      }
    }

    this.logger.info(`[websocket] Broadcast ${event.type} to session ${sessionId}: ${sent} clients`);
    return sent;
  }

  /**
   * Broadcast an event to all connected clients
   */
  broadcastToAll<T>(event: Omit<OutgoingEvent<T>, 'timestamp'>): number {
    const fullEvent: OutgoingEvent<T> = {
      ...event,
      timestamp: new Date().toISOString(),
    } as OutgoingEvent<T>;

    let sent = 0;
    for (const [clientId] of this.clients) {
      if (this.sendToClient(clientId, fullEvent)) {
        sent++;
      }
    }

    return sent;
  }

  /**
   * Get connection statistics
   */
  getStats(): { clients: number; rooms: number; subscriptions: number } {
    let subscriptions = 0;
    for (const room of this.rooms.values()) {
      subscriptions += room.size;
    }

    return {
      clients: this.clients.size,
      rooms: this.rooms.size,
      subscriptions,
    };
  }

  /**
   * Check if a client is connected
   */
  isClientConnected(clientId: string): boolean {
    return this.clients.has(clientId);
  }

  /**
   * Get list of clients subscribed to a session
   */
  getSessionSubscribers(sessionId: string): string[] {
    const room = this.rooms.get(sessionId);
    return room ? Array.from(room) : [];
  }
}

// Singleton instance
let wsHandler: WebSocketHandler | null = null;

export function getWebSocketHandler(logger?: Console): WebSocketHandler {
  if (!wsHandler) {
    wsHandler = new WebSocketHandler(logger);
  }
  return wsHandler;
}

export function closeWebSocketHandler(): void {
  if (wsHandler) {
    wsHandler.stop();
    wsHandler = null;
  }
}

/**
 * Register WebSocket route with Fastify
 */
export function registerWebSocketRoute(app: FastifyInstance): void {
  const handler = getWebSocketHandler(app.log as unknown as Console);

  app.get('/ws', { websocket: true }, (socket) => {
    handler.handleConnection(socket);
  });

  app.log.info('[websocket] Route registered at /ws');
}
