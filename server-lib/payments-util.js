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

function bearerToken(req) {
  const auth = req.headers?.authorization || req.headers?.Authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

async function verifyPaidCheckoutSession({ stripe, sessionId, toolId }) {
  const id = sessionId != null ? String(sessionId).trim() : '';
  if (!id) {
    return {
      ok: false,
      status: 402,
      error: 'payment_required',
      message: 'Complete checkout before running this paid tool.',
    };
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(id);
  } catch {
    return {
      ok: false,
      status: 402,
      error: 'payment_required',
      message: 'Could not verify checkout for this paid tool.',
    };
  }

  if (session.payment_status !== 'paid') {
    return {
      ok: false,
      status: 402,
      error: 'payment_required',
      message: 'Checkout is not paid for this tool.',
    };
  }

  const sessionToolId = session.metadata?.tool_id;
  if (!sessionToolId || String(sessionToolId) !== String(toolId)) {
    return {
      ok: false,
      status: 403,
      error: 'payment_tool_mismatch',
      message: 'Checkout does not match this tool.',
    };
  }

  return { ok: true, session };
}

module.exports = { cors, parseJsonBody, platformFeeAmount, bearerToken, verifyPaidCheckoutSession };
