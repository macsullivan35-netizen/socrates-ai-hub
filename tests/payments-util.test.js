const test = require('node:test');
const assert = require('node:assert/strict');

const { verifyPaidToolCheckoutSession } = require('../server-lib/payments-util.js');

function stripeWithSession(session) {
  return {
    checkout: {
      sessions: {
        retrieve: async () => session,
      },
    },
  };
}

test('paid checkout verifier requires a session id', async () => {
  const result = await verifyPaidToolCheckoutSession(stripeWithSession({}), '', 'tool-1');

  assert.equal(result.ok, false);
  assert.equal(result.status, 402);
  assert.equal(result.error, 'payment_required');
});

test('paid checkout verifier rejects unpaid sessions', async () => {
  const result = await verifyPaidToolCheckoutSession(
    stripeWithSession({ payment_status: 'open', metadata: { tool_id: 'tool-1' } }),
    'cs_test_123',
    'tool-1',
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 402);
  assert.equal(result.error, 'payment_required');
});

test('paid checkout verifier rejects sessions for a different tool', async () => {
  const result = await verifyPaidToolCheckoutSession(
    stripeWithSession({ payment_status: 'paid', metadata: { tool_id: 'other-tool' } }),
    'cs_test_123',
    'tool-1',
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, 'payment_mismatch');
});

test('paid checkout verifier accepts a paid matching tool session', async () => {
  const session = { payment_status: 'paid', metadata: { tool_id: 'tool-1' } };
  const result = await verifyPaidToolCheckoutSession(stripeWithSession(session), 'cs_test_123', 'tool-1');

  assert.equal(result.ok, true);
  assert.equal(result.session, session);
});
