const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const schoolDataService = require('../MVC/services/school/schoolDataService');
const schoolDeletionGuardService = require('../MVC/services/school/schoolDeletionGuardService');
const sessionStatusPolicyService = require('../MVC/services/school/sessionStatusPolicyService');
const sessionDeletePreparationService = require('../MVC/services/school/sessionDeletePreparationService');

const CLASS_ID = 'CLASS/1';
const SESSION_ID = 'SESSION/PARENT';
const MAKEUP_SESSION_ID = 'SESSION/MAKEUP';
const ORG_ID = 'ORG-1';
const REQ_USER = { id: 'USER-1', activeOrgId: ORG_ID };

function stubSessionDeleteDeps({
  sessions = [],
  guardBlockers = [],
  guardWarnings = []
} = {}) {
  const originalGetById = schoolDataService.getDataById;
  const originalSessions = schoolDataService.getClassSessions;
  const originalPreview = schoolDeletionGuardService.previewDelete;
  const originalStatusDefs = sessionStatusPolicyService.getStatusDefinitions;

  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'classes' && id === CLASS_ID) {
      return { id: CLASS_ID, orgId: ORG_ID, title: 'Test Class' };
    }
    return null;
  };
  schoolDataService.getClassSessions = async () => sessions;
  schoolDeletionGuardService.previewDelete = async () => ({
    canDelete: guardBlockers.length === 0,
    blockers: guardBlockers,
    warnings: guardWarnings,
    policy: 'deletable'
  });
  sessionStatusPolicyService.getStatusDefinitions = async () => ([
    { code: 'scheduled', label: 'Scheduled' }
  ]);

  return () => {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.getClassSessions = originalSessions;
    schoolDeletionGuardService.previewDelete = originalPreview;
    sessionStatusPolicyService.getStatusDefinitions = originalStatusDefs;
  };
}

test('buildSessionDeletePreview blocks delete when linked make-up child sessions exist', async () => {
  const restore = stubSessionDeleteDeps({
    sessions: [
      {
        sessionId: SESSION_ID,
        date: '2026-03-01',
        status: 'completed'
      },
      {
        sessionId: MAKEUP_SESSION_ID,
        date: '2026-03-08',
        status: 'scheduled',
        makeup: {
          isMakeup: true,
          originalClassId: CLASS_ID,
          originalSessionId: SESSION_ID
        }
      }
    ]
  });
  try {
    const preview = await sessionDeletePreparationService.buildSessionDeletePreview({
      classId: CLASS_ID,
      sessionId: SESSION_ID,
      reqUser: REQ_USER
    });
    assert.equal(preview.canDelete, false);
    const makeupBlocker = preview.blockers.find((row) => row.code === 'MAKEUP_CHILD_SESSIONS_EXIST');
    assert.ok(makeupBlocker);
    assert.equal(makeupBlocker.count, 1);
    assert.equal(preview.confirmationText, '');
    assert.match(makeupBlocker.samples[0].href, /\/school\/classes\/CLASS%2F1\/sessions\/SESSION%2FMAKEUP/);
  } finally {
    restore();
  }
});

test('buildSessionDeletePreview allows delete when only auto-cascade entities remain', async () => {
  const restore = stubSessionDeleteDeps({
    sessions: [{
      sessionId: SESSION_ID,
      date: '2026-03-01',
      status: 'completed',
      roster: [{ studentId: 'STU/1', attendanceStatus: 'present' }],
      gradebooks: [{ id: 'GB/1', scores: [{ studentId: 'STU/1', value: 90 }] }],
      contentItems: [{ id: 'CNT/1', type: 'html' }],
      skillsCovered: [{ id: 'SK/1' }],
      conductReadyForReports: true
    }],
    guardBlockers: [
      { code: 'REPORT_INSTANCE', label: 'Report instances', count: 2, samples: [] },
      { code: 'REPORT_ASSIGNMENT', label: 'Report assignments', count: 1, samples: [] },
      { code: 'SESSION_CASE', label: 'Session student cases', count: 3, samples: [] }
    ]
  });
  try {
    const preview = await sessionDeletePreparationService.buildSessionDeletePreview({
      classId: CLASS_ID,
      sessionId: SESSION_ID,
      reqUser: REQ_USER
    });
    assert.equal(preview.canDelete, true);
    assert.equal(preview.blockers.length, 0);
    assert.ok(preview.autoCascade.some((row) => row.code === 'REPORT_INSTANCE'));
    assert.ok(preview.autoCascade.some((row) => row.code === 'EMBEDDED_GRADEBOOKS'));
    assert.ok(preview.autoCascade.some((row) => row.code === 'EMBEDDED_ATTENDANCE'));
    assert.equal(preview.confirmationText, 'DELETE 2026-03-01 (SESSION/PARENT)');
  } finally {
    restore();
  }
});

test('buildSessionDeletePreview surfaces guard blockers for timesheet and leave', async () => {
  const restore = stubSessionDeleteDeps({
    sessions: [{ sessionId: SESSION_ID, date: '2026-03-01', status: 'completed' }],
    guardBlockers: [
      { code: 'TIMESHEET_LOCKED', label: 'Locked timesheet', count: 1, samples: [{ label: 'Timesheet March' }] },
      { code: 'LEAVE_REQUEST', label: 'Leave requests', count: 1, samples: [{ label: 'Leave for teacher' }] }
    ]
  });
  try {
    const preview = await sessionDeletePreparationService.buildSessionDeletePreview({
      classId: CLASS_ID,
      sessionId: SESSION_ID,
      reqUser: REQ_USER
    });
    assert.equal(preview.canDelete, false);
    assert.equal(preview.blockers.length, 2);
    assert.ok(preview.blockers.some((row) => row.code === 'TIMESHEET_LOCKED'));
    assert.ok(preview.blockers.some((row) => row.code === 'LEAVE_REQUEST'));
    assert.equal(preview.autoCascade.length, 0);
  } finally {
    restore();
  }
});

test('class routes expose session delete preview endpoint', () => {
  const routes = read('MVC/routes/classRoutes.js');
  assert.match(routes, /\/:id\/sessions\/:sessionId\/delete-preview/);
  assert.match(routes, /previewClassSessionDelete/);
});

test('previewClassSessionDelete returns delete action state token', () => {
  const controller = read('MVC/controllers/school/classController.js');
  assert.match(controller, /actionStateId:\s*req\.actionStateId/);
});

test('session manager view includes admin delete session workflow', () => {
  const view = read('MVC/views/school/class/sessionManager.ejs');
  assert.match(view, /btnDeleteSession/);
  assert.match(view, /delete-preview/);
  assert.match(view, /openSessionDeleteModal/);
  assert.match(view, /sessionCanDeleteSession/);
  assert.match(view, /sessionDeleteActionStateId/);
  assert.match(view, /sessionShowDeleteError/);
  assert.match(view, /leaveSessionManagerAfterDelete/);
  assert.match(view, /Session Deleted/);
});
