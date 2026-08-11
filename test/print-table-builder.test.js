'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function createClassList(className = '') {
  const classes = new Set(String(className).split(/\s+/).filter(Boolean));
  const api = {
    contains: (name) => classes.has(name),
    add: (name) => classes.add(name),
    remove: (name) => classes.delete(name),
    [Symbol.iterator]: () => classes[Symbol.iterator]()
  };
  return api;
}

function serializeNode(node) {
  if (!node) return '';
  const tag = String(node.tagName || '').toLowerCase();
  if (!tag) return escapeText(node.textContent || '');
  const classAttr = [...node.classList].length ? ` class="${[...node.classList].join(' ')}"` : '';
  const inner = (node.children || []).map(serializeNode).join('') || escapeText(node.textContent || '');
  return `<${tag}${classAttr}>${inner}</${tag}>`;
}

function escapeText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function createElement(tag, options = {}) {
  const children = [];
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    style: options.style ? { ...options.style } : {},
    classList: createClassList(options.className || ''),
    dataset: { ...(options.dataset || {}) },
    textContent: options.textContent || '',
    innerText: options.innerText ?? options.textContent ?? '',
    get innerHTML() {
      return (children || []).map(serializeNode).join('');
    },
    set innerHTML(value) {
      children.length = 0;
      void value;
    },
    children,
    appendChild(child) {
      children.push(child);
      child.parentNode = el;
      return child;
    },
    remove() {
      if (!el.parentNode) return;
      const siblings = el.parentNode.children;
      const index = siblings.indexOf(el);
      if (index >= 0) siblings.splice(index, 1);
      el.parentNode = null;
    },
    querySelectorAll(selector) {
      const results = [];
      const selectors = String(selector || '').split(',').map((part) => part.trim()).filter(Boolean);
      const walk = (node) => {
        (node.children || []).forEach((child) => {
          if (selectors.some((part) => matchesSelector(child, part))) results.push(child);
          walk(child);
        });
      };
      walk(el);
      return results;
    },
    cloneNode() {
      const clone = createElement(tag.toLowerCase(), {
        style: { ...el.style },
        className: [...el.classList].join(' '),
        dataset: { ...el.dataset },
        textContent: el.textContent,
        innerText: el.innerText
      });
      el.children.forEach((child) => {
        clone.appendChild(child.cloneNode());
      });
      return clone;
    }
  };
  (options.children || []).forEach((child) => el.appendChild(child));
  return el;
}

