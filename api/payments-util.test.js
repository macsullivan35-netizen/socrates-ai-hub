const assert = require('node:assert/strict');
const test = require('node:test');

const {
  checkoutSessionIdFrom,
  isPaidPrice,
  verifyPaidToolAccess,
} = require('../server-lib/payments-util.js');

function stripeStub(sessionOrError) {
  return {
    checkout: {
      sessions: {
        retrieve: async () => {
          if (sessionOrError instanceof Error) throw sessionOrError;
          return sessionOrError;
        },
      },
    },
  };
}

test('isPaidPrice only treats positive finite prices as paid', () => {
  assert.equal(isPaidPrice(0), false);
  assert.equal(isPaidPrice('0'), false);
  assert.equal(isPaidPrice(''), false);
  assert.equal(isPaidPrice(null), false);
  assert.equal(isPaidPrice('9.99'), true);
  assert.equal(isPaidPrice(1), true);
});

test('checkoutSessionIdFrom accepts current and legacy request keys', () => {
  assert.equal(checkoutSessionIdFrom({ checkoutSessionId: ' cs_123 ' }), 'cs_123');
  assert.equal(checkoutSessionIdFrom({ checkout_session_id: 'cs_456' }), 'cs_456');
  assert.equal(checkoutSessionIdFrom({ sessionId: 'cs_789' }), 'cs_789');
  assert.equal(checkoutSessionIdFrom({}), '');
});

test('verifyPaidToolAccess requires a session id', async () => {
  const result = await verifyPaidToolAccess({
    stripe: stripeStub({ payment_status: 'paid', metadata: { tool_id: 'tool-a' } }),
    sessionId: '',
    toolId: 'tool-a',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 402);
  assert.equal(result.error, 'payment_required');
});

test('verifyPaidToolAccess rejects unpaid sessions', async () => {
  const result = await verifyPaidToolAccess({
    stripe: stripeStub({ payment_status: 'unpaid', metadata: { tool_id: 'tool-a' } }),
    sessionId: 'cs_unpaid',
    toolId: 'tool-a',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 402);
});

test('verifyPaidToolAccess rejects sessions for a different tool', async () => {
  const result = await verifyPaidToolAccess({
    stripe: stripeStub({ payment_status: 'paid', metadata: { tool_id: 'tool-b' } }),
    sessionId: 'cs_paid_other_tool',
    toolId: 'tool-a',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, 'tool_mismatch');
});

test('verifyPaidToolAccess accepts a paid session for the requested tool', async () => {
  const result = await verifyPaidToolAccess({
    stripe: stripeStub({ id: 'cs_paid', payment_status: 'paid', metadata: { tool_id: 'tool-a' } }),
    sessionId: 'cs_paid',
    toolId: 'tool-a',
  });

  assert.equal(result.ok, true);
  assert.equal(result.session.id, 'cs_paid');
});
