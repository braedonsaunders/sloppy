/**
 * REST routes for GitHub integration
 *
 * Handles GitHub authentication, repository listing, and branch fetching.
 * GitHub connection is stored in the settings table like other configurations.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../db/database.js';
import { createGitHubService, GitHubService } from '../services/github.js';
import type { GitHubAuthConfig, GitHubUser, ListRepositoriesOptions } from '@sloppy/core';

// Settings key for GitHub configuration
const GITHUB_CONFIG_KEY = 'githubConfig';

// Request schemas
const ConnectGitHubSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

const ListRepositoriesSchema = z.object({
  page: z.coerce.number().min(1).optional(),
  perPage: z.coerce.number().min(1).max(100).optional(),
  sort: z.enum(['created', 'updated', 'pushed', 'full_name']).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
  visibility: z.enum(['all', 'public', 'private']).optional(),
  search: z.string().optional(),
});

const ListBranchesSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

// Response helpers
function sendSuccess<T>(reply: FastifyReply, data: T, statusCode = 200): void {
  void reply.code(statusCode).send({
    success: true,
    data,
  });
}

function sendError(reply: FastifyReply, message: string, statusCode = 400): void {
  void reply.code(statusCode).send({
    success: false,
    error: { message },
  });
}

/**
 * Get the stored GitHub configuration from settings.
 */
function getGitHubConfig(db: ReturnType<typeof getDatabase>): GitHubAuthConfig | null {
  const stmt = db.getRawDb().prepare('SELECT value FROM settings WHERE key = ?');
  const row = stmt.get(GITHUB_CONFIG_KEY) as { value: string } | undefined;

  if (!row) {
    return null;
  }

  try {
    return JSON.parse(row.value) as GitHubAuthConfig;
  } catch {
    return null;
  }
}

/**
 * Save GitHub configuration to settings.
 */
function saveGitHubConfig(db: ReturnType<typeof getDatabase>, config: GitHubAuthConfig | null): void {
  if (config === null) {
    const stmt = db.getRawDb().prepare('DELETE FROM settings WHERE key = ?');
    stmt.run(GITHUB_CONFIG_KEY);
  } else {
    const stmt = db.getRawDb().prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    stmt.run(GITHUB_CONFIG_KEY, JSON.stringify(config));
  }
}

/**
 * Get a GitHub service instance using stored token.
 */
function getGitHubService(db: ReturnType<typeof getDatabase>): GitHubService | null {
  const config = getGitHubConfig(db);
  if (!config || !config.token) {
    return null;
  }
  return createGitHubService(config.token);
}

/**
 * Register GitHub routes.
 */
