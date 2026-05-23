// Serverless function — runs on Vercel's servers, never exposed to the browser
// Stripe secret key is stored as an environment variable (STRIPE_SECRET_KEY)

const stripeFactory = require('stripe');

function bearerToken(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

module.exports = async (req, res) => {
  // Allow the dashboard page to call this when it supplies a server-configured token.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const statsToken = process.env.STRIPE_STATS_TOKEN || process.env.SOCRATES_STATS_TOKEN || '';
  if (!statsToken) {
    return res.status(503).json({ error: 'stats_auth_not_configured' });
  }
  if (bearerToken(req) !== statsToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'stripe_not_configured' });
  }

  try {
    const stripe = stripeFactory(process.env.STRIPE_SECRET_KEY);
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
    console.error(err);
    res.status(500).json({ error: 'stripe_error' });
  }
};
