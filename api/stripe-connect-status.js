// GET — Bearer token; syncs stripe_charges_enabled from Stripe to profiles.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const { cors } = require('../server-lib/payments-util.js');

module.exports = async (req, res) => {
  cors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'config' });
  }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'auth' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !user) return res.status(401).json({ error: 'auth' });

  const { data: profile } = await sb.from('profiles').select('stripe_account_id').eq('id', user.id).maybeSingle();
  if (!profile?.stripe_account_id) {
    return res.status(200).json({ connected: false, charges_enabled: false });
  }

  try {
    const acct = await stripe.accounts.retrieve(profile.stripe_account_id);
    const charges_enabled = !!acct.charges_enabled;
    await sb.from('profiles').update({ stripe_charges_enabled: charges_enabled }).eq('id', user.id);
    return res.status(200).json({
      connected: true,
      charges_enabled,
      details_submitted: !!acct.details_submitted,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
