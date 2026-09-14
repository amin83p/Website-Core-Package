const test = require('node:test');
const assert = require('node:assert/strict');

const schoolDataService = require('../MVC/services/school/schoolDataService');
const classEnrollmentReadService = require('../MVC/services/school/classEnrollmentReadService');
const schoolRepositories = require('../MVC/repositories/school');
const reportIntegrityService = require('../MVC/services/school/reportIntegrityService');
const reportRosterService = require('../MVC/services/school/reportRosterService');
const reportAssignmentStudentEligibilityService = require('../MVC/services/school/reportAssignmentStudentEligibilityService');
const sessionStatusPolicyService = require('../MVC/services/school/sessionStatusPolicyService');
const leaveRequestService = require('../MVC/services/school/leaveRequestService');

const reqUser = { id: 'USR-1', activeOrgId: '900000' };
const classData = { id: 'CLS-1', orgId: '900000', title: 'Class A', registrationMode: 'term_based' };
const template = {
  id: 'TPL-1',
  orgId: '900000',
  version: 1,
  allowedReportScopes: ['class', 'each_student', 'selected_students']
};

function buildSessionTargetRow(overrides = {}) {
  return {
    rowId: 'row-1',
    targetType: 'session',
    sessionId: 'SES-1',
    sessionDate: '2026-09-15',
    dueDate: '',
    reportStartDate: '2026-09-15',
    reportDueDate: '2026-09-15',
    taskStartTime: '09:00',
    taskEndTime: '10:00',
    conflictPermitted: true,
    teacherId: 'TCH-1',
    status: 'active',
    notes: '',
    ...overrides
  };
}

test('resolveEachStudentTargetPersonIds prefers stored targetStudentIds over session roster', async () => {
  const personIds = await reportRosterService.resolveEachStudentTargetPersonIds({
    assignment: {
      reportScope: 'each_student',
      sessionId: 'SES-1',
      targetStudentIds: ['STU-1', 'STU-2']
    },
    classData,
    sessions: [{
      sessionId: 'SES-1',
      date: '2026-09-15',
      roster: [{ personId: 'STU-ROSTER-ONLY' }]
    }],
    reqUser,
    resolveEnrollmentPersonIds: async () => ['STU-ENROLLMENT']
  });
  assert.deepEqual(personIds, ['STU-1', 'STU-2']);
});

test('resolveEachStudentTargetPersonIds falls back to enrollment when targetStudentIds are empty', async () => {
  const personIds = await reportRosterService.resolveEachStudentTargetPersonIds({
    assignment: {
      reportScope: 'each_student',
      sessionId: 'SES-1',
      targetStudentIds: []
    },
    classData,
    sessions: [{
      sessionId: 'SES-1',
      date: '2026-09-15',
      roster: [{ personId: 'STU-ROSTER-ONLY' }]
    }],
    reqUser,
    resolveEnrollmentPersonIds: async () => ['STU-ENROLLMENT']
  });
  assert.deepEqual(personIds, ['STU-ENROLLMENT']);
});

