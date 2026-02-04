import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import type { Session, SessionStats, Activity, Metrics } from '@/lib/api';

export interface SessionState {
  // Current session
  currentSession: Session | null;
  stats: SessionStats | null;
  activities: Activity[];
  metrics: Metrics[];

  // Session list
  sessions: Session[];
  isLoading: boolean;
  error: string | null;

  // Actions
  setCurrentSession: (session: Session | null) => void;
  updateCurrentSession: (updates: Partial<Session>) => void;
  setStats: (stats: SessionStats | null) => void;
  updateStats: (updates: Partial<SessionStats>) => void;
  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  removeSession: (id: string) => void;
  addActivity: (activity: Activity) => void;
  setActivities: (activities: Activity[]) => void;
  addMetrics: (metrics: Metrics) => void;
  setMetrics: (metrics: Metrics[]) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  currentSession: null,
  stats: null,
  activities: [],
  metrics: [],
  sessions: [],
  isLoading: false,
  error: null,
};

export const useSessionStore = create<SessionState>()(
  devtools(
    subscribeWithSelector((set, _get) => ({
      ...initialState,

      setCurrentSession: (session) =>
        set({ currentSession: session }, false, 'setCurrentSession'),

      updateCurrentSession: (updates) =>
        set(
          (state) => ({
            currentSession: state.currentSession
              ? { ...state.currentSession, ...updates }
              : null,
          }),
          false,
          'updateCurrentSession'
        ),

      setStats: (stats) => set({ stats }, false, 'setStats'),

      updateStats: (updates) =>
        set(
          (state) => ({
            stats: state.stats ? { ...state.stats, ...updates } : null,
          }),
          false,
          'updateStats'
        ),

      setSessions: (sessions) => set({ sessions }, false, 'setSessions'),

      addSession: (session) =>
        set(
          (state) => ({
            sessions: [session, ...state.sessions],
          }),
          false,
          'addSession'
        ),

      updateSession: (id, updates) =>
        set(
          (state) => ({
            sessions: state.sessions.map((s) =>
              s.id === id ? { ...s, ...updates } : s
            ),
            currentSession:
              state.currentSession?.id === id
                ? { ...state.currentSession, ...updates }
                : state.currentSession,
          }),
          false,
          'updateSession'
        ),

      removeSession: (id) =>
        set(
          (state) => ({
            sessions: state.sessions.filter((s) => s.id !== id),
            currentSession:
              state.currentSession?.id === id ? null : state.currentSession,
          }),
          false,
          'removeSession'
        ),

      addActivity: (activity) =>
        set(
          (state) => ({
            activities: [activity, ...state.activities].slice(0, 100), // Keep last 100
          }),
          false,
          'addActivity'
        ),

      setActivities: (activities) =>
        set({ activities }, false, 'setActivities'),

      addMetrics: (metrics) =>
        set(
          (state) => ({
            metrics: [...state.metrics, metrics].slice(-60), // Keep last 60 data points
          }),
          false,
          'addMetrics'
        ),

      setMetrics: (metrics) => set({ metrics }, false, 'setMetrics'),

      setLoading: (isLoading) => set({ isLoading }, false, 'setLoading'),

      setError: (error) => set({ error }, false, 'setError'),

      reset: () => set(initialState, false, 'reset'),
    })),
    { name: 'session-store' }
  )
);

// Selectors
export const selectCurrentSession = (state: SessionState) => state.currentSession;
export const selectStats = (state: SessionState) => state.stats;
export const selectSessions = (state: SessionState) => state.sessions;
export const selectActivities = (state: SessionState) => state.activities;
export const selectMetrics = (state: SessionState) => state.metrics;
export const selectIsLoading = (state: SessionState) => state.isLoading;
export const selectError = (state: SessionState) => state.error;

export const selectActiveSession = (state: SessionState) =>
  state.sessions.find((s) => s.status === 'running');

export const selectRecentSessions = (state: SessionState) =>
  state.sessions.slice(0, 10);

export const selectSessionById = (id: string) => (state: SessionState) =>
  state.sessions.find((s) => s.id === id);

export default useSessionStore;
