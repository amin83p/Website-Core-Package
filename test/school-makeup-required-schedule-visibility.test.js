const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scheduleController = require('../packages/school/MVC/controllers/school/scheduleController');
const sessionStatusPolicyService = require('../packages/school/MVC/services/school/sessionStatusPolicyService');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const schoolRepositories = require('../packages/school/MVC/repositories/school');
const reportIntegrityService = require('../packages/school/MVC/services/school/reportIntegrityService');
const schoolIdentityLookupService = require('../packages/school/MVC/services/school/schoolIdentityLookupService');
const leaveRequestService = require('../packages/school/MVC/services/school/leaveRequestService');
const activityService = require('../packages/school/MVC/services/school/activityService');
const sessionStudentCaseService = require('../packages/school/MVC/services/school/sessionStudentCaseService');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

async function withPatched(target, replacements, callback) {
  const originals = {};
  Object.entries(replacements).forEach(([key, value]) => {
    originals[key] = target[key];
    target[key] = value;
  });
  try {
    return await callback();
  } finally {
    Object.entries(originals).forEach(([key, value]) => {
      target[key] = value;
    });
  }
}

function buildStatusMap() {
  return new Map([
    ['missed_informed24', {
      code: 'missed_informed24',
      label: 'Missed (Informed-24)',
      makeUpRequired: true,
      timesheetFormula: 'duration',
      excludeFromTeacherIndex: false,
      excludeFromStudentIndex: false
    }],
    ['hidden', {
      code: 'hidden',
      label: 'Hidden',
      makeUpRequired: false,
      timesheetFormula: '0',
      excludeFromTeacherIndex: true,
      excludeFromStudentIndex: true
    }],
    ['scheduled', {
      code: 'scheduled',
      label: 'Scheduled',
      makeUpRequired: false,
      timesheetFormula: 'duration',
      excludeFromTeacherIndex: false,
      excludeFromStudentIndex: false
    }]
  ]);
}

test('make-up-required originals are display-only for assigned teachers and hidden from students', () => {
  const policy = scheduleController.resolveClassSessionSchedulePolicy(buildStatusMap(), {
    status: 'missed_informed24'
  }, { teacherAssigned: true });

  assert.deepEqual(policy, {
    makeUpRequired: true,
    teacherVisible: true,
    studentVisible: false,
    scheduleDisplayOnly: true,
    countsTowardHours: false,
    blocksConflicts: false
  });
});

test('make-up-required originals are not exposed to an unassigned teacher', () => {
  const policy = scheduleController.resolveClassSessionSchedulePolicy(buildStatusMap(), {
    status: 'missed_informed24'
  }, { teacherAssigned: false });

  assert.equal(policy.makeUpRequired, true);
  assert.equal(policy.teacherVisible, false);
  assert.equal(policy.scheduleDisplayOnly, false);
});

