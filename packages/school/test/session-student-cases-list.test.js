const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const SCHOOL_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function setRequireStub(modulePath, exportsValue, originals) {
  const resolved = require.resolve(modulePath);
  if (!originals.has(resolved)) originals.set(resolved, require.cache[resolved]);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsValue
  };
}

function restoreRequireStubs(originals) {
  for (const [resolved, cached] of originals.entries()) {
    if (cached === undefined) delete require.cache[resolved];
    else require.cache[resolved] = cached;
  }
}

const workspaceService = require('../MVC/services/school/sessionStudentCaseWorkspaceService');
const { SCOPE_MODES } = require('../MVC/services/school/schoolDataScopeBuilder');

test('session student cases section is registered in access constants and routes', () => {
  const accessSource = read('packages/school/config/accessConstants.js');
  const mainRouteSource = read('packages/school/MVC/routes/schoolMainRoute.js');
  const routeSource = read('packages/school/MVC/routes/sessionStudentCaseRoutes.js');
  const controllerSource = read('packages/school/MVC/controllers/school/sessionStudentCaseController.js');

  assert.match(accessSource, /SCHOOL_SESSION_STUDENT_CASES:\s*'SCHOOL_SESSION_STUDENT_CASES'/);
  assert.match(mainRouteSource, /router\.use\('\/session-student-cases',\s*require\('\.\/sessionStudentCaseRoutes'\)\)/);
  assert.match(routeSource, /SECTIONS\.SCHOOL_SESSION_STUDENT_CASES/);
  assert.match(routeSource, /OPERATIONS\.READ_ALL/);
  const listRouteBlock = routeSource.slice(routeSource.indexOf("router.get('/'"), routeSource.indexOf('router.get(\'/:caseId/review-context\''));
  const listTrackActionStateCount = (listRouteBlock.match(/trackActionState\(/g) || []).length;
  assert.equal(listTrackActionStateCount, 1, 'GET list route must use a single trackActionState to avoid res.send recursion');
  assert.match(routeSource, /ctrl\.listSessionStudentCases/);
  assert.match(controllerSource, /exports\.listSessionStudentCases/);
  assert.match(controllerSource, /sessionStudentCaseWorkspaceService\.listSessionStudentCasesForRequest/);
  assert.match(routeSource, /review-context/);
  assert.match(routeSource, /requireCaseSectionOperationAny/);
  assert.match(routeSource, /requireCaseStatusMutationAccess/);
  assert.doesNotMatch(routeSource, /SCHOOL_SESSIONS/);
  assert.match(read('packages/school/MVC/routes/sessionStudentCaseRouteGuards.js'), /OPERATIONS\.RESOLVE/);
  assert.match(routeSource, /ctrl\.getReviewContext/);
  assert.match(routeSource, /ctrl\.saveCase/);
  assert.match(controllerSource, /exports\.getReviewContext/);
  assert.match(controllerSource, /sessionStudentCaseReviewService/);
  assert.match(controllerSource, /sessionStudentCaseAccessService/);
  assert.match(controllerSource, /canResolveCases/);
  assert.match(controllerSource, /canDeleteCases/);
  assert.match(controllerSource, /resolveListCapabilities/);
});

test('session student cases list view contains table and row action menu wiring', () => {
  const viewSource = read('packages/school/MVC/views/school/sessionStudentCase/sessionStudentCaseList.ejs');
  const controllerSource = read('packages/school/MVC/controllers/school/sessionStudentCaseController.js');
  const clientSource = read('packages/school/public/scripts/sessionStudentCaseModalClient.js');

  assert.match(controllerSource, /tableName:\s*'School_SessionStudentCases'/);
  assert.match(controllerSource, /includeModal_Table:\s*true/);
  assert.match(viewSource, /Filter Student Cases/);
  assert.match(viewSource, /sessionStudentCaseFilterCollapse/);
  assert.match(viewSource, /tablePages-search/);
  const filterIndex = viewSource.indexOf('sessionStudentCaseFilterCollapse');
  const searchIndex = viewSource.indexOf('tablePages-search');
  assert.ok(filterIndex !== -1 && searchIndex !== -1 && filterIndex < searchIndex, 'Filter card should appear before tablePages-search');
  assert.match(viewSource, /card border-0 shadow-sm mb-3/);
  assert.match(viewSource, /btn btn-filled btn-primary btn-md/);
  assert.match(viewSource, /data-column="sessionDateTimeLabel"/);
  assert.match(viewSource, /data-column="classTitle"/);
  assert.match(viewSource, /data-column="studentName"/);
  assert.match(viewSource, /data-column="severity"/);
  assert.match(viewSource, /btn-row-actions-toggle/);
  assert.match(viewSource, /row-actions-menu/);
  assert.match(viewSource, /bi-three-dots-vertical/);
  assert.match(viewSource, /Open Here/);
  assert.match(viewSource, /Open in Class Session/);
  assert.match(viewSource, /Resolve/);
  assert.match(viewSource, /Delete/);
  assert.match(viewSource, /js-student-case-open-here/);
  assert.match(viewSource, /js-student-case-open-session/);
  assert.match(viewSource, /js-student-case-resolve/);
  assert.match(viewSource, /js-student-case-delete/);
  assert.doesNotMatch(viewSource, /sessionStudentCaseOpenModeModal/);
  assert.doesNotMatch(viewSource, /js-review-student-case/);
  assert.match(viewSource, /baseUrlPath:\s*'school\/session-student-cases'/);
  assert.match(viewSource, /item\.reviewHref/);
  assert.match(viewSource, /canResolveCases/);
  assert.match(viewSource, /canDeleteCases/);
  assert.match(viewSource, /canReadCases/);
  assert.match(viewSource, /canReadRow/);
  assert.match(viewSource, /sessionStudentCaseModalClient\.js/);
  assert.match(viewSource, /SessionStudentCaseModal\.openRemote/);
  assert.match(viewSource, /SessionStudentCaseModal\.resolveRemote/);
  assert.match(viewSource, /SessionStudentCaseModal\.deleteRemote/);
  assert.match(read('packages/school/MVC/views/school/sessionStudentCase/partials/sessionStudentCaseModal.ejs'), /id="studentCaseModal"/);
  assert.match(clientSource, /document\.body\.appendChild\(modalEl\)/);
  assert.match(clientSource, /resolveRemote/);
  assert.match(clientSource, /deleteRemote/);
  const modalCss = read('public/styles/sessionStudentCaseModal.css');
  assert.match(modalCss, /\.student-case-student-grid/);
  assert.match(modalCss, /\.student-case-student-card/);
});

test('sessionIssueMatchesFilters applies severity, status group, and class filters', () => {
  const row = {
    severity: 'urgent',
    category: 'behavior',
    status: 'open',
    sessionDate: '2026-02-01',
    classId: 'CLS_1',
    teacherPersonId: 'TEA_1',
    studentPersonId: 'STU_1',
    summary: 'Needs follow-up'
  };

  assert.equal(workspaceService.sessionIssueMatchesFilters(row, { severity: 'urgent' }), true);
  assert.equal(workspaceService.sessionIssueMatchesFilters(row, { severity: 'info' }), false);
  assert.equal(workspaceService.sessionIssueMatchesFilters(row, { statusGroup: 'open' }), true);
  assert.equal(workspaceService.sessionIssueMatchesFilters(row, { statusGroup: 'resolved' }), false);
  assert.equal(workspaceService.sessionIssueMatchesFilters(row, { classId: 'CLS_1' }), true);
  assert.equal(workspaceService.sessionIssueMatchesFilters(row, { classId: 'CLS_2' }), false);
  assert.equal(workspaceService.sessionIssueMatchesFilters(row, {}, 'follow-up'), true);
  assert.equal(workspaceService.sessionIssueMatchesFilters(row, {}, 'missing'), false);
});

test('sortSessionIssueRows prioritizes open urgent cases by session date', () => {
  const rows = workspaceService.sortSessionIssueRows([
    { status: 'resolved', severity: 'urgent', sessionDate: '2026-02-10' },
    { status: 'open', severity: 'info', sessionDate: '2026-02-11' },
    { status: 'open', severity: 'urgent', sessionDate: '2026-02-12' }
  ]);

  assert.equal(rows[0].severity, 'urgent');
  assert.equal(rows[0].status, 'open');
  assert.equal(rows[0].sessionDate, '2026-02-12');
});

test('normalizeSessionIssueRows builds review link to manage session', () => {
  const [row] = workspaceService.normalizeSessionIssueRows([{
    id: 'CASE_1',
    classId: 'CLS_1',
    sessionId: 'SES_1',
    classTitle: 'Math 101',
    studentName: 'Jane Doe',
    severity: 'warning',
    status: 'in_progress',
    summary: 'Late arrival'
  }]);

  assert.equal(row.classTitle, 'Math 101');
  assert.equal(row.studentName, 'Jane Doe');
  assert.equal(row.actions.length, 1);
  assert.match(row.actions[0].href, /\/school\/classes\/CLS_1\/sessions\/SES_1\?caseId=CASE_1/);
});

test('filterCasesByAccessScope returns all rows for org-wide access', async () => {
  const originals = new Map();
  const servicePath = require.resolve('../MVC/services/school/sessionStudentCaseWorkspaceService');
  const accessPath = require.resolve('../MVC/services/school/schoolRecordAccessService');
  const dataPath = require.resolve('../MVC/services/school/schoolDataService');
  [servicePath, accessPath, dataPath].forEach((modulePath) => delete require.cache[modulePath]);

  setRequireStub(accessPath, {
    resolveAccessFromRequest() {
      return { scopeMode: SCOPE_MODES.ORG_WIDE, canViewAll: true };
    },
    isOrgWideScope() {
      return true;
    },
    isRecordOwnedByUser() {
      return false;
    }
  }, originals);
  setRequireStub(dataPath, {
    async fetchAllData() {
      return [];
    }
  }, originals);

  const service = require(servicePath);
  const rows = [{ id: 'CASE_1', classId: 'CLS_1' }, { id: 'CASE_2', classId: 'CLS_2' }];
  const filtered = await service.filterCasesByAccessScope({
    rows,
    req: { user: { id: 'USER_1' } },
    applyAccessScope: true
  });

  restoreRequireStubs(originals);
  delete require.cache[servicePath];

  assert.deepEqual(filtered, rows);
});

test('filterCasesByAccessScope limits assignment scope to accessible classes and teacher matches', async () => {
  const originals = new Map();
  const servicePath = require.resolve('../MVC/services/school/sessionStudentCaseWorkspaceService');
  const accessPath = require.resolve('../MVC/services/school/schoolRecordAccessService');
  const dataPath = require.resolve('../MVC/services/school/schoolDataService');
  [servicePath, accessPath, dataPath].forEach((modulePath) => delete require.cache[modulePath]);

  setRequireStub(accessPath, {
    resolveAccessFromRequest() {
      return { scopeMode: SCOPE_MODES.ASSIGNMENT, personId: 'TEA_1', delivererAliasIds: [] };
    },
    isOrgWideScope() {
      return false;
    },
    isRecordOwnedByUser() {
      return false;
    }
  }, originals);
  setRequireStub(dataPath, {
    async fetchAllData(entity) {
      if (entity === 'teachers') return [];
      if (entity === 'classes') return [{ id: 'CLS_1', title: 'Math' }];
      return [];
    }
  }, originals);

  const service = require(servicePath);
  const rows = [
    { id: 'CASE_1', classId: 'CLS_1' },
    { id: 'CASE_2', classId: 'CLS_2', teacherPersonId: 'TEA_1' },
    { id: 'CASE_3', classId: 'CLS_3' }
  ];
  const filtered = await service.filterCasesByAccessScope({
    rows,
    req: { user: { id: 'USER_1' } },
    applyAccessScope: true
  });

  restoreRequireStubs(originals);
  delete require.cache[servicePath];

  assert.deepEqual(filtered.map((row) => row.id), ['CASE_1', 'CASE_2']);
});

test('filterCasesByAccessScope keeps only owner-created cases for owner scope', async () => {
  const originals = new Map();
  const servicePath = require.resolve('../MVC/services/school/sessionStudentCaseWorkspaceService');
  const accessPath = require.resolve('../MVC/services/school/schoolRecordAccessService');
  const dataPath = require.resolve('../MVC/services/school/schoolDataService');
  [servicePath, accessPath, dataPath].forEach((modulePath) => delete require.cache[modulePath]);

  setRequireStub(accessPath, {
    resolveAccessFromRequest() {
      return { scopeMode: SCOPE_MODES.OWNER, userId: 'USER_1' };
    },
    isOrgWideScope() {
      return false;
    },
    isRecordOwnedByUser(record, userId) {
      return String(record?.id) === 'CASE_OWNED' && userId === 'USER_1';
    }
  }, originals);
  setRequireStub(dataPath, {
    async fetchAllData() {
      return [];
    }
  }, originals);

  const service = require(servicePath);
  const rows = [
    { id: 'CASE_OWNED', audit: { createUser: 'USER_1' } },
    { id: 'CASE_OTHER', audit: { createUser: 'USER_2' } }
  ];
  const filtered = await service.filterCasesByAccessScope({
    rows,
    req: { user: { id: 'USER_1' } },
    applyAccessScope: true
  });

  restoreRequireStubs(originals);
  delete require.cache[servicePath];

  assert.deepEqual(filtered.map((row) => row.id), ['CASE_OWNED']);
});

test('review service exposes review context and capability checks', () => {
  const reviewSource = read('packages/school/MVC/services/school/sessionStudentCaseReviewService.js');
  const accessSource = read('packages/school/MVC/services/school/sessionStudentCaseAccessService.js');
  assert.match(reviewSource, /async function getReviewContext/);
  assert.match(reviewSource, /async function assertCanMutate/);
  assert.match(reviewSource, /sessionStudentCaseAccessService\.resolveCaseCapabilities/);
  assert.match(reviewSource, /filterCasesByAccessScope/);
  assert.doesNotMatch(reviewSource, /SCHOOL_SESSIONS/);
  assert.match(accessSource, /resolveCaseCapabilities/);
  assert.match(accessSource, /assertCanResolve/);
  assert.match(accessSource, /OPERATIONS\.RESOLVE/);
  assert.match(accessSource, /readOnly/);
});

test('manage session uses shared student case modal assets and capability flags', () => {
  const sessionManagerSource = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.match(sessionManagerSource, /sessionStudentCaseModalClient\.js/);
  assert.match(sessionManagerSource, /sessionStudentCaseModal\.css/);
  assert.match(sessionManagerSource, /SessionStudentCaseModal\.init/);
  assert.match(sessionManagerSource, /studentCaseCapabilities/);
  assert.match(sessionManagerSource, /canCreateStudentCases/);
  assert.match(sessionManagerSource, /canResolveStudentCases/);
  assert.match(sessionManagerSource, /canReadAll/);
  assert.match(sessionManagerSource, /school\/sessionStudentCase\/partials\/sessionStudentCaseModal/);
});

test('resolveCaseCapabilities maps section operations without SCHOOL_SESSIONS fallback', async () => {
  const originals = new Map();
  const accessServicePath = require.resolve('../../../MVC/services/security/index');
  const recordAccessPath = require.resolve('../MVC/services/school/schoolRecordAccessService');
  const servicePath = require.resolve('../MVC/services/school/sessionStudentCaseAccessService');
  [accessServicePath, recordAccessPath, servicePath].forEach((modulePath) => delete require.cache[modulePath]);

  const allowedOps = new Set(['READ', 'READ_ALL']);
  setRequireStub(accessServicePath, {
    async evaluateAccess({ operationId }) {
      return { allowed: allowedOps.has(operationId), scopeId: 'SCP_DEPT' };
    }
  }, originals);
  setRequireStub(recordAccessPath, {
    resolveAccessFromRequest() {
      return { scopeMode: 'assignment' };
    },
    isSessionAccessible() {
      return true;
    }
  }, originals);

  const service = require(servicePath);
  const req = { user: { id: 'USR_1' }, ip: '127.0.0.1' };
  const capabilities = await service.resolveCaseCapabilities(req, {
    classData: { id: 'CLS_1' },
    session: { sessionId: 'SES_1' }
  });

  restoreRequireStubs(originals);
  delete require.cache[servicePath];

  assert.equal(capabilities.canRead, true);
  assert.equal(capabilities.canReadAll, true);
  assert.equal(capabilities.canUpdate, false);
  assert.equal(capabilities.canResolve, false);
  assert.equal(capabilities.canDelete, false);
  assert.equal(capabilities.readOnly, true);
});

test('resolveCaseCapabilities requires session mutation access for write operations', async () => {
  const originals = new Map();
  const accessServicePath = require.resolve('../../../MVC/services/security/index');
  const recordAccessPath = require.resolve('../MVC/services/school/schoolRecordAccessService');
  const servicePath = require.resolve('../MVC/services/school/sessionStudentCaseAccessService');
  [accessServicePath, recordAccessPath, servicePath].forEach((modulePath) => delete require.cache[modulePath]);

  setRequireStub(accessServicePath, {
    async evaluateAccess({ operationId }) {
      return { allowed: ['CREATE', 'UPDATE', 'RESOLVE', 'DELETE'].includes(operationId), scopeId: 'SCP_DEPT' };
    }
  }, originals);
  setRequireStub(recordAccessPath, {
    resolveAccessFromRequest() {
      return { scopeMode: 'assignment' };
    },
    isSessionAccessible() {
      return false;
    }
  }, originals);

  const service = require(servicePath);
  const capabilities = await service.resolveCaseCapabilities(
    { user: { id: 'USR_1' }, ip: '127.0.0.1' },
    { classData: { id: 'CLS_1' }, session: { sessionId: 'SES_1' } }
  );

  restoreRequireStubs(originals);
  delete require.cache[servicePath];

  assert.equal(capabilities.canCreate, false);
  assert.equal(capabilities.canUpdate, false);
  assert.equal(capabilities.canResolve, false);
  assert.equal(capabilities.canDelete, false);
});

test('resolveCaseCapabilities allows resolve without update when only RESOLVE is granted', async () => {
  const originals = new Map();
  const accessServicePath = require.resolve('../../../MVC/services/security/index');
  const recordAccessPath = require.resolve('../MVC/services/school/schoolRecordAccessService');
  const servicePath = require.resolve('../MVC/services/school/sessionStudentCaseAccessService');
  [accessServicePath, recordAccessPath, servicePath].forEach((modulePath) => delete require.cache[modulePath]);

  setRequireStub(accessServicePath, {
    async evaluateAccess({ operationId }) {
      return { allowed: ['READ', 'RESOLVE'].includes(operationId), scopeId: 'SCP_DEPT' };
    }
  }, originals);
  setRequireStub(recordAccessPath, {
    resolveAccessFromRequest() {
      return { scopeMode: 'assignment' };
    },
    isSessionAccessible() {
      return true;
    }
  }, originals);

  const service = require(servicePath);
  const capabilities = await service.resolveCaseCapabilities(
    { user: { id: 'USR_1' }, ip: '127.0.0.1' },
    { classData: { id: 'CLS_1' }, session: { sessionId: 'SES_1' } }
  );

  restoreRequireStubs(originals);
  delete require.cache[servicePath];

  assert.equal(capabilities.canRead, true);
  assert.equal(capabilities.canResolve, true);
  assert.equal(capabilities.canUpdate, false);
  assert.equal(capabilities.readOnly, true);
});
