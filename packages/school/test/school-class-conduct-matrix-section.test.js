const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.manifest.json'), 'utf8'));

function findSection(name) {
  return (manifest.sections || []).find((row) => String(row?.name || '').toUpperCase() === name);
}

function subsectionIds(section = {}) {
  return (Array.isArray(section.subsections) ? section.subsections : [])
    .map((row) => String(row?.id || row || '').trim())
    .filter(Boolean);
}

test('manifest declares SCHOOL_CLASS_CONDUCT_MATRIX under SCHOOL_ACADEMIA', () => {
  const section = findSection('SCHOOL_CLASS_CONDUCT_MATRIX');
  const academia = findSection('SCHOOL_ACADEMIA');
  const report = findSection('SCHOOL_CLASS_CONDUCT_REPORT');
  const reports = findSection('SCHOOL_REPORTS');
  assert.ok(section, 'SCHOOL_CLASS_CONDUCT_MATRIX should be declared');
  assert.equal(section.id, '778772');
  assert.equal(String(section.homeURL || ''), '/school/conduct-matrix');
  assert.ok(academia, 'SCHOOL_ACADEMIA should be declared');
  assert.equal(subsectionIds(academia).includes('778772'), true);
  assert.ok(report, 'SCHOOL_CLASS_CONDUCT_REPORT should be declared');
  assert.equal(report.id, '778773');
  assert.ok(reports, 'SCHOOL_REPORTS should be declared');
  assert.equal(subsectionIds(reports).includes('778773'), true);
});

test('package access constants expose SCHOOL_CLASS_CONDUCT_MATRIX', () => {
  const { SCHOOL_SECTIONS } = require('../config/accessConstants');
  assert.equal(SCHOOL_SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX, 'SCHOOL_CLASS_CONDUCT_MATRIX');
});
