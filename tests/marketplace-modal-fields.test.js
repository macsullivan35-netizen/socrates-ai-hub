const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.textContent = '';
    this.id = '';
    this.type = '';
    this.placeholder = '';
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
  }

  get innerHTML() {
    return this.children.map((child) => child.outerHTML).join('');
  }

  get outerHTML() {
    const attrs = [];
    if (this.id) attrs.push(`id="${escapeHtml(this.id)}"`);
    if (this.type) attrs.push(`type="${escapeHtml(this.type)}"`);
    if (this.placeholder) attrs.push(`placeholder="${escapeHtml(this.placeholder)}"`);
    const attrText = attrs.length ? ` ${attrs.join(' ')}` : '';
    return `<${this.tagName}${attrText}>${escapeHtml(this.textContent)}${this.innerHTML}</${this.tagName}>`;
  }
}

function loadRenderModalFields() {
  const marketplacePath = path.join(__dirname, '..', 'socrates', 'marketplace.html');
  const html = fs.readFileSync(marketplacePath, 'utf8');
  const start = html.indexOf('function renderModalFields(fields) {');
  assert.notEqual(start, -1, 'renderModalFields function should exist');
  const end = html.indexOf('\n\nfunction openTool', start);
  assert.notEqual(end, -1, 'renderModalFields should appear before openTool');

  const modalFields = new FakeElement('div');
  const context = {
    document: {
      getElementById(id) {
        assert.equal(id, 'modalFields');
        return modalFields;
      },
      createElement(tagName) {
        return new FakeElement(tagName);
      },
    },
  };
  const renderModalFields = vm.runInNewContext(`${html.slice(start, end)}; renderModalFields`, context);
  return { renderModalFields, modalFields };
}

test('renderModalFields treats schema text as text, not executable HTML', () => {
  const { renderModalFields, modalFields } = loadRenderModalFields();
  const payload = '</label><img src=x onerror="globalThis.__xss=1">';

  renderModalFields([
    { id: 'malicious_textarea', type: 'textarea', label: payload, placeholder: payload },
    { id: 'malicious_select', type: 'select', label: 'Choose', options: [payload] },
  ]);

  assert.equal(modalFields.children.length, 4);
  assert.equal(modalFields.children[0].tagName, 'label');
  assert.equal(modalFields.children[0].textContent, payload);
  assert.equal(modalFields.children[1].tagName, 'textarea');
  assert.equal(modalFields.children[1].placeholder, payload);
  assert.equal(modalFields.children[3].children[0].tagName, 'option');
  assert.equal(modalFields.children[3].children[0].textContent, payload);
  assert.doesNotMatch(modalFields.innerHTML, /<img\b/i);
  assert.match(modalFields.innerHTML, /&lt;img src=x/);
});
