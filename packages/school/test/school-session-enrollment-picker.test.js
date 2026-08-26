const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pickerService = require('../MVC/services/school/sessionEnrollmentPickerService');
const schoolDataService = require('../MVC/services/school/schoolDataService');
const sessionStatusPolicyService = require('../MVC/services/school/sessionStatusPolicyService');

const classData = {
  id: 'CLS_PICKER_001',
  orgId: 'ORG_900000',
  registrationMode: 'rolling',
  instructors: [{ personId: 'TCH_001', name: 'Ms. Rivera', status: 'active' }]
};

function scheduledSession(id, date, startTime = '09:00', endTime = '12:00', extra = {}) {
  return {
    sessionId: id,
    date,
    startTime,
    endTime,
    status: 'scheduled',
    durationHours: 3,
    ...extra
  };
}

test('computeViewRange week anchors to Monday', () => {
  const range = pickerService.computeViewRange('week', '2026-01-15');
  assert.equal(range.startDate, '2026-01-12');
  assert.equal(range.endDate, '2026-01-18');
  assert.equal(range.preset, 'week');
});

test('computeViewRange twoWeeks spans fourteen days', () => {
  const range = pickerService.computeViewRange('twoWeeks', '2026-02-10');
  assert.equal(range.startDate, '2026-02-09');
  assert.equal(range.endDate, '2026-02-22');
});

test('computeViewRange twoMonths covers two calendar months', () => {
  const range = pickerService.computeViewRange('twoMonths', '2026-03-20');
  assert.equal(range.startDate, '2026-03-01');
  assert.equal(range.endDate, '2026-04-30');
});

test('computeViewRange threeMonths covers three calendar months', () => {
  const range = pickerService.computeViewRange('threeMonths', '2026-05-10');
  assert.equal(range.startDate, '2026-05-01');
  assert.equal(range.endDate, '2026-07-31');
});

test('computeViewRange fourMonths fiveMonths and sixMonths cover expected spans', () => {
  const four = pickerService.computeViewRange('fourMonths', '2026-01-20');
  assert.equal(four.startDate, '2026-01-01');
  assert.equal(four.endDate, '2026-04-30');

  const five = pickerService.computeViewRange('fiveMonths', '2026-01-20');
  assert.equal(five.startDate, '2026-01-01');
  assert.equal(five.endDate, '2026-05-31');

  const six = pickerService.computeViewRange('sixMonths', '2026-01-20');
  assert.equal(six.startDate, '2026-01-01');
  assert.equal(six.endDate, '2026-06-30');
});

test('computeWholeCycleViewRange and computeCustomViewRange return enrollment spans', () => {
  const whole = pickerService.computeWholeCycleViewRange({
    startDate: '2026-01-10',
    endDate: '2026-08-31'
  });
  assert.equal(whole.preset, 'wholeCycle');
  assert.equal(whole.startDate, '2026-01-10');
  assert.equal(whole.endDate, '2026-08-31');

  const custom = pickerService.computeCustomViewRange('2026-02-01', '2026-03-15');
  assert.equal(custom.preset, 'custom');
  assert.equal(custom.startDate, '2026-02-01');
  assert.equal(custom.endDate, '2026-03-15');
});

test('clampViewRangeToBounds keeps custom ranges inside enrollment window', () => {
  const clamped = pickerService.clampViewRangeToBounds(
    { startDate: '2026-01-01', endDate: '2026-12-31', preset: 'custom', anchorDate: '2026-01-01' },
    { minDate: '2026-02-01', maxDate: '2026-08-31' }
  );
  assert.equal(clamped.startDate, '2026-02-01');
  assert.equal(clamped.endDate, '2026-08-31');
});

test('summarizeSelection totals hours and date span', () => {
  const events = [
    { sessionId: 'SES_1', date: '2026-01-10', durationHours: 2 },
    { sessionId: 'SES_2', date: '2026-01-20', durationHours: 1.5 }
  ];
  const summary = pickerService.summarizeSelection(events, ['SES_1', 'SES_2']);
  assert.equal(summary.selectedCount, 2);
  assert.equal(summary.selectedHours, 3.5);
  assert.equal(summary.selectionStartDate, '2026-01-10');
  assert.equal(summary.selectionEndDate, '2026-01-20');
});

test('buildManageSessionUrl encodes class and session ids', () => {
  const url = pickerService.buildManageSessionUrl('CLS_PICKER_001', 'SES_001');
  assert.match(url, /\/school\/classes\/CLS_PICKER_001\/sessions\/SES_001$/);
});