test('validateAssignmentCrossEntityContext succeeds for each_student when enrollment exists but session roster is empty', async () => {
  const originals = {
    getDataById: schoolDataService.getDataById,
    getClassSessions: schoolDataService.getClassSessions,
    fetchAllData: schoolDataService.fetchAllData,
    getTemplateById: schoolRepositories.reportTemplates.getById,
    listActiveStudentIdsForClass: classEnrollmentReadService.listActiveStudentIdsForClass
  };
  try {
    schoolDataService.getDataById = async (entityType, id) => {
      if (entityType === 'classes' && id === 'CLS-1') return classData;
      return null;
    };
    schoolDataService.getClassSessions = async () => ([{
      sessionId: 'SES-1',
      date: '2026-09-15',
      startTime: '09:00',
      endTime: '10:00',
      roster: []
    }]);
    schoolDataService.fetchAllData = async (entityType) => {
      if (entityType === 'students') {
        return [
          { id: 'REG-1', personId: 'STU-1' },
          { id: 'REG-2', personId: 'STU-2' }
        ];
      }
      return [];
    };
    schoolRepositories.reportTemplates.getById = async () => template;
    classEnrollmentReadService.listActiveStudentIdsForClass = async () => ({
      source: 'canonical',
      studentIds: new Set(['REG-1', 'REG-2']),
      usedFallback: false
    });

    const result = await reportIntegrityService.validateAssignmentCrossEntityContext({
      classId: 'CLS-1',
      templateId: 'TPL-1',
      reqUser,
      reportScope: 'each_student',
      hasSessionTargets: true,
      selectedSessionIds: ['SES-1'],
      teacherIds: ['TCH-1'],
      requestedReportStartDate: '2026-09-15',
      requestedReportDueDate: '2026-09-15',
      selectedTargetStudentIds: [],
      targetRows: [buildSessionTargetRow()]
    });

    assert.deepEqual(result.persistedTargetStudentIds.sort(), ['STU-1', 'STU-2']);
  } finally {
    schoolDataService.getDataById = originals.getDataById;
    schoolDataService.getClassSessions = originals.getClassSessions;
    schoolDataService.fetchAllData = originals.fetchAllData;
    schoolRepositories.reportTemplates.getById = originals.getTemplateById;
    classEnrollmentReadService.listActiveStudentIdsForClass = originals.listActiveStudentIdsForClass;
  }
});

test('validateAssignmentCrossEntityContext fails when no students are enrolled for each_student scope', async () => {
  const originals = {
    getDataById: schoolDataService.getDataById,
    getClassSessions: schoolDataService.getClassSessions,
    fetchAllData: schoolDataService.fetchAllData,
    getTemplateById: schoolRepositories.reportTemplates.getById,
    listActiveStudentIdsForClass: classEnrollmentReadService.listActiveStudentIdsForClass
  };
  try {
    schoolDataService.getDataById = async (entityType, id) => {
      if (entityType === 'classes' && id === 'CLS-1') return classData;
      return null;
    };
    schoolDataService.getClassSessions = async () => ([{
      sessionId: 'SES-1',
      date: '2026-09-15',
      startTime: '09:00',
      endTime: '10:00',
      roster: []
    }]);
    schoolDataService.fetchAllData = async () => [];
    schoolRepositories.reportTemplates.getById = async () => template;
    classEnrollmentReadService.listActiveStudentIdsForClass = async () => ({
      source: 'canonical',
      studentIds: new Set(),
      usedFallback: false
    });

    await assert.rejects(
      () => reportIntegrityService.validateAssignmentCrossEntityContext({
        classId: 'CLS-1',
        templateId: 'TPL-1',
        reqUser,
        reportScope: 'each_student',
        hasSessionTargets: true,
        selectedSessionIds: ['SES-1'],
        teacherIds: ['TCH-1'],
        requestedReportStartDate: '2026-09-15',
        requestedReportDueDate: '2026-09-15',
        selectedTargetStudentIds: [],
        targetRows: [buildSessionTargetRow()]
      }),
      /No students with active enrollment for any target row/
    );
  } finally {
    schoolDataService.getDataById = originals.getDataById;
    schoolDataService.getClassSessions = originals.getClassSessions;
    schoolDataService.fetchAllData = originals.fetchAllData;
    schoolRepositories.reportTemplates.getById = originals.getTemplateById;
    classEnrollmentReadService.listActiveStudentIdsForClass = originals.listActiveStudentIdsForClass;
  }
});

test('resolveEachStudentTargetPersonIds prefers targetRow targetStudentIds over assignment ids', async () => {
  const personIds = await reportRosterService.resolveEachStudentTargetPersonIds({
    assignment: {
      reportScope: 'each_student',
      targetStudentIds: ['STU-ASSIGNMENT']
    },
    targetRow: {
      targetStudentIds: ['STU-ROW-1', 'STU-ROW-2']
    },
    reqUser,
    resolveEnrollmentPersonIds: async () => ['STU-ENROLLMENT']
  });
  assert.deepEqual(personIds, ['STU-ROW-1', 'STU-ROW-2']);
});

