const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const marketplaceHtml = fs.readFileSync(path.join(__dirname, '..', 'socrates', 'marketplace.html'), 'utf8');

test('marketplace public Supabase query does not request private system prompts', () => {
  assert.doesNotMatch(marketplaceHtml, /\.select\('\*[,']?/);
  assert.doesNotMatch(marketplaceHtml, /sys:\s*t\.system_prompt/);
  assert.match(marketplaceHtml, /const publicToolColumns = '[^']*profiles\(username,display_name\)'/);
  const publicColumns = marketplaceHtml.match(/const publicToolColumns = '([^']+)'/)?.[1] || '';
  assert.ok(publicColumns);
  assert.equal(publicColumns.includes('system_prompt'), false);
});

test('hosted paid runs send server-verifiable checkout proof', () => {
  assert.match(marketplaceHtml, /checkoutSessionId:\s*currentTool\.paid \? paidSessionForTool\(currentTool\.id\) : ''/);
});

test('dynamic tool fields render through escaping helper', () => {
  assert.match(marketplaceHtml, /function renderToolFieldHtml\(f\)/);
  assert.match(marketplaceHtml, /const label = escapeHtml\(f\.label \|\| ''\)/);
  assert.match(marketplaceHtml, /const placeholder = escapeHtml\(f\.placeholder \|\| ''\)/);
  assert.match(marketplaceHtml, /fieldsEl\.innerHTML = currentTool\.fields\.map\(renderToolFieldHtml\)\.join\(''\)/);
});
