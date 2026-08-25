const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const subjectPrerequisiteEngineService = require('../MVC/services/school/subjectPrerequisiteEngineService');
const registrationIntegrityService = require('../MVC/services/school/registrationIntegrityService');

const rollingEnrollmentPath = path.join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs');
const rollingEnrollmentSource = fs.readFileSync(rollingEnrollmentPath, 'utf8');

function buildProgramWithPrereqs() {
  return {
    id: 'PRG_001',
    orgId: 'ORG_001',
    departmentId: '',
    subjects: [
      {
        subjectId: 'SUB_A',
        programCredits: 1,
        prerequisites: [],
        subjectType: 'main'
      },
      {
        subjectId: 'SUB_B',
        programCredits: 1,
        prerequisites: ['SUB_A'],
        subjectType: 'main'
      }
    ]
  };
}

function buildClassItem(registrationMode = 'rolling') {
  return {
    id: 'CLS_001',
    orgId: 'ORG_001',
    status: 'active',
    title: 'Test Class',
    registrationMode,
    credits: 1,
    allowedProgramTerms: [{ programId: 'PRG_001', termId: 'TRM_001' }],
    curriculum: {
      subjects: [
        { subjectId: 'SUB_B', code: 'B101', name: 'Subject B' }
      ]
    },
    enrollment: { maxCapacity: 0 }
  };
}

test('resolveEnforcementMode returns advisory for rolling classes and strict for term-based classes', () => {
  assert.equal(subjectPrerequisiteEngineService.resolveEnforcementMode({ registrationMode: 'rolling' }), 'advisory');
  assert.equal(subjectPrerequisiteEngineService.resolveEnforcementMode({ registrationMode: 'term_based' }), 'strict');
});

test('evaluateSubjectPrerequisitesCore blocks missing prerequisites for term-based classes', () => {
  const result = subjectPrerequisiteEngineService.evaluateSubjectPrerequisitesCore({
    classItem: buildClassItem('term_based'),
    program: buildProgramWithPrereqs(),
    student: { id: 'STU_001' },
    snapshot: { results: { passedSubjects: [] } },
    subjectCatalogMap: new Map([
      ['SUB_A', { id: 'SUB_A', code: 'A101', name: 'Subject A' }],
      ['SUB_B', { id: 'SUB_B', code: 'B101', name: 'Subject B' }]
    ])
  });

  assert.equal(result.enforcementMode, 'strict');
  assert.equal(result.prerequisiteStatus, 'blocked');
  assert.equal(result.satisfied, false);
  assert.ok(result.issues.length > 0);
  assert.equal(result.warnings.length, 0);
  assert.ok(result.repair.missingSubjects.length > 0);
});

test('evaluateSubjectPrerequisitesCore warns but does not block missing prerequisites for rolling classes', () => {
  const result = subjectPrerequisiteEngineService.evaluateSubjectPrerequisitesCore({
    classItem: buildClassItem('rolling'),
    program: buildProgramWithPrereqs(),
    student: { id: 'STU_001' },
    snapshot: { results: { passedSubjects: [] } },
    subjectCatalogMap: new Map([
      ['SUB_A', { id: 'SUB_A', code: 'A101', name: 'Subject A' }],
      ['SUB_B', { id: 'SUB_B', code: 'B101', name: 'Subject B' }]
    ])
  });

  assert.equal(result.enforcementMode, 'advisory');
  assert.equal(result.prerequisiteStatus, 'warning');
  assert.equal(result.satisfied, false);
  assert.equal(result.issues.length, 0);
  assert.ok(result.warnings.length > 0);
});

test('evaluateSubjectPrerequisitesCore returns satisfied when prerequisites are met', () => {
  const result = subjectPrerequisiteEngineService.evaluateSubjectPrerequisitesCore({
    classItem: buildClassItem('rolling'),
    program: buildProgramWithPrereqs(),
    student: { id: 'STU_001' },
    snapshot: { results: { passedSubjects: ['SUB_A', 'SUB_B'] } },
    subjectCatalogMap: new Map()
  });

  assert.equal(result.prerequisiteStatus, 'satisfied');
  assert.equal(result.satisfied, true);
  assert.equal(result.issues.length, 0);
  assert.equal(result.warnings.length, 0);
});

test('assertPrerequisitesForEnrollment throws only for blocked prerequisite status', () => {
  assert.throws(
    () => subjectPrerequisiteEngineService.assertPrerequisitesForEnrollment({
      prerequisiteStatus: 'blocked',
      issues: ['Missing prerequisite(s) for B101: SUB_A.']
    }),
    /Missing prerequisite/
  );

  assert.doesNotThrow(() => subjectPrerequisiteEngineService.assertPrerequisitesForEnrollment({
    prerequisiteStatus: 'warning',
    warnings: ['Missing prerequisite(s) for B101: SUB_A.']
  }));
});

test('buildTermClassPreview blocks prerequisites for term-based classes', () => {
  const preview = registrationIntegrityService.buildTermClassPreview({
    classItem: buildClassItem('term_based'),
    program: buildProgramWithPrereqs(),
    department: null,
    termId: 'TRM_001',
    student: { id: 'STU_001', feeCategory: 'domestic' },
    effectiveDate: '2026-01-15',
    snapshot: { results: { passedSubjects: [] } },
    subjectCatalogMap: new Map([
      ['SUB_A', { id: 'SUB_A', code: 'A101', name: 'Subject A' }]
    ]),
    selectedSubjectOwners: new Map(),
    existingRosterClassIds: new Set(),
    classEnrollmentCountsByClassId: new Map([['CLS_001', 0]])
  });

  assert.equal(preview.status, 'error');
  assert.ok(preview.issues.some((issue) => /Missing prerequisite/.test(issue)));
  assert.equal(preview.prerequisiteEvaluation.prerequisiteStatus, 'blocked');
});

test('buildTermClassPreview warns but does not block prerequisites for rolling classes', () => {
  const preview = registrationIntegrityService.buildTermClassPreview({
    classItem: buildClassItem('rolling'),
    program: buildProgramWithPrereqs(),
    department: null,
    termId: 'TRM_001',
    student: { id: 'STU_001', feeCategory: 'domestic' },
    effectiveDate: '2026-01-15',
    snapshot: { results: { passedSubjects: [] } },
    subjectCatalogMap: new Map([
      ['SUB_A', { id: 'SUB_A', code: 'A101', name: 'Subject A' }]
    ]),
    selectedSubjectOwners: new Map(),
    existingRosterClassIds: new Set(),
    classEnrollmentCountsByClassId: new Map([['CLS_001', 0]])
  });

  assert.notEqual(preview.status, 'error');
  assert.equal(preview.issues.length, 0);
  assert.ok(preview.warnings.some((warning) => /Missing prerequisite/.test(warning)));
  assert.equal(preview.prerequisiteEvaluation.prerequisiteStatus, 'warning');
});

test('rolling enrollment view supports advisory prerequisite enforcement helpers', () => {
  assert.match(rollingEnrollmentSource, /function isAdvisoryPrerequisiteEnforcement\(/);
  assert.match(rollingEnrollmentSource, /enforcementMode/);
  assert.match(rollingEnrollmentSource, /Review Prerequisite Credits/);
});
