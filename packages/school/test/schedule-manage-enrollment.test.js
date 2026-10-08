const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manageService = require('../MVC/services/school/scheduleManageEnrollmentService');
const scheduleEnrollStudentsService = require('../MVC/services/school/scheduleEnrollStudentsService');

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

test('collectCoveringOpenPeriods keeps open statuses that cover selected dates', () => {
  const periods = [
    {
      id: 'PER_ACTIVE',
      studentId: 'STU_1',
      status: 'active',
      startDate: '2026-06-01',
      endDate: '2026-08-31'
    },
    {
      id: 'PER_WAITING',
      studentId: 'STU_2',
      status: 'waiting_list',
      startDate: '2026-06-01',
      endDate: ''
    },
    {
      id: 'PER_CLOSED',
      studentId: 'STU_3',
      status: 'completed',
      startDate: '2026-06-01',
      endDate: '2026-07-01'
    },
    {
      id: 'PER_OUTSIDE',
      studentId: 'STU_4',
      status: 'active',
      startDate: '2026-09-01',
      endDate: '2026-12-31'
    }
  ];

  const rows = manageService.collectCoveringOpenPeriods({
    periods,
    selectedDates: ['2026-06-15']
  });

  assert.deepEqual(
    rows.map((row) => row.id).sort(),
    ['PER_ACTIVE', 'PER_WAITING']
  );
});

test('buildManageEnrollmentList returns unique labeled open enrollments across classes', async () => {
  const classes = {
    CLS_A: { id: 'CLS_A', title: 'Class A', orgId: 'ORG_1' },
    CLS_B: { id: 'CLS_B', title: 'Class B', orgId: 'ORG_1' }
  };
  const sessionsByClass = {
    CLS_A: [{ sessionId: 'SES_A1', date: '2026-06-10', startTime: '09:00', endTime: '10:00' }],
    CLS_B: [{ sessionId: 'SES_B1', date: '2026-06-10', startTime: '11:00', endTime: '12:00' }]
  };
  const periodsByClass = {
    CLS_A: [
      {
        id: 'PER_A',
        studentId: 'STU_1',
        status: 'active',
        startDate: '2026-06-01',
        endDate: '2026-08-31',
        transactionSummary: { postedTransactionIds: ['TX_1'] }
      },
      {
        id: 'PER_VOID',
        studentId: 'STU_X',
        status: 'void',
        startDate: '2026-06-01',
        endDate: '2026-08-31'
      }
    ],
    CLS_B: [
      {
        id: 'PER_B',
        studentId: 'STU_2',
        status: 'to_be_confirmed',
        startDate: '2026-06-01',
        endDate: ''
      }
    ]
  };
  const students = {
    STU_1: { id: 'STU_1', displayName: 'Ada Lovelace' },
    STU_2: { id: 'STU_2', name: { first: 'Grace', last: 'Hopper' } }
  };

  manageService.__setDependenciesForTest({
    schoolDataService: {
      async getDataById(collection, id) {
        if (collection === 'classes') return classes[id] || null;
        if (collection === 'students') {
          const student = students[id];
          if (!student) return null;
          return { ...student, personId: `PER_${id}` };
        }
        return null;
      },
      async getClassSessions(classId) {
        return sessionsByClass[classId] || [];
      },
      async getClassEnrollmentPeriodsByClassId(classId) {
        return periodsByClass[classId] || [];
      }
    },
    schoolPersonAccessService: {
      async buildPersonByIdMap({ personIds = [] } = {}) {
        const map = new Map();
        personIds.forEach((personId) => {
          const studentId = String(personId || '').replace(/^PER_/, '');
          const student = students[studentId];
          if (!student) return;
          map.set(String(personId), {
            id: personId,
            name: student.displayName
              ? undefined
              : student.name,
            displayName: student.displayName || ''
          });
        });
        return map;
      },
      formatPersonName(person, fallback = '') {
        if (!person) return fallback;
        if (person.displayName) return person.displayName;
        const name = person.name;
        if (typeof name === 'string' && name.trim()) return name.trim();
        if (name && typeof name === 'object') {
          return `${String(name.first || '').trim()} ${String(name.last || '').trim()}`.trim() || fallback;
        }
        return fallback;
      }
    }
  });

  try {
    const result = await manageService.buildManageEnrollmentList({
      sessions: [
        { sessionId: 'SES_A1', classId: 'CLS_A', date: '2026-06-10' },
        { sessionId: 'SES_B1', classId: 'CLS_B', date: '2026-06-10' }
      ],
      reqUser: { id: 'U1' },
      accessContext: {}
    });

    assert.equal(result.selectedSessionCount, 2);
    assert.equal(result.classCount, 2);
    assert.equal(result.enrollments.length, 2);
    assert.deepEqual(
      result.enrollments.map((row) => row.periodId).sort(),
      ['PER_A', 'PER_B']
    );
    const ada = result.enrollments.find((row) => row.periodId === 'PER_A');
    assert.equal(ada.studentLabel, 'Ada Lovelace');
    assert.equal(ada.hasPostedTransactions, true);
    assert.equal(ada.className, 'Class A');
    const grace = result.enrollments.find((row) => row.periodId === 'PER_B');
    assert.equal(grace.studentLabel, 'Grace Hopper');
    assert.equal(grace.statusLabel, 'To be Confirmed');
  } finally {
    manageService.__resetDependenciesForTest();
  }
});

