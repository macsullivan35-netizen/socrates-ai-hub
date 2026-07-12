const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('marketplace public query does not expose system prompts', () => {
  const html = read('socrates/marketplace.html');
  const columns = html.match(/const publicToolColumns = \[([\s\S]*?)\]\.join\(','\);/);

  assert.ok(columns, 'marketplace should use an explicit public column allowlist');
  assert.doesNotMatch(columns[1], /system_prompt/);
  assert.doesNotMatch(html, /\.select\('\*,\s*profiles/);
  assert.doesNotMatch(html, /sys:\s*t\.system_prompt/);
});

test('paid hosted tool runs require exact paid checkout proof', () => {
  const api = read('api/run-tool.js');
  const html = read('socrates/marketplace.html');

  assert.match(api, /verifyPaidCheckoutSession/);
  assert.match(api, /checkoutSessionId/);
  assert.match(api, /session\.metadata\?\.tool_id/);
  assert.match(api, /String\(paidToolId\)\s*!==\s*String\(toolId\)/);
  assert.match(api, /priceNum\s*>\s*0/);
  assert.match(html, /checkoutSessionId:\s*paidToolCheckoutSession\(currentTool\.id\)/);
});

test('builder-controlled run fields are escaped before modal rendering', () => {
  const html = read('socrates/marketplace.html');

  assert.match(html, /function renderToolFieldHtml\(f\)/);
  assert.match(html, /const label = escapeHtml\(f\.label \|\| 'Your input'\)/);
  assert.match(html, /const placeholder = escapeHtml\(f\.placeholder \|\| ''\)/);
  assert.match(html, /options\.map\(o => `<option>\$\{escapeHtml\(o\)\}<\/option>`\)/);
  assert.doesNotMatch(html, /<label>\$\{f\.label\}<\/label>/);
});

test('hosted generation and stats require authenticated Supabase users', () => {
  const publishGenerate = read('api/publish-generate.js');
  const stats = read('api/stats.js');

  assert.match(publishGenerate, /getBearerToken\(req\)/);
  assert.match(publishGenerate, /auth_required/);
  assert.match(publishGenerate, /sb\.auth\.getUser\(token\)/);

  assert.match(stats, /getBearerToken\(req\)/);
  assert.match(stats, /sb\.auth\.getUser\(token\)/);
  assert.match(stats, /creator_id/);
  assert.doesNotMatch(stats, /stripe\.customers\.list/);
});
