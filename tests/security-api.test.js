const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

const originalLoad = Module._load;

function withEnv(vars, fn) {
  const old = {};
  for (const key of Object.keys(vars)) {
    old[key] = process.env[key];
    if (vars[key] == null) delete process.env[key];
    else process.env[key] = vars[key];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(vars)) {
        if (old[key] == null) delete process.env[key];
        else process.env[key] = old[key];
      }
    });
}

function withMocks(mocks, fn) {
  Module._load = function mockLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Module._load = originalLoad;
    });
}

function freshApi(relativePath) {
  const resolved = require.resolve(relativePath);
  delete require.cache[resolved];
  return require(relativePath);
}

function withFetch(fetchImpl, fn) {
  const oldFetch = global.fetch;
  global.fetch = fetchImpl;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      global.fetch = oldFetch;
    });
}

function mockReq({ method = 'POST', body = {}, headers = {} } = {}) {
  return { method, body, headers };
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

function supabaseToolClient(tool) {
  return {
    createClient() {
      return {
        from(table) {
          assert.equal(table, 'tools');
          return {
            selected: '',
            select(columns) {
              this.selected = columns;
              return this;
            },
            eq() {
              return this;
            },
            async maybeSingle() {
              assert.match(this.selected, /price/);
              return { data: tool, error: null };
            },
          };
        },
      };
    },
  };
}

function supabaseStatsClient({ user, profile, userError = null, profileError = null }) {
  return {
    createClient() {
      return {
        auth: {
          async getUser() {
            return { data: { user }, error: userError };
          },
        },
        from(table) {
          assert.equal(table, 'profiles');
          return {
            select(columns) {
              assert.equal(columns, 'role');
              return this;
            },
            eq() {
              return this;
            },
            async maybeSingle() {
              return { data: profile, error: profileError };
            },
          };
        },
      };
    },
  };
}

function stripeMock(session, calls = { retrieve: [], charges: 0, customers: 0 }) {
  const module = () => ({
    checkout: {
      sessions: {
        async retrieve(sessionId) {
          calls.retrieve.push(sessionId);
          if (session instanceof Error) throw session;
          return session;
        },
      },
    },
    charges: {
      async list() {
        calls.charges += 1;
        return {
          data: [
            {
              id: 'ch_1',
              amount: 1250,
              status: 'succeeded',
              description: 'Paid Tool',
              billing_details: { email: 'buyer@example.com' },
              created: 1710000000,
            },
          ],
        };
      },
    },
    customers: {
      async list() {
        calls.customers += 1;
        return { data: [{ id: 'cus_1' }] };
      },
    },
  });
  return { module, calls };
}

const paidTool = {
  system_prompt: 'Paid prompt',
  is_published: true,
  price: 9,
};

const toolId = '11111111-1111-4111-8111-111111111111';

test('run-tool rejects a paid database tool without verified checkout', async () => {
  const stripe = stripeMock({ payment_status: 'paid', metadata: { tool_id: toolId } });
  let fetchCalled = false;
  await withFetch(async () => {
    fetchCalled = true;
    throw new Error('OpenAI should not be called');
  }, async () => {
    await withEnv({
      OPENAI_API_KEY: 'sk-test',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
      STRIPE_SECRET_KEY: 'sk_stripe',
    }, async () => {
      await withMocks({
        '@supabase/supabase-js': supabaseToolClient(paidTool),
        stripe: stripe.module,
      }, async () => {
        const handler = freshApi('../api/run-tool.js');
        const res = mockRes();
        await handler(mockReq({ body: { toolId, userMessage: 'hello' } }), res);
        assert.equal(res.statusCode, 402);
        assert.equal(res.body.error, 'payment_required');
        assert.deepEqual(stripe.calls.retrieve, []);
        assert.equal(fetchCalled, false);
      });
    });
  });
});

test('run-tool rejects checkout sessions for a different tool', async () => {
  const stripe = stripeMock({ payment_status: 'paid', metadata: { tool_id: '22222222-2222-4222-8222-222222222222' } });
  let fetchCalled = false;
  await withFetch(async () => {
    fetchCalled = true;
    throw new Error('OpenAI should not be called');
  }, async () => {
    await withEnv({
      OPENAI_API_KEY: 'sk-test',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
      STRIPE_SECRET_KEY: 'sk_stripe',
    }, async () => {
      await withMocks({
        '@supabase/supabase-js': supabaseToolClient(paidTool),
        stripe: stripe.module,
      }, async () => {
        const handler = freshApi('../api/run-tool.js');
        const res = mockRes();
        await handler(mockReq({ body: { toolId, checkoutSessionId: 'cs_paid', userMessage: 'hello' } }), res);
        assert.equal(res.statusCode, 403);
        assert.equal(res.body.error, 'payment_tool_mismatch');
        assert.deepEqual(stripe.calls.retrieve, ['cs_paid']);
        assert.equal(fetchCalled, false);
      });
    });
  });
});

test('run-tool allows a paid database tool with matching paid checkout', async () => {
  const stripe = stripeMock({ payment_status: 'paid', metadata: { tool_id: toolId } });
  await withFetch(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    assert.equal(body.messages[0].content, 'Paid prompt');
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: 'paid result' } }] };
      },
    };
  }, async () => {
    await withEnv({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'gpt-test',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
      STRIPE_SECRET_KEY: 'sk_stripe',
    }, async () => {
      await withMocks({
        '@supabase/supabase-js': supabaseToolClient(paidTool),
        stripe: stripe.module,
      }, async () => {
        const handler = freshApi('../api/run-tool.js');
        const res = mockRes();
        await handler(mockReq({ body: { toolId, checkoutSessionId: 'cs_paid', userMessage: 'hello' } }), res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.text, 'paid result');
        assert.deepEqual(stripe.calls.retrieve, ['cs_paid']);
      });
    });
  });
});