test('validateAssignmentCrossEntityContext allows different student sets per row', async () => {
  const originals = {
    getDataById: schoolDataService.getDataById,
    getClassSessions: schoolDataService.getClassSessions,
    fetchAllData: schoolDataService.fetchAllData,
    getTemplateById: schoolRepositories.reportTemplates.getById,
    listActiveStudentIdsForClass: classEnrollmentReadService.listActiveStudentIdsForClass
  };
  try {
    schoolDataService.getDataById = async (entityType, id) => {
      if (entityType === 'classes' && id === 'CLS-1') return classData;
      return null;
    };
    schoolDataService.getClassSessions = async () => ([
      {
        sessionId: 'SES-1',
        date: '2026-09-15',
        startTime: '09:00',
        endTime: '10:00',
        roster: []
      },
      {
        sessionId: 'SES-2',
        date: '2026-09-22',
        startTime: '09:00',
        endTime: '10:00',
        roster: []
      }
    ]);
    schoolDataService.fetchAllData = async (entityType) => {
      if (entityType === 'students') {
        return [
          { id: 'REG-1', personId: 'STU-1' },
          { id: 'REG-2', personId: 'STU-2' },
          { id: 'REG-3', personId: 'STU-3' }
        ];
      }
      return [];
    };
    schoolRepositories.reportTemplates.getById = async () => template;
    classEnrollmentReadService.listActiveStudentIdsForClass = async ({ startDate }) => {
      if (startDate === '2026-09-15') {
        return { source: 'canonical', studentIds: new Set(['REG-1', 'REG-2']), usedFallback: false };
      }
      return { source: 'canonical', studentIds: new Set(['REG-2', 'REG-3']), usedFallback: false };
    };

    const result = await reportIntegrityService.validateAssignmentCrossEntityContext({
      classId: 'CLS-1',
      templateId: 'TPL-1',
      reqUser,
      reportScope: 'selected_students',
      hasSessionTargets: true,
      selectedSessionIds: ['SES-1', 'SES-2'],
      teacherIds: ['TCH-1'],
      requestedReportStartDate: '2026-09-15',
      requestedReportDueDate: '2026-09-22',
      selectedTargetStudentIds: [],
      targetRows: [
        buildSessionTargetRow({
          rowId: 'row-1',
          sessionId: 'SES-1',
          sessionDate: '2026-09-15',
          reportStartDate: '2026-09-15',
          reportDueDate: '2026-09-15',
          targetStudentIds: ['STU-1']
        }),
        buildSessionTargetRow({
          rowId: 'row-2',
          sessionId: 'SES-2',
          sessionDate: '2026-09-22',
          reportStartDate: '2026-09-22',
          reportDueDate: '2026-09-22',
          targetStudentIds: ['STU-3']
        })
      ]
    });

    assert.deepEqual(result.effectiveTargetRows[0].targetStudentIds, ['STU-1']);
    assert.deepEqual(result.effectiveTargetRows[1].targetStudentIds, ['STU-3']);
    assert.deepEqual(result.persistedTargetStudentIds.sort(), ['STU-1', 'STU-3']);
  } finally {
    schoolDataService.getDataById = originals.getDataById;
    schoolDataService.getClassSessions = originals.getClassSessions;
    schoolDataService.fetchAllData = originals.fetchAllData;
    schoolRepositories.reportTemplates.getById = originals.getTemplateById;
    classEnrollmentReadService.listActiveStudentIdsForClass = originals.listActiveStudentIdsForClass;
  }
});

