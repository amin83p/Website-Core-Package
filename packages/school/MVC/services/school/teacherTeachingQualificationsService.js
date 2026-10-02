'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { sanitizeTeachingQualifications } = require('../../models/school/teacherModel');

function buildRangeStart(value) {
  return value || '0001-01-01';
}

function buildRangeEnd(value) {
  return value || '9999-12-31';
}

function rangesOverlap(aFrom, aTo, bFrom, bTo) {
  return buildRangeStart(aFrom) <= buildRangeEnd(bTo) && buildRangeStart(bFrom) <= buildRangeEnd(aTo);
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function programsForOrg(programs = [], orgId = '') {
  return (Array.isArray(programs) ? programs : []).filter((row) => {
    if (!orgId) return true;
    return idsEqual(row?.orgId, orgId);
  });
}

function departmentsForOrg(departments = [], orgId = '') {
  return (Array.isArray(departments) ? departments : []).filter((row) => {
    if (!orgId) return true;
    return idsEqual(row?.orgId, orgId);
  });
}

function validateTeachingQualificationsAgainstCatalog(qualifications, { orgId = '', programs = [], departments = [] } = {}) {
  const scopedPrograms = programsForOrg(programs, orgId);
  const scopedDepartments = departmentsForOrg(departments, orgId);
  const deptIds = new Set(scopedDepartments.map((row) => String(row?.id || '').trim()).filter(Boolean));
  const programById = new Map(
    scopedPrograms.map((row) => [String(row?.id || '').trim(), row]).filter(([id]) => id)
  );

  (Array.isArray(qualifications) ? qualifications : []).forEach((row, index) => {
    const label = `Teaching qualification #${index + 1}`;
    const departmentId = String(row?.departmentId || '').trim();
    const programId = String(row?.programId || '').trim();
    if (!deptIds.has(departmentId)) {
      const error = new Error(`${label}: department not found for this organization.`);
      error.statusCode = 400;
      throw error;
    }
    const program = programById.get(programId);
    if (!program) {
      const error = new Error(`${label}: program not found for this organization.`);
      error.statusCode = 400;
      throw error;
    }
    const programDept = String(program?.departmentId || '').trim();
    if (programDept && !idsEqual(programDept, departmentId)) {
      const error = new Error(`${label}: program does not belong to the selected department.`);
      error.statusCode = 400;
      throw error;
    }
  });
}

function validateAndSanitize(rawQualifications, catalogContext = {}) {
  validateTeachingQualificationsAgainstCatalog(rawQualifications, catalogContext);
  return sanitizeTeachingQualifications(rawQualifications);
}

function qualificationActiveInRange(row, startDate = '', endDate = '') {
  const start = normalizeDateOnly(startDate);
  const end = normalizeDateOnly(endDate) || start;
  if (!start) return true;
  return rangesOverlap(row?.effectiveFrom, row?.effectiveTo, start, end);
}

function teacherMatchesQualificationFilter(teacher, { departmentId = '', programId = '', startDate = '', endDate = '' } = {}) {
  const deptFilter = String(departmentId || '').trim();
  const programFilter = String(programId || '').trim();
  if (!deptFilter && !programFilter) return true;
  const rows = Array.isArray(teacher?.teachingQualifications) ? teacher.teachingQualifications : [];
  return rows.some((row) => {
    if (deptFilter && !idsEqual(row?.departmentId, deptFilter)) return false;
    if (programFilter && !idsEqual(row?.programId, programFilter)) return false;
    return qualificationActiveInRange(row, startDate, endDate);
  });
}

function isActiveTeacherRecord(teacher) {
  const status = String(teacher?.status || 'Active').trim();
  return status === 'Active';
}

module.exports = {
  validateAndSanitize,
  validateTeachingQualificationsAgainstCatalog,
  qualificationActiveInRange,
  teacherMatchesQualificationFilter,
  isActiveTeacherRecord,
  rangesOverlap
};
