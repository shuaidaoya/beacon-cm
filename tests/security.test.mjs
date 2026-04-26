import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

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

function createEnv(overrides = {}) {
  return {
    ADMIN: 'secret',
    SECURITY_ENABLED: 'true',
    KV: new FakeKV(),
    ...overrides,
  };
}

async function enableSecurity(env, overrides = {}) {
  const runtime = await __adminPlus.创建安全运行时(env);
  const config = __adminPlus.安全标准化配置({
    enabled: true,
    abuse: {
      payload: { enabled: false },
      userAgent: { enabled: false },
      pathSequence: { enabled: false, maxUniquePaths: 99, maxSensitiveHits: 99 },
    },
    thresholds: {
      uuid: { second: 99, minute: 99, hour: 99 },
      ip: { second: 99, minute: 99, hour: 99 },
      endpoint: {
        uuid: { second: 99, minute: 99, hour: 99 },
        ip: { second: 99, minute: 99, hour: 99 },
      },
    },
    ban: {
      baseSeconds: 60,
      multiplier: 2,
      maxSeconds: 3600,
      lookbackSeconds: 3600,
    },
    ...overrides,
  }, env);
  await __adminPlus.保存安全配置(env, runtime, config);
  return { runtime, config };
}

function createRequest(pathname, init = {}) {
  return new Request(`https://example.com${pathname}`, init);
}

function createWorkerRequest(pathname, init = {}) {
  const request = new Request(`https://example.com${pathname}`, init);
  request.cf = { colo: 'SJC', asn: '13335' };
  return request;
}

function createAdminAuthCookie(userAgent, key, adminPassword) {
  const first = createHash('md5').update(userAgent + key + adminPassword).digest('hex');
  const second = createHash('md5').update(first.slice(7, 27)).digest('hex');
  return `auth=${second.toLowerCase()}`;
}

describe('security module', () => {
  beforeEach(() => { __adminPlus.内存缓存清除(); });

test('assigns globally unique UUIDs under concurrent generation', async () => {
  const uuids = await Promise.all(Array.from({ length: 128 }, async () => __adminPlus.安全生成UUID()));
  assert.equal(new Set(uuids).size, 128);
  assert.ok(uuids.every((uuid) => __adminPlus.安全UUID有效(uuid)));
});

test('switches auth form mode while preserving non-sensitive fields', () => {
  const initial = __adminPlus.AuthForm创建状态('signup', { account: 'demo-user', email: 'demo@example.com' });
  const switched = __adminPlus.AuthForm切换模式(initial, 'signin');

  assert.equal(switched.mode, 'signin');
  assert.equal(switched.fields.account, 'demo-user');
  assert.equal(switched.fields.email, 'demo@example.com');
});

test('validates auth form fields for signup and signin', () => {
  const invalid = __adminPlus.AuthForm校验字段('signup', { account: '', email: 'bad-email' });
  const valid = __adminPlus.AuthForm校验字段('signin', { account: 'demo-user', email: 'demo@example.com' });

  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.account, /用户名/);
  assert.match(invalid.errors.email, /邮箱格式/);
  assert.equal(valid.valid, true);
});

test('subscription hardening defaults stay tightened', () => {
  const config = __adminPlus.安全标准化配置({}, {});

  assert.equal(config.subscription.hourlyLimit, 6);
  assert.equal(config.subscription.invalidTokenHourlyLimit, 4);
  assert.equal(config.subscription.uniqueIpAlertLimit, 6);
});

test('reuses the same uuid for the same user key during admin registration', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000' });
  const runtime = await __adminPlus.创建安全运行时(env);

  const first = await __adminPlus.安全创建用户(runtime, {
    userKey: 'demo-user-01',
    label: '第一次注册',
    attributes: { email: 'demo@example.com' },
  }, '198.51.100.20', 'Mozilla/5.0', 1710000000000);

  const second = await __adminPlus.安全创建用户(runtime, {
    userKey: 'demo-user-01',
    label: '第二次注册',
    attributes: { email: 'demo@example.com' },
  }, '198.51.100.21', 'Mozilla/5.0', 1710000001000);

  const users = await __adminPlus.安全列出KV记录(env, 'sys:user:', 10);

  assert.equal(first.uuid, second.uuid);
  assert.equal(second.userKey, 'demo-user-01');
  assert.equal(users.length, 1);
  assert.equal(users[0].uuid, first.uuid);
  assert.equal(users[0].label, '第二次注册');
});

