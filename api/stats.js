const stripeFactory = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { cors } = require('../server-lib/payments-util.js');

function bearerToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

function formatDate(created) {
  return new Date(created * 1000).toLocaleDateString();
}

function getStripe() {
  return stripeFactory(process.env.STRIPE_SECRET_KEY);
}

module.exports = async (req, res) => {
  cors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'config' });
  }

  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'auth' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !user) return res.status(401).json({ error: 'auth' });

  try {
    const { data: tools, error: toolsErr } = await sb
      .from('tools')
      .select('id,name')
      .eq('creator_id', user.id);
    if (toolsErr) throw toolsErr;

    const toolNames = new Map((tools || []).map(t => [String(t.id), t.name || 'Unknown tool']));
    const sessions = await getStripe().checkout.sessions.list({ limit: 100 });
    const paidSessions = (sessions.data || []).filter(s =>
      s.payment_status === 'paid' &&
      String(s.metadata?.creator_id || '') === String(user.id)
    );

    const totalRevenue = paidSessions
      .reduce((sum, s) => sum + (Number(s.amount_total) || 0), 0) / 100;

    const totalSales = paidSessions.length;

    const customers = new Set();
    paidSessions.forEach(s => {
      const key = s.customer || s.customer_details?.email;
      if (key) customers.add(String(key));
    });
    const totalCustomers = customers.size;

    const byProduct = {};
    paidSessions.forEach(s => {
      const toolId = String(s.metadata?.tool_id || '');
      const name = toolNames.get(toolId) || 'Unknown tool';
      byProduct[name] = (byProduct[name] || 0) + (Number(s.amount_total) || 0) / 100;
    });

    const recent = paidSessions
      .slice(0, 10)
      .map(s => ({
        id: s.id,
        amount: (Number(s.amount_total) || 0) / 100,
        description: toolNames.get(String(s.metadata?.tool_id || '')) || 'Tool purchase',
        customer: 'Customer',
        date: formatDate(s.created)
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