test('schedule builder exposes zero-hour originals to main, co-, and fallback teachers only', async () => {
  const people = [
    ['PER-MAIN', 'Main', 'school_teacher'],
    ['PER-CO', 'Co', 'school_teacher'],
    ['PER-FALLBACK', 'Fallback', 'school_teacher'],
    ['PER-STUDENT', 'Student', 'school_student']
  ].map(([id, first, role]) => ({
    id,
    name: { first, last: 'Person' },
    organizations: [{ orgId: 'ORG-1', memberStatus: 'active', roles: [role] }]
  }));
  const classRow = {
    id: 'CLS-1',
    orgId: 'ORG-1',
    title: 'Make-up Class',
    instructors: [{ personId: 'PER-FALLBACK' }],
    sessions: [
      {
        sessionId: 'SES-TEAM',
        date: '2026-08-04',
        startTime: '08:00',
        endTime: '10:00',
        status: 'missed_informed24',
        delivery: {
          deliveredBy: 'PER-MAIN',
          coTeachers: [{ personId: 'PER-CO', canEdit: true }]
        }
      },
      {
        sessionId: 'SES-FALLBACK',
        date: '2026-08-05',
        startTime: '11:00',
        endTime: '12:30',
        status: 'missed_informed24'
      }
    ]
  };
  const teachers = people
    .filter((person) => person.organizations[0].roles.includes('school_teacher'))
    .map((person, index) => ({ id: `T-${index + 1}`, personId: person.id, orgId: 'ORG-1' }));

  await withPatched(schoolDataService, {
    getStudentIndex: async () => ({ 'PER-STUDENT': { enrolled: ['CLS-1'], waitlisted: [] } }),
    getTeacherIndex: async () => ({}),
    getClassSessions: async () => classRow.sessions,
    getClassEnrollmentPeriodsByStudentId: async () => [{
      id: 'CEP-1',
      orgId: 'ORG-1',
      classId: 'CLS-1',
      studentId: 'STU-1',
      status: 'active',
      startDate: '2026-08-01',
      endDate: '2026-08-31'
    }],
    fetchData: async (entityType) => {
      if (entityType === 'classes') return [classRow];
      if (entityType === 'teachers') return teachers;
      if (entityType === 'students') return [{ id: 'STU-1', personId: 'PER-STUDENT', orgId: 'ORG-1' }];
      return [];
    }
  }, async () => {
    await withPatched(schoolIdentityLookupService, {
      listSchoolPersonRecords: async ({ q }) => ({
        allRows: people.filter((person) => !q || person.id === q)
      })
    }, async () => {
      await withPatched(schoolRepositories.reportAssignments, { list: async () => [] }, async () => {
        await withPatched(schoolRepositories.reportTemplates, { list: async () => [] }, async () => {
          await withPatched(leaveRequestService, { getApprovedLeaveEventsForPerson: async () => [] }, async () => {
            await withPatched(activityService, { getScheduleEventsForPerson: async () => [] }, async () => {
              await withPatched(sessionStudentCaseService, { listSessionCaseSummaries: async () => new Map() }, async () => {
                const buildFor = (personId) => scheduleController.buildEventsForPersonAndRange({
                  personId,
                  startDate: '2026-08-01',
                  endDate: '2026-08-31',
                  reqUser: { id: 'USER-1', activeOrgId: 'ORG-1', orgToday: '2026-08-04' },
                  activeOrgId: 'ORG-1',
                  statusMap: buildStatusMap()
                });

                const [main, coTeacher, fallback, student] = await Promise.all([
                  buildFor('PER-MAIN'),
                  buildFor('PER-CO'),
                  buildFor('PER-FALLBACK'),
                  buildFor('PER-STUDENT')
                ]);

                assert.deepEqual(main.events.map((event) => event.sessionId), ['SES-TEAM']);
                assert.deepEqual(coTeacher.events.map((event) => event.sessionId), ['SES-TEAM']);
                assert.deepEqual(fallback.events.map((event) => event.sessionId), ['SES-FALLBACK']);
                assert.equal(student.events.length, 0);

                const event = main.events[0];
                assert.equal(event.duration, 0);
                assert.equal(event.scheduledDuration, 2);
                assert.equal(event.scheduleDisplayOnly, true);
                assert.equal(event.countsTowardHours, false);
                assert.equal(event.blocksConflicts, false);
                assert.equal(event.detailsUrl, '/school/classes/CLS-1/sessions/SES-TEAM');
              });
            });
          });
        });
      });
    });
  });
});

test('ordinary teacher-index exclusions remain hidden', () => {
  const policy = scheduleController.resolveClassSessionSchedulePolicy(buildStatusMap(), {
    status: 'hidden'
  }, { teacherAssigned: true });

  assert.equal(policy.makeUpRequired, false);
  assert.equal(policy.teacherVisible, false);
  assert.equal(policy.studentVisible, false);
});

test('display-only make-up sessions contribute zero to schedule summaries', () => {
  const statusMap = buildStatusMap();
  const events = [{
    eventType: 'class_session',
    sessionId: 'SES-MAKEUP-ORIGINAL',
    status: 'missed_informed24',
    duration: 2,
    scheduledDuration: 2,
    scheduleDisplayOnly: true,
    countsTowardHours: false,
    blocksConflicts: false
  }];

  const scheduleSummary = scheduleController.summarizeEvents(events, []);
  const globalSummary = scheduleController.summarizeTimesheetHoursForEvents(events, statusMap);

  assert.equal(scheduleSummary.sessionCount, 1);
  assert.equal(scheduleSummary.totalHours, 0);
  assert.equal(globalSummary.eventCount, 1);
  assert.equal(globalSummary.totalTimesheetHours, 0);
});

