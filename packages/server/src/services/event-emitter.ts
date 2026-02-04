/**
 * Type-safe Event Emitter for Sloppy Orchestrator
 * Handles event emission, subscription, and WebSocket broadcasting
 */

import {
  SloppyEvent,
  SloppyEventType,
  Logger,
} from './types.js';

// ============================================================================
// Types
// ============================================================================

export type EventHandler<T extends SloppyEvent = SloppyEvent> = (event: T) => void | Promise<void>;

export interface EventSubscription {
  id: string;
  unsubscribe: () => void;
}

export interface WebSocketClient {
  id: string;
  sessionId: string | null; // null means subscribed to all sessions
  send: (data: string) => void;
  isAlive: boolean;
}

interface EventHandlerEntry {
  id: string;
  handler: EventHandler;
  once: boolean;
  sessionId?: string;
}

// ============================================================================
// Event Emitter Class
// ============================================================================

export class SloppyEventEmitter {
  private handlers: Map<SloppyEventType, EventHandlerEntry[]> = new Map();
  private globalHandlers: EventHandlerEntry[] = [];
  private wsClients: Map<string, WebSocketClient> = new Map();
  private eventHistory: Map<string, SloppyEvent[]> = new Map(); // sessionId -> events
  private maxHistoryPerSession = 1000;
  private handlerIdCounter = 0;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Emit an event to all subscribers
   */
  async emit(event: SloppyEvent): Promise<void> {
    const startTime = Date.now();

    this.logger.debug('Emitting event', {
      type: event.type,
      sessionId: event.sessionId,
    });

    // Store in history
    this.addToHistory(event);

    // Get handlers for this event type
    const typeHandlers = this.handlers.get(event.type) || [];
    const allHandlers = [...typeHandlers, ...this.globalHandlers];

    // Filter handlers by session if applicable
    const relevantHandlers = allHandlers.filter(
      (entry) => !entry.sessionId || entry.sessionId === event.sessionId
    );

    // Execute handlers
    const handlerPromises = relevantHandlers.map(async (entry) => {
      try {
        await entry.handler(event);
      } catch (error) {
        this.logger.error('Event handler error', {
          type: event.type,
          handlerId: entry.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    await Promise.all(handlerPromises);

    // Remove one-time handlers
    this.removeOnceHandlers(event.type, relevantHandlers);

    // Broadcast to WebSocket clients
    await this.broadcastToWebSocket(event);

    this.logger.debug('Event emitted', {
      type: event.type,
      sessionId: event.sessionId,
      handlersNotified: relevantHandlers.length,
      durationMs: Date.now() - startTime,
    });
  }

  /**
   * Subscribe to a specific event type
   */
  on<T extends SloppyEvent>(
    type: T['type'],
    handler: EventHandler<T>,
    options?: { sessionId?: string }
  ): EventSubscription {
    const id = this.generateHandlerId();
    const entry: EventHandlerEntry = {
      id,
      handler: handler as EventHandler,
      once: false,
      sessionId: options?.sessionId,
    };

    const handlers = this.handlers.get(type) || [];
    handlers.push(entry);
    this.handlers.set(type, handlers);

    this.logger.debug('Event handler registered', {
      type,
      handlerId: id,
      sessionId: options?.sessionId,
    });

    return {
      id,
      unsubscribe: () => this.removeHandler(type, id),
    };
  }

  /**
   * Subscribe to an event type for one occurrence only
   */
  once<T extends SloppyEvent>(
    type: T['type'],
    handler: EventHandler<T>,
    options?: { sessionId?: string }
  ): EventSubscription {
    const id = this.generateHandlerId();
    const entry: EventHandlerEntry = {
      id,
      handler: handler as EventHandler,
      once: true,
      sessionId: options?.sessionId,
    };

    const handlers = this.handlers.get(type) || [];
    handlers.push(entry);
    this.handlers.set(type, handlers);

    return {
      id,
      unsubscribe: () => this.removeHandler(type, id),
    };
  }

  /**
   * Subscribe to all events
   */
  onAny(
    handler: EventHandler,
    options?: { sessionId?: string }
  ): EventSubscription {
    const id = this.generateHandlerId();
    const entry: EventHandlerEntry = {
      id,
      handler,
      once: false,
      sessionId: options?.sessionId,
    };

    this.globalHandlers.push(entry);

    this.logger.debug('Global event handler registered', {
      handlerId: id,
      sessionId: options?.sessionId,
    });

    return {
      id,
      unsubscribe: () => this.removeGlobalHandler(id),
    };
  }

  /**
   * Remove a specific handler
   */
  off(type: SloppyEventType, handlerId: string): void {
    this.removeHandler(type, handlerId);
  }

  /**
   * Remove all handlers for a specific event type
   */
  removeAllListeners(type?: SloppyEventType): void {
    if (type) {
      this.handlers.delete(type);
      this.logger.debug('Removed all handlers for event type', { type });
    } else {
      this.handlers.clear();
      this.globalHandlers = [];
      this.logger.debug('Removed all event handlers');
    }
  }

  /**
   * Remove all handlers for a specific session
   */
  removeSessionListeners(sessionId: string): void {
    // Remove from type-specific handlers
    for (const [type, handlers] of this.handlers.entries()) {
      const filtered = handlers.filter((h) => h.sessionId !== sessionId);
      if (filtered.length === 0) {
        this.handlers.delete(type);
      } else {
        this.handlers.set(type, filtered);
      }
    }

    // Remove from global handlers
    this.globalHandlers = this.globalHandlers.filter(
      (h) => h.sessionId !== sessionId
    );

    this.logger.debug('Removed all handlers for session', { sessionId });
  }

  /**
   * Register a WebSocket client for event broadcasting
   */
  registerWebSocketClient(client: WebSocketClient): void {
    this.wsClients.set(client.id, client);
    this.logger.debug('WebSocket client registered', {
      clientId: client.id,
      sessionId: client.sessionId,
    });
  }

  /**
   * Unregister a WebSocket client
   */
  unregisterWebSocketClient(clientId: string): void {
    this.wsClients.delete(clientId);
    this.logger.debug('WebSocket client unregistered', { clientId });
  }

  /**
   * Update WebSocket client session subscription
   */
  updateWebSocketClientSession(clientId: string, sessionId: string | null): void {
    const client = this.wsClients.get(clientId);
    if (client) {
      client.sessionId = sessionId;
      this.logger.debug('WebSocket client session updated', {
        clientId,
        sessionId,
      });
    }
  }

  /**
   * Get event history for a session
   */
  getEventHistory(sessionId: string, limit?: number): SloppyEvent[] {
    const history = this.eventHistory.get(sessionId) || [];
    if (limit && limit > 0) {
      return history.slice(-limit);
    }
    return [...history];
  }

  /**
   * Get events of a specific type for a session
   */
  getEventsByType(sessionId: string, type: SloppyEventType): SloppyEvent[] {
    const history = this.eventHistory.get(sessionId) || [];
    return history.filter((e) => e.type === type);
  }

  /**
   * Clear event history for a session
   */
  clearEventHistory(sessionId: string): void {
    this.eventHistory.delete(sessionId);
    this.logger.debug('Event history cleared', { sessionId });
  }

  /**
   * Get the count of registered handlers
   */
  getHandlerCount(type?: SloppyEventType): number {
    if (type) {
      return (this.handlers.get(type) || []).length;
    }

    let total = this.globalHandlers.length;
    for (const handlers of this.handlers.values()) {
      total += handlers.length;
    }
    return total;
  }

  /**
   * Get the count of connected WebSocket clients
   */
  getWebSocketClientCount(): number {
    return this.wsClients.size;
  }

  /**
   * Cleanup dead WebSocket connections
   */
  cleanupDeadConnections(): number {
    let removed = 0;
    for (const [id, client] of this.wsClients.entries()) {
      if (!client.isAlive) {
        this.wsClients.delete(id);
        removed++;
      }
    }
    if (removed > 0) {
      this.logger.info('Cleaned up dead WebSocket connections', { removed });
    }
    return removed;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private generateHandlerId(): string {
    return `handler_${++this.handlerIdCounter}_${Date.now()}`;
  }

  private removeHandler(type: SloppyEventType, handlerId: string): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      const filtered = handlers.filter((h) => h.id !== handlerId);
      if (filtered.length === 0) {
        this.handlers.delete(type);
      } else {
        this.handlers.set(type, filtered);
      }
      this.logger.debug('Event handler removed', { type, handlerId });
    }
  }

  private removeGlobalHandler(handlerId: string): void {
    this.globalHandlers = this.globalHandlers.filter((h) => h.id !== handlerId);
    this.logger.debug('Global event handler removed', { handlerId });
  }

  private removeOnceHandlers(
    type: SloppyEventType,
    executedHandlers: EventHandlerEntry[]
  ): void {
    const onceHandlerIds = executedHandlers
      .filter((h) => h.once)
      .map((h) => h.id);

    if (onceHandlerIds.length === 0) return;

    // Remove from type-specific handlers
    const handlers = this.handlers.get(type);
    if (handlers) {
      const filtered = handlers.filter((h) => !onceHandlerIds.includes(h.id));
      if (filtered.length === 0) {
        this.handlers.delete(type);
      } else {
        this.handlers.set(type, filtered);
      }
    }

    // Remove from global handlers
    this.globalHandlers = this.globalHandlers.filter(
      (h) => !onceHandlerIds.includes(h.id)
    );
  }

  private addToHistory(event: SloppyEvent): void {
    const sessionId = event.sessionId;
    const history = this.eventHistory.get(sessionId) || [];

    history.push(event);

    // Trim history if it exceeds max size
    if (history.length > this.maxHistoryPerSession) {
      history.splice(0, history.length - this.maxHistoryPerSession);
    }

    this.eventHistory.set(sessionId, history);
  }

  private async broadcastToWebSocket(event: SloppyEvent): Promise<void> {
    const message = JSON.stringify({
      type: 'sloppy_event',
      event,
    });

    const sendPromises: Promise<void>[] = [];

    for (const client of this.wsClients.values()) {
      // Check if client is subscribed to this session or all sessions
      if (client.sessionId === null || client.sessionId === event.sessionId) {
        sendPromises.push(this.sendToClient(client, message));
      }
    }

    await Promise.all(sendPromises);
  }

  private async sendToClient(
    client: WebSocketClient,
    message: string
  ): Promise<void> {
    try {
      client.send(message);
    } catch (error) {
      this.logger.warn('Failed to send WebSocket message', {
        clientId: client.id,
        error: error instanceof Error ? error.message : String(error),
      });
      // Mark client as dead for cleanup
      client.isAlive = false;
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let globalEmitter: SloppyEventEmitter | null = null;

export function createEventEmitter(logger: Logger): SloppyEventEmitter {
  return new SloppyEventEmitter(logger);
}

export function getGlobalEventEmitter(logger?: Logger): SloppyEventEmitter {
  if (!globalEmitter) {
    if (!logger) {
      throw new Error('Logger required to initialize global event emitter');
    }
    globalEmitter = new SloppyEventEmitter(logger);
  }
  return globalEmitter;
}

export function resetGlobalEventEmitter(): void {
  if (globalEmitter) {
    globalEmitter.removeAllListeners();
  }
  globalEmitter = null;
}
