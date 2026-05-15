// GET ?session_id=cs_... — confirms payment; use after redirect (do not expose secret).

const url = require('url');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { cors, verifyPaidCheckoutSessionRecord } = require('../server-lib/payments-util.js');

module.exports = async (req, res) => {
  cors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const parsed = url.parse(req.url || '', true);
  const sessionId = req.query?.session_id || parsed.query?.session_id;
  if (!sessionId) return res.status(400).json({ ok: false, error: 'session_id required' });

  try {
    const session = await stripe.checkout.sessions.retrieve(String(sessionId));
    const toolId = session.metadata?.tool_id;
    if (!toolId) return res.status(400).json({ ok: false, error: 'no_metadata' });

    const verified = verifyPaidCheckoutSessionRecord(session, toolId);
    if (!verified.ok) return res.status(verified.status).json({ ok: false, error: verified.error });
    return res.status(200).json({ ok: true, toolId: verified.toolId });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
};
