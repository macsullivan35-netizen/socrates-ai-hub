const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const marketplaceHtml = fs.readFileSync(path.join(__dirname, '..', 'socrates', 'marketplace.html'), 'utf8');

function loadRunFieldHelpers() {
  const start = marketplaceHtml.indexOf('function escapeHtml');
  const end = marketplaceHtml.indexOf('function normalizeListingExtras', start);
  assert.notEqual(start, -1, 'escapeHtml helper not found');
  assert.notEqual(end, -1, 'normalizeListingExtras marker not found');
  const helperSource = marketplaceHtml.slice(start, end);
  return vm.runInNewContext(`${helperSource}; ({ escapeHtml, runFieldDomId, normalizedRunField, runFieldHtml });`);
}

test('marketplace run fields escape builder-controlled schema HTML', () => {
  const { runFieldHtml } = loadRunFieldHelpers();
  const rendered = runFieldHtml({
    id: 'tone "><img src=x onerror=alert(1)>',
    label: '<img src=x onerror=alert(1)> Tone',
    type: 'select',
    options: ['Friendly', '"><svg onload=alert(1)>'],
  }, 0);

  assert.match(rendered, /&lt;img src=x onerror=alert\(1\)&gt; Tone/);
  assert.match(rendered, /&quot;&gt;&lt;svg onload=alert\(1\)&gt;/);
  assert.doesNotMatch(rendered, /<img\b/i);
  assert.doesNotMatch(rendered, /<svg\b/i);
  assert.doesNotMatch(rendered, /id="tone "/);
});

test('marketplace run input collection can use normalized field IDs', () => {
  const { normalizedRunField, runFieldHtml } = loadRunFieldHelpers();
  const field = {
    id: 'bad id "><script>alert(1)</script>',
    label: 'Prompt',
    type: 'textarea',
    placeholder: '" autofocus onfocus=alert(1)',
  };

  const normalized = normalizedRunField(field, 2);
  const rendered = runFieldHtml(field, 2);

  assert.equal(normalized.id, 'bad_id_scriptalert1script');
  assert.match(rendered, /id="bad_id_scriptalert1script"/);
  assert.match(rendered, /placeholder="&quot; autofocus onfocus=alert\(1\)"/);
  assert.doesNotMatch(rendered, /<script\b/i);
});