test('resolveEnrollmentType reports hour, session cap, and end date', () => {
  assert.deepEqual(manageService.resolveEnrollmentType({ targetHours: 12, targetSessionCount: 0 }), {
    enrollmentType: 'hour',
    enrollmentTypeLabel: 'Hour',
    enrollmentTypeDetail: '12 hours'
  });
  assert.deepEqual(manageService.resolveEnrollmentType({ targetHours: 0, targetSessionCount: 8 }), {
    enrollmentType: 'session',
    enrollmentTypeLabel: 'Session cap',
    enrollmentTypeDetail: '8 sessions'
  });
  assert.deepEqual(manageService.resolveEnrollmentType({
    targetHours: 0,
    targetSessionCount: 0,
    endDate: '2026-10-08'
  }), {
    enrollmentType: 'end_date',
    enrollmentTypeLabel: 'End date',
    enrollmentTypeDetail: '2026-10-08'
  });
});

test('parseSelectedSessions dedupes by class and session id', () => {
  const rows = manageService.parseSelectedSessions({
    sessions: [
      { sessionId: 'SES_1', classId: 'CLS_1', date: '2026-06-01' },
      { id: 'SES_1', classId: 'CLS_1', date: '2026-06-01' },
      { sessionId: 'SES_2', classId: 'CLS_2', date: '2026-06-02' },
      { sessionId: '', classId: 'CLS_2' }
    ]
  });
  assert.deepEqual(rows, [
    { sessionId: 'SES_1', classId: 'CLS_1', date: '2026-06-01' },
    { sessionId: 'SES_2', classId: 'CLS_2', date: '2026-06-02' }
  ]);
});

test('listFunderOptionsForClass returns active funders for the class organization', async () => {
  manageService.__setDependenciesForTest({
    schoolDataService: {
      async getDataById(collection, id) {
        if (collection === 'classes' && id === 'CLS_A') {
          return { id: 'CLS_A', orgId: 'ORG_1' };
        }
        return null;
      }
    }
  });
  const originalLoad = scheduleEnrollStudentsService.loadActiveFunderOptions;
  scheduleEnrollStudentsService.loadActiveFunderOptions = async (_reqUser, orgId) => {
    assert.equal(orgId, 'ORG_1');
    return [
      { id: 'FND_1', label: 'Sponsor A' },
      { id: 'FND_2', label: 'Sponsor B' }
    ];
  };
  try {
    const result = await manageService.listFunderOptionsForClass({
      classId: 'CLS_A',
      reqUser: { id: 'U1' },
      accessContext: {}
    });
    assert.equal(result.classId, 'CLS_A');
    assert.equal(result.funderOptions.length, 2);
    assert.equal(result.funderOptions[0].label, 'Sponsor A');
  } finally {
    scheduleEnrollStudentsService.loadActiveFunderOptions = originalLoad;
    manageService.__resetDependenciesForTest();
  }
});

