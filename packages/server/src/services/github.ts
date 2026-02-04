/**
 * GitHub Service
 *
 * Handles GitHub API operations including authentication and repository listing.
 * Uses the GitHub REST API with Personal Access Tokens for authentication.
 */

import type {
  GitHubUser,
  GitHubRepository,
  GitHubBranch,
  GitHubAuthTestResult,
  GitHubRepoListResponse,
  ListRepositoriesOptions,
} from '@sloppy/core';

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * GitHub API client for making authenticated requests.
 */
export class GitHubService {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  /**
   * Make an authenticated request to the GitHub API.
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<{ data: T; headers: Headers }> {
    const url = endpoint.startsWith('http') ? endpoint : `${GITHUB_API_BASE}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText })) as { message: string };
      throw new Error(`GitHub API error: ${error.message} (${response.status})`);
    }

    const data = await response.json() as T;
    return { data, headers: response.headers };
  }

  /**
   * Test the authentication token and get user information.
   */
  async testAuth(): Promise<GitHubAuthTestResult> {
    try {
      const { data: user, headers } = await this.request<GitHubApiUser>('/user');

      // Extract scopes from response headers
      const scopeHeader = headers.get('x-oauth-scopes');
      const scopes = scopeHeader ? scopeHeader.split(', ').filter(Boolean) : [];

      // Extract rate limit info
      const rateLimit = {
        limit: parseInt(headers.get('x-ratelimit-limit') ?? '0', 10),
        remaining: parseInt(headers.get('x-ratelimit-remaining') ?? '0', 10),
        reset: new Date(parseInt(headers.get('x-ratelimit-reset') ?? '0', 10) * 1000).toISOString(),
      };

      return {
        success: true,
        user: mapUser(user),
        scopes,
        rateLimit,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed',
      };
    }
  }

  /**
   * Get the authenticated user's information.
   */
  async getUser(): Promise<GitHubUser> {
    const { data: user } = await this.request<GitHubApiUser>('/user');
    return mapUser(user);
  }

  /**
   * List repositories for the authenticated user.
   */
  async listRepositories(options: ListRepositoriesOptions = {}): Promise<GitHubRepoListResponse> {
    const {
      page = 1,
      perPage = 30,
      sort = 'updated',
      direction = 'desc',
      visibility = 'all',
      affiliation = ['owner', 'collaborator', 'organization_member'],
    } = options;

    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
      sort,
      direction,
      visibility,
      affiliation: affiliation.join(','),
    });

    const { data: repos, headers } = await this.request<GitHubApiRepository[]>(
      `/user/repos?${params.toString()}`
    );

    // Check for Link header to determine if there are more pages
    const linkHeader = headers.get('link');
    const hasMore = linkHeader ? linkHeader.includes('rel="next"') : false;

    // Filter by search query if provided
    let filteredRepos = repos;
    if (options.search) {
      const searchLower = options.search.toLowerCase();
      filteredRepos = repos.filter(
        (repo) =>
          repo.name.toLowerCase().includes(searchLower) ||
          repo.full_name.toLowerCase().includes(searchLower) ||
          (repo.description && repo.description.toLowerCase().includes(searchLower))
      );
    }

    return {
      repositories: filteredRepos.map(mapRepository),
      totalCount: filteredRepos.length,
      page,
      perPage,
      hasMore,
    };
  }

  /**
   * Search repositories accessible to the user.
   */
  async searchRepositories(query: string, options: { page?: number; perPage?: number } = {}): Promise<GitHubRepoListResponse> {
    const { page = 1, perPage = 30 } = options;

    // Search in user's repos and repos user has access to
    const params = new URLSearchParams({
      q: `${query} user:@me fork:true`,
      page: String(page),
      per_page: String(perPage),
      sort: 'updated',
      order: 'desc',
    });

    try {
      const { data, headers } = await this.request<{ items: GitHubApiRepository[]; total_count: number }>(
        `/search/repositories?${params.toString()}`
      );

      const linkHeader = headers.get('link');
      const hasMore = linkHeader ? linkHeader.includes('rel="next"') : false;

      return {
        repositories: data.items.map(mapRepository),
        totalCount: data.total_count,
        page,
        perPage,
        hasMore,
      };
    } catch {
      // Fall back to filtering from listRepositories if search fails
      const allRepos = await this.listRepositories({ page, perPage, search: query });
      return allRepos;
    }
  }

  /**
   * Get repository details.
   */
  async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
    const { data } = await this.request<GitHubApiRepository>(`/repos/${owner}/${repo}`);
    return mapRepository(data);
  }

  /**
   * List branches for a repository.
   */
  async listBranches(owner: string, repo: string, options: { page?: number; perPage?: number } = {}): Promise<GitHubBranch[]> {
    const { page = 1, perPage = 100 } = options;

    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
    });

    const { data: branches } = await this.request<GitHubApiBranch[]>(
      `/repos/${owner}/${repo}/branches?${params.toString()}`
    );

    return branches.map(mapBranch);
  }
}

// =============================================================================
// GitHub API Response Types (snake_case from API)
// =============================================================================

interface GitHubApiUser {
  id: number;
  login: string;
  name?: string | null;
  avatar_url: string;
  html_url: string;
}

interface GitHubApiRepository {
  id: number;
  name: string;
  full_name: string;
  owner: GitHubApiUser;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  description?: string | null;
  private: boolean;
  fork: boolean;
  default_branch: string;
  language?: string | null;
  stargazers_count: number;
  forks_count: number;
  updated_at: string;
  pushed_at?: string | null;
}

interface GitHubApiBranch {
  name: string;
  protected: boolean;
  commit: {
    sha: string;
  };
}

// =============================================================================
// Mapping Functions (snake_case -> camelCase)
// =============================================================================

function mapUser(user: GitHubApiUser): GitHubUser {
  return {
    id: user.id,
    login: user.login,
    name: user.name ?? undefined,
    avatarUrl: user.avatar_url,
    htmlUrl: user.html_url,
  };
}

function mapRepository(repo: GitHubApiRepository): GitHubRepository {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    owner: {
      id: repo.owner.id,
      login: repo.owner.login,
      avatarUrl: repo.owner.avatar_url,
    },
    htmlUrl: repo.html_url,
    cloneUrl: repo.clone_url,
    sshUrl: repo.ssh_url,
    description: repo.description ?? undefined,
    private: repo.private,
    fork: repo.fork,
    defaultBranch: repo.default_branch,
    language: repo.language ?? undefined,
    stargazersCount: repo.stargazers_count,
    forksCount: repo.forks_count,
    updatedAt: repo.updated_at,
    pushedAt: repo.pushed_at ?? undefined,
  };
}

function mapBranch(branch: GitHubApiBranch): GitHubBranch {
  return {
    name: branch.name,
    protected: branch.protected,
    commitSha: branch.commit.sha,
  };
}

/**
 * Create a GitHub service instance from a token.
 */
export function createGitHubService(token: string): GitHubService {
  return new GitHubService(token);
}
