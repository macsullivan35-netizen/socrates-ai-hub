// Serverless function — runs on Vercel's servers, never exposed to the browser
// Stripe secret key is stored as an environment variable (STRIPE_SECRET_KEY)

const stripeFactory = require('stripe');
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

  try {
    const stripe = stripeFactory(process.env.STRIPE_SECRET_KEY);
    // Fetch last 100 charges
    const charges = await stripe.charges.list({ limit: 100, expand: ['data.payment_intent'] });

    const creatorCharges = charges.data.filter(c =>
      c.status === 'succeeded' &&
      String(c.metadata?.creator_id || c.payment_intent?.metadata?.creator_id || '') === String(user.id)
    );

    // Calculate real stats from this builder's successful Stripe data only.
    const totalRevenue = creatorCharges.reduce((sum, c) => sum + c.amount, 0) / 100; // Stripe stores cents

    const totalSales = creatorCharges.length;

    const uniqueCustomers = new Set(creatorCharges.map(c => c.customer || c.billing_details?.email || c.id));
    const totalCustomers = uniqueCustomers.size;

    // Revenue by product (from charge descriptions / metadata)
    const byProduct = {};
    creatorCharges.forEach(c => {
      const name = c.description || 'Unknown';
      byProduct[name] = (byProduct[name] || 0) + c.amount / 100;
    });

    // Recent transactions (last 10)
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
