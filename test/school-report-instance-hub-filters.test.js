const test = require('node:test');
const assert = require('node:assert/strict');

const reportViewService = require('../packages/school/MVC/services/school/reportViewService');

test('buildInstanceScheduleFilters parses hub multi-select and due-date params', () => {
  const filters = reportViewService.buildInstanceScheduleFilters({
    templateId: 'TPL-1',
    classIds: 'CLS-1,CLS-2',
    teacherPersonId: 'TEA-1,TEA-2',
    studentPersonId: 'STU-1',
    dueDateStart: '2026-06-01',
    dueDateEnd: '2026-06-30',
    status: 'draft'
  });

  assert.equal(filters.templateId, 'TPL-1');
  assert.deepEqual(filters.classIds, ['CLS-1', 'CLS-2']);
  assert.deepEqual(filters.teacherIds, ['TEA-1', 'TEA-2']);
  assert.deepEqual(filters.studentIds, ['STU-1']);
  assert.equal(filters.dueDateStart, '2026-06-01');
  assert.equal(filters.dueDateEnd, '2026-06-30');
  assert.equal(filters.status, 'draft');
});

test('rowMatchesInstanceFilters applies template, class, teacher, student, status, and due-date filters', () => {
  const baseRow = {
    templateId: 'TPL-1',
    classId: 'CLS-1',
    teacherId: 'TEA-1',
    studentId: 'STU-1',
    status: 'draft',
    isPendingAssignment: false,
    reportDueDate: '2026-06-15'
  };
  const filters = reportViewService.buildInstanceScheduleFilters({
    templateId: 'TPL-1',
    classIds: 'CLS-1,CLS-9',
    teacherIds: 'TEA-1',
    studentIds: 'STU-1',
    dueDateStart: '2026-06-01',
    dueDateEnd: '2026-06-30',
    status: 'draft'
  });

  assert.equal(reportViewService.rowMatchesInstanceFilters(baseRow, filters), true);
  assert.equal(reportViewService.rowMatchesInstanceFilters({ ...baseRow, templateId: 'TPL-2' }, filters), false);
  assert.equal(reportViewService.rowMatchesInstanceFilters({ ...baseRow, classId: 'CLS-3' }, filters), false);
  assert.equal(reportViewService.rowMatchesInstanceFilters({ ...baseRow, teacherId: 'TEA-9' }, filters), false);
  assert.equal(reportViewService.rowMatchesInstanceFilters({ ...baseRow, studentId: '' }, filters), false);
  assert.equal(reportViewService.rowMatchesInstanceFilters({ ...baseRow, reportDueDate: '2026-05-31' }, filters), false);
  assert.equal(reportViewService.rowMatchesInstanceFilters({ ...baseRow, reportDueDate: '2026-07-01' }, filters), false);
  assert.equal(reportViewService.rowMatchesInstanceFilters({ ...baseRow, status: 'submitted' }, filters), false);
});

test('rowMatchesInstanceFilters handles pending status separately from draft instances', () => {
  const pendingFilters = reportViewService.buildInstanceScheduleFilters({ status: 'pending' });
  const draftFilters = reportViewService.buildInstanceScheduleFilters({ status: 'draft' });

  assert.equal(reportViewService.rowMatchesInstanceFilters({
    isPendingAssignment: true,
    status: 'pending'
  }, pendingFilters), true);
  assert.equal(reportViewService.rowMatchesInstanceFilters({
    isPendingAssignment: false,
    status: 'draft'
  }, pendingFilters), false);
  assert.equal(reportViewService.rowMatchesInstanceFilters({
    isPendingAssignment: true,
    status: 'pending'
  }, draftFilters), false);
  assert.equal(reportViewService.rowMatchesInstanceFilters({
    isPendingAssignment: false,
    status: 'draft'
  }, draftFilters), true);
});

test('resolveInstanceReportDueDate prefers assignment target row due date', () => {
  const dueDate = reportViewService.resolveInstanceReportDueDate(
    { assignmentRowId: 'row_a', sessionDate: '2026-06-10' },
    {
      reportDueDate: '2026-06-01',
      targetRows: [
        { rowId: 'row_a', reportDueDate: '2026-06-20' }
      ]
    }
  );

  assert.equal(dueDate, '2026-06-20');
});
