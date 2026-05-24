const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('PTE upload context middleware uses package upload path constants', () => {
  const middlewareSource = readText('packages/pte/MVC/middleware/pteUploadContextMiddleware.js');
  const dependencySource = readText('packages/pte/MVC/services/pte/pteUploadContextDependencies.js');

  assert.ok(
    middlewareSource.includes("const { pteAttemptLedgerService, pteUploadPathUtils } = require('../services/pte/pteUploadContextDependencies');"),
    'Upload context middleware should import package upload dependencies through local adapter.'
  );

  assert.ok(
    dependencySource.includes("const pteUploadPathUtils = require('../utils/pteUploadPathUtils');"),
    'Upload context dependencies should use package-local upload path utility.'
  );

  assert.ok(
    middlewareSource.includes('pteUploadPathUtils.PTE_BUCKETS.PRACTICE_BY_SKILLS'),
    'Practice-by-skills middleware branch should use package bucket constant.'
  );

  assert.ok(
    middlewareSource.includes('pteUploadPathUtils.PTE_BUCKETS.SMART_PRACTICE'),
    'Smart practice middleware branch should use package bucket constant.'
  );

  assert.ok(
    middlewareSource.includes('pteUploadPathUtils.PTE_BUCKETS.MOCK_EXAMS'),
    'Mock exam middleware branch should use package bucket constant.'
  );

  assert.ok(
    middlewareSource.includes('pteUploadPathUtils.PTE_BUCKETS.STUDENTS'),
    'Student upload branch should use package bucket constant.'
  );

  assert.ok(
    middlewareSource.includes('pteUploadPathUtils.PTE_BUCKETS.PUBLIC_APPLICANTS'),
    'Public applicant upload branch should use package bucket constant.'
  );

  assert.ok(
    !/['\"]Practice_By_Skills['\"]/i.test(middlewareSource),
    'Upload middleware should not hardcode raw Practice_By_Skills bucket names.'
  );

  assert.ok(
    !/['\"]Mock_Exams['\"]/i.test(middlewareSource),
    'Upload middleware should not hardcode raw Mock_Exams bucket names.'
  );

  assert.ok(
    !/['\"]Smart_Practice['\"]/i.test(middlewareSource),
    'Upload middleware should not hardcode raw Smart_Practice bucket names.'
  );
});

