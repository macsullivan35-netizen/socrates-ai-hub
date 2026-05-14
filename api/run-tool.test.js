const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const test = require('node:test');

const TOOL_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TOOL_ID = '22222222-2222-4222-8222-222222222222';

function mockReq(body) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.headers = {};
  req.body = body;
  return req;
}

function mockRes() {
  return {
    headers: {},
    statusCode: 200,
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
      return this;
    },
  };
}

function loadRunTool({ tool, checkoutSession }) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
      return {
        createClient: () => ({
          from: () => {
            const query = {
              select: () => query,
              eq: () => query,
              maybeSingle: async () => ({ data: tool, error: null }),
            };
            return query;
          },
        }),
      };
    }
    if (request === 'stripe') {
      return () => ({
        checkout: {
          sessions: {
            retrieve: async () => checkoutSession,
          },
        },
      });
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[require.resolve('./run-tool.js')];
  const handler = require('./run-tool.js');
  return {
    handler,
    restore() {
      Module._load = originalLoad;
      delete require.cache[require.resolve('./run-tool.js')];
    },
  };
}

async function withEnv(env, fn) {
  const oldValues = {};
  for (const [key, value] of Object.entries(env)) {
    oldValues[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(oldValues)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('paid database tools require a verified checkout session before hosted runs', async () => {
  await withEnv({
    OPENAI_API_KEY: 'sk-test',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    STRIPE_SECRET_KEY: 'sk_test_stripe',
  }, async () => {
    let fetchCalls = 0;
    const oldFetch = global.fetch;
    global.fetch = async () => {
      fetchCalls += 1;
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'should not run' } }] }) };
    };

    const { handler, restore } = loadRunTool({
      tool: { system_prompt: 'Paid prompt', is_published: true, price: 5 },
      checkoutSession: null,
    });

    try {
      const res = mockRes();
      await handler(mockReq({ toolId: TOOL_ID, userMessage: 'hello' }), res);
      assert.equal(res.statusCode, 402);
      assert.equal(res.body.error, 'payment_required');
      assert.equal(fetchCalls, 0);
    } finally {
      restore();
      global.fetch = oldFetch;
    }
  });
});

test('paid database tools reject paid sessions for a different tool', async () => {
  await withEnv({
    OPENAI_API_KEY: 'sk-test',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    STRIPE_SECRET_KEY: 'sk_test_stripe',
  }, async () => {
    let fetchCalls = 0;
    const oldFetch = global.fetch;
    global.fetch = async () => {
      fetchCalls += 1;
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'should not run' } }] }) };
    };

    const { handler, restore } = loadRunTool({
      tool: { system_prompt: 'Paid prompt', is_published: true, price: 5 },
      checkoutSession: { payment_status: 'paid', metadata: { tool_id: OTHER_TOOL_ID } },
    });

    try {
      const res = mockRes();
      await handler(mockReq({ toolId: TOOL_ID, checkoutSessionId: 'cs_test_wrong' }), res);
      assert.equal(res.statusCode, 402);
      assert.equal(res.body.error, 'payment_required');
      assert.equal(fetchCalls, 0);
    } finally {
      restore();
      global.fetch = oldFetch;
    }
  });
});

test('paid database tools run with a paid checkout session for the same tool', async () => {
  await withEnv({
    OPENAI_API_KEY: 'sk-test',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    STRIPE_SECRET_KEY: 'sk_test_stripe',
  }, async () => {
    let fetchCalls = 0;
    const oldFetch = global.fetch;
    global.fetch = async () => {
      fetchCalls += 1;
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ran paid tool' } }] }) };
    };

    const { handler, restore } = loadRunTool({
      tool: { system_prompt: 'Paid prompt', is_published: true, price: 5 },
      checkoutSession: { payment_status: 'paid', metadata: { tool_id: TOOL_ID } },
    });

    try {
      const res = mockRes();
      await handler(mockReq({ toolId: TOOL_ID, checkoutSessionId: 'cs_test_paid' }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.text, 'ran paid tool');
      assert.equal(fetchCalls, 1);
    } finally {
      restore();
      global.fetch = oldFetch;
    }
  });
});

test('free database tools do not require Stripe configuration', async () => {
  await withEnv({
    OPENAI_API_KEY: 'sk-test',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    STRIPE_SECRET_KEY: '',
  }, async () => {
    let fetchCalls = 0;
    const oldFetch = global.fetch;
    global.fetch = async () => {
      fetchCalls += 1;
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ran free tool' } }] }) };
    };

    const { handler, restore } = loadRunTool({
      tool: { system_prompt: 'Free prompt', is_published: true, price: 0 },
      checkoutSession: null,
    });

    try {
      const res = mockRes();
      await handler(mockReq({ toolId: TOOL_ID, userMessage: 'hello' }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.text, 'ran free tool');
      assert.equal(fetchCalls, 1);
    } finally {
      restore();
      global.fetch = oldFetch;
    }
  });
});
