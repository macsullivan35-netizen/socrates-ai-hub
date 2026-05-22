// Serverless function — runs on Vercel's servers, never exposes Stripe secrets to the browser.
// Returns Stripe stats only for the authenticated builder.

const stripeFactory = require('stripe');
const { createClient } = require('@supabase/supabase-js');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

function bearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function chargeCreatorId(charge) {
  return String(charge.metadata?.creator_id || charge.payment_intent?.metadata?.creator_id || '');
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'config', message: 'Missing Stripe or Supabase server configuration.' });
  }

  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'unauthorized', message: 'Sign in to view dashboard stats.' });

  try {
    const stripe = stripeFactory(process.env.STRIPE_SECRET_KEY);
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: authData, error: authError } = await sb.auth.getUser(token);
    if (authError || !authData?.user) {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid dashboard session.' });
    }

    const userId = String(authData.user.id);

    // Fetch recent platform charges and keep only charges belonging to this builder.
    const charges = await stripe.charges.list({ limit: 100, expand: ['data.payment_intent'] });
    const builderCharges = charges.data.filter(c => c.status === 'succeeded' && chargeCreatorId(c) === userId);

    // Calculate real stats from actual Stripe data
    const totalRevenue = builderCharges.reduce((sum, c) => sum + c.amount, 0) / 100; // Stripe stores cents

    const totalSales = builderCharges.length;

    const totalCustomers = new Set(
      builderCharges.map(c => c.billing_details?.email || c.customer || '').filter(Boolean)
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
        customer: c.billing_details?.email || 'Customer',
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
