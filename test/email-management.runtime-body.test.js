const test = require('node:test');
const assert = require('node:assert/strict');

const emailManagementService = require('../MVC/services/emailManagementService');
const { buildRuntimeBodyOutputs, normalizeHtmlTemplateBody } = emailManagementService.__testables;

test('buildRuntimeBodyOutputs treats real HTML as html with plain text alternative', () => {
  const out = buildRuntimeBodyOutputs('<div><strong>Code</strong> {{RESET_CODE}}</div>');
  assert.equal(out.html, '<div><strong>Code</strong> {{RESET_CODE}}</div>');
  assert.equal(out.text, 'Code {{RESET_CODE}}');
  assert.doesNotMatch(out.text, /<div/i);
});

test('buildRuntimeBodyOutputs decodes entity-encoded HTML templates', () => {
  const encoded = '&lt;div style=&quot;font-family:Arial&quot;&gt;Hello {{RESET_CODE}}&lt;/div&gt;';
  const out = buildRuntimeBodyOutputs(encoded);
  assert.match(out.html, /^<div style="font-family:Arial">/);
  assert.equal(out.text, 'Hello {{RESET_CODE}}');
  assert.doesNotMatch(out.text, /&lt;|&gt;|<div/i);
});

test('normalizeHtmlTemplateBody leaves plain text unchanged', () => {
  const plain = 'Your code is {{RESET_CODE}}.';
  assert.equal(normalizeHtmlTemplateBody(plain), plain);
});
