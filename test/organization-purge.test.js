const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const organizationPurgeService = require('../MVC/services/organizationPurgeService');

test('organizationPurgeService exports plan and execute entry points', () => {
  assert.equal(typeof organizationPurgeService.buildOrganizationPurgePlan, 'function');
  assert.equal(typeof organizationPurgeService.executeOrganizationPurge, 'function');
  assert.equal(typeof organizationPurgeService.resolveOrgDisplayName, 'function');
  assert.equal(organizationPurgeService.ALL_MASTER_DEFINITIONS.classes, true);
});

test('resolveOrgDisplayName prefers identity.displayName', () => {
  assert.equal(
    organizationPurgeService.resolveOrgDisplayName({
      id: 'ORG1',
      identity: { displayName: 'Acme School', legalName: 'Acme LLC' },
      name: 'Legacy'
    }),
    'Acme School'
  );
});

test('executeOrganizationPurge rejects confirm-name mismatch', async () => {
  const organizationRepository = require('../MVC/repositories/organizationRepository');
  const originalGetById = organizationRepository.getById;
  organizationRepository.getById = async () => ({
    id: 'ORG-TEST-1',
    identity: { displayName: 'Exact Name Org' }
  });
  try {
    await assert.rejects(
      () => organizationPurgeService.executeOrganizationPurge('ORG-TEST-1', null, {
        confirmName: 'Wrong Name'
      }),
      (err) => err && err.code === 'CONFIRM_MISMATCH'
    );
  } finally {
    organizationRepository.getById = originalGetById;
  }
});

test('organization routes register purge-plan and purge endpoints', () => {
  const routes = read('MVC/routes/organizationRoutes.js');
  assert.match(routes, /\/:id\/purge-plan/);
  assert.match(routes, /\/:id\/purge/);
  assert.match(routes, /getOrganizationPurgePlan/);
  assert.match(routes, /purgeOrganization/);
  assert.match(routes, /adminApproval,\s*\n\s*ctrl\.purgeOrganization/);
});

test('deleteOrganization controller blocks naive delete for purge flow', () => {
  const controller = read('MVC/controllers/organizationController.js');
  assert.match(controller, /USE_PURGE_FLOW/);
  assert.match(controller, /organizationPurgeService/);
  assert.match(controller, /getOrganizationPurgePlan/);
  assert.match(controller, /purgeOrganization/);
});

test('organizations list uses org-purge-btn and purge modal markup', () => {
  const view = read('MVC/views/organization/organizations.ejs');
  assert.match(view, /org-purge-btn/);
  assert.doesNotMatch(view, /class="btn btn-outline-danger btn-sm delete-btn"/);
  assert.match(view, /id="orgPurgeModal"/);
  assert.match(view, /orgPurgeConfirmInput/);
  assert.match(view, /orgPurgeExecuteBtn/);
});

test('organizationPurge.js implements multi-step wizard with admin verification', () => {
  const script = read('public/scripts/organizationPurge.js');
  assert.match(script, /purge-plan/);
  assert.match(script, /confirmName/);
  assert.match(script, /org-purge-btn/);
  assert.match(script, /setStep/);
  assert.match(script, /ensureAdminVerification/);
  assert.match(script, /requestProtectedAction/);
  assert.match(script, /admin_required/);
});

test('listOrganizations loads organizationPurge.js via pageScript', () => {
  const controller = read('MVC/controllers/organizationController.js');
  assert.match(controller, /pageScript:\s*'organizationPurge\.js'/);
});
