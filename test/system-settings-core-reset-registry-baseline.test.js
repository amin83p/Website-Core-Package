const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('json baseline includes SYSTEM_CORE_RESET section and SYSTEM_SETTING linkage', () => {
  const sectionsPath = path.join(process.cwd(), 'data', 'sections.json');
  const sections = JSON.parse(fs.readFileSync(sectionsPath, 'utf8'));

  const section = sections.find((row) => String(row?.name || '').trim().toUpperCase() === 'SYSTEM_CORE_RESET');
  assert.ok(section, 'SYSTEM_CORE_RESET section must exist.');
  assert.equal(String(section.id), '731286');
  assert.equal(String(section.homeURL || '').trim(), '/systemSettings/core-reset');
  assert.equal(section.navigatorSection, false);
  assert.equal(section.dashboardDisplay, true);

  const parent = sections.find((row) => String(row?.id || '') === '883303');
  assert.ok(parent, 'SYSTEM_SETTING parent section (id=883303) must exist.');
  const refs = Array.isArray(parent.subsections) ? parent.subsections : [];
  const ids = refs.map((row) => String(row?.id || row || '').trim()).filter(Boolean);
  assert.equal(ids.filter((id) => id === '731286').length, 1, 'SYSTEM_SETTING should include one SYSTEM_CORE_RESET ref.');
});

test('json baseline includes SYSTEM_CORE_RESET symbol and preserves SYSTEM_PACKAGE_MANAGER symbol id', () => {
  const symbolsPath = path.join(process.cwd(), 'data', 'symbols.json');
  const symbols = JSON.parse(fs.readFileSync(symbolsPath, 'utf8'));

  const coreResetSymbol = symbols.find((row) => String(row?.name || '').trim().toUpperCase() === 'SYSTEM_CORE_RESET');
  assert.ok(coreResetSymbol, 'SYSTEM_CORE_RESET symbol must exist.');
  assert.equal(String(coreResetSymbol.id), 'SYM_SYSTEM_121');
  assert.equal(String(coreResetSymbol.type || '').toLowerCase(), 'class');
  assert.equal(String(coreResetSymbol.value || '').trim(), 'bi bi-arrow-clockwise');
  const tags = Array.isArray(coreResetSymbol.tags) ? coreResetSymbol.tags.map((t) => String(t)) : [];
  assert.ok(tags.includes('731286'), 'SYSTEM_CORE_RESET symbol tags should include section id.');

  const packageManagerSymbol = symbols.find((row) => String(row?.id || '') === 'SYM_SYSTEM_120');
  assert.ok(packageManagerSymbol, 'SYSTEM_PACKAGE_MANAGER symbol id SYM_SYSTEM_120 must exist.');
  assert.equal(String(packageManagerSymbol.name || '').toUpperCase(), 'SYSTEM_PACKAGE_MANAGER');
});

test('core bootstrap baseline includes SYSTEM_CORE_RESET section and symbol', () => {
  const sectionsPath = path.join(process.cwd(), 'data', 'bootstrap', 'core', 'sections.json');
  const symbolsPath = path.join(process.cwd(), 'data', 'bootstrap', 'core', 'symbols.json');
  const sections = JSON.parse(fs.readFileSync(sectionsPath, 'utf8'));
  const symbols = JSON.parse(fs.readFileSync(symbolsPath, 'utf8'));

  const section = sections.find((row) => String(row?.name || '').trim().toUpperCase() === 'SYSTEM_CORE_RESET');
  assert.ok(section, 'Bootstrap core baseline must include SYSTEM_CORE_RESET section.');

  const symbol = symbols.find((row) => String(row?.name || '').trim().toUpperCase() === 'SYSTEM_CORE_RESET');
  assert.ok(symbol, 'Bootstrap core baseline must include SYSTEM_CORE_RESET symbol.');
});
