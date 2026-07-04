const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SERVICE_PATH = path.join(ROOT_DIR, 'packages/school/MVC/services/school/sessionExplorerService.js');
const CONTROLLER_PATH = path.join(ROOT_DIR, 'packages/school/MVC/controllers/school/sessionController.js');
const VIEW_PATH = path.join(ROOT_DIR, 'packages/school/MVC/views/school/session/sessionList.ejs');
const DATA_SERVICE_PATH = path.join(ROOT_DIR, 'packages/school/MVC/services/school/schoolDataService.js');

const serviceSource = fs.readFileSync(SERVICE_PATH, 'utf8');
const controllerSource = fs.readFileSync(CONTROLLER_PATH, 'utf8');
const viewSource = fs.readFileSync(VIEW_PATH, 'utf8');
const dataServiceSource = fs.readFileSync(DATA_SERVICE_PATH, 'utf8');

const sessionExplorerService = require('../packages/school/MVC/services/school/sessionExplorerService');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const sessionStatusPolicyService = require('../packages/school/MVC/services/school/sessionStatusPolicyService');
const sessionStudentCaseService = require('../packages/school/MVC/services/school/sessionStudentCaseService');
const schoolPersonAccessService = require('../packages/school/MVC/services/school/schoolPersonAccessService');

function withPatched(target, replacements, callback) {
  const originals = {};
  Object.entries(replacements).forEach(([key, value]) => {
    originals[key] = target[key];
    target[key] = value;
  });
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      Object.entries(originals).forEach(([key, value]) => {
        target[key] = value;
      });
    });
}

function buildReq(overrides = {}) {
  return {
    user: {
      id: 'USER_1',
      personId: 'PERSON_1',
      activeOrgId: 'ORG_1',
      ...overrides.user
    },
    accessScope: overrides.accessScope || 'SCP_DIV',
    ...overrides
  };
}

function buildClassRow({ id, title, sessions, instructors = [] }) {
  return {
    id,
    title,
    orgId: 'ORG_1',
    instructors,
    sessions
  };
}

function buildSession({ sessionId, date, deliveredBy }) {
  return {
    sessionId,
    id: sessionId,
    date,
    startTime: '09:00',
    endTime: '10:00',
    status: 'scheduled',
    delivery: { deliveredBy }
  };
}

function idsEqual(a, b) {
  return String(a || '').trim() === String(b || '').trim();
}

test('session controller passes sessionExplorerAccess to render', () => {
  assert.match(controllerSource, /buildSessionExplorerViewer\(req\)/);
  assert.match(controllerSource, /sessionExplorerAccess/);
});

test('session controller enables table list chrome for search and table tools', () => {
  assert.match(controllerSource, /includeModal_Table:\s*true/);
  assert.match(controllerSource, /searchableFields:/);
});

test('session list view includes table search bar above results table', () => {
  assert.match(viewSource, /tablePages-search/);
  assert.match(viewSource, /searchableFields/);
  assert.match(viewSource, /id="first-table"/);
});

test('session list view conditionally hides teacher picker for non-admin viewers', () => {
  assert.match(viewSource, /explorerAccess\.canFilterByTeacher/);
  assert.match(viewSource, /Your Teacher Profile/);
  assert.match(viewSource, /canFilterByTeacher/);
});

test('session explorer service scopes class fetch with route access context', () => {
  assert.match(
    serviceSource,
    /schoolDataService\.fetchData\('classes', \{\}, req\.user, accessContext\)/
  );
  assert.match(serviceSource, /getClassSessions\(classRow\.id, req\.user, accessContext\)/);
  assert.match(serviceSource, /isSessionAccessible\(\{ classRow, session, access, context: 'list' \}\)/);
});

test('getClassSessions forwards optional accessContext', () => {
  assert.match(
    dataServiceSource,
    /getClassSessions: async \(classId, requestingUser = null, accessContext = null\)/
  );
  assert.match(
    dataServiceSource,
    /getDataById\('classes', classId, requestingUser, accessContext\)/
  );
});

test('applyViewerTeacherFilters forces locked teacher for non-admin teacher viewers', () => {
  const filters = sessionExplorerService.applyViewerTeacherFilters(
    { teacherIds: ['OTHER'], teacherId: 'OTHER' },
    { isAdminViewer: false, lockedTeacherPersonId: 'PERSON_1' }
  );
  assert.deepEqual(filters.teacherIds, ['PERSON_1']);
  assert.equal(filters.teacherId, 'PERSON_1');
});