test('stats requires authentication before returning Stripe data', async () => {
  const stripe = stripeMock(null);

  await withEnv({
    STRIPE_SECRET_KEY: 'sk_stripe',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  }, async () => {
    await withMocks({
      '@supabase/supabase-js': supabaseStatsClient({ user: null, profile: null }),
      stripe: stripe.module,
    }, async () => {
      const handler = freshApi('../api/stats.js');
      const res = mockRes();
      await handler(mockReq({ method: 'GET' }), res);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.error, 'auth');
      assert.equal(stripe.calls.charges, 0);
    });
  });
});

test('stats requires an admin profile role', async () => {
  const stripe = stripeMock(null);

  await withEnv({
    STRIPE_SECRET_KEY: 'sk_stripe',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  }, async () => {
    await withMocks({
      '@supabase/supabase-js': supabaseStatsClient({
        user: { id: 'user_1' },
        profile: { role: 'builder' },
      }),
      stripe: stripe.module,
    }, async () => {
      const handler = freshApi('../api/stats.js');
      const res = mockRes();
      await handler(mockReq({ method: 'GET', headers: { authorization: 'Bearer user-token' } }), res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.error, 'forbidden');
      assert.equal(stripe.calls.charges, 0);
    });
  });
});

test('stats returns Stripe data for admins only', async () => {
  const stripe = stripeMock(null);

  await withEnv({
    STRIPE_SECRET_KEY: 'sk_stripe',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  }, async () => {
    await withMocks({
      '@supabase/supabase-js': supabaseStatsClient({
        user: { id: 'admin_1' },
        profile: { role: 'admin' },
      }),
      stripe: stripe.module,
    }, async () => {
      const handler = freshApi('../api/stats.js');
      const res = mockRes();
      await handler(mockReq({ method: 'GET', headers: { authorization: 'Bearer admin-token' } }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.totalRevenue, 12.5);
      assert.equal(res.body.recent[0].customer, 'buyer@example.com');
      assert.equal(stripe.calls.charges, 1);
      assert.equal(stripe.calls.customers, 1);
    });
  });
});

test('marketplace public Supabase query does not request system prompts', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'socrates', 'marketplace.html'), 'utf8');
  const selectLine = html.split('\n').find(line => line.includes('const publicColumns ='));
  assert.ok(selectLine, 'expected explicit publicColumns allowlist');
  assert.doesNotMatch(selectLine, /system_prompt/);
  assert.doesNotMatch(html, /from\('tools'\)\.select\('\*, profiles/);
});
