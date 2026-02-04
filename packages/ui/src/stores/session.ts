import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import type { Session, SessionStats, Activity, Metrics } from '@/lib/api';
import type { LLMRequest } from '@/components/LLMRequestPanel';

export interface SessionState {
  // Current session
  currentSession: Session | null;
  stats: SessionStats | null;
  activities: Activity[];
  metrics: Metrics[];

  // LLM requests tracking
  llmRequests: LLMRequest[];
  activeLLMRequest: LLMRequest | undefined;

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

  // LLM request actions
  addLLMRequest: (request: LLMRequest) => void;
  updateLLMRequest: (id: string, updates: Partial<LLMRequest>) => void;
  setActiveLLMRequest: (request: LLMRequest | undefined) => void;
  clearLLMRequests: () => void;

  reset: () => void;
}

const initialState = {
  currentSession: null,
  stats: null,
  activities: [] as Activity[],
  metrics: [] as Metrics[],
  llmRequests: [] as LLMRequest[],
  activeLLMRequest: undefined as LLMRequest | undefined,
  sessions: [] as Session[],
  isLoading: false,
  error: null as string | null,
};

export const useSessionStore = create<SessionState>()(
  devtools(
    subscribeWithSelector((set, _get) => ({
      ...initialState,

      setCurrentSession: (session: Session | null): void => {
        set({ currentSession: session }, false, 'setCurrentSession');
      },

      updateCurrentSession: (updates: Partial<Session>): void => {
        set(
          (state) => ({
            currentSession: state.currentSession
              ? { ...state.currentSession, ...updates }
              : null,
          }),
          false,
          'updateCurrentSession'
        );
      },

      setStats: (stats: SessionStats | null): void => {
        set({ stats }, false, 'setStats');
      },

      updateStats: (updates: Partial<SessionStats>): void => {
        set(
          (state) => ({
            stats: state.stats ? { ...state.stats, ...updates } : null,
          }),
          false,
          'updateStats'
        );
      },

      setSessions: (sessions: Session[]): void => {
        set({ sessions }, false, 'setSessions');
      },

      addSession: (session: Session): void => {
        set(
          (state) => ({
            sessions: [session, ...state.sessions],
          }),
          false,
          'addSession'
        );
      },

      updateSession: (id: string, updates: Partial<Session>): void => {
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
        );
      },

      removeSession: (id: string): void => {
        set(
          (state) => ({
            sessions: state.sessions.filter((s) => s.id !== id),
            currentSession:
              state.currentSession?.id === id ? null : state.currentSession,
          }),
          false,
          'removeSession'
        );
      },

      addActivity: (activity: Activity): void => {
        set(
          (state) => ({
            activities: [activity, ...state.activities].slice(0, 100), // Keep last 100
          }),
          false,
          'addActivity'
        );
      },

      setActivities: (activities: Activity[]): void => {
        set({ activities }, false, 'setActivities');
      },

      addMetrics: (metrics: Metrics): void => {
        set(
          (state) => ({
            metrics: [...state.metrics, metrics].slice(-60), // Keep last 60 data points
          }),
          false,
          'addMetrics'
        );
      },

      setMetrics: (metrics: Metrics[]): void => {
        set({ metrics }, false, 'setMetrics');
      },

      setLoading: (isLoading: boolean): void => {
        set({ isLoading }, false, 'setLoading');
      },

      setError: (error: string | null): void => {
        set({ error }, false, 'setError');
      },

      // LLM request actions
      addLLMRequest: (request: LLMRequest): void => {
        set(
          (state) => ({
            llmRequests: [...state.llmRequests, request],
          }),
          false,
          'addLLMRequest'
        );
      },

      updateLLMRequest: (id: string, updates: Partial<LLMRequest>): void => {
        set(
          (state) => ({
            llmRequests: state.llmRequests.map((r) =>
              r.id === id ? { ...r, ...updates } : r
            ),
            activeLLMRequest:
              state.activeLLMRequest?.id === id
                ? { ...state.activeLLMRequest, ...updates }
                : state.activeLLMRequest,
          }),
          false,
          'updateLLMRequest'
        );
      },

      setActiveLLMRequest: (request: LLMRequest | undefined): void => {
        set({ activeLLMRequest: request }, false, 'setActiveLLMRequest');
      },

      clearLLMRequests: (): void => {
        set({ llmRequests: [], activeLLMRequest: undefined }, false, 'clearLLMRequests');
      },

      reset: (): void => {
        set(initialState, false, 'reset');
      },
    })),
    { name: 'session-store' }
  )
);

// Selectors
export const selectCurrentSession = (state: SessionState): Session | null => state.currentSession;
export const selectStats = (state: SessionState): SessionStats | null => state.stats;
export const selectSessions = (state: SessionState): Session[] => state.sessions;
export const selectActivities = (state: SessionState): Activity[] => state.activities;
export const selectMetrics = (state: SessionState): Metrics[] => state.metrics;
export const selectIsLoading = (state: SessionState): boolean => state.isLoading;
export const selectError = (state: SessionState): string | null => state.error;
export const selectLLMRequests = (state: SessionState): LLMRequest[] => state.llmRequests;
export const selectActiveLLMRequest = (state: SessionState): LLMRequest | undefined => state.activeLLMRequest;

export const selectActiveSession = (state: SessionState): Session | undefined =>
  state.sessions.find((s) => s.status === 'running');

export const selectRecentSessions = (state: SessionState): Session[] =>
  state.sessions.slice(0, 10);

export const selectSessionById = (id: string): ((state: SessionState) => Session | undefined) =>
  (state: SessionState): Session | undefined => state.sessions.find((s) => s.id === id);

export default useSessionStore;
