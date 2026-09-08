'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

test('SCHOOL_ATTENDANCES manifest defines non-test session limits', () => {
  const manifest = readJson('packages/school/package.manifest.json');
  const source = (manifest.sections || []).find((row) => String(row?.id || '') === '778768');
  assert.ok(source, 'SCHOOL_ATTENDANCES must exist in package.manifest.json');

  const byId = new Map((source.operations || []).map((row) => [String(row.id), row]));
  const readOp = byId.get('OP1002');
  assert.ok(readOp, 'OP1002 must be declared in package.manifest.json');
  assert.equal(readOp.sessionAttempts, 50);
  assert.notEqual(readOp.sessionAttempts, 5);
});

test('seed-school-attendances-section.js loads manifest limits instead of hardcoded defaults', () => {
  const seedSource = fs.readFileSync(path.join(ROOT, 'scripts/seed-school-attendances-section.js'), 'utf8');
  assert.match(seedSource, /loadAttendanceOperationBundleFromManifest/);
  assert.match(seedSource, /resolveManifestTemplateOperation/);
  assert.doesNotMatch(seedSource, /sessionAttempts:\s*5/);
  assert.doesNotMatch(seedSource, /sessionAttempts:\s*10,\s*\n\s*sessionTime:\s*30/);
});
