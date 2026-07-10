const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function clearProjectModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(path.join(ROOT, 'api')) || key.startsWith(path.join(ROOT, 'server-lib'))) {
      delete require.cache[key];
    }
  }
}

async function withMocks(relativeModule, mocks, fn) {
  clearProjectModules();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const loaded = require(path.join(ROOT, relativeModule));
    return await fn(loaded);
  } finally {
    Module._load = originalLoad;
    clearProjectModules();
  }
}

function makeReq({ method = 'GET', headers = {}, body = {} } = {}) {
  return { method, headers, body, url: '/' };
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

test('paid hosted UUID tool run requires a matching checkout session', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  delete process.env.STRIPE_SECRET_KEY;

  let llmCalled = false;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    llmCalled = true;
    throw new Error('LLM should not be called');
  };

  const supabaseMock = {
    createClient() {
      const query = {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          return {
            data: { system_prompt: 'paid secret prompt', is_published: true, price: 9 },
            error: null,
          };
        },
      };
      return { from: () => query };
    },
  };

  await withMocks('api/run-tool.js', {
    '@supabase/supabase-js': supabaseMock,
    stripe: () => ({ checkout: { sessions: { retrieve: async () => ({}) } } }),
  }, async (handler) => {
    const res = makeRes();
    await handler(makeReq({
      method: 'POST',
      body: {
        toolId: '123e4567-e89b-42d3-a456-426614174000',
        userMessage: 'run it',
        model: 'gpt',
      },
    }), res);

    assert.equal(res.statusCode, 402);
    assert.equal(res.body.error, 'payment_required');
    assert.equal(llmCalled, false);
  });

  global.fetch = originalFetch;
});

test('publish-generate rejects unauthenticated callers before spending OpenAI tokens', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  let llmCalled = false;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    llmCalled = true;
    throw new Error('OpenAI should not be called');
  };

  await withMocks('api/publish-generate.js', {
    '@supabase/supabase-js': { createClient: () => { throw new Error('tokenless request should not create client'); } },
  }, async (handler) => {
    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: { idea: 'build a tool' } }), res);

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'auth');
    assert.equal(llmCalled, false);
  });

  global.fetch = originalFetch;
});

test('stats rejects unauthenticated callers before reading Stripe data', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  let stripeConstructed = false;
  await withMocks('api/stats.js', {
    '@supabase/supabase-js': { createClient: () => { throw new Error('tokenless request should not create client'); } },
    stripe: () => {
      stripeConstructed = true;
      return {};
    },
  }, async (handler) => {
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'auth');
    assert.equal(stripeConstructed, false);
  });
});

test('stats only returns Stripe PaymentIntents for the authenticated creator', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  const supabaseMock = {
    createClient() {
      return {
        auth: {
          async getUser(token) {
            assert.equal(token, 'valid-token');
            return { data: { user: { id: 'creator-1' } }, error: null };
          },
        },
      };
    },
  };

  const stripeMock = () => ({
    paymentIntents: {
      async list() {
        return {
          data: [
            {
              id: 'pi_creator',
              status: 'succeeded',
              amount_received: 500,
              created: 1710000000,
              customer: 'cus_creator',
              metadata: { creator_id: 'creator-1', tool_id: 'tool-a' },
              latest_charge: { description: 'Creator tool', billing_details: { email: 'buyer@example.com' } },
            },
            {
              id: 'pi_other',
              status: 'succeeded',
              amount_received: 1200,
              created: 1710000001,
              customer: 'cus_other',
              metadata: { creator_id: 'creator-2', tool_id: 'tool-b' },
              latest_charge: { description: 'Other creator tool', billing_details: { email: 'other@example.com' } },
            },
          ],
        };
      },
    },
  });

  await withMocks('api/stats.js', {
    '@supabase/supabase-js': supabaseMock,
    stripe: stripeMock,
  }, async (handler) => {
    const res = makeRes();
    await handler(makeReq({ method: 'GET', headers: { authorization: 'Bearer valid-token' } }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.totalRevenue, 5);
    assert.equal(res.body.totalSales, 1);
    assert.deepEqual(Object.keys(res.body.byProduct), ['Creator tool']);
    assert.equal(res.body.recent.length, 1);
    assert.equal(res.body.recent[0].id, 'pi_creator');
  });
});

test('marketplace does not expose system prompts and escapes dynamic run fields', () => {
  const html = fs.readFileSync(path.join(ROOT, 'socrates/marketplace.html'), 'utf8');

  assert.match(html, /const publicToolColumns = \[/);
  assert.doesNotMatch(html, /select\('\*,\s*profiles/);
  assert.doesNotMatch(html, /sys:\s*t\.system_prompt/);
  assert.match(html, /checkoutSessionId:\s*currentTool\.paid \? paidToolCheckoutSession\(currentTool\.id\) : undefined/);
  assert.match(html, /const label = escapeHtml\(f\.label\);/);
  assert.match(html, /const placeholder = escapeHtml\(f\.placeholder \|\| ''\);/);
  assert.ok(html.includes("${(f.options || []).map(o => `<option>${escapeHtml(o)}</option>`).join('')}"));
});
