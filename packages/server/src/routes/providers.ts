/**
 * REST routes for AI provider management
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../db/database.js';

// Request schemas
const ProviderIdParamsSchema = z.object({
  id: z.string().min(1, 'Provider ID is required'),
});

const ConfigureProviderSchema = z.object({
  providerId: z.string().min(1, 'Provider ID is required'),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional().or(z.literal('')),
  options: z.record(z.unknown()).optional(),
});

// Response types
interface ProviderRow {
  id: string;
  name: string;
  api_key: string | null;
  base_url: string | null;
  models: string;
  configured: number;
  options: string;
  created_at: string;
  updated_at: string;
}

interface Provider {
  id: string;
  name: string;
  models: string[];
  configured: boolean;
  baseUrl?: string;
  hasApiKey: boolean;
}

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

function rowToProvider(row: ProviderRow): Provider {
  return {
    id: row.id,
    name: row.name,
    models: JSON.parse(row.models) as string[],
    configured: row.configured === 1,
    baseUrl: row.base_url ?? undefined,
    hasApiKey: !!row.api_key,
  };
}

/**
 * Register provider routes
 */
export async function registerProviderRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase();

  /**
   * GET /api/providers - List all providers
   */
  app.get('/api/providers', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stmt = db.getRawDb().prepare(`
        SELECT id, name, api_key, base_url, models, configured, options, created_at, updated_at
        FROM providers
        ORDER BY name
      `);
      const rows = stmt.all() as ProviderRow[];
      const providers = rows.map(rowToProvider);

      sendSuccess(reply, providers);
    } catch (error) {
      app.log.error({ error }, 'Failed to list providers');
      sendError(reply, error instanceof Error ? error.message : 'Failed to list providers', 500);
    }
  });

  /**
   * GET /api/providers/:id - Get provider details
   */
  app.get('/api/providers/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = ProviderIdParamsSchema.parse(request.params);
      const stmt = db.getRawDb().prepare(`
        SELECT id, name, api_key, base_url, models, configured, options, created_at, updated_at
        FROM providers
        WHERE id = ?
      `);
      const row = stmt.get(params.id) as ProviderRow | undefined;

      if (!row) {
        sendError(reply, 'Provider not found', 404);
        return;
      }

      sendSuccess(reply, rowToProvider(row));
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to get provider');
      sendError(reply, error instanceof Error ? error.message : 'Failed to get provider', 500);
    }
  });

  /**
   * POST /api/providers/configure - Configure a provider
   */
  app.post('/api/providers/configure', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = ConfigureProviderSchema.parse(request.body);

      // Check if provider exists
      const checkStmt = db.getRawDb().prepare('SELECT id FROM providers WHERE id = ?');
      const exists = checkStmt.get(body.providerId);

      if (!exists) {
        sendError(reply, 'Provider not found', 404);
        return;
      }

      // Build update query dynamically based on provided fields
      const updates: string[] = [];
      const values: (string | number)[] = [];

      if (body.apiKey !== undefined) {
        updates.push('api_key = ?');
        values.push(body.apiKey || ''); // Empty string to clear
      }

      if (body.baseUrl !== undefined) {
        updates.push('base_url = ?');
        values.push(body.baseUrl || ''); // Empty string to clear
      }

      if (body.options !== undefined) {
        updates.push('options = ?');
        values.push(JSON.stringify(body.options));
      }

      // Update configured status based on whether API key is set
      // For Ollama, it doesn't need an API key
      if (body.apiKey !== undefined) {
        if (body.providerId === 'ollama') {
          updates.push('configured = 1');
        } else {
          updates.push('configured = ?');
          values.push(body.apiKey ? 1 : 0);
        }
      }

      // For Ollama with base_url, mark as configured
      if (body.providerId === 'ollama' && body.baseUrl) {
        updates.push('configured = 1');
      }

      if (updates.length === 0) {
        sendError(reply, 'No fields to update', 400);
        return;
      }

      values.push(body.providerId);
      const updateStmt = db.getRawDb().prepare(`
        UPDATE providers
        SET ${updates.join(', ')}
        WHERE id = ?
      `);
      updateStmt.run(...values);

      // Fetch updated provider
      const stmt = db.getRawDb().prepare(`
        SELECT id, name, api_key, base_url, models, configured, options, created_at, updated_at
        FROM providers
        WHERE id = ?
      `);
      const row = stmt.get(body.providerId) as ProviderRow;

      app.log.info({ providerId: body.providerId }, 'Configured provider');
      sendSuccess(reply, rowToProvider(row));
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to configure provider');
      sendError(reply, error instanceof Error ? error.message : 'Failed to configure provider', 500);
    }
  });

  /**
   * POST /api/providers/:id/test - Test provider connection
   */
  app.post('/api/providers/:id/test', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = ProviderIdParamsSchema.parse(request.params);

      // Fetch provider
      const stmt = db.getRawDb().prepare(`
        SELECT id, name, api_key, base_url, models, configured, options
        FROM providers
        WHERE id = ?
      `);
      const row = stmt.get(params.id) as ProviderRow | undefined;

      if (!row) {
        sendError(reply, 'Provider not found', 404);
        return;
      }

      // Test connection based on provider type
      let success = false;
      let message = '';

      try {
        switch (row.id) {
          case 'claude': {
            if (!row.api_key) {
              message = 'API key not configured';
              break;
            }
            // Test Claude API with a simple request
            const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': row.api_key,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: 1,
                messages: [{ role: 'user', content: 'Hi' }],
              }),
            });
            if (claudeResponse.ok) {
              success = true;
              message = 'Connection successful';
            } else {
              const errorData = await claudeResponse.json() as { error?: { message?: string } };
              message = errorData.error?.message ?? `HTTP ${claudeResponse.status}`;
            }
            break;
          }

          case 'openai': {
            if (!row.api_key) {
              message = 'API key not configured';
              break;
            }
            const baseUrl = row.base_url || 'https://api.openai.com/v1';
            const openaiResponse = await fetch(`${baseUrl}/models`, {
              headers: {
                'Authorization': `Bearer ${row.api_key}`,
              },
            });
            if (openaiResponse.ok) {
              success = true;
              message = 'Connection successful';
            } else {
              const errorData = await openaiResponse.json() as { error?: { message?: string } };
              message = errorData.error?.message ?? `HTTP ${openaiResponse.status}`;
            }
            break;
          }

          case 'gemini': {
            if (!row.api_key) {
              message = 'API key not configured';
              break;
            }
            // Test Google Gemini API
            const geminiResponse = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models?key=${row.api_key}`,
              { signal: AbortSignal.timeout(10000) }
            );
            if (geminiResponse.ok) {
              success = true;
              message = 'Connection successful';
            } else {
              const errorData = await geminiResponse.json() as { error?: { message?: string } };
              message = errorData.error?.message ?? `HTTP ${geminiResponse.status}`;
            }
            break;
          }

          case 'openrouter': {
            if (!row.api_key) {
              message = 'API key not configured';
              break;
            }
            // Test OpenRouter API
            const openrouterResponse = await fetch('https://openrouter.ai/api/v1/models', {
              headers: {
                'Authorization': `Bearer ${row.api_key}`,
              },
              signal: AbortSignal.timeout(10000),
            });
            if (openrouterResponse.ok) {
              success = true;
              message = 'Connection successful';
            } else {
              const errorData = await openrouterResponse.json() as { error?: { message?: string } };
              message = errorData.error?.message ?? `HTTP ${openrouterResponse.status}`;
            }
            break;
          }

          case 'deepseek': {
            if (!row.api_key) {
              message = 'API key not configured';
              break;
            }
            // Test DeepSeek API (OpenAI-compatible)
            const deepseekResponse = await fetch('https://api.deepseek.com/v1/models', {
              headers: {
                'Authorization': `Bearer ${row.api_key}`,
              },
              signal: AbortSignal.timeout(10000),
            });
            if (deepseekResponse.ok) {
              success = true;
              message = 'Connection successful';
            } else {
              const errorData = await deepseekResponse.json() as { error?: { message?: string } };
              message = errorData.error?.message ?? `HTTP ${deepseekResponse.status}`;
            }
            break;
          }

          case 'mistral': {
            if (!row.api_key) {
              message = 'API key not configured';
              break;
            }
            // Test Mistral API
            const mistralResponse = await fetch('https://api.mistral.ai/v1/models', {
              headers: {
                'Authorization': `Bearer ${row.api_key}`,
              },
              signal: AbortSignal.timeout(10000),
            });
            if (mistralResponse.ok) {
              success = true;
              message = 'Connection successful';
            } else {
              const errorData = await mistralResponse.json() as { error?: { message?: string } };
              message = errorData.error?.message ?? `HTTP ${mistralResponse.status}`;
            }
            break;
          }

          case 'groq': {
            if (!row.api_key) {
              message = 'API key not configured';
              break;
            }
            // Test Groq API (OpenAI-compatible)
            const groqResponse = await fetch('https://api.groq.com/openai/v1/models', {
              headers: {
                'Authorization': `Bearer ${row.api_key}`,
              },
              signal: AbortSignal.timeout(10000),
            });
            if (groqResponse.ok) {
              success = true;
              message = 'Connection successful';
            } else {
              const errorData = await groqResponse.json() as { error?: { message?: string } };
              message = errorData.error?.message ?? `HTTP ${groqResponse.status}`;
            }
            break;
          }

          case 'together': {
            if (!row.api_key) {
              message = 'API key not configured';
              break;
            }
            // Test Together AI API (OpenAI-compatible)
            const togetherResponse = await fetch('https://api.together.xyz/v1/models', {
              headers: {
                'Authorization': `Bearer ${row.api_key}`,
              },
              signal: AbortSignal.timeout(10000),
            });
            if (togetherResponse.ok) {
              success = true;
              message = 'Connection successful';
            } else {
              const errorData = await togetherResponse.json() as { error?: { message?: string } };
              message = errorData.error?.message ?? `HTTP ${togetherResponse.status}`;
            }
            break;
          }

          case 'cohere': {
            if (!row.api_key) {
              message = 'API key not configured';
              break;
            }
            // Test Cohere API
            const cohereResponse = await fetch('https://api.cohere.ai/v1/models', {
              headers: {
                'Authorization': `Bearer ${row.api_key}`,
              },
              signal: AbortSignal.timeout(10000),
            });
            if (cohereResponse.ok) {
              success = true;
              message = 'Connection successful';
            } else {
              const errorData = await cohereResponse.json() as { error?: { message?: string } };
              message = errorData.error?.message ?? `HTTP ${cohereResponse.status}`;
            }
            break;
          }

          case 'ollama': {
            const baseUrl = row.base_url || 'http://localhost:11434';
            try {
              const ollamaResponse = await fetch(`${baseUrl}/api/tags`, {
                signal: AbortSignal.timeout(5000),
              });
              if (ollamaResponse.ok) {
                success = true;
                message = 'Connection successful';
                // Update available models from Ollama
                const data = await ollamaResponse.json() as { models?: Array<{ name: string }> };
                if (data.models && data.models.length > 0) {
                  const models = data.models.map((m) => m.name);
                  const updateStmt = db.getRawDb().prepare('UPDATE providers SET models = ? WHERE id = ?');
                  updateStmt.run(JSON.stringify(models), 'ollama');
                  message = `Connection successful. Found ${models.length} models.`;
                }
              } else {
                message = `HTTP ${ollamaResponse.status}`;
              }
            } catch (fetchError) {
              if (fetchError instanceof Error && fetchError.name === 'TimeoutError') {
                message = 'Connection timed out. Is Ollama running?';
              } else {
                message = 'Failed to connect. Is Ollama running?';
              }
            }
            break;
          }

          default:
            message = 'Provider test not implemented';
        }
      } catch (testError) {
        message = testError instanceof Error ? testError.message : 'Connection test failed';
      }

      app.log.info({ providerId: params.id, success, message }, 'Provider connection test');
      sendSuccess(reply, { success, message });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to test provider');
      sendError(reply, error instanceof Error ? error.message : 'Failed to test provider', 500);
    }
  });

  app.log.info('[routes] Provider routes registered');
}
