const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RETIRED_MODEL = 'claude-3-5-haiku-20241022';
const ACTIVE_MODEL = 'claude-haiku-4-5-20251001';

test('hosted Claude runs default to an active Anthropic model', () => {
  const src = fs.readFileSync(path.join(__dirname, '../api/run-tool.js'), 'utf8');
  const match = src.match(/process\.env\.ANTHROPIC_MODEL\s*\|\|\s*'([^']+)'/);
  assert.ok(match, 'ANTHROPIC_MODEL default assignment missing');
  assert.equal(match[1], ACTIVE_MODEL);
  assert.notEqual(match[1], RETIRED_MODEL);
});
