// Serverless function — returns Stripe stats scoped to the authenticated builder.
// Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const { cors } = require('../server-lib/payments-util.js');
const { requireSupabaseUser } = require('../server-lib/auth-util.js');

module.exports = async (req, res) => {
  cors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const auth = await requireSupabaseUser(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error, message: auth.message });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'config', message: 'Stripe is not configured.' });
  }

  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const paymentIntents = await stripe.paymentIntents.list({
      limit: 100,
      expand: ['data.latest_charge'],
    });

    const creatorPayments = paymentIntents.data.filter((pi) =>
      pi.status === 'succeeded' &&
      String(pi.metadata?.creator_id || '') === String(auth.user.id)
    );

    const totalRevenue = creatorPayments
      .reduce((sum, pi) => sum + (Number(pi.amount_received) || Number(pi.amount) || 0), 0) / 100;

    const totalSales = creatorPayments.length;
    const customerIds = new Set();
    creatorPayments.forEach((pi) => {
      const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
      const buyer = charge?.billing_details?.email || pi.customer || pi.receipt_email || '';
      if (buyer) customerIds.add(String(buyer));
    });
    const totalCustomers = customerIds.size;

    const byProduct = {};
    creatorPayments.forEach((pi) => {
      const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
      const name = charge?.description || (pi.metadata?.tool_id ? `Tool ${pi.metadata.tool_id}` : 'Tool purchase');
      byProduct[name] = (byProduct[name] || 0) + (Number(pi.amount_received) || Number(pi.amount) || 0) / 100;
    });

    const recent = creatorPayments
      .slice(0, 10)
      .map((pi) => {
        const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
        return {
          id: pi.id,
          amount: (Number(pi.amount_received) || Number(pi.amount) || 0) / 100,
          description: charge?.description || (pi.metadata?.tool_id ? `Tool ${pi.metadata.tool_id}` : 'Purchase'),
          customer: charge?.billing_details?.email || pi.receipt_email || 'Anonymous',
          date: new Date(pi.created * 1000).toLocaleDateString(),
        };
      });

    res.status(200).json({
      totalRevenue,
      totalSales,
      totalCustomers,
      byProduct,
      recent
    });

  } catch (err) {
    res.status(500).json({ error: err.message || 'Stripe stats failed.' });
  }
};
