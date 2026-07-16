// Serverless function — returns signed-in builder Stripe stats only.
// Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const stripeFactory = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { bearerToken, cors } = require('../server-lib/payments-util.js');

module.exports = async (req, res) => {
  cors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'config', message: 'Missing Stripe or Supabase server credentials.' });
  }

  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'auth', message: 'Sign in to view dashboard stats.' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !user) return res.status(401).json({ error: 'auth', message: 'Invalid session. Sign in again.' });

  try {
    const stripe = stripeFactory(process.env.STRIPE_SECRET_KEY);
    const charges = await stripe.charges.list({ limit: 100, expand: ['data.payment_intent'] });
    const builderCharges = charges.data.filter(c =>
      c.status === 'succeeded' &&
      String(c.metadata?.creator_id || c.payment_intent?.metadata?.creator_id || '') === String(user.id)
    );

    // Calculate real stats from actual Stripe data
    const totalRevenue = builderCharges
      .reduce((sum, c) => sum + c.amount, 0) / 100; // Stripe stores cents

    const totalSales = builderCharges.length;

    const totalCustomers = new Set(
      builderCharges.map(c => c.customer || c.billing_details?.email).filter(Boolean)
    ).size;

    // Revenue by product (from charge descriptions / metadata)
    const byProduct = {};
    builderCharges.forEach(c => {
      const name = c.description || 'Unknown';
      byProduct[name] = (byProduct[name] || 0) + c.amount / 100;
    });

    // Recent transactions (last 10)
    const recent = builderCharges
      .slice(0, 10)
      .map(c => ({
        id: c.id,
        amount: c.amount / 100,
        description: c.description || 'Purchase',
        customer: c.billing_details?.email || 'Buyer',
        date: new Date(c.created * 1000).toLocaleDateString()
      }));

    res.status(200).json({
      totalRevenue,
      totalSales,
      totalCustomers,
      byProduct,
      recent
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
