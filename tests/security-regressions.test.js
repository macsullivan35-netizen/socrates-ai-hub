const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const Module = require('module');
const path = require('path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const PAID_TOOL_ID = '11111111-1111-4111-8111-111111111111';

function makeReq({ method = 'POST', body = {}, headers = {} } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.body = body;
  req.headers = headers;
  req.url = '/api/test';
  return req;
}

function makeRes() {
  return {
    headers: {},
    statusCode: 200,
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

function clearApiModules() {
  [
    path.join(ROOT, 'api/run-tool.js'),
    path.join(ROOT, 'api/stats.js'),
    path.join(ROOT, 'api/publish-generate.js'),
    path.join(ROOT, 'server-lib/payments-util.js'),
  ].forEach((file) => {
    delete require.cache[require.resolve(file)];
  });
}

function withMockedModules({ tool, user, checkoutSession, charges = [] } = {}, load) {
  const originalLoad = Module._load;
  let stripeSessionRetrieveCount = 0;
  let stripeChargeListCount = 0;

  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
      return {
        createClient: () => ({
          auth: {
            getUser: async (token) => (
              token === 'valid-token' && user
                ? { data: { user }, error: null }
                : { data: { user: null }, error: new Error('bad token') }
            ),
          },
          from: () => ({
            select() { return this; },
            eq() { return this; },
            maybeSingle: async () => ({ data: tool || null, error: null }),
          }),
        }),
      };
    }
    if (request === 'stripe') {
      return () => ({
        checkout: {
          sessions: {
            retrieve: async () => {
              stripeSessionRetrieveCount += 1;
              if (checkoutSession instanceof Error) throw checkoutSession;
              return checkoutSession;
            },
          },
        },
        charges: {
          list: async () => {
            stripeChargeListCount += 1;
            return { data: charges };
          },
        },
      });
    }
    return originalLoad.apply(this, arguments);
  };

  clearApiModules();
  return Promise.resolve()
    .then(load)
    .finally(() => {
      Module._load = originalLoad;
      clearApiModules();
    })
    .then((result) => ({
      ...result,
      stripeSessionRetrieveCount,
      stripeChargeListCount,
    }));
}

test('paid hosted runs require a paid Stripe checkout session for the same tool', async () => {
  await withMockedModules({
    tool: { is_published: true, price: 9, system_prompt: 'private prompt' },
  }, async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    process.env.STRIPE_SECRET_KEY = 'sk_stripe';

    let upstreamCalled = false;
    const originalFetch = global.fetch;
    global.fetch = async () => {
      upstreamCalled = true;
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    };

    try {
      const handler = require(path.join(ROOT, 'api/run-tool.js'));
      const res = makeRes();
      await handler(makeReq({ body: { toolId: PAID_TOOL_ID, userMessage: 'run it' } }), res);

      assert.equal(res.statusCode, 402);
      assert.equal(res.body.error, 'payment_required');
      assert.equal(upstreamCalled, false);
      return {};
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('paid hosted runs accept a paid checkout session bound to the requested tool', async () => {
  await withMockedModules({
    tool: { is_published: true, price: 9, system_prompt: 'private prompt' },
    checkoutSession: { payment_status: 'paid', metadata: { tool_id: PAID_TOOL_ID } },
  }, async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    process.env.STRIPE_SECRET_KEY = 'sk_stripe';

    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'paid run ok' } }] }),
    });

    try {
      const handler = require(path.join(ROOT, 'api/run-tool.js'));
      const res = makeRes();
      await handler(makeReq({
        body: { toolId: PAID_TOOL_ID, userMessage: 'run it', checkoutSessionId: 'cs_paid' },
      }), res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.text, 'paid run ok');
      return {};
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('Stripe stats require auth and do not call Stripe anonymously', async () => {
  const result = await withMockedModules({}, async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    process.env.STRIPE_SECRET_KEY = 'sk_stripe';

    const handler = require(path.join(ROOT, 'api/stats.js'));
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'auth');
    return {};
  });

  assert.equal(result.stripeChargeListCount, 0);
});

test('Stripe stats only include charges belonging to the authenticated builder', async () => {
  await withMockedModules({
    user: { id: 'builder-1', email: 'builder@example.com' },
    charges: [
      {
        id: 'ch_own',
        status: 'succeeded',
        amount: 500,
        description: 'Own tool',
        billing_details: { email: 'buyer@example.com' },
        created: 1710000000,
        payment_intent: { metadata: { creator_id: 'builder-1' } },
      },
      {
        id: 'ch_other',
        status: 'succeeded',
        amount: 9900,
        description: 'Other tool',
        billing_details: { email: 'other-buyer@example.com' },
        created: 1710000001,
        payment_intent: { metadata: { creator_id: 'builder-2' } },
      },
    ],
  }, async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    process.env.STRIPE_SECRET_KEY = 'sk_stripe';

    const handler = require(path.join(ROOT, 'api/stats.js'));
    const res = makeRes();
    await handler(makeReq({ method: 'GET', headers: { authorization: 'Bearer valid-token' } }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.totalRevenue, 5);
    assert.equal(res.body.totalSales, 1);
    assert.deepEqual(Object.keys(res.body.byProduct), ['Own tool']);
    assert.equal(res.body.recent.length, 1);
    assert.equal(res.body.recent[0].customer, 'buyer@example.com');
    return {};
  });
});

test('marketplace public loader and modal rendering do not expose prompt or unescaped field HTML', () => {
  const marketplace = fs.readFileSync(path.join(ROOT, 'socrates/marketplace.html'), 'utf8');

  assert.doesNotMatch(marketplace, /\.select\('\*, profiles\(username,display_name\)'\)/);
  assert.doesNotMatch(marketplace, /sys:\s*t\.system_prompt/);
  assert.match(marketplace, /checkoutSessionId:\s*currentTool\.paid \? checkoutSessionForTool\(currentTool\.id\) : undefined/);
  assert.match(marketplace, /const label = escapeHtml\(f\.label\);/);
  assert.match(marketplace, /const placeholder = escapeHtml\(f\.placeholder \|\| ''\);/);
  assert.match(marketplace, /options\.map\(o => `<option>\$\{escapeHtml\(o\)\}<\/option>`\)/);
});

test('hosted publish generation requires a Supabase bearer token', () => {
  const api = fs.readFileSync(path.join(ROOT, 'api/publish-generate.js'), 'utf8');
  const page = fs.readFileSync(path.join(ROOT, 'socrates/publish.html'), 'utf8');

  assert.match(api, /requireSupabaseUser/);
  assert.match(page, /headers\.Authorization = `Bearer \$\{authToken\}`/);
});