test('issues and reuses the same dynamic uuid for request identity user key', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000' });
  const { config, runtime } = await enableSecurity(env);

  const firstIdentity = await __adminPlus.解析安全身份(
    runtime,
    config,
    createRequest('/probe?client_user=request-user-01'),
    new URL('https://example.com/probe?client_user=request-user-01'),
    '198.51.100.30',
    'Mozilla/5.0',
    1710000000000,
  );

  const secondIdentity = await __adminPlus.解析安全身份(
    runtime,
    config,
    createRequest('/probe?client_user=request-user-01'),
    new URL('https://example.com/probe?client_user=request-user-01'),
    '198.51.100.31',
    'Mozilla/5.0',
    1710000002000,
  );

  const users = await __adminPlus.安全列出KV记录(env, 'sys:user:', 10);

  assert.ok(__adminPlus.安全UUID有效(firstIdentity.uuid));
  assert.equal(firstIdentity.uuid, secondIdentity.uuid);
  assert.equal(users.length, 1);
  assert.equal(users[0].uuid, firstIdentity.uuid);
  assert.equal(users[0].userKey, 'request-user-01');
});

test('resolves registered user uuid as backend node uuid', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000' });
  const runtime = await __adminPlus.创建安全运行时(env);
  const user = await __adminPlus.安全创建用户(runtime, {
    userKey: 'node-user-01',
    label: '节点用户',
  }, '198.51.100.40', 'Mozilla/5.0', 1710000000000);

  const byUuid = await __adminPlus.安全解析请求节点UUID(
    runtime,
    createRequest(`/sub?uuid=${user.uuid}`),
    new URL(`https://example.com/sub?uuid=${user.uuid}`),
    '11111111-1111-4111-8111-111111111111',
  );
  const byUserKey = await __adminPlus.安全解析请求节点UUID(
    runtime,
    createRequest('/sub?client_user=node-user-01'),
    new URL('https://example.com/sub?client_user=node-user-01'),
    '11111111-1111-4111-8111-111111111111',
  );

  assert.equal(byUuid, user.uuid);
  assert.equal(byUserKey, user.uuid);
});

test('resolves registered user trojan password hash back to the same uuid', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000' });
  const runtime = await __adminPlus.创建安全运行时(env);
  const user = await __adminPlus.安全创建用户(runtime, {
    userKey: 'trojan-user-01',
  }, '198.51.100.41', 'Mozilla/5.0', 1710000000000);

  const matched = await __adminPlus.安全通过木马密码获取UUID(
    runtime,
    '11111111-1111-4111-8111-111111111111',
    createHash('sha224').update(user.uuid).digest('hex'),
  );

  assert.equal(matched, user.uuid);
});

test('registered user uuid is accepted by the version endpoint', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000' });
  const runtime = await __adminPlus.创建安全运行时(env);
  const user = await __adminPlus.安全创建用户(runtime, {
    userKey: 'version-user-01',
  }, '198.51.100.42', 'Mozilla/5.0', 1710000000000);

  const response = await worker.fetch(
    createWorkerRequest(`/version?uuid=${user.uuid}`),
    env,
    { waitUntil() {} },
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Number.isFinite(body.Version));
});

test('serves a dedicated public registration panel outside admin ui', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000', SECURITY_REGISTER_ENABLED: 'true' });
  const response = await worker.fetch(
    createWorkerRequest('/register'),
    env,
    { waitUntil() {} },
  );

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /认证面板/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /data-mode="signup"/);
  assert.match(html, /data-mode="signin"/);
  assert.match(html, /AuthForm/);
  assert.doesNotMatch(html, /备注名称/);
  assert.match(html, /status-bar/);
  assert.match(html, /auth-panel/);
});

