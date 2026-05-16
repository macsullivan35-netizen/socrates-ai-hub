// POST { toolId, checkoutSessionId? } — export a published DB tool pack.
// Paid tools require a verified paid Stripe Checkout session for the same tool.

const { createClient } = require('@supabase/supabase-js');
const {
  checkoutSessionIdFrom,
  cors,
  isPaidPrice,
  parseJsonBody,
  verifyPaidToolAccess,
} = require('../server-lib/payments-util.js');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'config', message: 'Supabase service credentials missing for database tools.' });
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch {
    body = {};
  }

  const toolId = body.toolId != null ? String(body.toolId).trim() : '';
  if (!toolId) return res.status(400).json({ error: 'bad_request', message: 'toolId required' });

  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: tool, error } = await sb
      .from('tools')
      .select('id,name,description,category,type,icon,system_prompt,input_schema,input_placeholder,price,creator_id,profiles(username,display_name)')
      .eq('id', toolId)
      .eq('is_published', true)
      .maybeSingle();

    if (error || !tool) {
      return res.status(404).json({ error: 'not_found', message: 'Tool not found or not published.' });
    }

    if (isPaidPrice(tool.price)) {
      if (!process.env.STRIPE_SECRET_KEY) {
        return res.status(503).json({ error: 'config', message: 'Stripe is not configured for paid tool verification.' });
      }
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const access = await verifyPaidToolAccess({
        stripe,
        sessionId: checkoutSessionIdFrom(body),
        toolId,
      });
      if (!access.ok) {
        return res.status(access.status).json({
          error: access.error,
          message: access.message,
        });
      }
    }

    return res.status(200).json({
      format: 'socrates-tool-pack',
      version: 1,
      exportedAt: new Date().toISOString(),
      tool: {
        id: tool.id,
        name: tool.name || '',
        description: tool.description || '',
        category: tool.category || '',
        type: tool.type || '',
        typeName: tool.type || '',
        author: tool.profiles?.display_name || tool.profiles?.username || 'Builder',
        icon: tool.icon || '',
        system_prompt: tool.system_prompt || '',
        input_fields: tool.input_schema || [
          {
            label: 'Your input',
            id: 'userinput',
            type: 'textarea',
            placeholder: tool.input_placeholder || 'Describe what you want...',
          },
        ],
        priceLabel: isPaidPrice(tool.price) ? `$${Number(tool.price)}` : 'free',
      },
      hints: {
        usage: 'Use system_prompt as the system message in ChatGPT, Claude, or any LLM app. input_fields describes the Run form.',
        web: 'Open marketplace.html on the Socrates site to run this tool in the browser.',
        desktop: 'For optional desktop bundles and installs, see the Download page on the same site.',
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'tool_pack_error', message: err.message || 'Could not export tool pack.' });
  }
};