test('buildEnrollmentSessionPickerPayload marks countable sessions selectable and builds manage urls', async () => {
  const sessions = [
    scheduledSession('SES_001', '2026-01-05', '09:00', '12:00', {
      delivery: { deliveredByName: 'Coach A' }
    }),
    scheduledSession('SES_002', '2025-12-01', '09:00', '12:00', { status: 'scheduled' })
  ];
  const originalGetSessions = schoolDataService.getClassSessions;
  const originalStatusMap = sessionStatusPolicyService.getStatusMap;
  schoolDataService.getClassSessions = async () => sessions;
  sessionStatusPolicyService.getStatusMap = async () => ({
    scheduled: { key: 'scheduled', label: 'Scheduled', countable: true, active: true }
  });

  try {
    const payload = await pickerService.buildEnrollmentSessionPickerPayload({
      classData,
      studentId: 'STU_001',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      targetSessionCount: 1,
      selectedSessionIds: ['SES_001'],
      sessionsToCreate: [{
        sessionId: 'STAGED_001',
        date: '2026-01-19',
        startTime: '10:00',
        endTime: '11:00',
        status: 'scheduled',
        durationHours: 1
      }],
      viewPreset: 'month',
      anchorDate: '2026-01-15',
      reqUser: { activeOrgId: classData.orgId }
    });

    assert.equal(payload.allEvents.length, 3);
    const scheduledEvent = payload.allEvents.find((row) => row.sessionId === 'SES_001');
    assert.equal(scheduledEvent.selectable, true);
    assert.equal(scheduledEvent.selected, true);
    assert.equal(scheduledEvent.teacherName, 'Coach A');
    assert.match(scheduledEvent.manageSessionUrl, /SES_001$/);

    const cancelledEvent = payload.allEvents.find((row) => row.sessionId === 'SES_002');
    assert.equal(cancelledEvent.selectable, false);
    assert.equal(cancelledEvent.excludeReason, 'out_of_window');

    const stagedEvent = payload.allEvents.find((row) => row.sessionId === 'STAGED_001');
    assert.equal(stagedEvent.isStaged, true);
    assert.equal(stagedEvent.selectable, true);

    assert.ok(Array.isArray(payload.events));
    assert.equal(payload.viewRange.preset, 'month');
    assert.equal(payload.summary.selectedCount, 1);
    assert.equal(payload.enrollmentAlignment.alignmentStatus, 'overage_requires_na');
  } finally {
    schoolDataService.getClassSessions = originalGetSessions;
    sessionStatusPolicyService.getStatusMap = originalStatusMap;
  }
});

test('buildEnrollmentSessionPickerPayload rejects mixed session and hour targets', async () => {
  await assert.rejects(
    () => pickerService.buildEnrollmentSessionPickerPayload({
      classData,
      startDate: '2026-01-01',
      targetSessionCount: 3,
      targetHours: 9,
      reqUser: { activeOrgId: classData.orgId }
    }),
    /not both/i
  );
});

test('client SessionCalendarCore mirrors range math and grouping', () => {
  const scriptPath = path.join(__dirname, '../public/scripts/sessionCalendarCore.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox);
  const core = sandbox.window.SessionCalendarCore;
  assert.ok(core);
  const range = core.computeViewRange('week', '2026-01-15');
  assert.equal(range.startDate, '2026-01-12');
  const grouped = core.groupEventsByDate([
    { date: '2026-01-05', start: '09:00', teacherName: 'A' },
    { date: '2026-01-05', start: '10:00', teacherName: 'B' }
  ]);
  assert.equal(grouped['2026-01-05'].length, 2);
  assert.equal(core.suggestViewModeForPreset('threeMonths'), 'vertical');
  const fourMonthRange = core.computeViewRange('fourMonths', '2026-03-15');
  assert.equal(fourMonthRange.startDate, '2026-03-01');
  assert.equal(fourMonthRange.endDate, '2026-06-30');
  const wholeCycle = core.computeWholeCycleViewRange({ startDate: '2026-01-01', endDate: '2026-06-30' });
  assert.equal(wholeCycle.preset, 'wholeCycle');
  const shiftedFour = core.shiftViewRange(fourMonthRange, 1);
  assert.equal(shiftedFour.startDate, '2026-07-01');
  const shifted = core.shiftViewRange(range, 1);
  assert.equal(shifted.startDate, '2026-01-19');
});

test('client SessionCalendarCore filters events and builds week blocks', () => {
  const scriptPath = path.join(__dirname, '../public/scripts/sessionCalendarCore.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox);
  const core = sandbox.window.SessionCalendarCore;
  const range = core.computeViewRange('week', '2026-01-15');
  const events = [
    { date: '2026-01-10', sessionId: 'A' },
    { date: '2026-01-15', sessionId: 'B' },
    { date: '2026-01-20', sessionId: 'C' }
  ];
  const filtered = core.filterEventsByViewRange(events, range);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].sessionId, 'B');

  const twoWeekRange = core.computeViewRange('twoWeeks', '2026-01-15');
  const weekBlocks = core.buildWeekBlocks(twoWeekRange);
  assert.equal(weekBlocks.length, 2);
  assert.equal(weekBlocks[0].days.length, 7);
  assert.equal(weekBlocks[0].days[0].date, '2026-01-12');
  assert.equal(weekBlocks[0].days[0].inRange, true);
  assert.equal(weekBlocks[1].days[6].date, '2026-01-25');

  const monthRange = core.computeViewRange('month', '2026-01-15');
  const monthWeeks = core.buildWeekBlocks(monthRange);
  assert.ok(monthWeeks.length >= 4);
  const partialWeek = monthWeeks[0];
  assert.equal(partialWeek.days.length, 7);
  assert.equal(partialWeek.days[0].inRange, false);
  assert.equal(partialWeek.days[partialWeek.days.length - 1].inRange, true);
});