test('public signup api returns unified auth response and supports subsequent signin', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000', SECURITY_REGISTER_ENABLED: 'true' });
  const ctx = { waitUntil() {} };
  const payload = {
    account: 'public-user-01',
    email: 'public@example.com',
  };

  const first = await worker.fetch(createWorkerRequest('/register/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }), env, ctx);
  const firstBody = await first.json();

  const second = await worker.fetch(createWorkerRequest('/register/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }), env, ctx);
  const secondBody = await second.json();

  assert.equal(first.status, 201);
  assert.equal(firstBody.code, 'AUTH_SIGNUP_SUCCESS');
  assert.equal(firstBody.data.nextMode, 'signin');
  assert.equal(firstBody.data.account, 'public-user-01');
  assert.equal(second.status, 200);
  assert.equal(secondBody.code, 'AUTH_SIGNIN_SUCCESS');
  assert.match(secondBody.data.user.userKey, /^register:/);
  assert.match(secondBody.data.node.subscriptionUrl, /\/sub\?/);
  assert.match(secondBody.data.node.versionUrl, /\/version\?/);
});

test('e2e auth flow completes from signup to signin to subscription payload', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000', SECURITY_REGISTER_ENABLED: 'true' });
  const ctx = { waitUntil() {} };
  const credentials = { account: 'e2e-user-01', email: 'e2e-user@example.com' };

  const signupResponse = await worker.fetch(createWorkerRequest('/register/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  }), env, ctx);
  const signupBody = await signupResponse.json();

  const signinResponse = await worker.fetch(createWorkerRequest('/register/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  }), env, ctx);
  const signinBody = await signinResponse.json();

  assert.equal(signupResponse.status, 201);
  assert.equal(signupBody.code, 'AUTH_SIGNUP_SUCCESS');
  assert.equal(signupBody.data.nextMode, 'signin');
  assert.equal(signinResponse.status, 200);
  assert.equal(signinBody.code, 'AUTH_SIGNIN_SUCCESS');
  assert.equal(signinBody.data.account, credentials.account);
  assert.equal(signinBody.data.email, credentials.email);
  assert.ok(signinBody.data.node.subscriptionUrl.includes('/sub?'));
});

test('converter subscription keeps registered uuid in callback url', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000' });
  const ctx = { waitUntil() {} };
  const runtime = await __adminPlus.创建安全运行时(env);
  const user = await __adminPlus.安全创建用户(runtime, {
    account: 'convert-user',
    email: 'convert@example.com',
  }, '198.51.100.55', 'ClashMeta/1.0', 1710000000000);
  const token = await __adminPlus.安全FNV1a('noop');
  const validToken = await __adminPlus.安全FNV1a('noop');
  void token;
  void validToken;

  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url || input);
    if (url.includes('/sub?target=clash&url=')) {
      capturedUrl = url;
      return new Response('converted-subscription', { status: 200 });
    }
    return originalFetch(input, init);
  };

  try {
    const subscriptionToken = (await worker.fetch(createWorkerRequest('/register/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'ClashMeta/1.0' },
      body: JSON.stringify({ account: 'convert-user', email: 'convert@example.com' }),
    }), env, ctx).then(r => r.json())).data.node.subscriptionUrl.match(/token=([^&]+)/)[1];

    const response = await worker.fetch(createWorkerRequest(`/sub?uuid=${user.uuid}&token=${subscriptionToken}&target=clash`, {
      headers: { 'User-Agent': 'ClashMeta/1.0' },
    }), env, ctx);

    assert.equal(response.status, 200);
    assert.ok(capturedUrl.includes('url='));
    assert.match(decodeURIComponent(capturedUrl), new RegExp(`uuid=${user.uuid}`));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('public registration api rejects requests without account name or email', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000', SECURITY_REGISTER_ENABLED: 'true' });
  const response = await worker.fetch(createWorkerRequest('/register/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'public-user-02' }),
  }), env, { waitUntil() {} });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, 'AUTH_VALIDATION_ERROR');
  assert.match(body.message, /合法的用户名和邮箱/);
});

test('public signup api also works with a trailing slash', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000', SECURITY_REGISTER_ENABLED: 'true' });
  const response = await worker.fetch(createWorkerRequest('/register/api/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'public-user-03', email: 'public03@example.com' }),
  }), env, { waitUntil() {} });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.code, 'AUTH_SIGNUP_SUCCESS');
  assert.equal(body.data.nextMode, 'signin');
});

test('public signup api is closed by default until admin enables registration', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000' });
  const response = await worker.fetch(createWorkerRequest('/register/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'closed-user', email: 'closed@example.com' }),
  }), env, { waitUntil() {} });

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.code, 'AUTH_SIGNUP_DISABLED');
  assert.match(body.message, /管理员关闭/);
});

test('public registration panel shows current manual close status', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000' });
  const response = await worker.fetch(createWorkerRequest('/register'), env, { waitUntil() {} });
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /status-bar/);
  assert.match(html, /status-closed/);
  assert.match(html, /当前注册入口已由管理员关闭/);
});

test('public signup api respects scheduled registration window', async () => {
  const env = createEnv({
    SECURITY_NOW_MS: '1710000000000',
    SECURITY_REGISTER_ENABLED: 'true',
    SECURITY_REGISTER_SCHEDULE_ENABLED: 'true',
    SECURITY_REGISTER_START_AT: '1710003600000',
    SECURITY_REGISTER_END_AT: '1710007200000',
  });
  const response = await worker.fetch(createWorkerRequest('/register/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'scheduled-user', email: 'scheduled@example.com' }),
  }), env, { waitUntil() {} });

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.code, 'AUTH_SIGNUP_DISABLED');
  assert.match(body.message, /注册尚未开始/);
});

test('public signin api returns not found for unknown users', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000' });
  const response = await worker.fetch(createWorkerRequest('/register/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'ghost-user', email: 'ghost@example.com' }),
  }), env, { waitUntil() {} });

  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.code, 'AUTH_USER_NOT_FOUND');
  assert.equal(body.data.nextMode, 'signup');
});

