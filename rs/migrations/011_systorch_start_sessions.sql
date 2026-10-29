BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS systorch_start_sessions (
    id TEXT PRIMARY KEY,
    caller TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
    last_read_at INTEGER NOT NULL DEFAULT 0,
    payload BLOB NOT NULL,
    UNIQUE(caller, idempotency_key)
);
CREATE INDEX IF NOT EXISTS systorch_start_sessions_caller_updated
    ON systorch_start_sessions(caller, archived, updated_at DESC, id);
CREATE TABLE IF NOT EXISTS systorch_start_session_assets (
    session_id TEXT NOT NULL REFERENCES systorch_start_sessions(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES systorch_assets(id) ON DELETE CASCADE,
    PRIMARY KEY(session_id, asset_id)
);
CREATE INDEX IF NOT EXISTS systorch_start_session_assets_asset
    ON systorch_start_session_assets(asset_id, session_id);
INSERT OR IGNORE INTO migrations(version, description, applied_at)
    VALUES(11, 'encrypted SysTorch Start chat sessions', strftime('%s','now'));
COMMIT;
