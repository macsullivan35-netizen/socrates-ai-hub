const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const marketplaceHtml = readFileSync(path.join(__dirname, '..', 'socrates', 'marketplace.html'), 'utf8');
const publishHtml = readFileSync(path.join(__dirname, '..', 'socrates', 'publish.html'), 'utf8');

test('marketplace public listing query does not fetch paid system prompts', () => {
  assert.doesNotMatch(marketplaceHtml, /\.select\('\*, profiles\(username,display_name\)'\)/);
  assert.match(marketplaceHtml, /select\(PUBLIC_TOOL_COLUMNS\)/);

  const publicColumns = marketplaceHtml.match(/const PUBLIC_TOOL_COLUMNS = \[[\s\S]*?\]\.join\(', '\);|const PUBLIC_TOOL_COLUMNS = \[[\s\S]*?\]\.join\(','\);/);
  assert.ok(publicColumns, 'expected explicit public Supabase columns');
  assert.doesNotMatch(publicColumns[0], /system_prompt/);

  assert.match(marketplaceHtml, /\.select\('id,system_prompt'\)[\s\S]*?\.lte\('price', 0\)/);
  assert.doesNotMatch(marketplaceHtml, /sys:\s*t\.system_prompt/);
});

test('marketplace hosted paid runs send checkout state to the server', () => {
  assert.match(
    marketplaceHtml,
    /checkoutSessionId:\s*currentTool\.paid\s*\?\s*unlockedToolsMap\(\)\[String\(currentTool\.id\)\]\s*:\s*undefined/
  );
});

test('marketplace run modal escapes builder-controlled field markup', () => {
  assert.doesNotMatch(marketplaceHtml, /<label>\$\{f\.label\}<\/label>/);
  assert.doesNotMatch(marketplaceHtml, /placeholder="\$\{f\.placeholder/);
  assert.doesNotMatch(marketplaceHtml, /<option>\$\{o\}<\/option>/);
  assert.match(marketplaceHtml, /const label = escapeHtml\(f\.label \|\| ''\);/);
  assert.match(marketplaceHtml, /const placeholder = escapeHtml\(f\.placeholder \|\| ''\);/);
  assert.match(marketplaceHtml, /<option>\$\{escapeHtml\(o\)\}<\/option>/);
});

test('publish handlers do not show success after Supabase insert failures', () => {
  const insertChecks = publishHtml.match(/if \(error\) throw error;/g) || [];
  assert.equal(insertChecks.length, 3);
  assert.match(publishHtml, /function publishErrorMessage\(e\)/);
  assert.match(publishHtml, /btn\.textContent='Publish to Marketplace'; btn\.disabled=false;[\s\S]*?return;/);
  assert.match(publishHtml, /btn\.textContent='[^']*Publish listing'; btn\.disabled=false;[\s\S]*?return;/);
  assert.match(publishHtml, /btn\.textContent='[^']*Publish'; btn\.disabled=false;[\s\S]*?return;/);
  assert.doesNotMatch(publishHtml, /catch\(e\)\{\s*\/\* ?silent ?\*\/\s*\}/i);
});
