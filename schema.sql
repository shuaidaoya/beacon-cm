-- Beacon CM D1 Schema (beacon-users)
-- Run: wrangler d1 execute beacon-users --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
    uuid                          TEXT PRIMARY KEY,
    userKey                       TEXT,
    label                         TEXT,
    source                        TEXT,
    status                        TEXT DEFAULT 'active',
    createdAt                     INTEGER,
    updatedAt                     INTEGER,
    lastSeenAt                    INTEGER,
    bannedAt                      INTEGER,
    bannedReason                  TEXT,
    subscriptionToken             TEXT,
    subscriptionTokenUpdatedAt    INTEGER,
    subscriptionState             TEXT DEFAULT 'active',
    traffic                       INTEGER DEFAULT 0,
    used_traffic                  INTEGER DEFAULT 0,
    expiry                        INTEGER DEFAULT 0,
    attributes                    TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_users_userKey ON users(userKey);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ============================================================
-- Migration log (for existing databases that need new columns)
-- Run each line ONCE, then comment it out:
-- ============================================================
-- ALTER TABLE users ADD COLUMN traffic      INTEGER DEFAULT 0;
-- ALTER TABLE users ADD COLUMN used_traffic INTEGER DEFAULT 0;
-- ALTER TABLE users ADD COLUMN expiry       INTEGER DEFAULT 0;
