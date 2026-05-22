const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const packageManifestService = require('../MVC/services/packageManifestService');
const { createPtePublicJoinService } = require('../MVC/services/pte/ptePublicJoinService');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function buildPublicRegistrationMock() {
  return {
    resolveFreeOrgSettingId: () => 900000,
    resolveConfiguredOrgId: () => 900000,
    resolveOrgNameById: async () => 'Amin Paknejad',
    toStoredOrgId: (value) => Number(value),
    upsertOrganizationRoles(organizations = [], options = {}) {
      const targetOrgId = Number(options.orgId);
      const requiredRoles = Array.from(new Set(options.requiredRoles || []));
      const rows = Array.isArray(organizations) ? organizations.map((org) => ({ ...org })) : [];
      const index = rows.findIndex((org) => Number(org.orgId) === targetOrgId);
      if (index >= 0) {
        const roles = Array.isArray(rows[index].roles) ? [...rows[index].roles] : [];
        requiredRoles.forEach((role) => {
          if (!roles.includes(role)) roles.push(role);
        });
        rows[index] = {
          ...rows[index],
          name: options.orgName,
          roles,
          role: roles[0] || 'member',
          memberStatus: 'active'
        };
        return rows;
      }
      rows.push({
        orgId: targetOrgId,
        name: options.orgName,
        roles: requiredRoles,
        role: requiredRoles[0] || 'member',
        memberStatus: 'active',
        joinedAt: options.joinedAt
      });
      return rows;
    },
    registerPublicPersonAndUser: async (options = {}) => ({
      registrationOptions: options,
      person: { id: 'P100' },
      user: { id: 'U100' },
      tempPassword: 'temp-pass',
      systemUserContext: { id: 'SYSTEM', username: options.creatorUsername || 'SYSTEM' }
    })
  };
}

test('PTE package manifest validates and declares real PTE package surface', () => {
  const manifest = packageManifestService.validatePackageManifest(
    JSON.parse(readText('packages/pte/package.manifest.json')),
    { knownIds: [] }
  );

  assert.equal(manifest.id, 'pte');
  assert.equal(manifest.mountPath, '/pte');
  assert.equal(manifest.queryExecutors.length, 0);
  assert.ok(manifest.roles.some((role) => role.key === 'pte_student'));
  assert.ok(manifest.roles.some((role) => role.key === 'pte_student_public'));
  assert.ok(manifest.sections.some((section) => section.name === 'PTE_PUBLIC_APPLICANTS'));
  assert.ok(manifest.symbols.some((symbol) => symbol.name === 'PTE_PUBLIC_PAGE'));
  assert.ok(manifest.accesses.some((access) => access.name === 'PTE_APPLICANT'));
  assert.ok(manifest.uploadFolders.some((folder) => folder.key === 'pte.practiceAttempt'));
  assert.ok(manifest.routes.some((route) => route.path === '/pte/join' && route.metadataOnly === true));
});

test('PTE enable script dry-run reports registry upsert without writing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pte-package-registry-'));
  const registryPath = path.join(tmpDir, 'packageRegistry.json');
  const result = spawnSync(process.execPath, ['scripts/packages/enable-pte-package.js', '--json'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PACKAGE_REGISTRY_DATA_PATH: registryPath
    },
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.apply, false);
  assert.equal(report.action, 'create');
  assert.equal(report.payload.packageId, 'pte');
  assert.equal(report.payload.enabled, true);
  assert.equal(report.payload.installStatus, 'enabled');
  assert.equal(fs.existsSync(registryPath), false);
});

test('PTE route owns /pte/join through PTE public join controller', () => {
  const routeSource = readText('MVC/routes/pte/pteMainRoute.js');
  assert.match(routeSource, /controllers\/pte\/publicJoinController/);
  assert.doesNotMatch(routeSource, /personController\.showPtePublicJoinForm/);
  assert.doesNotMatch(routeSource, /personController\.processPtePublicJoin/);
});

test('core person controller keeps generic public join without PTE service coupling', () => {
  const controllerSource = readText('MVC/controllers/personController.js');
  assert.doesNotMatch(controllerSource, /services\/pte\/pteStudentDataService/);
  assert.doesNotMatch(controllerSource, /showPtePublicJoinForm/);
  assert.doesNotMatch(controllerSource, /processPtePublicJoin/);

  const personRoutes = readText('MVC/routes/personRoutes.js');
  assert.match(personRoutes, /router\.get\('\/join', ctrl\.showPublicJoinForm\)/);
  assert.match(personRoutes, /router\.post\('\/join', ctrl\.processPublicJoin\)/);
});

