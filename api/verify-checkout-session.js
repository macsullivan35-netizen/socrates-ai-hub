// GET ?session_id=cs_... — confirms payment; use after redirect (do not expose secret).

const url = require('url');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { cors } = require('../server-lib/payments-util.js');
const { verifyPaidToolEntitlement } = require('../server-lib/stripe-entitlements.js');

module.exports = async (req, res) => {
  cors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const parsed = url.parse(req.url || '', true);
  const sessionId = req.query?.session_id || parsed.query?.session_id;
  const unlockNonce = req.query?.unlock_nonce || parsed.query?.unlock_nonce;
  if (!sessionId) return res.status(400).json({ ok: false, error: 'session_id required' });

  try {
    const result = await verifyPaidToolEntitlement(stripe, { sessionId, nonce: unlockNonce });
    if (!result.ok) {
      return res.status(result.status || 400).json({ ok: false, error: result.error, message: result.message });
    }
    return res.status(200).json({ ok: true, toolId: String(result.toolId) });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
};
