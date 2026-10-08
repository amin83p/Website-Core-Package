const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const studentReportInstancesService = require('../MVC/services/school/studentReportInstancesService');
const reportViewService = require('../MVC/services/school/reportViewService');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('buildPersonReportsFullListUrl uses person id and student scope', () => {
  const url = studentReportInstancesService.buildPersonReportsFullListUrl('146788');
  assert.match(url, /\/school\/reports\/person-reports\?/);
  assert.match(url, /scope=student/);
  assert.match(url, /personId=146788/);
});

test('mapStudentReportInstanceRow builds edit-v2 open links', () => {
  const row = studentReportInstancesService.mapStudentReportInstanceRow({
    id: '362935',
    assignmentId: '285451',
    classId: '609077',
    classTitle: 'Listening A',
    sessionDate: '2026-04-09',
    templateId: 'RPTTPL-1',
    templateTitle: 'Weekly Progress',
    templateVersion: 2,
    teacherId: '560378',
    teacherName: 'Darren',
    studentId: '146788',
    studentName: 'Ajmal Safi',
    status: 'draft'
  });
  assert.equal(row.openV2Url, '/school/reports/instances/edit-v2/362935');
  assert.equal(row.openUrl, '/school/reports/instances/edit/362935');
  assert.equal(row.templateTitle, 'Weekly Progress');
  assert.equal(row.status, 'draft');
});

test('listStudentReportInstancesForForm filters by person id not student record id', async () => {
  const original = reportViewService.buildPersonReportListContext;
  let captured = null;
  reportViewService.buildPersonReportListContext = async (args) => {
    captured = args;
    return {
      isAdminViewer: true,
      selectedPersonId: '146788',
      rows: [
        {
          id: 'RI-1',
          studentId: '146788',
          templateTitle: 'Progress',
          classTitle: 'Class A',
          sessionDate: '2026-04-01',
          teacherName: 'Teacher',
          status: 'submitted',
          templateVersion: 1
        },
        {
          id: 'RI-OTHER',
          studentId: '999999',
          templateTitle: 'Other',
          classTitle: 'Class B',
          sessionDate: '2026-04-02',
          teacherName: 'Teacher',
          status: 'draft',
          templateVersion: 1
        }
      ]
    };
  };
  try {
    const result = await studentReportInstancesService.listStudentReportInstancesForForm({
      reqUser: { id: 'USER-1', personId: 'ADMIN-1' },
      personId: '146788'
    });
    assert.equal(captured.requestedScope, 'student');
    assert.equal(captured.requestedPersonId, '146788');
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].id, 'RI-1');
    assert.match(result.fullListUrl, /personId=146788/);
    assert.equal(result.accessNote, '');
  } finally {
    reportViewService.buildPersonReportListContext = original;
  }
});

test('listStudentReportInstancesForForm returns access note when non-admin cannot view student', async () => {
  const original = reportViewService.buildPersonReportListContext;
  reportViewService.buildPersonReportListContext = async () => ({
    isAdminViewer: false,
    selectedPersonId: 'TEACHER-1',
    rows: [{ id: 'RI-X', studentId: '146788', status: 'draft' }]
  });
  try {
    const result = await studentReportInstancesService.listStudentReportInstancesForForm({
      reqUser: { id: 'USER-1', personId: 'TEACHER-1' },
      personId: '146788'
    });
    assert.equal(result.rows.length, 0);
    assert.match(result.accessNote, /report administrators/i);
  } finally {
    reportViewService.buildPersonReportListContext = original;
  }
});

test('student form wires Reports tab and partial on edit', () => {
  const form = read('MVC/views/school/student/studentForm.ejs');
  const controller = read('MVC/controllers/school/studentController.js');
  const partial = read('MVC/views/school/partials/studentReportInstancesTable.ejs');

  assert.match(form, /data-bs-target="#tab-reports"/);
  assert.match(form, /Step 5: Reports/);
  assert.match(form, /Step <%= isEdit \? '6' : '4' %>: Documents/);
  assert.match(form, /#tab-reports/);
  assert.match(form, /studentReportInstancesTable/);
  assert.match(
    form,
    /JSON\.stringify\(\['#tab-general', '#tab-financial', '#tab-programs', '#tab-enrollments', '#tab-reports', '#tab-documents'\]\)/
  );

  assert.match(controller, /studentReportInstancesService/);
  assert.match(controller, /listStudentReportInstancesForForm/);
  assert.match(controller, /studentReportInstanceRows/);
  assert.match(controller, /personId:\s*student\.personId/);

  assert.match(partial, /Open V2/);
  assert.match(partial, /openV2Url/);
  assert.match(partial, /btn-row-actions-toggle/);
  assert.match(partial, /bi-three-dots-vertical/);
  assert.match(partial, /data-floating-row-actions="true"/);
  assert.match(partial, /No report instances found for this student/);
});
