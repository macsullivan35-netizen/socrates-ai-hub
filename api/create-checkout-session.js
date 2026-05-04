// POST { toolId } — Stripe Checkout with Connect: seller gets (100-fee)%, platform gets fee% (default 20/80).
// Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PUBLIC_SITE_URL (e.g. https://x.vercel.app/socrates)

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const { cors, parseJsonBody, platformFeeAmount } = require('../server-lib/payments-util.js');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const feePct = Number(process.env.PLATFORM_FEE_PERCENT || 20);
  const siteBase = (process.env.PUBLIC_SITE_URL || '').replace(/\/$/, '');
  if (!siteBase) {
    return res.status(500).json({ error: 'config', message: 'Set PUBLIC_SITE_URL on Vercel (e.g. https://your-deployment.vercel.app/socrates)' });
  }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'config', message: 'Missing STRIPE_SECRET_KEY or Supabase service env vars.' });
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  let body;
  try {
    body = await parseJsonBody(req);
  } catch {
    body = {};
  }
  const toolId = body.toolId != null ? String(body.toolId).trim() : '';
  if (!toolId) return res.status(400).json({ error: 'bad_request', message: 'toolId required' });

  try {
    const { data: tool, error: tErr } = await sb
      .from('tools')
      .select('id,name,price,creator_id')
      .eq('id', toolId)
      .eq('is_published', true)
      .maybeSingle();

    if (tErr || !tool) {
      return res.status(404).json({ error: 'not_found', message: 'Tool not found or not published.' });
    }

    const priceNum = Number(tool.price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      return res.status(400).json({ error: 'free_tool', message: 'This tool is free — no checkout needed.' });
    }

    const amountCents = Math.round(priceNum * 100);
    if (amountCents < 50) {
      return res.status(400).json({ error: 'amount', message: 'Price must be at least $0.50 USD.' });
    }

    if (!tool.creator_id) {
      return res.status(400).json({ error: 'no_creator', message: 'Tool has no seller on file.' });
    }

    const { data: profile, error: pErr } = await sb
      .from('profiles')
      .select('stripe_account_id, stripe_charges_enabled')
      .eq('id', tool.creator_id)
      .maybeSingle();

    if (pErr || !profile?.stripe_account_id) {
      return res.status(400).json({
        error: 'seller_not_ready',
        message: 'The builder has not connected Stripe for payouts yet. Ask them to open Settings → Payouts and finish Connect.',
      });
    }

    const acct = await stripe.accounts.retrieve(profile.stripe_account_id);
    if (!acct.charges_enabled) {
      return res.status(400).json({
        error: 'seller_not_ready',
        message: 'The builder’s Stripe account is not ready to accept charges yet.',
      });
    }

    const feeCents = platformFeeAmount(amountCents, feePct);
    if (feeCents >= amountCents) {
      return res.status(400).json({ error: 'fee', message: 'Fee configuration invalid for this amount.' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Socrates · ${tool.name}`,
              description: `Tool access — ${100 - feePct}% to builder, ${feePct}% platform fee.`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: feeCents,
        transfer_data: { destination: profile.stripe_account_id },
        metadata: { tool_id: String(tool.id), creator_id: String(tool.creator_id) },
      },
      success_url: `${siteBase}/marketplace.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteBase}/marketplace.html`,
      metadata: { tool_id: String(tool.id), creator_id: String(tool.creator_id) },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'stripe_error', message: err.message || 'Checkout failed' });
  }
};
