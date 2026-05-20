const CHECKOUT_SESSION_ID_RE = /^cs_(test|live)_[A-Za-z0-9_]+$/;
const UNLOCK_NONCE_RE = /^[A-Za-z0-9._:-]{24,128}$/;

function cleanString(value) {
  return value == null ? '' : String(value).trim();
}

function validateUnlockNonce(value) {
  const nonce = cleanString(value);
  return UNLOCK_NONCE_RE.test(nonce) ? nonce : '';
}

function normalizeEntitlement(raw) {
  if (typeof raw === 'string') {
    return { sessionId: cleanString(raw), nonce: '' };
  }

  if (raw && typeof raw === 'object') {
    return {
      sessionId: cleanString(raw.sessionId || raw.session_id || raw.checkoutSessionId),
      nonce: cleanString(raw.nonce || raw.unlockNonce || raw.unlock_nonce),
    };
  }

  return { sessionId: '', nonce: '' };
}

function entitlementError(error, message, status = 402) {
  return { ok: false, status, error, message };
}

async function verifyPaidToolEntitlement(stripeClient, rawEntitlement, expectedToolId) {
  if (!stripeClient?.checkout?.sessions?.retrieve) {
    return entitlementError('config', 'Stripe is not configured for paid tool access.', 503);
  }

  const entitlement = normalizeEntitlement(rawEntitlement);
  if (!CHECKOUT_SESSION_ID_RE.test(entitlement.sessionId) || !validateUnlockNonce(entitlement.nonce)) {
    return entitlementError(
      'paid_access_required',
      'Complete checkout in this browser before running this paid tool.'
    );
  }

  let session;
  try {
    session = await stripeClient.checkout.sessions.retrieve(entitlement.sessionId);
  } catch (err) {
    return entitlementError('invalid_paid_access', 'Paid tool access could not be verified.');
  }

  if (!session || session.payment_status !== 'paid') {
    return entitlementError('invalid_paid_access', 'Paid tool access could not be verified.');
  }

  const toolId = cleanString(session.metadata?.tool_id);
  if (!toolId) {
    return entitlementError('invalid_paid_access', 'Paid tool access is missing tool metadata.');
  }

  if (expectedToolId && toolId !== cleanString(expectedToolId)) {
    return entitlementError('invalid_paid_access', 'Paid tool access does not match this tool.');
  }

  const expectedNonce = cleanString(session.metadata?.unlock_nonce);
  if (!expectedNonce || entitlement.nonce !== expectedNonce) {
    return entitlementError('invalid_paid_access', 'Paid tool access is not valid for this browser.');
  }

  return { ok: true, toolId, session };
}

module.exports = {
  normalizeEntitlement,
  validateUnlockNonce,
  verifyPaidToolEntitlement,
};
