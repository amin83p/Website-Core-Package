'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const ROOT = path.resolve(__dirname, '..');
const definitions = require('../packages/school/config/skillDefinitions');
const studentModel = require('../packages/school/MVC/models/school/studentModel');
const classModel = require('../packages/school/MVC/models/school/classModel');
const skillModel = require('../packages/school/MVC/models/school/skillModel');
const skillCatalogService = require('../packages/school/MVC/services/school/skillCatalogService');
const gradebookSkillCatalogService = require('../packages/school/MVC/services/school/gradebookSkillCatalogService');
const schoolRepositories = require('../packages/school/MVC/repositories/school');
const classController = require('../packages/school/MVC/controllers/school/classController');
const deletionRules = require('../packages/school/MVC/services/school/schoolDeletionRuleRegistry');
const classSkillMigration = require('../scripts/school/migration/backfillClassSkills');

test('shared skill definitions contain the stable 11-code domain and derive CLB skills', () => {
  assert.equal(definitions.DEFAULT_SKILL_DEFINITIONS.length, 11);
  assert.deepEqual(definitions.CLB_SKILL_CODES, ['listening', 'speaking', 'reading', 'writing']);
  assert.deepEqual(studentModel.CLB_SKILLS, definitions.CLB_SKILL_CODES);
  assert.equal(new Set(definitions.DEFAULT_SKILL_DEFINITIONS.map((row) => row.code)).size, 11);
  assert.ok(definitions.DEFAULT_SKILL_DEFINITIONS
    .filter((row) => definitions.CLB_SKILL_CODES.includes(row.code))
    .every((row) => row.kind === 'clb' && row.supportsTeachingOutline === true));
});

test('skill model normalizes catalog rows and validates organization-scoped inputs', () => {
  const row = skillModel.sanitizeInput({
    orgId: '900000',
    code: ' Digital Forms ',
    label: 'Digital Forms',
    kind: 'digital_literacy',
    supportsTeachingOutline: true,
    active: false,
    sortOrder: 125
  });
  assert.deepEqual(row, {
    orgId: '900000',
    code: 'digital_forms',
    label: 'Digital Forms',
    kind: 'digital_literacy',
    supportsTeachingOutline: false,
    active: false,
    sortOrder: 125
  });
  assert.throws(() => skillModel.sanitizeInput({ code: 'x', label: 'X' }), /Organization is required/);
});

test('organization skill catalog is isolated, active-filtered, and idempotently seeded', async () => {
  const originalList = schoolRepositories.skills.list;
  const originalCreate = schoolRepositories.skills.create;
  const rows = [
    {
      id: 'custom-listening',
      orgId: 'ORG-A',
      code: 'listening',
      label: 'Customized Listening',
      kind: 'clb',
      supportsTeachingOutline: true,
      active: false,
      sortOrder: 10
    },
    {
      id: 'other-org',
      orgId: 'ORG-B',
      code: 'writing',
      label: 'Other Writing',
      kind: 'clb',
      supportsTeachingOutline: true,
      active: true,
      sortOrder: 40
    }
  ];
  let creates = 0;
  schoolRepositories.skills.list = async () => rows.map((row) => ({ ...row }));
  schoolRepositories.skills.create = async (payload) => {
    creates += 1;
    rows.push({ ...payload });
    return payload;
  };
  try {
    const activeBefore = await skillCatalogService.listOrgSkills('ORG-A');
    assert.deepEqual(activeBefore, []);
    const first = await skillCatalogService.ensureOrgDefaultSkills('ORG-A', 'tester');
    assert.equal(first.length, 11);
    assert.equal(creates, 10);
    assert.equal(first.find((row) => row.code === 'listening').label, 'Customized Listening');
    assert.equal(first.find((row) => row.code === 'listening').active, false);
    await skillCatalogService.ensureOrgDefaultSkills('ORG-A', 'tester');
    assert.equal(creates, 10);
    assert.ok(first.every((row) => row.orgId === 'ORG-A'));
  } finally {
    schoolRepositories.skills.list = originalList;
    schoolRepositories.skills.create = originalCreate;
  }
});

