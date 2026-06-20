const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const marketplaceHtml = readFileSync(path.join(__dirname, '../socrates/marketplace.html'), 'utf8');
const supabaseClientJs = readFileSync(path.join(__dirname, '../socrates/js/supabase-client.js'), 'utf8');

test('marketplace public listing query does not select system prompts', () => {
  const columnsMatch = marketplaceHtml.match(/const publicToolColumns = '([^']+)'/);
  assert.ok(columnsMatch, 'marketplace should use an explicit public column allowlist');
  assert.doesNotMatch(columnsMatch[1], /system_prompt/);
  assert.doesNotMatch(marketplaceHtml, /\.select\('\*[^']*profiles/);
  assert.match(marketplaceHtml, /sys: ''/);
  assert.doesNotMatch(marketplaceHtml, /sys: t\.system_prompt/);
});

test('shared public listing helper does not select system prompts', () => {
  const publicHelper = supabaseClientJs.match(/export async function getPublishedTools[\s\S]*?export async function getMyTools/);
  assert.ok(publicHelper, 'getPublishedTools helper should be present');
  assert.doesNotMatch(publicHelper[0], /\.select\('\*/);
  assert.doesNotMatch(publicHelper[0], /system_prompt/);
});

test('custom marketplace run fields are escaped before innerHTML insertion', () => {
  assert.match(marketplaceHtml, /function renderToolFieldHtml\(f\)/);
  assert.match(marketplaceHtml, /currentTool\.fields\.map\(renderToolFieldHtml\)/);
  assert.match(marketplaceHtml, /options\.map\(o => `<option>\$\{escapeHtml\(o\)\}<\/option>`\)/);
  assert.doesNotMatch(marketplaceHtml, /<label>\$\{f\.label\}<\/label>/);
  assert.doesNotMatch(marketplaceHtml, /placeholder="\$\{f\.placeholder \|\| ''\}"/);
});

test('paid hosted runs send the checkout session for server verification', () => {
  assert.match(marketplaceHtml, /function paidToolCheckoutSession\(toolId\)/);
  assert.match(marketplaceHtml, /checkoutSessionId: currentTool\.paid \? paidToolCheckoutSession\(currentTool\.id\) : undefined/);
  assert.match(marketplaceHtml, /r\.status === 402 && currentTool\.paid/);
});
