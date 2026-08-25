'use strict';

const schoolDataService = require('./schoolDataService');
const academicSnapshotService = require('./academicSnapshotService');
const clbPlacementPriorCreditService = require('./clbPlacementPriorCreditService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function getRegistrationIntegrityService() {
  return require('./registrationIntegrityService');
}

function asIdArray(value) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => toPublicId(item))
    .filter(Boolean)));
}

function resolveEnforcementMode(classItem) {
  const mode = getRegistrationIntegrityService().normalizeClassRegistrationMode(classItem?.registrationMode);
  return mode === 'rolling' ? 'advisory' : 'strict';
}

function buildSubjectLabel(subject, subjectId) {
  const code = String(subject?.code || '').trim();
  const name = String(subject?.name || '').trim();
  if (code && name) return `${code} - ${name}`;
  return code || name || subjectId;
}

function buildPrerequisiteGapMessage(subjectRef, missingPrerequisiteIds) {
  const ownerLabel = subjectRef.subjectCode || subjectRef.subjectId;
  return `Missing prerequisite(s) for ${ownerLabel}: ${missingPrerequisiteIds.join(', ')}.`;
}

function buildMissingSubjectRepairRows(missingBySubject, subjectCatalogMap) {
  const catalogMap = subjectCatalogMap instanceof Map ? subjectCatalogMap : new Map();
  const out = [];
  const seen = new Set();
  (Array.isArray(missingBySubject) ? missingBySubject : []).forEach((row) => {
    (Array.isArray(row?.missingPrerequisiteIds) ? row.missingPrerequisiteIds : []).forEach((subjectId) => {
      const normalizedId = toPublicId(subjectId);
      if (!normalizedId || seen.has(normalizedId)) return;
      seen.add(normalizedId);
      const subject = catalogMap.get(normalizedId);
      const ownerLabel = row.subjectCode || row.subjectId;
      out.push({
        id: normalizedId,
        label: buildSubjectLabel(subject, normalizedId),
        reason: ownerLabel ? `Required before ${ownerLabel}` : 'Required prerequisite'
      });
    });
  });
  return out;
}

function evaluateSubjectPrerequisitesCore({
  classItem,
  program,
  student,
  snapshot,
  subjectCatalogMap = new Map()
}) {
  const enforcementMode = resolveEnforcementMode(classItem);
  const programId = toPublicId(program?.id);
  const relevantSubjects = getRegistrationIntegrityService().getRelevantClassSubjects(classItem, program);
  const passedSubjects = new Set(asIdArray(snapshot?.results?.passedSubjects));
  const missingBySubject = [];
  const issues = [];
  const warnings = [];

  relevantSubjects.forEach((subjectRef) => {
    const missingPrerequisiteIds = (Array.isArray(subjectRef.prerequisites) ? subjectRef.prerequisites : [])
      .map((preId) => toPublicId(preId))
      .filter((preId) => preId && !passedSubjects.has(preId));
    if (!missingPrerequisiteIds.length) return;

    const catalogMap = subjectCatalogMap instanceof Map ? subjectCatalogMap : new Map();
    const missingPrerequisiteLabels = missingPrerequisiteIds.map((preId) => {
      const subject = catalogMap.get(preId);
      return buildSubjectLabel(subject, preId);
    });

    missingBySubject.push({
      subjectId: subjectRef.subjectId,
      subjectCode: subjectRef.subjectCode,
      subjectName: subjectRef.subjectName,
      missingPrerequisiteIds,
      missingPrerequisiteLabels
    });

    const message = buildPrerequisiteGapMessage(subjectRef, missingPrerequisiteIds);
    if (enforcementMode === 'strict') {
      issues.push(message);
    } else {
      warnings.push(message);
    }
  });

  const prerequisiteStatus = missingBySubject.length
    ? (enforcementMode === 'strict' ? 'blocked' : 'warning')
    : 'satisfied';

  const allMissingSubjects = buildMissingSubjectRepairRows(missingBySubject, subjectCatalogMap);
  const { clbSatisfiedMissingSubjects, missingSubjects } = clbPlacementPriorCreditService.partitionMissingSubjectsByClbCoverage(
    allMissingSubjects,
    student,
    subjectCatalogMap
  );

  const classSubjectIds = relevantSubjects.map((row) => row.subjectId);
  const clbPlacement = clbPlacementPriorCreditService.buildClbPlacementSlice({
    student,
    program,
    missingSubjects,
    clbSatisfiedMissingSubjects,
    subjectCatalogMap,
    classSubjectIds,
    prerequisitesSatisfied: prerequisiteStatus === 'satisfied'
  });

  return {
    enforcementMode,
    prerequisiteStatus,
    satisfied: prerequisiteStatus === 'satisfied',
    issues,
    warnings,
    missingBySubject,
    passedSubjectIds: [...passedSubjects],
    classSubjectIds,
    repair: {
      missingSubjects,
      clbSatisfiedMissingSubjects,
      clbPlacement,
      repairProgramId: programId
    }
  };
}

