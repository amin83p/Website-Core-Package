const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PASS27_MODELS = new Set([
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
]);

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readOwnershipRegistry() {
  const registryPath = path.join(ROOT_DIR, 'test/school-package-ownership-registry.json');
  return JSON.parse(read(registryPath));
}

function findMissingRelativeRequire(filePath, source) {
  const fileDir = path.dirname(filePath);
  const requirePattern = /require\(\s*(['"])(.*?)\1\s*\)/g;
  let match;

  while ((match = requirePattern.exec(source)) !== null) {
    const importPath = match[2];
    if (!importPath.startsWith('.')) continue;
    if (importPath.startsWith('./') || importPath.startsWith('.\\')) continue;
    if (!importPath.startsWith('../') && !importPath.startsWith('..\\')) continue;

    const candidate = path.resolve(fileDir, importPath);
    const hasModule =
      fs.existsSync(candidate) ||
      fs.existsSync(`${candidate}.js`) ||
      fs.existsSync(path.join(candidate, 'index.js'));
    if (!hasModule) return importPath;
  }

  return '';
}

test('school package pass28 owns remaining school models and rewires shared requires to core contracts', () => {
  const registry = readOwnershipRegistry();
  const allModels = new Set((registry.models || []).map(String));
  const pass28Models = [...allModels].filter((name) => !PASS27_MODELS.has(name)).sort();
  const offenders = [];

  pass28Models.forEach((fileName) => {
    const sourcePath = path.join(ROOT_DIR, 'packages/school/MVC/models/school', fileName);

    if (!fs.existsSync(sourcePath)) {
      offenders.push(`${fileName}: missing model file`);
      return;
    }

    const source = read(sourcePath);

    if (source.includes(`requireCoreModule('MVC/models/school/${fileName}')`)) {
      offenders.push(`${fileName}: still delegates to core model wrapper`);
    }
    if (source.includes(`requireCoreModule('')`)) {
      offenders.push(`${fileName}: unresolved converted require`);
    }
    if (!source.includes("requireCoreModule('MVC/services/school/schoolCoreModuleResolver')")) {
      offenders.push(`${fileName}: missing schoolCoreModuleResolver import`);
    }
    if (!source.includes('path.join(resolveCoreRoot(), \'data/school/')) {
      offenders.push(`${fileName}: data path is not rooted from resolveCoreRoot`);
    }

    const missingRelativeRequire = findMissingRelativeRequire(sourcePath, source);
    if (missingRelativeRequire) {
      offenders.push(`${fileName}: missing local module ${missingRelativeRequire}`);
    }
  });

  assert.deepEqual(offenders, []);
});

test('school package pass28 owns school repositories and rewires shared requires to core contracts', () => {
  const registry = readOwnershipRegistry();
  const repoFiles = (registry.repositories || []).map(String).sort();
  const offenders = [];

  repoFiles.forEach((fileName) => {
    const sourcePath = path.join(ROOT_DIR, 'packages/school/MVC/repositories/school', fileName);

    if (!fs.existsSync(sourcePath)) {
      offenders.push(`${fileName}: missing repository file`);
      return;
    }

    const source = read(sourcePath);

    if (source.includes(`requireCoreModule('MVC/repositories/school/${fileName}')`)) {
      offenders.push(`${fileName}: still delegates to core repository wrapper`);
    }
    if (source.includes(`requireCoreModule('')`)) {
      offenders.push(`${fileName}: unresolved converted require`);
    }

    const missingRelativeRequire = findMissingRelativeRequire(sourcePath, source);
    if (missingRelativeRequire) {
      offenders.push(`${fileName}: missing local module ${missingRelativeRequire}`);
    }
  });

  assert.deepEqual(offenders, []);
});
