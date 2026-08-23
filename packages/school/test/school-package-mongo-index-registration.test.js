const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const manifest = require('../package.manifest.json');
const schoolIndexDefinitions = require('../config/mongoIndexes');
const packageMongoIndexRegistry = require('../../../MVC/infrastructure/mongo/packageMongoIndexRegistry');
const mongoIndexManager = require('../../../MVC/infrastructure/mongo/mongoIndexManager');

const SCHOOL_INDEX_COLLECTIONS = [
  'schoolStudents',
  'schoolTimesheets',
  'schoolReportTemplates',
  'schoolReportAssignments',
  'schoolReportInstances',
  'schoolOverallReportTemplates',
  'schoolOverallReportInstances'
];

test.afterEach(() => {
  packageMongoIndexRegistry.resetRegisteredMongoIndexDefinitions();
});

test('school manifest declares package-owned Mongo index definitions', () => {
  assert.deepEqual(manifest.mongoIndexes, [
    {
      path: 'config/mongoIndexes.js',
      active: true
    }
  ]);

  SCHOOL_INDEX_COLLECTIONS.forEach((collectionName) => {
    assert.equal(Array.isArray(schoolIndexDefinitions[collectionName]), true, `${collectionName} should be package-owned.`);
    assert.ok(schoolIndexDefinitions[collectionName].length > 0, `${collectionName} should define indexes.`);
  });
});

test('core default index definitions do not inline school students/timesheets/reports collections', () => {
  SCHOOL_INDEX_COLLECTIONS.forEach((collectionName) => {
    assert.equal(
      Object.prototype.hasOwnProperty.call(mongoIndexManager.INDEX_DEFINITIONS, collectionName),
      false,
      `${collectionName} should not be in core INDEX_DEFINITIONS.`
    );
  });
});

test('Mongo index manager discovers school students/timesheets/reports indexes from package manifest', () => {
  packageMongoIndexRegistry.resetRegisteredMongoIndexDefinitions();
  const definitions = mongoIndexManager.getIndexDefinitions({ projectRoot: ROOT_DIR });

  SCHOOL_INDEX_COLLECTIONS.forEach((collectionName) => {
    assert.equal(Array.isArray(definitions[collectionName]), true, `${collectionName} should be merged from package indexes.`);
    assert.deepEqual(definitions[collectionName], schoolIndexDefinitions[collectionName]);
  });
});

test('Mongo index manager falls back to bundled package manifests when configured package root has no manifests', () => {
  const previousRoot = process.env.PACKAGE_STORAGE_ROOT;
  const previousRoots = process.env.PACKAGE_STORAGE_ROOTS;
  process.env.PACKAGE_STORAGE_ROOT = path.join(ROOT_DIR, '.missing-runtime-package-root-for-test');
  delete process.env.PACKAGE_STORAGE_ROOTS;

  try {
    packageMongoIndexRegistry.resetRegisteredMongoIndexDefinitions();
    const definitions = mongoIndexManager.getIndexDefinitions({ projectRoot: ROOT_DIR });
    assert.deepEqual(definitions.schoolStudents, schoolIndexDefinitions.schoolStudents);
    assert.deepEqual(definitions.schoolTimesheets, schoolIndexDefinitions.schoolTimesheets);
  } finally {
    if (previousRoot === undefined) delete process.env.PACKAGE_STORAGE_ROOT;
    else process.env.PACKAGE_STORAGE_ROOT = previousRoot;
    if (previousRoots === undefined) delete process.env.PACKAGE_STORAGE_ROOTS;
    else process.env.PACKAGE_STORAGE_ROOTS = previousRoots;
    packageMongoIndexRegistry.resetRegisteredMongoIndexDefinitions();
  }
});

test('school timesheet and report indexes cover primary lookup keys', () => {
  const timesheetKeys = schoolIndexDefinitions.schoolTimesheets.map((row) => row.options?.name);
  assert.ok(timesheetKeys.includes('idx_school_timesheets_org_period_teacher'));

  const reportInstanceKeys = schoolIndexDefinitions.schoolReportInstances.map((row) => row.options?.name);
  assert.ok(reportInstanceKeys.includes('idx_school_report_instances_org_class_session_student'));
  assert.ok(reportInstanceKeys.includes('idx_school_report_instances_org_assignment_student'));

  const studentKeys = schoolIndexDefinitions.schoolStudents.map((row) => row.options?.name);
  assert.ok(studentKeys.includes('idx_school_students_org_person'));
});