test('validateAssignmentCrossEntityContext stores per-row targetStudentIds for each_student', async () => {
  const originals = {
    getDataById: schoolDataService.getDataById,
    getClassSessions: schoolDataService.getClassSessions,
    fetchAllData: schoolDataService.fetchAllData,
    getTemplateById: schoolRepositories.reportTemplates.getById,
    listActiveStudentIdsForClass: classEnrollmentReadService.listActiveStudentIdsForClass
  };
  try {
    schoolDataService.getDataById = async (entityType, id) => {
      if (entityType === 'classes' && id === 'CLS-1') return classData;
      return null;
    };
    schoolDataService.getClassSessions = async () => ([{
      sessionId: 'SES-1',
      date: '2026-09-15',
      startTime: '09:00',
      endTime: '10:00',
      roster: []
    }]);
    schoolDataService.fetchAllData = async (entityType) => {
      if (entityType === 'students') {
        return [
          { id: 'REG-1', personId: 'STU-1' },
          { id: 'REG-2', personId: 'STU-2' }
        ];
      }
      return [];
    };
    schoolRepositories.reportTemplates.getById = async () => template;
    classEnrollmentReadService.listActiveStudentIdsForClass = async () => ({
      source: 'canonical',
      studentIds: new Set(['REG-1', 'REG-2']),
      usedFallback: false
    });

    const result = await reportIntegrityService.validateAssignmentCrossEntityContext({
      classId: 'CLS-1',
      templateId: 'TPL-1',
      reqUser,
      reportScope: 'each_student',
      hasSessionTargets: true,
      selectedSessionIds: ['SES-1'],
      teacherIds: ['TCH-1'],
      requestedReportStartDate: '2026-09-15',
      requestedReportDueDate: '2026-09-15',
      selectedTargetStudentIds: [],
      targetRows: [buildSessionTargetRow({ targetStudentIds: ['STU-1'] })]
    });

    assert.deepEqual(result.effectiveTargetRows[0].targetStudentIds, ['STU-1']);
    assert.deepEqual(result.persistedTargetStudentIds, ['STU-1']);
  } finally {
    schoolDataService.getDataById = originals.getDataById;
    schoolDataService.getClassSessions = originals.getClassSessions;
    schoolDataService.fetchAllData = originals.fetchAllData;
    schoolRepositories.reportTemplates.getById = originals.getTemplateById;
    classEnrollmentReadService.listActiveStudentIdsForClass = originals.listActiveStudentIdsForClass;
  }
});

test('validateAssignmentCrossEntityContext fails selected_students when a row has no students', async () => {
  const originals = {
    getDataById: schoolDataService.getDataById,
    getClassSessions: schoolDataService.getClassSessions,
    fetchAllData: schoolDataService.fetchAllData,
    getTemplateById: schoolRepositories.reportTemplates.getById,
    listActiveStudentIdsForClass: classEnrollmentReadService.listActiveStudentIdsForClass
  };
  try {
    schoolDataService.getDataById = async (entityType, id) => {
      if (entityType === 'classes' && id === 'CLS-1') return classData;
      return null;
    };
    schoolDataService.getClassSessions = async () => ([{
      sessionId: 'SES-1',
      date: '2026-09-15',
      startTime: '09:00',
      endTime: '10:00',
      roster: []
    }]);
    schoolDataService.fetchAllData = async (entityType) => {
      if (entityType === 'students') {
        return [{ id: 'REG-1', personId: 'STU-1' }];
      }
      return [];
    };
    schoolRepositories.reportTemplates.getById = async () => template;
    classEnrollmentReadService.listActiveStudentIdsForClass = async () => ({
      source: 'canonical',
      studentIds: new Set(['REG-1']),
      usedFallback: false
    });

    await assert.rejects(
      () => reportIntegrityService.validateAssignmentCrossEntityContext({
        classId: 'CLS-1',
        templateId: 'TPL-1',
        reqUser,
        reportScope: 'selected_students',
        hasSessionTargets: true,
        selectedSessionIds: ['SES-1'],
        teacherIds: ['TCH-1'],
        requestedReportStartDate: '2026-09-15',
        requestedReportDueDate: '2026-09-15',
        selectedTargetStudentIds: [],
        targetRows: [buildSessionTargetRow({ targetStudentIds: [] })]
      }),
      /Select at least one student for target row/
    );
  } finally {
    schoolDataService.getDataById = originals.getDataById;
    schoolDataService.getClassSessions = originals.getClassSessions;
    schoolDataService.fetchAllData = originals.fetchAllData;
    schoolRepositories.reportTemplates.getById = originals.getTemplateById;
    classEnrollmentReadService.listActiveStudentIdsForClass = originals.listActiveStudentIdsForClass;
  }
});

