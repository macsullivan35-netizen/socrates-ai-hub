const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const RUN_TOOL_PATH = require.resolve('../api/run-tool.js');
const PAID_TOOL_ID = '123e4567-e89b-12d3-a456-426614174000';

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function loadRunTool({ tool, stripeSession }) {
  delete require.cache[RUN_TOOL_PATH];
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
      return {
        createClient() {
          return {
            from(table) {
              assert.equal(table, 'tools');
              return {
                select(columns) {
                  assert.match(columns, /price/);
                  return {
                    eq() {
                      return this;
                    },
                    async maybeSingle() {
                      return { data: tool, error: null };
                    },
                  };
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
              assert.equal(sessionId, 'cs_test_paid');
              return stripeSession;
            },
          },
        },
      });
    }
    return originalLoad.apply(this, arguments);
  };

  const handler = require(RUN_TOOL_PATH);
  Module._load = originalLoad;
  return handler;
}

async function call(handler, body) {
  const req = { method: 'POST', body };
  const res = makeResponse();
  await handler(req, res);
  return res;
}

test('paid database tools require a checkout session before hosted run', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  delete process.env.STRIPE_SECRET_KEY;
  let upstreamCalled = false;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    upstreamCalled = true;
    throw new Error('should not call upstream');
  };

  try {
    const handler = loadRunTool({
      tool: { system_prompt: 'paid prompt', is_published: true, price: 5 },
      stripeSession: null,
    });
    const res = await call(handler, { toolId: PAID_TOOL_ID, userMessage: 'hello', model: 'gpt' });

    assert.equal(res.statusCode, 402);
    assert.equal(res.body.error, 'payment_required');
    assert.equal(upstreamCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('paid database tools reject checkout sessions for a different tool', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.STRIPE_SECRET_KEY = 'sk_stripe';
  let upstreamCalled = false;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    upstreamCalled = true;
    throw new Error('should not call upstream');
  };

  try {
    const handler = loadRunTool({
      tool: { system_prompt: 'paid prompt', is_published: true, price: 5 },
      stripeSession: { payment_status: 'paid', metadata: { tool_id: '00000000-0000-1000-8000-000000000000' } },
    });
    const res = await call(handler, {
      toolId: PAID_TOOL_ID,
      checkoutSessionId: 'cs_test_paid',
      userMessage: 'hello',
      model: 'gpt',
    });

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'invalid_purchase');
    assert.equal(upstreamCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('paid database tools run after a paid matching checkout session', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.STRIPE_SECRET_KEY = 'sk_stripe';
  const originalFetch = global.fetch;
  global.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    assert.equal(body.messages[0].content, 'paid prompt');
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    };
  };

  try {
    const handler = loadRunTool({
      tool: { system_prompt: 'paid prompt', is_published: true, price: 5 },
      stripeSession: { payment_status: 'paid', metadata: { tool_id: PAID_TOOL_ID } },
    });
    const res = await call(handler, {
      toolId: PAID_TOOL_ID,
      checkoutSessionId: 'cs_test_paid',
      userMessage: 'hello',
      model: 'gpt',
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.text, 'ok');
  } finally {
    global.fetch = originalFetch;
  }
});