test('organization skill catalog does not seed or load for SYSTEM org', async () => {
  assert.equal(skillCatalogService.isRealOrganizationId('900000'), true);
  assert.equal(skillCatalogService.isRealOrganizationId('SYSTEM'), false);
  assert.deepEqual(await skillCatalogService.ensureOrgDefaultSkills('SYSTEM', 'tester'), []);
  assert.deepEqual(await skillCatalogService.loadOrgSkillCatalog('SYSTEM', 'tester', { allowFallback: false }), []);
});

test('dynamic organization catalogs preserve custom labels and legacy parsing', () => {
  const skillCatalog = [
    { code: 'writing', label: 'Written Communication', kind: 'clb', supportsTeachingOutline: true },
    { code: 'digital_forms', label: 'Digital Forms', kind: 'general' }
  ];
  assert.deepEqual(
    gradebookSkillCatalogService.normalizeGradebookSkillIds(['writing', 'digital_forms', 'reading'], { skillCatalog }),
    ['writing', 'digital_forms']
  );
  assert.deepEqual(
    gradebookSkillCatalogService.matchSkillIdsFromLegacyText('Digital Forms / Written Communication', { skillCatalog }),
    ['writing', 'digital_forms']
  );
  assert.deepEqual(
    gradebookSkillCatalogService.normalizeGradebookActivitySkills(
      { skills: ['digital_forms', 'writing'] },
      { skillCatalog }
    ),
    {
      skills: ['digital_forms', 'writing'],
      skillFocus: 'Digital Forms, Written Communication'
    }
  );
});

test('class contract normalizes skill assignments while permitting an empty assignment', () => {
  assert.deepEqual(classModel.sanitizeSkillIds(['Writing', 'writing', 'Digital Forms']), ['writing', 'digital_forms']);
  assert.deepEqual(classModel.sanitizeSkillIds([]), []);
  const row = classModel.sanitizeClassBasic({
    orgId: '900000',
    deliveryDepartmentId: 'DEP-1',
    title: 'Test Class',
    skillIds: ['Listening', 'writing', 'writing']
  });
  assert.deepEqual(row.skillIds, ['listening', 'writing']);
});

test('session enforcement rejects new unassigned skills and preserves historical snapshots', () => {
  const {
    mergeHistoricalSessionSkills,
    mergeHistoricalGradebookSkills
  } = classController._skillAccessTest;
  const allowed = new Set(['writing']);
  const historicalCoverage = [{
    skillId: 'reading',
    skillLabel: 'Reading',
    note: 'Historical coverage',
    outlineItems: []
  }];
  assert.deepEqual(
    mergeHistoricalSessionSkills([{ skillId: 'writing', note: 'New content' }], historicalCoverage, allowed),
    [{ skillId: 'writing', note: 'New content' }, ...historicalCoverage]
  );
  assert.throws(
    () => mergeHistoricalSessionSkills([{ skillId: 'speaking', note: 'Injected' }], historicalCoverage, allowed),
    /not assigned and active/
  );
  assert.deepEqual(
    mergeHistoricalGradebookSkills(
      { id: 'gb-1', skills: ['writing'] },
      { id: 'gb-1', skills: ['reading'] },
      allowed
    ),
    ['writing', 'reading']
  );
  assert.throws(
    () => mergeHistoricalGradebookSkills({ id: 'new', skills: ['speaking'] }, null, allowed),
    /not assigned and active/
  );
});

test('class skill migration only targets documents without the skillIds field', () => {
  const rows = classSkillMigration.buildClassReportRows([
    { id: 'C1', title: 'Legacy' },
    { id: 'C2', title: 'Manually empty', skillIds: [] },
    { id: 'C3', title: 'Customized', skillIds: ['writing'] }
  ]);
  assert.equal(rows[0].action, 'backfill');
  assert.deepEqual(rows[0].after, ['listening', 'speaking', 'reading', 'writing']);
  assert.equal(rows[1].action, 'skipped_existing_field');
  assert.deepEqual(rows[1].after, []);
  assert.equal(rows[2].action, 'skipped_existing_field');
  assert.deepEqual(rows[2].after, ['writing']);
  assert.equal(classSkillMigration.parseArgs(['--apply', '--org=900000']).apply, true);
});

