const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const { generateUniqueStringId } = require('../MVC/repositories/backend/mongoRepositoryUtils');
const { generateUniqueSectionId } = require('../MVC/models/sectionModel');
const { generateUniqueOperationId } = require('../MVC/models/operationModel');
const packageRegistryInstallerService = require('../MVC/services/packageRegistryInstallerService');

const ROOT = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function createMockCollection(existingIds = []) {
  const ids = new Set(existingIds.map((id) => String(id)));
  return {
    async findOne(filter = {}) {
      const id = String(filter?.id || '').trim();
      if (!id) return null;
      return ids.has(id) ? { _id: id } : null;
    }
  };
}

function assertUniqueManifestIds(rows = [], label = 'entity') {
  const byId = new Map();
  for (const row of rows) {
    const id = String(row?.id || '').trim();
    if (!id) continue;
    const name = String(row?.name || '').trim();
    if (byId.has(id)) {
      throw new Error(`Duplicate ${label} id "${id}" used by ${byId.get(id)} and ${name}`);
    }
    byId.set(id, name);
  }
}

test('generateUniqueStringId returns requested id when free', async () => {
  const collection = createMockCollection([]);
  const id = await generateUniqueStringId(collection, '555012');
  assert.equal(id, '555012');
});

test('generateUniqueStringId regenerates when requested id is taken', async () => {
  const collection = createMockCollection(['445580']);
  const warnings = [];
  const id = await generateUniqueStringId(collection, '445580', {
    warnOnCollision: (requestedId) => warnings.push(requestedId)
  });
  assert.notEqual(id, '445580');
  assert.deepEqual(warnings, ['445580']);
});

test('generateUniqueSectionId avoids occupied ids', () => {
  const occupied = [{ id: '555555' }];
  const originalRandom = Math.random;
  Math.random = () => (555555 - 100000) / 900000;
  try {
    const id = generateUniqueSectionId(occupied);
    assert.notEqual(id, '555555');
  } finally {
    Math.random = originalRandom;
  }
});

test('generateUniqueOperationId skips occupied sequential ids', () => {
  const operations = [
    { id: 'OP1001', name: 'OP_A' },
    { id: 'OP1002', name: 'OP_B' }
  ];
  const id = generateUniqueOperationId(operations);
  assert.equal(id, 'OP1003');
});

test('generateUniqueOperationId skips non-OP legacy collisions', () => {
  const operations = [
    { id: 'OP1001', name: 'OP_A' },
    { id: 'OP1002', name: 'OP_B' }
  ];
  operations.push({ id: 'OP1003', name: 'OP_C' });
  const id = generateUniqueOperationId(operations);
  assert.equal(id, 'OP1004');
});

test('collectManifestDuplicateIdErrors reports duplicate section ids', () => {
  const errors = packageRegistryInstallerService.collectManifestDuplicateIdErrors([
    { id: '445580', name: 'SCHOOL_ACTIVITIES' },
    { id: '445580', name: 'SCHOOL_TEACHING_OUTLINES' }
  ], 'sections');
  assert.equal(errors.length, 2);
  assert.match(errors[0].message, /Duplicate section id "445580"/);
  assert.ok(errors.some((row) => row.key === 'SCHOOL_ACTIVITIES'));
  assert.ok(errors.some((row) => row.key === 'SCHOOL_TEACHING_OUTLINES'));
});

test('validateManifestEntityIds reports db id/name collisions', async () => {
  const errors = await packageRegistryInstallerService.validateManifestEntityIds(
    {
      sections: [{ id: '445580', name: 'SCHOOL_ACTIVITIES' }],
      operations: []
    },
    {
      sectionRepository: {
        getById: async (id) => (
          String(id) === '445580'
            ? { id: '445580', name: 'SCHOOL_TEACHING_OUTLINES' }
            : null
        )
      },
      operationRepository: {
        getById: async () => null
      }
    }
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Section id collision: id 445580 already used by SCHOOL_TEACHING_OUTLINES/);
});

test('school manifest section and operation ids are unique', () => {
  const manifest = readJson('packages/school/package.manifest.json');
  assertUniqueManifestIds(manifest.sections || [], 'section');
  assertUniqueManifestIds(manifest.operations || [], 'operation');
});
