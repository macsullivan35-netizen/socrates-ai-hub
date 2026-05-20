// POST { toolId, entitlement } — returns a Socrates tool pack. Paid tools require
// a Stripe Checkout session + browser nonce entitlement.

const stripeFactory = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { cors, parseJsonBody } = require('../server-lib/payments-util.js');
const { verifyPaidToolEntitlement } = require('../server-lib/stripe-entitlements.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toolFieldsFromRow(t) {
  let schema = t.input_schema;
  if (schema != null && typeof schema === 'string') {
    try {
      schema = JSON.parse(schema);
    } catch {
      schema = null;
    }
  }
  if (Array.isArray(schema) && schema.length > 0) {
    return schema.map((f, i) => {
      const idRaw = f?.id != null ? String(f.id) : `field_${i}`;
      const id = idRaw.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '') || `field_${i}`;
      const type = f?.type === 'textarea' ? 'textarea' : (f?.type === 'select' ? 'select' : 'text');
      const row = {
        label: f?.label || `Input ${i + 1}`,
        id,
        type,
        placeholder: f?.placeholder != null ? String(f.placeholder) : '',
      };
      if (type === 'select' && Array.isArray(f.options)) row.options = f.options.map(String);
      return row;
    });
  }
  return [{ label: 'Your input', id: 'userinput', type: 'textarea', placeholder: t.input_placeholder || 'Describe what you want...' }];
}

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
  if (!UUID_RE.test(toolId)) {
    return res.status(400).json({ error: 'bad_request', message: 'Valid database toolId required.' });
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: tool, error } = await sb
    .from('tools')
    .select('id,name,description,category,type,icon,tags,price,runs,system_prompt,input_schema,input_placeholder,is_published,profiles(username,display_name)')
    .eq('id', toolId)
    .maybeSingle();

  if (error || !tool || !tool.is_published) {
    return res.status(404).json({ error: 'not_found', message: 'Tool not found or not published.' });
  }

  const priceNum = Number(tool.price) || 0;
  if (priceNum > 0) {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ error: 'config', message: 'Stripe is not configured for paid tool downloads.' });
    }
    const access = await verifyPaidToolEntitlement(stripeFactory(process.env.STRIPE_SECRET_KEY), body.entitlement, toolId);
    if (!access.ok) {
      return res.status(access.status || 402).json({ error: access.error, message: access.message });
    }
  }

  let icon = tool.icon;
  if (typeof icon === 'string' && icon.startsWith('data:image') && icon.length > 12000) {
    icon = '[Large image icon omitted — see tool on the marketplace]';
  }

  return res.status(200).json({
    ok: true,
    pack: {
      format: 'socrates-tool-pack',
      version: 1,
      exportedAt: new Date().toISOString(),
      tool: {
        id: tool.id,
        name: tool.name,
        description: tool.description || '',
        category: tool.category || '',
        type: tool.type || '',
        typeName: tool.type || '',
        author: tool.profiles?.display_name || tool.profiles?.username || 'Builder',
        icon,
        tags: tool.tags || [],
        system_prompt: tool.system_prompt || '',
        input_fields: toolFieldsFromRow(tool),
        priceLabel: priceNum > 0 ? `$${priceNum}` : 'free',
      },
      hints: {
        usage: 'Use system_prompt as the system message in ChatGPT, Claude, or any LLM app. input_fields describes the Run form.',
        web: 'Open marketplace.html on the Socrates site to run this tool in the browser.',
        desktop: 'For optional desktop bundles and installs, see the Download page on the same site.',
      },
    },
  });
};