test('skills module metadata, routes, deletion safeguards, and class/session UIs are registered', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/school/package.manifest.json'), 'utf8'));
  const section = manifest.sections.find((row) => row.name === 'SCHOOL_SKILLS');
  assert.equal(section?.homeURL, '/school/skills');
  assert.ok(manifest.symbols.some((row) => row.name === 'SCHOOL_SKILLS'));
  const schoolAccessProfiles = manifest.accesses.filter((access) => (
    (access.sections || []).some((entry) => entry.sectionId === '445569')
  ));
  assert.ok(schoolAccessProfiles.length > 0);
  assert.ok(schoolAccessProfiles.every((access) => (
    (access.sections || []).some((entry) => entry.sectionId === '445584')
  )));
  assert.equal(deletionRules.resolveEntityKeyFromRepositoryKey('skills'), 'skill');
  assert.equal(deletionRules.getEntityDefinition('skill')?.repositoryKey, 'skills');

  const routeSource = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/routes/skillRoutes.js'), 'utf8');
  assert.match(routeSource, /SECTIONS\.SCHOOL_SKILLS/);
  assert.match(routeSource, /OPERATIONS\.CREATE/);
  assert.match(routeSource, /OPERATIONS\.UPDATE/);
  assert.match(routeSource, /OPERATIONS\.DELETE/);

  const classFormPath = path.join(ROOT, 'packages/school/MVC/views/school/class/classForm.ejs');
  const classFormSource = fs.readFileSync(classFormPath, 'utf8');
  ejs.compile(classFormSource, { filename: classFormPath });
  assert.match(classFormSource, /name="skillIds"/);
  assert.match(classFormSource, /class-skill-checkbox/);
  assert.match(classFormSource, /No skills are assigned/);
  assert.match(classFormSource, /skill\.active === false \? 'Inactive' : 'Active'/);
  assert.match(classFormSource, /source\?\.skillIds/);

  const sessionPath = path.join(ROOT, 'packages/school/MVC/views/school/class/sessionManager.ejs');
  const sessionSource = fs.readFileSync(sessionPath, 'utf8');
  ejs.compile(sessionSource, { filename: sessionPath });
  assert.match(sessionSource, /skill\.selectable !== false/);
  assert.match(sessionSource, /gradebookSkillsCatalog/);

  const skillFormPath = path.join(ROOT, 'packages/school/MVC/views/school/skill/skillForm.ejs');
  const skillFormSource = fs.readFileSync(skillFormPath, 'utf8');
  ejs.compile(skillFormSource, { filename: skillFormPath });
  assert.match(skillFormSource, /max-width:\s*1400px/);
  assert.match(skillFormSource, /Back to List/);

  const skillControllerSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/controllers/school/skillController.js'),
    'utf8'
  );
  assert.match(skillControllerSource, /includeModal_Table:\s*true/);
  assert.match(skillControllerSource, /applyGenericFilter/);
  assert.match(skillControllerSource, /canCreateOrgScopedItem/);
  assert.match(skillControllerSource, /assertCreateOrgContextOrThrow/);
  assert.match(skillControllerSource, /isRealOrganizationId/);

  const controllerSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/controllers/school/classController.js'),
    'utf8'
  );
  assert.match(controllerSource, /item\.skillIds = await resolveClassSkillIdsOrThrow/);
  assert.match(controllerSource, /updates\.skillIds = await resolveClassSkillIdsOrThrow/);
  assert.match(controllerSource, /mergeHistoricalSessionSkills\(/);
  assert.match(controllerSource, /mergeHistoricalGradebookSkills\(/);
  assert.match(controllerSource, /gradebookSkills:\s*sessionSkillPolicy\.renderCatalog/);

  const sectionSeedPath = path.join(ROOT, 'scripts/seed-school-skills-section.js');
  const sectionSeedSource = fs.readFileSync(sectionSeedPath, 'utf8');
  assert.match(sectionSeedSource, /SECTION_ID = '445584'/);
  assert.match(sectionSeedSource, /SYM_SCHOOL_SKILLS_001/);
  assert.match(sectionSeedSource, /SCHOOL_ACADEMIA/);

  const skillListSource = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/skill/skillList.ejs'), 'utf8');
  assert.match(skillListSource, /canCreateSkills/);
  assert.match(skillListSource, /SYSTEM \/ GLOBAL MODE/);
});
