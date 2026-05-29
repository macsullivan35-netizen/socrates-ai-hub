// POST { toolId, sessionId?: "cs_..." } -- returns a verified Socrates tool pack.
// Paid database tools require a Stripe Checkout session for the same tool.

const { createClient } = require('@supabase/supabase-js');
const { cors, parseJsonBody, verifyPaidCheckoutSession } = require('../server-lib/payments-util.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeIcon(icon) {
  if (typeof icon === 'string' && icon.startsWith('data:image') && icon.length > 12000) {
    return '[Large image icon omitted - see tool on the marketplace]';
  }
  return icon || '';
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'config', message: 'Supabase service credentials missing.' });
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch {
    body = {};
  }

  const toolId = body.toolId != null ? String(body.toolId).trim() : '';
  const sessionId = body.sessionId != null ? String(body.sessionId).trim() : '';
  if (!UUID_RE.test(toolId)) {
    return res.status(400).json({ error: 'bad_request', message: 'A database toolId is required.' });
  }

  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: tool, error } = await sb
      .from('tools')
      .select('id,name,description,category,type,icon,tags,input_schema,price,system_prompt,is_published,sample_output,profiles(username,display_name)')
      .eq('id', toolId)
      .maybeSingle();

    if (error || !tool || !tool.is_published) {
      return res.status(404).json({ error: 'not_found', message: 'Tool not found or not published.' });
    }

    const priceNum = Number(tool.price);
    if (Number.isFinite(priceNum) && priceNum > 0) {
      const paidAccess = await verifyPaidCheckoutSession(process.env.STRIPE_SECRET_KEY, toolId, sessionId);
      if (!paidAccess.ok) {
        return res.status(paidAccess.status).json({
          error: paidAccess.error,
          message: paidAccess.message,
        });
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      format: 'socrates-tool-pack',
      version: 1,
      exportedAt: new Date().toISOString(),
      tool: {
        id: tool.id,
        name: tool.name,
        description: tool.description || '',
        category: tool.category || '',
        type: tool.type || '',
        author: tool.profiles?.display_name || tool.profiles?.username || 'Builder',
        icon: safeIcon(tool.icon),
        system_prompt: tool.system_prompt || '',
        input_fields: tool.input_schema || [],
        sample_output: tool.sample_output || '',
        priceLabel: priceNum > 0 ? `$${priceNum}` : 'free',
        tags: tool.tags || [],
      },
      hints: {
        usage: 'Use system_prompt as the system message in ChatGPT, Claude, or any LLM app. input_fields describes the Run form.',
        web: 'Open marketplace.html on the Socrates site to run this tool in the browser.',
        desktop: 'For optional desktop bundles and installs, see the Download page on the same site.',
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server_error', message: err.message || 'Download failed.' });
  }
};
