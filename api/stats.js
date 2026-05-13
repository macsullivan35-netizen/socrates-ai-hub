// Serverless function — runs on Vercel's servers.
// Env: STRIPE_SECRET_KEY, SOCRATES_STATS_TOKEN (or DASHBOARD_STATS_TOKEN)

const crypto = require('crypto');

function statsToken() {
  return process.env.SOCRATES_STATS_TOKEN || process.env.DASHBOARD_STATS_TOKEN || '';
}

function tokenMatches(actual, expected) {
  if (!actual || !expected) return false;
  const actualBuf = Buffer.from(actual);
  const expectedBuf = Buffer.from(expected);
  return actualBuf.length === expectedBuf.length && crypto.timingSafeEqual(actualBuf, expectedBuf);
}

function hasStatsAccess(req) {
  const expected = statsToken();
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return tokenMatches(token, expected);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  if (!statsToken()) {
    return res.status(404).json({ error: 'not_found' });
  }

  if (!hasStatsAccess(req)) {
    return res.status(401).json({ error: 'auth' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'config' });
  }

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
    console.error(err);
    res.status(500).json({ error: 'stripe_error' });
  }
};
