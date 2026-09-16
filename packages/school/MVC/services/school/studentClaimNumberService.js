'use strict';

const schoolRepositories = require('../../repositories/school');
const schoolDataService = require('./schoolDataService');
const studentModel = require('../../models/school/studentModel');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

let dependencies = {
  schoolRepositories,
  schoolDataService
};

function listClaimsForStudent(student) {
  try {
    return studentModel.cleanClaimNumbers(student?.claimNumbers);
  } catch (_) {
    return [];
  }
}

function resolveClaimFromStudent(student, claimNumberId) {
  const id = toPublicId(claimNumberId);
  if (!id || !student) return null;
  const row = listClaimsForStudent(student).find((entry) => idsEqual(entry?.id, id));
  if (!row) return null;
  return {
    id: String(row.id || '').trim(),
    number: String(row.number || '').trim(),
    label: String(row.label || '').trim()
  };
}

function findClaimByNumber(student, claimNumber) {
  const token = String(claimNumber || '').trim();
  if (!token || !student) return null;
  const matches = listClaimsForStudent(student).filter((entry) => String(entry?.number || '').trim() === token);
  if (matches.length !== 1) return null;
  return matches[0];
}

function applyClaimLinkToPeriodInput({
  student,
  claimNumberId = '',
  legacyClaimNumber = ''
} = {}) {
  const linkedId = String(claimNumberId || '').trim();
  if (linkedId) {
    const resolved = resolveClaimFromStudent(student, linkedId);
    if (!resolved) throw new Error('Selected claim number is not on this student profile.');
    return { claimNumberId: resolved.id, claimNumber: resolved.number };
  }
  const legacy = String(legacyClaimNumber || '').trim();
  if (!legacy) return { claimNumberId: '', claimNumber: '' };
  const matched = findClaimByNumber(student, legacy);
  if (matched) {
    return {
      claimNumberId: String(matched.id || '').trim(),
      claimNumber: String(matched.number || '').trim()
    };
  }
  return { claimNumberId: '', claimNumber: legacy };
}

function enrichPeriodClaimFields(period, student) {
  const base = period && typeof period === 'object' ? { ...period } : {};
  const claimNumberId = toPublicId(base.claimNumberId);
  if (claimNumberId && student) {
    const resolved = resolveClaimFromStudent(student, claimNumberId);
    if (resolved) {
      base.claimNumberId = resolved.id;
      base.claimNumber = resolved.number;
      return base;
    }
  }
  return base;
}

function periodReferencesClaim(period, claimRef = {}) {
  const claimId = toPublicId(claimRef?.id || claimRef?.claimId);
  const claimNumber = String(claimRef?.number || claimRef?.claimNumber || '').trim();
  const periodId = toPublicId(period?.claimNumberId);
  if (claimId && periodId && idsEqual(periodId, claimId)) return true;
  if (!periodId && claimNumber) {
    return String(period?.claimNumber || '').trim() === claimNumber;
  }
  return false;
}

async function loadClassTitleMap(classIds = [], reqUser, options = {}) {
  const map = new Map();
  const ids = [...new Set((Array.isArray(classIds) ? classIds : []).map((id) => toPublicId(id)).filter(Boolean))];
  await Promise.all(ids.map(async (classId) => {
    const row = await dependencies.schoolDataService.getDataById('classes', classId, reqUser, options);
    if (!row) return;
    map.set(classId, String(row?.title || row?.name || classId).trim());
  }));
  return map;
}

function buildUsageRow(period, classTitle = '') {
  return {
    periodId: toPublicId(period?.id),
    classId: toPublicId(period?.classId),
    classTitle: String(classTitle || period?.classId || '').trim(),
    status: String(period?.status || '').trim(),
    startDate: String(period?.startDate || '').trim(),
    endDate: String(period?.endDate || '').trim()
  };
}