test('admin users api returns enriched user data for management operations', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000', KEY: 'integration-key', SECURITY_REGISTER_ENABLED: 'true' });
  const ctx = { waitUntil() {} };
  await worker.fetch(createWorkerRequest('/register/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({ account: 'admin-list-user', email: 'admin-list@example.com' }),
  }), env, ctx);

  const response = await worker.fetch(createWorkerRequest('/admin/system/users?limit=20&q=admin-list-user', {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Cookie': createAdminAuthCookie('Mozilla/5.0', env.KEY, env.ADMIN),
    },
  }), env, ctx);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.summary.filtered, 1);
  assert.equal(body.users[0].profile.account, 'admin-list-user');
  assert.equal(body.users[0].profile.email, 'admin-list@example.com');
  assert.equal(body.users[0].status, 'active');
  assert.equal(body.users[0].subscription.status, 'active');
  assert.match(body.users[0].node.subscriptionUrl, /\/sub\?/);
});

test('admin user actions ban restore and rotate subscription token without changing uuid', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000', KEY: 'integration-key', SECURITY_REGISTER_ENABLED: 'true' });
  const ctx = { waitUntil() {} };
  const credentials = { account: 'managed-user', email: 'managed@example.com' };
  const adminHeaders = {
    'User-Agent': 'Mozilla/5.0',
    'Cookie': createAdminAuthCookie('Mozilla/5.0', env.KEY, env.ADMIN),
    'Content-Type': 'application/json',
  };

  await worker.fetch(createWorkerRequest('/register/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify(credentials),
  }), env, ctx);

  const firstSigninResponse = await worker.fetch(createWorkerRequest('/register/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify(credentials),
  }), env, ctx);
  const firstSigninBody = await firstSigninResponse.json();
  const userUuid = firstSigninBody.data.user.uuid;
  const oldSubscriptionUrl = firstSigninBody.data.node.subscriptionUrl;
  const oldToken = new URL(oldSubscriptionUrl).searchParams.get('token');

  const disableResponse = await worker.fetch(createWorkerRequest('/admin/system/users/ban', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ uuid: userUuid, reason: 'ops-ban' }),
  }), env, ctx);
  const disableBody = await disableResponse.json();

  assert.equal(disableResponse.status, 200);
  assert.equal(disableBody.user.uuid, userUuid);
  assert.equal(disableBody.user.status, 'banned');
  assert.equal(disableBody.user.subscription.status, 'banned');
  assert.equal(disableBody.user.subscription.bannedReasonLabel, '管理员手动封禁');

  const disabledSigninResponse = await worker.fetch(createWorkerRequest('/register/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify(credentials),
  }), env, ctx);
  const disabledSigninBody = await disabledSigninResponse.json();

  assert.equal(disabledSigninResponse.status, 403);
  assert.equal(disabledSigninBody.code, 'AUTH_USER_BANNED');

  const disabledVersion = await worker.fetch(
    createWorkerRequest(`/version?uuid=${userUuid}`),
    env,
    ctx,
  );
  assert.equal(disabledVersion.status, 403);

  const disabledSub = await worker.fetch(createWorkerRequest(`/sub?uuid=${userUuid}&token=${oldToken}`, {
    headers: { 'User-Agent': 'ClashMeta/1.0' },
  }), env, ctx);
  assert.equal(disabledSub.status, 403);

  const restoreResponse = await worker.fetch(createWorkerRequest('/admin/system/users/restore', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ uuid: userUuid, reason: 'ops-restore' }),
  }), env, ctx);
  const restoreBody = await restoreResponse.json();

  assert.equal(restoreResponse.status, 200);
  assert.equal(restoreBody.user.uuid, userUuid);
  assert.equal(restoreBody.user.status, 'active');
  assert.equal(restoreBody.user.subscription.status, 'active');

  const resetResponse = await worker.fetch(createWorkerRequest('/admin/system/users/reset-subscription', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ uuid: userUuid, reason: 'ops-reset-token' }),
  }), env, ctx);
  const resetBody = await resetResponse.json();
  const newSubscriptionUrl = resetBody.user.node.subscriptionUrl;
  const newToken = new URL(newSubscriptionUrl).searchParams.get('token');

  assert.equal(resetResponse.status, 200);
  assert.equal(resetBody.user.uuid, userUuid);
  assert.notEqual(newToken, oldToken);

  const secondSigninResponse = await worker.fetch(createWorkerRequest('/register/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify(credentials),
  }), env, ctx);
  const secondSigninBody = await secondSigninResponse.json();

  assert.equal(secondSigninResponse.status, 200);
  assert.equal(secondSigninBody.data.user.uuid, userUuid);
  assert.equal(new URL(secondSigninBody.data.node.subscriptionUrl).searchParams.get('token'), newToken);

  const oldTokenResponse = await worker.fetch(createWorkerRequest(`/sub?uuid=${userUuid}&token=${oldToken}`, {
    headers: { 'User-Agent': 'ClashMeta/1.0' },
  }), env, ctx);
  assert.notEqual(oldTokenResponse.status, 200);
});

