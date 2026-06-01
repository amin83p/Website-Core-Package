const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function walkJsFiles(directory) {
  const out = [];
  if (!fs.existsSync(directory)) return out;
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkJsFiles(fullPath));
      return;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) out.push(fullPath);
  });
  return out;
}

function normalizeRelative(filePath) {
  return path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

const domains = [
  { label: 'controllers', coreDir: 'MVC/controllers/school', packageDir: 'packages/school/MVC/controllers/school' },
  { label: 'services', coreDir: 'MVC/services/school', packageDir: 'packages/school/MVC/services/school' },
  { label: 'repositories', coreDir: 'MVC/repositories/school', packageDir: 'packages/school/MVC/repositories/school' },
  { label: 'models', coreDir: 'MVC/models/school', packageDir: 'packages/school/MVC/models/school' }
];

const packageOwnedByDomain = {
  controllers: new Set([
    'sessionController.js',
    'termController.js',
    'subjectController.js',
    'holidayController.js',
    'payRateController.js',
    'sessionStatusController.js',
    'timesheetPeriodController.js',
    'schoolSampleDataController.js',
    'departmentController.js',
    'transactionDefinitionController.js',
    'gradesMatrixController.js',
    'schoolDashboardController.js',
    'attendanceController.js',
    'schoolAccountController.js',
    'timesheetController.js',
    'withdrawalController.js',
    'programController.js',
    'academicLedgerController.js',
    'studentProgramPriorSubjectController.js',
    'transactionsManagerController.js',
    'staffController.js',
    'teacherController.js',
    'studentController.js',
    'programRegistrationController.js',
    'scheduleController.js',
    'reportController.js',
    'termRegistrationController.js',
    'examController.js',
    'classController.js'
  ]),
  services: new Set(),
  repositories: new Set(),
  models: new Set()
};

for (const domain of domains) {
  test(`school package ${domain.label} wrappers should cover current core file surface`, () => {
    const coreAbs = path.join(ROOT_DIR, domain.coreDir);
    const packageAbs = path.join(ROOT_DIR, domain.packageDir);
    const coreFiles = walkJsFiles(coreAbs);
    const missing = [];
    const invalid = [];

    coreFiles.forEach((coreFileAbs) => {
      const relInsideDomain = path.relative(coreAbs, coreFileAbs).replace(/\\/g, '/');
      const packageFileAbs = path.join(packageAbs, relInsideDomain);
      if (!fs.existsSync(packageFileAbs)) {
        missing.push(relInsideDomain);
        return;
      }

      const source = read(packageFileAbs);
      const coreModulePath = `${domain.coreDir.replace(/\\/g, '/')}/${relInsideDomain}`;
      const packageOwned = (packageOwnedByDomain[domain.label] || new Set()).has(relInsideDomain);
      if (packageOwned) {
        if (source.includes(`requireCoreModule('${coreModulePath}')`)) {
          invalid.push(`${relInsideDomain}: should be package-owned (still bridges to core module)`);
        }
        return;
      }
      if (!source.includes('requireCoreModule(')) {
        invalid.push(`${relInsideDomain}: missing requireCoreModule call`);
        return;
      }
      if (!source.includes(`requireCoreModule('${coreModulePath}')`)) {
        invalid.push(`${relInsideDomain}: wrong core module target`);
      }
    });

    assert.deepEqual(missing, [], `${domain.label} wrappers missing files: ${missing.join(', ')}`);
    assert.deepEqual(invalid, [], `${domain.label} wrappers invalid: ${invalid.join(', ')}`);
  });
}

test('school package wrapper files should not use deep relative core imports', () => {
  const packageRuntimeRoot = path.join(ROOT_DIR, 'packages/school/MVC');
  const jsFiles = walkJsFiles(packageRuntimeRoot);
  const offenders = [];
  const deepCoreRequirePattern = /require\(\s*['"](?:\.\.\/){5}(?:MVC|config)\//g;

  jsFiles.forEach((filePath) => {
    const source = read(filePath);
    const relative = normalizeRelative(filePath);
    const hasDeepCoreImport = deepCoreRequirePattern.test(source);
    deepCoreRequirePattern.lastIndex = 0;
    if (!hasDeepCoreImport) return;
    offenders.push(relative);
  });

  assert.deepEqual(offenders, []);
});
