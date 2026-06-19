const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const path = require('node:path');

const marketplace = readFileSync(path.join(__dirname, '..', 'socrates', 'marketplace.html'), 'utf8');
const promptMigration = readFileSync(path.join(__dirname, '..', 'supabase', 'restrict_tool_prompt_reads.sql'), 'utf8');

test('marketplace does not publicly select every tool column', () => {
  assert.equal(marketplace.includes(".select('*"), false);
  assert.match(marketplace, /const publicColumns = \[/);
  assert.match(marketplace, /\.from\('free_tool_prompts'\)/);
  assert.match(marketplace, /sys: priceNum > 0 \? ''/);
});

test('hosted runs include the verified checkout session for paid tools', () => {
  assert.match(marketplace, /function paidToolCheckoutSession\(toolId\)/);
  assert.match(marketplace, /checkoutSessionId: currentTool\.paid \? paidToolCheckoutSession\(currentTool\.id\) : ''/);
});

test('publisher-controlled run fields are escaped before innerHTML rendering', () => {
  assert.match(marketplace, /const label = escapeHtml\(f\.label\);/);
  assert.match(marketplace, /const id = escapeHtml\(f\.id\);/);
  assert.match(marketplace, /const placeholder = escapeHtml\(f\.placeholder \|\| ''\);/);
  assert.match(marketplace, /<option>\$\{escapeHtml\(o\)\}<\/option>/);
});

test('prompt-read migration hides tools.system_prompt from public table grants', () => {
  assert.match(promptMigration, /create or replace view public\.free_tool_prompts/);
  assert.match(promptMigration, /revoke select on public\.tools from anon, authenticated/);
  assert.match(promptMigration, /column_name <> 'system_prompt'/);
});