export async function registerGitHubRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase();

  /**
   * GET /api/github/status - Get GitHub connection status
   */
  app.get('/api/github/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const config = getGitHubConfig(db);

      if (!config) {
        sendSuccess(reply, {
          connected: false,
          user: null,
          configuredAt: null,
        });
        return;
      }

      sendSuccess(reply, {
        connected: true,
        user: config.user ?? null,
        scopes: config.scopes ?? [],
        configuredAt: config.configuredAt,
      });
    } catch (error) {
      app.log.error({ error }, 'Failed to get GitHub status');
      sendError(reply, error instanceof Error ? error.message : 'Failed to get GitHub status', 500);
    }
  });

  /**
   * POST /api/github/connect - Connect GitHub with a Personal Access Token
   */
  app.post('/api/github/connect', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = ConnectGitHubSchema.parse(request.body);

      // Test the token
      const service = createGitHubService(body.token);
      const testResult = await service.testAuth();

      if (!testResult.success) {
        sendError(reply, testResult.error ?? 'Invalid token', 401);
        return;
      }

      // Store the configuration
      const config: GitHubAuthConfig = {
        token: body.token,
        user: testResult.user,
        scopes: testResult.scopes,
        configuredAt: new Date().toISOString(),
      };

      saveGitHubConfig(db, config);

      app.log.info({ user: testResult.user?.login }, 'GitHub connected successfully');

      sendSuccess(reply, {
        connected: true,
        user: testResult.user,
        scopes: testResult.scopes,
        rateLimit: testResult.rateLimit,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to connect GitHub');
      sendError(reply, error instanceof Error ? error.message : 'Failed to connect GitHub', 500);
    }
  });

  /**
   * POST /api/github/disconnect - Disconnect GitHub
   */
  app.post('/api/github/disconnect', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      saveGitHubConfig(db, null);

      app.log.info('GitHub disconnected');

      sendSuccess(reply, { disconnected: true });
    } catch (error) {
      app.log.error({ error }, 'Failed to disconnect GitHub');
      sendError(reply, error instanceof Error ? error.message : 'Failed to disconnect GitHub', 500);
    }
  });

  /**
   * POST /api/github/test - Test current GitHub connection
   */
  app.post('/api/github/test', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const service = getGitHubService(db);

      if (!service) {
        sendError(reply, 'GitHub is not connected', 401);
        return;
      }

      const testResult = await service.testAuth();

      if (!testResult.success) {
        // Token may have been revoked - clear the config
        saveGitHubConfig(db, null);
        sendError(reply, testResult.error ?? 'Token is invalid or expired', 401);
        return;
      }

      // Update stored user info and scopes
      const config = getGitHubConfig(db);
      if (config) {
        config.user = testResult.user;
        config.scopes = testResult.scopes;
        saveGitHubConfig(db, config);
      }

      sendSuccess(reply, {
        success: true,
        user: testResult.user,
        scopes: testResult.scopes,
        rateLimit: testResult.rateLimit,
      });
    } catch (error) {
      app.log.error({ error }, 'Failed to test GitHub connection');
      sendError(reply, error instanceof Error ? error.message : 'Failed to test GitHub connection', 500);
    }
  });

  /**
   * GET /api/github/repositories - List user's repositories
   */
  app.get('/api/github/repositories', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const service = getGitHubService(db);

      if (!service) {
        sendError(reply, 'GitHub is not connected', 401);
        return;
      }

      const query = ListRepositoriesSchema.parse(request.query);

      const options: ListRepositoriesOptions = {
        page: query.page,
        perPage: query.perPage,
        sort: query.sort,
        direction: query.direction,
        visibility: query.visibility,
        search: query.search,
      };

      const result = await service.listRepositories(options);

      sendSuccess(reply, result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to list repositories');
      sendError(reply, error instanceof Error ? error.message : 'Failed to list repositories', 500);
    }
  });

  /**
   * GET /api/github/repositories/search - Search repositories
   */
  app.get('/api/github/repositories/search', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const service = getGitHubService(db);

      if (!service) {
        sendError(reply, 'GitHub is not connected', 401);
        return;
      }

      const query = z.object({
        q: z.string().min(1, 'Search query is required'),
        page: z.coerce.number().min(1).optional(),
        perPage: z.coerce.number().min(1).max(100).optional(),
      }).parse(request.query);

      const result = await service.searchRepositories(query.q, {
        page: query.page,
        perPage: query.perPage,
      });

      sendSuccess(reply, result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to search repositories');
      sendError(reply, error instanceof Error ? error.message : 'Failed to search repositories', 500);
    }
  });

  /**
   * GET /api/github/repositories/:owner/:repo - Get repository details
   */
  app.get('/api/github/repositories/:owner/:repo', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const service = getGitHubService(db);

      if (!service) {
        sendError(reply, 'GitHub is not connected', 401);
        return;
      }

      const params = ListBranchesSchema.parse(request.params);
      const repo = await service.getRepository(params.owner, params.repo);

      sendSuccess(reply, { repository: repo });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to get repository');
      sendError(reply, error instanceof Error ? error.message : 'Failed to get repository', 500);
    }
  });

  /**
   * GET /api/github/repositories/:owner/:repo/branches - List repository branches
   */
  app.get('/api/github/repositories/:owner/:repo/branches', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const service = getGitHubService(db);

      if (!service) {
        sendError(reply, 'GitHub is not connected', 401);
        return;
      }

      const params = ListBranchesSchema.parse(request.params);
      const branches = await service.listBranches(params.owner, params.repo);

      sendSuccess(reply, { branches });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to list branches');
      sendError(reply, error instanceof Error ? error.message : 'Failed to list branches', 500);
    }
  });

  app.log.info('[routes] GitHub routes registered');
}
