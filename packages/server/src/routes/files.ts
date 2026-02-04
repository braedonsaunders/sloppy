/**
 * REST routes for file system browsing
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Request schemas
const BrowseQuerySchema = z.object({
  path: z.string().optional(),
});

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
}

export interface BrowseResponse {
  currentPath: string;
  parentPath: string | null;
  entries: FileEntry[];
}

// Response helpers
function sendSuccess(reply: FastifyReply, data: BrowseResponse, statusCode = 200): void {
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
 * Register file routes
 */
export function registerFileRoutes(app: FastifyInstance): void {
  /**
   * GET /api/files/browse - Browse directory contents
   */
  app.get('/api/files/browse', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = BrowseQuerySchema.parse(request.query);

      // Default to home directory if no path provided
      let targetPath = query.path ?? os.homedir();

      // Resolve to absolute path
      targetPath = path.resolve(targetPath);

      // Verify the path exists and is a directory
      let stats;
      try {
        stats = await fs.stat(targetPath);
      } catch {
        sendError(reply, `Path does not exist: ${targetPath}`, 404);
        return;
      }

      if (!stats.isDirectory()) {
        sendError(reply, `Path is not a directory: ${targetPath}`, 400);
        return;
      }

      // Read directory contents
      const dirEntries = await fs.readdir(targetPath, { withFileTypes: true });

      // Filter and map entries
      const entries: FileEntry[] = [];

      for (const entry of dirEntries) {
        // Skip hidden files (starting with .)
        if (entry.name.startsWith('.')) {
          continue;
        }

        const entryPath = path.join(targetPath, entry.name);

        try {
          const entryStats = await fs.stat(entryPath);

          entries.push({
            name: entry.name,
            path: entryPath,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: entry.isFile() ? entryStats.size : undefined,
            modifiedAt: entryStats.mtime.toISOString(),
          });
        } catch {
          // Skip entries we can't access
          continue;
        }
      }

      // Sort: directories first, then alphabetically
      entries.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') {
          return -1;
        }
        if (a.type !== 'directory' && b.type === 'directory') {
          return 1;
        }
        return a.name.localeCompare(b.name);
      });

      // Get parent path
      const parentPath = targetPath === '/' ? null : path.dirname(targetPath);

      const response: BrowseResponse = {
        currentPath: targetPath,
        parentPath,
        entries,
      };

      sendSuccess(reply, response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to browse files');
      sendError(reply, error instanceof Error ? error.message : 'Failed to browse files', 500);
    }
  });

  app.log.info('[routes] File routes registered');
}
