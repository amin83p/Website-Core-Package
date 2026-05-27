const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('json baseline includes SYSTEM_PACKAGE_BUILDER section and SYSTEM_SETTING linkage', () => {
  const sectionsPath = path.join(process.cwd(), 'data', 'sections.json');
  const sections = JSON.parse(fs.readFileSync(sectionsPath, 'utf8'));

  const section = sections.find((row) => String(row?.name || '').trim().toUpperCase() === 'SYSTEM_PACKAGE_BUILDER');
  assert.ok(section, 'SYSTEM_PACKAGE_BUILDER section must exist.');
  assert.equal(String(section.id), '731287');
  assert.equal(String(section.homeURL || '').trim(), '/systemSettings/package-builder');
  assert.equal(section.navigatorSection, false);
  assert.equal(section.dashboardDisplay, true);

  const parent = sections.find((row) => String(row?.id || '') === '883303');
  assert.ok(parent, 'SYSTEM_SETTING parent section (id=883303) must exist.');
  const refs = Array.isArray(parent.subsections) ? parent.subsections : [];
  const ids = refs.map((row) => String(row?.id || row || '').trim()).filter(Boolean);
  assert.equal(ids.filter((id) => id === '731287').length, 1, 'SYSTEM_SETTING should include one SYSTEM_PACKAGE_BUILDER ref.');
});

test('json baseline includes SYSTEM_PACKAGE_BUILDER symbol', () => {
  const symbolsPath = path.join(process.cwd(), 'data', 'symbols.json');
  const symbols = JSON.parse(fs.readFileSync(symbolsPath, 'utf8'));

  const symbol = symbols.find((row) => String(row?.name || '').trim().toUpperCase() === 'SYSTEM_PACKAGE_BUILDER');
  assert.ok(symbol, 'SYSTEM_PACKAGE_BUILDER symbol must exist.');
  assert.equal(String(symbol.id), 'SYM_SYSTEM_122');
  assert.equal(String(symbol.type || '').toLowerCase(), 'class');
  assert.equal(String(symbol.value || '').trim(), 'bi bi-box-seam');
  const tags = Array.isArray(symbol.tags) ? symbol.tags.map((t) => String(t)) : [];
  assert.ok(tags.includes('731287'), 'SYSTEM_PACKAGE_BUILDER symbol tags should include section id.');
});
