const test = require('node:test');
const assert = require('node:assert/strict');

const generators = require('../MVC/services/school/schoolCatalogIdGenerators');
const schoolCatalogEntityIdService = require('../MVC/services/school/schoolCatalogEntityIdService');

test('catalog id candidates match expected patterns', () => {
  assert.match(generators.candidateClassId(), /^CLS-\d{4}-[A-Z0-9]+$/);
  assert.match(generators.candidateTermId(), /^TRM-\d{4}-[a-z0-9]+$/i);
  assert.match(generators.candidateSubjectId('ENG'), /^SUB-ENG-[A-Z0-9]+$/);
  assert.match(generators.candidateSchoolAccountId(), /^ACC_\d+_\d+$/);
  assert.match(generators.candidateTaskId(), /^STA-\d+-[0-9]+$/);
  assert.match(generators.candidateStudentProgramRegistrationId(), /^SPR-\d+-[0-9]+$/);
  assert.match(generators.candidateGlobalTransactionId(), /^GTL\d{8}[0-9]+$/);
});

test('mongo allocators produce aligned ids', async () => {
  const classId = await schoolCatalogEntityIdService.allocateUniqueClassId({ existingIds: [] });
  assert.match(classId, /^CLS-\d{4}-[A-Z0-9]+$/);

  const taskId = await schoolCatalogEntityIdService.allocateUniqueTaskId({ existingIds: [] });
  assert.match(taskId, /^STA-\d+-[0-9]+$/);

  const subjectId = await schoolCatalogEntityIdService.allocateUniqueSubjectId({
    existingIds: [],
    deptCode: 'MATH'
  });
  assert.match(subjectId, /^SUB-MATH-[A-Z0-9]+$/);
});
