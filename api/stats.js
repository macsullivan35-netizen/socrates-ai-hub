// Serverless function — runs on Vercel's servers, never exposed to the browser.
// Requires Authorization: Bearer <supabase access token>; returns only the signed-in builder's Stripe sales.

const { createClient } = require('@supabase/supabase-js');
const { cors } = require('../server-lib/payments-util.js');

let stripeClient;
function stripe() {
  if (!stripeClient) stripeClient = require('stripe')(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

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
    const { data: profile, error: pErr } = await sb
      .from('profiles')
      .select('stripe_account_id')
      .eq('id', user.id)
      .maybeSingle();
    if (pErr) throw pErr;

    if (!profile?.stripe_account_id) {
      return res.status(200).json({
        totalRevenue: 0,
        totalSales: 0,
        totalCustomers: 0,
        byProduct: {},
        recent: [],
      });
    }

    // Fetch last 100 charges
    const charges = await stripe().charges.list({ limit: 100 });
    const succeededCharges = charges.data.filter(c =>
      c.status === 'succeeded' &&
      c.transfer_data?.destination === profile.stripe_account_id
    );

    // Calculate real stats from the signed-in builder's Stripe sales.
    const totalRevenue = succeededCharges.reduce((sum, c) => sum + c.amount, 0) / 100; // Stripe stores cents

    const totalSales = succeededCharges.length;

    const totalCustomers = new Set(
      succeededCharges.map(c => c.customer || c.billing_details?.email).filter(Boolean)
    ).size;

    // Revenue by product (from charge descriptions / metadata)
    const byProduct = {};
    succeededCharges.forEach(c => {
      const name = c.description || 'Unknown';
      byProduct[name] = (byProduct[name] || 0) + c.amount / 100;
    });

    // Recent transactions (last 10)
    const recent = succeededCharges
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