test('admin batch user api applies actions to multiple users and exposes audit trail', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000', KEY: 'integration-key' });
  const runtime = await __adminPlus.创建安全运行时(env);
  const ctx = { waitUntil() {} };
  const adminHeaders = {
    'User-Agent': 'Mozilla/5.0',
    'Cookie': createAdminAuthCookie('Mozilla/5.0', env.KEY, env.ADMIN),
    'Content-Type': 'application/json',
  };

  const firstUser = await __adminPlus.安全创建用户(runtime, {
    account: 'batch-user-01',
    email: 'batch01@example.com',
  }, '198.51.100.88', 'Mozilla/5.0', 1710000000000);
  const secondUser = await __adminPlus.安全创建用户(runtime, {
    account: 'batch-user-02',
    email: 'batch02@example.com',
  }, '198.51.100.89', 'Mozilla/5.0', 1710000000000);

  const batchResponse = await worker.fetch(createWorkerRequest('/admin/system/users/batch', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      action: 'ban',
      uuids: [firstUser.uuid, secondUser.uuid],
      reason: 'ops-batch-ban',
    }),
  }), env, ctx);
  const batchBody = await batchResponse.json();

  assert.equal(batchResponse.status, 200);
  assert.equal(batchBody.success, true);
  assert.equal(batchBody.summary.requested, 2);
  assert.equal(batchBody.summary.succeeded, 2);
  assert.equal(batchBody.results[0].status, 'banned');
  assert.equal(batchBody.results[1].status, 'banned');

  const auditResponse = await worker.fetch(createWorkerRequest(`/admin/system/users/audit?uuid=${firstUser.uuid}&limit=10`, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Cookie': createAdminAuthCookie('Mozilla/5.0', env.KEY, env.ADMIN),
    },
  }), env, ctx);
  const auditBody = await auditResponse.json();

  assert.equal(auditResponse.status, 200);
  assert.ok(auditBody.events.some((event) => event.eventType === 'user.banned'));
  assert.ok(auditBody.events.some((event) => event.eventType === 'user.batch.completed'));
});

test('subscription monitoring tracks hourly usage and blocks after the configured limit', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000' });
  const runtime = await __adminPlus.创建安全运行时(env);
  const user = await __adminPlus.安全创建用户(runtime, {
    account: 'sub-limit-user',
    email: 'sub-limit@example.com',
  }, '198.51.100.120', 'ClashMeta/1.0', 1710000000000);
  const config = __adminPlus.安全标准化配置({
    subscription: {
      enabled: true,
      hourlyLimit: 2,
      invalidTokenHourlyLimit: 3,
      uniqueIpAlertLimit: 2,
    },
  }, env);

  const firstCheck = await __adminPlus.安全检查订阅频率限制(runtime, config, user, 1710000000000);
  assert.equal(firstCheck.limited, false);

  await __adminPlus.安全记录订阅请求(runtime, config, user, {
    ip: '198.51.100.120',
    userAgent: 'ClashMeta/1.0',
    target: 'clash',
  }, 1710000000000);
  await __adminPlus.安全记录订阅请求(runtime, config, user, {
    ip: '198.51.100.121',
    userAgent: 'SingBox/1.0',
    target: 'singbox',
  }, 1710000001000);

  const state = await __adminPlus.安全获取订阅状态(runtime, user.uuid, 1710000001000);
  assert.equal(state.hourlyCount, 2);
  assert.equal(state.hourlyUniqueIpHashes.length, 2);
  assert.equal(state.hourlyUniqueUaHashes.length, 2);
  assert.equal(state.dailyUniqueIpHashes.length, 2);

  const secondCheck = await __adminPlus.安全检查订阅频率限制(runtime, config, user, 1710000002000);
  assert.equal(secondCheck.limited, true);

  await __adminPlus.安全记录订阅超限(runtime, user, secondCheck.state, {
    ip: '198.51.100.122',
    target: 'mixed',
    hourlyLimit: 2,
  }, 1710000002000);

  const events = await __adminPlus.安全列出KV记录(env, 'sys:event:', 20);
  assert.ok(events.some((event) => event.eventType === 'subscription.limit.exceeded'));
});

test('subscription monitoring counts invalid token attempts and raises an alert event', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000' });
  const runtime = await __adminPlus.创建安全运行时(env);
  const user = await __adminPlus.安全创建用户(runtime, {
    account: 'sub-invalid-user',
    email: 'sub-invalid@example.com',
  }, '198.51.100.130', 'ClashMeta/1.0', 1710000000000);
  const config = __adminPlus.安全标准化配置({
    subscription: {
      enabled: true,
      hourlyLimit: 12,
      invalidTokenHourlyLimit: 2,
      uniqueIpAlertLimit: 3,
    },
  }, env);

  await __adminPlus.安全记录订阅无效令牌(runtime, config, user, {
    ip: '198.51.100.130',
    userAgent: 'ClashMeta/1.0',
  }, 1710000000000);
  await __adminPlus.安全记录订阅无效令牌(runtime, config, user, {
    ip: '198.51.100.131',
    userAgent: 'ClashMeta/1.0',
  }, 1710000001000);

  const state = await __adminPlus.安全获取订阅状态(runtime, user.uuid, 1710000001000);
  const events = await __adminPlus.安全列出KV记录(env, 'sys:event:', 20);

  assert.equal(state.hourlyInvalidTokenCount, 2);
  assert.equal(state.lastInvalidTokenIp, '198.51.100.131');
  assert.ok(events.some((event) => event.eventType === 'subscription.invalid-token.detected'));
});