async function evaluateSubjectPrerequisites({
  studentId,
  programId,
  classId,
  termId = '',
  effectiveDate = '',
  reqUser = null,
  program = null,
  classItem = null,
  student = null,
  snapshot = null,
  subjectCatalogMap = null
} = {}) {
  const normalizedStudentId = toPublicId(studentId || student?.id);
  const normalizedProgramId = toPublicId(programId || program?.id);
  const normalizedClassId = toPublicId(classId || classItem?.id);
  if (!normalizedStudentId) throw new Error('studentId is required for prerequisite evaluation.');
  if (!normalizedProgramId) throw new Error('programId is required for prerequisite evaluation.');
  if (!normalizedClassId) throw new Error('classId is required for prerequisite evaluation.');

  const resolvedStudent = student || await schoolDataService.getDataById('students', normalizedStudentId, reqUser);
  if (!resolvedStudent) throw new Error('Student could not be loaded for prerequisite evaluation.');

  const resolvedProgram = program || await schoolDataService.getDataById('programs', normalizedProgramId, reqUser);
  if (!resolvedProgram) throw new Error('Program could not be loaded for prerequisite evaluation.');

  const resolvedClass = classItem || await schoolDataService.getDataById('classes', normalizedClassId, reqUser);
  if (!resolvedClass) throw new Error('Class could not be loaded for prerequisite evaluation.');

  if (!idsEqual(resolvedClass.orgId, resolvedProgram.orgId)) {
    throw new Error('Class organization does not match the selected program.');
  }

  const resolvedSnapshot = snapshot || await academicSnapshotService.rebuildStudentProgramSnapshot(
    normalizedStudentId,
    normalizedProgramId
  );

  let resolvedCatalogMap = subjectCatalogMap;
  if (!(resolvedCatalogMap instanceof Map)) {
    const subjectsResult = await schoolDataService.fetchAllData('subjects', {}, reqUser);
    resolvedCatalogMap = new Map(
      (Array.isArray(subjectsResult) ? subjectsResult : [])
        .filter((row) => idsEqual(row?.orgId, resolvedClass?.orgId))
        .map((row) => [toPublicId(row?.id), row])
    );
  }

  const evaluation = evaluateSubjectPrerequisitesCore({
    classItem: resolvedClass,
    program: resolvedProgram,
    student: resolvedStudent,
    snapshot: resolvedSnapshot,
    subjectCatalogMap: resolvedCatalogMap
  });

  return {
    ...evaluation,
    studentId: normalizedStudentId,
    programId: normalizedProgramId,
    classId: normalizedClassId,
    termId: toPublicId(termId),
    effectiveDate: String(effectiveDate || '').trim()
  };
}

function assertPrerequisitesForEnrollment(result, fallbackMessage = 'Enrollment prerequisites are not satisfied for this class and program.') {
  if (!result || result.prerequisiteStatus !== 'blocked') return;
  const messages = (Array.isArray(result.issues) ? result.issues : []).filter(Boolean);
  throw new Error(messages.join(' ') || fallbackMessage);
}

module.exports = {
  resolveEnforcementMode,
  evaluateSubjectPrerequisitesCore,
  evaluateSubjectPrerequisites,
  assertPrerequisitesForEnrollment,
  buildMissingSubjectRepairRows,
  buildPrerequisiteGapMessage
};