test('applyViewerTeacherFilters clears teacher filter for non-admin non-teacher viewers', () => {
  const filters = sessionExplorerService.applyViewerTeacherFilters(
    { teacherIds: ['OTHER'], teacherId: 'OTHER' },
    { isAdminViewer: false, lockedTeacherPersonId: '' }
  );
  assert.deepEqual(filters.teacherIds, []);
  assert.equal(filters.teacherId, '');
});

test('applyViewerTeacherFilters leaves admin filters unchanged', () => {
  const input = { teacherIds: ['T1'], teacherId: 'T1' };
  const filters = sessionExplorerService.applyViewerTeacherFilters(
    input,
    { isAdminViewer: true, lockedTeacherPersonId: '' }
  );
  assert.deepEqual(filters, input);
});

function swapAdminChecker(isAdmin) {
  const adminPath = require.resolve('../MVC/services/adminChekersService');
  const originalAdmin = require(adminPath);
  const originalCache = require.cache[adminPath];
  require.cache[adminPath] = {
    id: adminPath,
    filename: adminPath,
    loaded: true,
    exports: {
      ...originalAdmin,
      isAdminForRequest: () => isAdmin
    }
  };
  delete require.cache[SERVICE_PATH];
  const freshService = require(SERVICE_PATH);
  return () => {
    require.cache[adminPath] = originalCache;
    delete require.cache[SERVICE_PATH];
    return freshService;
  };
}

test('listSessions passes accessContext to class fetch', async () => {
  const captured = { accessContext: null };
  const restore = swapAdminChecker(true);
  const freshService = require(SERVICE_PATH);

  try {
    await withPatched(schoolDataService, {
      buildRouteAccessContext: (req) => {
        captured.accessContext = { scopeId: req.accessScope };
        return captured.accessContext;
      },
      fetchData: async (entityType, query, user, accessContext) => {
        captured.fetchAccessContext = accessContext;
        return [];
      },
      getClassSessions: async () => []
    }, async () => {
      await withPatched(sessionStatusPolicyService, {
        getClientStatusMeta: async () => []
      }, async () => {
        await withPatched(sessionStudentCaseService, {
          listSessionCaseSummaries: async () => new Map()
        }, async () => {
          await withPatched(schoolPersonAccessService, {
            buildPersonByIdMap: async () => new Map()
          }, async () => {
            await freshService.listSessions(buildReq(), {});
            assert.deepEqual(captured.fetchAccessContext, { scopeId: 'SCP_DIV' });
          });
        });
      });
    });
  } finally {
    restore();
  }
});

test('listSessions ignores foreign teacher filter for locked non-admin teacher viewers', async () => {
  const classRow = buildClassRow({
    id: 'CLS_1',
    title: 'Math',
    instructors: [{ personId: 'PERSON_1', status: 'active' }],
    sessions: [
      buildSession({ sessionId: 'SES_1', date: '2026-07-01', deliveredBy: 'PERSON_1' }),
      buildSession({ sessionId: 'SES_2', date: '2026-07-01', deliveredBy: 'PERSON_2' })
    ]
  });
  const restore = swapAdminChecker(false);
  const freshService = require(SERVICE_PATH);

  try {
    await withPatched(schoolDataService, {
      buildRouteAccessContext: () => ({ scopeId: 'SCP_DIV' }),
      fetchData: async (entityType) => {
        if (entityType === 'teachers') {
          return [{ id: 'T1', orgId: 'ORG_1', personId: 'PERSON_1', status: 'active' }];
        }
        if (entityType === 'classes') return [classRow];
        return [];
      },
      getClassSessions: async () => classRow.sessions
    }, async () => {
      await withPatched(sessionStatusPolicyService, {
        getClientStatusMeta: async () => []
      }, async () => {
        await withPatched(sessionStudentCaseService, {
          listSessionCaseSummaries: async () => new Map()
        }, async () => {
          await withPatched(schoolPersonAccessService, {
            buildPersonByIdMap: async () => new Map()
          }, async () => {
            const result = await freshService.listSessions(
              buildReq(),
              { teacherId: 'PERSON_2' }
            );
            assert.equal(result.data.length, 1);
            assert.equal(result.data[0].sessionId, 'SES_1');
            assert.equal(result.data[0].teacherId, 'PERSON_1');
          });
        });
      });
    });
  } finally {
    restore();
  }
});

