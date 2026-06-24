const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8'));
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function operationIds(section) {
  return (section?.operations || []).map((row) => String(row.id || row.operationId || '')).filter(Boolean);
}

test('school timesheet management section supports route read-all access', () => {
  const manifest = readJson('packages/school/package.manifest.json');
  const sections = readJson('data/sections.json');
  const manifestSection = manifest.sections.find((row) => row.name === 'SCHOOL_TIMESHEET_MANAGEMENT');
  const localSection = sections.find((row) => row.name === 'SCHOOL_TIMESHEET_MANAGEMENT');

  assert.ok(manifestSection, 'package manifest should declare SCHOOL_TIMESHEET_MANAGEMENT');
  assert.ok(localSection, 'root sections snapshot should declare SCHOOL_TIMESHEET_MANAGEMENT');
  assert.equal(manifestSection.id, '445579');
  assert.equal(localSection.id, '445579');
  assert.ok(operationIds(manifestSection).includes('OP1002'), 'manifest section should support READ');
  assert.ok(operationIds(manifestSection).includes('OP1003'), 'manifest section should support READ_ALL');
  assert.ok(operationIds(localSection).includes('OP1002'), 'local section should support READ');
  assert.ok(operationIds(localSection).includes('OP1003'), 'local section should support READ_ALL');
});

test('school timesheet management is linked under accounting with non-colliding symbol metadata', () => {
  const manifest = readJson('packages/school/package.manifest.json');
  const sections = readJson('data/sections.json');
  const symbols = readJson('data/symbols.json');
  const accounting = sections.find((row) => row.name === 'SCHOOL_ACCOUNTING');
  const managementSymbol = symbols.find((row) => row.name === 'SCHOOL_TIMESHEET_MANAGEMENT');
  const manifestSymbol = manifest.symbols.find((row) => row.name === 'SCHOOL_TIMESHEET_MANAGEMENT');
  const symbol061 = symbols.find((row) => row.id === 'SYM_SYSTEM_061');

  assert.ok(accounting, 'School Accounting section should exist');
  assert.ok((accounting.subsections || []).some((row) => String(row.id) === '445579'), 'Timesheet Management should be under School Accounting');
  assert.ok(managementSymbol, 'root symbols should include Timesheet Management');
  assert.ok(manifestSymbol, 'manifest symbols should include Timesheet Management');
  assert.equal(managementSymbol.id, 'SYM_SYSTEM_123');
  assert.equal(manifestSymbol.id, 'SYM_SYSTEM_123');
  assert.notEqual(symbol061?.name, 'SCHOOL_TIMESHEET_MANAGEMENT', 'SYM_SYSTEM_061 belongs to another feature and must not be overwritten');
});

test('timesheet mongo seed repairs both timesheet sections and symbol metadata', () => {
  const seedSource = read('scripts/seed-school-timesheet-management-section.js');

  assert.match(seedSource, /SECTION_DEFINITIONS/);
  assert.match(seedSource, /id: '445568'/);
  assert.match(seedSource, /name: 'SCHOOL_TIMESHEETS'/);
  assert.match(seedSource, /id: '445579'/);
  assert.match(seedSource, /name: 'SCHOOL_TIMESHEET_MANAGEMENT'/);
  assert.match(seedSource, /id: 'SYM_SYSTEM_047'/);
  assert.match(seedSource, /id: 'SYM_SYSTEM_123'/);
  assert.match(seedSource, /operations: \['OP1002', 'OP1003'/);
  assert.doesNotMatch(seedSource, /findOne\(\{ id: SYMBOL_ID \}\) \|\|/);
  assert.match(seedSource, /id: symbolDoc\.id/);
});