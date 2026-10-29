BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS systorch_assets (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
    digest TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    payload BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS systorch_assets_owner_expiry
    ON systorch_assets(owner_id, expires_at);
CREATE TABLE IF NOT EXISTS decision_task_assets (
    task_id TEXT NOT NULL REFERENCES decision_tasks(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES systorch_assets(id) ON DELETE CASCADE,
    PRIMARY KEY(task_id, asset_id)
);
CREATE INDEX IF NOT EXISTS decision_task_assets_asset
    ON decision_task_assets(asset_id, task_id);
INSERT OR IGNORE INTO migrations(version, description, applied_at)
    VALUES(10, 'encrypted SysTorch media assets', strftime('%s','now'));
COMMIT;
