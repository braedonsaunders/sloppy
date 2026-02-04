import { useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type CreateSessionRequest, ApiClientError } from '@/lib/api';
import { useSessionStore } from '@/stores/session';
import { useIssuesStore } from '@/stores/issues';

// Don't retry on 404 errors (session not found)
const shouldRetry = (failureCount: number, error: Error) => {
  if (error instanceof ApiClientError && error.status === 404) {
    return false;
  }
  return failureCount < 3;
};

export function useSession(sessionId?: string) {
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
    queryFn: () => api.sessions.get(sessionId!),
    enabled: !!sessionId,
    retry: shouldRetry,
    refetchInterval: (query) => {
      // Don't refetch if there's an error (e.g., 404)
      if (query.state.error) return false;
      const session = query.state.data;
      return session?.status === 'running' ? 5000 : false;
    },
  });

  // Fetch session stats
  const statsQuery = useQuery({
    queryKey: ['session', sessionId, 'stats'],
    queryFn: () => api.sessions.getStats(sessionId!),
    enabled: !!sessionId && !sessionQuery.error,
    retry: shouldRetry,
    refetchInterval: (query) => {
      if (query.state.error) return false;
      return 3000;
    },
  });

  // Fetch session issues
  const issuesQuery = useQuery({
    queryKey: ['session', sessionId, 'issues'],
    queryFn: () => api.issues.list(sessionId!),
    enabled: !!sessionId && !sessionQuery.error,
    retry: shouldRetry,
    refetchInterval: (query) => {
      if (query.state.error) return false;
      return 5000;
    },
  });

  // Fetch session commits
  const commitsQuery = useQuery({
    queryKey: ['session', sessionId, 'commits'],
    queryFn: () => api.commits.list(sessionId!),
    enabled: !!sessionId && !sessionQuery.error,
    retry: shouldRetry,
    refetchInterval: (query) => {
      if (query.state.error) return false;
      return 10000;
    },
  });

  // Fetch session activity
  const activityQuery = useQuery({
    queryKey: ['session', sessionId, 'activity'],
    queryFn: () => api.sessions.getActivity(sessionId!, 50),
    enabled: !!sessionId && !sessionQuery.error,
    retry: shouldRetry,
    refetchInterval: (query) => {
      if (query.state.error) return false;
      return 2000;
    },
  });

  // Fetch session metrics
  const metricsQuery = useQuery({
    queryKey: ['session', sessionId, 'metrics'],
    queryFn: () => api.sessions.getMetrics(sessionId!),
    enabled: !!sessionId && !sessionQuery.error,
    retry: shouldRetry,
    refetchInterval: (query) => {
      if (query.state.error) return false;
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
    if (sessionQuery.data) {
      setCurrentSession(sessionQuery.data);
    }
  }, [sessionQuery.data, setCurrentSession]);

  useEffect(() => {
    if (statsQuery.data) {
      setStats(statsQuery.data);
    }
  }, [statsQuery.data, setStats]);

  useEffect(() => {
    if (issuesQuery.data) {
      setIssues(issuesQuery.data);
    }
  }, [issuesQuery.data, setIssues]);

  useEffect(() => {
    if (commitsQuery.data) {
      setCommits(commitsQuery.data);
    }
  }, [commitsQuery.data, setCommits]);

  useEffect(() => {
    if (activityQuery.data) {
      setActivities(activityQuery.data);
    }
  }, [activityQuery.data, setActivities]);

  useEffect(() => {
    if (metricsQuery.data) {
      setMetrics(metricsQuery.data);
    }
  }, [metricsQuery.data, setMetrics]);

  // Update loading/error state
  useEffect(() => {
    setLoading(sessionQuery.isLoading);
    setError(sessionQuery.error?.message || null);
  }, [sessionQuery.isLoading, sessionQuery.error, setLoading, setError]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (data: CreateSessionRequest) => {
      // Create the session
      const session = await api.sessions.create(data);
      // Auto-start the session after creation
      try {
        return await api.sessions.start(session.id);
      } catch {
        // If start fails, return the created session anyway
        return session;
      }
    },
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      navigate(`/session/${session.id}`);
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (id: string) => api.sessions.pause(id),
    onSuccess: (session) => {
      updateSession(session.id, session);
      queryClient.invalidateQueries({ queryKey: ['session', session.id] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (id: string) => api.sessions.resume(id),
    onSuccess: (session) => {
      updateSession(session.id, session);
      queryClient.invalidateQueries({ queryKey: ['session', session.id] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: (id: string) => api.sessions.stop(id),
    onSuccess: (session) => {
      updateSession(session.id, session);
      queryClient.invalidateQueries({ queryKey: ['session', session.id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.sessions.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      if (sessionId === id) {
        resetIssues();
        navigate('/');
      }
    },
  });

  // Actions
  const createSession = useCallback(
    (data: CreateSessionRequest) => createMutation.mutateAsync(data),
    [createMutation]
  );

  const pauseSession = useCallback(
    (id?: string) => {
      const targetId = id || sessionId;
      if (targetId) {
        return pauseMutation.mutateAsync(targetId);
      }
    },
    [pauseMutation, sessionId]
  );

  const resumeSession = useCallback(
    (id?: string) => {
      const targetId = id || sessionId;
      if (targetId) {
        return resumeMutation.mutateAsync(targetId);
      }
    },
    [resumeMutation, sessionId]
  );

  const stopSession = useCallback(
    (id?: string) => {
      const targetId = id || sessionId;
      if (targetId) {
        return stopMutation.mutateAsync(targetId);
      }
    },
    [stopMutation, sessionId]
  );

  const deleteSession = useCallback(
    (id?: string) => {
      const targetId = id || sessionId;
      if (targetId) {
        return deleteMutation.mutateAsync(targetId);
      }
    },
    [deleteMutation, sessionId]
  );

  const refreshSession = useCallback(() => {
    if (sessionId) {
      queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
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
export function useSessions() {
  const { setSessions, setLoading, setError } = useSessionStore();

  const query = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.sessions.list(),
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (query.data) {
      setSessions(query.data);
    }
  }, [query.data, setSessions]);

  useEffect(() => {
    setLoading(query.isLoading);
    setError(query.error?.message || null);
  }, [query.isLoading, query.error, setLoading, setError]);

  return {
    sessions: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export default useSession;