test('subscription hourly limit now bans the account directly', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000' });
  const runtime = await __adminPlus.创建安全运行时(env);
  const user = await __adminPlus.安全创建用户(runtime, {
    account: 'sub-guard-user',
    email: 'sub-guard@example.com',
  }, '198.51.100.140', 'ClashMeta/1.0', 1710000000000);
  const config = __adminPlus.安全标准化配置({
    subscription: {
      enabled: true,
      hourlyLimit: 1,
      invalidTokenHourlyLimit: 3,
      uniqueIpAlertLimit: 3,
    },
  }, env);

  await __adminPlus.安全记录订阅请求(runtime, config, user, {
    ip: '198.51.100.140',
    userAgent: 'ClashMeta/1.0',
    target: 'clash',
  }, 1710000000000);
  const firstLimitCheck = await __adminPlus.安全检查订阅频率限制(runtime, config, user, 1710000001000);
  assert.equal(firstLimitCheck.limited, true);
  const bannedUser = await __adminPlus.安全记录订阅超限(runtime, user, firstLimitCheck.state, {
    ip: '198.51.100.140',
    target: 'clash',
    hourlyLimit: 1,
    config,
  }, 1710000001000);
  const events = await __adminPlus.安全列出KV记录(env, 'sys:event:', 40);

  assert.equal(bannedUser.subscriptionState, 'banned');
  assert.equal(bannedUser.bannedReason, 'subscription-hourly-limit');
  assert.equal(__adminPlus.安全格式化封禁原因(bannedUser.bannedReason), '超出每小时订阅上限');
  assert.ok(events.some((event) => event.eventType === 'user.banned'));
});

test('invalid token spikes also ban the account and appear in overview risk ranking', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000', KEY: 'integration-key' });
  const runtime = await __adminPlus.创建安全运行时(env);
  const ctx = { waitUntil() {} };
  const user = await __adminPlus.安全创建用户(runtime, {
    account: 'sub-risk-user',
    email: 'sub-risk@example.com',
  }, '198.51.100.150', 'ClashMeta/1.0', 1710000000000);
  const config = __adminPlus.安全标准化配置({
    subscription: {
      enabled: true,
      hourlyLimit: 12,
      invalidTokenHourlyLimit: 2,
      uniqueIpAlertLimit: 2,
    },
  }, env);
  await __adminPlus.保存安全配置(env, runtime, config);

  await __adminPlus.安全记录订阅无效令牌(runtime, config, user, {
    ip: '198.51.100.150',
    userAgent: 'ClashMeta/1.0',
  }, 1710000000000);
  const protectedState = await __adminPlus.安全记录订阅无效令牌(runtime, config, user, {
    ip: '198.51.100.151',
    userAgent: 'ClashMeta/1.0',
  }, 1710000001000);

  const bannedUser = await __adminPlus.安全获取用户(runtime, user.uuid);
  assert.equal(bannedUser.subscriptionState, 'banned');
  assert.equal(bannedUser.bannedReason, 'subscription-invalid-token-threshold');
  assert.equal(__adminPlus.安全格式化封禁原因(bannedUser.bannedReason), '无效令牌过多');

  const overviewResponse = await worker.fetch(createWorkerRequest('/admin/system?limit=10', {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Cookie': createAdminAuthCookie('Mozilla/5.0', env.KEY, env.ADMIN),
    },
  }), env, ctx);
  const overviewBody = await overviewResponse.json();

  assert.equal(overviewResponse.status, 200);
  assert.ok(overviewBody.summary.highRiskSubscriptionCount >= 1);
  assert.ok(overviewBody.topSubscriptionRisks.some((item) => item.uuid === user.uuid));
  assert.ok(overviewBody.topSubscriptionRisks.some((item) => item.subscription.status === 'banned'));
});

test('admin injected ui contains user search and subscription actions', () => {
  const html = __adminPlus.生成安全管理后台注入代码();
  assert.match(html, /admin-plus-user-search/);
  assert.match(html, /admin-plus-user-status-filter/);
  assert.match(html, /全选当前筛选/);
  assert.match(html, /批量封禁/);
  assert.match(html, /每用户每小时订阅上限/);
  assert.match(html, /高风险订阅用户/);
  assert.match(html, /24 小时订阅趋势/);
  assert.match(html, /本小时订阅次数/);
  assert.match(html, /复制订阅/);
  assert.match(html, /用户详情/);
  assert.match(html, /最近管理员动作/);
  assert.match(html, /重置订阅/);
  assert.match(html, /封禁用户/);
  assert.match(html, /解封用户/);
  assert.match(html, /确认封禁该用户吗/);
  assert.match(html, /无法登录和订阅/);
});

