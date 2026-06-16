const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const path = require('node:path');

const ROUTE_PATH = path.join(__dirname, '..', 'api', 'run-tool.js');
const TOOL_ID = '11111111-1111-4111-8111-111111111111';

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: undefined,
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

async function invokeRunTool({ body, tool, session, fetchImpl }) {
  const originalLoad = Module._load;
  const originalFetch = global.fetch;
  const oldEnv = { ...process.env };
  const calls = { stripeSessionIds: [], selectedColumns: [] };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
      return {
        createClient: () => ({
          from: () => ({
            select(columns) {
              calls.selectedColumns.push(columns);
              return this;
            },
            eq() {
              return this;
            },
            maybeSingle: async () => ({ data: tool, error: null }),
          }),
        }),
      };
    }
    if (request === 'stripe') {
      return () => ({
        checkout: {
          sessions: {
            retrieve: async (id) => {
              calls.stripeSessionIds.push(id);
              if (session instanceof Error) throw session;
              return session;
            },
          },
        },
      });
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  Object.assign(process.env, {
    OPENAI_API_KEY: 'sk-openai-test',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    STRIPE_SECRET_KEY: 'sk-stripe-test',
  });
  global.fetch = fetchImpl || (async () => {
    throw new Error('unexpected upstream fetch');
  });

  try {
    delete require.cache[require.resolve(ROUTE_PATH)];
    const route = require(ROUTE_PATH);
    const res = mockResponse();
    await route({ method: 'POST', body }, res);
    return { res, calls };
  } finally {
    delete require.cache[require.resolve(ROUTE_PATH)];
    Module._load = originalLoad;
    global.fetch = originalFetch;
    process.env = oldEnv;
  }
}

test('paid UUID tools require a checkout session before hosted runs', async () => {
  let upstreamCalled = false;
  const { res, calls } = await invokeRunTool({
    body: { toolId: TOOL_ID, userMessage: 'run it' },
    tool: { system_prompt: 'paid secret prompt', is_published: true, price: 9 },
    fetchImpl: async () => {
      upstreamCalled = true;
      return { ok: true, json: async () => ({}) };
    },
  });

  assert.equal(res.statusCode, 402);
  assert.equal(res.payload.error, 'payment_required');
  assert.equal(upstreamCalled, false);
  assert.equal(calls.stripeSessionIds.length, 0);
  assert.equal(calls.selectedColumns[0], 'system_prompt, is_published, price');
});

test('paid UUID tools reject checkout sessions for a different tool', async () => {
  const { res, calls } = await invokeRunTool({
    body: { toolId: TOOL_ID, checkoutSessionId: 'cs_paid_other', userMessage: 'run it' },
    tool: { system_prompt: 'paid secret prompt', is_published: true, price: 9 },
    session: { payment_status: 'paid', metadata: { tool_id: '22222222-2222-4222-8222-222222222222' } },
  });

  assert.equal(res.statusCode, 402);
  assert.equal(res.payload.error, 'payment_required');
  assert.deepEqual(calls.stripeSessionIds, ['cs_paid_other']);
});

test('free UUID tools continue to run without Stripe checkout state', async () => {
  let upstreamBody;
  const { res } = await invokeRunTool({
    body: { toolId: TOOL_ID, userMessage: 'hello' },
    tool: { system_prompt: 'free prompt', is_published: true, price: 0 },
    fetchImpl: async (_url, init) => {
      upstreamBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      };
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.text, 'ok');
  assert.equal(upstreamBody.messages[0].content, 'free prompt');
  assert.equal(upstreamBody.messages[1].content, 'hello');
});
