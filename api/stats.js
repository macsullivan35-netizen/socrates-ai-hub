// Authenticated builder stats. Uses Stripe server-side and scopes results to
// charges whose PaymentIntent metadata was created for the signed-in builder.

const { createClient } = require('@supabase/supabase-js');
const { cors } = require('../server-lib/payments-util.js');

function chargeCreatorId(charge) {
  const paymentIntent = charge.payment_intent && typeof charge.payment_intent === 'object'
    ? charge.payment_intent
    : null;
  return paymentIntent?.metadata?.creator_id || charge.metadata?.creator_id || '';
}

function chargeToolName(charge) {
  const paymentIntent = charge.payment_intent && typeof charge.payment_intent === 'object'
    ? charge.payment_intent
    : null;
  return paymentIntent?.description || charge.description || 'Tool purchase';
}

function builderAmountDollars(charge) {
  const paymentIntent = charge.payment_intent && typeof charge.payment_intent === 'object'
    ? charge.payment_intent
    : null;
  const fee = Number(paymentIntent?.application_fee_amount || charge.application_fee_amount || 0);
  return (Number(charge.amount || 0) - fee) / 100;
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
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const charges = await stripe.charges.list({
      limit: 100,
      expand: ['data.payment_intent'],
    });

    const builderCharges = charges.data.filter(c =>
      c.status === 'succeeded' && String(chargeCreatorId(c)) === String(user.id)
    );

    const totalRevenue = builderCharges.reduce((sum, c) => sum + builderAmountDollars(c), 0);
    const totalSales = builderCharges.length;
    const customers = new Set(builderCharges.map(c => c.billing_details?.email).filter(Boolean));
    const totalCustomers = customers.size;

    const byProduct = {};
    builderCharges.forEach(c => {
      const name = chargeToolName(c);
      byProduct[name] = (byProduct[name] || 0) + builderAmountDollars(c);
    });

    const recent = builderCharges
      .slice(0, 10)
      .map(c => ({
        id: c.id,
        amount: builderAmountDollars(c),
        description: chargeToolName(c),
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

module.exports._test = { chargeCreatorId, chargeToolName, builderAmountDollars };
