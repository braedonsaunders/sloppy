/**
 * File tree and viewer routes for browsing repository contents
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname, relative, basename } from 'node:path';

function sendSuccess<T>(reply: FastifyReply, data: T, statusCode = 200): void {
  void reply.code(statusCode).send({ success: true, data });
}

function sendError(reply: FastifyReply, message: string, statusCode = 400): void {
  void reply.code(statusCode).send({ success: false, error: { message } });
}

interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  extension?: string;
  children?: FileTreeNode[];
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '__pycache__', '.venv', 'venv', 'target', 'vendor',
  '.next', '.nuxt', '.cache', '.parcel-cache', 'out',
]);

const MAX_FILE_SIZE = 1024 * 1024; // 1MB max for file viewer
const MAX_TREE_DEPTH = 10;

async function buildFileTree(
  dirPath: string,
  rootPath: string,
  depth = 0,
): Promise<FileTreeNode[]> {
  if (depth > MAX_TREE_DEPTH) return [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const nodes: FileTreeNode[] = [];

    // Sort: directories first, then files, both alphabetically
    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = join(dirPath, entry.name);
      const relativePath = relative(rootPath, fullPath);

      if (entry.isDirectory()) {
        const children = await buildFileTree(fullPath, rootPath, depth + 1);
        nodes.push({
          name: entry.name,
          path: relativePath,
          type: 'directory',
          children,
        });
      } else {
        try {
          const fileStat = await stat(fullPath);
          nodes.push({
            name: entry.name,
            path: relativePath,
            type: 'file',
            size: fileStat.size,
            extension: extname(entry.name),
          });
        } catch {
          nodes.push({
            name: entry.name,
            path: relativePath,
            type: 'file',
            extension: extname(entry.name),
          });
        }
      }
    }

    return nodes;
  } catch {
    return [];
  }
}

function getLanguageFromExtension(ext: string): string {
  const languageMap: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
    '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java',
    '.kt': 'kotlin', '.rb': 'ruby', '.php': 'php', '.swift': 'swift',
    '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.cs': 'csharp',
    '.html': 'html', '.css': 'css', '.scss': 'scss', '.json': 'json',
    '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.xml': 'xml',
    '.md': 'markdown', '.sql': 'sql', '.sh': 'bash', '.bash': 'bash',
    '.vue': 'vue', '.svelte': 'svelte',
  };
  return languageMap[ext] ?? 'plaintext';
}

export async function registerFileTreeRoutes(app: FastifyInstance): Promise<void> {

  // Get full file tree for a repo path
  app.get('/api/file-tree', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = z.object({
        path: z.string().min(1),
        depth: z.coerce.number().min(1).max(10).optional().default(5),
      }).parse(request.query);

      const tree = await buildFileTree(query.path, query.path, 0);
      sendSuccess(reply, { root: query.path, tree });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, 'Path parameter is required', 400);
        return;
      }
      sendError(reply, error instanceof Error ? error.message : 'Failed to read file tree', 500);
    }
  });

  // Read file contents
  app.get('/api/file-viewer', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = z.object({
        path: z.string().min(1),
      }).parse(request.query);

      // Security: prevent path traversal
      if (query.path.includes('..')) {
        sendError(reply, 'Path traversal not allowed', 403);
        return;
      }

      const fileStat = await stat(query.path);

      if (fileStat.isDirectory()) {
        sendError(reply, 'Cannot view directory contents, use /api/file-tree', 400);
        return;
      }

      if (fileStat.size > MAX_FILE_SIZE) {
        sendError(reply, `File too large (${fileStat.size} bytes, max ${MAX_FILE_SIZE})`, 413);
        return;
      }

      const content = await readFile(query.path, 'utf-8');
      const ext = extname(query.path);

      sendSuccess(reply, {
        path: query.path,
        name: basename(query.path),
        content,
        language: getLanguageFromExtension(ext),
        size: fileStat.size,
        lines: content.split('\n').length,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, 'Path parameter is required', 400);
        return;
      }
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        sendError(reply, 'File not found', 404);
        return;
      }
      sendError(reply, error instanceof Error ? error.message : 'Failed to read file', 500);
    }
  });

  app.log.info('[routes] File tree routes registered');
}
