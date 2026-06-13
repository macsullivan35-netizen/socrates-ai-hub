const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const ROUTE_PATH = path.join(__dirname, '..', 'api', 'run-tool.js');
const PAID_TOOL_ID = '123e4567-e89b-12d3-a456-426614174000';

function mockResponse() {
  return {
    headers: {},
    statusCode: 200,
    payload: undefined,
    setHeader(key, value) {
      this.headers[key] = value;
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
      this.ended = true;
      return this;
    },
  };
}

async function runRoute({ body, tool, stripeSession }) {
  const originalLoad = Module._load;
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const calls = { fetch: [], stripeRetrieve: [] };

  process.env.OPENAI_API_KEY = 'sk-test-openai';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.STRIPE_SECRET_KEY = 'sk_test_stripe';

  Module._load = function patchedLoad(request, parent, isMain) {
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
      return (key) => ({
        checkout: {
          sessions: {
            retrieve: async (sessionId) => {
              calls.stripeRetrieve.push({ key, sessionId });
              return stripeSession;
            },
          },
        },
      });
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  global.fetch = async (url, options) => {
    calls.fetch.push({ url, options });
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hosted output' } }] }),
    };
  };

  try {
    delete require.cache[ROUTE_PATH];
    const handler = require(ROUTE_PATH);
    const res = mockResponse();
    await handler({ method: 'POST', body }, res);
    return { res, calls };
  } finally {
    delete require.cache[ROUTE_PATH];
    Module._load = originalLoad;
    global.fetch = originalFetch;
    process.env = originalEnv;
  }
}

test('paid database tools require a checkout session before upstream execution', async () => {
  const { res, calls } = await runRoute({
    body: { toolId: PAID_TOOL_ID, userMessage: 'run it' },
    tool: {
      system_prompt: 'Paid tool prompt',
      is_published: true,
      price: 9,
    },
  });

  assert.equal(res.statusCode, 402);
  assert.equal(res.payload.error, 'payment_required');
  assert.equal(calls.stripeRetrieve.length, 0);
  assert.equal(calls.fetch.length, 0);
});

test('paid database tools run when the paid checkout session matches the tool', async () => {
  const { res, calls } = await runRoute({
    body: {
      toolId: PAID_TOOL_ID,
      userMessage: 'run it',
      checkoutSessionId: 'cs_paid',
    },
    tool: {
      system_prompt: 'Paid tool prompt',
      is_published: true,
      price: 9,
    },
    stripeSession: {
      payment_status: 'paid',
      metadata: { tool_id: PAID_TOOL_ID },
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.text, 'hosted output');
  assert.deepEqual(calls.stripeRetrieve, [{ key: 'sk_test_stripe', sessionId: 'cs_paid' }]);
  assert.equal(calls.fetch.length, 1);
});
