import { useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { Session, CreateSessionRequest, SessionStats, Issue, Commit, Activity, Metrics } from '@/lib/api';
import { api, ApiClientError } from '@/lib/api';
import { useSessionStore } from '@/stores/session';
import { useIssuesStore } from '@/stores/issues';

// Don't retry on 404 errors (session not found)
const shouldRetry = (failureCount: number, error: Error): boolean => {
  if (error instanceof ApiClientError && error.status === 404) {
    return false;
  }
  return failureCount < 3;
};

interface UseSessionReturn {
  session: Session | undefined;
  stats: SessionStats | undefined;
  issues: Issue[] | undefined;
  commits: Commit[] | undefined;
  activities: Activity[] | undefined;
  metrics: Metrics[] | undefined;
  isLoading: boolean;
  isLoadingStats: boolean;
  isLoadingIssues: boolean;
  isLoadingCommits: boolean;
  error: Error | null;
  isCreating: boolean;
  isPausing: boolean;
  isResuming: boolean;
  isStopping: boolean;
  isDeleting: boolean;
  createSession: (data: CreateSessionRequest) => Promise<Session>;
  pauseSession: (id?: string) => Promise<Session | undefined>;
  resumeSession: (id?: string) => Promise<Session | undefined>;
  stopSession: (id?: string) => Promise<Session | undefined>;
  deleteSession: (id?: string) => Promise<void>;
  refreshSession: () => void;
}

export function useSession(sessionId?: string): UseSessionReturn {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {
    setCurrentSession,
    updateSession,
    setStats,
    setActivities,
    setMetrics,
    setLoading,
    setError,
  } = useSessionStore();

  const { setIssues, setCommits, reset: resetIssues } = useIssuesStore();

  // Fetch session details
  const sessionQuery = useQuery({
    queryKey: ['session', sessionId],
    queryFn: (): Promise<Session> => api.sessions.get(sessionId ?? ''),
    enabled: sessionId !== undefined && sessionId !== '',
    retry: shouldRetry,
    refetchInterval: (query): number | false => {
      // Don't refetch if there's an error (e.g., 404)
      if (query.state.error !== null) { return false; }
      const session = query.state.data;
      return session?.status === 'running' ? 5000 : false;
    },
  });

  // Fetch session stats
  const statsQuery = useQuery({
    queryKey: ['session', sessionId, 'stats'],
    queryFn: (): Promise<SessionStats> => api.sessions.getStats(sessionId ?? ''),
    enabled: sessionId !== undefined && sessionId !== '' && sessionQuery.error === null,
    retry: shouldRetry,
    refetchInterval: (query): number | false => {
      if (query.state.error !== null) { return false; }
      return 3000;
    },
  });

  // Fetch session issues
  const issuesQuery = useQuery({
    queryKey: ['session', sessionId, 'issues'],
    queryFn: (): Promise<Issue[]> => api.issues.list(sessionId ?? ''),
    enabled: sessionId !== undefined && sessionId !== '' && sessionQuery.error === null,
    retry: shouldRetry,
    refetchInterval: (query): number | false => {
      if (query.state.error !== null) { return false; }
      return 5000;
    },
  });

  // Fetch session commits
  const commitsQuery = useQuery({
    queryKey: ['session', sessionId, 'commits'],
    queryFn: (): Promise<Commit[]> => api.commits.list(sessionId ?? ''),
    enabled: sessionId !== undefined && sessionId !== '' && sessionQuery.error === null,
    retry: shouldRetry,
    refetchInterval: (query): number | false => {
      if (query.state.error !== null) { return false; }
      return 10000;
    },
  });

  // Fetch session activity
  const activityQuery = useQuery({
    queryKey: ['session', sessionId, 'activity'],
    queryFn: (): Promise<Activity[]> => api.sessions.getActivity(sessionId ?? '', 50),
    enabled: sessionId !== undefined && sessionId !== '' && sessionQuery.error === null,
    retry: shouldRetry,
    refetchInterval: (query): number | false => {
      if (query.state.error !== null) { return false; }
      return 2000;
    },
  });

  // Fetch session metrics
  const metricsQuery = useQuery({
    queryKey: ['session', sessionId, 'metrics'],
    queryFn: (): Promise<Metrics[]> => api.sessions.getMetrics(sessionId ?? ''),
    enabled: sessionId !== undefined && sessionId !== '' && sessionQuery.error === null,
    retry: shouldRetry,
    refetchInterval: (query): number | false => {
      if (query.state.error !== null) { return false; }
      return 10000;
    },
  });

  // Handle 404 error - navigate to home
  useEffect(() => {
    if (sessionQuery.error instanceof ApiClientError && sessionQuery.error.status === 404) {
      resetIssues();
      navigate('/', { replace: true });
    }
  }, [sessionQuery.error, navigate, resetIssues]);

  // Update stores when data changes
  useEffect(() => {
    if (sessionQuery.data !== undefined) {
      setCurrentSession(sessionQuery.data);
    }
  }, [sessionQuery.data, setCurrentSession]);

  useEffect(() => {
    if (statsQuery.data !== undefined) {
      setStats(statsQuery.data);
    }
  }, [statsQuery.data, setStats]);

  useEffect(() => {
    if (issuesQuery.data !== undefined) {
      setIssues(issuesQuery.data);
    }
  }, [issuesQuery.data, setIssues]);

  useEffect(() => {
    if (commitsQuery.data !== undefined) {
      setCommits(commitsQuery.data);
    }
  }, [commitsQuery.data, setCommits]);

  useEffect(() => {
    if (activityQuery.data !== undefined) {
      setActivities(activityQuery.data);
    }
  }, [activityQuery.data, setActivities]);

  useEffect(() => {
    if (metricsQuery.data !== undefined) {
      setMetrics(metricsQuery.data);
    }
  }, [metricsQuery.data, setMetrics]);

  // Update loading/error state
  useEffect(() => {
    setLoading(sessionQuery.isLoading);
    setError(sessionQuery.error?.message ?? null);
  }, [sessionQuery.isLoading, sessionQuery.error, setLoading, setError]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (data: CreateSessionRequest): Promise<Session> => {
      const session = await api.sessions.create(data);
      try {
        return await api.sessions.start(session.id);
      } catch (startError) {
        console.error('Failed to auto-start session:', startError);
        // Return the session but it will be in 'pending' state
        // The UI should show this state and allow manual start
        return session;
      }
    },
    onSuccess: (session: Session): void => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      navigate(`/session/${session.id}`);
    },
    onError: (error: Error): void => {
      console.error('Failed to create session:', error);
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (id: string): Promise<Session> => api.sessions.pause(id),
    onSuccess: (session: Session): void => {
      updateSession(session.id, session);
      void queryClient.invalidateQueries({ queryKey: ['session', session.id] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (id: string): Promise<Session> => api.sessions.resume(id),
    onSuccess: (session: Session): void => {
      updateSession(session.id, session);
      void queryClient.invalidateQueries({ queryKey: ['session', session.id] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: (id: string): Promise<Session> => api.sessions.stop(id),
    onSuccess: (session: Session): void => {
      updateSession(session.id, session);
      void queryClient.invalidateQueries({ queryKey: ['session', session.id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string): Promise<undefined> => {
      await api.sessions.delete(id);
      return undefined;
    },
    onSuccess: (_: undefined, id: string): void => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      if (sessionId === id) {
        resetIssues();
        navigate('/');
      }
    },
  });

  // Actions
  const createSession = useCallback(
    (data: CreateSessionRequest): Promise<Session> => createMutation.mutateAsync(data),
    [createMutation]
  );

  const pauseSession = useCallback(
    (id?: string): Promise<Session | undefined> => {
      const targetId = id ?? sessionId;
      if (targetId !== undefined) {
        return pauseMutation.mutateAsync(targetId);
      }
      return Promise.resolve(undefined);
    },
    [pauseMutation, sessionId]
  );

  const resumeSession = useCallback(
    (id?: string): Promise<Session | undefined> => {
      const targetId = id ?? sessionId;
      if (targetId !== undefined) {
        return resumeMutation.mutateAsync(targetId);
      }
      return Promise.resolve(undefined);
    },
    [resumeMutation, sessionId]
  );

  const stopSession = useCallback(
    (id?: string): Promise<Session | undefined> => {
      const targetId = id ?? sessionId;
      if (targetId !== undefined) {
        return stopMutation.mutateAsync(targetId);
      }
      return Promise.resolve(undefined);
    },
    [stopMutation, sessionId]
  );

  const deleteSession = useCallback(
    (id?: string): Promise<void> => {
      const targetId = id ?? sessionId;
      if (targetId !== undefined) {
        return deleteMutation.mutateAsync(targetId);
      }
      return Promise.resolve();
    },
    [deleteMutation, sessionId]
  );

  const refreshSession = useCallback((): void => {
    if (sessionId !== undefined) {
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    }
  }, [queryClient, sessionId]);

  return {
    // Data
    session: sessionQuery.data,
    stats: statsQuery.data,
    issues: issuesQuery.data,
    commits: commitsQuery.data,
    activities: activityQuery.data,
    metrics: metricsQuery.data,

    // Loading states
    isLoading: sessionQuery.isLoading,
    isLoadingStats: statsQuery.isLoading,
    isLoadingIssues: issuesQuery.isLoading,
    isLoadingCommits: commitsQuery.isLoading,

    // Error states
    error: sessionQuery.error,

    // Mutation states
    isCreating: createMutation.isPending,
    isPausing: pauseMutation.isPending,
    isResuming: resumeMutation.isPending,
    isStopping: stopMutation.isPending,
    isDeleting: deleteMutation.isPending,

    // Actions
    createSession,
    pauseSession,
    resumeSession,
    stopSession,
    deleteSession,
    refreshSession,
  };
}

// Hook for listing all sessions
interface UseSessionsReturn {
  sessions: Session[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useSessions(): UseSessionsReturn {
  const { setSessions, setLoading, setError } = useSessionStore();

  const query = useQuery({
    queryKey: ['sessions'],
    queryFn: (): Promise<Session[]> => api.sessions.list(),
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (query.data !== undefined) {
      setSessions(query.data);
    }
  }, [query.data, setSessions]);

  useEffect(() => {
    setLoading(query.isLoading);
    setError(query.error?.message ?? null);
  }, [query.isLoading, query.error, setLoading, setError]);

  return {
    sessions: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: (): void => {
      void query.refetch();
    },
  };
}

export default useSession;
