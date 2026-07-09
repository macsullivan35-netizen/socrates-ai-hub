const { createClient } = require('@supabase/supabase-js');

function cors(res, methods = 'GET, POST, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      resolve(req.body);
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function platformFeeAmount(totalCents, feePercent) {
  const p = Math.min(90, Math.max(0, Number(feePercent) || 20));
  return Math.round((totalCents * p) / 100);
}

function bearerToken(req) {
  const auth = req.headers?.authorization || req.headers?.Authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

function serviceSupabaseClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function requireSupabaseUser(req, res) {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'auth', message: 'Sign in and try again.' });
    return null;
  }

  const sb = serviceSupabaseClient();
  if (!sb) {
    res.status(500).json({ error: 'config', message: 'Supabase service credentials missing.' });
    return null;
  }

  const { data: { user } = {}, error } = await sb.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: 'auth', message: 'Invalid session. Sign in again.' });
    return null;
  }

  return { user, sb };
}

module.exports = {
  bearerToken,
  cors,
  parseJsonBody,
  platformFeeAmount,
  requireSupabaseUser,
  serviceSupabaseClient,
};
