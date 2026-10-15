'use strict';

const schoolDataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function collectSubjectIdsFromPrograms(programs = []) {
  const ids = new Set();
  (Array.isArray(programs) ? programs : []).forEach((program) => {
    const rows = Array.isArray(program?.subjects) ? program.subjects : [];
    rows.forEach((row) => {
      const subjectId = toPublicId(row?.subjectId);
      if (subjectId) ids.add(subjectId);
    });
  });
  return ids;
}

function parseProgramIdsFromQuery(query = {}) {
  const rawList = [];
  const single = toPublicId(query?.programId);
  if (single) rawList.push(single);
  const multi = String(query?.programIds || '').trim();
  if (multi) {
    multi.split(',').forEach((part) => {
      const id = toPublicId(part);
      if (id) rawList.push(id);
    });
  }
  return [...new Set(rawList)];
}

async function resolveProgramsForProgramIds(programIds = [], reqUser) {
  const normalizedIds = [...new Set((Array.isArray(programIds) ? programIds : [])
    .map((id) => toPublicId(id))
    .filter(Boolean))];
  if (!normalizedIds.length) return [];

  const allPrograms = await schoolDataService.fetchAllData('programs', {}, reqUser);
  const programMap = new Map(
    (Array.isArray(allPrograms) ? allPrograms : []).map((program) => [toPublicId(program?.id), program])
  );
  return normalizedIds.map((id) => programMap.get(id)).filter(Boolean);
}

async function resolveAllowedSubjectIdsForProgramIds(programIds = [], reqUser) {
  const programs = await resolveProgramsForProgramIds(programIds, reqUser);
  return collectSubjectIdsFromPrograms(programs);
}

function collectProgramIdsFromAllowedProgramTerms(rows = []) {
  const ids = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const programId = toPublicId(row?.programId);
    if (programId) ids.add(programId);
  });
  return [...ids];
}

function assertClassCurriculumSubjectsInProgramScope(classItem, programsOrSubjectIdSet, options = {}) {
  const curriculumSubjects = Array.isArray(classItem?.curriculum?.subjects)
    ? classItem.curriculum.subjects
    : [];
  const programIds = collectProgramIdsFromAllowedProgramTerms(classItem?.allowedProgramTerms);

  const allowedIds = programsOrSubjectIdSet instanceof Set
    ? programsOrSubjectIdSet
    : collectSubjectIdsFromPrograms(Array.isArray(programsOrSubjectIdSet) ? programsOrSubjectIdSet : []);

  if (curriculumSubjects.length && !programIds.length) {
    throw new Error('Add at least one program on the Program Terms tab before assigning curriculum subjects.');
  }

  const violations = [];
  curriculumSubjects.forEach((row) => {
    const subjectId = toPublicId(row?.subjectId);
    if (!subjectId) return;
    if (!allowedIds.has(subjectId)) {
      const label = String(row?.code || row?.name || subjectId).trim();
      violations.push(label);
    }
  });

  if (violations.length) {
    const sample = violations.slice(0, 5).join(', ');
    const suffix = violations.length > 5 ? ` (+${violations.length - 5} more)` : '';
    throw new Error(
      `Curriculum subject(s) must be assigned to this class's program(s): ${sample}${suffix}.`
    );
  }

  if (options.requireProgramsWhenSubjects && curriculumSubjects.length && allowedIds.size === 0) {
    throw new Error('Selected program(s) have no subjects defined. Add subjects on the Program form first.');
  }
}

module.exports = {
  collectSubjectIdsFromPrograms,
  parseProgramIdsFromQuery,
  resolveProgramsForProgramIds,
  resolveAllowedSubjectIdsForProgramIds,
  collectProgramIdsFromAllowedProgramTerms,
  assertClassCurriculumSubjectsInProgramScope
};
