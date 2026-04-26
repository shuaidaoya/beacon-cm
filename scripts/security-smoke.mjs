﻿﻿﻿﻿﻿import assert from 'node:assert/strict';

import worker, { __adminPlus } from '../_worker.js';

class FakeKV {
  constructor() {
    this.store = new Map();
  }

  async get(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  async put(key, value) {
    this.store.set(key, value);
  }

  async delete(key) {
    this.store.delete(key);
  }

  async list({ prefix = '', limit = 100, cursor } = {}) {
    const keys = [...this.store.keys()].filter((key) => key.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const slice = keys.slice(start, start + limit);
    const next = start + slice.length;
    return {
      keys: slice.map((name) => ({ name })),
      list_complete: next >= keys.length,
      cursor: String(next),
    };
  }
}

async function main() {
  const env = {
    ADMIN: 'secret',
    KEY: 'integration-key',
    UUID: '90cd4a77-141a-43c9-991b-08263cfe9c10',
    HOST: 'example.com',
    URL: 'nginx',
    SECURITY_ENABLED: 'true',
    SECURITY_NOW_MS: '1710000000000',
    KV: new FakeKV(),
  };
  const runtime = await __adminPlus.创建安全运行时(env);

  await __adminPlus.保存安全配置(env, runtime, {
    enabled: true,
    abuse: {
      payload: { enabled: true, maxBytes: 32 },
      userAgent: { enabled: true, blockedPatterns: ['masscan'] },
      pathSequence: { enabled: false, maxUniquePaths: 99, maxSensitiveHits: 99 },
    },
    thresholds: {
      ip: { second: 10, minute: 10, hour: 10 },
      uuid: { second: 10, minute: 10, hour: 10 },
      endpoint: {
        ip: { second: 2, minute: 10, hour: 10 },
        uuid: { second: 10, minute: 10, hour: 10 },
      },
    },
    ban: {
      baseSeconds: 60,
      multiplier: 2,
      maxSeconds: 3600,
      lookbackSeconds: 3600,
    },
  });

  const signupResponse = await worker.fetch(createWorkerRequest('https://example.com/register/api', {
    method: 'POST',
    headers: new Headers({
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
    }),
    body: JSON.stringify({ account: 'smoke-user', email: 'smoke@example.com' }),
  }), env, { waitUntil() {} });
  const signupBody = await signupResponse.json();
  assert.equal(signupResponse.status, 201);
  assert.equal(signupBody.code, 'AUTH_SIGNUP_SUCCESS');
  assert.equal(signupBody.data.nextMode, 'signin');

  const signinResponse = await worker.fetch(createWorkerRequest('https://example.com/register/login', {
    method: 'POST',
    headers: new Headers({
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
    }),
    body: JSON.stringify({ account: 'smoke-user', email: 'smoke@example.com' }),
  }), env, { waitUntil() {} });
  const signinBody = await signinResponse.json();
  assert.equal(signinResponse.status, 200);
  assert.equal(signinBody.code, 'AUTH_SIGNIN_SUCCESS');
  assert.ok(signinBody.data.node.subscriptionUrl.includes('/sub?'));

  const user = await __adminPlus.安全创建用户(runtime, { label: 'smoke-user' }, '198.51.100.5', 'Mozilla/5.0', 1710000000000);
  assert.ok(__adminPlus.安全UUID有效(user.uuid));

  const ctx = { waitUntil(promise) { return promise; } };
  const headers = new Headers({ 'X-Client-UUID': user.uuid, 'User-Agent': 'Mozilla/5.0' });

  let cooldownResponse = null;
  for (let i = 0; i < 30; i++) {
    const response = await worker.fetch(createWorkerRequest('https://example.com/public-check?token=bad', { headers }), env, ctx);
    if (response.status === 429) {
      cooldownResponse = response;
      break;
    }
  }
  assert.equal(cooldownResponse?.status, 429);

  env.SECURITY_NOW_MS = String(1710000000000 + 61000);
  const afterExpire = await worker.fetch(createWorkerRequest('https://example.com/public-check?token=bad', { headers }), env, ctx);
  assert.notEqual(afterExpire.status, 429);

  let probeBlocked = false;
  for (let i = 0; i < 30; i++) {
    const response = await worker.fetch(createWorkerRequest('https://example.com/sub?token=bad', { headers }), env, ctx);
    if (response.status === 429) {
      probeBlocked = true;
      break;
    }
  }
  assert.equal(probeBlocked, false);

  env.SECURITY_NOW_MS = String(1710000000000 + 62000);
  const payloadBan = await worker.fetch(createWorkerRequest('https://example.com/login', {
    method: 'POST',
    headers: new Headers({
      'User-Agent': 'Mozilla/5.0',
      'Content-Length': '64',
      'Content-Type': 'application/json',
      'X-Client-UUID': user.uuid,
    }),
    body: JSON.stringify({ oversized: true }),
  }), env, ctx);
  assert.equal(payloadBan.status, 429);

  const events = [];
  const listed = await env.KV.list({ prefix: 'sys:event:', limit: 50 });
  for (const item of listed.keys) {
    events.push(JSON.parse(await env.KV.get(item.name)));
  }
  assert.ok(events.some((event) => event.eventType === 'user.registered'));
  assert.ok(events.some((event) => event.eventType === 'cooldown.created'));

  console.log('管理面板联调通过');
}

function createWorkerRequest(url, init = {}) {
  const request = new Request(url, init);
  request.cf = { colo: 'SJC', asn: '13335' };
  return request;
}

await main();
