const test = require('node:test');
const assert = require('node:assert/strict');

const schoolDataService = require('../MVC/services/school/schoolDataService');
const bookCoveringReportService = require('../MVC/services/school/bookCoveringReportService');
const scheduleSessionMutationService = require('../MVC/services/school/scheduleSessionMutationService');
const scheduleAccessService = require('../MVC/services/school/scheduleAccessService');
const schoolRecordAccessService = require('../MVC/services/school/schoolRecordAccessService');

const CLASS_ID = 'CLASS/1';
const SESSION_ID = 'SESSION/1';
const ORG_ID = 'ORG-1';

function buildReq() {
  return {
    user: { id: 'USER/1', activeOrgId: ORG_ID, personId: 'PERSON/1' },
    ip: '127.0.0.1',
    accessScope: ''
  };
}

function stubScheduleMutationDeps() {
  const session = {
    sessionId: SESSION_ID,
    date: '2026-03-01',
    startTime: '09:00',
    endTime: '10:00',
    status: 'scheduled',
    gradebooks: [{ id: 'GB/1', scores: [] }]
  };
  const originalGetById = schoolDataService.getDataById;
  const originalSessions = schoolDataService.getClassSessions;
  const originalFetchData = schoolDataService.fetchData;
  const originalFetchAll = schoolDataService.fetchAllData;
  const originalSave = schoolDataService.saveClassSessions;
  const originalCaps = scheduleAccessService.buildScheduleCapabilities;
  const originalAccessible = schoolRecordAccessService.assertSessionAccessible;
  const originalFindReport = bookCoveringReportService.findReportForSession;

  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes' && id === CLASS_ID) {
      return { id: CLASS_ID, orgId: ORG_ID, title: 'Test Class', registrationMode: 'term_based' };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => [session];
  schoolDataService.fetchData = async () => [];
  schoolDataService.fetchAllData = async () => [];
  schoolDataService.saveClassSessions = async () => {};
  bookCoveringReportService.findReportForSession = async () => null;
  scheduleAccessService.buildScheduleCapabilities = async () => ({ canDragCreateSessions: true });
  schoolRecordAccessService.assertSessionAccessible = () => {};

  return {
    restore: () => {
      schoolDataService.getDataById = originalGetById;
      schoolDataService.getClassSessions = originalSessions;
      schoolDataService.fetchData = originalFetchData;
      schoolDataService.fetchAllData = originalFetchAll;
      schoolDataService.saveClassSessions = originalSave;
      scheduleAccessService.buildScheduleCapabilities = originalCaps;
      schoolRecordAccessService.assertSessionAccessible = originalAccessible;
      bookCoveringReportService.findReportForSession = originalFindReport;
    }
  };
}

test('updateClassSessionSchedule rejects cross-day move when gradebook activity blocks date changes', async () => {
  const { restore } = stubScheduleMutationDeps();
  try {
    await assert.rejects(
      () => scheduleSessionMutationService.updateClassSessionSchedule({
        classId: CLASS_ID,
        sessionId: SESSION_ID,
        sessionDate: '2026-03-01',
        date: '2026-03-08',
        startTime: '09:00',
        endTime: '10:00'
      }, buildReq()),
      (error) => error.code === 'SESSION_DATE_MOVE_BLOCKED'
    );
  } finally {
    restore();
  }
});
