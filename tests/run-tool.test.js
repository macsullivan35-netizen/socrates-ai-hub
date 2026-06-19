const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const RUN_TOOL_PATH = require.resolve('../api/run-tool.js');

function makeResponse() {
  return {
    headers: {},
    statusCode: 200,
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
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

async function withRunTool({ tool, stripeSession, fetchImpl }, fn) {
  const originalLoad = Module._load;
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const calls = { stripeRetrieve: [], supabaseSelects: [], fetchBodies: [] };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
      return {
        createClient() {
          return {
            from(tableName) {
              assert.equal(tableName, 'tools');
              const query = {
                select(columns) {
                  calls.supabaseSelects.push(columns);
                  return query;
                },
                eq() {
                  return query;
                },
                maybeSingle: async () => ({ data: tool, error: null }),
              };
              return query;
            },
          };
        },
      };
    }
    if (request === 'stripe') {
      return () => ({
        checkout: {
          sessions: {
            retrieve: async (sessionId) => {
              calls.stripeRetrieve.push(sessionId);
              return stripeSession;
            },
          },
        },
      });
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  global.fetch = async (url, options) => {
    calls.fetchBodies.push(JSON.parse(options.body));
    if (fetchImpl) return fetchImpl(url, options);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hosted output' } }] }),
    };
  };

  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.STRIPE_SECRET_KEY = 'sk_stripe';

  delete require.cache[RUN_TOOL_PATH];
  const handler = require(RUN_TOOL_PATH);

  try {
    await fn(handler, calls);
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    delete require.cache[RUN_TOOL_PATH];
  }
}

async function postRun(handler, body) {
  const req = { method: 'POST', headers: {}, body };
  const res = makeResponse();
  await handler(req, res);
  return res;
}

const PAID_TOOL_ID = '123e4567-e89b-42d3-a456-426614174000';

test('paid UUID tools require checkout proof before hosted execution', async () => {
  await withRunTool({
    tool: { is_published: true, price: 9, system_prompt: 'Private paid prompt' },
  }, async (handler, calls) => {
    const res = await postRun(handler, { toolId: PAID_TOOL_ID, userMessage: 'run it' });

    assert.equal(res.statusCode, 402);
    assert.equal(res.payload.error, 'payment_required');
    assert.equal(calls.stripeRetrieve.length, 0);
    assert.equal(calls.fetchBodies.length, 0);
    assert.match(calls.supabaseSelects[0], /price/);
  });
});

test('paid UUID tools reject checkout sessions for a different tool', async () => {
  await withRunTool({
    tool: { is_published: true, price: 9, system_prompt: 'Private paid prompt' },
    stripeSession: {
      payment_status: 'paid',
      amount_total: 900,
      metadata: { tool_id: '123e4567-e89b-42d3-a456-426614174999' },
    },
  }, async (handler, calls) => {
    const res = await postRun(handler, {
      toolId: PAID_TOOL_ID,
      userMessage: 'run it',
      checkoutSessionId: 'cs_paid_wrong_tool',
    });

    assert.equal(res.statusCode, 402);
    assert.equal(res.payload.error, 'payment_required');
    assert.deepEqual(calls.stripeRetrieve, ['cs_paid_wrong_tool']);
    assert.equal(calls.fetchBodies.length, 0);
  });
});

test('matching paid checkout session unlocks hosted execution for that tool', async () => {
  await withRunTool({
    tool: { is_published: true, price: 9, system_prompt: 'Private paid prompt' },
    stripeSession: {
      payment_status: 'paid',
      amount_total: 900,
      metadata: { tool_id: PAID_TOOL_ID },
    },
  }, async (handler, calls) => {
    const res = await postRun(handler, {
      toolId: PAID_TOOL_ID,
      userMessage: 'run it',
      checkoutSessionId: 'cs_paid_matching_tool',
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.text, 'hosted output');
    assert.deepEqual(calls.stripeRetrieve, ['cs_paid_matching_tool']);
    assert.equal(calls.fetchBodies[0].messages[0].content, 'Private paid prompt');
  });
});
