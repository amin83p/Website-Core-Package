'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCHOOL_ROOT = path.join(ROOT, 'packages', 'school');
const FACADE_PATH = path.join(
  SCHOOL_ROOT,
  'MVC',
  'services',
  'school',
  'schoolAdminAccessService.js'
);

/** Domain-role files allowed to mention requester/initiator "admin" tokens (not authority checks). */
const DOMAIN_ROLE_ALLOWLIST = new Set([
  path.join('MVC', 'services', 'school', 'leaveRequestService.js'),
  path.join('MVC', 'services', 'school', 'leaveSessionResolutionService.js'),
  path.join('MVC', 'models', 'school', 'leaveRequestModel.js'),
  path.join('MVC', 'models', 'school', 'withdrawalModel.js'),
  path.join('MVC', 'services', 'school', 'withdrawal', 'withdrawalWorkflowService.js')
].map((rel) => path.normalize(rel)));

function walkJsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'test' || ent.name === 'scripts') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJsFiles(full, out);
    else if (ent.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('schoolAdminAccessService delegates to adminAuthorityService', () => {
  const source = fs.readFileSync(FACADE_PATH, 'utf8');
  assert.match(source, /requireCoreModule\('MVC\/services\/adminAuthorityService'\)/);
  assert.match(source, /isSuperAdmin\(/);
  assert.match(source, /isAdminForSection\(/);
  assert.match(source, /isAdminForRequest\(/);
  assert.match(source, /isAdminForRequestAsync\(/);
  assert.match(source, /isTasksAdminViewer/);
  assert.match(source, /isActivitiesAdminViewer/);
  assert.match(source, /isReportsInstancesAdminViewer/);
  assert.match(source, /isAttendancesAdminViewer/);
  assert.doesNotMatch(source, /accessLevel\s*>=/);
  assert.doesNotMatch(source, /roles\.includes\(/);
});

test('attendance matrix thresholds are admin-only via schoolAdminAccessService', () => {
  const middleware = fs.readFileSync(
    path.join(SCHOOL_ROOT, 'MVC', 'middleware', 'attendanceMatrixPolicyAdminMiddleware.js'),
    'utf8'
  );
  assert.match(middleware, /schoolAdminAccessService/);
  assert.match(middleware, /isAttendancesAdminViewerAsync/);
  assert.doesNotMatch(middleware, /VIEW_DASHBOARD/);
  assert.match(middleware, /async function userCanOpenAttendanceMatrix/);

  // Manage-policy must not fall back to evaluateAccess; open-matrix may.
  const manageFn = middleware.slice(
    middleware.indexOf('async function userCanManageAttendanceMatrixPolicy'),
    middleware.indexOf('async function userCanOpenAttendanceMatrix')
  );
  assert.doesNotMatch(manageFn, /evaluateAccess/);
  assert.match(
    middleware.slice(middleware.indexOf('async function userCanOpenAttendanceMatrix')),
    /evaluateAccess/
  );

  const routes = fs.readFileSync(
    path.join(SCHOOL_ROOT, 'MVC', 'routes', 'attendanceRoutes.js'),
    'utf8'
  );
  assert.match(routes, /\/settings'[\s\S]*?requireAttendanceMatrixPolicyAdmin\(\)/);
  assert.match(routes, /router\.get\('\/'[\s\S]*?requireAccess\(SECTIONS\.SCHOOL_ATTENDANCES,\s*OPERATIONS\.UPDATE\)/);
  assert.match(routes, /\/api\/data'[\s\S]*?requireAccess\(SECTIONS\.SCHOOL_ATTENDANCES,\s*OPERATIONS\.UPDATE\)/);
  assert.match(routes, /\/api\/export\.xlsx'[\s\S]*?requireAccess\(SECTIONS\.SCHOOL_ATTENDANCES,\s*OPERATIONS\.UPDATE\)/);
  assert.match(routes, /\/api\/active-classes'[\s\S]*?requireAccess\(SECTIONS\.SCHOOL_ATTENDANCES,\s*OPERATIONS\.UPDATE\)/);

  const viewer = fs.readFileSync(
    path.join(SCHOOL_ROOT, 'MVC', 'views', 'school', 'attendance', 'attendanceViewer.ejs'),
    'utf8'
  );
  assert.match(viewer, /canManageAttendanceMatrixPolicy/);
  assert.match(viewer, /Matrix Thresholds/);
});

test('school production JS does not import adminChekersService', () => {
  const files = walkJsFiles(path.join(SCHOOL_ROOT, 'MVC'));
  const offenders = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    if (source.includes("adminChekersService") || source.includes("MVC/services/adminChekersService")) {
      offenders.push(path.relative(SCHOOL_ROOT, file));
    }
  }
  assert.deepEqual(offenders, [], `Unexpected adminChekersService imports:\n${offenders.join('\n')}`);
});

test('school production JS avoids local accessLevel admin privilege math', () => {
  const files = walkJsFiles(path.join(SCHOOL_ROOT, 'MVC'));
  const offenders = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    if (/accessLevel\s*>=\s*\d+/.test(source)) {
      offenders.push(path.relative(SCHOOL_ROOT, file));
    }
  }
  assert.deepEqual(offenders, [], `Unexpected accessLevel privilege checks:\n${offenders.join('\n')}`);
});

test('activity work sessions use schoolAdminAccessService for manage-all', () => {
  const source = fs.readFileSync(
    path.join(SCHOOL_ROOT, 'MVC', 'services', 'school', 'activityWorkSessionService.js'),
    'utf8'
  );
  assert.match(source, /schoolAdminAccessService/);
  assert.match(source, /canManageAllActivityWorkSessions/);
  assert.match(source, /isActivitiesAdminViewer/);
  assert.doesNotMatch(source, /function isOrgWideAccess/);
});

test('domain-role allowlist is the only place treating school_admin token as requester admin', () => {
  const files = walkJsFiles(path.join(SCHOOL_ROOT, 'MVC'));
  const offenders = [];
  for (const file of files) {
    const rel = path.normalize(path.relative(SCHOOL_ROOT, file));
    if (DOMAIN_ROLE_ALLOWLIST.has(rel)) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (/school_admin/.test(source) && /roles\.add\(['"]admin['"]\)/.test(source)) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], `Unexpected school_admin→requesterRole mapping:\n${offenders.join('\n')}`);
});
