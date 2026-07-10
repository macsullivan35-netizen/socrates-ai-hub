const { createClient } = require('@supabase/supabase-js');

function bearerToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

async function requireSupabaseUser(req) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, status: 500, error: 'config', message: 'Supabase service credentials are not configured.' };
  }

  const token = bearerToken(req);
  if (!token) {
    return { ok: false, status: 401, error: 'auth', message: 'Sign in and try again.' };
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user } = {}, error } = await sb.auth.getUser(token);
  if (error || !user) {
    return { ok: false, status: 401, error: 'auth', message: 'Invalid session. Sign in again.' };
  }

  return { ok: true, user, sb };
}

module.exports = { bearerToken, requireSupabaseUser };
