function cors(res, methods = 'GET, POST, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      resolve(req.body);
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function platformFeeAmount(totalCents, feePercent) {
  const p = Math.min(90, Math.max(0, Number(feePercent) || 20));
  return Math.round((totalCents * p) / 100);
}

function isPaidPrice(price) {
  const n = Number(price);
  return Number.isFinite(n) && n > 0;
}

function checkoutSessionIdFrom(body) {
  const raw = body?.checkoutSessionId ?? body?.checkout_session_id ?? body?.sessionId ?? '';
  return raw != null ? String(raw).trim() : '';
}

async function verifyPaidToolAccess({ stripe, sessionId, toolId }) {
  const id = String(toolId || '').trim();
  const sid = String(sessionId || '').trim();
  if (!sid) {
    return { ok: false, status: 402, error: 'payment_required', message: 'Complete checkout to unlock this paid tool.' };
  }
  if (!stripe || typeof stripe.checkout?.sessions?.retrieve !== 'function') {
    return { ok: false, status: 500, error: 'config', message: 'Stripe is not configured for paid tool verification.' };
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sid);
  } catch (err) {
    return { ok: false, status: 403, error: 'invalid_checkout_session', message: err.message || 'Checkout session could not be verified.' };
  }

  if (session?.payment_status !== 'paid') {
    return { ok: false, status: 402, error: 'payment_required', message: 'Checkout has not been paid yet.' };
  }
  if (String(session?.metadata?.tool_id || '') !== id) {
    return { ok: false, status: 403, error: 'tool_mismatch', message: 'Checkout session does not unlock this tool.' };
  }

  return { ok: true, session };
}

module.exports = {
  checkoutSessionIdFrom,
  cors,
  isPaidPrice,
  parseJsonBody,
  platformFeeAmount,
  verifyPaidToolAccess,
};
