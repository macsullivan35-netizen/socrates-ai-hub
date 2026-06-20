const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');

function createRes() {
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
      return this;
    },
  };
}

function restoreEnv(originalEnv) {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value;
  }
}

async function invokeRunTool({ tool, body, stripeSession, fetchResponse }) {
  const originalLoad = Module._load;
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const fetchCalls = [];
  let stripeRetrieveCalls = 0;

  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
      return {
        createClient() {
          return {
            from(table) {
              assert.equal(table, 'tools');
              return {
                select(columns) {
                  assert.match(columns, /price/);
                  return this;
                },
                eq() {
                  return this;
                },
                maybeSingle() {
                  return Promise.resolve({ data: tool, error: null });
                },
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
            async retrieve(sessionId) {
              stripeRetrieveCalls += 1;
              if (stripeSession instanceof Error) throw stripeSession;
              assert.equal(sessionId, body.checkoutSessionId);
              return stripeSession;
            },
          },
        },
      });
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return fetchResponse || {
      ok: true,
      async json() {
        return { choices: [{ message: { content: 'ok' } }] };
      },
    };
  };

  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.STRIPE_SECRET_KEY = 'sk_stripe';

  delete require.cache[require.resolve('../api/run-tool.js')];
  const handler = require('../api/run-tool.js');
  const res = createRes();

  try {
    await handler({ method: 'POST', body }, res);
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
    delete require.cache[require.resolve('../api/run-tool.js')];
  }

  return { res, fetchCalls, stripeRetrieveCalls };
}

const paidTool = {
  system_prompt: 'You are a paid tool.',
  is_published: true,
  price: 5,
};

test('paid UUID tools require a checkout session before upstream AI calls', async () => {
  const { res, fetchCalls, stripeRetrieveCalls } = await invokeRunTool({
    tool: paidTool,
    body: {
      toolId: '11111111-1111-4111-8111-111111111111',
      userMessage: 'run',
    },
  });

  assert.equal(res.statusCode, 402);
  assert.equal(res.body.error, 'payment_required');
  assert.equal(fetchCalls.length, 0);
  assert.equal(stripeRetrieveCalls, 0);
});

test('paid UUID tools reject checkout sessions for another tool', async () => {
  const { res, fetchCalls, stripeRetrieveCalls } = await invokeRunTool({
    tool: paidTool,
    body: {
      toolId: '11111111-1111-4111-8111-111111111111',
      userMessage: 'run',
      checkoutSessionId: 'cs_paid_other_tool',
    },
    stripeSession: {
      payment_status: 'paid',
      metadata: { tool_id: '22222222-2222-4222-8222-222222222222' },
    },
  });

  assert.equal(res.statusCode, 402);
  assert.equal(res.body.error, 'payment_required');
  assert.equal(fetchCalls.length, 0);
  assert.equal(stripeRetrieveCalls, 1);
});

test('paid UUID tools run only after a matching paid checkout session', async () => {
  const toolId = '11111111-1111-4111-8111-111111111111';
  const { res, fetchCalls, stripeRetrieveCalls } = await invokeRunTool({
    tool: paidTool,
    body: {
      toolId,
      userMessage: 'run',
      checkoutSessionId: 'cs_paid_matching_tool',
    },
    stripeSession: {
      payment_status: 'paid',
      metadata: { tool_id: toolId },
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.text, 'ok');
  assert.equal(fetchCalls.length, 1);
  assert.equal(stripeRetrieveCalls, 1);
});

test('free UUID tools do not require checkout', async () => {
  const { res, fetchCalls, stripeRetrieveCalls } = await invokeRunTool({
    tool: {
      system_prompt: 'You are a free tool.',
      is_published: true,
      price: 0,
    },
    body: {
      toolId: '11111111-1111-4111-8111-111111111111',
      userMessage: 'run',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.text, 'ok');
  assert.equal(fetchCalls.length, 1);
  assert.equal(stripeRetrieveCalls, 0);
});
