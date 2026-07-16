const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.MAIN_SECRET_KEY ||= '0123456789abcdef0123456789abcdef';
process.env.SESSION_SECRET ||= 'fedcba9876543210fedcba9876543210';
process.env.ACTION_STATE_KEY ||= 'ffeeddccbbaa99887766554433221100';

const dashboardController = require('../MVC/controllers/dashboardController');
const accessService = require('../MVC/services/security/accessControl');
const resolveRedirect = dashboardController.resolveSingleMainDashboardRedirect;

test('does not redirect when there are zero or multiple main-dashboard sections', () => {
  assert.equal(resolveRedirect([]), null);
  assert.equal(resolveRedirect([{ id: 'one' }, { id: 'two' }]), null);
});

test('redirects one section to its configured home URL', () => {
  assert.equal(resolveRedirect([{ id: 'school', homeURL: '/school' }]), '/school');
});

test('redirects one navigator section to its subsection dashboard', () => {
  assert.equal(
    resolveRedirect([{ id: 'root', name: 'ACADEMIA', subsections: [{ id: 'child' }] }]),
    '/dashboard/section-nav/ACADEMIA'
  );
});

test('uses the existing /sections fallback when the sole section has no target', () => {
  assert.equal(resolveRedirect([{ id: 'section-without-target' }]), '/sections');
});

test('inaccessible, inactive, and non-dashboard sections are excluded before counting', async () => {
  const originalEvaluateAccess = accessService.evaluateAccess;
  accessService.evaluateAccess = async ({ sectionId }) => ({ allowed: sectionId === 'allowed' });
  try {
    const rows = await dashboardController.filterMainDashboardSections({ id: 'user-1' }, [
      { id: 'allowed', active: true, mainDashboardDisplay: true, operations: [{ id: 'view' }] },
      { id: 'denied', active: true, mainDashboardDisplay: true, operations: [{ id: 'view' }] },
      { id: 'inactive', active: false, mainDashboardDisplay: true, operations: [{ id: 'view' }] },
      { id: 'not-on-main-dashboard', active: true, mainDashboardDisplay: false, operations: [{ id: 'view' }] }
    ]);
    assert.deepEqual(rows.map((row) => row.id), ['allowed']);
    assert.equal(resolveRedirect(rows), '/sections');
  } finally {
    accessService.evaluateAccess = originalEvaluateAccess;
  }
});

test('prevents a configured /dashboard target from redirecting forever', () => {
  assert.equal(resolveRedirect([{ id: 'loop', homeURL: '/dashboard/' }]), null);
  assert.equal(resolveRedirect([{ id: 'loop', homeURL: '/dashboard?from=section' }]), null);
});

test('dashboard route filters accessible main sections before resolving the fast path', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../MVC/controllers/dashboardController.js'), 'utf8');
  assert.match(source, /filterMainDashboardSections\(req\.user, allSections\)/);
  assert.match(source, /resolveSingleMainDashboardRedirect\(accessibleSections\)/);
});

test('header Dashboard navigation and existing shortcut still target /dashboard', () => {
  const header = fs.readFileSync(path.resolve(__dirname, '../MVC/views/partials/header.ejs'), 'utf8');
  const mainScript = fs.readFileSync(path.resolve(__dirname, '../public/scripts/main.js'), 'utf8');
  assert.match(header, /id=\x22headerDashboardTrigger\x22[^>]+href=\x22\/dashboard\x22/);
  assert.match(header, /title=\x22Dashboard \(Alt\+Shift\+D\)\x22/);
  assert.match(mainScript, /if \(key === 'd'\)/);
  assert.match(mainScript, /getElementById\('headerDashboardTrigger'\)/);
});
