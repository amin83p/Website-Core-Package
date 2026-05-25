const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('json baseline includes SYSTEM_PACKAGE_MANAGER section and SYSTEM_SETTING linkage', () => {
  const sectionsPath = path.join(process.cwd(), 'data', 'sections.json');
  const sections = JSON.parse(fs.readFileSync(sectionsPath, 'utf8'));

  const section = sections.find((row) => String(row?.name || '').trim().toUpperCase() === 'SYSTEM_PACKAGE_MANAGER');
  assert.ok(section, 'SYSTEM_PACKAGE_MANAGER section must exist.');
  assert.equal(String(section.id), '731285');
  assert.equal(String(section.homeURL || '').trim(), '/systemSettings/packages');
  assert.equal(section.navigatorSection, false);
  assert.equal(section.dashboardDisplay, true);

  const parent = sections.find((row) => String(row?.id || '') === '883303');
  assert.ok(parent, 'SYSTEM_SETTING parent section (id=883303) must exist.');
  const refs = Array.isArray(parent.subsections) ? parent.subsections : [];
  const ids = refs.map((row) => String(row?.id || row || '').trim()).filter(Boolean);
  assert.equal(ids.filter((id) => id === '731285').length, 1, 'SYSTEM_SETTING should include one SYSTEM_PACKAGE_MANAGER ref.');
});

test('json baseline includes SYSTEM_PACKAGE_MANAGER symbol and preserves ROLES symbol id', () => {
  const symbolsPath = path.join(process.cwd(), 'data', 'symbols.json');
  const symbols = JSON.parse(fs.readFileSync(symbolsPath, 'utf8'));

  const pmSymbol = symbols.find((row) => String(row?.name || '').trim().toUpperCase() === 'SYSTEM_PACKAGE_MANAGER');
  assert.ok(pmSymbol, 'SYSTEM_PACKAGE_MANAGER symbol must exist.');
  assert.equal(String(pmSymbol.id), 'SYM_SYSTEM_120');
  assert.equal(String(pmSymbol.type || '').toLowerCase(), 'class');
  assert.equal(String(pmSymbol.value || '').trim(), 'bi bi-boxes');
  const tags = Array.isArray(pmSymbol.tags) ? pmSymbol.tags.map((t) => String(t)) : [];
  assert.ok(tags.includes('731285'), 'SYSTEM_PACKAGE_MANAGER symbol tags should include section id.');

  const roleSymbol = symbols.find((row) => String(row?.id || '') === 'SYM_SYSTEM_083');
  assert.ok(roleSymbol, 'ROLES symbol id SYM_SYSTEM_083 must exist.');
  assert.equal(String(roleSymbol.name || '').toUpperCase(), 'ROLES');
});
