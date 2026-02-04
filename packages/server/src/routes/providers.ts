/**
 * REST routes for AI provider management
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../db/database.js';
import { fetchModelsFromProvider } from '../services/model-fetcher.js';

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
  selected_model: string | null;
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
  selectedModel: string | null;
}

const SelectModelSchema = z.object({
  model: z.string().min(1, 'Model name is required'),
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

function rowToProvider(row: ProviderRow): Provider {
  return {
    id: row.id,
    name: row.name,
    models: JSON.parse(row.models) as string[],
    configured: row.configured === 1,
    baseUrl: row.base_url ?? undefined,
    hasApiKey: !!row.api_key,
    selectedModel: row.selected_model,
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
        SELECT id, name, api_key, base_url, models, configured, options, selected_model, created_at, updated_at, selected_model, created_at, updated_at
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
        SELECT id, name, api_key, base_url, models, configured, options, selected_model, created_at, updated_at, selected_model, created_at, updated_at
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
        SELECT id, name, api_key, base_url, models, configured, options, selected_model, created_at, updated_at, selected_model, created_at, updated_at
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
   * POST /api/providers/:id/test - Test provider connection and fetch models
   */
  app.post('/api/providers/:id/test', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = ProviderIdParamsSchema.parse(request.params);

      // Fetch provider
      const stmt = db.getRawDb().prepare(`
        SELECT id, name, api_key, base_url, models, configured, options, selected_model, created_at, updated_at
        FROM providers
        WHERE id = ?
      `);
      const row = stmt.get(params.id) as ProviderRow | undefined;

      if (!row) {
        sendError(reply, 'Provider not found', 404);
        return;
      }

      // Test connection by fetching models - this validates the API key
      const result = await fetchModelsFromProvider(row.id, row.api_key, row.base_url);

      if (result.success && result.models.length > 0) {
        // Update models in database
        const updateStmt = db.getRawDb().prepare('UPDATE providers SET models = ? WHERE id = ?');
        updateStmt.run(JSON.stringify(result.models), row.id);

        app.log.info({ providerId: params.id, modelCount: result.models.length }, 'Provider connection test successful');
        sendSuccess(reply, {
          success: true,
          message: `Connection successful. Found ${result.models.length} models.`,
          models: result.models,
        });
      } else if (result.success) {
        sendSuccess(reply, {
          success: true,
          message: 'Connection successful but no models found.',
          models: [],
        });
      } else {
        sendSuccess(reply, {
          success: false,
          message: result.error ?? 'Connection failed',
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to test provider');
      sendError(reply, error instanceof Error ? error.message : 'Failed to test provider', 500);
    }
  });

  /**
   * POST /api/providers/:id/refresh-models - Refresh available models from provider API
   */
  app.post('/api/providers/:id/refresh-models', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = ProviderIdParamsSchema.parse(request.params);

      // Fetch provider
      const stmt = db.getRawDb().prepare(`
        SELECT id, name, api_key, base_url, models, configured, options, selected_model, created_at, updated_at
        FROM providers
        WHERE id = ?
      `);
      const row = stmt.get(params.id) as ProviderRow | undefined;

      if (!row) {
        sendError(reply, 'Provider not found', 404);
        return;
      }

      // Fetch models from provider API
      const result = await fetchModelsFromProvider(row.id, row.api_key, row.base_url);

      if (!result.success) {
        sendError(reply, result.error ?? 'Failed to fetch models', 400);
        return;
      }

      if (result.models.length > 0) {
        // Update models in database
        const updateStmt = db.getRawDb().prepare('UPDATE providers SET models = ? WHERE id = ?');
        updateStmt.run(JSON.stringify(result.models), row.id);
      }

      app.log.info({ providerId: params.id, modelCount: result.models.length }, 'Models refreshed');

      // Return updated provider
      const updatedRow = stmt.get(params.id) as ProviderRow;
      sendSuccess(reply, {
        provider: rowToProvider(updatedRow),
        modelsFound: result.models.length,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to refresh models');
      sendError(reply, error instanceof Error ? error.message : 'Failed to refresh models', 500);
    }
  });

  /**
   * POST /api/providers/:id/select-model - Select a model for the provider
   */
  app.post('/api/providers/:id/select-model', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = ProviderIdParamsSchema.parse(request.params);
      const body = SelectModelSchema.parse(request.body);

      // Fetch provider
      const stmt = db.getRawDb().prepare(`
        SELECT id, name, api_key, base_url, models, configured, options, selected_model, created_at, updated_at
        FROM providers
        WHERE id = ?
      `);
      const row = stmt.get(params.id) as ProviderRow | undefined;

      if (!row) {
        sendError(reply, 'Provider not found', 404);
        return;
      }

      // Verify model is in the available models list
      const availableModels = JSON.parse(row.models) as string[];
      if (!availableModels.includes(body.model)) {
        sendError(reply, `Model '${body.model}' is not available for this provider`, 400);
        return;
      }

      // Update selected model
      const updateStmt = db.getRawDb().prepare('UPDATE providers SET selected_model = ? WHERE id = ?');
      updateStmt.run(body.model, params.id);

      app.log.info({ providerId: params.id, model: body.model }, 'Model selected');

      // Return updated provider
      const updatedRow = stmt.get(params.id) as ProviderRow;
      sendSuccess(reply, rowToProvider(updatedRow));
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to select model');
      sendError(reply, error instanceof Error ? error.message : 'Failed to select model', 500);
    }
  });

  app.log.info('[routes] Provider routes registered');
}
