const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scheduleAddCoTeacherService = require('../MVC/services/school/scheduleAddCoTeacherService');
const schoolPersonAccessService = require('../MVC/services/school/schoolPersonAccessService');

function sessionRow(overrides = {}) {
  return {
    sessionId: 'SES_1',
    date: '2026-06-02',
    startTime: '09:00',
    endTime: '11:00',
    status: 'scheduled',
    delivery: {
      deliveredBy: 'TCH_OLD',
      deliveredByName: 'Ella',
      coTeachers: [{ personId: 'TCH_CO', name: 'Coach', roleLabel: 'Co-Teacher', paid: true, paidHours: 1, canEdit: false }]
    },
    ...overrides
  };
}

test('add co-teacher requires sessions from one class', () => {
  const blockers = scheduleAddCoTeacherService.collectAddCoTeacherBlockers({
    classIds: ['CLS_A', 'CLS_B'],
    teacherId: 'TCH_NEW',
    paid: false,
    rows: [
      { classId: 'CLS_A', session: sessionRow() },
      { classId: 'CLS_B', session: sessionRow({ sessionId: 'SES_2', date: '2026-06-03' }) }
    ]
  });
  assert.equal(blockers.some((row) => row.code === 'MULTIPLE_CLASSES'), true);
  assert.match(blockers.find((row) => row.code === 'MULTIPLE_CLASSES').message, /one class/);
});

test('an approved timesheet locks the batch and paid hours follow the shared duration', () => {
  const locked = scheduleAddCoTeacherService.collectAddCoTeacherBlockers({
    classIds: ['CLS_A'],
    teacherId: 'TCH_NEW',
    paid: true,
    paidHours: 1,
    rows: [{
      classId: 'CLS_A',
      session: sessionRow({ status: 'completed', locked: true, lockReason: 'timesheet_approved' })
    }]
  });
  assert.equal(locked.some((row) => row.code === 'TIMESHEET_LOCKED'), true);

  const mixed = scheduleAddCoTeacherService.collectAddCoTeacherBlockers({
    classIds: ['CLS_A'],
    teacherId: 'TCH_NEW',
    paid: true,
    paidHours: 1,
    rows: [
      { classId: 'CLS_A', session: sessionRow({ sessionId: 'SES_1', endTime: '10:00' }) },
      { classId: 'CLS_A', session: sessionRow({ sessionId: 'SES_2', date: '2026-06-03', endTime: '11:00' }) }
    ]
  });
  assert.equal(mixed.some((row) => row.code === 'MIXED_DURATION'), true);

  const tooHigh = scheduleAddCoTeacherService.collectAddCoTeacherBlockers({
    classIds: ['CLS_A'],
    teacherId: 'TCH_NEW',
    paid: true,
    paidHours: 3,
    rows: [{ classId: 'CLS_A', session: sessionRow() }]
  });
  assert.equal(tooHigh.some((row) => row.code === 'PAID_HOURS'), true);

  const unpaidMixed = scheduleAddCoTeacherService.collectAddCoTeacherBlockers({
    classIds: ['CLS_A'],
    teacherId: 'TCH_NEW',
    paid: false,
    rows: [
      { classId: 'CLS_A', session: sessionRow({ sessionId: 'SES_1', endTime: '10:00' }) },
      { classId: 'CLS_A', session: sessionRow({ sessionId: 'SES_2', date: '2026-06-03', endTime: '11:00' }) }
    ]
  });
  assert.equal(unpaidMixed.some((row) => row.code === 'MIXED_DURATION'), false);
});

test('a new co-teacher is unpaid with zero hours, and an existing co-teacher keeps role and edit access', () => {
  const added = scheduleAddCoTeacherService.applyCoTeacherToSession(sessionRow({ status: 'completed' }), {
    teacherId: 'TCH_NEW',
    teacherName: 'Noah',
    paid: false,
    paidHours: 0
  });
  assert.equal(added.status, 'completed');
  assert.equal(added.delivery.deliveredBy, 'TCH_OLD');
  const addedRow = added.delivery.coTeachers.find((row) => row.personId === 'TCH_NEW');
  assert.equal(addedRow.paid, false);
  assert.equal(addedRow.paidHours, 0);
  assert.equal(addedRow.canEdit, false);
  assert.equal(addedRow.roleLabel, 'Co-Teacher');
  assert.ok(added.delivery.coTeachers.some((row) => row.personId === 'TCH_CO'));

  const updated = scheduleAddCoTeacherService.applyCoTeacherToSession(sessionRow({
    delivery: {
      deliveredBy: 'TCH_OLD',
      deliveredByName: 'Ella',
      coTeachers: [{ personId: 'TCH_NEW', name: 'Noah', roleLabel: 'Assistant', paid: false, paidHours: 0, canEdit: true }]
    }
  }), {
    teacherId: 'TCH_NEW',
    teacherName: 'Noah Legal',
    paid: true,
    paidHours: 1.5
  });
  const kept = updated.delivery.coTeachers.find((row) => row.personId === 'TCH_NEW');
  assert.equal(kept.roleLabel, 'Assistant');
  assert.equal(kept.canEdit, true);
  assert.equal(kept.paid, true);
  assert.equal(kept.paidHours, 1.5);
  assert.equal(kept.name, 'Noah');
  assert.equal(updated.delivery.deliveredBy, 'TCH_OLD');
});

