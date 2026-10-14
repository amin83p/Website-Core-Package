const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const scheduleController = require('../MVC/controllers/school/scheduleController');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('person schedule scan falls back to org scope for teacher-index and merge-linked classes', () => {
  const controller = read('MVC/controllers/school/scheduleController.js');
  assert.match(controller, /getClassRowForScheduleScan/);
  assert.match(controller, /getClassSessionsForScheduleScan/);
  assert.match(controller, /SCHEDULE_ORG_SCAN_ACCESS_CONTEXT/);
  assert.match(controller, /collectClassIdsFromTeacherIndexForRange/);
  assert.match(controller, /sessionDeliveryOnlyClassIds/);
  assert.match(controller, /collectClassIdsWithSessionDeliveryInRange/);
  assert.match(controller, /shouldUseOrgScopeDeliveryClassDiscovery/);
  assert.match(controller, /mergeLinkedClassIds/);
  assert.match(controller, /allowOrgScopeFallback: orgScopeFallbackClassIds\.has\(classId\)/);
});

test('collectClassIdsWithSessionDeliveryInRange finds take-over classes outside assignment class list', () => {
  const classRows = [
    {
      id: 'CLS_OWN',
      orgId: 'ORG1',
      instructors: [{ personId: 'P1' }],
      sessions: [{ date: '2026-10-14', delivery: { deliveredBy: 'P1' } }]
    },
    {
      id: 'CLS_TAKEOVER',
      orgId: 'ORG1',
      instructors: [{ personId: 'P_OTHER' }],
      sessions: [{ date: '2026-10-14', delivery: { deliveredBy: 'P1' } }]
    },
    {
      id: 'CLS_OTHER_ORG',
      orgId: 'ORG2',
      sessions: [{ date: '2026-10-14', delivery: { deliveredBy: 'P1' } }]
    }
  ];
  const found = scheduleController.collectClassIdsWithSessionDeliveryInRange(
    classRows,
    'P1',
    new Map(),
    '2026-10-12',
    '2026-10-18',
    { activeOrgId: 'ORG1' }
  );
  assert.ok(found.has('CLS_TAKEOVER'));
  assert.equal(found.has('CLS_OTHER_ORG'), false);
});

test('session save uses delivery-team org scope loader instead of assignment-only class lookup', () => {
  const classController = read('MVC/controllers/school/classController.js');
  assert.match(classController, /loadSessionManageScope/);
  assert.match(classController, /SESSION_MANAGE_ORG_ACCESS_CONTEXT/);
  assert.match(classController, /async function saveSession\([\s\S]*loadSessionManageScope/);
  assert.match(classController, /saveClassSessions\(classId, sessions, req\.user, persistAccessContext\)/);
});

test('shouldUseOrgScopeDeliveryClassDiscovery is true for division-scoped schedule reads', () => {
  assert.equal(
    scheduleController.shouldUseOrgScopeDeliveryClassDiscovery({ scopeId: 'SCP_DIV' }, {}),
    true
  );
  assert.equal(
    scheduleController.shouldUseOrgScopeDeliveryClassDiscovery({ scopeId: 'SCP_ORG' }, {}),
    false
  );
});

test('collectClassIdsFromTeacherIndexForRange only includes classes with sessions in the visible window', () => {
  const teacherIndex = {
    P1: {
      '2026-10-14': [{ classId: 'CLS_IN', sessionId: 'SES_1' }],
      '2026-11-01': [{ classId: 'CLS_OUT', sessionId: 'SES_2' }]
    }
  };
  const inRange = scheduleController.collectClassIdsFromTeacherIndexForRange(
    teacherIndex,
    'P1',
    new Map(),
    '2026-10-12',
    '2026-10-18'
  );
  assert.ok(inRange.has('CLS_IN'));
  assert.equal(inRange.has('CLS_OUT'), false);
});

test('collectClassIdsFromTeacherIndexForRange resolves teacher record aliases from the person map', () => {
  const teacherIndex = {
    TEA_99: {
      '2026-10-14': [{ classId: 'CLS_ALIAS', sessionId: 'SES_3' }]
    }
  };
  const teacherPersonMap = new Map([['TEA_99', 'PERSON_99']]);
  const classIds = scheduleController.collectClassIdsFromTeacherIndexForRange(
    teacherIndex,
    'PERSON_99',
    teacherPersonMap,
    '2026-10-14',
    '2026-10-14'
  );
  assert.ok(classIds.has('CLS_ALIAS'));
});
