const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('marketplace run modal escapes published custom field metadata', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'socrates', 'marketplace.html'), 'utf8');
  const start = html.indexOf('fieldsEl.innerHTML = currentTool.fields.map');
  const end = html.indexOf("  }).join('');", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const renderer = html.slice(start, end);
  assert.match(renderer, /const label = escapeHtml\(f\.label\)/);
  assert.match(renderer, /const placeholder = escapeHtml\(f\.placeholder \|\| ''\)/);
  assert.match(renderer, /<option>\$\{escapeHtml\(o\)\}<\/option>/);
  assert.doesNotMatch(renderer, /<label>\$\{f\.label\}<\/label>/);
  assert.doesNotMatch(renderer, /placeholder="\$\{f\.placeholder \|\| ''\}"/);
  assert.doesNotMatch(renderer, /<option>\$\{o\}<\/option>/);
});
