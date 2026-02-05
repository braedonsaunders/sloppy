const API_BASE = '/api';

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
  if (options.body !== undefined && options.body !== null) {
    headers['Content-Type'] = 'application/json';
  }

  const config: RequestInit = {
    ...options,
    headers,
  };

  const response = await fetch(url, config);

  if (!response.ok) {
    const errorData: unknown = await response.json().catch((): ApiError => ({
      message: response.statusText,
    }));
    const error = errorData as ApiError;
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

  const json: unknown = await response.json();

  // Unwrap server response format: { success: true, data: ... }
  let data: unknown;
  if (json !== null && typeof json === 'object' && 'success' in json && 'data' in json) {
    data = (json as { success: boolean; data: unknown }).data;
  } else {
    data = json;
  }

  // Normalize snake_case keys to camelCase
  return normalizeKeys(data) as T;
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

// Score Types
export interface ScoreBreakdown {
  security: number;
  bugs: number;
  codeQuality: number;
  maintainability: number;
  reliability: number;
  improvement: number;
}

export interface ScoreData {
  id: string;
  sessionId: string;
  score: number;
  breakdown: ScoreBreakdown;
  issuesBefore: number;
  issuesAfter: number;
  computedAt: string;
}

interface ScoreResponse {
  score: ScoreData | null;
}

// GitHub Types
export interface GitHubUser {
  id: number;
  login: string;
  name?: string;
  avatarUrl?: string;
  htmlUrl?: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  owner: {
    id: number;
    login: string;
    avatarUrl?: string;
  };
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
  description?: string;
  private: boolean;
  fork: boolean;
  defaultBranch: string;
  language?: string;
  stargazersCount: number;
  forksCount: number;
  updatedAt: string;
  pushedAt?: string;
}

export interface GitHubBranch {
  name: string;
  protected: boolean;
  commitSha: string;
}

export interface GitHubStatus {
  connected: boolean;
  user: GitHubUser | null;
  scopes?: string[];
  configuredAt: string | null;
}

export interface GitHubConnectResult {
  connected: boolean;
  user?: GitHubUser;
  scopes?: string[];
  rateLimit?: {
    limit: number;
    remaining: number;
    reset: string;
  };
}

export interface GitHubRepoListResponse {
  repositories: GitHubRepository[];
  totalCount: number;
  page: number;
  perPage: number;
  hasMore: boolean;
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
    list: async (): Promise<Session[]> => {
      const res = await request<SessionsResponse>('/sessions');
      return res.sessions;
    },

    get: async (id: string): Promise<Session> => {
      const res = await request<SessionDetailResponse>(`/sessions/${id}`);
      return res.session;
    },

    create: (data: CreateSessionRequest): Promise<Session> =>
      request<Session>('/sessions', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    start: (id: string): Promise<Session> =>
      request<Session>(`/sessions/${id}/start`, { method: 'POST' }),

    pause: (id: string): Promise<Session> =>
      request<Session>(`/sessions/${id}/pause`, { method: 'POST' }),

    resume: (id: string): Promise<Session> =>
      request<Session>(`/sessions/${id}/resume`, { method: 'POST' }),

    stop: (id: string): Promise<Session> =>
      request<Session>(`/sessions/${id}/stop`, { method: 'POST' }),

    delete: (id: string): Promise<void> =>
      request<undefined>(`/sessions/${id}`, { method: 'DELETE' }).then(() => undefined),

    getStats: (id: string): Promise<SessionStats> => request<SessionStats>(`/sessions/${id}/stats`),

    getMetrics: async (id: string, since?: string): Promise<Metrics[]> => {
      const query = since !== undefined && since !== '' ? `?since=${since}` : '';
      const res = await request<MetricsResponse>(`/sessions/${id}/metrics${query}`);
      return res.metrics;
    },

    getActivity: (id: string, limit?: number): Promise<Activity[]> => {
      const query = limit !== undefined && limit > 0 ? `?limit=${String(limit)}` : '';
      return request<Activity[]>(`/sessions/${id}/activity${query}`);
    },
  },

  // Issues
  issues: {
    list: async (sessionId: string, filters?: { status?: string; type?: string }): Promise<Issue[]> => {
      const params = new URLSearchParams();
      if (filters?.status !== undefined && filters.status !== '') {
        params.set('status', filters.status);
      }
      if (filters?.type !== undefined && filters.type !== '') {
        params.set('type', filters.type);
      }
      const query = params.toString();
      const res = await request<IssuesResponse>(
        `/sessions/${sessionId}/issues${query !== '' ? `?${query}` : ''}`
      );
      return res.issues;
    },

    get: (sessionId: string, issueId: string): Promise<Issue> =>
      request<Issue>(`/sessions/${sessionId}/issues/${issueId}`),

    approve: (sessionId: string, issueId: string): Promise<Issue> =>
      request<Issue>(`/sessions/${sessionId}/issues/${issueId}/approve`, {
        method: 'POST',
      }),

    reject: (sessionId: string, issueId: string): Promise<Issue> =>
      request<Issue>(`/sessions/${sessionId}/issues/${issueId}/reject`, {
        method: 'POST',
      }),

    skip: (sessionId: string, issueId: string): Promise<Issue> =>
      request<Issue>(`/sessions/${sessionId}/issues/${issueId}/skip`, {
        method: 'POST',
      }),
  },

  // Commits
  commits: {
    list: async (sessionId: string): Promise<Commit[]> => {
      const res = await request<CommitsResponse>(`/sessions/${sessionId}/commits`);
      return res.commits;
    },

    get: async (sessionId: string, commitId: string): Promise<Commit> => {
      const res = await request<{ commit: Commit; issue: Issue | null }>(`/sessions/${sessionId}/commits/${commitId}`);
      return res.commit;
    },

    revert: async (sessionId: string, commitId: string): Promise<Commit> => {
      const res = await request<{ commit: Commit; revertHash: string }>(`/sessions/${sessionId}/commits/${commitId}/revert`, {
        method: 'POST',
      });
      return res.commit;
    },
  },

  // Scores
  scores: {
    get: async (sessionId: string): Promise<ScoreData | null> => {
      const res = await request<ScoreResponse>(`/sessions/${sessionId}/score`);
      return res.score;
    },

    compute: async (sessionId: string): Promise<ScoreData | null> => {
      const res = await request<ScoreResponse>(`/sessions/${sessionId}/score`, {
        method: 'POST',
      });
      return res.score;
    },
  },

  // Providers
  providers: {
    list: (): Promise<Provider[]> => request<Provider[]>('/providers'),

    get: (id: string): Promise<Provider> => request<Provider>(`/providers/${id}`),

    configure: (config: ProviderConfig): Promise<Provider> =>
      request<Provider>('/providers/configure', {
        method: 'POST',
        body: JSON.stringify(config),
      }),

    test: (providerId: string): Promise<{ success: boolean; message?: string; models?: string[] }> =>
      request<{ success: boolean; message?: string; models?: string[] }>(
        `/providers/${providerId}/test`,
        { method: 'POST' }
      ),

    refreshModels: (providerId: string): Promise<{ provider: Provider; modelsFound: number }> =>
      request<{ provider: Provider; modelsFound: number }>(
        `/providers/${providerId}/refresh-models`,
        { method: 'POST' }
      ),

    selectModel: (providerId: string, model: string): Promise<Provider> =>
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
    get: (): Promise<Record<string, unknown>> => request<Record<string, unknown>>('/settings'),

    update: (settings: Record<string, unknown>): Promise<Record<string, unknown>> =>
      request<Record<string, unknown>>('/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      }),
  },

  // Health
  health: (): Promise<{ status: string; version: string }> => request<{ status: string; version: string }>('/health'),

  // Files
  files: {
    browse: (path?: string): Promise<{
      currentPath: string;
      parentPath: string | null;
      entries: {
        name: string;
        path: string;
        type: 'file' | 'directory';
        size?: number;
        modifiedAt?: string;
      }[];
    }> => {
      const params = path !== undefined && path !== '' ? `?path=${encodeURIComponent(path)}` : '';
      return request<{
        currentPath: string;
        parentPath: string | null;
        entries: {
          name: string;
          path: string;
          type: 'file' | 'directory';
          size?: number;
          modifiedAt?: string;
        }[];
      }>(`/files/browse${params}`);
    },
  },

  // Detection
  detect: {
    /** Detect which providers have API keys set in the environment */
    providers: (): Promise<{ detectedProviders: Record<string, boolean> }> =>
      request<{ detectedProviders: Record<string, boolean> }>('/detect/providers'),
  },

  // GitHub
  github: {
    /** Get GitHub connection status */
    status: (): Promise<GitHubStatus> =>
      request<GitHubStatus>('/github/status'),

    /** Connect GitHub with a Personal Access Token */
    connect: (token: string): Promise<GitHubConnectResult> =>
      request<GitHubConnectResult>('/github/connect', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),

    /** Disconnect GitHub */
    disconnect: (): Promise<{ disconnected: boolean }> =>
      request<{ disconnected: boolean }>('/github/disconnect', {
        method: 'POST',
      }),

    /** Test current GitHub connection */
    test: (): Promise<{
      success: boolean;
      user?: GitHubUser;
      scopes?: string[];
      rateLimit?: { limit: number; remaining: number; reset: string };
    }> =>
      request<{
        success: boolean;
        user?: GitHubUser;
        scopes?: string[];
        rateLimit?: { limit: number; remaining: number; reset: string };
      }>('/github/test', { method: 'POST' }),

    /** List user's repositories */
    listRepositories: (options?: {
      page?: number;
      perPage?: number;
      sort?: 'created' | 'updated' | 'pushed' | 'full_name';
      direction?: 'asc' | 'desc';
      visibility?: 'all' | 'public' | 'private';
      search?: string;
    }): Promise<GitHubRepoListResponse> => {
      const params = new URLSearchParams();
      if (options?.page !== undefined) { params.set('page', String(options.page)); }
      if (options?.perPage !== undefined) { params.set('perPage', String(options.perPage)); }
      if (options?.sort !== undefined) { params.set('sort', options.sort); }
      if (options?.direction !== undefined) { params.set('direction', options.direction); }
      if (options?.visibility !== undefined) { params.set('visibility', options.visibility); }
      if (options?.search !== undefined && options.search !== '') { params.set('search', options.search); }
      const query = params.toString();
      return request<GitHubRepoListResponse>(`/github/repositories${query !== '' ? `?${query}` : ''}`);
    },

    /** Search repositories */
    searchRepositories: (query: string, options?: { page?: number; perPage?: number }): Promise<GitHubRepoListResponse> => {
      const params = new URLSearchParams({ q: query });
      if (options?.page !== undefined) { params.set('page', String(options.page)); }
      if (options?.perPage !== undefined) { params.set('perPage', String(options.perPage)); }
      return request<GitHubRepoListResponse>(`/github/repositories/search?${params.toString()}`);
    },

    /** Get repository details */
    getRepository: (owner: string, repo: string): Promise<{ repository: GitHubRepository }> =>
      request<{ repository: GitHubRepository }>(`/github/repositories/${owner}/${repo}`),

    /** List repository branches */
    listBranches: (owner: string, repo: string): Promise<{ branches: GitHubBranch[] }> =>
      request<{ branches: GitHubBranch[] }>(`/github/repositories/${owner}/${repo}/branches`),
  },
};

export default api;
