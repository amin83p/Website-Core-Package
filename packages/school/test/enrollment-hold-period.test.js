const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const holdService = require('../MVC/services/school/enrollmentHoldService');
const periodModel = require('../MVC/models/school/classEnrollmentPeriodModel');
const attendanceMatrixMetricsService = require('../MVC/services/school/attendanceMatrixMetricsService');

const viewSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs'),
  'utf8'
);
const routesSource = fs.readFileSync(
  path.join(__dirname, '../MVC/routes/classRoutes.js'),
  'utf8'
);

const personId = 'PERSON_001';
const classId = 'CLS_001';
const periodId = 'PER_001';

function buildMocks({ sessions = [], period = null, holds = [] } = {}) {
  const periodRow = period || {
    id: periodId,
    classId,
    personId,
    studentId: 'STU_001',
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    enrollmentHoldPeriods: holds,
    enrollmentSessionMarks: [],
    plannedNotApplicableSessionIds: []
  };
  const classRow = {
    id: classId,
    sessions
  };
  const updates = [];
  return {
    repositories: {
      classEnrollmentPeriods: {
        async getById(id) {
          return id === periodId ? { ...periodRow } : null;
        },
        async update(id, patch) {
          Object.assign(periodRow, patch);
          updates.push({ id, patch });
          return { ...periodRow };
        }
      },
      classes: {
        async getById(id) {
          return id === classId ? { ...classRow, sessions: [...classRow.sessions] } : null;
        },
        async update(id, patch) {
          if (patch.sessions) classRow.sessions = patch.sessions;
          updates.push({ id, patch });
          return classRow;
        }
      }
    },
    periodRow,
    classRow,
    updates
  };
}

function session(sessionId, date, attendance = '') {
  return {
    id: sessionId,
    date,
    startTime: '09:00',
    endTime: '10:00',
    status: 'completed',
    roster: attendance
      ? [{ personId, attendance }]
      : []
  };
}

test('sanitizeEnrollmentHoldPeriods keeps valid applied holds', () => {
  const holds = periodModel.sanitizeEnrollmentHoldPeriods([{
    id: 'HOLD-1',
    startDate: '2026-01-10',
    endDate: '2026-01-20',
    reason: 'Medical leave',
    sessionIds: ['S1', 'S2'],
    createdAt: '2026-01-09T12:00:00.000Z',
    createdBy: 'USR_1',
    status: 'applied'
  }]);
  assert.equal(holds.length, 1);
  assert.equal(holds[0].reason, 'Medical leave');
  assert.deepEqual(holds[0].sessionIds, ['S1', 'S2']);
});

test('previewHoldPeriod returns only sessions in hold date range', async () => {
  const mocks = buildMocks({
    sessions: [
      session('S1', '2026-01-05'),
      session('S2', '2026-01-15'),
      session('S3', '2026-02-15')
    ]
  });
  holdService.__setDependenciesForTest({ repositories: mocks.repositories });
  try {
    const preview = await holdService.previewHoldPeriod(periodId, {
      startDate: '2026-01-10',
      endDate: '2026-01-20',
      reason: 'Family travel'
    });
    assert.equal(preview.sessions.length, 1);
    assert.equal(preview.sessions[0].sessionId, 'S2');
    assert.equal(preview.canApply, true);
  } finally {
    holdService.__resetDependenciesForTest();
  }
});

test('applyHoldPeriod adds roster row with not_applicable and note when student absent from roster', async () => {
  const mocks = buildMocks({
    sessions: [session('S1', '2026-01-15')]
  });
  holdService.__setDependenciesForTest({ repositories: mocks.repositories });
  try {
    const result = await holdService.applyHoldPeriod(periodId, {
      startDate: '2026-01-10',
      endDate: '2026-01-20',
      reason: 'Temporary pause'
    }, { id: 'USR_1' });
    const rosterRow = mocks.classRow.sessions[0].roster.find((row) => row.personId === personId);
    assert.ok(rosterRow);
    assert.equal(rosterRow.attendance, attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE);
    assert.equal(rosterRow.notes, 'Temporary pause');
    assert.equal(result.hold.sessionIds.length, 1);
    assert.equal(mocks.periodRow.enrollmentHoldPeriods.length, 1);
  } finally {
    holdService.__resetDependenciesForTest();
  }
});