test('display-only events never overlap while blocking events around them still conflict', () => {
  const events = [
    { id: 'A', personId: 'PER-1', date: '2026-08-04', start: '08:00', end: '12:00', hasOverlap: false },
    {
      id: 'M',
      personId: 'PER-1',
      date: '2026-08-04',
      start: '09:00',
      end: '10:00',
      scheduleDisplayOnly: true,
      blocksConflicts: false,
      hasOverlap: false
    },
    { id: 'B', personId: 'PER-1', date: '2026-08-04', start: '11:00', end: '13:00', hasOverlap: false }
  ];

  scheduleController.markOverlappingEvents(events);

  assert.equal(events[0].hasOverlap, true);
  assert.equal(events[1].hasOverlap, false);
  assert.equal(events[2].hasOverlap, true);
});

test('make-up-required originals do not block report assignment time windows', async () => {
  const targetClass = {
    id: 'CLS-TARGET',
    orgId: 'ORG-1',
    title: 'Target Class',
    instructors: []
  };
  const existingClass = {
    id: 'CLS-EXISTING',
    orgId: 'ORG-1',
    title: 'Existing Class',
    instructors: [{ personId: 'TEACHER-1' }]
  };
  const sessionsByClass = {
    'CLS-TARGET': [{
      sessionId: 'SES-TARGET',
      date: '2026-08-04',
      startTime: '08:00',
      endTime: '09:00',
      status: 'scheduled'
    }],
    'CLS-EXISTING': [{
      sessionId: 'SES-MISSED',
      date: '2026-08-04',
      startTime: '09:00',
      endTime: '11:00',
      status: 'missed_informed24'
    }]
  };
  const targetRow = {
    targetType: 'date',
    dueDate: '2026-08-04',
    reportStartDate: '2026-08-04',
    reportDueDate: '2026-08-04',
    taskStartTime: '09:30',
    taskEndTime: '10:30',
    teacherId: 'TEACHER-1',
    conflictPermitted: false,
    timesheetReflection: false
  };

  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => (entityType === 'classes' && id === targetClass.id ? targetClass : null),
    getClassSessions: async (classId) => sessionsByClass[classId] || [],
    fetchData: async (entityType) => (entityType === 'classes' ? [targetClass, existingClass] : [])
  }, async () => {
    await withPatched(schoolRepositories.reportAssignments, {
      list: async () => []
    }, async () => {
      await withPatched(sessionStatusPolicyService, {
        getStatusMap: async () => buildStatusMap()
      }, async () => {
        const allowed = await reportIntegrityService.previewAssignmentTargetRows({
          classId: targetClass.id,
          targetRows: [targetRow],
          reqUser: { id: 'USER-1', activeOrgId: 'ORG-1' }
        });
        assert.equal(allowed.rows[0].valid, true);
        assert.deepEqual(allowed.rows[0].conflicts, []);

        sessionsByClass['CLS-EXISTING'][0].status = 'scheduled';
        const blocked = await reportIntegrityService.previewAssignmentTargetRows({
          classId: targetClass.id,
          targetRows: [targetRow],
          reqUser: { id: 'USER-1', activeOrgId: 'ORG-1' }
        });
        assert.equal(blocked.rows[0].valid, false);
        assert.match(blocked.rows[0].conflicts[0], /overlaps class session/);
      });
    });
  });
});

test('status policy and schedule surfaces expose the informational make-up treatment', () => {
  assert.equal(sessionStatusPolicyService.isMakeUpRequiredByMap(buildStatusMap(), {
    status: 'missed_informed24'
  }), true);

  const sharedDisplay = read('packages/school/public/scripts/scheduleCompletionDisplay.js');
  const controller = read('packages/school/MVC/controllers/school/scheduleController.js');
  const reportIntegrity = read('packages/school/MVC/services/school/reportIntegrityService.js');
  const viewPaths = [
    'packages/school/MVC/views/school/schedule/mySchedule.ejs',
    'packages/school/MVC/views/school/schedule/personSchedule.ejs',
    'packages/school/MVC/views/school/schedule/globalSchedule.ejs',
    'packages/school/MVC/views/school/masterAcademiaHub.ejs'
  ];

  assert.match(sharedDisplay, /Make-up required · 0 schedule hours · non-blocking/);
  assert.match(sharedDisplay, /buildMakeupRequiredBadge/);
  viewPaths.forEach((viewPath) => {
    assert.match(read(viewPath), /buildMakeupRequiredBadge/, `${viewPath} renders the make-up badge`);
  });
  assert.match(controller, /detailsUrl/);
  assert.match(reportIntegrity, /shouldExcludeFromTeacherIndexByMap/);
});
