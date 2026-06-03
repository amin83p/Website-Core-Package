const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

const PASS27_MODELS = [
  'academicSnapshotModel.js',
  'holidayModel.js',
  'payRateModel.js',
  'schoolAccountModel.js',
  'schoolIndexModel.js',
  'sessionStatusModel.js',
  'staffModel.js',
  'teacherModel.js',
  'termModel.js',
  'timesheetModel.js',
  'timesheetPeriodModel.js',
  'studentProgramRegistrationModel.js',
  'studentTermRegistrationModel.js',
  'studentProgramPriorSubjectModel.js',
  'transactionJournalModel.js',
  'withdrawalModel.js'
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('school package pass27 models are package-owned and use core contracts only for shared utilities', () => {
  const offenders = [];

  PASS27_MODELS.forEach((fileName) => {
    const relative = `packages/school/MVC/models/school/${fileName}`;
    const source = read(relative);

    if (source.includes(`requireCoreModule('MVC/models/school/${fileName}')`)) {
      offenders.push(`${fileName}: still delegates to core model wrapper`);
    }
    if (!source.includes("require('../../services/school/schoolCoreModuleResolver')")) {
      offenders.push(`${fileName}: missing schoolCoreModuleResolver import`);
    }
    if (!source.includes("requireCoreModule('MVC/models/fileQueue')")) {
      offenders.push(`${fileName}: missing core fileQueue import via contract`);
    }
    const usesRootedSchoolDataPath =
      source.includes("path.join(resolveCoreRoot(), 'data/school/") ||
      source.includes("path.join(resolveCoreRoot(), 'data/school')");
    if (!usesRootedSchoolDataPath) {
      offenders.push(`${fileName}: data path is not rooted from resolveCoreRoot`);
    }
  });

  assert.deepEqual(offenders, []);
});
