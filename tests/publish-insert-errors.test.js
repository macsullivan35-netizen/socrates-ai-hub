const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('publish flows do not show success after failed Supabase inserts', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'socrates', 'publish.html'), 'utf8');
  const totalInserts = html.match(/sb\.from\('tools'\)\.insert/g) || [];
  const checkedInserts = html.match(/const \{ error: insertErr \} = await sb\.from\('tools'\)\.insert/g) || [];
  const throwChecks = html.match(/if \(insertErr\) throw insertErr/g) || [];

  assert.equal(totalInserts.length, 3);
  assert.equal(checkedInserts.length, 3);
  assert.equal(throwChecks.length, 3);
  assert.doesNotMatch(html, /catch\(e\)\{\s*\/\*\s*silent\s*\*\/\s*\}/);
  assert.doesNotMatch(html, /catch\(e\)\{\s*\/\*silent\*\/\s*\}/);
});
