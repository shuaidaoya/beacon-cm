-- ============================================================
-- Beacon CM — D1 数据库 Schema
-- 数据库: beacon-users (binding: DB)
-- 同步自: _worker.js → 确保D1用户表()
-- ============================================================

-- ── 基础表（首次部署） ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    uuid                          TEXT PRIMARY KEY,      -- 用户唯一标识 (UUID v4)
    userKey                       TEXT,                  -- 注册索引键 (register:account:email)
    label                         TEXT,                  -- 用户标签/昵称
    source                        TEXT,                  -- 注册来源 (register-panel / admin-api / tg-bot)
    status                        TEXT DEFAULT 'active', -- 账号状态 (active / banned)
    createdAt                     INTEGER,              -- 创建时间 (Unix ms)
    updatedAt                     INTEGER,              -- 最后更新时间 (Unix ms)
    lastSeenAt                    INTEGER,              -- 最后活跃时间 (Unix ms)
    bannedAt                      INTEGER,              -- 封禁时间 (Unix ms)
    bannedReason                  TEXT,                  -- 封禁原因
    subscriptionToken             TEXT,                  -- 订阅令牌 (用于 /sub?token=)
    subscriptionTokenUpdatedAt    INTEGER,              -- 令牌更新时间 (Unix ms)
    subscriptionState             TEXT DEFAULT 'active', -- 订阅状态 (active / banned)
    attributes                    TEXT DEFAULT '{}'      -- 扩展属性 (JSON)
);

-- ── 索引 ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_userKey ON users(userKey);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ============================================================
-- 迁移记录 (按时间顺序，每次新增列追加 ALTER TABLE)
-- ============================================================

-- [2026-05-30] 流量追踪
ALTER TABLE users ADD COLUMN traffic      INTEGER DEFAULT 0;   -- 流量配额 (bytes)，0=不限
ALTER TABLE users ADD COLUMN used_traffic INTEGER DEFAULT 0;   -- 已用流量 (bytes)
ALTER TABLE users ADD COLUMN expiry       INTEGER DEFAULT 0;   -- 过期时间 (Unix ms)，0=永不过期

-- ════════════════════════════════════════════════════════════
-- 新增列模板（复制下面两行，修改列名和类型即可）:
-- ALTER TABLE users ADD COLUMN 列名 类型 DEFAULT 默认值;
-- ════════════════════════════════════════════════════════════
