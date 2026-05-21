const assert = require('assert/strict');

const runTool = require('../run-tool.js');
const stats = require('../stats.js');

function restoreEnv(name, value) {
  if (value == null) delete process.env[name];
  else process.env[name] = value;
}

async function testPaidToolRequiresCheckoutSession() {
  const original = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  const result = await runTool._test.verifyPaidToolAccess({}, '11111111-1111-4111-8111-111111111111');
  assert.equal(result.ok, false);
  assert.equal(result.status, 402);
  assert.equal(result.error, 'payment_required');
  restoreEnv('STRIPE_SECRET_KEY', original);
}

function testStatsHelpersScopeToPaymentIntentMetadata() {
  const charge = {
    amount: 1000,
    application_fee_amount: 0,
    description: 'Fallback',
    metadata: { creator_id: 'wrong-builder' },
    payment_intent: {
      metadata: { creator_id: 'builder-123' },
      application_fee_amount: 200,
      description: 'Socrates tool purchase',
    },
  };

  assert.equal(stats._test.chargeCreatorId(charge), 'builder-123');
  assert.equal(stats._test.chargeToolName(charge), 'Socrates tool purchase');
  assert.equal(stats._test.builderAmountDollars(charge), 8);
}

async function testStatsRejectsMissingAuth() {
  const original = {
    stripe: process.env.STRIPE_SECRET_KEY,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  const response = {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  await stats({ method: 'GET', headers: {} }, response);
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { error: 'auth' });

  restoreEnv('STRIPE_SECRET_KEY', original.stripe);
  restoreEnv('SUPABASE_URL', original.supabaseUrl);
  restoreEnv('SUPABASE_SERVICE_ROLE_KEY', original.supabaseKey);
}

(async () => {
  await testPaidToolRequiresCheckoutSession();
  testStatsHelpersScopeToPaymentIntentMetadata();
  await testStatsRejectsMissingAuth();
  console.log('security tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