test('listSessions only iterates classes returned by scoped fetch', async () => {
  const scopedClass = buildClassRow({
    id: 'CLS_SCOPED',
    title: 'Scoped Class',
    instructors: [{ personId: 'PERSON_1', status: 'active' }],
    sessions: [buildSession({ sessionId: 'SES_SCOPED', date: '2026-07-02', deliveredBy: 'PERSON_1' })]
  });
  const restore = swapAdminChecker(false);
  const freshService = require(SERVICE_PATH);

  try {
    await withPatched(schoolDataService, {
      buildRouteAccessContext: () => ({ scopeId: 'SCP_DIV' }),
      fetchData: async (entityType) => {
        if (entityType === 'teachers') {
          return [{ id: 'T1', orgId: 'ORG_1', personId: 'PERSON_1', status: 'active' }];
        }
        if (entityType === 'classes') return [scopedClass];
        return [];
      },
      getClassSessions: async (classId) => (
        idsEqual(classId, 'CLS_SCOPED') ? scopedClass.sessions : []
      )
    }, async () => {
      await withPatched(sessionStatusPolicyService, {
        getClientStatusMeta: async () => []
      }, async () => {
        await withPatched(sessionStudentCaseService, {
          listSessionCaseSummaries: async () => new Map()
        }, async () => {
          await withPatched(schoolPersonAccessService, {
            buildPersonByIdMap: async () => new Map()
          }, async () => {
            const result = await freshService.listSessions(buildReq(), {});
            assert.equal(result.data.length, 1);
            assert.equal(result.data[0].classId, 'CLS_SCOPED');
          });
        });
      });
    });
  } finally {
    restore();
  }
});

test('buildSessionExplorerViewer returns admin capabilities for section admins', async () => {
  const restore = swapAdminChecker(true);
  const freshService = require(SERVICE_PATH);

  try {
    const viewer = await freshService.buildSessionExplorerViewer(buildReq());
    assert.equal(viewer.isAdminViewer, true);
    assert.equal(viewer.canFilterByTeacher, true);
    assert.equal(viewer.lockedTeacherPersonId, '');
  } finally {
    restore();
  }
});

test('buildSessionExplorerViewer locks teacher person for linked non-admin teachers', async () => {
  const restore = swapAdminChecker(false);
  const freshService = require(SERVICE_PATH);

  await withPatched(schoolDataService, {
    fetchData: async (entityType) => {
      if (entityType === 'teachers') {
        return [{ id: 'T1', orgId: 'ORG_1', personId: 'PERSON_1', status: 'active' }];
      }
      return [];
    }
  }, async () => {
    await withPatched(schoolPersonAccessService, {
      buildPersonByIdMap: async () => new Map([
        ['PERSON_1', { firstName: 'Ada', lastName: 'Teacher' }]
      ]),
      formatPersonName: (person) => `${person.firstName} ${person.lastName}`.trim()
    }, async () => {
      try {
        const viewer = await freshService.buildSessionExplorerViewer(buildReq());
        assert.equal(viewer.isAdminViewer, false);
        assert.equal(viewer.canFilterByTeacher, false);
        assert.equal(viewer.lockedTeacherPersonId, 'PERSON_1');
        assert.equal(viewer.lockedTeacherName, 'Ada Teacher');
      } finally {
        restore();
      }
    });
  });
});

test('buildSessionExplorerViewer does not lock teacher for non-admin staff without teacher row', async () => {
  const restore = swapAdminChecker(false);
  const freshService = require(SERVICE_PATH);

  await withPatched(schoolDataService, {
    fetchData: async () => []
  }, async () => {
    try {
      const viewer = await freshService.buildSessionExplorerViewer(buildReq());
      assert.equal(viewer.canFilterByTeacher, false);
      assert.equal(viewer.lockedTeacherPersonId, '');
      assert.equal(viewer.lockedTeacherName, '');
    } finally {
      restore();
    }
  });
});
