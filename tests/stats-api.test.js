const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;

let mockStripeClient;
let mockSupabaseClient;

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
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  delete require.cache[require.resolve('../api/stats.js')];
  return require('../api/stats.js');
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
});

test('rejects unauthenticated stats requests before reading Stripe data', async () => {
  let stripeCalled = false;
  mockStripeClient = {
    checkout: {
      sessions: {
        list: async () => {
          stripeCalled = true;
          return { data: [] };
        },
      },
    },
  };
  mockSupabaseClient = {
    auth: {
      getUser: async () => {
        throw new Error('auth should not be called without a token');
      },
    },
  };

  const handler = loadHandler();
  const res = mockRes();
  await handler({ method: 'GET', headers: {} }, res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'auth' });
  assert.equal(stripeCalled, false);
});

test('returns only paid checkout sessions for the authenticated builder', async () => {
  mockStripeClient = {
    checkout: {
      sessions: {
        list: async () => ({
          data: [
            {
              id: 'cs_owner_paid',
              amount_total: 1250,
              payment_status: 'paid',
              created: 1710000000,
              customer: 'cus_owner',
              customer_details: { email: 'buyer@example.com' },
              metadata: { creator_id: 'user_owner', tool_id: 'tool_1' },
            },
            {
              id: 'cs_other_paid',
              amount_total: 9900,
              payment_status: 'paid',
              created: 1710000001,
              customer_details: { email: 'other@example.com' },
              metadata: { creator_id: 'user_other', tool_id: 'tool_2' },
            },
            {
              id: 'cs_owner_unpaid',
              amount_total: 5000,
              payment_status: 'unpaid',
              created: 1710000002,
              customer_details: { email: 'unpaid@example.com' },
              metadata: { creator_id: 'user_owner', tool_id: 'tool_1' },
            },
          ],
        }),
      },
    },
  };
  mockSupabaseClient = {
    auth: {
      getUser: async token => {
        assert.equal(token, 'valid-token');
        return { data: { user: { id: 'user_owner' } }, error: null };
      },
    },
    from: table => {
      assert.equal(table, 'tools');
      return {
        select: columns => {
          assert.equal(columns, 'id,name');
          return {
            eq: (column, value) => {
              assert.equal(column, 'creator_id');
              assert.equal(value, 'user_owner');
              return Promise.resolve({
                data: [{ id: 'tool_1', name: 'Owner Tool' }],
                error: null,
              });
            },
          };
        },
      };
    },
  };

  const handler = loadHandler();
  const res = mockRes();
  await handler({ method: 'GET', headers: { authorization: 'Bearer valid-token' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.totalRevenue, 12.5);
  assert.equal(res.body.totalSales, 1);
  assert.equal(res.body.totalCustomers, 1);
  assert.deepEqual(res.body.byProduct, { 'Owner Tool': 12.5 });
  assert.equal(res.body.recent.length, 1);
  assert.equal(res.body.recent[0].id, 'cs_owner_paid');
  assert.equal(res.body.recent[0].customer, 'Customer');
  assert.equal(JSON.stringify(res.body).includes('buyer@example.com'), false);
  assert.equal(JSON.stringify(res.body).includes('other@example.com'), false);
});
