const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const publishPage = fs.readFileSync(path.resolve(__dirname, '../socrates/publish.html'), 'utf8');

test('publish paths throw on Supabase insert errors instead of showing false success', () => {
  const insertCalls = publishPage.match(/await insertToolOrThrow\(sb,/g) || [];
  assert.equal(insertCalls.length, 3);
  assert.doesNotMatch(publishPage, /sb\.from\('tools'\)\.insert/);
  assert.doesNotMatch(publishPage, /catch\(e\)\s*\{\s*\/\*\s*silent\s*\*\/\s*\}/i);
  assert.match(publishPage, /Could not publish this tool\. Nothing was saved\./);
});
