const assert = require('assert');
const Module = require('module');

const PAID_TOOL_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TOOL_ID = '22222222-2222-4222-8222-222222222222';

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
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

async function withMocks(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    return await fn();
  } finally {
    Module._load = originalLoad;
  }
}

function clearApiModule(name) {
  const resolved = require.resolve(`../${name}`);
  delete require.cache[resolved];
}

function mockSupabaseForTool(tool) {
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

async function invokeRunTool({ body, tool, session }) {
  let upstreamCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    upstreamCalls += 1;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hosted result' } }] }),
    };
  };

  const oldEnv = { ...process.env };
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  if (session) process.env.STRIPE_SECRET_KEY = 'sk_test_stripe';
  else delete process.env.STRIPE_SECRET_KEY;

  try {
    return await withMocks({
      '@supabase/supabase-js': mockSupabaseForTool(tool),
      stripe: () => ({
        checkout: {
          sessions: {
            retrieve: async () => session,
          },
        },
      }),
    }, async () => {
      clearApiModule('run-tool.js');
      const handler = require('../run-tool.js');
      const res = mockResponse();
      await handler({ method: 'POST', headers: {}, body }, res);
      return { res, upstreamCalls };
    });
  } finally {
    global.fetch = originalFetch;
    process.env = oldEnv;
  }
}

async function invokeStats({ headers = {}, token, stripeData }) {
  const oldEnv = { ...process.env };
  if (token) process.env.STATS_API_TOKEN = token;
  else delete process.env.STATS_API_TOKEN;
  process.env.STRIPE_SECRET_KEY = 'sk_test_stripe';

  let chargeCalls = 0;
  try {
    return await withMocks({
      stripe: () => ({
        charges: {
          list: async () => {
            chargeCalls += 1;
            return stripeData.charges;
          },
        },
        customers: {
          list: async () => stripeData.customers,
        },
      }),
    }, async () => {
      clearApiModule('stats.js');
      const handler = require('../stats.js');
      const res = mockResponse();
      await handler({ method: 'GET', headers }, res);
      return { res, chargeCalls };
    });
  } finally {
    process.env = oldEnv;
  }
}

async function testPaidRunRequiresCheckoutSession() {
  const { res, upstreamCalls } = await invokeRunTool({
    body: { toolId: PAID_TOOL_ID, userMessage: 'run it' },
    tool: { system_prompt: 'paid prompt', is_published: true, price: 5 },
  });

  assert.strictEqual(res.statusCode, 402);
  assert.strictEqual(res.body.error, 'payment_required');
  assert.strictEqual(upstreamCalls, 0);
}

async function testPaidRunRejectsWrongCheckoutSessionTool() {
  const { res, upstreamCalls } = await invokeRunTool({
    body: { toolId: PAID_TOOL_ID, userMessage: 'run it', checkoutSessionId: 'cs_test_paid' },
    tool: { system_prompt: 'paid prompt', is_published: true, price: 5 },
    session: { payment_status: 'paid', metadata: { tool_id: OTHER_TOOL_ID } },
  });

  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.error, 'wrong_tool');
  assert.strictEqual(upstreamCalls, 0);
}

async function testPaidRunAllowsMatchingPaidCheckoutSession() {
  const { res, upstreamCalls } = await invokeRunTool({
    body: { toolId: PAID_TOOL_ID, userMessage: 'run it', checkoutSessionId: 'cs_test_paid' },
    tool: { system_prompt: 'paid prompt', is_published: true, price: 5 },
    session: { payment_status: 'paid', metadata: { tool_id: PAID_TOOL_ID } },
  });

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.text, 'hosted result');
  assert.strictEqual(upstreamCalls, 1);
}

async function testStatsRequiresTokenBeforeStripeRead() {
  const { res, chargeCalls } = await invokeStats({
    stripeData: { charges: { data: [] }, customers: { data: [] } },
  });

  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.error, 'unauthorized');
  assert.strictEqual(chargeCalls, 0);
}

async function testStatsAllowsBearerToken() {
  const { res, chargeCalls } = await invokeStats({
    token: 'secret-stats-token',
    headers: { authorization: 'Bearer secret-stats-token' },
    stripeData: {
      charges: {
        data: [
          {
            id: 'ch_1',
            status: 'succeeded',
            amount: 500,
            description: 'Tool',
            billing_details: { email: 'buyer@example.com' },
            created: 1710000000,
          },
        ],
      },
      customers: { data: [{ id: 'cus_1' }] },
    },
  });

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.totalRevenue, 5);
  assert.strictEqual(res.body.totalSales, 1);
  assert.strictEqual(res.body.totalCustomers, 1);
  assert.strictEqual(chargeCalls, 1);
}

(async () => {
  await testPaidRunRequiresCheckoutSession();
  await testPaidRunRejectsWrongCheckoutSessionTool();
  await testPaidRunAllowsMatchingPaidCheckoutSession();
  await testStatsRequiresTokenBeforeStripeRead();
  await testStatsAllowsBearerToken();
  console.log('security-access tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
