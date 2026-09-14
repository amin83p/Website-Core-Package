const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schoolDataService = require('../MVC/services/school/schoolDataService');
const bookCoveringReportService = require('../MVC/services/school/bookCoveringReportService');
const sessionManagementService = require('../MVC/services/school/sessionManagementService');
const scheduleAccessService = require('../MVC/services/school/scheduleAccessService');

const CLASS_ID = 'CLASS/1';
const SESSION_ID = 'SESSION/1';
const SESSION_2 = 'SESSION/2';
const ORG_ID = 'ORG-1';
const REQ_USER = { id: 'USER-1', activeOrgId: ORG_ID };

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function baseSession(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    date: '2026-03-01',
    startTime: '09:00',
    endTime: '10:00',
    status: 'scheduled',
    ...overrides
  };
}

function stubBulkDeleteExecutionDeps() {
  let savedSessions = null;
  const originalGetById = schoolDataService.getDataById;
  const originalSessions = schoolDataService.getClassSessions;
  const originalSave = schoolDataService.saveClassSessions;
  const originalFetchData = schoolDataService.fetchData;
  const originalFetchAll = schoolDataService.fetchAllData;
  const originalFindReport = bookCoveringReportService.findReportForSession;

  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes' && id === CLASS_ID) {
      return { id: CLASS_ID, orgId: ORG_ID, title: 'Test Class', registrationMode: 'term_based' };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => ([
    baseSession(),
    baseSession({ sessionId: SESSION_2, date: '2026-03-02', notes: 'blocked' })
  ]);
  schoolDataService.fetchData = async () => [];
  schoolDataService.fetchAllData = async () => [];
  schoolDataService.saveClassSessions = async (_classId, sessions) => {
    savedSessions = sessions;
  };
  bookCoveringReportService.findReportForSession = async () => null;

  return {
    getSavedSessions: () => savedSessions,
    restore: () => {
      schoolDataService.getDataById = originalGetById;
      schoolDataService.getClassSessions = originalSessions;
      schoolDataService.saveClassSessions = originalSave;
      schoolDataService.fetchData = originalFetchData;
      schoolDataService.fetchAllData = originalFetchAll;
      bookCoveringReportService.findReportForSession = originalFindReport;
    }
  };
}

test('schedule routes expose bulk delete preview and execute with session delete auth', () => {
  const source = read('MVC/routes/scheduleRoutes.js');
  assert.match(source, /\/api\/bulk-delete-sessions\/preview/);
  assert.match(source, /\/api\/bulk-delete-sessions'/);
  assert.match(
    source,
    /\/api\/bulk-delete-sessions\/preview'[\s\S]*trackActionState\(SECTIONS\.SCHOOL_SESSIONS,\s*OPERATIONS\.DELETE/
  );
  assert.match(
    source,
    /\/api\/bulk-delete-sessions'[\s\S]*trackActionState\(SECTIONS\.SCHOOL_SESSIONS,\s*OPERATIONS\.DELETE/
  );
});

test('scheduleAccessService exposes canDeleteClassSessions capability', async () => {
  const original = scheduleAccessService.buildScheduleCapabilities;
  scheduleAccessService.buildScheduleCapabilities = async () => ({
    canDeleteClassSessions: true,
    canSelectAnyPerson: true
  });
  try {
    const viewer = scheduleAccessService.toViewerScheduleAccess({
      canDeleteClassSessions: true
    });
    assert.equal(viewer.canDeleteClassSessions, true);
  } finally {
    scheduleAccessService.buildScheduleCapabilities = original;
  }
});

test('executeBulkSessionDelete performs partial delete and reports blocked sessions', async () => {
  const { getSavedSessions, restore } = stubBulkDeleteExecutionDeps();
  try {
    const result = await sessionManagementService.executeBulkSessionDelete({
      classId: CLASS_ID,
      targets: [
        { sessionId: SESSION_ID, sessionDate: '2026-03-01' },
        { sessionId: SESSION_2, sessionDate: '2026-03-02' }
      ],
      reqUser: REQ_USER,
      source: 'master_schedule'
    });
    assert.equal(result.deletedCount, 1);
    assert.equal(result.deleted[0].sessionId, SESSION_ID);
    assert.equal(result.blocked.length, 1);
    assert.equal(result.blocked[0].sessionId, SESSION_2);
    const saved = getSavedSessions();
    assert.equal(Array.isArray(saved) ? saved.length : 0, 1);
    assert.equal(saved[0].sessionId, SESSION_2);
  } finally {
    restore();
  }
});
