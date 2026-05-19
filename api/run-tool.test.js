const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const TOOL_ID = '11111111-1111-4111-8111-111111111111';

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    payload: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

async function withRunTool({ body, tool, stripeSession, fetchImpl }) {
  const originalLoad = Module._load;
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const handlerPath = require.resolve('./run-tool.js');

  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.STRIPE_SECRET_KEY = 'sk_test_stripe';
  global.fetch = fetchImpl || (async () => {
    throw new Error('fetch should not be called');
  });

  Module._load = function load(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
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

  delete require.cache[handlerPath];
  const handler = require(handlerPath);
  const res = responseRecorder();

  try {
    await handler({ method: 'POST', body }, res);
    return res;
  } finally {
    delete require.cache[handlerPath];
    Module._load = originalLoad;
    global.fetch = originalFetch;
    process.env = originalEnv;
  }
}

test('paid database tools require a checkout session before hosted run', async () => {
  const res = await withRunTool({
    body: { toolId: TOOL_ID, userMessage: 'hello' },
    tool: { is_published: true, price: 4.99, system_prompt: 'paid prompt' },
  });

  assert.equal(res.statusCode, 402);
  assert.equal(res.payload.error, 'payment_required');
});

test('paid database tools reject checkout sessions for a different tool', async () => {
  const res = await withRunTool({
    body: { toolId: TOOL_ID, userMessage: 'hello', checkoutSessionId: 'cs_test_paid' },
    tool: { is_published: true, price: 4.99, system_prompt: 'paid prompt' },
    stripeSession: {
      payment_status: 'paid',
      amount_total: 499,
      metadata: { tool_id: '22222222-2222-4222-8222-222222222222' },
    },
  });

  assert.equal(res.statusCode, 402);
  assert.equal(res.payload.error, 'payment_required');
});

test('paid database tools run after matching paid checkout session', async () => {
  const res = await withRunTool({
    body: { toolId: TOOL_ID, userMessage: 'hello', checkoutSessionId: 'cs_test_paid' },
    tool: { is_published: true, price: 4.99, system_prompt: 'paid prompt' },
    stripeSession: {
      payment_status: 'paid',
      amount_total: 499,
      metadata: { tool_id: TOOL_ID },
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'paid output' } }] }),
    }),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.text, 'paid output');
});
