const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const ROOT_DIR = path.resolve(__dirname, '..');
const CORE_VIEW_ROOT = path.join(ROOT_DIR, 'MVC/views');
const SCHOOL_VIEW_ROOT = path.join(ROOT_DIR, 'packages/school/MVC/views/school');
const SCHOOL_PACKAGE_VIEW_ROOT = path.join(ROOT_DIR, 'packages/school/MVC/views');
const SCHOOL_PARTIAL_ROOT = path.join(ROOT_DIR, 'packages/school/MVC/views/partials');

function walkFiles(directory) {
  const out = [];
  if (!fs.existsSync(directory)) return out;
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(fullPath));
      return;
    }
    if (entry.isFile()) out.push(fullPath);
  });
  return out;
}

test('school package views should use core shared partials without local shared partial mirrors', () => {
  const partialFiles = walkFiles(SCHOOL_PARTIAL_ROOT)
    .map((filePath) => path.relative(SCHOOL_PARTIAL_ROOT, filePath).replace(/\\/g, '/'))
    .filter((filePath) => filePath.endsWith('.ejs'));

  const forbiddenMirrors = [
    'dashboard/unifiedDashboard.ejs',
    'modal_GenericPicker.ejs',
    'pagination.ejs',
    'tablePages-start.ejs',
    'tablePages-search.ejs',
    'tablePages-end.ejs'
  ];

  const mirrored = forbiddenMirrors.filter((partialPath) => partialFiles.includes(partialPath));
  assert.deepEqual(mirrored, []);

  forbiddenMirrors.forEach((partialPath) => {
    assert.equal(
      fs.existsSync(path.join(CORE_VIEW_ROOT, 'partials', partialPath)),
      true,
      `Expected shared core partial to exist: ${partialPath}`
    );
  });
});

test('school package views should use stable partial include paths', () => {
  const viewFiles = walkFiles(SCHOOL_VIEW_ROOT).filter((filePath) => filePath.endsWith('.ejs'));
  const offenders = [];

  viewFiles.forEach((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(SCHOOL_VIEW_ROOT, filePath).replace(/\\/g, '/');

    if (/include\(\s*['"]\.\.\//.test(source)) {
      offenders.push(`${relativePath}: contains relative include traversal`);
    }
    if (/include\(\s*['"](?:MVC\/views|packages\/)/.test(source)) {
      offenders.push(`${relativePath}: includes direct root/package filesystem path`);
    }
  });

  assert.deepEqual(offenders, []);
});

test('school-owned partials resolve through the package view root', async () => {
  const html = await ejs.render(
    `<%- include('school/partials/studentNameLink', {
      name: 'Test Student',
      studentRecordId: 'STU_TEST',
      canOpenStudentProfile: true,
      linkClass: 'test-link'
    }) %>`,
    {},
    {
      filename: path.join(SCHOOL_VIEW_ROOT, 'class/finalGrades.ejs'),
      views: [CORE_VIEW_ROOT, SCHOOL_PACKAGE_VIEW_ROOT]
    }
  );

  assert.match(html, /Test Student/);
  assert.match(html, /test-link/);
});

test('school rolling enrollment below-heading include resolves through package view root', async () => {
  const rollingEnrollmentView = path.join(SCHOOL_VIEW_ROOT, 'class/rollingEnrollment.ejs');
  const rollingEnrollmentSource = fs.readFileSync(rollingEnrollmentView, 'utf8');

  assert.match(
    rollingEnrollmentSource,
    /belowHeadingInclude:\s*['"]school\/class\/rollingEnrollmentBelowHeading['"]/,
    'rolling enrollment should use a view-root relative belowHeadingInclude path'
  );
  assert.doesNotMatch(
    rollingEnrollmentSource,
    /belowHeadingInclude:\s*['"]\.\.\//,
    'rolling enrollment belowHeadingInclude must not traverse relative to the core partial folder'
  );

  const tableStartPath = path.join(CORE_VIEW_ROOT, 'partials/tablePages-start.ejs');
  const html = await ejs.renderFile(tableStartPath, {
    title: 'Rolling Enrollment',
    user: {},
    tableName: 'schoolClassEnrollmentPeriods',
    belowHeadingInclude: 'school/class/rollingEnrollmentBelowHeading',
    classData: {
      id: 'CLS_TEST',
      title: 'Test Class',
      registrationMode: 'rolling'
    },
    lifecycleContext: {
      activePeriodCount: 1,
      openPeriodCount: 1
    }
  }, {
    views: [CORE_VIEW_ROOT, SCHOOL_PACKAGE_VIEW_ROOT]
  });

  assert.match(html, /Test Class/);
  assert.match(html, /Rolling/);
});
