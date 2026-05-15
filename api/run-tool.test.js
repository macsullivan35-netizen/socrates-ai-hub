const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const test = require('node:test');

const RUN_TOOL_PATH = path.join(__dirname, 'run-tool.js');
const SUPABASE_PATH = require.resolve('@supabase/supabase-js');
const STRIPE_PATH = require.resolve('stripe');
const TOOL_ID = '11111111-1111-4111-8111-111111111111';

function fakeResponse() {
  const result = { headers: {}, statusCode: null, body: null, ended: false };
  return {
    result,
    res: {
      setHeader(name, value) {
        result.headers[name] = value;
      },
      status(code) {
        result.statusCode = code;
        return this;
      },
      json(body) {
        result.body = body;
        return result;
      },
      end() {
        result.ended = true;
        return result;
      },
    },
  };
}

async function invoke(handler, body) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.body = body;
  const { res, result } = fakeResponse();
  await handler(req, res);
  return result;
}

function loadRunTool({ tool, session, stripeRejects = false }) {
  const calls = { fetch: 0, stripeSessionIds: [], select: '' };
  const originalSupabase = require.cache[SUPABASE_PATH];
  const originalStripe = require.cache[STRIPE_PATH];
  const originalRunTool = require.cache[RUN_TOOL_PATH];

  delete require.cache[RUN_TOOL_PATH];
  require.cache[SUPABASE_PATH] = {
    id: SUPABASE_PATH,
    filename: SUPABASE_PATH,
    loaded: true,
    exports: {
      createClient: () => ({
        from: () => {
          const query = {
            select(columns) {
              calls.select = columns;
              return query;
            },
            eq() {
              return query;
            },
            maybeSingle: async () => ({ data: tool, error: null }),
          };
          return query;
        },
      }),
    },
  };
  require.cache[STRIPE_PATH] = {
    id: STRIPE_PATH,
    filename: STRIPE_PATH,
    loaded: true,
    exports: () => ({
      checkout: {
        sessions: {
          retrieve: async (id) => {
            calls.stripeSessionIds.push(id);
            if (stripeRejects) throw new Error('bad session');
            return session;
          },
        },
      },
    }),
  };

  global.fetch = async () => {
    calls.fetch += 1;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hosted result' } }] }),
    };
  };

  const handler = require(RUN_TOOL_PATH);
  return {
    calls,
    handler,
    cleanup() {
      delete require.cache[RUN_TOOL_PATH];
      if (originalRunTool) require.cache[RUN_TOOL_PATH] = originalRunTool;
      if (originalSupabase) require.cache[SUPABASE_PATH] = originalSupabase;
      else delete require.cache[SUPABASE_PATH];
      if (originalStripe) require.cache[STRIPE_PATH] = originalStripe;
      else delete require.cache[STRIPE_PATH];
      delete global.fetch;
    },
  };
}

test.beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.STRIPE_SECRET_KEY = 'sk_test_stripe';
});

test.afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  delete global.fetch;
});

test('paid Supabase tools require a checkout session before hosted runs', async () => {
  const loaded = loadRunTool({
    tool: { system_prompt: 'paid prompt', is_published: true, price: 9.99 },
  });
  try {
    const result = await invoke(loaded.handler, { toolId: TOOL_ID, userMessage: 'hello' });

    assert.equal(result.statusCode, 402);
    assert.equal(result.body.error, 'payment_required');
    assert.equal(loaded.calls.fetch, 0);
    assert.deepEqual(loaded.calls.stripeSessionIds, []);
    assert.match(loaded.calls.select, /\bprice\b/);
  } finally {
    loaded.cleanup();
  }
});

test('paid Supabase tools reject checkout sessions for another tool', async () => {
  const loaded = loadRunTool({
    tool: { system_prompt: 'paid prompt', is_published: true, price: 9.99 },
    session: { payment_status: 'paid', metadata: { tool_id: '22222222-2222-4222-8222-222222222222' } },
  });
  try {
    const result = await invoke(loaded.handler, {
      toolId: TOOL_ID,
      userMessage: 'hello',
      checkoutSessionId: 'cs_paid',
    });

    assert.equal(result.statusCode, 403);
    assert.equal(result.body.error, 'tool_mismatch');
    assert.equal(loaded.calls.fetch, 0);
    assert.deepEqual(loaded.calls.stripeSessionIds, ['cs_paid']);
  } finally {
    loaded.cleanup();
  }
});

test('paid Supabase tools run with a paid checkout session for the same tool', async () => {
  const loaded = loadRunTool({
    tool: { system_prompt: 'paid prompt', is_published: true, price: 9.99 },
    session: { payment_status: 'paid', metadata: { tool_id: TOOL_ID } },
  });
  try {
    const result = await invoke(loaded.handler, {
      toolId: TOOL_ID,
      userMessage: 'hello',
      checkoutSessionId: 'cs_paid',
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.body.text, 'hosted result');
    assert.equal(loaded.calls.fetch, 1);
    assert.deepEqual(loaded.calls.stripeSessionIds, ['cs_paid']);
  } finally {
    loaded.cleanup();
  }
});

test('free Supabase tools still run without checkout', async () => {
  const loaded = loadRunTool({
    tool: { system_prompt: 'free prompt', is_published: true, price: 0 },
  });
  try {
    const result = await invoke(loaded.handler, { toolId: TOOL_ID, userMessage: 'hello' });

    assert.equal(result.statusCode, 200);
    assert.equal(result.body.text, 'hosted result');
    assert.equal(loaded.calls.fetch, 1);
    assert.deepEqual(loaded.calls.stripeSessionIds, []);
  } finally {
    loaded.cleanup();
  }
});
