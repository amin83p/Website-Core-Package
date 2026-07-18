const assert = require('assert');
const fs = require('fs');
const path = require('path');
const personModel = require('../MVC/models/personModel');
const studentModel = require('../packages/school/MVC/models/school/studentModel');
const funderModel = require('../packages/school/MVC/models/school/funderModel');
const accountModel = require('../packages/school/MVC/models/school/schoolAccountModel');
const funderController = require('../packages/school/MVC/controllers/school/funderController');
const { buildLegacyStudentFundingReport } = require('../scripts/school/migration/reportLegacyStudentFunding');

function run() {
  const organization = {
    personProfileType: 'organization',
    organizationProfile: { legalName: 'Example Funding Ltd.' },
    name: {},
    demographics: {},
    contact: { emails: [{ email: 'finance@example.test', isPrimary: true }] },
    organizations: [],
    tags: []
  };
  assert.equal(personModel.validateData(organization).isValid, true, 'organization Person should not require individual demographics');
  assert.equal(personModel.validateData({ ...organization, organizationProfile: { legalName: '' } }).isValid, false, 'organization legal name is required');

  const funder = funderModel.sanitizeFunderInput({
    orgId: 'ORG1',
    personId: 'P1',
    status: 'active',
    externalReference: 'REF-1'
  });
  assert.equal(funder.personId, 'P1');
  assert.equal(funder.funderAccountId, '');
  assert(accountModel.ACCOUNT_PARTY_ROLES.includes('funder'));
  assert(accountModel.ACCOUNT_HEAD_CATEGORIES.includes('funders'));

  const funderControllerSource = fs.readFileSync(
    require.resolve('../packages/school/MVC/controllers/school/funderController'),
    'utf8'
  );
  const funderFormSource = fs.readFileSync(
    path.join(__dirname, '..', 'packages/school/MVC/views/school/funder/funderForm.ejs'),
    'utf8'
  );
  assert.match(funderControllerSource, /createdAccount/);
  assert.match(funderControllerSource, /getFunderAccountParentOrThrow/);
  assert.match(funderControllerSource, /requestedAccountId/);
  assert.match(funderControllerSource, /accountAllowsChildren/);
  assert.match(funderFormSource, /name="funderAccountParentId"/);
  assert.match(funderFormSource, /GenericPickerPresets\.account/);
  assert.match(funderFormSource, /\/school\/funders\/api\/eligible-accounts\?kind=parent/);
  assert.match(funderFormSource, /name="funderAccountId"/);
  assert.match(funderFormSource, /created automatically when a new Funder is saved/i);
  assert.match(funderFormSource, /btnEditPersonProfile/);
  assert.match(funderFormSource, /typeof personName !== 'undefined' \? personName/);
  assert.match(funderControllerSource, /formatPersonName/);
  assert.match(funderControllerSource, /roles: \['school_funder'\]/);
  assert.match(funderControllerSource, /ensurePersonHasSchoolRole\(\{[\s\S]*role: 'school_funder'/);

  const {
    accountAllowsChildren,
    isActiveParentAccount,
    findSuggestedFunderParent
  } = funderController.__testables;

  const orgId = '900000';
  const studentLeaf = {
    id: 'ACC_STU_LEAF',
    orgId,
    status: 'active',
    level: 5,
    partyRole: 'student',
    allowPost: true,
    isControl: false,
    headCategory: 'none',
    name: 'One Student'
  };
  const organizationsHead = {
    id: 'ACC_1240',
    orgId,
    status: 'active',
    level: 3,
    partyRole: 'none',
    allowPost: false,
    isControl: true,
    headCategory: 'organizations',
    code: '1240',
    name: 'Sponsored Organizations Receivable Control'
  };
  const fundersHead = {
    id: 'ACC_1250',
    orgId,
    status: 'active',
    level: 3,
    partyRole: 'none',
    allowPost: false,
    isControl: true,
    headCategory: 'funders',
    code: '1250',
    name: 'Funders Receivable Control'
  };

  assert.equal(accountAllowsChildren(studentLeaf), false, 'single-student leaf must not allow children');
  assert.equal(isActiveParentAccount(studentLeaf, orgId), false);
  assert.equal(accountAllowsChildren(organizationsHead), true);
  assert.equal(findSuggestedFunderParent([studentLeaf, organizationsHead], orgId)?.id, 'ACC_1240');
  assert.equal(
    findSuggestedFunderParent([studentLeaf, organizationsHead, fundersHead], orgId)?.id,
    'ACC_1250'
  );

  const identitySource = fs.readFileSync(
    path.join(__dirname, '..', 'packages/school/MVC/services/school/schoolIdentityLookupService.js'),
    'utf8'
  );
  assert.match(identitySource, /organizationProfile\?\.legalName/);
  assert.match(identitySource, /typeof person\.name === 'string'/);
  assert.match(funderControllerSource, /preferred: profileType === 'organization' \? legalName : ''/);

  // Direct behavioral check via schoolPersonAccessService (canonical formatter).
  const schoolPersonAccessService = require('../packages/school/MVC/services/school/schoolPersonAccessService');
  assert.equal(
    schoolPersonAccessService.formatPersonName({
      personProfileType: 'organization',
      name: { first: '', last: '', preferred: '' },
      organizationProfile: { legalName: 'WCB' }
    }, 'fallback'),
    'WCB'
  );

  const student = studentModel.sanitizeStudentInput({
    orgId: 'ORG1',
    personId: 'P2',
    enrollmentDate: '2026-07-17',
    feeCategory: 'Domestic',
    funderAccountId: 'LEGACY',
    selfFund: true
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(student, 'funderAccountId'),
    false,
    'new student writes must not include legacy funding fields'
  );

  const report = buildLegacyStudentFundingReport(
    [{ id: 'S1', orgId: 'ORG1', funderAccountId: 'F1', studentAccountId: 'SA1' }],
    [
      { id: 'F1', orgId: 'ORG1', code: 'FUN', name: 'Funder' },
      { id: 'SA1', orgId: 'ORG1', parentId: 'F1', code: 'STU' }
    ]
  );
  assert.equal(report.dryRun, true);
  assert.equal(report.mutationPerformed, false);
  assert.equal(report.summary.candidates, 1);
  console.log('School funder foundation tests passed.');
}

run();