test('a completed session can gain a co-teacher, and a teacher conflict or stale preview blocks the save', async () => {
  const stored = [sessionRow({ status: 'completed' })];
  let saved = null;
  scheduleAddCoTeacherService.__setDependenciesForTest({
    schoolDataService: {
      getDataById: async () => ({ id: 'CLS_A', orgId: 'ORG_1' }),
      getClassSessions: async () => stored,
      saveClassSessions: async (_classId, sessions) => {
        saved = sessions;
        return sessions;
      }
    },
    schoolIndexService: { rebuildIndexesForClass: async () => {} },
    schoolPersonAccessService: {
      getPersonById: async () => ({ name: { preferred: 'Noah', first: 'Noah', last: 'Teacher' } }),
      formatPersonName: schoolPersonAccessService.formatPersonName
    },
    sessionConflictDetectionService: {
      detectSessionConflicts: async () => ([{
        date: '2026-06-02',
        conflictClass: 'Another unsaved session in this list',
        existTime: '09:00 - 11:00',
        conflictType: 'teacher_schedule'
      }])
    }
  });
  try {
    const blocked = await scheduleAddCoTeacherService.buildAddCoTeacherPreview({
      teacherId: 'TCH_NEW',
      sessions: [{ classId: 'CLS_A', sessionId: 'SES_1' }],
      paid: true,
      paidHours: 1.5,
      reqUser: { id: 'USER_1' }
    });
    assert.equal(blocked.canContinue, false);
    assert.equal(blocked.blockers.some((row) => row.code === 'TEACHER_CONFLICT'), true);

    scheduleAddCoTeacherService.__setDependenciesForTest({
      sessionConflictDetectionService: { detectSessionConflicts: async () => [] }
    });
    const preview = await scheduleAddCoTeacherService.buildAddCoTeacherPreview({
      teacherId: 'TCH_NEW',
      sessions: [{ classId: 'CLS_A', sessionId: 'SES_1' }],
      paid: true,
      paidHours: '',
      reqUser: { id: 'USER_1' }
    });
    assert.equal(preview.canContinue, true);
    assert.equal(preview.sessions[0].status, 'completed');
    assert.equal(preview.paidHours, 2);
    await assert.rejects(
      () => scheduleAddCoTeacherService.applyAddCoTeacher({
        teacherId: 'TCH_NEW',
        sessions: [{ classId: 'CLS_A', sessionId: 'SES_1' }],
        paid: true,
        paidHours: '',
        previewHash: 'stale',
        reqUser: { id: 'USER_1' }
      }),
      /Preview is stale/
    );
    const result = await scheduleAddCoTeacherService.applyAddCoTeacher({
      teacherId: 'TCH_NEW',
      sessions: [{ classId: 'CLS_A', sessionId: 'SES_1' }],
      paid: true,
      paidHours: '',
      previewHash: preview.previewHash,
      reqUser: { id: 'USER_1' }
    });
    assert.equal(result.updatedCount, 1);
    assert.equal(result.paidHours, 2);
    assert.equal(saved[0].status, 'completed');
    assert.equal(saved[0].delivery.deliveredBy, 'TCH_OLD');
    const added = saved[0].delivery.coTeachers.find((row) => row.personId === 'TCH_NEW');
    assert.equal(added.paid, true);
    assert.equal(added.paidHours, 2);
    assert.equal(added.canEdit, false);
    assert.ok(saved[0].delivery.coTeachers.some((row) => row.personId === 'TCH_CO'));
  } finally {
    scheduleAddCoTeacherService.__resetDependenciesForTest();
  }
});

