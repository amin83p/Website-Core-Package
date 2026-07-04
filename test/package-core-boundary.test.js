const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function walkFiles(directory, predicate = () => true) {
  const out = [];
  if (!fs.existsSync(directory)) return out;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(fullPath, predicate));
    } else if (entry.isFile() && predicate(fullPath)) {
      out.push(fullPath);
    }
  }
  return out;
}

test('core access constants remain package-neutral', () => {
  const source = read('config/accessConstants.js');
  assert.equal(/\b(SCHOOL|IELTS|BENCHPATH|ACTIVITY_QUOTA|PTE)_/.test(source), false);
});

test('core constants do not carry package feature defaults', () => {
  const source = read('config/constants.js');
  assert.equal(/\bSCHOOL_/.test(source), false);
  assert.equal(/\bIELTS_/.test(source), false);
  assert.equal(source.includes('SECTION_KEYS'), false);
});

test('core person controller uses generic package dependency guards', () => {
  const source = read('MVC/controllers/personController.js');
  assert.equal(source.includes('includeSchoolRoles: true'), false);
  assert.equal(source.includes('school_student'), false);
  assert.equal(source.includes('packagePersonDependencyGuardService'), true);
});

test('school, ielts, benchpath, and activity quota expose package-owned access constants', () => {
  const school = require(path.join(ROOT_DIR, 'packages/school/config/accessConstants.js'));
  const ielts = require(path.join(ROOT_DIR, 'packages/ielts/config/accessConstants.js'));
  const benchpath = require(path.join(ROOT_DIR, 'packages/benchpath/config/accessConstants.js'));
  const activityQuota = require(path.join(ROOT_DIR, 'packages/activityQuota/config/accessConstants.js'));

  assert.equal(school.SCHOOL_SECTIONS.SCHOOL_STUDENTS, 'SCHOOL_STUDENTS');
  assert.equal(ielts.IELTS_SECTIONS.IELTS_API_PROVIDERS, 'IELTS_API_PROVIDERS');
  assert.equal(benchpath.BENCHPATH_SECTIONS.BENCHPATH_TASK_AUTHORING, 'BENCHPATH_TASK_AUTHORING');
  assert.equal(activityQuota.ACTIVITY_QUOTA_SECTIONS.ACTIVITY_QUOTA_CREDIT_CHECK, 'ACTIVITY_QUOTA_CREDIT_CHECK');
});

test('school runtime does not resolve access constants through core contracts', () => {
  const jsFiles = walkFiles(path.join(ROOT_DIR, 'packages/school/MVC'), (filePath) => filePath.endsWith('.js'));
  const offenders = jsFiles
    .filter((filePath) => read(path.relative(ROOT_DIR, filePath)).includes("requireCoreModule('config/accessConstants')"))
    .map((filePath) => path.relative(ROOT_DIR, filePath).replace(/\\/g, '/'));

  assert.deepEqual(offenders, []);
});

test('activity quota mounted runtime imports package-owned access constants', () => {
  const jsFiles = [
    ...walkFiles(path.join(ROOT_DIR, 'MVC/routes/activityQuota'), (filePath) => filePath.endsWith('.js')),
    ...walkFiles(path.join(ROOT_DIR, 'MVC/controllers/activityQuota'), (filePath) => filePath.endsWith('.js')),
    path.join(ROOT_DIR, 'MVC/services/activityQuota/activityQuotaUiService.js')
  ];
  const offenders = jsFiles
    .filter((filePath) => read(path.relative(ROOT_DIR, filePath)).includes("../../../config/accessConstants"))
    .map((filePath) => path.relative(ROOT_DIR, filePath).replace(/\\/g, '/'));

  assert.deepEqual(offenders, []);
});
