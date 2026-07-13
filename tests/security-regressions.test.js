const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { this.ended = true; return this; },
  };
}

function clearRequire(rel) {
  const abs = path.join(root, rel);
  delete require.cache[require.resolve(abs)];
  return require(abs);
}

async function withMocks(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function mockedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return await fn();
  } finally {
    Module._load = originalLoad;
  }
}

function mockSupabaseTool(tool) {
  return {
    createClient: () => ({
      from: () => ({
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: tool, error: null }),
      }),
    }),
  };
}

test('/api/run-tool requires verified checkout session for paid UUID tools', async () => {
  const oldEnv = { ...process.env };
  const oldFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.STRIPE_SECRET_KEY = 'sk_stripe';
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };

  try {
    await withMocks({
      '@supabase/supabase-js': mockSupabaseTool({ system_prompt: 'secret', is_published: true, price: 5 }),
      stripe: () => { throw new Error('Stripe should not be called without a session id'); },
    }, async () => {
      const handler = clearRequire('api/run-tool.js');
      const res = makeRes();
      await handler({
        method: 'POST',
        headers: {},
        body: {
          toolId: '11111111-1111-4111-8111-111111111111',
          userMessage: 'run it',
        },
      }, res);

      assert.equal(res.statusCode, 402);
      assert.equal(res.payload.error, 'payment_required');
      assert.equal(fetchCalled, false);
    });
  } finally {
    global.fetch = oldFetch;
    process.env = oldEnv;
  }
});

test('/api/run-tool accepts a paid session only for the exact paid tool', async () => {
  const oldEnv = { ...process.env };
  const oldFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.STRIPE_SECRET_KEY = 'sk_stripe';
  let retrievedSession = '';
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'hosted output' } }] }) };
  };

  try {
    await withMocks({
      '@supabase/supabase-js': mockSupabaseTool({ system_prompt: 'secret', is_published: true, price: 5 }),
      stripe: () => ({
        checkout: {
          sessions: {
            retrieve: async (sessionId) => {
              retrievedSession = sessionId;
              return {
                payment_status: 'paid',
                metadata: { tool_id: '11111111-1111-4111-8111-111111111111' },
              };
            },
          },
        },
      }),
    }, async () => {
      const handler = clearRequire('api/run-tool.js');
      const res = makeRes();
      await handler({
        method: 'POST',
        headers: {},
        body: {
          toolId: '11111111-1111-4111-8111-111111111111',
          userMessage: 'run it',
          checkoutSessionId: 'cs_paid',
        },
      }, res);

      assert.equal(retrievedSession, 'cs_paid');
      assert.equal(fetchCalled, true);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.text, 'hosted output');
    });
  } finally {
    global.fetch = oldFetch;
    process.env = oldEnv;
  }
});

test('/api/stats requires auth and scopes Stripe charges to the signed-in builder', async () => {
  const oldEnv = { ...process.env };
  process.env.STRIPE_SECRET_KEY = 'sk_stripe';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  try {
    await withMocks({
      '@supabase/supabase-js': {
        createClient: () => ({
          auth: { getUser: async () => ({ data: { user: { id: 'creator-1' } }, error: null }) },
        }),
      },
      stripe: () => ({
        charges: {
          list: async (opts) => {
            assert.deepEqual(opts.expand, ['data.payment_intent']);
            return {
              data: [
                {
                  id: 'ch_1',
                  status: 'succeeded',
                  amount: 1000,
                  description: 'Tool A',
                  billing_details: { email: 'buyer@example.com' },
                  customer: 'cus_1',
                  created: 1700000000,
                  metadata: { creator_id: 'creator-1' },
                },
                {
                  id: 'ch_2',
                  status: 'succeeded',
                  amount: 9999,
                  description: 'Other Builder Tool',
                  billing_details: { email: 'other@example.com' },
                  customer: 'cus_2',
                  created: 1700000000,
                  metadata: { creator_id: 'creator-2' },
                },
              ],
            };
          },
        },
      }),
    }, async () => {
      let handler = clearRequire('api/stats.js');
      let res = makeRes();
      await handler({ method: 'GET', headers: {} }, res);
      assert.equal(res.statusCode, 401);

      handler = clearRequire('api/stats.js');
      res = makeRes();
      await handler({ method: 'GET', headers: { authorization: 'Bearer token' } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.totalRevenue, 10);
      assert.equal(res.payload.totalSales, 1);
      assert.equal(res.payload.totalCustomers, 1);
      assert.deepEqual(res.payload.byProduct, { 'Tool A': 10 });
      assert.equal(res.payload.recent.length, 1);
      assert.equal(res.payload.recent[0].customer, 'buyer@example.com');
    });
  } finally {
    process.env = oldEnv;
  }
});

test('/api/publish-generate rejects anonymous hosted generation before calling OpenAI', async () => {
  const oldEnv = { ...process.env };
  const oldFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    return { ok: true, json: async () => ({}) };
  };

  try {
    await withMocks({
      '@supabase/supabase-js': {
        createClient: () => ({
          auth: { getUser: async () => ({ data: { user: null }, error: new Error('nope') }) },
        }),
      },
    }, async () => {
      const handler = clearRequire('api/publish-generate.js');
      const res = makeRes();
      await handler({ method: 'POST', headers: {}, body: { idea: 'tool' } }, res);
      assert.equal(res.statusCode, 401);
      assert.equal(fetchCalled, false);
    });
  } finally {
    global.fetch = oldFetch;
    process.env = oldEnv;
  }
});

test('marketplace keeps prompts off public listings and escapes builder fields', () => {
  const src = read('socrates/marketplace.html');
  assert.match(src, /function renderToolFieldHtml\(f\)/);
  assert.match(src, /fieldsEl\.innerHTML = currentTool\.fields\.map\(renderToolFieldHtml\)\.join\(''\);/);
  assert.doesNotMatch(src, /from\('tools'\)\.select\('\*[^']*profiles/);
  assert.doesNotMatch(src, /sys:\s*t\.system_prompt/);
  assert.match(src, /checkoutSessionId:\s*currentTool\.paid \? paidToolCheckoutSessionId\(currentTool\.id\) : undefined/);
});

test('publish flows check Supabase insert errors before showing success', () => {
  const src = read('socrates/publish.html');
  assert.equal((src.match(/if \(error\) throw error;/g) || []).length, 3);
  assert.doesNotMatch(src, /catch\(e\)\{\s*\/\*\s*silent\s*\*\/\s*\}/);
  assert.match(src, /headers\.Authorization = `Bearer \$\{accessToken\}`/);
});

test('dashboard stats are authenticated and no longer reference removed revenueChart', () => {
  const src = read('socrates/dashboard.html');
  assert.match(src, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.doesNotMatch(src, /revenueChart/);
});

test('auth UI supports nav-right without replacing marketplace API-key controls', () => {
  const src = read('socrates/js/auth-ui.js');
  assert.match(src, /document\.querySelector\('\.nav-cta'\)/);
  assert.match(src, /find\(el => !el\.querySelector\('#keyBtn'\)\)/);
  assert.match(src, /const safeName = escapeHtml\(name\);/);
});
