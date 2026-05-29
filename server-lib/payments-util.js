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

async function verifyPaidCheckoutSession(stripeSecretKey, toolId, sessionId) {
  const sid = sessionId != null ? String(sessionId).trim() : '';
  if (!sid) {
    return {
      ok: false,
      status: 402,
      error: 'payment_required',
      message: 'Complete checkout before accessing this paid tool.',
    };
  }
  if (!stripeSecretKey) {
    return {
      ok: false,
      status: 503,
      error: 'checkout_verification_unavailable',
      message: 'Paid tool checkout verification is not configured on the API server.',
    };
  }

  try {
    const stripe = require('stripe')(stripeSecretKey);
    const session = await stripe.checkout.sessions.retrieve(sid);
    if (session.payment_status !== 'paid') {
      return { ok: false, status: 402, error: 'not_paid', message: 'Checkout is not paid.' };
    }
    if (String(session.metadata?.tool_id || '') !== String(toolId)) {
      return {
        ok: false,
        status: 403,
        error: 'wrong_tool',
        message: 'Checkout session does not unlock this tool.',
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      status: 402,
      error: 'invalid_checkout_session',
      message: err.message || 'Could not verify checkout session.',
    };
  }
}

module.exports = { cors, parseJsonBody, platformFeeAmount, verifyPaidCheckoutSession };