function matchesSelector(node, selector) {
  const parts = String(selector || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return false;

  function matchesSingle(target, token) {
    if (token === 'button') return target.tagName === 'BUTTON';
    if (token.startsWith('.')) return target.classList?.contains(token.slice(1));
    return target.tagName === token.toUpperCase();
  }

  function matchPath(target, tokens) {
    if (!tokens.length) return true;
    const last = tokens[tokens.length - 1];
    if (!matchesSingle(target, last)) return false;
    if (tokens.length === 1) return true;
    let parent = target.parentNode;
    const ancestors = tokens.slice(0, -1).reverse();
    for (const token of ancestors) {
      while (parent && !matchesSingle(parent, token)) parent = parent.parentNode;
      if (!parent) return false;
      parent = parent.parentNode;
    }
    return true;
  }

  return matchPath(node, parts);
}

const builder = require('../public/scripts/printDocumentBuilder.js');
const printTableCss = read('public/styles/print-table.css');
builder.setPrintTableCss(printTableCss);

test('buildTablePrintDocument includes identity header, table content, and preview actions', () => {
  const html = builder.buildTablePrintDocument({
    title: 'Rolling Enrollment',
    printTitleHtml: '<h1>Rolling Enrollment</h1>',
    orgName: 'Equilibrium School',
    logoUrl: '/uploads/GLOBAL/logo/Logo1.png',
    requestedByLabel: 'Amin Paknejad (ROOT_001)',
    summary: 'Enrollment group: current',
    headerNote: 'Internal use only',
    includeHeaderNote: true,
    tableHtml: '<table class="print-table"><tbody><tr><td>Row</td></tr></tbody></table>',
    orientation: 'landscape',
    density: 'compact',
    css: printTableCss,
    sourcePath: '/school/classes/CLS_1/rolling-enrollment'
  });

  assert.match(html, /Equilibrium School/);
  assert.match(html, /Rolling Enrollment/);
  assert.match(html, /Enrollment group: current/);
  assert.match(html, /Internal use only/);
  assert.match(html, /Requested by:/);
  assert.match(html, /print-logo/);
  assert.match(html, /class="screen-actions no-print"/);
  assert.match(html, /data-print-orientation="landscape"/);
  assert.match(html, /data-print-orientation="portrait"/);
  assert.match(html, /id="print-page-orientation-css"/);
  assert.match(html, /screen-actions-hint/);
  assert.match(html, /onclick="window\.print\(\)"/);
  assert.match(html, /applyPrintOrientation/);
  assert.doesNotMatch(html, /letter/);
  assert.match(html, /print-density-compact/);
});

test('buildTablePrintDocument uses portrait orientation in preview toolbar', () => {
  const html = builder.buildTablePrintDocument({
    title: 'Portrait Report',
    tableHtml: '<table class="print-table"><tbody><tr><td>Row</td></tr></tbody></table>',
    orientation: 'portrait',
    css: printTableCss
  });

  assert.match(html, /data-print-orientation="portrait"/);
  assert.match(html, /applyPrintOrientation\("portrait"\)/);
  assert.doesNotMatch(html, /letter/);
});

test('buildPageCss omits letter keyword', () => {
  assert.equal(builder.buildPageCss('landscape'), '@page { margin: 10mm; size: landscape; }');
  assert.equal(builder.buildPageCss('portrait'), '@page { margin: 10mm; size: portrait; }');
});

test('buildTableHtmlFromElement skips actions column and prefers data-print-value', () => {
  const table = createElement('table', {
    children: [
      createElement('thead', {
        children: [
          createElement('tr', {
            children: [
              createElement('th', { textContent: 'Name' }),
              createElement('th', { textContent: 'Actions' })
            ]
          })
        ]
      }),
      createElement('tbody', {
        children: [
          createElement('tr', {
            children: [
              createElement('td', {
                dataset: { printValue: 'Alpha Student' },
                innerHTML: 'Alpha <span class="x-small">ID</span>'
              }),
              createElement('td', {
                className: 'table-actions',
                innerHTML: '<button type="button">Edit</button>'
              })
            ]
          })
        ]
      })
    ]
  });

  const tableHtml = builder.buildTableHtmlFromElement(table);

  assert.match(tableHtml, /<th[^>]*>Name<\/th>/);
  assert.doesNotMatch(tableHtml, /Actions/);
  assert.match(tableHtml, /Alpha Student/);
  assert.doesNotMatch(tableHtml, /<button/);
});

test('extractPrintableCellHtml strips buttons but keeps badge markup', () => {
  const cell = createElement('td', {
    children: [
      createElement('span', { className: 'badge bg-success', textContent: 'Active' }),
      createElement('button', { textContent: 'Edit' }),
      createElement('div', { className: 'x-small', textContent: 'STU001' })
    ]
  });
  const html = builder.extractPrintableCellHtml(cell);
  assert.match(html, /badge bg-success/);
  assert.match(html, /STU001/);
  assert.doesNotMatch(html, /button/);
});

test('buildFilterSummaryFromLocation summarizes active query params', () => {
  const summary = builder.buildFilterSummaryFromLocation('?enrollmentGroup=current&status=open&q=maria');
  assert.match(summary, /Enrollment group: current/);
  assert.match(summary, /Status: open/);
  assert.match(summary, /Search: maria/);
});

test('layout and print.js load shared print manager between builder and print script', () => {
  const layout = read('MVC/views/layouts/layout.ejs');
  const printJs = read('public/scripts/print.js');
  assert.match(layout, /printDocumentBuilder\.js/);
  assert.match(layout, /appPrintManager\.js/);
  assert.match(layout, /print\.js/);
  const builderIndex = layout.indexOf('printDocumentBuilder.js');
  const managerIndex = layout.indexOf('appPrintManager.js');
  const printIndex = layout.indexOf('print.js');
  assert.ok(builderIndex >= 0 && managerIndex > builderIndex && printIndex > managerIndex);
  assert.match(layout, /includePrintManager/);
  assert.match(printJs, /PrintDocumentBuilder/);
  assert.match(printJs, /AppPrintManager\.openSettings/);
  assert.match(printJs, /buildPrintPlaceholderHtml/);
  assert.doesNotMatch(printJs, /printWindow\.close\(\)/);
});

test('print settings modal is shared outside tablePages-start', () => {
  const partial = read('MVC/views/partials/tablePages-start.ejs');
  const modal = read('MVC/views/partials/printSettingsModal.ejs');
  assert.match(partial, /id="printBrandLogoRef"/);
  assert.match(partial, /printLogoUrl/);
  assert.doesNotMatch(partial, /id="printSettingsModal"/);
  assert.match(modal, /id="printSettingsModal"/);
  assert.match(modal, /id="printSettingOrientation"/);
  assert.match(modal, /Scale \(%\)/);
});

test('app print manager exposes shared settings and preview APIs', () => {
  const manager = require('../public/scripts/appPrintManager.js');
  assert.equal(manager.getStorageKey('grades-matrix', '/school/grades/matrix'), 'appPrintSettings_v1:/school/grades/matrix:grades-matrix');
  const normalized = manager.normalizeSettings({
    orientation: 'portrait',
    density: 'normal',
    includeOrg: false,
    includeHeaderNote: true,
    headerNote: 'Note',
    requestedByLabel: 'Printer',
    logoUrl: '/logo.png'
  });
  assert.equal(normalized.orientation, 'portrait');
  assert.equal(normalized.density, 'normal');
  assert.equal(normalized.includeOrg, false);
  assert.equal(normalized.headerNote, 'Note');
  assert.match(manager.buildPreviewControlsHtml(normalized), /data-print-orientation="portrait"/);
  assert.match(manager.buildPrintNoteHtml(normalized), /Note/);
});

test('print-table.css defines shared print tokens', () => {
  assert.match(printTableCss, /--ink:/);
  assert.match(printTableCss, /\.print-table th/);
  assert.match(printTableCss, /\.identity-block/);
  assert.match(printTableCss, /\.no-print/);
  assert.match(printTableCss, /width: auto/);
  assert.match(printTableCss, /data-print-orientation="portrait"/);
});
