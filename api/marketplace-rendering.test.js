const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('marketplace escapes published input schema before injecting modal HTML', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'socrates', 'marketplace.html'), 'utf8');

  assert.match(html, /const safeLabel = escapeHtml\(f\.label\);/);
  assert.match(html, /const safePlaceholder = escapeHtml\(f\.placeholder \|\| ''\);/);
  assert.match(html, /<option>\$\{escapeHtml\(o\)\}<\/option>/);
});

test('marketplace does not load protected database system prompts in public listing query', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'socrates', 'marketplace.html'), 'utf8');

  assert.match(html, /const publicToolColumns = 'id,name,description,category,type,icon,tags,listing_extras,input_schema,input_placeholder,price,runs,rating,trending,created_at,profiles\(username,display_name\)'/);
  assert.match(html, /sys: '', real: true/);
});
