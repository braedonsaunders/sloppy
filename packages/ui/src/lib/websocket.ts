// Helper to convert snake_case keys to camelCase
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function normalizeKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item: unknown) => normalizeKeys(item));
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[snakeToCamel(key)] = normalizeKeys(value);
    }
    return result;
  }
  return obj;
}

export type WebSocketMessageType =
  | 'session:updated'
  | 'session:completed'
  | 'session:error'
  | 'issue:created'
  | 'issue:updated'
  | 'commit:created'
  | 'activity:log'
  | 'metrics:update'
  | 'ping'
  | 'pong'
  | 'subscribe'
  | 'unsubscribe'
  | 'subscribed'
  | 'unsubscribed';

export interface WebSocketMessage<T = unknown> {
  type: WebSocketMessageType;
  sessionId?: string;
  payload: T;
  timestamp: string;
}

export type MessageHandler<T = unknown> = (message: WebSocketMessage<T>) => void;

export interface WebSocketClientOptions {
  url?: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
}

const DEFAULT_OPTIONS: Required<WebSocketClientOptions> = {
  url: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`,
  reconnect: true,
  reconnectInterval: 1000,
  maxReconnectAttempts: 10,
  heartbeatInterval: 30000,
};

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private options: Required<WebSocketClientOptions>;
  private reconnectAttempts = 0;
  private handlers = new Map<string, Set<MessageHandler>>();
  private globalHandlers = new Set<MessageHandler>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnecting = false;
  private intentionalClose = false;
  private messageQueue: Omit<WebSocketMessage, 'timestamp'>[] = [];
  private joinedSessions = new Set<string>();

  constructor(options: WebSocketClientOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    this.intentionalClose = false;

    try {
      this.ws = new WebSocket(this.options.url);
      this.setupEventHandlers();
    } catch (error) {
      console.error('WebSocket connection error:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.cleanup();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting');
      this.ws = null;
    }
  }

  subscribe<T = unknown>(
    type: WebSocketMessageType | '*',
    handler: MessageHandler<T>
  ): () => void {
    if (type === '*') {
      this.globalHandlers.add(handler as MessageHandler);
      return () => this.globalHandlers.delete(handler as MessageHandler);
    }

    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    const handlers = this.handlers.get(type);
    if (handlers !== undefined) {
      handlers.add(handler as MessageHandler);
    }

    return () => {
      this.handlers.get(type)?.delete(handler as MessageHandler);
    };
  }

  subscribeToSession<T = unknown>(
    sessionId: string,
    type: WebSocketMessageType,
    handler: MessageHandler<T>
  ): () => void {
    const wrappedHandler: MessageHandler = (message) => {
      if (message.sessionId === sessionId) {
        (handler as MessageHandler)(message);
      }
    };

    return this.subscribe(type, wrappedHandler);
  }

  /**
   * Join a session room on the server so broadcastToSession events are received
   */
  joinSession(sessionId: string): void {
    if (this.joinedSessions.has(sessionId)) return;
    this.joinedSessions.add(sessionId);
    this.send({ type: 'subscribe', sessionId, payload: {} });
  }

  /**
   * Leave a session room on the server
   */
  leaveSession(sessionId: string): void {
    if (!this.joinedSessions.has(sessionId)) return;
    this.joinedSessions.delete(sessionId);
    this.send({ type: 'unsubscribe', sessionId, payload: {} });
  }

  send(message: Omit<WebSocketMessage, 'timestamp'>): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.messageQueue.push(message);
      return;
    }

    this.ws.send(
      JSON.stringify({
        ...message,
        timestamp: new Date().toISOString(),
      })
    );
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get connectionState(): 'connecting' | 'connected' | 'disconnected' | 'reconnecting' {
    if (this.isConnecting) {return 'connecting';}
    if (this.ws?.readyState === WebSocket.OPEN) {return 'connected';}
    if (this.reconnectTimer) {return 'reconnecting';}
    return 'disconnected';
  }

  private setupEventHandlers(): void {
    if (!this.ws) {return;}

    this.ws.onopen = (): void => {
      // WebSocket connected
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      // Re-join session rooms after reconnect
      for (const sid of this.joinedSessions) {
        this.ws?.send(JSON.stringify({ type: 'subscribe', sessionId: sid, timestamp: new Date().toISOString() }));
      }
      this.flushQueue();
    };

    this.ws.onmessage = (event: MessageEvent): void => {
      try {
        const parsed: unknown = JSON.parse(String(event.data));
        const raw = parsed as Record<string, unknown>;
        // Normalize message format: server sends 'data', client expects 'payload'
        // Also normalize snake_case keys to camelCase
        const payload = normalizeKeys(raw.payload ?? raw.data);
        const message: WebSocketMessage = {
          type: raw.type as WebSocketMessageType,
          sessionId: (raw.sessionId ?? raw.session_id) as string | undefined,
          payload,
          timestamp: raw.timestamp as string,
        };
        this.handleMessage(message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onerror = (error: Event): void => {
      console.error('WebSocket error:', error);
      this.isConnecting = false;
    };

    this.ws.onclose = (event: CloseEvent): void => {
      console.warn('WebSocket closed:', event.code, event.reason);
      this.isConnecting = false;
      this.cleanup();

      if (!this.intentionalClose && this.options.reconnect) {
        this.scheduleReconnect();
      }
    };
  }

  private handleMessage(message: WebSocketMessage): void {
    // Handle ping/pong for heartbeat
    if (message.type === 'ping') {
      this.send({ type: 'pong', payload: {} });
      return;
    }

    // Notify global handlers
    this.globalHandlers.forEach((handler) => {
      try {
        handler(message);
      } catch (error) {
        console.error('Error in global WebSocket handler:', error);
      }
    });

    // Notify type-specific handlers
    const handlers = this.handlers.get(message.type);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(message);
        } catch (error) {
          console.error('Error in WebSocket handler:', error);
        }
      });
    }
  }

  private flushQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.send(message);
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping', payload: {} });
      }
    }, this.options.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {return;}

    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      return;
    }

    const delay = this.options.reconnectInterval * Math.pow(2, this.reconnectAttempts);
    console.warn(`Reconnecting in ${String(delay)}ms (attempt ${String(this.reconnectAttempts + 1)})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  private cleanup(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

// Singleton instance
export const wsClient = new WebSocketClient();

export default wsClient;
