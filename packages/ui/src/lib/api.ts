const API_BASE = '/api';

export interface ApiError {
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  // Only set Content-Type: application/json if there's a body
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const config: RequestInit = {
    ...options,
    headers,
  };

  const response = await fetch(url, config);

  if (!response.ok) {
    const error: ApiError = await response.json().catch(() => ({
      message: response.statusText,
    }));
    throw new ApiClientError(
      error.message,
      response.status,
      error.code,
      error.details
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const json = await response.json();

  // Unwrap server response format: { success: true, data: ... }
  if (json && typeof json === 'object' && 'success' in json && 'data' in json) {
    return json.data as T;
  }

  return json as T;
}

// Session Types
export interface Session {
  id: string;
  repoPath: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'stopped';
  provider: string;
  model: string;
  startedAt: string;
  endedAt?: string;
  config: SessionConfig;
  stats: SessionStats;
}

export interface SessionConfig {
  maxTime?: number;
  strictness: 'low' | 'medium' | 'high';
  issueTypes: string[];
  testCommand?: string;
  lintCommand?: string;
  buildCommand?: string;
  approvalMode: boolean;
}

export interface SessionStats {
  issuesFound: number;
  issuesResolved: number;
  commitsCreated: number;
  elapsedTime: number;
  estimatedTimeRemaining?: number;
}

export interface CreateSessionRequest {
  repoPath: string;
  branch?: string;
  provider: string;
  model?: string;
  config: Partial<SessionConfig>;
}

// Issue Types
export interface Issue {
  id: string;
  sessionId: string;
  type: 'lint' | 'type' | 'test' | 'security' | 'performance' | 'style';
  severity: 'error' | 'warning' | 'info';
  file: string;
  line?: number;
  column?: number;
  message: string;
  code?: string;
  context?: string;
  status: 'pending' | 'in_progress' | 'resolved' | 'skipped' | 'approved' | 'rejected';
  commitId?: string;
  createdAt: string;
  resolvedAt?: string;
}

// Commit Types
export interface Commit {
  id: string;
  sessionId: string;
  hash: string;
  message: string;
  files: string[];
  diff: string;
  issueIds: string[];
  createdAt: string;
  reverted: boolean;
}

// Provider Types
export interface Provider {
  id: string;
  name: string;
  models: string[];
  configured: boolean;
  selectedModel: string | null;
}

export interface ProviderConfig {
  providerId: string;
  apiKey?: string;
  baseUrl?: string;
  options?: Record<string, unknown>;
}

// Activity Types
export interface Activity {
  id: string;
  sessionId: string;
  type: 'analyzing' | 'fixing' | 'testing' | 'committing' | 'waiting' | 'error';
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

// Metrics Types
export interface Metrics {
  timestamp: string;
  issuesFound: number;
  issuesResolved: number;
  testsPassing: number;
  testsFailing: number;
  lintErrors: number;
}

// Server response wrappers
interface SessionsResponse {
  sessions: Session[];
  count: number;
}

interface SessionDetailResponse {
  session: Session;
  issues: Issue[];
  commits: Commit[];
  metrics: Metrics[];
}

interface IssuesResponse {
  issues: Issue[];
  summary: {
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
  };
}

interface CommitsResponse {
  commits: Commit[];
  summary: {
    total: number;
    reverted: number;
  };
}

interface MetricsResponse {
  metrics: Metrics[];
  summary: {
    averageIssuesPerSnapshot: number;
    totalDataPoints: number;
  } | null;
}

// API Client
export const api = {
  // Sessions
  sessions: {
    list: async () => {
      const res = await request<SessionsResponse>('/sessions');
      return res.sessions;
    },

    get: async (id: string) => {
      const res = await request<SessionDetailResponse>(`/sessions/${id}`);
      return res.session;
    },

    create: (data: CreateSessionRequest) =>
      request<Session>('/sessions', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    pause: (id: string) =>
      request<Session>(`/sessions/${id}/pause`, { method: 'POST' }),

    resume: (id: string) =>
      request<Session>(`/sessions/${id}/resume`, { method: 'POST' }),

    stop: (id: string) =>
      request<Session>(`/sessions/${id}/stop`, { method: 'POST' }),

    delete: (id: string) =>
      request<void>(`/sessions/${id}`, { method: 'DELETE' }),

    getStats: (id: string) => request<SessionStats>(`/sessions/${id}/stats`),

    getMetrics: async (id: string, since?: string) => {
      const res = await request<MetricsResponse>(
        `/sessions/${id}/metrics${since ? `?since=${since}` : ''}`
      );
      return res.metrics;
    },

    getActivity: (id: string, limit?: number) =>
      request<Activity[]>(
        `/sessions/${id}/activity${limit ? `?limit=${limit}` : ''}`
      ),
  },

  // Issues
  issues: {
    list: async (sessionId: string, filters?: { status?: string; type?: string }) => {
      const params = new URLSearchParams();
      if (filters?.status) params.set('status', filters.status);
      if (filters?.type) params.set('type', filters.type);
      const query = params.toString();
      const res = await request<IssuesResponse>(
        `/sessions/${sessionId}/issues${query ? `?${query}` : ''}`
      );
      return res.issues;
    },

    get: (sessionId: string, issueId: string) =>
      request<Issue>(`/sessions/${sessionId}/issues/${issueId}`),

    approve: (sessionId: string, issueId: string) =>
      request<Issue>(`/sessions/${sessionId}/issues/${issueId}/approve`, {
        method: 'POST',
      }),

    reject: (sessionId: string, issueId: string) =>
      request<Issue>(`/sessions/${sessionId}/issues/${issueId}/reject`, {
        method: 'POST',
      }),

    skip: (sessionId: string, issueId: string) =>
      request<Issue>(`/sessions/${sessionId}/issues/${issueId}/skip`, {
        method: 'POST',
      }),
  },

  // Commits
  commits: {
    list: async (sessionId: string) => {
      const res = await request<CommitsResponse>(`/sessions/${sessionId}/commits`);
      return res.commits;
    },

    get: async (sessionId: string, commitId: string) => {
      const res = await request<{ commit: Commit; issue: Issue | null }>(`/sessions/${sessionId}/commits/${commitId}`);
      return res.commit;
    },

    revert: async (sessionId: string, commitId: string) => {
      const res = await request<{ commit: Commit; revertHash: string }>(`/sessions/${sessionId}/commits/${commitId}/revert`, {
        method: 'POST',
      });
      return res.commit;
    },
  },

  // Providers
  providers: {
    list: () => request<Provider[]>('/providers'),

    get: (id: string) => request<Provider>(`/providers/${id}`),

    configure: (config: ProviderConfig) =>
      request<Provider>('/providers/configure', {
        method: 'POST',
        body: JSON.stringify(config),
      }),

    test: (providerId: string) =>
      request<{ success: boolean; message?: string; models?: string[] }>(
        `/providers/${providerId}/test`,
        { method: 'POST' }
      ),

    refreshModels: (providerId: string) =>
      request<{ provider: Provider; modelsFound: number }>(
        `/providers/${providerId}/refresh-models`,
        { method: 'POST' }
      ),

    selectModel: (providerId: string, model: string) =>
      request<Provider>(
        `/providers/${providerId}/select-model`,
        {
          method: 'POST',
          body: JSON.stringify({ model }),
        }
      ),
  },

  // Settings
  settings: {
    get: () => request<Record<string, unknown>>('/settings'),

    update: (settings: Record<string, unknown>) =>
      request<Record<string, unknown>>('/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      }),
  },

  // Health
  health: () => request<{ status: string; version: string }>('/health'),
};

export default api;
