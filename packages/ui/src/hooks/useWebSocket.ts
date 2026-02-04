import { useCallback, useEffect, useRef, useState } from 'react';
import { wsClient, type WebSocketMessage, type WebSocketMessageType } from '@/lib/websocket';
import { useSessionStore } from '@/stores/session';
import { useIssuesStore } from '@/stores/issues';
import type { Session, Issue, Commit, Activity, Metrics } from '@/lib/api';

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(wsClient.isConnected);
  const [connectionState, setConnectionState] = useState(wsClient.connectionState);

  const {
    updateSession,
    addActivity,
    addMetrics,
    updateStats,
  } = useSessionStore();

  const { addIssue, updateIssue, addCommit } = useIssuesStore();

  // Track connection state
  useEffect(() => {
    const checkConnection = () => {
      setIsConnected(wsClient.isConnected);
      setConnectionState(wsClient.connectionState);
    };

    // Check periodically
    const interval = setInterval(checkConnection, 1000);
    return () => clearInterval(interval);
  }, []);

  // Subscribe to global messages
  useEffect(() => {
    const unsubscribes: (() => void)[] = [];

    // Session updates
    unsubscribes.push(
      wsClient.subscribe<{ session?: Session } | Session>('session:updated', (message) => {
        // Handle both nested { session } and direct session payload
        const session = (message.payload as { session?: Session })?.session ?? message.payload as Session;
        if (session?.id) {
          updateSession(session.id, session);
        }
      })
    );

    unsubscribes.push(
      wsClient.subscribe<{ session?: Session } | Session>('session:completed', (message) => {
        const session = (message.payload as { session?: Session })?.session ?? message.payload as Session;
        if (session?.id) {
          updateSession(session.id, session);
        }
      })
    );

    unsubscribes.push(
      wsClient.subscribe<{ sessionId: string; error: string }>('session:error', (message) => {
        console.error('Session error:', message.payload.error);
      })
    );

    // Issue updates
    unsubscribes.push(
      wsClient.subscribe<Issue>('issue:created', (message) => {
        addIssue(message.payload);
      })
    );

    unsubscribes.push(
      wsClient.subscribe<Issue>('issue:updated', (message) => {
        updateIssue(message.payload.id, message.payload);
      })
    );

    // Commit updates
    unsubscribes.push(
      wsClient.subscribe<Commit>('commit:created', (message) => {
        addCommit(message.payload);
      })
    );

    // Activity updates
    unsubscribes.push(
      wsClient.subscribe<Activity>('activity:log', (message) => {
        addActivity(message.payload);
      })
    );

    // Metrics updates
    unsubscribes.push(
      wsClient.subscribe<Metrics>('metrics:update', (message) => {
        addMetrics(message.payload);
      })
    );

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [updateSession, addIssue, updateIssue, addCommit, addActivity, addMetrics, updateStats]);

  const connect = useCallback(() => {
    wsClient.connect();
  }, []);

  const disconnect = useCallback(() => {
    wsClient.disconnect();
  }, []);

  return {
    isConnected,
    connectionState,
    connect,
    disconnect,
  };
}

// Hook for subscribing to specific message types
export function useWebSocketSubscription<T = unknown>(
  type: WebSocketMessageType | WebSocketMessageType[],
  handler: (message: WebSocketMessage<T>) => void
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const types = Array.isArray(type) ? type : [type];
    const unsubscribes = types.map((t) =>
      wsClient.subscribe<T>(t, (message) => handlerRef.current(message))
    );

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [type]);
}

// Hook for subscribing to session-specific messages
export function useSessionWebSocket(sessionId: string) {
  const { updateCurrentSession, addActivity, addMetrics, updateStats } = useSessionStore();
  const { addIssue, updateIssue, addCommit } = useIssuesStore();

  useEffect(() => {
    if (!sessionId) return;

    const unsubscribes: (() => void)[] = [];

    unsubscribes.push(
      wsClient.subscribeToSession<Session>(sessionId, 'session:updated', (message) => {
        updateCurrentSession(message.payload);
      })
    );

    unsubscribes.push(
      wsClient.subscribeToSession<Session>(sessionId, 'session:completed', (message) => {
        updateCurrentSession(message.payload);
      })
    );

    unsubscribes.push(
      wsClient.subscribeToSession<Issue>(sessionId, 'issue:created', (message) => {
        addIssue(message.payload);
      })
    );

    unsubscribes.push(
      wsClient.subscribeToSession<Issue>(sessionId, 'issue:updated', (message) => {
        updateIssue(message.payload.id, message.payload);
      })
    );

    unsubscribes.push(
      wsClient.subscribeToSession<Commit>(sessionId, 'commit:created', (message) => {
        addCommit(message.payload);
      })
    );

    unsubscribes.push(
      wsClient.subscribeToSession<Activity>(sessionId, 'activity:log', (message) => {
        addActivity(message.payload);
      })
    );

    unsubscribes.push(
      wsClient.subscribeToSession<Metrics>(sessionId, 'metrics:update', (message) => {
        addMetrics(message.payload);
      })
    );

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [sessionId, updateCurrentSession, addIssue, updateIssue, addCommit, addActivity, addMetrics, updateStats]);
}

export default useWebSocket;
