import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../socrates/marketplace.html', import.meta.url), 'utf8');
const start = html.indexOf('function renderModalFields');
const end = html.indexOf('\nfunction closeModal', start);

assert.notEqual(start, -1, 'renderModalFields should exist');
assert.notEqual(end, -1, 'renderModalFields should appear before closeModal');
assert.equal(
  html.includes('fieldsEl.innerHTML = currentTool.fields'),
  false,
  'modal field rendering must not parse published schema as HTML',
);

function escapeText(value) {
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
    this.attributes = {};
    this._textContent = '';
  }

  set textContent(value) {
    this._textContent = value == null ? '' : String(value);
    this.children = [];
  }

  get textContent() {
    return this._textContent + this.children.map(child => child.textContent).join('');
  }

  set id(value) {
    this.attributes.id = value == null ? '' : String(value);
  }

  get id() {
    return this.attributes.id || '';
  }

  set type(value) {
    this.attributes.type = value == null ? '' : String(value);
  }

  get type() {
    return this.attributes.type || '';
  }

  set placeholder(value) {
    this.attributes.placeholder = value == null ? '' : String(value);
  }

  get placeholder() {
    return this.attributes.placeholder || '';
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
    this._textContent = '';
  }

  get innerHTML() {
    const attrs = Object.entries(this.attributes)
      .map(([key, value]) => ` ${key}="${escapeText(value)}"`)
      .join('');
    const body = escapeText(this._textContent) + this.children.map(child => child.innerHTML).join('');
    return `<${this.tagName}${attrs}>${body}</${this.tagName}>`;
  }
}

const context = {
  document: {
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  },
};

vm.runInNewContext(html.slice(start, end), context);

const root = new FakeElement('div');
const xss = '<img src=x onerror="globalThis.__xss = true">';
context.renderModalFields(root, [
  { id: 'topic', label: xss, type: 'textarea', placeholder: xss },
  { id: 'choice', label: 'Pick one', type: 'select', options: [xss] },
]);

assert.equal(root.children[0].tagName, 'label');
assert.equal(root.children[0].textContent, xss);
assert.equal(root.children[1].tagName, 'textarea');
assert.equal(root.children[1].placeholder, xss);
assert.equal(root.children[3].tagName, 'select');
assert.equal(root.children[3].children[0].tagName, 'option');
assert.equal(root.children[3].children[0].textContent, xss);
assert.match(root.innerHTML, /&lt;img src=x onerror=&quot;globalThis\.__xss = true&quot;&gt;/);
assert.doesNotMatch(root.innerHTML, /<img src=x onerror=/);
