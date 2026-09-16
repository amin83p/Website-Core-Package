'use strict';

const { requireCoreModule } = require('./schoolCoreModuleResolver');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const schoolDataService = require('./schoolDataService');
const schoolPersonAccessService = require('./schoolPersonAccessService');

function cleanId(value) {
  return String(value || '').trim();
}

function isHardDeletedStudent(row) {
  if (!row || typeof row !== 'object') return true;
  const status = cleanId(row.academicStatus || row.status).toLowerCase();
  return row.deleted === true
    || row.isDeleted === true
    || !!row.deletedAt
    || status === 'deleted'
    || status === 'hard_deleted'
    || status === 'hard-deleted';
}

function mapStudentDuplicateEntry(row) {
  const studentId = toPublicId(row?.id) || cleanId(row?.id);
  return {
    studentId,
    customStudentId: cleanId(row?.customStudentId),
    academicStatus: cleanId(row?.academicStatus) || 'Active',
    enrollmentDate: cleanId(row?.enrollmentDate),
    editUrl: studentId ? `/school/students/edit/${encodeURIComponent(studentId)}` : ''
  };
}

function buildDuplicateStudentProfileGroups(students, orgId) {
  const orgToken = cleanId(orgId);
  if (!orgToken) return [];

  const byPersonId = new Map();
  (Array.isArray(students) ? students : []).forEach((row) => {
    if (!row || typeof row !== 'object' || isHardDeletedStudent(row)) return;
    if (!idsEqual(row.orgId, orgToken)) return;
    const personId = cleanId(row.personId);
    if (!personId) return;
    if (!byPersonId.has(personId)) {
      byPersonId.set(personId, {
        personId,
        students: []
      });
    }
    byPersonId.get(personId).students.push(mapStudentDuplicateEntry(row));
  });

  return Array.from(byPersonId.values()).filter((group) => group.students.length > 1);
}

function groupMatchesSearchQuery(group, q, personLabel = '') {
  const needle = cleanId(q).toLowerCase();
  if (!needle) return true;
  const haystacks = [
    personLabel,
    group?.personId,
    ...(Array.isArray(group?.students) ? group.students.flatMap((row) => [
      row?.studentId,
      row?.customStudentId
    ]) : [])
  ].map((value) => cleanId(value).toLowerCase()).filter(Boolean);
  return haystacks.some((value) => value.includes(needle));
}

function summarizeDuplicateScan({ scannedStudentCount, groups }) {
  const duplicateGroupCount = Array.isArray(groups) ? groups.length : 0;
  const duplicateStudentCount = (Array.isArray(groups) ? groups : []).reduce(
    (sum, group) => sum + (Array.isArray(group?.students) ? group.students.length : 0),
    0
  );
  return {
    duplicateGroupCount,
    duplicateStudentCount,
    scannedStudentCount: Number(scannedStudentCount) || 0
  };
}

async function findDuplicateStudentProfileGroups({ orgId, reqUser, q = '' } = {}) {
  const orgToken = cleanId(orgId);
  if (!orgToken) {
    const error = new Error('Select an active organization before scanning for duplicate student profiles.');
    error.statusCode = 400;
    throw error;
  }

  const allStudents = await schoolDataService.fetchAllData('students', {}, reqUser);
  const orgStudents = (Array.isArray(allStudents) ? allStudents : []).filter(
    (row) => row && idsEqual(row.orgId, orgToken) && !isHardDeletedStudent(row)
  );
  const rawGroups = buildDuplicateStudentProfileGroups(orgStudents, orgToken);
  const personIds = rawGroups.map((group) => group.personId).filter(Boolean);
  const personById = await schoolPersonAccessService.buildPersonByIdMap({
    reqUser,
    personIds
  });

  const enrichedGroups = rawGroups.map((group) => {
    const person = personById.get(group.personId);
    const personLabel = schoolPersonAccessService.formatPersonName(person, group.personId);
    return {
      personId: group.personId,
      personLabel,
      students: [...group.students].sort((left, right) => (
        cleanId(left.studentId).localeCompare(cleanId(right.studentId))
      ))
    };
  });

  const filteredGroups = enrichedGroups
    .filter((group) => groupMatchesSearchQuery(group, q, group.personLabel))
    .sort((left, right) => {
      const nameCmp = cleanId(left.personLabel).localeCompare(cleanId(right.personLabel));
      if (nameCmp !== 0) return nameCmp;
      return cleanId(left.personId).localeCompare(cleanId(right.personId));
    });

  return {
    summary: summarizeDuplicateScan({
      scannedStudentCount: orgStudents.length,
      groups: filteredGroups
    }),
    groups: filteredGroups
  };
}

module.exports = {
  isHardDeletedStudent,
  buildDuplicateStudentProfileGroups,
  groupMatchesSearchQuery,
  summarizeDuplicateScan,
  findDuplicateStudentProfileGroups
};