test('overlapping selected sessions block a new co-teacher, and an existing co-teacher can be edited or removed', async () => {
  const overlap = scheduleAddCoTeacherService.collectAddCoTeacherBlockers({
    classIds: ['CLS_A'],
    teacherId: 'TCH_NEW',
    paid: false,
    rows: [
      { classId: 'CLS_A', session: sessionRow({ sessionId: 'SES_1', startTime: '09:00', endTime: '11:00' }) },
      { classId: 'CLS_A', session: sessionRow({ sessionId: 'SES_2', startTime: '10:00', endTime: '12:00' }) }
    ]
  });
  assert.equal(overlap.some((row) => row.code === 'SELECTED_OVERLAP'), true);

  const stored = [sessionRow({ status: 'completed' })];
  let saved = null;
  scheduleAddCoTeacherService.__setDependenciesForTest({
    schoolDataService: {
      getDataById: async () => ({ id: 'CLS_A', orgId: 'ORG_1' }),
      getClassSessions: async () => stored,
      saveClassSessions: async (_classId, sessions) => {
        saved = sessions.map((row) => JSON.parse(JSON.stringify(row)));
        return sessions;
      }
    },
    schoolIndexService: { rebuildIndexesForClass: async () => {} },
    schoolPersonAccessService: {
      getPersonById: async () => ({ name: { preferred: 'Coach', first: 'Coach', last: 'Teacher' } }),
      formatPersonName: schoolPersonAccessService.formatPersonName
    },
    sessionConflictDetectionService: {
      detectSessionConflicts: async () => ([{
        date: '2026-06-02',
        conflictClass: 'Other class',
        existTime: '09:00 - 11:00',
        conflictType: 'teacher_schedule'
      }])
    }
  });
  try {
    const context = await scheduleAddCoTeacherService.buildAddCoTeacherPreview({
      sessions: [{ classId: 'CLS_A', sessionId: 'SES_1' }],
      reqUser: { id: 'USER_1' }
    });
    assert.equal(context.existingCoTeachers[0].personId, 'TCH_CO');
    assert.equal(context.existingCoTeachers[0].paid, true);

    const edited = await scheduleAddCoTeacherService.buildAddCoTeacherPreview({
      teacherId: 'TCH_CO',
      sessions: [{ classId: 'CLS_A', sessionId: 'SES_1' }],
      paid: false,
      reqUser: { id: 'USER_1' }
    });
    assert.equal(edited.canContinue, true);
    assert.equal(edited.change, 'update');
    const editResult = await scheduleAddCoTeacherService.applyAddCoTeacher({
      teacherId: 'TCH_CO',
      sessions: [{ classId: 'CLS_A', sessionId: 'SES_1' }],
      paid: false,
      previewHash: edited.previewHash,
      reqUser: { id: 'USER_1' }
    });
    assert.equal(editResult.change, 'update');
    assert.equal(saved[0].delivery.coTeachers.find((row) => row.personId === 'TCH_CO').paid, false);
    assert.equal(saved[0].delivery.coTeachers.find((row) => row.personId === 'TCH_CO').paidHours, 0);
    assert.equal(saved[0].status, 'completed');
    assert.equal(saved[0].delivery.deliveredBy, 'TCH_OLD');

    stored[0] = saved[0];
    const removed = await scheduleAddCoTeacherService.buildAddCoTeacherPreview({
      teacherId: 'TCH_CO',
      sessions: [{ classId: 'CLS_A', sessionId: 'SES_1' }],
      action: 'remove',
      reqUser: { id: 'USER_1' }
    });
    assert.equal(removed.canContinue, true);
    assert.equal(removed.change, 'remove');
    await scheduleAddCoTeacherService.applyAddCoTeacher({
      teacherId: 'TCH_CO',
      sessions: [{ classId: 'CLS_A', sessionId: 'SES_1' }],
      action: 'remove',
      previewHash: removed.previewHash,
      reqUser: { id: 'USER_1' }
    });
    assert.equal(saved[0].delivery.coTeachers.some((row) => row.personId === 'TCH_CO'), false);
    assert.equal(saved[0].delivery.deliveredBy, 'TCH_OLD');
    assert.equal(saved[0].status, 'completed');
  } finally {
    scheduleAddCoTeacherService.__resetDependenciesForTest();
  }
});

test('add co-teacher sits under take over on the schedule rail', () => {
  const view = fs.readFileSync(path.join(__dirname, '../MVC/views/school/schedule/personSchedule.ejs'), 'utf8');
  const modal = fs.readFileSync(path.join(__dirname, '../MVC/views/school/schedule/partials/scheduleAddCoTeacherModal.ejs'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../MVC/routes/scheduleRoutes.js'), 'utf8');
  const viewer = fs.readFileSync(path.join(__dirname, '../public/scripts/masterScheduleViewer.js'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../public/scripts/masterScheduleAddCoTeacher.js'), 'utf8');
  const takeOverAt = view.indexOf('data-schedule-admin-action="take-over-sessions"');
  const addAt = view.indexOf('data-schedule-admin-action="add-co-teacher"');
  assert.ok(takeOverAt >= 0);
  assert.ok(addAt > takeOverAt);
  assert.match(view, /Add Co-Teacher/);
  assert.match(view, /masterScheduleAddCoTeacher\.js/);
  assert.match(modal, /scheduleAddCoTeacherPaidHours/);
  assert.match(modal, /id="scheduleAddCoTeacherHoursWrap"/);
  assert.match(modal, /scheduleAddCoTeacherExisting/);
  assert.match(script, /data-co-teacher-remove/);
  assert.match(routes, /\/api\/add-co-teacher\/preview/);
  assert.match(routes, /\/api\/add-co-teacher\/apply/);
  assert.match(viewer, /add-co-teacher/);
  assert.match(viewer, /installMasterScheduleAddCoTeacher/);
  assert.match(script, /scheduleAddCoTeacherHoursWrap/);
  assert.match(script, /row\.sessions/);
});
