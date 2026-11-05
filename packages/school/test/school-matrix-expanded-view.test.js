'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const repoRoot = path.join(root, '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

test('schoolMatrixExpandedView.js passes syntax check and exports API', () => {
  const scriptPath = path.join(root, 'public/scripts/schoolMatrixExpandedView.js');
  execSync(`node --check "${scriptPath}"`, { stdio: 'pipe' });
  const src = fs.readFileSync(scriptPath, 'utf8');
  assert.match(src, /bindMatrixExpandedView/);
  assert.match(src, /setMatrixExpandEnabled/);
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(src, context);
  assert.equal(typeof context.window.SchoolMatrixExpandedView.bindMatrixExpandedView, 'function');
  assert.equal(typeof context.window.SchoolMatrixExpandedView.setMatrixExpandEnabled, 'function');
});

test('school-matrix-expand.css styles modal scroll wrappers', () => {
  const css = fs.readFileSync(path.join(root, 'public/styles/school-matrix-expand.css'), 'utf8');
  assert.match(css, /school-matrix-expand-modal/);
  assert.match(css, /100dvh/);
  assert.match(css, /\.cm-matrix-wrapper/);
});

const MATRIX_PAGES = [
  {
    view: 'packages/school/MVC/views/school/attendance/attendanceViewer.ejs',
    buttonId: 'btn_attExpandMatrixView',
    inlineHostId: 'attMatrixExpandInlineHost',
    modalId: 'attMatrixExpandModal'
  },
  {
    view: 'packages/school/MVC/views/school/grades/gradesMatrix.ejs',
    buttonId: 'btn_gmExpandMatrixView',
    inlineHostId: 'gmMatrixExpandInlineHost',
    modalId: 'gmMatrixExpandModal'
  },
  {
    view: 'packages/school/MVC/views/school/report/conductMatrix.ejs',
    buttonId: 'btn_cmExpandMatrixView',
    inlineHostId: 'cmMatrixExpandInlineHost',
    modalId: 'cmMatrixExpandModal'
  }
];

test('matrix pages include expand view assets and markup', () => {
  for (const page of MATRIX_PAGES) {
    const src = read(page.view);
    assert.match(src, new RegExp(`id="${page.buttonId}"`));
    assert.match(src, new RegExp(`id="${page.inlineHostId}"`));
    assert.match(src, new RegExp(`expandModalId: '${page.modalId}'`));
    assert.match(src, /schoolMatrixExpandModal/);
    assert.match(src, /schoolMatrixExpandedView\.js/);
    assert.match(src, /school-matrix-expand\.css/);
    assert.match(src, /bi-arrows-fullscreen/);
  }
});

test('conduct matrix client wires expanded view enable with print', () => {
  const client = read('packages/school/public/scripts/conductMatrixClient.js');
  assert.match(client, /btn_cmExpandMatrixView/);
  assert.match(client, /SchoolMatrixExpandedView\.bindMatrixExpandedView/);
  assert.match(client, /SchoolMatrixExpandedView\.setMatrixExpandEnabled/);
});
