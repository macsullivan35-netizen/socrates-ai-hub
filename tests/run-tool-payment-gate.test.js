const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const test = require('node:test');

let mockTool;
let selectedColumns;
let stripeRetrieveCalls;
let stripeSession;
let modelFetchCalls;

const originalLoad = Module._load;
const originalFetch = global.fetch;
const envKeys = ['OPENAI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY'];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

function installModuleMocks() {
  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
      return {
        createClient() {
          return {
            from() {
              const query = {
                select(cols) {
                  selectedColumns = cols;
                  return query;
                },
                eq() {
                  return query;
                },
                async maybeSingle() {
                  return { data: mockTool, error: null };
                },
              };
              return query;
            },
          };
        },
      };
    }
    if (request === 'stripe') {
      return function stripeFactory() {
        return {
          checkout: {
            sessions: {
              async retrieve(sessionId) {
                stripeRetrieveCalls.push(sessionId);
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
}

function makeReq(body) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.body = body;
  return req;
}

function makeRes() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    setHeader(key, value) {
      this.headers[key] = value;
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

async function invokeRunTool(body) {
  const res = makeRes();
  await runTool(makeReq(body), res);
  return res;
}

installModuleMocks();
const runTool = require('../api/run-tool.js');

test.beforeEach(() => {
  mockTool = {
    is_published: true,
    price: 9,
    system_prompt: 'paid prompt',
  };
  selectedColumns = '';
  stripeRetrieveCalls = [];
  stripeSession = {
    payment_status: 'paid',
    metadata: { tool_id: '11111111-1111-4111-8111-111111111111' },
  };
  modelFetchCalls = [];
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.STRIPE_SECRET_KEY = 'sk_stripe_test';
  global.fetch = async (url, options) => {
    modelFetchCalls.push({ url, options });
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: 'model output' } }] };
      },
    };
  };
});

test.after(() => {
  Module._load = originalLoad;
  global.fetch = originalFetch;
  for (const key of envKeys) {
    if (originalEnv[key] == null) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

test('paid UUID tool requires a checkout session before hosted model call', async () => {
  const res = await invokeRunTool({
    toolId: '11111111-1111-4111-8111-111111111111',
    userMessage: 'hello',
  });

  assert.equal(res.statusCode, 402);
  assert.equal(res.body.error, 'payment_required');
  assert.equal(modelFetchCalls.length, 0);
  assert.equal(stripeRetrieveCalls.length, 0);
  assert.match(selectedColumns, /price/);
});

test('paid UUID tool rejects checkout sessions for other tools', async () => {
  stripeSession = {
    payment_status: 'paid',
    metadata: { tool_id: '22222222-2222-4222-8222-222222222222' },
  };

  const res = await invokeRunTool({
    toolId: '11111111-1111-4111-8111-111111111111',
    checkoutSessionId: 'cs_paid_other_tool',
    userMessage: 'hello',
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'payment_mismatch');
  assert.deepEqual(stripeRetrieveCalls, ['cs_paid_other_tool']);
  assert.equal(modelFetchCalls.length, 0);
});

test('paid UUID tool runs only after a paid matching checkout session', async () => {
  const res = await invokeRunTool({
    toolId: '11111111-1111-4111-8111-111111111111',
    checkoutSessionId: 'cs_paid_matching_tool',
    userMessage: 'hello',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.text, 'model output');
  assert.deepEqual(stripeRetrieveCalls, ['cs_paid_matching_tool']);
  assert.equal(modelFetchCalls.length, 1);
});

test('free UUID tool does not require Stripe verification', async () => {
  mockTool = {
    is_published: true,
    price: 0,
    system_prompt: 'free prompt',
  };

  const res = await invokeRunTool({
    toolId: '11111111-1111-4111-8111-111111111111',
    userMessage: 'hello',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.text, 'model output');
  assert.equal(stripeRetrieveCalls.length, 0);
  assert.equal(modelFetchCalls.length, 1);
});