test('existing logged-in user can receive PTE public role on person and user records', async () => {
  const writes = [];
  const applicantCalls = [];
  const publicRegistration = buildPublicRegistrationMock();
  const dataService = {
    async getDataById(entity) {
      if (entity === 'users') {
        return { id: 'U1', username: 'learner@example.com', personId: 'P1', organizations: [] };
      }
      if (entity === 'persons') {
        return { id: 'P1', organizations: [] };
      }
      return null;
    },
    async updateData(entity, id, payload) {
      writes.push({ entity, id, payload });
      return payload;
    }
  };
  const pteStudentDataService = {
    PERSON_ORG_ROLE_PUBLIC_TOKEN: 'pte_student_public',
    async createPublicApplicantFromJoin(payload, actor) {
      applicantCalls.push({ payload, actor });
      return { id: 'A1', ...payload };
    }
  };
  const service = createPtePublicJoinService({
    dataService,
    publicRegistrationService: publicRegistration,
    pteStudentDataService
  });

  const result = await service.joinExistingUserToPtePublic({ id: 'U1', username: 'learner@example.com', personId: 'P1' });

  assert.equal(result.alreadyJoined, false);
  assert.equal(writes.length, 2);
  assert.ok(writes.find((row) => row.entity === 'persons').payload.organizations[0].roles.includes('pte_student_public'));
  assert.ok(writes.find((row) => row.entity === 'users').payload.organizations[0].roles.includes('pte_student_public'));
  assert.equal(applicantCalls.length, 1);
});

test('existing logged-in user already holding PTE public role is recognized', async () => {
  const writes = [];
  const applicantCalls = [];
  const publicRegistration = buildPublicRegistrationMock();
  const joinedOrg = { orgId: 900000, roles: ['member', 'pte_student_public'], role: 'member' };
  const dataService = {
    async getDataById(entity) {
      if (entity === 'users') {
        return { id: 'U1', username: 'learner@example.com', personId: 'P1', organizations: [joinedOrg] };
      }
      if (entity === 'persons') {
        return { id: 'P1', organizations: [joinedOrg] };
      }
      return null;
    },
    async updateData(entity, id, payload) {
      writes.push({ entity, id, payload });
      return payload;
    }
  };
  const pteStudentDataService = {
    PERSON_ORG_ROLE_PUBLIC_TOKEN: 'pte_student_public',
    async createPublicApplicantFromJoin(payload) {
      applicantCalls.push(payload);
      return { id: 'A1', ...payload };
    }
  };
  const service = createPtePublicJoinService({
    dataService,
    publicRegistrationService: publicRegistration,
    pteStudentDataService
  });

  const result = await service.joinExistingUserToPtePublic({ id: 'U1', username: 'learner@example.com', personId: 'P1' });

  assert.equal(result.alreadyJoined, true);
  assert.equal(writes.length, 0);
  assert.equal(applicantCalls.length, 1);
});

test('guest PTE public join creates public registration and applicant', async () => {
  const registrationCalls = [];
  const applicantCalls = [];
  const publicRegistration = buildPublicRegistrationMock();
  publicRegistration.registerPublicPersonAndUser = async (options) => {
    registrationCalls.push(options);
    return {
      person: { id: 'P100' },
      user: { id: 'U100' },
      tempPassword: 'temp-pass',
      systemUserContext: { id: 'SYSTEM', username: 'PTE_Public_Sign_Up' }
    };
  };
  const pteStudentDataService = {
    PERSON_ORG_ROLE_PUBLIC_TOKEN: 'pte_student_public',
    async createPublicApplicantFromJoin(payload, actor) {
      applicantCalls.push({ payload, actor });
      return { id: 'A100', ...payload };
    }
  };
  const service = createPtePublicJoinService({
    dataService: { deleteData: async () => {} },
    publicRegistrationService: publicRegistration,
    pteStudentDataService
  });

  const result = await service.registerGuestPtePublic({ firstName: 'Ava' });

  assert.equal(result.person.id, 'P100');
  assert.equal(registrationCalls.length, 1);
  assert.deepEqual(registrationCalls[0].roles, ['member', 'pte_student_public']);
  assert.equal(registrationCalls[0].creatorUsername, 'PTE_Public_Sign_Up');
  assert.equal(applicantCalls.length, 1);
  assert.equal(applicantCalls[0].payload.personId, 'P100');
  assert.equal(applicantCalls[0].payload.userId, 'U100');
});
