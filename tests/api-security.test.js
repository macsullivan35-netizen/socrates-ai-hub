const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const PAID_TOOL_ID = '11111111-1111-4111-8111-111111111111';

function loadFresh(relativePath) {
  const fullPath = path.resolve(__dirname, '..', relativePath);
  const resolved = require.resolve(fullPath);
  delete require.cache[resolved];
  return require(resolved);
}

async function withMockedModules(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return await fn();
  } finally {
    Module._load = originalLoad;
  }
}

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

function supabaseToolClient(tool) {
  return {
    from(table) {
      assert.equal(table, 'tools');
      const query = {
        select() { return query; },
        eq() { return query; },
        maybeSingle: async () => ({ data: tool, error: null }),
      };
      return query;
    },
  };
}

test('run-tool rejects paid tools without checkout before calling an LLM', async () => {
  const oldEnv = { ...process.env };
  const oldFetch = global.fetch;
  let retrieveCalled = false;
  let llmCalled = false;

  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.STRIPE_SECRET_KEY = 'sk_test_stripe';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  global.fetch = async () => {
    llmCalled = true;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };

  try {
    await withMockedModules({
      '@supabase/supabase-js': {
        createClient: () => supabaseToolClient({
          system_prompt: 'paid prompt',
          is_published: true,
          price: 9,
        }),
      },
      stripe: () => ({
        checkout: {
          sessions: {
            retrieve: async () => {
              retrieveCalled = true;
              return { payment_status: 'paid', metadata: { tool_id: PAID_TOOL_ID } };
            },
          },
        },
      }),
    }, async () => {
      const handler = loadFresh('api/run-tool.js');
      const res = createResponse();

      await handler({
        method: 'POST',
        body: { toolId: PAID_TOOL_ID, userMessage: 'hello' },
      }, res);

      assert.equal(res.statusCode, 402);
      assert.equal(res.body.error, 'payment_required');
      assert.equal(retrieveCalled, false);
      assert.equal(llmCalled, false);
    });
  } finally {
    process.env = oldEnv;
    global.fetch = oldFetch;
  }
});

test('run-tool rejects paid tool sessions for a different tool', async () => {
  const oldEnv = { ...process.env };
  const oldFetch = global.fetch;
  let llmCalled = false;

  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.STRIPE_SECRET_KEY = 'sk_test_stripe';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  global.fetch = async () => {
    llmCalled = true;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };

  try {
    await withMockedModules({
      '@supabase/supabase-js': {
        createClient: () => supabaseToolClient({
          system_prompt: 'paid prompt',
          is_published: true,
          price: 9,
        }),
      },
      stripe: () => ({
        checkout: {
          sessions: {
            retrieve: async () => ({
              payment_status: 'paid',
              metadata: { tool_id: '22222222-2222-4222-8222-222222222222' },
            }),
          },
        },
      }),
    }, async () => {
      const handler = loadFresh('api/run-tool.js');
      const res = createResponse();

      await handler({
        method: 'POST',
        body: { toolId: PAID_TOOL_ID, userMessage: 'hello', sessionId: 'cs_paid_other_tool' },
      }, res);

      assert.equal(res.statusCode, 402);
      assert.equal(res.body.error, 'payment_required');
      assert.equal(llmCalled, false);
    });
  } finally {
    process.env = oldEnv;
    global.fetch = oldFetch;
  }
});

test('stats requires a bearer token before reading Stripe charges', async () => {
  const oldEnv = { ...process.env };
  let chargesListed = false;

  process.env.STRIPE_SECRET_KEY = 'sk_test_stripe';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  try {
    await withMockedModules({
      '@supabase/supabase-js': {
        createClient: () => {
          throw new Error('auth should not be called without a token');
        },
      },
      stripe: () => ({
        charges: {
          list: async () => {
            chargesListed = true;
            return { data: [] };
          },
        },
      }),
    }, async () => {
      const handler = loadFresh('api/stats.js');
      const res = createResponse();

      await handler({ method: 'GET', headers: {} }, res);

      assert.equal(res.statusCode, 401);
      assert.equal(chargesListed, false);
    });
  } finally {
    process.env = oldEnv;
  }
});

test('stats only returns charges for the authenticated builder', async () => {
  const oldEnv = { ...process.env };

  process.env.STRIPE_SECRET_KEY = 'sk_test_stripe';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  try {
    await withMockedModules({
      '@supabase/supabase-js': {
        createClient: () => ({
          auth: {
            getUser: async token => {
              assert.equal(token, 'valid-token');
              return { data: { user: { id: 'builder-1' } }, error: null };
            },
          },
        }),
      },
      stripe: () => ({
        charges: {
          list: async () => ({
            data: [
              {
                id: 'ch_builder',
                status: 'succeeded',
                amount: 1200,
                description: 'Builder tool',
                metadata: { creator_id: 'builder-1' },
                billing_details: { email: 'buyer@example.com' },
                created: 1760000000,
              },
              {
                id: 'ch_other',
                status: 'succeeded',
                amount: 9900,
                description: 'Other builder tool',
                metadata: { creator_id: 'builder-2' },
                billing_details: { email: 'other@example.com' },
                created: 1760000001,
              },
            ],
          }),
        },
      }),
    }, async () => {
      const handler = loadFresh('api/stats.js');
      const res = createResponse();

      await handler({ method: 'GET', headers: { authorization: 'Bearer valid-token' } }, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.totalRevenue, 12);
      assert.equal(res.body.totalSales, 1);
      assert.equal(res.body.totalCustomers, 1);
      assert.deepEqual(res.body.byProduct, { 'Builder tool': 12 });
      assert.equal(res.body.recent.length, 1);
      assert.equal(res.body.recent[0].customer, 'buyer@example.com');
    });
  } finally {
    process.env = oldEnv;
  }
});
