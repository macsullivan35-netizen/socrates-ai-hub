const assert = require('assert');
const Module = require('module');
const test = require('node:test');

function makeRes() {
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

function supabaseForTool(tool) {
  return {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          return { data: tool, error: null };
        },
      };
    },
  };
}

async function runHandler({ body, tool, stripeSession, fetchImpl }) {
  const runToolPath = require.resolve('./run-tool.js');
  delete require.cache[runToolPath];

  const originalLoad = Module._load;
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
      return { createClient: () => supabaseForTool(tool) };
    }
    if (request === 'stripe') {
      return () => ({
        checkout: {
          sessions: {
            retrieve: async () => stripeSession,
          },
        },
      });
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.STRIPE_SECRET_KEY = 'sk_stripe';
  global.fetch = fetchImpl || (async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'hosted output' } }] }),
  }));

  try {
    const handler = require('./run-tool.js');
    const res = makeRes();
    await handler({ method: 'POST', body }, res);
    return res;
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    process.env = originalEnv;
    delete require.cache[runToolPath];
  }
}

const paidToolId = '11111111-1111-4111-8111-111111111111';
const freeToolId = '22222222-2222-4222-8222-222222222222';

test('rejects hosted runs for paid tools without a checkout session', async () => {
  let llmCalled = false;
  const res = await runHandler({
    body: { toolId: paidToolId, userMessage: 'hello' },
    tool: { system_prompt: 'Paid prompt', is_published: true, price: 9 },
    fetchImpl: async () => {
      llmCalled = true;
      throw new Error('should not call llm');
    },
  });

  assert.strictEqual(res.statusCode, 402);
  assert.strictEqual(res.body.error, 'payment_required');
  assert.strictEqual(llmCalled, false);
});

test('rejects hosted runs when checkout session belongs to a different tool', async () => {
  let llmCalled = false;
  const res = await runHandler({
    body: { toolId: paidToolId, checkoutSessionId: 'cs_test_wrong' },
    tool: { system_prompt: 'Paid prompt', is_published: true, price: 9 },
    stripeSession: {
      payment_status: 'paid',
      metadata: { tool_id: freeToolId },
    },
    fetchImpl: async () => {
      llmCalled = true;
      throw new Error('should not call llm');
    },
  });

  assert.strictEqual(res.statusCode, 402);
  assert.strictEqual(res.body.error, 'payment_required');
  assert.strictEqual(llmCalled, false);
});

test('allows hosted runs for paid tools with a paid matching checkout session', async () => {
  const res = await runHandler({
    body: { toolId: paidToolId, checkoutSessionId: 'cs_test_paid' },
    tool: { system_prompt: 'Paid prompt', is_published: true, price: 9 },
    stripeSession: {
      payment_status: 'paid',
      metadata: { tool_id: paidToolId },
    },
  });

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.text, 'hosted output');
});

test('continues allowing hosted runs for free tools without a checkout session', async () => {
  const res = await runHandler({
    body: { toolId: freeToolId, userMessage: 'hello' },
    tool: { system_prompt: 'Free prompt', is_published: true, price: 0 },
  });

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.text, 'hosted output');
});