test('public signup api reports kv daily write limit in unified format', async () => {
  const env = createEnv({
    SECURITY_REGISTER_ENABLED: 'true',
    KV: {
      async get() { return null; },
      async put() { throw new Error('KV put() limit exceeded for the day.'); },
      async delete() {},
      async list() { return { keys: [], list_complete: true, cursor: '0' }; },
    },
  });
  const response = await worker.fetch(createWorkerRequest('/register/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'quota-user', email: 'quota@example.com' }),
  }), env, { waitUntil() {} });

  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'KV_WRITE_LIMIT_EXCEEDED');
  assert.match(body.message, /今日注册写入额度已用尽/);
});

test('pre-processing allows normal traffic without rate limiting', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000' });
  await enableSecurity(env, {
    thresholds: {
      endpoint: {
        ip: { second: 60, minute: 600, hour: 6000 },
        uuid: { second: 60, minute: 1500, hour: 12000 },
      },
      ip: { second: 60, minute: 1500, hour: 15000 },
      uuid: { second: 120, minute: 3000, hour: 30000 },
    },
  });

  const ctx = { waitUntil() {} };
  let result;
  for (let i = 0; i < 60; i++) {
    result = await __adminPlus.安全预处理({
      request: createRequest('/public-check'),
      env,
      ctx,
      url: new URL('https://example.com/public-check'),
      访问IP: '198.51.100.10',
      UA: 'Mozilla/5.0',
      管理员密码: 'secret',
    });
  }

  assert.equal(result?.response, undefined);
  assert.equal(result?.enabled, true);
  assert.ok(result?.config);
});

test('pre-processing allows probe paths without cooldown', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000' });
  await enableSecurity(env, {
    thresholds: {
      endpoint: {
        ip: { second: 30, minute: 600, hour: 6000 },
        uuid: { second: 60, minute: 1500, hour: 12000 },
      },
      ip: { second: 60, minute: 1500, hour: 15000 },
      uuid: { second: 120, minute: 3000, hour: 30000 },
    },
  });

  const ctx = { waitUntil() {} };
  let result;
  for (let i = 0; i < 30; i++) {
    result = await __adminPlus.安全预处理({
      request: createRequest('/sub'),
      env,
      ctx,
      url: new URL('https://example.com/sub'),
      访问IP: '198.51.100.12',
      UA: 'Mozilla/5.0',
      管理员密码: 'secret',
    });
  }

  assert.equal(result?.response, undefined);
  assert.equal(result?.enabled, true);
});

test('pre-processing allows sensitive paths without auto-ban', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000' });
  await enableSecurity(env, {
    thresholds: {
      endpoint: {
        ip: { second: 30, minute: 600, hour: 6000 },
        uuid: { second: 60, minute: 1500, hour: 12000 },
      },
      ip: { second: 60, minute: 1500, hour: 15000 },
      uuid: { second: 120, minute: 3000, hour: 30000 },
    },
  });

  const ctx = { waitUntil() {} };
  let result;
  for (let i = 0; i < 30; i++) {
    result = await __adminPlus.安全预处理({
      request: createRequest('/login'),
      env,
      ctx,
      url: new URL('https://example.com/login'),
      访问IP: '198.51.100.11',
      UA: 'Mozilla/5.0',
      管理员密码: 'secret',
    });
  }

  assert.equal(result?.response, undefined);
  assert.equal(result?.enabled, true);
});

test('clamps rollback timestamps to a safe bucket start', () => {
  assert.equal(__adminPlus.安全窗口起始时间(-5000, 'minute'), 0);
  assert.equal(__adminPlus.安全窗口起始时间(59999, 'minute'), 0);
  assert.equal(__adminPlus.安全窗口起始时间(60000, 'minute'), 60000);
});

test('raises overly low thresholds to the recommended minimum floor', () => {
  const config = __adminPlus.安全标准化配置({
    enabled: true,
    thresholds: {
      uuid: { second: 1, minute: 1, hour: 1 },
      ip: { second: 1, minute: 1, hour: 1 },
      endpoint: {
        uuid: { second: 1, minute: 1, hour: 1 },
        ip: { second: 1, minute: 1, hour: 1 },
      },
    },
  }, {});

  assert.equal(config.thresholds.ip.second, 60);
  assert.equal(config.thresholds.ip.minute, 1500);
  assert.equal(config.thresholds.endpoint.ip.second, 30);
  assert.equal(config.thresholds.endpoint.uuid.second, 60);
});

test('default user-agent rules do not include common client libraries', () => {
  const config = __adminPlus.安全标准化配置({}, {});
  assert.ok(!config.abuse.userAgent.blockedPatterns.includes('go-http-client'));
  assert.ok(!config.abuse.userAgent.blockedPatterns.includes('python-requests'));
});

