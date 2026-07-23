/**
 * Multi-duration attendance matrix policy: migration, exact match, default fallback.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const {
  DEFAULT_POLICY,
  normalizeOrgPolicyStorage,
  resolvePolicyFieldsForScheduledMinutes,
  normalizePolicyItemsForSave
} = require('../packages/school/MVC/models/school/attendanceMatrixPolicyModel');

const {
  computeStudentMatrixSummary,
  pickOrgPolicyLayerForMinutes,
  resolvePolicyForScheduledMinutes
} = require('../packages/school/MVC/services/school/attendanceMatrixMetricsService');

test('legacy flat org policy migrates to one default item', () => {
  const storage = normalizeOrgPolicyStorage({
    scheduledMinutes: 120,
    disqualifyLateMinutes: 20,
    disqualifyEarlyLeaveMinutes: 25,
    disqualifyCombinedMissedMinutes: null
  });
  assert.equal(storage.items.length, 1);
  assert.equal(storage.items[0].scheduledMinutes, 120);
  assert.equal(storage.items[0].disqualifyLateMinutes, 20);
  assert.equal(storage.items[0].isDefault, true);
});

test('exact match picks duration item; otherwise default item; otherwise built-in', () => {
  const storage = {
    items: [
      {
        id: 'a',
        scheduledMinutes: 60,
        disqualifyLateMinutes: 10,
        disqualifyEarlyLeaveMinutes: 10,
        disqualifyCombinedMissedMinutes: null,
        isDefault: false
      },
      {
        id: 'b',
        scheduledMinutes: 180,
        disqualifyLateMinutes: 30,
        disqualifyEarlyLeaveMinutes: 30,
        disqualifyCombinedMissedMinutes: null,
        isDefault: true
      }
    ]
  };
  const exact = resolvePolicyFieldsForScheduledMinutes(storage, 60);
  assert.equal(exact.disqualifyLateMinutes, 10);
  assert.equal(exact.scheduledMinutes, 60);

  const fallback = resolvePolicyFieldsForScheduledMinutes(storage, 90);
  assert.equal(fallback.disqualifyLateMinutes, 30);
  assert.equal(fallback.scheduledMinutes, 180);

  const builtin = resolvePolicyFieldsForScheduledMinutes({ items: [] }, 90);
  assert.deepEqual(builtin, { ...DEFAULT_POLICY });
});

test('normalizePolicyItemsForSave enforces unique durations and one default', () => {
  const items = normalizePolicyItemsForSave([
    { scheduledMinutes: 60, disqualifyLateMinutes: 10, disqualifyEarlyLeaveMinutes: 10, isDefault: true },
    { scheduledMinutes: 120, disqualifyLateMinutes: 15, disqualifyEarlyLeaveMinutes: 15, isDefault: true }
  ]);
  assert.equal(items.filter((item) => item.isDefault).length, 1);
  assert.equal(items.length, 2);
  assert.throws(
    () => normalizePolicyItemsForSave([
      { scheduledMinutes: 60, disqualifyLateMinutes: 10, disqualifyEarlyLeaveMinutes: 10, isDefault: true },
      { scheduledMinutes: 60, disqualifyLateMinutes: 12, disqualifyEarlyLeaveMinutes: 12, isDefault: false }
    ]),
    /unique/i
  );
});

test('matrix summary uses per-session duration policy cutoffs', () => {
  const catalog = {
    items: [
      {
        scheduledMinutes: 60,
        disqualifyLateMinutes: 10,
        disqualifyEarlyLeaveMinutes: 10,
        disqualifyCombinedMissedMinutes: null,
        isDefault: false
      },
      {
        scheduledMinutes: 180,
        disqualifyLateMinutes: 30,
        disqualifyEarlyLeaveMinutes: 30,
        disqualifyCombinedMissedMinutes: null,
        isDefault: true
      }
    ]
  };
  // 15 late on 60-min session → disqualified by 10 cutoff
  // 15 late on 180-min session → still proportional (under 30)
  const summary = computeStudentMatrixSummary([
    { status: 'late', lateMinutes: 15, earlyLeaveMinutes: 0, scheduledMinutes: 60 },
    { status: 'late', lateMinutes: 15, earlyLeaveMinutes: 0, scheduledMinutes: 180 }
  ], {}, catalog);
  assert.equal(summary.totalEligibleSessions, 2);
  assert.equal(summary.disqualifiedSessionCount, 1);
  // weight 50 each: first 0, second 50 * (165/180) = 45.833...
  assert.ok(summary.performancePercent > 45 && summary.performancePercent < 46);
});

test('pickOrgPolicyLayerForMinutes and resolvePolicyForScheduledMinutes helpers', () => {
  const catalog = {
    items: [
      { scheduledMinutes: 90, disqualifyLateMinutes: 12, disqualifyEarlyLeaveMinutes: 12, isDefault: true }
    ]
  };
  const layer = pickOrgPolicyLayerForMinutes(catalog, 90);
  assert.equal(layer.disqualifyLateMinutes, 12);
  const policy = resolvePolicyForScheduledMinutes({}, catalog, 90);
  assert.equal(policy.disqualifyLateMinutes, 12);
});

test('attendance routes gate matrix page with requireAccess; settings with policy admin', () => {
  const routes = read('packages/school/MVC/routes/attendanceRoutes.js');
  assert.match(routes, /\/settings'[\s\S]*?requireAttendanceMatrixPolicyAdmin\(\)/);
  assert.match(routes, /router\.get\('\/'[\s\S]*?requireAccess\(SECTIONS\.SCHOOL_ATTENDANCES,\s*OPERATIONS\.UPDATE\)/);
  assert.match(routes, /\/api\/data'[\s\S]*?requireAccess\(SECTIONS\.SCHOOL_ATTENDANCES,\s*OPERATIONS\.UPDATE\)/);
});

test('matrix policy admin gate is section-admin only via schoolAdminAccessService', () => {
  const middleware = read('packages/school/MVC/middleware/attendanceMatrixPolicyAdminMiddleware.js');
  assert.match(middleware, /schoolAdminAccessService/);
  assert.match(middleware, /isAttendancesAdminViewerAsync/);
  assert.doesNotMatch(middleware, /VIEW_DASHBOARD/);
  const manageFn = middleware.slice(
    middleware.indexOf('async function userCanManageAttendanceMatrixPolicy'),
    middleware.indexOf('async function userCanOpenAttendanceMatrix')
  );
  assert.doesNotMatch(manageFn, /evaluateAccess/);
});
