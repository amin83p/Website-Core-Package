const test = require('node:test');
const assert = require('node:assert/strict');

const tip = require('../packages/school/public/scripts/attendanceCellHoverTip');

const fullVisibility = {
  showStudentNote: true,
  showExcuseRef: true,
  showExcuseAttachment: true,
  showAdminDiscussion: true,
  showExcuseMarks: true
};

const fullAccess = {
  canMarkExcused: true,
  canEditRoster: true,
  canOverrideSessionLock: false,
  fieldVisibility: fullVisibility
};

test('buildAttendanceCellTipModel includes excuse toggles when permitted and timed', () => {
  const model = tip.buildAttendanceCellTipModel({
    status: 'late',
    sessionId: 'SES-1',
    lateMinutes: 12,
    breakLateMinutes: 5,
    attendanceArrivalTime: '09:12',
    lateExcused: false,
    earlyLeaveMinutes: 0
  }, fullAccess);

  assert.equal(model.statusLabel, 'Late');
  assert.ok(model.sections.some((section) => section.id === 'late'));
  assert.ok(model.buttons.some((btn) => btn.kind === 'late' && btn.label === 'Mark late excused'));
  assert.equal(model.hasInteractive, false);
  const html = tip.buildTipHtmlFromModel(model);
  assert.ok(!html.includes('att-tip-excuse-btn'));
  assert.ok(!html.includes('data-att-excuse-kind'));
});

test('buildAttendanceCellTipModel hides comment blocks when field visibility is stripped', () => {
  const model = tip.buildAttendanceCellTipModel({
    status: 'present',
    excuseRef: 'Doctor note',
    rosterStudentNotes: 'Student was ill',
    comments: [{ authorName: 'Admin', text: 'Follow up' }]
  }, {
    ...fullAccess,
    fieldVisibility: {
      showExcuseRef: false,
      showStudentNote: false,
      showAdminDiscussion: false
    }
  });

  assert.equal(model.commentBlocks.length, 0);
});

test('canShowExcuseToggle is false when attendance edit is locked', () => {
  const record = {
    status: 'late',
    lateMinutes: 10,
    attendanceEditLocked: true
  };
  assert.equal(tip.canShowExcuseToggle(record, fullAccess, 'late'), false);
  const model = tip.buildAttendanceCellTipModel(record, fullAccess);
  assert.equal(model.buttons.length, 0);
  assert.equal(model.hasInteractive, false);
});

test('buildAttendanceCellTipModel shows absence toggle for absent status without late/early', () => {
  const model = tip.buildAttendanceCellTipModel({
    status: 'absent',
    sessionId: 'SES-2',
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    absenceExcused: false
  }, fullAccess);

  assert.ok(model.buttons.some((btn) => btn.kind === 'absence'));
});

test('buildAttendanceCellTipModel omits arrival row when only total late minutes present', () => {
  const model = tip.buildAttendanceCellTipModel({
    status: 'late',
    lateMinutes: 12,
    breakLateMinutes: 0,
    attendanceArrivalTime: '',
    lateExcused: false
  }, fullAccess);

  const lateSection = model.sections.find((section) => section.id === 'late');
  assert.ok(lateSection);
  assert.equal(lateSection.rows.length, 1);
  assert.equal(lateSection.rows[0].label, 'Late:');
  assert.equal(lateSection.rows[0].value, '12 min');
  assert.ok(!lateSection.rows.some((row) => row.label === 'Late Arrival At:'));
});

test('buildAttendanceCellTipModel marks absence excused status for styling', () => {
  const model = tip.buildAttendanceCellTipModel({
    status: 'absent',
    absenceExcused: true
  }, fullAccess);

  assert.equal(model.statusAbsenceExcused, true);
  const html = tip.buildTipHtmlFromModel(model);
  assert.ok(html.includes('att-tip-status-excused'));
});

test('buildExcuseContextMenuItems mirrors model buttons for context menu', () => {
  const model = tip.buildAttendanceCellTipModel({
    status: 'late',
    lateMinutes: 8,
    lateExcused: false
  }, fullAccess);
  const items = tip.buildExcuseContextMenuItems(model);
  assert.equal(items.length, model.buttons.length);
  assert.ok(items.some((btn) => btn.kind === 'late'));
});

test('canShowExcuseToggle requires canMarkExcused and canEditRoster', () => {
  const record = { status: 'late', lateMinutes: 5 };
  assert.equal(tip.canShowExcuseToggle(record, { ...fullAccess, canMarkExcused: false }, 'late'), false);
  assert.equal(tip.canShowExcuseToggle(record, { ...fullAccess, canEditRoster: false }, 'late'), false);
});
