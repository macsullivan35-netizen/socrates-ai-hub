const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const marketplace = fs.readFileSync(path.resolve(__dirname, '../socrates/marketplace.html'), 'utf8');
const supabaseClient = fs.readFileSync(path.resolve(__dirname, '../socrates/js/supabase-client.js'), 'utf8');

test('published marketplace listings do not expose system prompts in public queries', () => {
  assert.doesNotMatch(marketplace, /\.select\('\*,\s*profiles/);
  assert.doesNotMatch(supabaseClient, /\.select\('\*,\s*profiles/);
  assert.doesNotMatch(marketplace, /sys:\s*t\.system_prompt/);
  assert.match(marketplace, /const listingColumns = 'id,name,type,category,description,icon,tags,input_schema,input_placeholder,listing_extras,price,runs,rating,trending,created_at,profiles\(username,display_name\)'/);
});

test('hosted paid runs send checkout proof to the server route', () => {
  assert.match(marketplace, /function paidToolCheckoutSession\(toolId\)/);
  assert.match(marketplace, /checkoutSessionId:\s*currentTool\.paid \? paidToolCheckoutSession\(currentTool\.id\) : undefined/);
});

test('dynamic marketplace run fields escape builder-controlled text', () => {
  assert.match(marketplace, /const label = escapeHtml\(f\.label \|\| 'Input'\);/);
  assert.match(marketplace, /const placeholder = escapeHtml\(f\.placeholder \|\| ''\);/);
  assert.match(marketplace, /options\.map\(o => `<option>\$\{escapeHtml\(o\)\}<\/option>`\)/);
  assert.doesNotMatch(marketplace, /<label>\$\{f\.label\}<\/label>/);
  assert.doesNotMatch(marketplace, /placeholder="\$\{f\.placeholder \|\| ''\}"/);
});
