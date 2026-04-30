// Socrates — Supabase client (shared across all pages)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPABASE_URL = 'https://bbhgmblfgiwdyubdqxxp.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_bFawbUrZj_WMJs_vHrMiEQ_IfVryGkM';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── AUTH HELPERS ──

export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getProfile(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return data;
}

export async function signUp(email, password) {
  return await supabase.auth.signUp({ email, password });
}

export async function signIn(email, password) {
  return await supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return await supabase.auth.signOut();
}

// ── TOOLS HELPERS ──

export async function getPublishedTools(category = null) {
  let query = supabase
    .from('tools')
    .select('*, profiles(username, display_name)')
    .eq('is_published', true)
    .order('runs', { ascending: false });

  if (category && category !== 'all') {
    query = query.eq('category', category);
  }

  const { data, error } = await query;
  return { data, error };
}

export async function getMyTools(userId) {
  const { data, error } = await supabase
    .from('tools')
    .select('*')
    .eq('creator_id', userId)
    .order('created_at', { ascending: false });
  return { data, error };
}

export async function createTool(toolData) {
  const { data, error } = await supabase
    .from('tools')
    .insert([toolData])
    .select()
    .single();
  return { data, error };
}

export async function updateTool(id, updates) {
  const { data, error } = await supabase
    .from('tools')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  return { data, error };
}

export async function incrementRuns(toolId) {
  await supabase.rpc('increment_runs', { tool_id: toolId });
}

// ── AI RUNNER ──
// Calls OpenAI directly from the browser using the user's own API key
// Key is stored in their profile (encrypted at rest by Supabase)

export async function runTool(tool, userInput, apiKey) {
  if (!apiKey) throw new Error('No API key. Add your OpenAI key in Settings.');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: tool.system_prompt },
        { role: 'user', content: userInput }
      ],
      max_tokens: 2000,
      temperature: 0.7
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'OpenAI API error');
  }

  const json = await res.json();
  return json.choices[0].message.content;
}