function loadSessionCalendarCore() {
  const scriptPath = path.join(__dirname, '../public/scripts/sessionCalendarCore.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox);
  return sandbox.window.SessionCalendarCore;
}

test('collectBulkNaSessions filters by inclusive date range and action eligibility', () => {
  const core = loadSessionCalendarCore();
  const events = [
    { sessionId: 'S1', date: '2026-01-05', durationHours: 1 },
    { sessionId: 'S2', date: '2026-01-10', durationHours: 1, savedMarked: true },
    { sessionId: 'S3', date: '2026-01-20', durationHours: 1 },
    { sessionId: 'S4', date: '2026-02-01', durationHours: 1, savedRosterNa: true }
  ];
  const pending = new Map([['S1', { action: 'mark_na', note: 'pending' }]]);

  const toMark = core.collectBulkNaSessions(events, pending, '2026-01-01', '2026-01-31', 'mark_na');
  assert.deepEqual(toMark.map((row) => row.sessionId), ['S3']);

  const toUnmark = core.collectBulkNaSessions(events, pending, '2026-01-01', '2026-01-31', 'unmark');
  assert.deepEqual(toUnmark.map((row) => row.sessionId).sort(), ['S1', 'S2']);
});

test('applyBulkPendingChanges stages mark and unmark entries for bulk actions', () => {
  const core = loadSessionCalendarCore();
  const events = [
    { sessionId: 'S1', date: '2026-01-05', durationHours: 1 },
    { sessionId: 'S2', date: '2026-01-10', durationHours: 1, savedMarked: true }
  ];
  const pending = new Map();

  const marked = core.applyBulkPendingChanges(pending, events, 'mark_na', 'Vacation');
  assert.equal(marked.get('S1')?.action, 'mark_na');
  assert.equal(marked.get('S1')?.note, 'Vacation');
  assert.equal(marked.get('S2')?.action, 'mark_na');

  const unmarked = core.applyBulkPendingChanges(marked, [events[1]], 'unmark', '');
  assert.equal(unmarked.get('S2')?.action, 'unmark');
  assert.equal(unmarked.has('S1'), true);
});

test('getEnrollmentCapBalance reflects bulk pending preview state', () => {
  const core = loadSessionCalendarCore();
  const events = [
    { sessionId: 'S1', date: '2026-01-05', durationHours: 1 },
    { sessionId: 'S2', date: '2026-01-10', durationHours: 1 },
    { sessionId: 'S3', date: '2026-01-20', durationHours: 1 }
  ];
  const pending = core.applyBulkPendingChanges(new Map(), [events[0]], 'mark_na', 'Away');
  const balance = core.getEnrollmentCapBalance(events, pending, 2, 0);
  assert.equal(balance.requiredNaCount, 1);
  assert.equal(balance.naCount, 1);
  assert.equal(balance.balanced, true);

  const overMarked = core.applyBulkPendingChanges(new Map(), events, 'mark_na', 'Away');
  const overBalance = core.getEnrollmentCapBalance(events, overMarked, 2, 0);
  assert.equal(overBalance.naCount, 3);
  assert.equal(overBalance.balanced, false);
});

test('getEnrollmentCapBalance ignores roster-only N/A when counting enrollment marks', () => {
  const core = loadSessionCalendarCore();
  const events = [
    { sessionId: 'S1', date: '2026-01-05', durationHours: 1, savedRosterNa: true },
    { sessionId: 'S2', date: '2026-01-10', durationHours: 1 },
    { sessionId: 'S3', date: '2026-01-20', durationHours: 1 }
  ];
  const pending = core.applyBulkPendingChanges(new Map(), [events[1]], 'mark_na', 'Away');
  const balance = core.getEnrollmentCapBalance(events, pending, 2, 0);
  assert.equal(balance.requiredNaCount, 1);
  assert.equal(balance.naCount, 1);
  assert.equal(balance.balanced, true);
  assert.equal(core.resolveEnrollmentNaState(events[0], pending), 'saved');
  assert.equal(core.resolveEnrollmentNaStateForCap(events[0], pending), 'normal');
});

test('getEnrollmentCapBalance treats under-target enrollments as optional N/A marks', () => {
  const core = loadSessionCalendarCore();
  const events = Array.from({ length: 72 }, (_, idx) => ({
    sessionId: `S${idx + 1}`,
    date: `2026-01-${String((idx % 28) + 1).padStart(2, '0')}`,
    durationHours: 3
  }));
  const pending = core.applyBulkPendingChanges(new Map(), [events[0], events[1]], 'mark_na', 'Away');
  const balance = core.getEnrollmentCapBalance(events, pending, 96, 0);
  assert.equal(balance.insufficientSessions, true);
  assert.equal(balance.gapCount, 24);
  assert.equal(balance.balanced, true);
  assert.equal(balance.naCount, 2);
});
