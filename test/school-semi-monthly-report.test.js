const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const schoolSemiMonthlyReportService = require('../packages/school/MVC/services/school/schoolSemiMonthlyReportService');
const { listSchoolSettingsGroups } = require('../packages/school/MVC/config/schoolSettingsCatalog');

test('filterReportInstancesForClass matches template, date, class, and student', () => {
  const templateIdSet = schoolSemiMonthlyReportService.buildTemplateIdSet(['TPL-1']);
  const instances = [
    {
      id: 'INS-1',
      classId: 'CLS-1',
      templateId: 'TPL-1',
      sessionDate: '2026-01-10',
      studentId: 'STU-1',
      status: 'submitted'
    },
    {
      id: 'INS-2',
      classId: 'CLS-1',
      templateId: 'TPL-2',
      sessionDate: '2026-01-10',
      studentId: 'STU-1',
      status: 'draft'
    },
    {
      id: 'INS-3',
      classId: 'CLS-1',
      templateId: 'TPL-1',
      sessionDate: '2026-02-01',
      studentId: 'STU-1',
      status: 'draft'
    },
    {
      id: 'INS-4',
      classId: 'CLS-1',
      templateId: 'TPL-1',
      sessionDate: '2026-01-12',
      studentId: '',
      status: 'draft'
    }
  ];
  const matched = schoolSemiMonthlyReportService.filterReportInstancesForClass({
    instances,
    templateIdSet,
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    classId: 'CLS-1',
    studentRecordId: 'STU-1',
    personId: 'STU-1'
  });
  assert.deepEqual(matched.map((row) => row.id).sort(), ['INS-1', 'INS-4']);
});

test('instanceMatchesStudent allows class-level instances without studentId', () => {
  assert.equal(schoolSemiMonthlyReportService.instanceMatchesStudent({ studentId: '' }, 'STU-9'), true);
  assert.equal(schoolSemiMonthlyReportService.instanceMatchesStudent({ studentId: 'STU-9' }, 'STU-9'), true);
  assert.equal(schoolSemiMonthlyReportService.instanceMatchesStudent({ studentId: 'STU-1' }, 'STU-9'), false);
});

test('instanceMatchesStudent matches person id on instance studentId', () => {
  assert.equal(
    schoolSemiMonthlyReportService.instanceMatchesStudent({ studentId: '663857' }, 'STU28435', '663857'),
    true
  );
  assert.equal(
    schoolSemiMonthlyReportService.instanceMatchesStudent({
      studentId: '995578',
      prefillSnapshot: { student_record_id: 'STU16893' }
    }, 'STU16893'),
    true
  );
});

test('semi-monthly report viewer wires picker and data API', () => {
  const view = fs.readFileSync(
    path.join(__dirname, '../packages/school/MVC/views/school/report/semiMonthlyReportViewer.ejs'),
    'utf8'
  );
  assert.match(view, /id="btn_openStudentPicker"/);
  assert.match(view, /id="btn_openSchoolStudentPicker"/);
  assert.match(view, /\/school\/reports\/semi-monthly\/api\/data/);
  assert.match(view, /student-report-table/);
  assert.match(view, /matrix-sticky-class/);
  assert.match(view, /sar-matrix-link/);
  assert.match(view, /include\('partials\/modal_GenericPicker'\)/);
  assert.match(view, /include\('school\/partials\/modal_SchoolEntityPicker'\)/);
});

test('school settings catalog includes semi-monthly report group', () => {
  const groups = listSchoolSettingsGroups();
  assert.ok(groups.some((row) => row.key === 'school-semi-monthly-report'));
});
