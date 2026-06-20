const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

function restoreEnv(originalEnv) {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value;
  }
}

async function invokePublishGenerate({ headers = {}, body = {}, user = { id: 'user-1' } }) {
  const originalLoad = Module._load;
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const fetchCalls = [];

  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === '@supabase/supabase-js') {
      return {
        createClient() {
          return {
            auth: {
              async getUser(token) {
                return token === 'valid-token'
                  ? { data: { user }, error: null }
                  : { data: { user: null }, error: new Error('invalid') };
              },
            },
          };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  name: 'Spec',
                  description: 'Generated spec',
                  category: 'Other',
                  icon: 'S',
                  type: 'Prompt App',
                  system_prompt: 'Help.',
                  input_label: 'Input',
                  input_placeholder: 'Describe it',
                }),
              },
            },
          ],
        };
      },
    };
  };

  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  delete require.cache[require.resolve('../api/publish-generate.js')];
  const handler = require('../api/publish-generate.js');
  const res = createRes();

  try {
    await handler({ method: 'POST', headers, body }, res);
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
    delete require.cache[require.resolve('../api/publish-generate.js')];
  }

  return { res, fetchCalls };
}

test('hosted publish generation requires a Supabase access token', async () => {
  const { res, fetchCalls } = await invokePublishGenerate({
    body: { idea: 'build a tutor' },
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'auth');
  assert.equal(fetchCalls.length, 0);
});

test('hosted publish generation rejects invalid Supabase tokens', async () => {
  const { res, fetchCalls } = await invokePublishGenerate({
    headers: { authorization: 'Bearer invalid-token' },
    body: { idea: 'build a tutor' },
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'auth');
  assert.equal(fetchCalls.length, 0);
});

test('hosted publish generation accepts valid sessions and caps input size', async () => {
  const longIdea = 'A'.repeat(1200);
  const { res, fetchCalls } = await invokePublishGenerate({
    headers: { authorization: 'Bearer valid-token' },
    body: { idea: longIdea },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.spec.name, 'Spec');
  assert.equal(fetchCalls.length, 1);

  const sent = JSON.parse(fetchCalls[0][1].body);
  const userPrompt = sent.messages[1].content;
  assert.match(userPrompt, new RegExp(`Idea: ${'A'.repeat(1000)}`));
  assert.doesNotMatch(userPrompt, new RegExp(`Idea: ${'A'.repeat(1001)}`));
});
