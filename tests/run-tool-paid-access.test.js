const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const RUN_TOOL_PATH = require.resolve('../api/run-tool.js');
const PAID_TOOL_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TOOL_ID = '22222222-2222-4222-8222-222222222222';

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

async function withRunToolMocks({ tool, stripeSession }, run) {
  const originalLoad = Module._load;
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const calls = { fetch: [], stripeRetrieve: [], supabaseSelect: [] };

  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
      return {
        createClient() {
          return {
            from() {
              return {
                select(selection) {
                  calls.supabaseSelect.push(selection);
                  return this;
                },
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
    }
    if (request === 'stripe') {
      return function createStripe() {
        return {
          checkout: {
            sessions: {
              async retrieve(sessionId) {
                calls.stripeRetrieve.push(sessionId);
                if (stripeSession instanceof Error) throw stripeSession;
                return stripeSession;
              },
            },
          },
        };
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  global.fetch = async (...args) => {
    calls.fetch.push(args);
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: 'hosted result' } }] };
      },
    };
  };

  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  delete require.cache[RUN_TOOL_PATH];

  try {
    const handler = require(RUN_TOOL_PATH);
    await run(handler, calls);
  } finally {
    delete require.cache[RUN_TOOL_PATH];
    Module._load = originalLoad;
    global.fetch = originalFetch;
    process.env = originalEnv;
  }
}

async function invoke(handler, body) {
  const req = { method: 'POST', body };
  const res = makeResponse();
  await handler(req, res);
  return res;
}

test('/api/run-tool rejects paid database tools without checkout proof', async () => {
  await withRunToolMocks({
    tool: { is_published: true, system_prompt: 'paid prompt', price: 9 },
    stripeSession: null,
  }, async (handler, calls) => {
    const res = await invoke(handler, { toolId: PAID_TOOL_ID, userMessage: 'hello' });

    assert.equal(res.statusCode, 402);
    assert.equal(res.body.error, 'payment_required');
    assert.equal(calls.fetch.length, 0);
    assert.equal(calls.stripeRetrieve.length, 0);
    assert.deepEqual(calls.supabaseSelect, ['system_prompt, is_published, price']);
  });
});

test('/api/run-tool rejects checkout sessions for a different tool', async () => {
  await withRunToolMocks({
    tool: { is_published: true, system_prompt: 'paid prompt', price: 9 },
    stripeSession: { payment_status: 'paid', metadata: { tool_id: OTHER_TOOL_ID } },
  }, async (handler, calls) => {
    process.env.STRIPE_SECRET_KEY = 'sk_stripe';

    const res = await invoke(handler, {
      toolId: PAID_TOOL_ID,
      checkoutSessionId: 'cs_wrong_tool',
      userMessage: 'hello',
    });

    assert.equal(res.statusCode, 402);
    assert.equal(res.body.error, 'payment_required');
    assert.deepEqual(calls.stripeRetrieve, ['cs_wrong_tool']);
    assert.equal(calls.fetch.length, 0);
  });
});

test('/api/run-tool allows paid database tools with matching paid checkout', async () => {
  await withRunToolMocks({
    tool: { is_published: true, system_prompt: 'paid prompt', price: 9 },
    stripeSession: { payment_status: 'paid', metadata: { tool_id: PAID_TOOL_ID } },
  }, async (handler, calls) => {
    process.env.STRIPE_SECRET_KEY = 'sk_stripe';

    const res = await invoke(handler, {
      toolId: PAID_TOOL_ID,
      checkoutSessionId: 'cs_paid',
      userMessage: 'hello',
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.text, 'hosted result');
    assert.deepEqual(calls.stripeRetrieve, ['cs_paid']);
    assert.equal(calls.fetch.length, 1);
  });
});

test('/api/run-tool still allows free database tools without checkout', async () => {
  await withRunToolMocks({
    tool: { is_published: true, system_prompt: 'free prompt', price: 0 },
    stripeSession: null,
  }, async (handler, calls) => {
    const res = await invoke(handler, { toolId: PAID_TOOL_ID, userMessage: 'hello' });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.text, 'hosted result');
    assert.equal(calls.stripeRetrieve.length, 0);
    assert.equal(calls.fetch.length, 1);
  });
});
