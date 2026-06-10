const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const marketplaceHtml = fs.readFileSync(path.join(__dirname, '../socrates/marketplace.html'), 'utf8');

test('marketplace does not load paid system prompts in the public listing query', () => {
  assert.doesNotMatch(
    marketplaceHtml,
    /\.from\('tools'\)\.select\('\*[^']*profiles/,
    'public marketplace query must not select every tools column',
  );
  assert.match(marketplaceHtml, /const listingColumns = \[/);
  assert.match(marketplaceHtml, /sys: priceNum > 0 \? '' : \(freePromptById\[String\(t\.id\)\] \|\| ''\)/);
});

test('marketplace sends verified purchase sessions for paid hosted runs', () => {
  assert.match(marketplaceHtml, /function purchaseSessionForTool\(toolId\)/);
  assert.match(
    marketplaceHtml,
    /purchaseSessionId: currentTool\.paid \? purchaseSessionForTool\(currentTool\.id\) : undefined/,
  );
});

test('marketplace escapes published input schema before rendering modal fields', () => {
  assert.match(marketplaceHtml, /const label = escapeHtml\(f\.label\)/);
  assert.match(marketplaceHtml, /const placeholder = escapeHtml\(f\.placeholder \|\| ''\)/);
  assert.match(marketplaceHtml, /\(f\.options \|\| \[\]\)\.map\(o => `<option>\$\{escapeHtml\(o\)\}<\/option>`\)/);
  assert.doesNotMatch(marketplaceHtml, /<label>\$\{f\.label\}<\/label>/);
  assert.doesNotMatch(marketplaceHtml, /placeholder="\$\{f\.placeholder \|\| ''\}"/);
});
