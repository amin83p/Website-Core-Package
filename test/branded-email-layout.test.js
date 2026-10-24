'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBrandedEmailLayout,
  buildEmailButton,
  NC_EMAIL_CLASSES,
  escapeHtml
} = require('../MVC/utils/brandedEmailLayout');

test('buildBrandedEmailLayout includes responsive shell markers', () => {
  const html = buildBrandedEmailLayout({
    eyebrow: 'Test',
    title: 'Hello',
    bodyHtml: '<p>Body</p>',
    preheader: 'Preview line'
  });
  assert.match(html, /<!DOCTYPE html>/i);
  assert.match(html, /viewport/);
  assert.match(html, /<style type="text\/css">/);
  assert.match(html, /@media screen and \(max-width:600px\)/);
  assert.match(html, /max-width:720px/);
  assert.match(html, /bgcolor="#1d5fb8"/i);
  assert.match(html, /width="720"/);
  assert.ok(html.includes(NC_EMAIL_CLASSES.container));
  assert.ok(html.includes(NC_EMAIL_CLASSES.preheader));
  assert.match(html, /Preview line/);
});

test('buildEmailButton escapes href and label', () => {
  const html = buildEmailButton('https://example.com/path?q=1&x=2', 'Open <session>');
  assert.match(html, /href="https:\/\/example\.com\/path\?q=1&amp;x=2"/);
  assert.match(html, /Open &lt;session&gt;/);
  assert.ok(html.includes(NC_EMAIL_CLASSES.button));
  assert.match(html, /bgcolor="#1d5fb8"/i);
  assert.equal(buildEmailButton('', 'Go'), '');
});

test('escapeHtml neutralizes markup', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
});
