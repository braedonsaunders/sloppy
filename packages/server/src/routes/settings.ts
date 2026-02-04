/**
 * REST routes for application settings management
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../db/database.js';

// Request schemas
const UpdateSettingsSchema = z.record(z.unknown());

// Response types
interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
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

function rowsToSettings(rows: SettingRow[]): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      settings[row.key] = row.value;
    }
  }
  return settings;
}

/**
 * Register settings routes
 */
export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase();

  /**
   * GET /api/settings - Get all settings
   */
  app.get('/api/settings', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stmt = db.getRawDb().prepare('SELECT key, value, updated_at FROM settings');
      const rows = stmt.all() as SettingRow[];
      const settings = rowsToSettings(rows);

      sendSuccess(reply, settings);
    } catch (error) {
      app.log.error({ error }, 'Failed to get settings');
      sendError(reply, error instanceof Error ? error.message : 'Failed to get settings', 500);
    }
  });

  /**
   * PUT /api/settings - Update settings
   */
  app.put('/api/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = UpdateSettingsSchema.parse(request.body);

      // Update each setting
      const upsertStmt = db.getRawDb().prepare(`
        INSERT INTO settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `);

      const updateMany = db.getRawDb().transaction((settings: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(settings)) {
          upsertStmt.run(key, JSON.stringify(value));
        }
      });

      updateMany(body);

      // Fetch all settings
      const stmt = db.getRawDb().prepare('SELECT key, value, updated_at FROM settings');
      const rows = stmt.all() as SettingRow[];
      const settings = rowsToSettings(rows);

      app.log.info({ keys: Object.keys(body) }, 'Updated settings');
      sendSuccess(reply, settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to update settings');
      sendError(reply, error instanceof Error ? error.message : 'Failed to update settings', 500);
    }
  });

  /**
   * GET /api/settings/:key - Get a specific setting
   */
  app.get('/api/settings/:key', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = z.object({ key: z.string().min(1) }).parse(request.params);
      const stmt = db.getRawDb().prepare('SELECT key, value, updated_at FROM settings WHERE key = ?');
      const row = stmt.get(params.key) as SettingRow | undefined;

      if (!row) {
        sendError(reply, 'Setting not found', 404);
        return;
      }

      let value: unknown;
      try {
        value = JSON.parse(row.value);
      } catch {
        value = row.value;
      }

      sendSuccess(reply, { key: row.key, value, updatedAt: row.updated_at });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to get setting');
      sendError(reply, error instanceof Error ? error.message : 'Failed to get setting', 500);
    }
  });

  /**
   * DELETE /api/settings/:key - Delete a specific setting
   */
  app.delete('/api/settings/:key', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = z.object({ key: z.string().min(1) }).parse(request.params);
      const stmt = db.getRawDb().prepare('DELETE FROM settings WHERE key = ?');
      const result = stmt.run(params.key);

      if (result.changes === 0) {
        sendError(reply, 'Setting not found', 404);
        return;
      }

      app.log.info({ key: params.key }, 'Deleted setting');
      sendSuccess(reply, { deleted: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(reply, `Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        return;
      }

      app.log.error({ error }, 'Failed to delete setting');
      sendError(reply, error instanceof Error ? error.message : 'Failed to delete setting', 500);
    }
  });

  app.log.info('[routes] Settings routes registered');
}
