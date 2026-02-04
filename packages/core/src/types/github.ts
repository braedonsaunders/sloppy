/**
 * GitHub Types and Interfaces
 *
 * Defines the structure for GitHub authentication and repository data.
 * Used for integrating with GitHub to fetch user repositories.
 */

/**
 * GitHub user information.
 */
export interface GitHubUser {
  /** GitHub user ID */
  id: number;

  /** GitHub username (login) */
  login: string;

  /** User's display name */
  name?: string;

  /** User's avatar URL */
  avatarUrl?: string;

  /** User's profile URL */
  htmlUrl?: string;
}

/**
 * GitHub repository owner information (subset of user).
 */
export interface GitHubRepoOwner {
  /** GitHub user ID */
  id: number;

  /** GitHub username (login) */
  login: string;

  /** Owner's avatar URL */
  avatarUrl?: string;
}

/**
 * GitHub repository information.
 */
export interface GitHubRepository {
  /** Repository ID */
  id: number;

  /** Repository name (without owner) */
  name: string;

  /** Full repository name (owner/repo) */
  fullName: string;

  /** Repository owner */
  owner: GitHubRepoOwner;

  /** Repository URL */
  htmlUrl: string;

  /** Clone URL (HTTPS) */
  cloneUrl: string;

  /** SSH clone URL */
  sshUrl: string;

  /** Repository description */
  description?: string;

  /** Whether the repository is private */
  private: boolean;

  /** Whether the repository is a fork */
  fork: boolean;

  /** Default branch name */
  defaultBranch: string;

  /** Repository language */
  language?: string;

  /** Number of stars */
  stargazersCount: number;

  /** Number of forks */
  forksCount: number;

  /** Last update timestamp */
  updatedAt: string;

  /** Last push timestamp */
  pushedAt?: string;
}

/**
 * GitHub branch information.
 */
export interface GitHubBranch {
  /** Branch name */
  name: string;

  /** Whether this is a protected branch */
  protected: boolean;

  /** Latest commit SHA */
  commitSha: string;
}

/**
 * GitHub authentication configuration stored in settings.
 */
export interface GitHubAuthConfig {
  /** Personal Access Token */
  token: string;

  /** Authenticated user information */
  user?: GitHubUser;

  /** Token scopes (permissions) */
  scopes?: string[];

  /** When the token was configured */
  configuredAt: string;
}

/**
 * Response when listing repositories.
 */
export interface GitHubRepoListResponse {
  /** List of repositories */
  repositories: GitHubRepository[];

  /** Total count of repositories */
  totalCount: number;

  /** Current page */
  page: number;

  /** Items per page */
  perPage: number;

  /** Whether there are more pages */
  hasMore: boolean;
}

/**
 * Options for listing repositories.
 */
export interface ListRepositoriesOptions {
  /** Page number (1-indexed) */
  page?: number;

  /** Items per page (max 100) */
  perPage?: number;

  /** Sort field */
  sort?: 'created' | 'updated' | 'pushed' | 'full_name';

  /** Sort direction */
  direction?: 'asc' | 'desc';

  /** Filter by visibility */
  visibility?: 'all' | 'public' | 'private';

  /** Filter by affiliation */
  affiliation?: ('owner' | 'collaborator' | 'organization_member')[];

  /** Search query to filter repositories by name */
  search?: string;
}

/**
 * Result of testing GitHub authentication.
 */
export interface GitHubAuthTestResult {
  /** Whether authentication was successful */
  success: boolean;

  /** Error message if authentication failed */
  error?: string;

  /** Authenticated user information if successful */
  user?: GitHubUser;

  /** Token scopes if successful */
  scopes?: string[];

  /** Rate limit information */
  rateLimit?: {
    limit: number;
    remaining: number;
    reset: string;
  };
}
