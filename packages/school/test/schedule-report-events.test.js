const test = require('node:test');
const assert = require('node:assert/strict');

const scheduleController = require('../MVC/controllers/school/scheduleController');
const teacherIdentityService = require('../MVC/services/school/teacherIdentityService');

test('isTeacherAssignedOnReportAssignment matches person and teacher record ids', () => {
  const teacherPersonMap = teacherIdentityService.buildTeacherPersonMap([
    { id: 'TCH-1', personId: 'PER-1' }
  ]);
  const assignment = { teacherIds: ['TCH-1'] };
  assert.equal(
    scheduleController.isTeacherAssignedOnReportAssignment(assignment, 'PER-1', teacherPersonMap),
    true
  );
  assert.equal(
    scheduleController.isTeacherAssignedOnReportAssignment(assignment, 'PER-2', teacherPersonMap),
    false
  );
});

test('resolveReportTemplateTitle resolves title and avoids numeric template id fallback', () => {
  const templateMap = new Map([['TMP-1', 'Progress Report']]);
  assert.equal(scheduleController.resolveReportTemplateTitle(templateMap, 'TMP-1'), 'Progress Report');
  assert.equal(scheduleController.resolveReportTemplateTitle(templateMap, '999999'), 'Report');
  assert.equal(scheduleController.resolveReportTemplateTitle(new Map([['TMP-2', '285451']]), 'TMP-2'), 'Report');
});

test('isReadableReportTitle rejects numeric-only labels', () => {
  assert.equal(scheduleController.isReadableReportTitle('Two-Week Progress Report'), true);
  assert.equal(scheduleController.isReadableReportTitle('285451'), false);
});

test('filterEventsWithCasesIfRequested keeps report_task events', () => {
  const events = [
    { eventType: 'class_session', caseSummary: { hasCases: false } },
    { eventType: 'report_task', assignmentId: 'ASN-1' }
  ];
  const filtered = scheduleController.filterEventsWithCasesIfRequested(events, { hasCases: '1' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].eventType, 'report_task');
});