test('manage enrollment is wired to the schedule admin rail only', () => {
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  const routes = read('MVC/routes/scheduleRoutes.js');
  const viewer = read('public/scripts/masterScheduleViewer.js');
  const script = read('public/scripts/masterScheduleManageEnrollment.js');
  const rolling = read('MVC/views/school/class/rollingEnrollment.ejs');

  assert.match(view, /data-schedule-admin-action="manage-enrollment"/);
  assert.match(
    view,
    /data-schedule-admin-action="enroll-students"[\s\S]*?data-schedule-admin-action="manage-enrollment"[\s\S]*?data-schedule-admin-action="move-enrollments"/
  );
  assert.match(view, /scheduleManageEnrollmentModal/);
  assert.match(view, /enrollmentPeriodCloseModal/);
  assert.match(view, /enrollmentPeriodEditModal/);
  assert.match(view, /masterScheduleManageEnrollment\.js/);

  const adminBlocks = view.split('<% if (canSelectAnyPerson) { %>');
  assert.ok(adminBlocks.length > 1);
  const nonAdminPrefix = adminBlocks[0];
  assert.doesNotMatch(nonAdminPrefix, /scheduleManageEnrollmentModal/);
  assert.doesNotMatch(nonAdminPrefix, /masterScheduleManageEnrollment\.js/);
  assert.doesNotMatch(nonAdminPrefix, /enrollmentPeriodEditModal/);

  assert.match(routes, /\/api\/manage-enrollments\/list/);
  assert.match(routes, /\/api\/manage-enrollments\/funder-options/);
  assert.match(viewer, /manage-enrollment/);
  assert.match(viewer, /installMasterScheduleManageEnrollment/);
  assert.match(viewer, /bindManageEnrollmentRail/);

  assert.match(script, /\/school\/schedules\/api\/manage-enrollments\/list/);
  assert.match(script, /manage-enrollments\/funder-options/);
  assert.match(script, /populateEditFunderSelect/);
  assert.match(script, /data-manage-enroll-action="edit"/);
  assert.match(script, /data-manage-enroll-action="close"/);
  assert.match(script, /data-manage-enroll-action="delete"/);
  assert.match(script, /data-manage-enroll-action="edit"[\s\S]*?bi-pencil-square/);
  assert.match(script, /data-manage-enroll-action="close"[\s\S]*?bi-x-circle/);
  assert.match(script, /data-manage-enroll-action="delete"[\s\S]*?bi-trash/);
  assert.doesNotMatch(script, /data-manage-enroll-action="edit"[^>]*>Edit</);
  assert.doesNotMatch(script, /data-manage-enroll-action="close"[^>]*>Close</);
  assert.doesNotMatch(script, /data-manage-enroll-action="delete"[^>]*>Delete</);
  assert.match(script, /enrollment-periods\/\$\{encodeURIComponent\(periodId\)\}\/edit/);
  assert.match(script, /enrollment-periods\/\$\{encodeURIComponent\(periodId\)\}\/remove/);
  assert.match(script, /enrollment-periods\/\$\{encodeURIComponent\(periodId\)\}\/close/);

  assert.match(rolling, /enrollmentPeriodCloseModal/);
  assert.match(rolling, /enrollmentPeriodEditModal/);
  assert.doesNotMatch(rolling, /id="editPeriodModal"/);
  assert.doesNotMatch(rolling, /id="closePeriodModal"/);
});
