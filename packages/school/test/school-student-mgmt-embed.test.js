'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const embedService = require('../MVC/services/school/schoolStudentMgmtEmbedService');

const repoRoot = path.join(__dirname, '..', '..', '..');

test('schoolStudentMgmtEmbedService detects smEmbed query', () => {
  assert.equal(embedService.isEmbedRequest({ query: { smEmbed: '1' } }), true);
  assert.equal(embedService.isEmbedRequest({ query: {} }), false);
  assert.equal(embedService.isEmbedRequest({ query: { smEmbed: '0' } }), false);
});

test('schoolStudentMgmtEmbedService returns layout locals only when embedded', () => {
  const off = embedService.embedRenderLocals({ query: {} }, { title: 'Test' });
  assert.deepEqual(off, {});

  const on = embedService.embedRenderLocals({ query: { smEmbed: '1' } }, { htmlClass: 'foo' });
  assert.equal(on.schoolSmEmbed, true);
  assert.equal(on.pageCss, 'schoolStudentMgmtEmbed.css');
  assert.match(on.htmlClass, /foo/);
  assert.match(on.htmlClass, /school-sm-embed-iframe/);
  assert.equal(on.sectionsPageClass, 'school-sm-embed-section');
  assert.equal(on.mainClass, 'container my-0');
  assert.match(on.htmlClass, /app-page-width-full/);
});

test('embed assets and layout guard exist', () => {
  const pkgCss = path.join(__dirname, '..', 'public', 'styles', 'schoolStudentMgmtEmbed.css');
  const servedCss = path.join(repoRoot, 'public', 'styles', 'schoolStudentMgmtEmbed.css');
  assert.ok(fs.existsSync(pkgCss));
  assert.ok(fs.existsSync(servedCss));
  const layout = fs.readFileSync(path.join(repoRoot, 'MVC', 'views', 'layouts', 'layout.ejs'), 'utf8');
  assert.match(layout, /schoolSmEmbed/);
  assert.match(layout, /school-sm-embed-iframe/);
});