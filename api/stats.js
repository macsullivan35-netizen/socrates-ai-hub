// Authenticated builder stats. Never expose platform-wide Stripe data publicly.

const stripeFactory = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { cors } = require('../server-lib/payments-util.js');

module.exports = async (req, res) => {
  cors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'config', message: 'Stripe or Supabase server credentials are missing.' });
    }

    const auth = req.headers.authorization || req.headers.Authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) {
      return res.status(401).json({ error: 'unauthorized', message: 'Sign in to view builder stats.' });
    }

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: authData, error: authError } = await sb.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired session.' });
    }

    const stripe = stripeFactory(process.env.STRIPE_SECRET_KEY);
    const charges = await stripe.charges.list({ limit: 100 });
    const ownCharges = charges.data.filter(c =>
      c.status === 'succeeded' &&
      String(c.metadata?.creator_id || '') === String(user.id)
    );

    const buyerKeys = new Set();
    ownCharges.forEach(c => {
      if (c.customer) buyerKeys.add(String(c.customer));
      else if (c.billing_details?.email) buyerKeys.add(String(c.billing_details.email).toLowerCase());
    });

    const totalRevenue = ownCharges.reduce((sum, c) => sum + c.amount, 0) / 100;
    const totalSales = ownCharges.length;
    const totalCustomers = buyerKeys.size;

    // Revenue by product (from charge descriptions / metadata)
    const byProduct = {};
    ownCharges.forEach(c => {
      const name = c.description || 'Tool sale';
      byProduct[name] = (byProduct[name] || 0) + c.amount / 100;
    });

    const recent = ownCharges
      .slice(0, 10)
      .map(c => ({
        id: c.id,
        amount: c.amount / 100,
        description: c.description || 'Purchase',
        customer: 'Buyer',
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
    res.status(500).json({ error: 'stats_error', message: err.message });
  }
};
