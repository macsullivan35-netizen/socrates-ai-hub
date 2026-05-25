const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const RUN_TOOL_PATH = path.join(__dirname, '..', 'api', 'run-tool.js');
const PAID_TOOL_ID = '11111111-1111-4111-8111-111111111111';

function mockResponse() {
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

async function withRunToolMocks({ tool, stripeSession, fetchImpl }, fn) {
  const originalLoad = Module._load;
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  delete require.cache[RUN_TOOL_PATH];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
      return {
        createClient() {
          return {
            from() {
              return {
                select() { return this; },
                eq() { return this; },
                maybeSingle: async () => ({ data: tool, error: null }),
              };
            },
          };
        },
      };
    }
    if (request === 'stripe') {
      return () => ({
        checkout: {
          sessions: {
            retrieve: async () => stripeSession,
          },
        },
      });
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  global.fetch = fetchImpl || (async () => {
    throw new Error('fetch should not be called');
  });

  try {
    const handler = require(RUN_TOOL_PATH);
    await fn(handler);
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    process.env = originalEnv;
    delete require.cache[RUN_TOOL_PATH];
  }
}

test('paid database tools require checkout before hosted LLM calls', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  delete process.env.STRIPE_SECRET_KEY;

  await withRunToolMocks({
    tool: { system_prompt: 'paid prompt', is_published: true, price: 5 },
  }, async (handler) => {
    const res = mockResponse();
    await handler({
      method: 'POST',
      body: { toolId: PAID_TOOL_ID, userMessage: 'hello', model: 'gpt' },
    }, res);

    assert.equal(res.statusCode, 402);
    assert.equal(res.body.error, 'payment_required');
    assert.match(res.body.message, /checkout/i);
  });
});

test('paid database tools run after a matching paid checkout session', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.STRIPE_SECRET_KEY = 'stripe-secret';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  await withRunToolMocks({
    tool: { system_prompt: 'paid prompt', is_published: true, price: 5 },
    stripeSession: {
      payment_status: 'paid',
      metadata: { tool_id: PAID_TOOL_ID },
      amount_total: 500,
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'paid output' } }] }),
    }),
  }, async (handler) => {
    const res = mockResponse();
    await handler({
      method: 'POST',
      body: {
        toolId: PAID_TOOL_ID,
        checkoutSessionId: 'cs_paid',
        userMessage: 'hello',
        model: 'gpt',
      },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { text: 'paid output', model: 'gpt-4o-mini', via: 'hosted' });
  });
});