test('applyHoldPeriod blocks when session already has non-N/A attendance', async () => {
  const mocks = buildMocks({
    sessions: [session('S1', '2026-01-15', attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT)]
  });
  holdService.__setDependenciesForTest({ repositories: mocks.repositories });
  try {
    await assert.rejects(
      () => holdService.applyHoldPeriod(periodId, {
        startDate: '2026-01-10',
        endDate: '2026-01-20',
        reason: 'Should fail'
      }, { id: 'USR_1' }),
      /already has attendance recorded/i
    );
  } finally {
    holdService.__resetDependenciesForTest();
  }
});

test('previewHoldPeriod allows overlap when excludeHoldId matches editing hold', async () => {
  const mocks = buildMocks({
    sessions: [session('S1', '2026-01-15')],
    holds: [{
      id: 'HOLD-EXISTING',
      startDate: '2026-01-12',
      endDate: '2026-01-18',
      reason: 'Existing hold',
      sessionIds: ['S1'],
      createdAt: '2026-01-11T12:00:00.000Z',
      createdBy: 'USR_1',
      status: 'applied'
    }]
  });
  holdService.__setDependenciesForTest({ repositories: mocks.repositories });
  try {
    const preview = await holdService.previewHoldPeriod(periodId, {
      startDate: '2026-01-10',
      endDate: '2026-01-20',
      reason: 'Updated hold',
      excludeHoldId: 'HOLD-EXISTING'
    });
    assert.equal(preview.canApply, true);
    assert.equal(preview.sessions.length, 1);
  } finally {
    holdService.__resetDependenciesForTest();
  }
});

test('revokeHoldPeriod reverts safe N/A roster rows and marks hold revoked', async () => {
  const mocks = buildMocks({
    sessions: [{
      id: 'S1',
      date: '2026-01-15',
      startTime: '09:00',
      endTime: '10:00',
      roster: [{
        personId,
        attendance: attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE,
        notes: 'Medical leave'
      }]
    }],
    holds: [{
      id: 'HOLD-1',
      startDate: '2026-01-10',
      endDate: '2026-01-20',
      reason: 'Medical leave',
      sessionIds: ['S1'],
      createdAt: '2026-01-09T12:00:00.000Z',
      createdBy: 'USR_1',
      status: 'applied'
    }]
  });
  holdService.__setDependenciesForTest({ repositories: mocks.repositories });
  try {
    const result = await holdService.revokeHoldPeriod(periodId, 'HOLD-1', { id: 'USR_1' });
    assert.equal(result.revertedSessionCount, 1);
    assert.equal(mocks.classRow.sessions[0].roster.length, 0);
    const hold = mocks.periodRow.enrollmentHoldPeriods.find((row) => row.id === 'HOLD-1');
    assert.equal(hold.status, 'revoked');
  } finally {
    holdService.__resetDependenciesForTest();
  }
});

test('revokeHoldPeriod does not revert when notes no longer match hold reason', async () => {
  const mocks = buildMocks({
    sessions: [{
      id: 'S1',
      date: '2026-01-15',
      startTime: '09:00',
      endTime: '10:00',
      roster: [{
        personId,
        attendance: attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE,
        notes: 'Different note'
      }]
    }],
    holds: [{
      id: 'HOLD-1',
      startDate: '2026-01-10',
      endDate: '2026-01-20',
      reason: 'Medical leave',
      sessionIds: ['S1'],
      createdAt: '2026-01-09T12:00:00.000Z',
      createdBy: 'USR_1',
      status: 'applied'
    }]
  });
  holdService.__setDependenciesForTest({ repositories: mocks.repositories });
  try {
    const result = await holdService.revokeHoldPeriod(periodId, 'HOLD-1', { id: 'USR_1' });
    assert.equal(result.revertedSessionCount, 0);
    assert.equal(mocks.classRow.sessions[0].roster.length, 1);
  } finally {
    holdService.__resetDependenciesForTest();
  }
});

