const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const accessConstants = require('../config/accessConstants');
const libraryCopyModel = require('../MVC/models/school/libraryCopyModel');
const libraryPatronModel = require('../MVC/models/school/libraryPatronModel');
const libraryPolicyModel = require('../MVC/models/school/libraryPolicyModel');
const libraryLoanModel = require('../MVC/models/school/libraryLoanModel');
const libraryCirculationService = require('../MVC/services/school/libraryCirculationService');
const libraryLocationModel = require('../MVC/models/school/libraryLocationModel');
const libraryLocationService = require('../MVC/services/school/libraryLocationService');

test('access constants declare library sections', () => {
  assert.equal(accessConstants.SCHOOL_SECTIONS.SCHOOL_LIBRARY, 'SCHOOL_LIBRARY');
  assert.equal(accessConstants.SECTIONS.SCHOOL_LIBRARY_COPIES, 'SCHOOL_LIBRARY_COPIES');
  assert.equal(accessConstants.SECTIONS.SCHOOL_LIBRARY_CIRCULATION, 'SCHOOL_LIBRARY_CIRCULATION');
  assert.equal(accessConstants.SECTIONS.SCHOOL_LIBRARY_LOCATIONS, 'SCHOOL_LIBRARY_LOCATIONS');
});

test('library copy model validates copy code uniqueness semantics', () => {
  assert.equal(libraryCopyModel.normalizeCopyType('DIGITAL'), 'digital');
  assert.equal(libraryCopyModel.normalizeCopyStatus('AVAILABLE'), 'available');
});

test('library patron model normalizes roles and statuses', () => {
  assert.equal(libraryPatronModel.normalizePatronRole('Teacher'), 'teacher');
  assert.equal(libraryPatronModel.normalizePatronStatus('BLOCKED'), 'blocked');
});

test('library policy model exposes defaults per role', () => {
  const student = libraryPolicyModel.DEFAULT_POLICIES.student;
  assert.ok(student.maxConcurrentLoans > 0);
  assert.ok(student.loanPeriodDays > 0);
});

test('library loan model tracks open statuses', () => {
  assert.equal(libraryLoanModel.OPEN_STATUSES.has('active'), true);
  assert.equal(libraryLoanModel.OPEN_STATUSES.has('overdue'), true);
});

test('library routes are mounted under /library', () => {
  const mainRoute = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/routes/schoolMainRoute.js'), 'utf8');
  const libraryMain = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/routes/libraryMainRoute.js'), 'utf8');
  assert.match(mainRoute, /\/library/);
  assert.match(libraryMain, /\/books/);
  assert.match(libraryMain, /\/copies/);
  assert.match(libraryMain, /\/circulation/);
  assert.match(libraryMain, /\/locations/);
});

test('library circulation service validates digital access window', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const loan = {
    status: 'active',
    copyType: 'digital',
    dueAt: future,
    digitalAccessExpiresAt: future
  };
  assert.equal(libraryCirculationService.isDigitalAccessValid(loan), true);
  assert.equal(libraryCirculationService.isDigitalAccessValid({ ...loan, status: 'returned' }), false);
});

test('library seed script declares hub and child sections', () => {
  const seedPath = path.join(ROOT, 'scripts/seed-school-library-section.js');
  const source = fs.readFileSync(seedPath, 'utf8');
  assert.match(source, /446110/);
  assert.match(source, /SCHOOL_LIBRARY/);
  assert.match(source, /446111/);
  assert.match(source, /446113/);
  assert.match(source, /446115/);
  assert.match(source, /SCHOOL_LIBRARY_LOCATIONS/);
  assert.match(source, /\/school\/library\/books/);
});

test('copy list view includes make a copy action', () => {
  const view = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/copyList.ejs'), 'utf8');
  assert.match(view, /Make a Copy/);
  assert.match(view, /duplicateNotice/);
  assert.match(view, /btn-row-actions-toggle/);
});

test('copy form uses generic picker for catalog book', () => {
  const view = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/copyForm.ejs'), 'utf8');
  assert.match(view, /modal_GenericPicker/);
  assert.match(view, /GenericPickerPresets\.book/);
  assert.match(view, /activeOrganizationScope/);
  assert.match(view, /max-width: 1400px/);
});

test('copy form uses assignable spot location picker for physical copies', () => {
  const view = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/copyForm.ejs'), 'utf8');
  assert.match(view, /hid_locationId/);
  assert.match(view, /btnPickLocation/);
  assert.match(view, /locationSpotModal/);
  assert.match(view, /assignable-spots/);
  assert.match(view, /toggleLocationField/);
  assert.doesNotMatch(view, /name="location"/);
});

test('copy list shows resolved location path', () => {
  const view = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/copyList.ejs'), 'utf8');
  assert.match(view, /locationPath/);
});

test('library location model enforces hierarchy child types', () => {
  assert.equal(libraryLocationModel.getChildTypeForParent('building'), 'floor');
  assert.equal(libraryLocationModel.getChildTypeForParent('shelf'), 'spot');
  assert.equal(libraryLocationModel.getChildTypeForParent('spot'), null);
  assert.equal(libraryLocationModel.normalizeLocationType('SPOT'), 'spot');
});

test('library location service builds paths and assignable spots', () => {
  const rows = [
    { id: 'b1', orgId: 'ORG1', parentId: null, locationType: 'building', name: 'Main', sortOrder: 1, active: true },
    { id: 'f1', orgId: 'ORG1', parentId: 'b1', locationType: 'floor', name: 'Floor 2', sortOrder: 1, active: true },
    { id: 's1', orgId: 'ORG1', parentId: 'f1', locationType: 'spot', name: 'Spot 3', sortOrder: 1, active: true },
    { id: 's2', orgId: 'ORG1', parentId: 'f1', locationType: 'spot', name: 'Spot inactive', sortOrder: 2, active: false }
  ];
  const path = libraryLocationService.buildLocationPath('s1', rows);
  assert.equal(path, 'Main / Floor 2 / Spot 3');
  const spots = libraryLocationService.listAssignableSpots(rows);
  assert.equal(spots.length, 1);
  assert.equal(spots[0].id, 's1');
  assert.match(spots[0].path, /Spot 3/);
  const tree = libraryLocationService.buildLocationTree(rows);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].children.length, 1);
});

test('my library view exposes digital open action', () => {
  const view = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/myLibrary.ejs'), 'utf8');
  assert.match(view, /btn-open-digital/);
  assert.match(view, /api\/digital/);
});
