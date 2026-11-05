'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadHoverTipApi() {
  const src = fs.readFileSync(path.join(root, 'public/scripts/attendanceCellHoverTip.js'), 'utf8');
  const context = {
    window: {},
    document: {
      createElement() {
        return { classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {} };
      },
      body: { appendChild() {} },
      addEventListener() {},
      removeEventListener() {}
    },
    fetch: async () => ({ json: async () => ({}) })
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(src, context);
  return context.window.AttendanceCellHoverTip;
}

test('setAttendanceCellHoverTipRoot rebinds delegation root', () => {
  const api = loadHoverTipApi();
  assert.equal(typeof api.setAttendanceCellHoverTipRoot, 'function');
  const rootA = {
    listeners: {},
    addEventListener(name, fn) { this.listeners[name] = fn; },
    removeEventListener(name) { delete this.listeners[name]; }
  };
  const rootB = {
    listeners: {},
    addEventListener(name, fn) { this.listeners[name] = fn; },
    removeEventListener(name) { delete this.listeners[name]; }
  };
  api.initAttendanceCellHoverTip({
    cellSelector: '.att-cell[data-att-tip-key]',
    root: rootA,
    resolveContext: () => null
  });
  assert.ok(rootA.listeners.contextmenu);
  api.setAttendanceCellHoverTipRoot(rootB);
  assert.equal(rootA.listeners.contextmenu, undefined);
  assert.ok(rootB.listeners.contextmenu);
});
