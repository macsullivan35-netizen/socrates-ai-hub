// Serverless function — runs on Vercel's servers, never exposes Stripe secrets to the browser.
// Requires a Supabase bearer token and only returns charges tagged for that builder.

const stripeFactory = require('stripe');
const { cors, requireSupabaseUser } = require('../server-lib/payments-util.js');

module.exports = async (req, res) => {
  cors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const auth = await requireSupabaseUser(req, res);
  if (!auth) return;

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'config', message: 'Stripe is not configured.' });
  }

  try {
    const stripe = stripeFactory(process.env.STRIPE_SECRET_KEY);
    const charges = await stripe.charges.list({ limit: 100, expand: ['data.payment_intent'] });
    const sellerCharges = charges.data.filter((charge) => {
      const paymentIntent = charge.payment_intent && typeof charge.payment_intent === 'object'
        ? charge.payment_intent
        : null;
      return charge.status === 'succeeded' &&
        String(paymentIntent?.metadata?.creator_id || '') === String(auth.user.id);
    });

    const totalRevenue = sellerCharges
      .reduce((sum, c) => sum + c.amount, 0) / 100;

    const totalSales = sellerCharges.length;

    const customerKeys = new Set(
      sellerCharges.map(c => c.billing_details?.email || c.customer || c.id).filter(Boolean)
    );
    const totalCustomers = customerKeys.size;

    const byProduct = {};
    sellerCharges.forEach(c => {
      const name = c.description || 'Unknown';
      byProduct[name] = (byProduct[name] || 0) + c.amount / 100;
    });

    const recent = sellerCharges
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
    res.status(500).json({ error: 'stripe_error', message: err.message || 'Could not load Stripe stats.' });
  }
};
