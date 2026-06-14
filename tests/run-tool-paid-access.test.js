const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;
const originalFetch = global.fetch;
const TOOL_ID = '11111111-1111-4111-8111-111111111111';

let mockStripeClient;
let mockSupabaseClient;
let mockTool;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'stripe') {
    return () => mockStripeClient;
  }
  if (request === '@supabase/supabase-js') {
    return { createClient: () => mockSupabaseClient };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function loadHandler() {
  process.env.OPENAI_API_KEY = 'sk-openai';
  process.env.STRIPE_SECRET_KEY = 'sk-stripe';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  delete require.cache[require.resolve('../api/run-tool.js')];
  return require('../api/run-tool.js');
}

function setupSupabaseTool(tool) {
  mockTool = tool;
  mockSupabaseClient = {
    from: table => {
      assert.equal(table, 'tools');
      return {
        select: columns => {
          assert.equal(columns, 'system_prompt, is_published, price');
          return {
            eq: (column, value) => {
              assert.equal(column, 'id');
              assert.equal(value, TOOL_ID);
              return {
                maybeSingle: async () => ({ data: mockTool, error: null }),
              };
            },
          };
        },
      };
    },
  };
}

function mockRes() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    ended: false,
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

test.after(() => {
  Module._load = originalLoad;
  global.fetch = originalFetch;
});

test('rejects paid hosted runs without checkout before calling model APIs', async () => {
  setupSupabaseTool({ system_prompt: 'Paid prompt', is_published: true, price: 9 });
  let modelApiCalled = false;
  let stripeCalled = false;
  mockStripeClient = {
    checkout: {
      sessions: {
        retrieve: async () => {
          stripeCalled = true;
          return {};
        },
      },
    },
  };
  global.fetch = async () => {
    modelApiCalled = true;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'should not happen' } }] }) };
  };

  const handler = loadHandler();
  const res = mockRes();
  await handler({ method: 'POST', headers: {}, body: { toolId: TOOL_ID, userMessage: 'run it' } }, res);

  assert.equal(res.statusCode, 402);
  assert.equal(res.body.error, 'payment_required');
  assert.equal(stripeCalled, false);
  assert.equal(modelApiCalled, false);
});

test('allows paid hosted runs with a matching paid checkout session', async () => {
  setupSupabaseTool({ system_prompt: 'Paid prompt', is_published: true, price: 9 });
  let modelApiCalled = false;
  mockStripeClient = {
    checkout: {
      sessions: {
        retrieve: async sessionId => {
          assert.equal(sessionId, 'cs_test_paid');
          return { payment_status: 'paid', metadata: { tool_id: TOOL_ID } };
        },
      },
    },
  };
  global.fetch = async (_url, options) => {
    modelApiCalled = true;
    const body = JSON.parse(options.body);
    assert.equal(body.messages[0].content, 'Paid prompt');
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'paid output' } }] }) };
  };

  const handler = loadHandler();
  const res = mockRes();
  await handler({
    method: 'POST',
    headers: {},
    body: { toolId: TOOL_ID, userMessage: 'run it', checkoutSessionId: 'cs_test_paid' },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.text, 'paid output');
  assert.equal(modelApiCalled, true);
});
