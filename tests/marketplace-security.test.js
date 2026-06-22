const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const marketplaceHtml = fs.readFileSync(path.join(__dirname, '../socrates/marketplace.html'), 'utf8');

test('marketplace does not publicly select or map system prompts', () => {
  assert.doesNotMatch(marketplaceHtml, /\.select\('\*, profiles/);
  const publicColumns = marketplaceHtml.match(/const publicToolColumns = '([^']+)'/);
  assert.ok(publicColumns, 'expected explicit public tool column allowlist');
  assert.doesNotMatch(publicColumns[1], /system_prompt/);
  assert.match(marketplaceHtml, /sys: '', real: true/);
});

test('marketplace escapes builder-controlled run field metadata', () => {
  assert.match(marketplaceHtml, /function renderToolFieldHtml\(f\)/);
  assert.match(marketplaceHtml, /fieldsEl\.innerHTML = currentTool\.fields\.map\(renderToolFieldHtml\)\.join\(''\);/);
  assert.doesNotMatch(marketplaceHtml, /<label>\$\{f\.label\}/);
  assert.doesNotMatch(marketplaceHtml, /placeholder="\$\{f\.placeholder/);
});

test('hosted paid runs send the verified checkout session to the API', () => {
  assert.match(marketplaceHtml, /function paidToolSessionId\(toolId\)/);
  assert.match(marketplaceHtml, /checkoutSessionId: currentTool\.paid \? paidToolSessionId\(currentTool\.id\) : undefined/);
});
