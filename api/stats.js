// Serverless function — runs on Vercel's servers, never exposed to the browser
// Stripe secret key is stored as an environment variable (STRIPE_SECRET_KEY)

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // Allow the dashboard page to call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
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
