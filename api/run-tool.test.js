const assert = require('assert');
const Module = require('module');

const paidToolId = '11111111-1111-4111-8111-111111111111';
const otherToolId = '22222222-2222-4222-8222-222222222222';

const state = {
  selectedColumns: '',
  requestedToolId: '',
  tool: null,
  stripeSession: null,
  stripeSessionId: '',
  fetchCalls: [],
};

const originalLoad = Module._load;
Module._load = function mockLoad(request, parent, isMain) {
  if (request === '@supabase/supabase-js') {
    return {
      createClient: () => ({
        from: () => ({
          select(columns) {
            state.selectedColumns = columns;
            return this;
          },
          eq(column, value) {
            if (column === 'id') state.requestedToolId = value;
            return this;
          },
          async maybeSingle() {
            return { data: state.tool, error: null };
          },
        }),
      }),
    };
  }

  if (request === 'stripe') {
    return () => ({
      checkout: {
        sessions: {
          retrieve: async (sessionId) => {
            state.stripeSessionId = sessionId;
            return state.stripeSession;
          },
        },
      },
    });
  }

  return originalLoad.apply(this, arguments);
};

global.fetch = async (url, options) => {
  state.fetchCalls.push({ url, options });
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'hosted output' } }] }),
  };
};

process.env.OPENAI_API_KEY = 'sk-test';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.STRIPE_SECRET_KEY = 'sk_test_stripe';

const handler = require('./run-tool.js');

function reset(tool, stripeSession = null) {
  state.selectedColumns = '';
  state.requestedToolId = '';
  state.tool = tool;
  state.stripeSession = stripeSession;
  state.stripeSessionId = '';
  state.fetchCalls = [];
}

function makeReq(body) {
  return {
    method: 'POST',
    headers: {},
    body,
  };
}

function makeRes() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
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
      return this;
    },
  };
}

async function invoke(body) {
  const res = makeRes();
  await handler(makeReq(body), res);
  return res;
}

(async () => {
  reset({ system_prompt: 'paid prompt', is_published: true, price: 5 });
  let res = await invoke({ toolId: paidToolId, userMessage: 'run it' });
  assert.strictEqual(res.statusCode, 402);
  assert.strictEqual(res.body.error, 'payment_required');
  assert.strictEqual(state.fetchCalls.length, 0);
  assert.ok(state.selectedColumns.includes('price'));

  reset(
    { system_prompt: 'paid prompt', is_published: true, price: 5 },
    { payment_status: 'paid', metadata: { tool_id: otherToolId } }
  );
  res = await invoke({ toolId: paidToolId, userMessage: 'run it', accessSessionId: 'cs_paid_other' });
  assert.strictEqual(res.statusCode, 402);
  assert.strictEqual(res.body.error, 'payment_required');
  assert.strictEqual(state.fetchCalls.length, 0);

  reset(
    { system_prompt: 'paid prompt', is_published: true, price: 5 },
    { payment_status: 'paid', metadata: { tool_id: paidToolId } }
  );
  res = await invoke({ toolId: paidToolId, userMessage: 'run it', accessSessionId: 'cs_paid_match' });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.text, 'hosted output');
  assert.strictEqual(state.stripeSessionId, 'cs_paid_match');
  assert.strictEqual(state.fetchCalls.length, 1);

  delete process.env.STRIPE_SECRET_KEY;
  reset({ system_prompt: 'free prompt', is_published: true, price: 0 });
  res = await invoke({ toolId: paidToolId, userMessage: 'run it' });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.text, 'hosted output');
  assert.strictEqual(state.stripeSessionId, '');

  Module._load = originalLoad;
})().catch((err) => {
  Module._load = originalLoad;
  console.error(err);
  process.exit(1);
});
