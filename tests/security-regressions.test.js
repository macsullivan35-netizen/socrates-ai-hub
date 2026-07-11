const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const PAID_TOOL_ID = '11111111-1111-4111-8111-111111111111';

function loadWithMocks(relativePath, mocks) {
  const abs = path.join(ROOT, relativePath);
  delete require.cache[require.resolve(abs)];
  const originalLoad = Module._load;
  Module._load = function mockedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(abs);
  } finally {
    Module._load = originalLoad;
  }
}

function mockReq({ method = 'POST', body = {}, headers = {} } = {}) {
  return {
    method,
    body,
    headers,
    on() {},
  };
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    payload: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

function supabaseToolMock(tool) {
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

test('paid hosted tool runs require a checkout session before any LLM request', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.STRIPE_SECRET_KEY = 'stripe-secret';

  let stripeCalled = false;
  let llmCalled = false;
  global.fetch = async () => {
    llmCalled = true;
    throw new Error('LLM should not be called');
  };

  const handler = loadWithMocks('api/run-tool.js', {
    '@supabase/supabase-js': supabaseToolMock({
      is_published: true,
      price: 9,
      system_prompt: 'premium prompt',
    }),
    stripe: () => {
      stripeCalled = true;
      return {};
    },
  });

  const res = mockRes();
  await handler(mockReq({ body: { toolId: PAID_TOOL_ID, userMessage: 'run it' } }), res);

  assert.equal(res.statusCode, 402);
  assert.equal(res.payload.error, 'payment_required');
  assert.equal(stripeCalled, false);
  assert.equal(llmCalled, false);
});

test('paid hosted tool runs reject paid sessions for a different tool', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.STRIPE_SECRET_KEY = 'stripe-secret';

  let llmCalled = false;
  global.fetch = async () => {
    llmCalled = true;
    throw new Error('LLM should not be called');
  };

  const handler = loadWithMocks('api/run-tool.js', {
    '@supabase/supabase-js': supabaseToolMock({
      is_published: true,
      price: 9,
      system_prompt: 'premium prompt',
    }),
    stripe: () => ({
      checkout: {
        sessions: {
          retrieve: async () => ({
            payment_status: 'paid',
            metadata: { tool_id: '22222222-2222-4222-8222-222222222222' },
          }),
        },
      },
    }),
  });

  const res = mockRes();
  await handler(
    mockReq({ body: { toolId: PAID_TOOL_ID, userMessage: 'run it', checkoutSessionId: 'cs_paid' } }),
    res
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.error, 'payment_mismatch');
  assert.equal(llmCalled, false);
});

test('hosted publish generation requires a signed-in Supabase user', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  let llmCalled = false;
  global.fetch = async () => {
    llmCalled = true;
    throw new Error('LLM should not be called');
  };

  const handler = loadWithMocks('api/publish-generate.js', {
    '@supabase/supabase-js': {
      createClient: () => {
        throw new Error('Supabase should not be called without a bearer token');
      },
    },
  });

  const res = mockRes();
  await handler(mockReq({ body: { idea: 'tool idea' } }), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error, 'auth');
  assert.equal(llmCalled, false);
});

test('stripe stats require auth before reading Stripe data', async () => {
  process.env.STRIPE_SECRET_KEY = 'stripe-secret';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  let stripeRead = false;
  const handler = loadWithMocks('api/stats.js', {
    '@supabase/supabase-js': {
      createClient: () => {
        throw new Error('Supabase should not be called without a bearer token');
      },
    },
    stripe: () => ({
      charges: {
        list: async () => {
          stripeRead = true;
          return { data: [] };
        },
      },
    }),
  });

  const res = mockRes();
  await handler(mockReq({ method: 'GET' }), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error, 'auth');
  assert.equal(stripeRead, false);
});

test('marketplace public listing load does not select or map system prompts', () => {
  const html = fs.readFileSync(path.join(ROOT, 'socrates/marketplace.html'), 'utf8');

  assert.match(html, /select\(publicToolColumns\)/);
  assert.doesNotMatch(html, /select\('\*,\s*profiles/);
  assert.doesNotMatch(html, /sys:\s*t\.system_prompt/);
  assert.match(html, /checkoutSessionId:\s*checkoutSessionForTool\(currentTool\.id\)/);
});

test('marketplace run fields are escaped before insertion into innerHTML', () => {
  const html = fs.readFileSync(path.join(ROOT, 'socrates/marketplace.html'), 'utf8');

  assert.match(html, /function renderToolFieldHtml\(f\)/);
  assert.match(html, /fieldsEl\.innerHTML = currentTool\.fields\.map\(renderToolFieldHtml\)\.join\(''\);/);
  assert.doesNotMatch(html, /<label>\$\{f\.label\}<\/label>/);
  assert.doesNotMatch(html, /placeholder="\$\{f\.placeholder/);
});
