const assert = require('assert/strict');
const {
  normalizeEntitlement,
  validateUnlockNonce,
  verifyPaidToolEntitlement,
} = require('../../server-lib/stripe-entitlements.js');

function fakeStripe(session) {
  return {
    checkout: {
      sessions: {
        retrieve: async (id) => {
          assert.equal(id, 'cs_test_123');
          return session;
        },
      },
    },
  };
}

(async () => {
  assert.deepEqual(normalizeEntitlement('cs_test_123'), { sessionId: 'cs_test_123', nonce: '' });
  assert.equal(validateUnlockNonce('short'), '');
  assert.equal(validateUnlockNonce('0123456789abcdef01234567'), '0123456789abcdef01234567');

  const valid = await verifyPaidToolEntitlement(
    fakeStripe({
      payment_status: 'paid',
      metadata: { tool_id: 'tool-1', unlock_nonce: '0123456789abcdef01234567' },
    }),
    { sessionId: 'cs_test_123', nonce: '0123456789abcdef01234567' },
    'tool-1'
  );
  assert.equal(valid.ok, true);
  assert.equal(valid.toolId, 'tool-1');

  const wrongTool = await verifyPaidToolEntitlement(
    fakeStripe({
      payment_status: 'paid',
      metadata: { tool_id: 'tool-1', unlock_nonce: '0123456789abcdef01234567' },
    }),
    { sessionId: 'cs_test_123', nonce: '0123456789abcdef01234567' },
    'tool-2'
  );
  assert.equal(wrongTool.ok, false);
  assert.equal(wrongTool.error, 'invalid_paid_access');

  const noNonce = await verifyPaidToolEntitlement(
    fakeStripe({
      payment_status: 'paid',
      metadata: { tool_id: 'tool-1' },
    }),
    { sessionId: 'cs_test_123', nonce: '0123456789abcdef01234567' },
    'tool-1'
  );
  assert.equal(noNonce.ok, false);
  assert.equal(noNonce.error, 'invalid_paid_access');

  const forged = await verifyPaidToolEntitlement(
    fakeStripe({
      payment_status: 'paid',
      metadata: { tool_id: 'tool-1', unlock_nonce: '0123456789abcdef01234567' },
    }),
    { sessionId: 'not-a-session', nonce: '0123456789abcdef01234567' },
    'tool-1'
  );
  assert.equal(forged.ok, false);
  assert.equal(forged.error, 'paid_access_required');

  console.log('stripe entitlement tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
