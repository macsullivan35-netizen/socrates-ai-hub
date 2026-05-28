// Serverless function — runs on Vercel's servers, never exposed to the browser
// Stripe secret key is stored as an environment variable (STRIPE_SECRET_KEY)

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'config', message: 'Missing Supabase service env vars.' });
  }

  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: authData, error: authError } = await sb.auth.getUser(token);
    if (authError || !authData?.user) return res.status(401).json({ error: 'unauthorized' });
    const userId = String(authData.user.id);

    const charges = await stripe.charges.list({ limit: 100 });

    const succeeded = charges.data.filter(c => {
      if (c.status !== 'succeeded') return false;
      return String(c.metadata?.creator_id || '') === userId;
    });

    const totalRevenue = succeeded.reduce((sum, c) => sum + c.amount, 0) / 100;

    const totalSales = succeeded.length;

    const totalCustomers = new Set(succeeded.map(c => c.billing_details?.email).filter(Boolean)).size;

    const byProduct = {};
    succeeded.forEach(c => {
      const name = c.description || 'Unknown';
      byProduct[name] = (byProduct[name] || 0) + c.amount / 100;
    });

    const recent = succeeded
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
