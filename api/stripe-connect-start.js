// POST — requires Authorization: Bearer <supabase access token>
// Creates Stripe Express Connect account + Account Link for onboarding.
// Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PUBLIC_SITE_URL

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const { cors, parseJsonBody } = require('../server-lib/payments-util.js');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const siteBase = (process.env.PUBLIC_SITE_URL || '').replace(/\/$/, '');
  const country = (process.env.STRIPE_CONNECT_COUNTRY || 'US').toUpperCase();

  if (!siteBase || !process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'config', message: 'Missing env: PUBLIC_SITE_URL, STRIPE_SECRET_KEY, or Supabase service key.' });
  }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'auth', message: 'Sign in and try again.' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !user) return res.status(401).json({ error: 'auth', message: 'Invalid session. Sign in again.' });

  try {
    let body = {};
    try {
      body = await parseJsonBody(req);
    } catch { /* empty */ }

    const { data: profile } = await sb.from('profiles').select('stripe_account_id').eq('id', user.id).maybeSingle();

    let accountId = profile?.stripe_account_id;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country,
        email: user.email || undefined,
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        metadata: { supabase_user_id: user.id },
      });
      accountId = account.id;
      const { data: prof } = await sb.from('profiles').select('id').eq('id', user.id).maybeSingle();
      if (prof) {
        await sb.from('profiles').update({ stripe_account_id: accountId, stripe_charges_enabled: false }).eq('id', user.id);
      } else {
        const { error: insErr } = await sb
          .from('profiles')
          .insert({ id: user.id, stripe_account_id: accountId, stripe_charges_enabled: false });
        if (insErr) throw insErr;
      }
    }

    const returnUrl = `${siteBase}/settings.html?stripe=return`;
    const refreshUrl = `${siteBase}/settings.html?stripe=refresh`;

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    return res.status(200).json({ url: link.url, accountId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'stripe_error', message: err.message || 'Connect failed' });
  }
};