test('fails open when storage throws, instead of breaking the original Worker flow', async () => {
  const env = createEnv({
    KV: {
      async get() {
        throw new Error('kv read failure');
      },
      async put() {
        throw new Error('kv write failure');
      },
      async delete() {},
      async list() {
        return { keys: [], list_complete: true, cursor: '0' };
      },
    },
  });

  const result = await __adminPlus.安全预处理({
    request: createRequest('/sub'),
    env,
    ctx: { waitUntil() {} },
    url: new URL('https://example.com/sub'),
    访问IP: '203.0.113.20',
    UA: 'Mozilla/5.0',
    管理员密码: 'secret',
  });

  assert.equal(result, null);
});

test('security pre-processing returns identity and config for valid requests', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000' });
  const { runtime, config } = await enableSecurity(env, {
    ban: {
      baseSeconds: 60,
      multiplier: 2,
      maxSeconds: 3600,
      lookbackSeconds: 3600,
    },
  });

  const result = await __adminPlus.安全预处理({
    request: createRequest('/sub'),
    env,
    ctx: { waitUntil() {} },
    url: new URL('https://example.com/sub'),
    访问IP: '203.0.113.8',
    UA: 'Mozilla/5.0',
    管理员密码: 'secret',
  });

  assert.equal(result?.response, undefined);
  assert.equal(result?.enabled, true);
  assert.ok(result?.config);
  assert.ok(result?.identity);
});

test('security pre-processing bypasses admin requests', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000' });
  await enableSecurity(env, {});

  const result = await __adminPlus.安全预处理({
    request: createRequest('/admin'),
    env,
    ctx: { waitUntil() {} },
    url: new URL('https://example.com/admin'),
    访问IP: '203.0.113.31',
    UA: 'Mozilla/5.0',
    管理员密码: 'secret',
    已登录后台管理员: true,
  });

  assert.equal(result?.bypassed, 'admin');
});

test('security pre-processing returns null when storage unavailable', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000' });
  delete env.KV;

  const result = await __adminPlus.安全预处理({
    request: createRequest('/sub'),
    env,
    ctx: { waitUntil() {} },
    url: new URL('https://example.com/sub'),
    访问IP: '203.0.113.32',
    UA: 'Mozilla/5.0',
    管理员密码: 'secret',
  });

  assert.equal(result, null);
});

test('security pre-processing allows requests with blocked user-agent patterns', async () => {
  const env = createEnv({ SECURITY_NOW_MS: '1710000000000' });
  await enableSecurity(env, {
    abuse: {
      payload: { enabled: false },
      userAgent: { enabled: true, blockedPatterns: ['curl/7.'] },
      pathSequence: { enabled: false, maxUniquePaths: 99, maxSensitiveHits: 99 },
    },
  });

  const result = await __adminPlus.安全预处理({
    request: createRequest('/public-check', { headers: new Headers({ 'User-Agent': 'curl/7.88.1' }) }),
    env,
    ctx: { waitUntil() {} },
    url: new URL('https://example.com/public-check'),
    访问IP: '203.0.113.30',
    UA: 'curl/7.88.1',
    管理员密码: 'secret',
  });

  assert.equal(result?.response, undefined);
  assert.equal(result?.enabled, true);
});

test('injects security admin menu into the original /admin html response', async () => {
  const html = '<!doctype html><html><head><title>admin</title></head><body><main>origin</main></body></html>';
  const injected = await __adminPlus.注入安全管理后台页面(new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  }));
  const output = await injected.text();

  assert.match(output, /安全管理/);
  assert.match(output, /data-admin-plus-root="true"/);
  assert.match(output, /admin-plus-fab/);
});

test('logged-in admin requests bypass rate limiting for backend operations', async () => {
  const env = createEnv({
    KEY: 'test-key',
    SECURITY_NOW_MS: '1710000000000',
  });
  await enableSecurity(env, {
    thresholds: {
      endpoint: {
        ip: { second: 1, minute: 1, hour: 1 },
        uuid: { second: 1, minute: 1, hour: 1 },
      },
      ip: { second: 1, minute: 1, hour: 1 },
      uuid: { second: 1, minute: 1, hour: 1 },
    },
  });

  const ctx = { waitUntil() {} };
  const adminHeaders = new Headers({
    'User-Agent': 'Mozilla/5.0',
    'Cookie': createAdminAuthCookie('Mozilla/5.0', env.KEY, env.ADMIN),
  });

  const first = await worker.fetch(createWorkerRequest('/admin/system', { headers: adminHeaders }), env, ctx);
  const second = await worker.fetch(createWorkerRequest('/admin/system', { headers: adminHeaders }), env, ctx);
  const third = await worker.fetch(createWorkerRequest('/admin/system', { headers: adminHeaders }), env, ctx);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 200);
});
});