test('resolveStartInstanceContext uses targetRow targetStudentIds for each_student', async () => {
  const originals = {
    getDataById: schoolDataService.getDataById,
    getClassSessions: schoolDataService.getClassSessions,
    getTemplateById: schoolRepositories.reportTemplates.getById,
    getAssignmentById: schoolRepositories.reportAssignments.getById
  };
  try {
    const assignment = {
      id: 'ASN-1',
      orgId: '900000',
      classId: 'CLS-1',
      templateId: 'TPL-1',
      reportScope: 'each_student',
      teacherIds: ['TCH-1'],
      targetRows: [buildSessionTargetRow({ rowId: 'row-1', targetStudentIds: ['STU-ROW'] })]
    };
    schoolRepositories.reportAssignments.getById = async () => assignment;
    schoolDataService.getDataById = async (entityType, id) => {
      if (entityType === 'classes' && id === 'CLS-1') return classData;
      return null;
    };
    schoolDataService.getClassSessions = async () => ([{
      sessionId: 'SES-1',
      date: '2026-09-15',
      startTime: '09:00',
      endTime: '10:00',
      roster: []
    }]);
    schoolRepositories.reportTemplates.getById = async () => template;
    schoolDataService.fetchAllData = async () => [];

    const result = await reportIntegrityService.resolveStartInstanceContext({
      assignmentId: 'ASN-1',
      assignmentRowId: 'row-1',
      reqUser: { id: 'USR-1', activeOrgId: '900000', personId: 'TCH-1' },
      requestedTeacherId: 'TCH-1'
    });

    assert.deepEqual(result.targetStudentIds, ['STU-ROW']);
  } finally {
    schoolDataService.getDataById = originals.getDataById;
    schoolDataService.getClassSessions = originals.getClassSessions;
    schoolRepositories.reportTemplates.getById = originals.getTemplateById;
    schoolRepositories.reportAssignments.getById = originals.getAssignmentById;
  }
});

test('resolveEligibleStudentsForAssignment returns eligible session counts for term-based classes', async () => {
  const originals = {
    fetchAllData: schoolDataService.fetchAllData,
    getClassEnrollmentPeriodsByClassId: schoolDataService.getClassEnrollmentPeriodsByClassId,
    listActiveStudentIdsForClass: classEnrollmentReadService.listActiveStudentIdsForClass,
    getStatusMap: sessionStatusPolicyService.getStatusMap,
    findApprovedLeaveConflicts: leaveRequestService.findApprovedLeaveConflicts
  };
  try {
    schoolDataService.fetchAllData = async (entityType) => {
      if (entityType === 'students') {
        return [{ id: 'REG-1', personId: 'STU-1', name: 'Student One' }];
      }
      return [];
    };
    schoolDataService.getClassEnrollmentPeriodsByClassId = async () => ([{
      id: 'PER-1',
      orgId: '900000',
      classId: 'CLS-1',
      studentId: 'REG-1',
      status: 'active',
      startDate: '2026-09-01',
      endDate: '2026-12-31'
    }]);
    classEnrollmentReadService.listActiveStudentIdsForClass = async () => ({
      source: 'canonical',
      studentIds: new Set(['REG-1']),
      usedFallback: false
    });
    sessionStatusPolicyService.getStatusMap = async () => new Map();
    leaveRequestService.findApprovedLeaveConflicts = async () => [];

    const students = await reportAssignmentStudentEligibilityService.resolveEligibleStudentsForAssignment({
      classData,
      sessions: [
        { sessionId: 'SES-1', date: '2026-09-15', startTime: '09:00', endTime: '10:00' },
        { sessionId: 'SES-2', date: '2026-10-01', startTime: '09:00', endTime: '10:00' }
      ],
      reqUser,
      startDate: '2026-09-01',
      endDate: '2026-10-31',
      targetSessionIds: ['SES-1'],
      targetRows: [buildSessionTargetRow()],
      personMap: new Map([['STU-1', 'Student One']])
    });

    assert.equal(students.length, 1);
    assert.equal(students[0].personId, 'STU-1');
    assert.equal(students[0].eligibleSessionCount, 1);
  } finally {
    schoolDataService.fetchAllData = originals.fetchAllData;
    schoolDataService.getClassEnrollmentPeriodsByClassId = originals.getClassEnrollmentPeriodsByClassId;
    classEnrollmentReadService.listActiveStudentIdsForClass = originals.listActiveStudentIdsForClass;
    sessionStatusPolicyService.getStatusMap = originals.getStatusMap;
    leaveRequestService.findApprovedLeaveConflicts = originals.findApprovedLeaveConflicts;
  }
});
