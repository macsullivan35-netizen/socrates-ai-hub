const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const ROUTE_PATH = path.resolve(__dirname, '../api/run-tool.js');
const TOOL_ID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_TOOL_ID = '123e4567-e89b-42d3-a456-426614174999';

function loadRunToolRoute({ tool, stripeSession, stripeError }) {
  delete require.cache[ROUTE_PATH];

  const selectedColumns = [];
  const stripeRetrieves = [];
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
      return {
        createClient() {
          return {
            from() {
              const query = {
                select(columns) {
                  selectedColumns.push(columns);
                  return query;
                },
                eq() {
                  return query;
                },
                async maybeSingle() {
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
      return function stripeFactory(secretKey) {
        return {
          checkout: {
            sessions: {
              async retrieve(sessionId) {
                stripeRetrieves.push({ secretKey, sessionId });
                if (stripeError) throw stripeError;
                return stripeSession;
              },
            },
          },
        };
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return {
      route: require(ROUTE_PATH),
      selectedColumns,
      stripeRetrieves,
    };
  } finally {
    Module._load = originalLoad;
  }
}

function makeRes() {
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
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

async function withRouteEnv(fn) {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const fetchCalls = [];

  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.STRIPE_SECRET_KEY = 'sk_stripe_test';

  global.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: 'model output' } }] };
      },
    };
  };

  try {
    await fn(fetchCalls);
  } finally {
    process.env = originalEnv;
    global.fetch = originalFetch;
    delete require.cache[ROUTE_PATH];
  }
}

test('paid UUID tools require a checkout session before hosted model calls', async () => {
  await withRouteEnv(async (fetchCalls) => {
    const { route, stripeRetrieves } = loadRunToolRoute({
      tool: { system_prompt: 'secret paid prompt', is_published: true, price: 9 },
    });
    const res = makeRes();

    await route({ method: 'POST', body: { toolId: TOOL_ID, userMessage: 'hello' } }, res);

    assert.equal(res.statusCode, 402);
    assert.equal(res.payload.error, 'payment_required');
    assert.equal(fetchCalls.length, 0);
    assert.equal(stripeRetrieves.length, 0);
  });
});

test('paid UUID tools reject checkout sessions for a different tool', async () => {
  await withRouteEnv(async (fetchCalls) => {
    const { route, stripeRetrieves } = loadRunToolRoute({
      tool: { system_prompt: 'secret paid prompt', is_published: true, price: 9 },
      stripeSession: { payment_status: 'paid', metadata: { tool_id: OTHER_TOOL_ID } },
    });
    const res = makeRes();

    await route({
      method: 'POST',
      body: { toolId: TOOL_ID, userMessage: 'hello', checkoutSessionId: 'cs_test_wrong_tool' },
    }, res);

    assert.equal(res.statusCode, 402);
    assert.equal(res.payload.error, 'payment_required');
    assert.equal(fetchCalls.length, 0);
    assert.deepEqual(stripeRetrieves, [{ secretKey: 'sk_stripe_test', sessionId: 'cs_test_wrong_tool' }]);
  });
});

test('paid UUID tools run only after a paid matching checkout session', async () => {
  await withRouteEnv(async (fetchCalls) => {
    const { route } = loadRunToolRoute({
      tool: { system_prompt: 'secret paid prompt', is_published: true, price: 9 },
      stripeSession: { payment_status: 'paid', metadata: { tool_id: TOOL_ID } },
    });
    const res = makeRes();

    await route({
      method: 'POST',
      body: { toolId: TOOL_ID, userMessage: 'hello', checkoutSessionId: 'cs_test_paid_match' },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.text, 'model output');
    assert.equal(fetchCalls.length, 1);
  });
});

test('free UUID tools do not require Stripe verification', async () => {
  await withRouteEnv(async (fetchCalls) => {
    const { route, stripeRetrieves } = loadRunToolRoute({
      tool: { system_prompt: 'free prompt', is_published: true, price: 0 },
    });
    const res = makeRes();

    await route({ method: 'POST', body: { toolId: TOOL_ID, userMessage: 'hello' } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(fetchCalls.length, 1);
    assert.equal(stripeRetrieves.length, 0);
  });
});
