const { requireCoreModule } = require('./schoolCoreContracts');
const accessService = requireCoreModule('MVC/services/security/index');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

function cleanId(value) {
  return String(value || '').trim();
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function buildStudentEditUrl(studentRecordId) {
  const id = cleanId(studentRecordId);
  if (!id) return '';
  return `/school/students/edit/${encodeURIComponent(id)}`;
}

function buildPersonIdToStudentRecordIdMap(students = [], orgId = '') {
  const map = new Map();
  const orgToken = cleanId(orgId);
  (Array.isArray(students) ? students : []).forEach((row) => {
    const personId = cleanId(row?.personId);
    const studentRecordId = cleanId(row?.id);
    if (!personId || !studentRecordId) return;
    if (orgToken && cleanId(row?.orgId) && cleanId(row.orgId) !== orgToken) return;
    if (!map.has(personId)) map.set(personId, studentRecordId);
  });
  return map;
}

function resolveStudentRecordId({ personId = '', studentRecordId = '', personToStudentMap = null } = {}) {
  const explicit = cleanId(studentRecordId);
  if (explicit) return explicit;
  const pid = cleanId(personId);
  if (!pid || !personToStudentMap) return '';
  return cleanId(personToStudentMap.get(pid));
}

async function evaluateCanOpenStudentProfile(user, ipAddress = '') {
  const evalResult = await accessService.evaluateAccess({
    user,
    sectionId: SECTIONS.SCHOOL_STUDENTS,
    operationId: OPERATIONS.UPDATE,
    ipAddress
  });
  return Boolean(evalResult?.allowed);
}

module.exports = {
  escapeHtml,
  buildStudentEditUrl,
  buildPersonIdToStudentRecordIdMap,
  resolveStudentRecordId,
  evaluateCanOpenStudentProfile
};
