const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

let mockUser;
let openAiFetchCalls;

const originalLoad = Module._load;
const originalFetch = global.fetch;
const envKeys = ['OPENAI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

Module._load = function mockedLoad(request, parent, isMain) {
  if (request === '@supabase/supabase-js') {
    return {
      createClient() {
        return {
          auth: {
            async getUser(token) {
              return token === 'valid-token'
                ? { data: { user: mockUser }, error: null }
                : { data: { user: null }, error: new Error('invalid token') };
            },
          },
        };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const publishGenerate = require('../api/publish-generate.js');
const publishHtml = fs.readFileSync(path.join(__dirname, '..', 'socrates', 'publish.html'), 'utf8');

function makeReq(body, authorization) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.headers = authorization ? { authorization } : {};
  req.body = body;
  return req;
}

function makeRes() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    setHeader(key, value) {
      this.headers[key] = value;
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
      this.ended = true;
      return this;
    },
  };
}

async function invokePublishGenerate(body, authorization) {
  const res = makeRes();
  await publishGenerate(makeReq(body, authorization), res);
  return res;
}

test.beforeEach(() => {
  mockUser = { id: 'user-1', email: 'builder@example.com' };
  openAiFetchCalls = [];
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  global.fetch = async (url, options) => {
    openAiFetchCalls.push({ url, options });
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  name: 'Test Tool',
                  description: 'A generated test tool',
                  category: 'Coding',
                  icon: 'T',
                  type: 'Prompt App',
                  system_prompt: 'Be useful.',
                  input_label: 'Input',
                  input_placeholder: 'Paste text',
                }),
              },
            },
          ],
        };
      },
    };
  };
});

test.after(() => {
  Module._load = originalLoad;
  global.fetch = originalFetch;
  for (const key of envKeys) {
    if (originalEnv[key] == null) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

test('hosted publish generation rejects anonymous requests before OpenAI', async () => {
  const res = await invokePublishGenerate({ idea: 'Make a tool' });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'auth');
  assert.equal(openAiFetchCalls.length, 0);
});

test('hosted publish generation allows signed-in builders', async () => {
  const res = await invokePublishGenerate({ idea: 'Make a tool' }, 'Bearer valid-token');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.spec.name, 'Test Tool');
  assert.equal(openAiFetchCalls.length, 1);
});

test('publish page sends Supabase bearer token to hosted generator', () => {
  assert.match(publishHtml, /async function hostedPublishAuthHeaders\(\)/);
  assert.match(publishHtml, /Authorization: 'Bearer ' \+ session\.access_token/);
  assert.match(publishHtml, /headers: hostedHeaders/);
});
