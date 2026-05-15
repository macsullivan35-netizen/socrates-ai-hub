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

async function verifyPaidCheckoutSession(stripe, sessionId, toolId) {
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
      message: 'Unable to verify checkout for this paid tool.',
    };
  }

  return verifyPaidCheckoutSessionRecord(session, toolId);
}

function verifyPaidCheckoutSessionRecord(session, toolId) {
  if (session.payment_status !== 'paid') {
    return {
      ok: false,
      status: 402,
      error: 'payment_required',
      message: 'Checkout is not paid yet.',
    };
  }

  const sessionToolId = session.metadata?.tool_id;
  if (!sessionToolId || String(sessionToolId) !== String(toolId)) {
    return {
      ok: false,
      status: 403,
      error: 'tool_mismatch',
      message: 'Checkout session does not unlock this tool.',
    };
  }

  return { ok: true, toolId: String(sessionToolId) };
}

module.exports = {
  cors,
  parseJsonBody,
  platformFeeAmount,
  verifyPaidCheckoutSession,
  verifyPaidCheckoutSessionRecord,
};
