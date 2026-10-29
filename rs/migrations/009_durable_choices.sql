BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS decision_tasks (
 id TEXT PRIMARY KEY,
 caller TEXT NOT NULL,
 entry TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 digest TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','completed','cancelled','expired')),
 revision INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 deadline INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 payload BLOB NOT NULL,
 UNIQUE(caller,entry,idempotency_key)
);
CREATE INDEX IF NOT EXISTS decision_tasks_queue ON decision_tasks(status,created_at);
INSERT OR IGNORE INTO migrations(version,description,applied_at)
 VALUES(9,'encrypted durable human Choice tasks',strftime('%s','now'));
COMMIT;
