const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const PAID_TOOL_ID = '11111111-1111-4111-8111-111111111111';

function withEnv(env, fn) {
  const old = {};
  for (const [key, value] of Object.entries(env)) {
    old[key] = process.env[key];
    process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(env)) {
        if (old[key] === undefined) delete process.env[key];
        else process.env[key] = old[key];
      }
    });
}

function loadWithMocks(modulePath, mocks) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function createRes() {
  return {
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
}

function createSupabaseMock({ tool, user }) {
  return {
    createClient() {
      return {
        auth: {
          async getUser() {
            return user
              ? { data: { user }, error: null }
              : { data: { user: null }, error: { message: 'invalid' } };
          },
        },
        from(table) {
          if (table !== 'tools') throw new Error(`Unexpected table ${table}`);
          const query = {
            select() { return query; },
            eq() { return query; },
            maybeSingle: async () => ({ data: tool, error: null }),
          };
          return query;
        },
      };
    },
  };
}

test('paid hosted runs require a verified checkout before upstream AI is called', async () => {
  const handlerPath = path.join(ROOT, 'api/run-tool.js');
  let stripeCreated = false;
  const handler = loadWithMocks(handlerPath, {
    '@supabase/supabase-js': createSupabaseMock({
      tool: { system_prompt: 'paid secret prompt', is_published: true, price: 9 },
    }),
    stripe: () => {
      stripeCreated = true;
      return { checkout: { sessions: { retrieve: async () => ({ payment_status: 'paid' }) } } };
    },
  });

  let upstreamCalled = false;
  const oldFetch = global.fetch;
  global.fetch = async () => {
    upstreamCalled = true;
    throw new Error('upstream should not be called');
  };

  try {
    await withEnv({
      OPENAI_API_KEY: 'sk-test',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
      STRIPE_SECRET_KEY: 'sk_test_stripe',
    }, async () => {
      const res = createRes();
      await handler(
        { method: 'POST', body: { toolId: PAID_TOOL_ID, userMessage: 'run it', model: 'gpt' }, headers: {} },
        res
      );

      assert.equal(res.statusCode, 402);
      assert.equal(res.body.error, 'checkout_required');
      assert.equal(stripeCreated, false);
      assert.equal(upstreamCalled, false);
    });
  } finally {
    global.fetch = oldFetch;
  }
});

test('stats rejects unauthenticated callers before reading Stripe charges', async () => {
  const handlerPath = path.join(ROOT, 'api/stats.js');
  let listedCharges = false;
  const handler = loadWithMocks(handlerPath, {
    '@supabase/supabase-js': createSupabaseMock({ user: null }),
    stripe: () => ({
      charges: {
        list: async () => {
          listedCharges = true;
          return { data: [] };
        },
      },
    }),
  });

  await withEnv({
    STRIPE_SECRET_KEY: 'sk_test_stripe',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  }, async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: {} }, res);

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'unauthorized');
    assert.equal(listedCharges, false);
  });
});

test('hosted publish generation rejects anonymous callers before OpenAI', async () => {
  const handlerPath = path.join(ROOT, 'api/publish-generate.js');
  const handler = loadWithMocks(handlerPath, {
    '@supabase/supabase-js': createSupabaseMock({ user: null }),
  });

  let upstreamCalled = false;
  const oldFetch = global.fetch;
  global.fetch = async () => {
    upstreamCalled = true;
    throw new Error('upstream should not be called');
  };

  try {
    await withEnv({
      OPENAI_API_KEY: 'sk-test',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    }, async () => {
      const res = createRes();
      await handler({ method: 'POST', body: { idea: 'demo' }, headers: {} }, res);

      assert.equal(res.statusCode, 401);
      assert.equal(res.body.error, 'unauthorized');
      assert.equal(upstreamCalled, false);
    });
  } finally {
    global.fetch = oldFetch;
  }
});

test('marketplace public listing query omits prompts and escapes run field markup', () => {
  const html = fs.readFileSync(path.join(ROOT, 'socrates/marketplace.html'), 'utf8');

  assert.doesNotMatch(html, /select\('\*[^']*profiles/);
  assert.doesNotMatch(html, /select\('[^']*system_prompt/);
  assert.match(html, /const label = escapeHtml\(f\.label\);/);
  assert.match(html, /placeholder="\$\{placeholder\}"/);
  assert.match(html, /<option>\$\{escapeHtml\(o\)\}<\/option>/);
});

test('publish success screens are gated on Supabase insert success', () => {
  const html = fs.readFileSync(path.join(ROOT, 'socrates/publish.html'), 'utf8');

  assert.match(html, /const \{ error \} = await sb\.from\('tools'\)\.insert/);
  assert.match(html, /if \(error\) \{\s*showPublishFailure\(error\.message/s);
  assert.match(html, /if \(!user\) \{\s*showPublishFailure\('Please sign in before publishing\.'/s);
});