test('updateHoldPeriod changes hold metadata and roster sessions', async () => {
  const mocks = buildMocks({
    sessions: [
      session('S1', '2026-01-15'),
      session('S2', '2026-01-22')
    ],
    holds: [{
      id: 'HOLD-1',
      startDate: '2026-01-10',
      endDate: '2026-01-20',
      reason: 'Old reason',
      sessionIds: ['S1'],
      createdAt: '2026-01-09T12:00:00.000Z',
      createdBy: 'USR_1',
      status: 'applied'
    }]
  });
  mocks.classRow.sessions[0].roster = [{
    personId,
    attendance: attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE,
    notes: 'Old reason'
  }];
  holdService.__setDependenciesForTest({ repositories: mocks.repositories });
  try {
    const result = await holdService.updateHoldPeriod(periodId, 'HOLD-1', {
      startDate: '2026-01-18',
      endDate: '2026-01-25',
      reason: 'Extended pause'
    }, { id: 'USR_1' });
    assert.equal(result.hold.reason, 'Extended pause');
    assert.deepEqual(result.hold.sessionIds, ['S2']);
    const oldRoster = mocks.classRow.sessions.find((row) => row.id === 'S1')?.roster || [];
    const newRoster = mocks.classRow.sessions.find((row) => row.id === 'S2')?.roster || [];
    assert.equal(oldRoster.length, 0);
    assert.equal(newRoster[0].notes, 'Extended pause');
  } finally {
    holdService.__resetDependenciesForTest();
  }
});

test('previewHoldPeriod rejects overlapping applied holds', async () => {
  const mocks = buildMocks({
    sessions: [session('S1', '2026-01-15')],
    holds: [{
      id: 'HOLD-EXISTING',
      startDate: '2026-01-12',
      endDate: '2026-01-18',
      reason: 'Existing hold',
      sessionIds: ['S1'],
      createdAt: '2026-01-11T12:00:00.000Z',
      createdBy: 'USR_1',
      status: 'applied'
    }]
  });
  holdService.__setDependenciesForTest({ repositories: mocks.repositories });
  try {
    await assert.rejects(
      () => holdService.previewHoldPeriod(periodId, {
        startDate: '2026-01-10',
        endDate: '2026-01-20',
        reason: 'Overlap attempt'
      }),
      /overlaps an existing on-hold period/i
    );
  } finally {
    holdService.__resetDependenciesForTest();
  }
});

test('rolling enrollment view includes on-hold modal and menu action', () => {
  assert.match(viewSource, /id="enrollmentOnHoldModal"/);
  assert.match(viewSource, /btn-row-on-hold/);
  assert.match(viewSource, /function openEnrollmentOnHoldModal\(/);
  assert.match(viewSource, /function previewEnrollmentHold\(/);
  assert.match(viewSource, /function applyEnrollmentHold\(/);
  assert.match(viewSource, /function openOnHoldCalendarPreview\(/);
  assert.match(viewSource, /btn-onhold-preview/);
  assert.match(viewSource, /btn-onhold-edit/);
  assert.match(viewSource, /btn-onhold-delete/);
  assert.doesNotMatch(viewSource, /id="onHold_previewBody"/);
  assert.doesNotMatch(viewSource, /Affected Sessions/);
  const onHoldModalBlock = viewSource.slice(
    viewSource.indexOf('id="enrollmentOnHoldModal"'),
    viewSource.indexOf('id="enrollmentChargeModal"')
  );
  assert.ok(onHoldModalBlock.indexOf('New On-Hold Period') < onHoldModalBlock.indexOf('Existing On-Hold Periods'));
  assert.match(routesSource, /\/on-hold\/preview/);
  assert.match(routesSource, /\/on-hold\/apply/);
  assert.match(routesSource, /\/on-hold\/:holdId\/update/);
  assert.match(routesSource, /\/on-hold\/:holdId\/revoke/);
});

test('edit enrollment modal uses modal-xl layout', () => {
  const editModalBlock = viewSource.slice(
    viewSource.indexOf('id="editPeriodModal"'),
    viewSource.indexOf('id="enrollmentOnHoldModal"')
  );
  assert.match(editModalBlock, /modal-xl/);
});
