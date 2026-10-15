const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

const programSubjectScopeService = require('../MVC/services/school/programSubjectScopeService');
const schoolDataService = require('../MVC/services/school/schoolDataService');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('collectSubjectIdsFromPrograms unions and dedupes subject ids', () => {
  const ids = programSubjectScopeService.collectSubjectIdsFromPrograms([
    { subjects: [{ subjectId: 'SUB_A' }, { subjectId: 'SUB_B' }] },
    { subjects: [{ subjectId: 'SUB_B' }, { subjectId: 'SUB_C' }] }
  ]);
  assert.deepEqual([...ids].sort(), ['SUB_A', 'SUB_B', 'SUB_C']);
});

test('parseProgramIdsFromQuery merges programId and programIds', () => {
  const parsed = programSubjectScopeService.parseProgramIdsFromQuery({
    programId: '100',
    programIds: '100,200, 300'
  });
  assert.deepEqual(parsed, ['100', '200', '300']);
});

test('assertClassCurriculumSubjectsInProgramScope rejects out-of-program subjects', () => {
  const programs = [{ subjects: [{ subjectId: 'SUB_OK' }] }];
  assert.throws(
    () => programSubjectScopeService.assertClassCurriculumSubjectsInProgramScope({
      allowedProgramTerms: [{ programId: 'PRG_1' }],
      curriculum: { subjects: [{ subjectId: 'SUB_BAD', code: 'BAD101' }] }
    }, programs),
    /must be assigned to this class's program\(s\)/i
  );
});

test('assertClassCurriculumSubjectsInProgramScope requires program when curriculum has subjects', () => {
  assert.throws(
    () => programSubjectScopeService.assertClassCurriculumSubjectsInProgramScope({
      allowedProgramTerms: [],
      curriculum: { subjects: [{ subjectId: 'SUB_1' }] }
    }, []),
    /Program Terms tab/i
  );
});

test('resolveAllowedSubjectIdsForProgramIds loads program curriculum via schoolDataService', async () => {
  const originalFetchAll = schoolDataService.fetchAllData;
  schoolDataService.fetchAllData = async (entity) => {
    if (entity !== 'programs') return [];
    return [{
      id: 'PRG_1',
      subjects: [{ subjectId: 'SUB_X' }, { subjectId: 'SUB_Y' }]
    }];
  };
  try {
    const ids = await programSubjectScopeService.resolveAllowedSubjectIdsForProgramIds(['PRG_1'], { id: 'USER_1' });
    assert.deepEqual([...ids].sort(), ['SUB_X', 'SUB_Y']);
  } finally {
    schoolDataService.fetchAllData = originalFetchAll;
  }
});

test('class form wires program-scoped subject picker endpoint', () => {
  const classForm = read('MVC/views/school/class/classForm.ejs');
  assert.match(classForm, /\/school\/subjects\?programIds=' \+ encodeURIComponent\(programIds\.join\('\,'\)\)/);
  assert.match(classForm, /Program Terms tab before selecting curriculum subjects/);
});

test('new class subject picker splits fee weight equally after multiselect add', () => {
  const classForm = read('MVC/views/school/class/classForm.ejs');
  assert.match(classForm, /if \(!classId\) \{\s*\n\s*curriculumState = buildEvenWeights\(curriculumState\)/);
});

test('edit class subject picker preserves weights without equal rebalance', () => {
  const classForm = read('MVC/views/school/class/classForm.ejs');
  const pickerBlock = classForm.slice(
    classForm.indexOf('const onSubjectsPicked = (items) =>'),
    classForm.indexOf('subjectPickerBtn.addEventListener')
  );
  assert.match(pickerBlock, /if \(!classId\)/);
  assert.match(pickerBlock, /normalizeCurriculumState\(\{ rebalanceIfMissing: false \}\)/);
  assert.doesNotMatch(pickerBlock, /else \{\s*curriculumState = buildEvenWeights/);
});

test('class controller validates curriculum subjects against program scope on save', () => {
  const controller = read('MVC/controllers/school/classController.js');
  assert.match(controller, /assertClassCurriculumSubjectsInProgramScopeForClass/);
  assert.match(controller, /programSubjectScopeService/);
});

test('subject list supports programIds filter', () => {
  const controller = read('MVC/controllers/school/subjectController.js');
  assert.match(controller, /parseProgramIdsFromQuery/);
  assert.match(controller, /query\.id__in = allowedList\.join/);
  assert.match(controller, /delete query\.programIds/);
  assert.match(controller, /delete query\.programId/);
});
