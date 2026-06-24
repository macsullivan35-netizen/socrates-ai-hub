// Serverless function — runs on Vercel's servers, never exposes Stripe data publicly.
// Stripe secret key is stored as an environment variable (STRIPE_SECRET_KEY).

const { createClient } = require('@supabase/supabase-js');
const { bearerToken, cors } = require('../server-lib/payments-util.js');

module.exports = async (req, res) => {
  cors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'auth' });

  if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'config' });
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user } = {}, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !user) return res.status(401).json({ error: 'auth' });

  const { data: profile, error: pErr } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (pErr || profile?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });

  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    // Fetch last 100 charges
    const charges = await stripe.charges.list({ limit: 100 });

    // Fetch all customers
    const customers = await stripe.customers.list({ limit: 100 });

    // Calculate real stats from actual Stripe data
    const totalRevenue = charges.data
      .filter(c => c.status === 'succeeded')
      .reduce((sum, c) => sum + c.amount, 0) / 100; // Stripe stores cents

    const totalSales = charges.data.filter(c => c.status === 'succeeded').length;

    const totalCustomers = customers.data.length;

    // Revenue by product (from charge descriptions / metadata)
    const byProduct = {};
    charges.data
      .filter(c => c.status === 'succeeded')
      .forEach(c => {
        const name = c.description || 'Unknown';
        byProduct[name] = (byProduct[name] || 0) + c.amount / 100;
      });

    // Recent transactions (last 10)
    const recent = charges.data
      .filter(c => c.status === 'succeeded')
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
