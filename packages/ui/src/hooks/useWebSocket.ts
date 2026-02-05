import { useCallback, useEffect, useRef, useState } from 'react';
import { wsClient, type WebSocketMessage, type WebSocketMessageType } from '@/lib/websocket';
import { useSessionStore } from '@/stores/session';
import { useIssuesStore } from '@/stores/issues';
import type { Session, Issue, Commit, Activity, Metrics } from '@/lib/api';

interface UseWebSocketReturn {
  isConnected: boolean;
  connectionState: 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
  connect: () => void;
  disconnect: () => void;
}

export function useWebSocket(): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(wsClient.isConnected);
  const [connectionState, setConnectionState] = useState(wsClient.connectionState);

  const {
    updateSession,
    addActivity,
    addMetrics,
  } = useSessionStore();

  const { addIssue, updateIssue, addCommit } = useIssuesStore();

  // Track connection state
  useEffect(() => {
    const checkConnection = (): void => {
      setIsConnected(wsClient.isConnected);
      setConnectionState(wsClient.connectionState);
    };

    // Check periodically
    const interval = setInterval(checkConnection, 1000);
    return (): void => { clearInterval(interval); };
  }, []);

  // Subscribe to global messages
  useEffect(() => {
    const unsubscribes: (() => void)[] = [];

    // Session updates
    unsubscribes.push(
      wsClient.subscribe<{ session?: Session } | Session>('session:updated', (message): void => {
        // Handle both nested { session } and direct session payload
        const payload = message.payload as { session?: Session };
        const session = payload.session ?? (message.payload as Session);
        updateSession(session.id, session);
      })
    );

    unsubscribes.push(
      wsClient.subscribe<{ session?: Session } | Session>('session:completed', (message): void => {
        const payload = message.payload as { session?: Session };
        const session = payload.session ?? (message.payload as Session);
        updateSession(session.id, session);
      })
    );

    unsubscribes.push(
      wsClient.subscribe<{ sessionId: string; error: string }>('session:error', (message): void => {
        console.error('Session error:', message.payload.error);
      })
    );

    // Issue updates
    unsubscribes.push(
      wsClient.subscribe<Issue>('issue:created', (message): void => {
        addIssue(message.payload);
      })
    );

    unsubscribes.push(
      wsClient.subscribe<Issue>('issue:updated', (message): void => {
        updateIssue(message.payload.id, message.payload);
      })
    );

    // Commit updates
    unsubscribes.push(
      wsClient.subscribe<Commit>('commit:created', (message): void => {
        addCommit(message.payload);
      })
    );

    // Activity updates
    unsubscribes.push(
      wsClient.subscribe<Activity>('activity:log', (message): void => {
        addActivity(message.payload);
      })
    );

    // Metrics updates
    unsubscribes.push(
      wsClient.subscribe<Metrics>('metrics:update', (message): void => {
        addMetrics(message.payload);
      })
    );

    return (): void => {
      unsubscribes.forEach((unsub) => { unsub(); });
    };
  }, [updateSession, addIssue, updateIssue, addCommit, addActivity, addMetrics]);

  const connect = useCallback((): void => {
    wsClient.connect();
  }, []);

  const disconnect = useCallback((): void => {
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
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const types = Array.isArray(type) ? type : [type];
    const unsubscribes = types.map((t) =>
      wsClient.subscribe<T>(t, (message): void => { handlerRef.current(message); })
    );

    return (): void => {
      unsubscribes.forEach((unsub) => { unsub(); });
    };
  }, [type]);
}

// Hook for subscribing to session-specific messages
export function useSessionWebSocket(sessionId: string): void {
  const { updateCurrentSession, addActivity, addMetrics, addLLMRequest, updateLLMRequest, setActiveLLMRequest } = useSessionStore();
  const { addIssue, updateIssue, addCommit } = useIssuesStore();

  useEffect(() => {
    if (sessionId === '') { return; }

    // Join server-side room so broadcastToSession events reach us
    wsClient.joinSession(sessionId);

    const unsubscribes: (() => void)[] = [];

    unsubscribes.push(
      wsClient.subscribeToSession<Session>(sessionId, 'session:updated', (message): void => {
        updateCurrentSession(message.payload);
      })
    );

    unsubscribes.push(
      wsClient.subscribeToSession<Session>(sessionId, 'session:completed', (message): void => {
        updateCurrentSession(message.payload);
      })
    );

    unsubscribes.push(
      wsClient.subscribeToSession<Issue>(sessionId, 'issue:created', (message): void => {
        addIssue(message.payload);
      })
    );

    unsubscribes.push(
      wsClient.subscribeToSession<Issue>(sessionId, 'issue:updated', (message): void => {
        updateIssue(message.payload.id, message.payload);
      })
    );

    unsubscribes.push(
      wsClient.subscribeToSession<Commit>(sessionId, 'commit:created', (message): void => {
        addCommit(message.payload);
      })
    );

    unsubscribes.push(
      wsClient.subscribeToSession<Activity>(sessionId, 'activity:log', (message): void => {
        const activity = message.payload;
        addActivity(activity);

        // Create/update LLM request records from analyzer events
        const details = activity.details;
        const eventType = details?.eventType as string | undefined;
        if (eventType === 'llm_request_start') {
          const reqId = details?.id as string ?? `llm-${String(Date.now())}`;
          const provider = (details?.provider as string) ?? 'unknown';
          const model = (details?.model as string) ?? 'unknown';
          addLLMRequest({
            id: reqId,
            status: 'streaming',
            model,
            provider,
            type: 'analyze',
            startedAt: activity.timestamp,
          });
          setActiveLLMRequest({
            id: reqId,
            status: 'streaming',
            model,
            provider,
            type: 'analyze',
            startedAt: activity.timestamp,
          });
        } else if (eventType === 'llm_request_complete') {
          const reqId = details?.id as string ?? '';
          const durationMs = (details?.durationMs as number) ?? 0;
          updateLLMRequest(reqId, {
            status: 'completed',
            duration: durationMs,
            completedAt: activity.timestamp,
          });
          setActiveLLMRequest(undefined);
        } else if (eventType === 'analysis_complete') {
          setActiveLLMRequest(undefined);
        }
      })
    );

    unsubscribes.push(
      wsClient.subscribeToSession<Metrics>(sessionId, 'metrics:update', (message): void => {
        addMetrics(message.payload);
      })
    );

    return (): void => {
      unsubscribes.forEach((unsub) => { unsub(); });
      wsClient.leaveSession(sessionId);
    };
  }, [sessionId, updateCurrentSession, addIssue, updateIssue, addCommit, addActivity, addMetrics, addLLMRequest, updateLLMRequest, setActiveLLMRequest]);
}

export default useWebSocket;
