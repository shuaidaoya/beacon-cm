import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import worker, { __adminPlus } from '../_worker.js';

// 复用 security.test.mjs 的 mock 模式
class FakeKV {
  constructor() { this.store = new Map(); }
  async get(key) { return this.store.has(key) ? this.store.get(key) : null; }
  async put(key, value) { this.store.set(key, value); }
  async delete(key) { this.store.delete(key); }
  async list({ prefix = '', limit = 100, cursor } = {}) {
    const keys = [...this.store.keys()].filter((key) => key.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const slice = keys.slice(start, start + limit);
    const next = start + slice.length;
    return { keys: slice.map((name) => ({ name })), list_complete: next >= keys.length, cursor: String(next) };
  }
}

// 简易内存 D1 mock（仅支持测试用到的 SELECT/INSERT OR REPLACE/DELETE）
class FakeD1 {
  constructor() { this.rows = new Map(); }
  prepare(sql) {
    const self = this;
    return {
      bind(...args) { this._args = args; return this; },
      async all() {
        const sql = this._sql || '';
        const results = [...self.rows.values()];
        return { results: results.map(r => ({ ...r, attributes: JSON.stringify(r.attributes || {}) })) };
      },
      async first() {
        const results = await this.all();
        return results.results[0] || null;
      },
      async run() {
        // INSERT OR REPLACE INTO users
        if (this._sql && /INSERT.*users/i.test(this._sql) && this._args) {
          const [uuid, userKey, label, source, status, createdAt, updatedAt, lastSeenAt, bannedAt, bannedReason, subscriptionToken, subscriptionTokenUpdatedAt, subscriptionState, traffic, used_traffic, expiry, attributes] = this._args;
          self.rows.set(uuid, { uuid, userKey, label, source, status, createdAt, updatedAt, lastSeenAt, bannedAt, bannedReason, subscriptionToken, subscriptionTokenUpdatedAt, subscriptionState, traffic, used_traffic, expiry, attributes: attributes ? JSON.parse(attributes) : {} });
        }
        return { success: true };
      },
      _sql: '',
      _args: null,
      get sql() { return this._sql; },
      set sql(v) { this._sql = v; },
    };
  }
}

// 注入 D1 binding 到 env（_worker 内部用 DB实例 全局变量，需通过运行时间接生效）
// 由于 _worker 内部 DB实例 是模块级变量，直接 mock 较复杂；
// 这里采用「KV 优先」路径测试：安全解析TG绑定 在 tg_bind 缺失时走 D1 回退，
// 但若无 D1，安全按TG用户ID获取用户 返回 null。
// 为完整测试 D1 回退，需要让运行时持有 DB。通过 createEnv 传入 DB binding。

function createEnv(overrides = {}) {
  return {
    ADMIN: 'secret',
    SECURITY_ENABLED: 'true',
    KV: new FakeKV(),
    DB: null, // 默认无 D1，测试 KV 路径
    ...overrides,
  };
}

async function setupRuntime(env) {
  const runtime = await __adminPlus.创建安全运行时(env);
  return runtime;
}

describe('TG 绑定一致性', () => {
  beforeEach(() => { __adminPlus.内存缓存清除(); });

  test('安全解析TG绑定: tg_bind 存在时直接返回用户', async () => {
    const env = createEnv();
    const runtime = await setupRuntime(env);
    // 创建用户 + 写 tg_bind
    const user = await __adminPlus.安全创建用户(runtime, { label: 'testuser', source: 'register-panel-tg-verified', passwordHash: 'x', passwordSet: 1 }, '127.0.0.1', 'test-ua', Date.now());
    user.attributes = user.attributes || {};
    user.attributes.tgUserId = 123456789;
    user.attributes.tgUsername = 'testtg';
    const { 安全保存用户记录V2, 安全TG绑定键, 安全KV写入JSON } = await import('../_worker.js').then(() => ({}));
    // 直接操作 KV 写 tg_bind
    await env.KV.put('tg_bind:123456789', JSON.stringify({ uuid: user.uuid, tgUserId: 123456789, tgUsername: 'testtg', account: 'testuser', boundAt: Date.now() }));
    // 保存用户记录到 KV
    await env.KV.put('sys:user:' + user.uuid, JSON.stringify(user));

    const result = await __adminPlus.安全解析TG绑定(runtime, 123456789);
    assert.ok(result, '应返回解析结果');
    assert.equal(result.user.uuid, user.uuid);
    assert.equal(result.bindRecord.uuid, user.uuid);
    assert.equal(result.rebuilt, false, 'tg_bind 存在时不应重建');
  });

  test('安全解析TG绑定: tg_bind 缺失且无 D1 时返回 null', async () => {
    const env = createEnv();
    const runtime = await setupRuntime(env);
    const user = await __adminPlus.安全创建用户(runtime, { label: 'testuser2', source: 'register-panel-tg-verified', passwordHash: 'x', passwordSet: 1 }, '127.0.0.1', 'test-ua', Date.now());
    user.attributes = user.attributes || {};
    user.attributes.tgUserId = 987654321;
    await env.KV.put('sys:user:' + user.uuid, JSON.stringify(user));
    // 不写 tg_bind（模拟 TTL 过期）

    const result = await __adminPlus.安全解析TG绑定(runtime, 987654321);
    // 无 D1 时安全按TG用户ID获取用户返回 null → 解析返回 null
    assert.equal(result, null, '无 D1 且无 tg_bind 时应返回 null');
  });

  test('安全解析TG绑定: 未绑定的 tgId 返回 null', async () => {
    const env = createEnv();
    const runtime = await setupRuntime(env);
    const result = await __adminPlus.安全解析TG绑定(runtime, 999999999);
    assert.equal(result, null, '不存在的 tgId 应返回 null');
  });

  test('安全按TG用户ID获取用户: 无 D1 时返回 null', async () => {
    const env = createEnv();
    const runtime = await setupRuntime(env);
    const result = await __adminPlus.安全按TG用户ID获取用户(runtime, 123456);
    assert.equal(result, null, '无 D1 时应返回 null');
  });

  test('安全提取用户展示信息: 有 attributes.tgUserId 时正确提取', () => {
    const user = {
      uuid: 'test-uuid',
      label: 'testaccount',
      attributes: { tgUserId: 123456789, tgUsername: 'testuser' },
    };
    const info = __adminPlus.安全提取用户展示信息(user);
    assert.equal(info.tgUserId, 123456789);
    assert.equal(info.tgUsername, 'testuser');
  });

  test('安全提取用户展示信息: 无 tgUserId 时返回 null', () => {
    const user = {
      uuid: 'test-uuid',
      label: 'testaccount',
      source: 'register-panel',
      attributes: {},
    };
    const info = __adminPlus.安全提取用户展示信息(user);
    assert.equal(info.tgUserId, null);
  });

  test('安全提取用户展示信息: 顶层 tgUserId 兼容（防御性）', () => {
    const user = {
      uuid: 'test-uuid',
      label: 'testaccount',
      tgUserId: 111222333,
      attributes: {},
    };
    const info = __adminPlus.安全提取用户展示信息(user);
    assert.equal(info.tgUserId, 111222333, '应兼容顶层 tgUserId');
  });
});
