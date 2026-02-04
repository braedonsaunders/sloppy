/**
 * Simple migration system for SQLite database
 * Tracks applied migrations and runs pending ones in order
 */

import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/**
 * Initialize the migrations table
 */
export function initMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/**
 * Get list of applied migration names
 */
export function getAppliedMigrations(db: Database.Database): string[] {
  const stmt = db.prepare('SELECT name FROM _migrations ORDER BY id');
  const rows = stmt.all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

/**
 * Record a migration as applied
 */
export function recordMigration(db: Database.Database, name: string): void {
  const stmt = db.prepare('INSERT INTO _migrations (name) VALUES (?)');
  stmt.run(name);
}

/**
 * Built-in migrations
 */
export const migrations: Migration[] = [
  {
    id: 1,
    name: '001_initial_schema',
    sql: '', // Will be loaded from schema.sql
  },
  {
    id: 2,
    name: '002_add_providers_settings',
    sql: `
-- Providers table: Stores AI provider configurations
CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    api_key TEXT,
    base_url TEXT,
    models TEXT NOT NULL DEFAULT '[]',
    configured INTEGER NOT NULL DEFAULT 0,
    options TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Settings table: Stores application settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Trigger to update updated_at on providers
CREATE TRIGGER IF NOT EXISTS update_providers_timestamp
    AFTER UPDATE ON providers
    FOR EACH ROW
BEGIN
    UPDATE providers SET updated_at = datetime('now') WHERE id = OLD.id;
END;

-- Trigger to update updated_at on settings
CREATE TRIGGER IF NOT EXISTS update_settings_timestamp
    AFTER UPDATE ON settings
    FOR EACH ROW
BEGIN
    UPDATE settings SET updated_at = datetime('now') WHERE key = OLD.key;
END;

-- Insert default providers (models will be fetched dynamically from provider APIs)
INSERT OR IGNORE INTO providers (id, name, models) VALUES
    ('claude', 'Claude', '[]'),
    ('openai', 'OpenAI', '[]'),
    ('ollama', 'Ollama', '[]');

-- Insert default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
    ('defaultProvider', '"claude"'),
    ('defaultModel', '"claude-sonnet-4-20250514"'),
    ('defaultStrictness', '"medium"'),
    ('defaultIssueTypes', '["lint", "type", "security"]'),
    ('defaultApprovalMode', 'false'),
    ('theme', '"system"');
    `,
  },
  {
    id: 3,
    name: '003_add_more_providers',
    sql: `
-- Add more providers (models will be fetched dynamically from provider APIs)
INSERT OR IGNORE INTO providers (id, name, models) VALUES
    ('gemini', 'Google Gemini', '[]'),
    ('openrouter', 'OpenRouter', '[]'),
    ('deepseek', 'DeepSeek', '[]'),
    ('mistral', 'Mistral AI', '[]'),
    ('groq', 'Groq', '[]'),
    ('together', 'Together AI', '[]'),
    ('cohere', 'Cohere', '[]');
    `,
  },
];

/**
 * Load schema SQL from file
 */
export function loadSchemaSQL(): string {
  const schemaPath = join(__dirname, 'schema.sql');
  return readFileSync(schemaPath, 'utf-8');
}

/**
 * Run all pending migrations
 */
export function runMigrations(db: Database.Database, logger?: Console): number {
  const log = logger ?? console;

  // Initialize migrations table
  initMigrationsTable(db);

  // Get applied migrations
  const applied = new Set(getAppliedMigrations(db));

  // Load schema for initial migration
  const schemaSQL = loadSchemaSQL();
  migrations[0]!.sql = schemaSQL;

  let migrationsRun = 0;

  // Run pending migrations in a transaction
  const runPending = db.transaction(() => {
    for (const migration of migrations) {
      if (applied.has(migration.name)) {
        log.info(`[migrations] Skipping already applied: ${migration.name}`);
        continue;
      }

      log.info(`[migrations] Applying: ${migration.name}`);

      try {
        db.exec(migration.sql);
        recordMigration(db, migration.name);
        migrationsRun++;
        log.info(`[migrations] Applied: ${migration.name}`);
      } catch (error) {
        log.error(`[migrations] Failed to apply ${migration.name}:`, error);
        throw error;
      }
    }
  });

  runPending();

  if (migrationsRun > 0) {
    log.info(`[migrations] Completed ${migrationsRun} migration(s)`);
  } else {
    log.info('[migrations] Database is up to date');
  }

  return migrationsRun;
}

/**
 * Add a new migration programmatically
 */
export function addMigration(migration: Migration): void {
  migrations.push(migration);
  // Sort by id to ensure order
  migrations.sort((a, b) => a.id - b.id);
}

/**
 * Reset migrations tracking (for testing only)
 */
export function resetMigrations(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS _migrations');
}
