// POST { toolId, userMessage, model?: "gpt" | "claude" } — run a published tool via platform API keys (no visitor key).
// Env: OPENAI_API_KEY (required for model gpt), ANTHROPIC_API_KEY (required for model claude),
//      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (for UUID tools), optional OPENAI_MODEL (default gpt-4o-mini), ANTHROPIC_MODEL (default claude-3-5-haiku-latest)

const { createClient } = require('@supabase/supabase-js');
const { cors, parseJsonBody } = require('../server-lib/payments-util.js');
const DEMO_TOOL_PROMPTS = require('../server-lib/demo-tool-prompts.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_USER_CHARS = 16000;
const MAX_OUT_TOKENS = 1200;

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'hosted_run_unavailable',
      message: 'Hosted runs are not configured. Set OPENAI_API_KEY (and optionally ANTHROPIC_API_KEY) on the API server.',
    });
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch {
    body = {};
  }

  const toolIdRaw = body.toolId != null ? String(body.toolId).trim() : '';
  let userMessage = body.userMessage != null ? String(body.userMessage) : '';
  const modelPref = body.model === 'claude' ? 'claude' : 'gpt';

  if (!toolIdRaw) {
    return res.status(400).json({ error: 'bad_request', message: 'toolId required' });
  }

  userMessage = userMessage.trim().slice(0, MAX_USER_CHARS);
  const fallbackUser = 'Please demonstrate what this tool can do with a short, realistic sample output.';

  let systemPrompt = '';

  const asNum = Number(toolIdRaw);
  if (Number.isInteger(asNum) && asNum >= 1 && asNum <= 12) {
    systemPrompt = DEMO_TOOL_PROMPTS[asNum] || '';
  } else if (UUID_RE.test(toolIdRaw)) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({ error: 'config', message: 'Supabase service credentials missing for database tools.' });
    }
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: tool, error } = await sb
      .from('tools')
      .select('system_prompt, is_published')
      .eq('id', toolIdRaw)
      .maybeSingle();
    if (error || !tool || !tool.is_published) {
      return res.status(404).json({ error: 'not_found', message: 'Tool not found or not published.' });
    }
    systemPrompt = (tool.system_prompt || '').trim();
  }

  if (!systemPrompt) {
    return res.status(404).json({ error: 'not_found', message: 'Unknown tool or missing system prompt.' });
  }

  if (modelPref === 'claude') {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error: 'claude_unavailable',
        message: 'Claude is not configured on the server. Use GPT or set ANTHROPIC_API_KEY.',
      });
    }
    const anthropicModel = process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022';
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: anthropicModel,
          max_tokens: MAX_OUT_TOKENS,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: userMessage || fallbackUser,
            },
          ],
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(502).json({
          error: 'upstream',
          message: j.error?.message || 'Claude request failed.',
        });
      }
      const text = j.content?.[0]?.text || '';
      return res.status(200).json({ text, model: anthropicModel, via: 'hosted' });
    } catch (e) {
      return res.status(502).json({ error: 'upstream', message: e.message || 'Claude request failed.' });
    }
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      error: 'openai_unavailable',
      message: 'OpenAI is not configured on the server. Set OPENAI_API_KEY.',
    });
  }

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
        max_tokens: MAX_OUT_TOKENS,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage || fallbackUser },
        ],
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(502).json({
        error: 'upstream',
        message: j.error?.message || 'OpenAI request failed.',
      });
    }
    const text = j.choices?.[0]?.message?.content || '';
    return res.status(200).json({ text, model: openaiModel, via: 'hosted' });
  } catch (e) {
    return res.status(502).json({ error: 'upstream', message: e.message || 'OpenAI request failed.' });
  }
};
