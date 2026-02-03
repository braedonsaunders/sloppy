-- Sloppy Server Database Schema
-- SQLite schema for tracking code quality cleaning sessions

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- Sessions table: Tracks cleaning sessions
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    repo_path TEXT NOT NULL,
    branch TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed', 'stopped')),
    max_time_minutes INTEGER NOT NULL DEFAULT 60,
    provider_config TEXT NOT NULL DEFAULT '{}', -- JSON: provider settings (model, api key ref, etc.)
    config TEXT NOT NULL DEFAULT '{}', -- JSON: session configuration (analyzers, rules, etc.)
    started_at TEXT,
    ended_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Issues table: Tracks detected code issues
CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL, -- 'lint', 'type', 'test', 'security', 'performance', 'style'
    severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('error', 'warning', 'info', 'hint')),
    file_path TEXT NOT NULL,
    line_start INTEGER,
    line_end INTEGER,
    description TEXT NOT NULL,
    context TEXT, -- JSON: additional context (code snippet, rule id, etc.)
    status TEXT NOT NULL DEFAULT 'detected' CHECK (status IN ('detected', 'in_progress', 'fixed', 'approved', 'rejected', 'skipped')),
    fix_content TEXT, -- Proposed fix content
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Commits table: Tracks commits made by Sloppy
CREATE TABLE IF NOT EXISTS commits (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    issue_id TEXT,
    hash TEXT NOT NULL,
    message TEXT NOT NULL,
    diff_content TEXT, -- The actual diff content
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    reverted INTEGER NOT NULL DEFAULT 0, -- Boolean: 1 if reverted
    reverted_at TEXT,
    revert_hash TEXT, -- Hash of the revert commit if reverted
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE SET NULL
);

-- Metrics table: Tracks session progress metrics over time
CREATE TABLE IF NOT EXISTS metrics (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    total_issues INTEGER NOT NULL DEFAULT 0,
    resolved_issues INTEGER NOT NULL DEFAULT 0,
    test_count INTEGER,
    tests_passing INTEGER,
    lint_errors INTEGER,
    type_errors INTEGER,
    coverage_percent REAL,
    custom_metrics TEXT, -- JSON: additional custom metrics
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_repo_path ON sessions(repo_path);
CREATE INDEX IF NOT EXISTS idx_issues_session_id ON issues(session_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_type ON issues(type);
CREATE INDEX IF NOT EXISTS idx_issues_file_path ON issues(file_path);
CREATE INDEX IF NOT EXISTS idx_commits_session_id ON commits(session_id);
CREATE INDEX IF NOT EXISTS idx_commits_issue_id ON commits(issue_id);
CREATE INDEX IF NOT EXISTS idx_commits_hash ON commits(hash);
CREATE INDEX IF NOT EXISTS idx_metrics_session_id ON metrics(session_id);
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);

-- Trigger to update updated_at on sessions
CREATE TRIGGER IF NOT EXISTS update_sessions_timestamp
    AFTER UPDATE ON sessions
    FOR EACH ROW
BEGIN
    UPDATE sessions SET updated_at = datetime('now') WHERE id = OLD.id;
END;
