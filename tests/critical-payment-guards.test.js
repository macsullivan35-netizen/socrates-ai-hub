const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const PAID_TOOL_ID = '123e4567-e89b-42d3-a456-426614174000';

async function withModuleStubs(stubs, fn) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) {
      return stubs[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return await fn();
  } finally {
    Module._load = originalLoad;
  }
}

function freshRequire(path) {
  delete require.cache[require.resolve(path)];
  return require(path);
}

function mockRes() {
  return {
    statusCode: undefined,
    headers: {},
    body: undefined,
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

function restoreEnv(snapshot) {
  for (const key of Object.keys(process.env)) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) delete process.env[key];
  }
  Object.assign(process.env, snapshot);
}

function supabaseToolStub(tool) {
  return {
    createClient() {
      return {
        from(table) {
          assert.equal(table, 'tools');
          return {
            select() { return this; },
            eq() { return this; },
            maybeSingle: async () => ({ data: tool, error: null }),
          };
        },
      };
    },
  };
}

test('paid checkout helper rejects a paid access attempt without a session', async () => {
  delete require.cache[require.resolve('../server-lib/payments-util.js')];
  const { verifyPaidCheckoutSession } = require('../server-lib/payments-util.js');

  const result = await verifyPaidCheckoutSession('sk_test_unused', PAID_TOOL_ID, '');

  assert.equal(result.ok, false);
  assert.equal(result.status, 402);
  assert.equal(result.error, 'payment_required');
});

test('paid checkout helper rejects a checkout session for a different tool', async () => {
  await withModuleStubs({
    stripe: () => ({
      checkout: {
        sessions: {
          retrieve: async () => ({
            payment_status: 'paid',
            metadata: { tool_id: '00000000-0000-4000-8000-000000000000' },
          }),
        },
      },
    }),
  }, async () => {
    delete require.cache[require.resolve('../server-lib/payments-util.js')];
    const { verifyPaidCheckoutSession } = require('../server-lib/payments-util.js');

    const result = await verifyPaidCheckoutSession('sk_test_mock', PAID_TOOL_ID, 'cs_paid_wrong_tool');

    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(result.error, 'wrong_tool');
  });
});

test('run-tool blocks paid database tools before model execution when checkout is missing', async () => {
  const previousEnv = { ...process.env };
  const previousFetch = global.fetch;
  let modelCalled = false;
  try {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    delete process.env.STRIPE_SECRET_KEY;
    global.fetch = async () => {
      modelCalled = true;
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ran' } }] }) };
    };

    await withModuleStubs({
      '@supabase/supabase-js': supabaseToolStub({
        system_prompt: 'secret paid prompt',
        is_published: true,
        price: 9,
      }),
      stripe: () => { throw new Error('stripe should not be loaded without a session'); },
    }, async () => {
      delete require.cache[require.resolve('../api/run-tool.js')];
      const handler = freshRequire('../api/run-tool.js');
      const res = mockRes();

      await handler({ method: 'POST', body: { toolId: PAID_TOOL_ID, userMessage: 'hello' }, headers: {} }, res);

      assert.equal(res.statusCode, 402);
      assert.equal(res.body.error, 'payment_required');
      assert.equal(modelCalled, false);
    });
  } finally {
    restoreEnv(previousEnv);
    global.fetch = previousFetch;
  }
});

test('download-tool blocks paid prompt export when checkout is missing', async () => {
  const previousEnv = { ...process.env };
  try {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    delete process.env.STRIPE_SECRET_KEY;

    await withModuleStubs({
      '@supabase/supabase-js': supabaseToolStub({
        id: PAID_TOOL_ID,
        name: 'Paid Tool',
        system_prompt: 'secret paid prompt',
        is_published: true,
        price: 9,
      }),
      stripe: () => { throw new Error('stripe should not be loaded without a session'); },
    }, async () => {
      delete require.cache[require.resolve('../api/download-tool.js')];
      const handler = freshRequire('../api/download-tool.js');
      const res = mockRes();

      await handler({ method: 'POST', body: { toolId: PAID_TOOL_ID }, headers: {} }, res);

      assert.equal(res.statusCode, 402);
      assert.equal(res.body.error, 'payment_required');
    });
  } finally {
    restoreEnv(previousEnv);
  }
});

test('stats endpoint rejects unauthenticated reads before touching Stripe or Supabase', async () => {
  const previousEnv = { ...process.env };
  try {
    process.env.STRIPE_SECRET_KEY = 'sk-test';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

    await withModuleStubs({
      '@supabase/supabase-js': {
        createClient() { throw new Error('Supabase should not be called without auth'); },
      },
      stripe: () => { throw new Error('Stripe should not be called without auth'); },
    }, async () => {
      delete require.cache[require.resolve('../api/stats.js')];
      const handler = freshRequire('../api/stats.js');
      const res = mockRes();

      await handler({ method: 'GET', headers: {} }, res);

      assert.equal(res.statusCode, 401);
      assert.equal(res.body.error, 'auth');
    });
  } finally {
    restoreEnv(previousEnv);
  }
});
