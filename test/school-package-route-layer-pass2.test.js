const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const ROUTES_DIR = path.join(ROOT_DIR, 'packages/school/MVC/routes');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('school package main route should mount expected school route branches', () => {
  const source = read(path.join(ROUTES_DIR, 'schoolMainRoute.js'));
  const expectedSegments = [
    '/students',
    '/teachers',
    '/staff',
    '/programs',
    '/transactionTemplates',
    '/transactionDefinitions',
    '/accounts',
    '/transactions',
    '/academic-ledger',
    '/sample-data',
    '/departments',
    '/subjects',
    '/terms',
    '/payRates',
    '/session-statuses',
    '/timesheetPeriods',
    '/timesheets',
    '/classes',
    '/schedules',
    '/attendances',
    '/grades-matrix',
    '/holidays',
    '/sessions',
    '/reports',
    '/exams',
    '/withdrawal'
  ];

  expectedSegments.forEach((segment) => {
    assert.match(source, new RegExp(`router\\.use\\('${segment.replace('/', '\\/')}'`));
  });
});

test('school package route wrappers should resolve core routes through core contract resolver', () => {
  const expectedRouteFiles = [
    'studentRoutes.js',
    'teacherRoutes.js',
    'staffRoutes.js',
    'programRoutes.js',
    'transactionTemplateRoutes.js',
    'transactionDefinitionRoutes.js',
    'schoolAccountRoutes.js',
    'transactionsManagerRoutes.js',
    'academicLedgerRoutes.js',
    'sampleDataRoutes.js',
    'departmentRoutes.js',
    'subjectRoutes.js',
    'termRoutes.js',
    'payRateRoutes.js',
    'sessionStatusRoutes.js',
    'timesheetPeriodRoutes.js',
    'timesheetRoutes.js',
    'classRoutes.js',
    'scheduleRoutes.js',
    'attendanceRoutes.js',
    'gradesMatrixRoutes.js',
    'holidayRoutes.js',
    'sessionRoutes.js',
    'reportRoutes.js',
    'examRoutes.js',
    'withdrawalRoutes.js',
    'schoolRoutes.js'
  ];

  const offenders = [];
  expectedRouteFiles.forEach((name) => {
    const filePath = path.join(ROUTES_DIR, name);
    if (!fs.existsSync(filePath)) {
      offenders.push(`${name}: missing wrapper file`);
      return;
    }

    const source = read(filePath);
    if (!source.includes("require('../services/school/schoolCoreContracts')")) {
      offenders.push(`${name}: missing schoolCoreContracts import`);
      return;
    }
    if (!source.includes("requireCoreModule('MVC/routes/school/")) {
      offenders.push(`${name}: missing core route resolver bridge`);
      return;
    }
    if (/require\(\s*['"](?:\.\.\/){3,}MVC\//.test(source)) {
      offenders.push(`${name}: contains deep relative core import`);
    }
  });

  assert.deepEqual(offenders, []);
});
