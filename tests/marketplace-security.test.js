const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const marketplacePath = path.join(__dirname, '..', 'socrates', 'marketplace.html');
const marketplaceHtml = fs.readFileSync(marketplacePath, 'utf8');
const supabaseClientPath = path.join(__dirname, '..', 'socrates', 'js', 'supabase-client.js');
const supabaseClientJs = fs.readFileSync(supabaseClientPath, 'utf8');

function loadFieldRenderer() {
  const start = marketplaceHtml.indexOf('function escapeHtml');
  const end = marketplaceHtml.indexOf('function normalizeListingExtras');
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = {};
  vm.runInNewContext(marketplaceHtml.slice(start, end), context);
  return context.renderToolFieldHtml;
}

test('run modal field renderer escapes builder-controlled schema text', () => {
  const renderToolFieldHtml = loadFieldRenderer();
  const html = renderToolFieldHtml({
    id: 'field1',
    label: '<img src=x onerror=alert(1)>',
    type: 'select',
    placeholder: '" autofocus onfocus=alert(1)',
    options: ['Safe', '<script>alert(1)</script>'],
  });

  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img src=x/i);
  assert.doesNotMatch(html, /<script>/i);
});

test('public marketplace Supabase query does not request private system prompts', () => {
  assert.doesNotMatch(marketplaceHtml, /\.select\('\*, profiles/);
  assert.doesNotMatch(marketplaceHtml, /sys:\s*t\.system_prompt/);
  assert.match(marketplaceHtml, /const publicColumns = \[/);
  assert.doesNotMatch(marketplaceHtml, /'system_prompt'/);
  assert.doesNotMatch(supabaseClientJs, /\.select\('\*, profiles/);
  assert.doesNotMatch(supabaseClientJs, /'system_prompt'/);
});