async function findClaimUsagesForStudent({
  studentId,
  removedClaims = [],
  reqUser,
  options = {}
} = {}) {
  const normalizedStudentId = toPublicId(studentId);
  if (!normalizedStudentId) return [];
  const claims = (Array.isArray(removedClaims) ? removedClaims : []).map((row) => ({
    id: String(row?.id || '').trim(),
    number: String(row?.number || '').trim(),
    label: String(row?.label || '').trim()
  })).filter((row) => row.id || row.number);
  if (!claims.length) return [];

  const periods = await dependencies.schoolRepositories.classEnrollmentPeriods.findByStudentId(
    normalizedStudentId,
    options
  );
  const classTitleMap = await loadClassTitleMap(
    (Array.isArray(periods) ? periods : []).map((row) => row?.classId),
    reqUser,
    options
  );

  const blockers = [];
  claims.forEach((claim) => {
    const usages = (Array.isArray(periods) ? periods : [])
      .filter((period) => periodReferencesClaim(period, claim))
      .map((period) => buildUsageRow(period, classTitleMap.get(toPublicId(period?.classId))));
    if (!usages.length) return;
    blockers.push({
      code: 'CLAIM_NUMBER_IN_USE',
      claimId: claim.id,
      claimNumber: claim.number,
      label: claim.label,
      usages
    });
  });
  return blockers;
}

function detectRemovedClaims(previousClaims = [], nextClaims = []) {
  const prev = studentModel.cleanClaimNumbers(previousClaims);
  const next = studentModel.cleanClaimNumbers(nextClaims);
  const nextIds = new Set(next.map((row) => String(row.id || '').trim()).filter(Boolean));
  return prev.filter((row) => {
    const id = String(row.id || '').trim();
    return id && !nextIds.has(id);
  });
}

async function backfillClaimNumberIdsForStudent(studentId, reqUser, options = {}) {
  const normalizedStudentId = toPublicId(studentId);
  if (!normalizedStudentId) return { updated: 0 };
  const student = await dependencies.schoolDataService.getDataById('students', normalizedStudentId, reqUser, options);
  if (!student) return { updated: 0 };

  const periods = await dependencies.schoolRepositories.classEnrollmentPeriods.findByStudentId(
    normalizedStudentId,
    options
  );
  let updated = 0;
  for (const period of Array.isArray(periods) ? periods : []) {
    if (toPublicId(period?.claimNumberId)) continue;
    const legacyNumber = String(period?.claimNumber || '').trim();
    if (!legacyNumber) continue;
    const matched = findClaimByNumber(student, legacyNumber);
    if (!matched?.id) continue;
    await dependencies.schoolRepositories.classEnrollmentPeriods.update(
      toPublicId(period.id),
      {
        claimNumberId: String(matched.id).trim(),
        claimNumber: String(matched.number || legacyNumber).trim()
      },
      options
    );
    updated += 1;
  }
  return { updated };
}

async function resolveEnrollmentClaimFieldsForStudent(studentId, input = {}, reqUser, options = {}) {
  const normalizedStudentId = toPublicId(studentId);
  if (!normalizedStudentId) {
    return {
      claimNumberId: String(input.claimNumberId || '').trim(),
      claimNumber: String(input.claimNumber || '').trim()
    };
  }
  const student = await dependencies.schoolDataService.getDataById(
    'students',
    normalizedStudentId,
    reqUser,
    options
  );
  if (!student) {
    throw new Error('Student not found for claim number resolution.');
  }
  const linkedId = input.claimNumberId !== undefined
    ? String(input.claimNumberId || '').trim()
    : '';
  const legacyNumber = input.claimNumber !== undefined
    ? String(input.claimNumber || '').trim()
    : '';
  if (!linkedId && !legacyNumber) {
    return { claimNumberId: '', claimNumber: '' };
  }
  return applyClaimLinkToPeriodInput({
    student,
    claimNumberId: linkedId,
    legacyClaimNumber: legacyNumber
  });
}

function __setDependenciesForTest(nextDeps = {}) {
  dependencies = { ...dependencies, ...nextDeps };
}

function __resetDependenciesForTest() {
  dependencies = {
    schoolRepositories,
    schoolDataService
  };
}

module.exports = {
  listClaimsForStudent,
  resolveClaimFromStudent,
  findClaimByNumber,
  applyClaimLinkToPeriodInput,
  enrichPeriodClaimFields,
  findClaimUsagesForStudent,
  detectRemovedClaims,
  backfillClaimNumberIdsForStudent,
  resolveEnrollmentClaimFieldsForStudent,
  __setDependenciesForTest,
  __resetDependenciesForTest
};
