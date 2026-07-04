const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeTimesheetHoursForEvents } = require('../packages/school/MVC/controllers/school/scheduleController');
const sessionStatusPolicyService = require('../packages/school/MVC/services/school/sessionStatusPolicyService');

function buildStatusMap() {
  return sessionStatusPolicyService.getStatusMetaMap([
    { code: 'scheduled', timesheetFormula: 'duration' },
    { code: 'completed', timesheetFormula: 'duration' },
    { code: 'cancelled', timesheetFormula: '0' }
  ]);
}

test('summarizeTimesheetHoursForEvents uses status policy for class sessions', () => {
  const statusMap = buildStatusMap();
  const result = summarizeTimesheetHoursForEvents([
    {
      eventType: 'class_session',
      sessionId: 'S1',
      status: 'scheduled',
      duration: 2
    },
    {
      eventType: 'class_session',
      sessionId: 'S2',
      status: 'cancelled',
      duration: 3
    }
  ], statusMap);

  assert.equal(result.totalTimesheetHours, 2);
  assert.equal(result.eventCount, 2);
  assert.equal(result.overlapCount, 0);
});

test('summarizeTimesheetHoursForEvents counts overlaps and skips approved leave', () => {
  const statusMap = buildStatusMap();
  const result = summarizeTimesheetHoursForEvents([
    {
      eventType: 'leave_request',
      status: 'approved_leave',
      duration: 8,
      hasOverlap: true
    },
    {
      eventType: 'report_task',
      duration: 1.5
    }
  ], statusMap);

  assert.equal(result.totalTimesheetHours, 1.5);
  assert.equal(result.eventCount, 2);
  assert.equal(result.overlapCount, 1);
});

test('summarizeTimesheetHoursForEvents returns zeros for empty input', () => {
  const statusMap = buildStatusMap();
  const result = summarizeTimesheetHoursForEvents([], statusMap);
  assert.equal(result.totalTimesheetHours, 0);
  assert.equal(result.eventCount, 0);
  assert.equal(result.overlapCount, 0);
});
