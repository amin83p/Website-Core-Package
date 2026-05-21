const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

const {
  buildOrganizationDisplayMap,
  canonicalizeMembershipOrganizationName,
  formatOrganizationLabel,
  resolveMembershipOrganizationLabel
} = require('../MVC/utils/organizationDisplay');
const {
  migrateMembershipRows
} = require('../scripts/migrate-canonical-organization-membership-names');

const ORGANIZATIONS = Object.freeze([
  {
    id: '900000',
    identity: {
      displayName: 'Amin Paknejad',
      legalName: 'Amin Legal Name'
    },
    name: 'Legacy Org Name',
    orgName: 'Legacy Org Name 2'
  }
]);

test('organization display resolves canonical name and labels by org id', () => {
  const organizationMap = buildOrganizationDisplayMap(ORGANIZATIONS);

  assert.equal(formatOrganizationLabel('900000', 'Amin Paknejad'), 'Amin Paknejad (900000)');
  assert.equal(resolveMembershipOrganizationLabel({
    orgId: 900000,
    name: 'PTE Public Applicants'
  }, organizationMap), 'Amin Paknejad (900000)');
  assert.equal(resolveMembershipOrganizationLabel({
    orgId: '404404',
    name: 'Stale Unknown Name'
  }, organizationMap), 'Org #404404');
});

test('canonicalization updates only membership name and preserves role metadata', () => {
  const organizationMap = buildOrganizationDisplayMap(ORGANIZATIONS);
  const membership = {
    orgId: 900000,
    name: 'Org #900000',
    roles: ['member', 'pte_student_public'],
    role: 'member',
    memberStatus: 'active',
    joinedAt: '2026-01-01T00:00:00.000Z'
  };

  const result = canonicalizeMembershipOrganizationName(membership, organizationMap);

  assert.equal(result.changed, true);
  assert.equal(result.value.name, 'Amin Paknejad');
  assert.deepEqual(result.value.roles, ['member', 'pte_student_public']);
  assert.equal(result.value.role, 'member');
  assert.equal(result.value.memberStatus, 'active');
  assert.equal(result.value.joinedAt, '2026-01-01T00:00:00.000Z');
});

test('migration normalizes person and user membership names while preserving roles', () => {
  const rows = [
    {
      id: 'person-1',
      organizations: [
        {
          orgId: '900000',
          name: '',
          roles: ['member', 'school_student'],
          role: 'member',
          memberStatus: 'active',
          joinedAt: '2026-02-01T00:00:00.000Z'
        }
      ],
      audit: { lastUpdateUser: 'keep-me' }
    },
    {
      id: 'user-1',
      organizations: [
        {
          orgId: 900000,
          name: 'PTE Public Applicants',
          roles: ['member', 'pte_student_public'],
          role: 'member',
          memberStatus: 'active',
          joinedAt: '2026-03-01T00:00:00.000Z'
        },
        {
          orgId: 'UNKNOWN',
          name: 'External Snapshot',
          roles: ['member'],
          role: 'member'
        }
      ]
    }
  ];

  const result = migrateMembershipRows(rows, ORGANIZATIONS);

  assert.equal(result.changedCount, 2);
  assert.equal(result.membershipChangedCount, 2);
  assert.equal(result.value[0].organizations[0].name, 'Amin Paknejad');
  assert.deepEqual(result.value[0].organizations[0].roles, ['member', 'school_student']);
  assert.deepEqual(result.value[0].audit, { lastUpdateUser: 'keep-me' });
  assert.equal(result.value[1].organizations[0].name, 'Amin Paknejad');
  assert.deepEqual(result.value[1].organizations[0].roles, ['member', 'pte_student_public']);
  assert.equal(result.value[1].organizations[1].name, 'External Snapshot');
});

test('persons list renders same org id with one canonical label', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../MVC/views/person/persons.ejs'), {
    title: 'Persons Management',
    newUrl: 'persons',
    newLabel: 'Add Person',
    user: { id: 'U1', username: 'tester', allowedOrgs: [] },
    tableName: 'Persons_Management',
    print: true,
    includeModal: true,
    includeModal_Table: true,
    includeModal_FileImport: true,
    pagination: {
      startItem: 1,
      endItem: 2,
      totalItems: 2,
      totalPages: 1,
      currentPage: 1,
      limit: 10
    },
    filters: {},
    searchableFields: [],
    data: [
      {
        id: 'P1',
        active: true,
        name: { first: 'First', last: 'Person' },
        contact: { emails: [{ email: 'one@example.test', isPrimary: true }], phones: [] },
        organizations: [{ orgId: 900000, name: 'PTE Public Applicants', displayLabel: 'Amin Paknejad (900000)' }]
      },
      {
        id: 'P2',
        active: true,
        name: { first: 'Second', last: 'Person' },
        contact: { emails: [{ email: 'two@example.test', isPrimary: true }], phones: [] },
        organizations: [{ orgId: 900000, name: 'Org #900000', displayLabel: 'Amin Paknejad (900000)' }]
      }
    ]
  });

  assert.equal((html.match(/Amin Paknejad \(900000\)/g) || []).length, 2);
  assert.equal(html.includes('PTE Public Applicants'), false);
  assert.equal(html.includes('Org #900000'), false);
});

test('users list renders linked person orgs with canonical labels', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../MVC/views/user/users.ejs'), {
    title: 'Users Management',
    newUrl: 'users',
    newLabel: 'Add User',
    user: { id: 'U1', username: 'tester', allowedOrgs: [] },
    tableName: 'Users_Management',
    print: true,
    includeModal: true,
    includeModal_Table: true,
    includeModal_FileImport: true,
    pagination: {
      startItem: 1,
      endItem: 1,
      totalItems: 1,
      totalPages: 1,
      currentPage: 1,
      limit: 10
    },
    filters: {},
    searchableFields: [],
    users: [
      {
        id: 'U2',
        email: 'user@example.test',
        username: 'user@example.test',
        personId: 'P1',
        primaryOrgId: 900000,
        active: true,
        status: 'active'
      }
    ],
    persons: [
      {
        id: 'P1',
        name: { first: 'Linked', last: 'Person' },
        organizations: [{ orgId: 900000, name: 'Org #900000', displayLabel: 'Amin Paknejad (900000)' }]
      }
    ]
  });

  assert.equal((html.match(/Amin Paknejad \(900000\)/g) || []).length, 2);
  assert.equal(html.includes('Org #900000'), false);
});
