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

async function verifyPaidToolCheckoutSession(stripeClient, sessionId, toolId) {
  const sid = sessionId != null ? String(sessionId).trim() : '';
  if (!sid) {
    return {
      ok: false,
      status: 402,
      error: 'payment_required',
      message: 'Complete checkout before running this paid tool.',
    };
  }
  if (!stripeClient?.checkout?.sessions?.retrieve) {
    return {
      ok: false,
      status: 503,
      error: 'payment_verification_unavailable',
      message: 'Paid access verification is not configured.',
    };
  }

  let session;
  try {
    session = await stripeClient.checkout.sessions.retrieve(sid);
  } catch (err) {
    return {
      ok: false,
      status: 403,
      error: 'invalid_payment_session',
      message: err.message || 'Could not verify checkout session.',
    };
  }

  if (session.payment_status !== 'paid') {
    return {
      ok: false,
      status: 402,
      error: 'payment_required',
      message: 'Checkout is not paid yet.',
    };
  }

  const paidToolId = session.metadata?.tool_id != null ? String(session.metadata.tool_id) : '';
  if (!paidToolId || paidToolId !== String(toolId)) {
    return {
      ok: false,
      status: 403,
      error: 'payment_mismatch',
      message: 'Checkout session does not unlock this tool.',
    };
  }

  return { ok: true, session };
}

module.exports = { cors, parseJsonBody, platformFeeAmount, verifyPaidToolCheckoutSession };
