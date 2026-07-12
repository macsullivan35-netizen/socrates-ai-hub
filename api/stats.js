const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { cors, getBearerToken } = require('../server-lib/payments-util.js');

module.exports = async (req, res) => {
  cors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'auth_required' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'config', message: 'Supabase service credentials missing.' });
  }

  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: authData, error: authError } = await sb.auth.getUser(token);
    if (authError || !authData?.user) return res.status(401).json({ error: 'auth_required' });
    const creatorId = String(authData.user.id);

    const charges = await stripe.charges.list({
      limit: 100,
      expand: ['data.payment_intent'],
    });
    const creatorCharges = charges.data.filter((c) => {
      if (c.status !== 'succeeded') return false;
      const chargeCreator = c.metadata?.creator_id || c.payment_intent?.metadata?.creator_id;
      return String(chargeCreator || '') === creatorId;
    });

    const totalRevenue = creatorCharges.reduce((sum, c) => sum + c.amount, 0) / 100;
    const totalSales = creatorCharges.length;

    const totalCustomers = new Set(
      creatorCharges.map(c => c.billing_details?.email || c.customer || '').filter(Boolean)
    ).size;

    const byProduct = {};
    creatorCharges.forEach(c => {
      const name = c.description || 'Unknown';
      byProduct[name] = (byProduct[name] || 0) + c.amount / 100;
    });

    const recent = creatorCharges
      .slice(0, 10)
      .map(c => ({
        id: c.id,
        amount: c.amount / 100,
        description: c.description || 'Purchase',
        customer: c.billing_details?.email || 'Anonymous',
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
