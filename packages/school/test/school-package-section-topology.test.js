const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const MANIFEST_PATH = path.join(ROOT, 'packages/school/package.manifest.json');

const SAMPLE_DATA_ID = '445561';
const DATA_MAINTENANCE_ID = '445582';
const MASTER_HUB_ID = '445577';

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function subsectionIds(section = {}) {
  return (Array.isArray(section.subsections) ? section.subsections : [])
    .map((row) => String(row?.id || row || '').trim())
    .filter(Boolean);
}

function findSection(manifest, name) {
  return (manifest.sections || []).find((row) => String(row?.name || '').toUpperCase() === name);
}

test('school manifest places sample data under SCHOOL_ACADEMIA only', () => {
  const manifest = readManifest();
  const school = findSection(manifest, 'SCHOOL');
  const academia = findSection(manifest, 'SCHOOL_ACADEMIA');

  assert.ok(school, 'SCHOOL section should be declared');
  assert.ok(academia, 'SCHOOL_ACADEMIA section should be declared');

  const schoolSubs = subsectionIds(school);
  const academiaSubs = subsectionIds(academia);

  assert.equal(schoolSubs.includes(SAMPLE_DATA_ID), false, 'SCHOOL should not list School Sample Data');
  assert.equal(academiaSubs.includes(SAMPLE_DATA_ID), true, 'SCHOOL_ACADEMIA should list School Sample Data');
  assert.equal(academiaSubs.includes(DATA_MAINTENANCE_ID), true, 'SCHOOL_ACADEMIA should list School Data Maintenance');
});

test('school manifest links master academia hub under SCHOOL root', () => {
  const manifest = readManifest();
  const school = findSection(manifest, 'SCHOOL');
  const hubSections = (manifest.sections || []).filter((row) => row.name === 'SCHOOL_MASTER_ACADEMIA_HUB');

  assert.equal(hubSections.length, 1, 'manifest should declare exactly one SCHOOL_MASTER_ACADEMIA_HUB section');
  assert.equal(hubSections[0].id, MASTER_HUB_ID);
  assert.equal(subsectionIds(school).includes(MASTER_HUB_ID), true, 'SCHOOL should list Master Academia Hub');
});

test('school manifest avoids duplicate subsection parents', () => {
  const manifest = readManifest();
  const parentByChild = new Map();

  for (const section of manifest.sections || []) {
    const parentName = String(section?.name || '').trim();
    if (!parentName) continue;
    for (const childId of subsectionIds(section)) {
      const priorParent = parentByChild.get(childId);
      assert.equal(
        priorParent,
        undefined,
        `subsection id ${childId} is listed under both ${priorParent} and ${parentName}`
      );
      parentByChild.set(childId, parentName);
    }
  }
});
