const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('School prior subject credits manifest declares independent section, symbol, navigation, and staff access', () => {
  const manifest = readJson('packages/school/package.manifest.json');
  const section = (manifest.sections || []).find((row) => row.id === '445578');
  assert.ok(section, 'section 445578 should be declared');
  assert.equal(section.name, 'SCHOOL_PRIOR_SUBJECT_CREDITS');
  assert.equal(section.homeURL, '/school/programs/prior-subject-credits');
  assert.equal(section.trackState, true);
  assert.equal(section.dashboardDisplay, true);

  const academia = (manifest.sections || []).find((row) => row.name === 'SCHOOL_ACADEMIA');
  assert.ok((academia.subsections || []).some((row) => row.id === '445578'), 'section should be under SCHOOL_ACADEMIA');

  const symbol = (manifest.symbols || []).find((row) => row.id === 'SYM_SYSTEM_084');
  assert.ok(symbol, 'symbol SYM_SYSTEM_084 should be declared');
  assert.equal(symbol.name, 'SCHOOL_PRIOR_SUBJECT_CREDITS');
  assert.equal(symbol.value, 'bi bi-mortarboard');
  assert.equal(symbol.orgId, 'SYSTEM');
  assert.deepEqual(symbol.tags, ['SCHOOL_PRIOR_SUBJECT_CREDITS', '445578']);

  assert.ok((manifest.menuEntries || []).some((row) => row.id === 'school-menu-prior-subject-credits' && row.href === '/school/programs/prior-subject-credits'));
  assert.ok((manifest.dashboardEntries || []).some((row) => row.id === 'school-dashboard-prior-subject-credits' && row.href === '/school/programs/prior-subject-credits'));
  assert.ok((manifest.dataEntities || []).some((row) => row.entityType === 'studentProgramPriorSubjects'));

  const staff = (manifest.accesses || []).find((row) => row.name === 'SCHOOL_STAFF');
  assert.ok(staff, 'SCHOOL_STAFF should exist');
  const grant = (staff.sections || []).find((row) => row.sectionId === '445578');
  assert.ok(grant, 'SCHOOL_STAFF should include prior subject credits section');
  assert.equal(grant.adminAccess, false);
  assert.deepEqual((grant.operations || []).map((row) => `${row.operationId}:${row.scopeId}`), [
    'OP1001:SCP_ORG',
    'OP1002:SCP_ORG',
    'OP1003:SCP_ORG',
    'OP1005:SCP_ORG'
  ]);
});

test('School prior subject credit routes and page use the independent section', () => {
  const constants = readText('packages/school/config/accessConstants.js');
  const coreConstants = readText('config/accessConstants.js');
  const route = readText('packages/school/MVC/routes/programRoutes.js');
  const view = readText('packages/school/MVC/views/school/program/priorSubjectCredits.ejs');
  const formView = readText('packages/school/MVC/views/school/program/priorSubjectCreditForm.ejs');

  assert.match(constants, /SCHOOL_PRIOR_SUBJECT_CREDITS: 'SCHOOL_PRIOR_SUBJECT_CREDITS'/);
  assert.match(coreConstants, /SCHOOL_PRIOR_SUBJECT_CREDITS: 'SCHOOL_PRIOR_SUBJECT_CREDITS'/);
  assert.match(route, /SECTIONS\.SCHOOL_PRIOR_SUBJECT_CREDITS/);
  assert.doesNotMatch(route, /prior-subject-credits'[\s\S]{0,220}SCHOOL_PROGRAM_REGISTRATIONS/);
  assert.match(route, /router\.get\('\/prior-subject-credits\/new'[\s\S]*showCreateForm/);
  assert.match(route, /router\.post\('\/prior-subject-credits\/new'[\s\S]*createFromForm/);
  assert.match(route, /prior-subject-credits\/api\/batch'[\s\S]*allowOperationTokenFallback: true/);
  assert.match(route, /prior-subject-credits\/api\/batch'[\s\S]*allowInactiveTokenFallback: true/);
  assert.match(view, /School Dashboard/);
  assert.match(view, /School Academia/);
  assert.match(view, /\/dashboard\/section-nav\/SCHOOL_ACADEMIA/);
  assert.match(view, /newHref: '\/school\/programs\/prior-subject-credits\/new'/);
  assert.match(view, /newLabel: 'Add Credit'/);
  assert.doesNotMatch(view, /addPriorCreditModal|btn_openAddPriorModal/);
  assert.match(formView, /id="priorSubjectCreditForm"/);
  assert.match(formView, /action="\/school\/programs\/prior-subject-credits\/new"/);
  assert.match(formView, /GenericPickerPresets\.student/);
  assert.match(formView, /GenericPickerPresets\.subject/);
  assert.doesNotMatch(formView, /\balert\(/);
});

test('School prior subject credits Mongo seed is mirrored in package support metadata', () => {
  const support = readJson('packages/school/package.support-files.json');
  assert.ok((support.scripts || []).some((row) => (
    row.source === 'scripts/mongo-railway/insert-school-prior-subject-credits-section.mongosh.js'
    && row.target === 'packages/school/scripts/maintenance/insert-school-prior-subject-credits-section.mongosh.js'
    && row.targetStatus === 'package-mirrored'
  )));

  const seed = readText('scripts/mongo-railway/insert-school-prior-subject-credits-section.mongosh.js');
  const packageSeed = readText('packages/school/scripts/maintenance/insert-school-prior-subject-credits-section.mongosh.js');
  [seed, packageSeed].forEach((source) => {
    assert.match(source, /const SECTION_ID = '445578'/);
    assert.match(source, /const SECTION_NAME = 'SCHOOL_PRIOR_SUBJECT_CREDITS'/);
    assert.match(source, /const SYMBOL_ID = 'SYM_SYSTEM_084'/);
    assert.match(source, /const ACCESS_PROFILES = \['SCHOOL_STAFF'\]/);
    assert.match(source, /orgId: 'SYSTEM'/);
    assert.doesNotMatch(source, /organizationSymbols|orgSymbols|copy.*symbol/i);
  });
});
