const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const test = require('node:test');

const PAID_TOOL_ID = '123e4567-e89b-42d3-a456-426614174000';

function responseRecorder() {
  const res = {
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
  return res;
}

function requestWithBody(body) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.body = body;
  return req;
}

function loadRunToolRoute({ tool, stripeSession }) {
  const routePath = require.resolve('../api/run-tool.js');
  delete require.cache[routePath];

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
      return {
        createClient() {
          return {
            from(table) {
              assert.equal(table, 'tools');
              const query = {
                selectedColumns: '',
                select(columns) {
                  this.selectedColumns = columns;
                  return this;
                },
                eq() {
                  return this;
                },
                async maybeSingle() {
                  assert.match(this.selectedColumns, /price/);
                  return { data: tool, error: null };
                },
              };
              return query;
            },
          };
        },
      };
    }
    if (request === 'stripe') {
      return function stripeFactory(secret) {
        assert.equal(secret, 'sk_test_route');
        return {
          checkout: {
            sessions: {
              async retrieve(sessionId) {
                return typeof stripeSession === 'function' ? stripeSession(sessionId) : stripeSession;
              },
            },
          },
        };
      };
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    return require('../api/run-tool.js');
  } finally {
    Module._load = originalLoad;
  }
}

test('paid UUID tools require a paid checkout session before hosted runs', async (t) => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  t.after(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  process.env.OPENAI_API_KEY = 'openai_test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role';
  process.env.STRIPE_SECRET_KEY = 'sk_test_route';
  let upstreamCalls = 0;
  global.fetch = async () => {
    upstreamCalls += 1;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'should not run' } }] }) };
  };

  const route = loadRunToolRoute({
    tool: { system_prompt: 'paid prompt', is_published: true, price: 19 },
    stripeSession: null,
  });

  const res = responseRecorder();
  await route(requestWithBody({ toolId: PAID_TOOL_ID, userMessage: 'hello' }), res);

  assert.equal(res.statusCode, 402);
  assert.equal(res.body.error, 'payment_required');
  assert.equal(upstreamCalls, 0);
});

test('paid UUID tools reject checkout sessions for a different tool', async (t) => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  t.after(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  process.env.OPENAI_API_KEY = 'openai_test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role';
  process.env.STRIPE_SECRET_KEY = 'sk_test_route';
  let upstreamCalls = 0;
  global.fetch = async () => {
    upstreamCalls += 1;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'should not run' } }] }) };
  };

  const route = loadRunToolRoute({
    tool: { system_prompt: 'paid prompt', is_published: true, price: 19 },
    stripeSession: { payment_status: 'paid', metadata: { tool_id: '123e4567-e89b-42d3-a456-426614174999' } },
  });

  const res = responseRecorder();
  await route(requestWithBody({ toolId: PAID_TOOL_ID, userMessage: 'hello', checkoutSessionId: 'cs_test_wrong' }), res);

  assert.equal(res.statusCode, 402);
  assert.equal(res.body.error, 'payment_required');
  assert.equal(upstreamCalls, 0);
});

test('paid UUID tools run when the checkout session is paid for that exact tool', async (t) => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  t.after(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  process.env.OPENAI_API_KEY = 'openai_test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role';
  process.env.STRIPE_SECRET_KEY = 'sk_test_route';
  let upstreamCalls = 0;
  global.fetch = async () => {
    upstreamCalls += 1;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'paid run ok' } }] }) };
  };

  const route = loadRunToolRoute({
    tool: { system_prompt: 'paid prompt', is_published: true, price: 19 },
    stripeSession: { payment_status: 'paid', metadata: { tool_id: PAID_TOOL_ID } },
  });

  const res = responseRecorder();
  await route(requestWithBody({ toolId: PAID_TOOL_ID, userMessage: 'hello', checkoutSessionId: 'cs_test_paid' }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.text, 'paid run ok');
  assert.equal(upstreamCalls, 1);
});
