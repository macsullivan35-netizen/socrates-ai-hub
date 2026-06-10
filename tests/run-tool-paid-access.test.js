const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const ROUTE_PATH = require.resolve('../api/run-tool.js');

function mockResponse() {
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

async function withRunToolHandler({ tool, stripeSession, fetchImpl }, fn) {
  const originalLoad = Module._load;
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  Module._load = function mockLoad(request, parent, isMain) {
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

    return originalLoad(request, parent, isMain);
  };

  global.fetch = fetchImpl || (async () => {
    throw new Error('fetch should not be called');
  });

  process.env.OPENAI_API_KEY = 'sk-test-openai';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.STRIPE_SECRET_KEY = 'sk_test_stripe';

  delete require.cache[ROUTE_PATH];
  const handler = require(ROUTE_PATH);

  try {
    return await fn(handler);
  } finally {
    delete require.cache[ROUTE_PATH];
    Module._load = originalLoad;
    global.fetch = originalFetch;
    process.env = originalEnv;
  }
}

test('paid database tools reject hosted runs without a checkout session', async () => {
  let fetchCalled = false;
  await withRunToolHandler({
    tool: { is_published: true, price: 12, system_prompt: 'Secret paid prompt' },
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('unexpected fetch');
    },
  }, async (handler) => {
    const res = mockResponse();
    await handler({
      method: 'POST',
      headers: {},
      body: {
        toolId: '11111111-1111-4111-8111-111111111111',
        userMessage: 'Run it',
        model: 'gpt',
      },
    }, res);

    assert.equal(res.statusCode, 402);
    assert.equal(res.body.error, 'payment_required');
    assert.equal(fetchCalled, false);
  });
});

test('paid database tools reject checkout sessions for a different tool', async () => {
  let fetchCalled = false;
  await withRunToolHandler({
    tool: { is_published: true, price: 12, system_prompt: 'Secret paid prompt' },
    stripeSession: {
      payment_status: 'paid',
      metadata: { tool_id: '22222222-2222-4222-8222-222222222222' },
    },
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('unexpected fetch');
    },
  }, async (handler) => {
    const res = mockResponse();
    await handler({
      method: 'POST',
      headers: {},
      body: {
        toolId: '11111111-1111-4111-8111-111111111111',
        purchaseSessionId: 'cs_paid_other_tool',
        userMessage: 'Run it',
        model: 'gpt',
      },
    }, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'session_tool_mismatch');
    assert.equal(fetchCalled, false);
  });
});

test('paid database tools allow hosted runs with a paid matching checkout session', async () => {
  let upstreamBody;
  await withRunToolHandler({
    tool: { is_published: true, price: 12, system_prompt: 'Secret paid prompt' },
    stripeSession: {
      payment_status: 'paid',
      metadata: { tool_id: '11111111-1111-4111-8111-111111111111' },
    },
    fetchImpl: async (_url, options) => {
      upstreamBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Paid result' } }],
        }),
      };
    },
  }, async (handler) => {
    const res = mockResponse();
    await handler({
      method: 'POST',
      headers: {},
      body: {
        toolId: '11111111-1111-4111-8111-111111111111',
        purchaseSessionId: 'cs_paid_matching_tool',
        userMessage: 'Run it',
        model: 'gpt',
      },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.text, 'Paid result');
    assert.equal(upstreamBody.messages[0].content, 'Secret paid prompt');
  });
});
