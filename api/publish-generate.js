// POST { idea, audience, always, never, price } — AI interview → tool spec JSON via server OPENAI_API_KEY.
// Lets publish flow work when browsers cannot reach api.openai.com directly (file://, CORS, firewall, extensions).
// Env: OPENAI_API_KEY, optional OPENAI_MODEL (default gpt-4o-mini)

const { createClient } = require('@supabase/supabase-js');
const { cors, parseJsonBody } = require('../server-lib/payments-util.js');

const SYSTEM_PROMPT = `You are an AI tool builder for a marketplace called Socrates. Based on a user's answers, generate a complete tool spec. Return ONLY valid JSON with these keys: {"name":"Short catchy name (max 4 words)","description":"One sentence for marketplace card (max 120 chars)","category":"One of: Writing, Coding, Study, Business, Creative, Research, Health, Finance, Fun & Games, Automation, Translation, Other","icon":"Single emoji","type":"One of: Prompt App, Agent, Chat Bot, Model Wrapper, Other","system_prompt":"Full AI system prompt (3-6 sentences, specific and practical)","input_label":"Label for the main input field","input_placeholder":"Example placeholder text"}`;

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      error: 'hosted_generate_unavailable',
      message: 'Server OpenAI not configured. Set OPENAI_API_KEY on the API, or paste your own key in Publish (browser mode).',
    });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({
      error: 'hosted_generate_unavailable',
      message: 'Server auth is not configured. Sign in with a browser key in Publish mode.',
    });
  }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) {
    return res.status(401).json({ error: 'auth_required', message: 'Sign in to use hosted tool generation.' });
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error: userError } = await sb.auth.getUser(token);
  if (userError || !user) {
    return res.status(401).json({ error: 'auth_required', message: 'Sign in again to use hosted tool generation.' });
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch {
    body = {};
  }

  const idea = body.idea != null ? String(body.idea).trim() : '';
  const audience = body.audience != null ? String(body.audience).trim() : '';
  const always = body.always != null ? String(body.always).trim() : '';
  const never = body.never != null ? String(body.never).trim() : '';
  const price = body.price != null ? String(body.price).trim() : '';

  if (!idea) {
    return res.status(400).json({ error: 'bad_request', message: 'idea is required' });
  }

  const userPrompt = `Build a tool based on:\n- Idea: ${idea}\n- Audience: ${audience}\n- Should always: ${always}\n- Should never: ${never}\n- Price: ${price}`;
  const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: openaiModel,
        max_tokens: 600,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(502).json({
        error: 'openai_error',
        message: data.error?.message || 'OpenAI request failed.',
      });
    }

    let raw = (data.choices?.[0]?.message?.content || '').trim().replace(/```json|```/g, '').trim();
    if (!raw) {
      return res.status(502).json({ error: 'empty_response', message: 'No content from OpenAI.' });
    }

    let spec;
    try {
      spec = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: 'parse_error', message: 'Model did not return valid JSON.' });
    }

    return res.status(200).json({ spec, model: openaiModel, via: 'hosted' });
  } catch (e) {
    return res.status(502).json({ error: 'upstream', message: e.message || 'OpenAI request failed.' });
  }
};
