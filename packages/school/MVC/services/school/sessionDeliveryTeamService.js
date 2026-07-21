const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const teacherIdentityService = require('./teacherIdentityService');

const MAX_CO_TEACHERS = 10;
const DEFAULT_ROLE_LABEL = 'Co-Teacher';

function normalizeId(value) {
  return String(value || '').trim();
}

function cleanPersonId(value) {
  return toPublicId(value) || normalizeId(value);
}

function normalizeRoleLabel(value) {
  const label = normalizeId(value);
  return label || DEFAULT_ROLE_LABEL;
}

function normalizeCoTeacherRow(row = {}, { mainTeacherId = '' } = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const personId = cleanPersonId(row.personId || row.teacherId || row.id || row.deliveredBy);
  if (!personId) return null;
  if (mainTeacherId && idsEqual(personId, mainTeacherId)) return null;
  return {
    personId,
    name: normalizeId(row.name || row.teacherName || row.deliveredByName || personId),
    roleLabel: normalizeRoleLabel(row.roleLabel || row.role || row.title),
    canEdit: row.canEdit === true
  };
}

function normalizeSessionCoTeachers(rawList = [], { mainTeacherId = '' } = {}) {
  const out = [];
  const seen = new Set();
  (Array.isArray(rawList) ? rawList : []).forEach((row) => {
    const normalized = normalizeCoTeacherRow(row, { mainTeacherId });
    if (!normalized) return;
    if (seen.has(normalized.personId)) return;
    seen.add(normalized.personId);
    if (out.length >= MAX_CO_TEACHERS) return;
    out.push(normalized);
  });
  return out;
}

function getSessionMainTeacherId(session = {}) {
  return cleanPersonId(
    session?.delivery?.deliveredBy
    || session?.deliveredBy
    || session?.teacherId
    || session?.instructorId
  );
}

function getSessionCoTeachers(session = {}) {
  const mainTeacherId = getSessionMainTeacherId(session);
  return normalizeSessionCoTeachers(session?.delivery?.coTeachers, { mainTeacherId });
}

function getSessionDeliveryPersonIds(session = {}) {
  const ids = [];
  const mainId = getSessionMainTeacherId(session);
  if (mainId) ids.push(mainId);
  getSessionCoTeachers(session).forEach((row) => {
    if (row.personId && !ids.some((id) => idsEqual(id, row.personId))) {
      ids.push(row.personId);
    }
  });
  return ids;
}

function resolveMappedPersonId(rawId, teacherPersonMap = null) {
  if (teacherPersonMap instanceof Map) {
    return teacherIdentityService.resolveTeacherPersonId(rawId, teacherPersonMap) || cleanPersonId(rawId);
  }
  return cleanPersonId(rawId);
}

function isPersonOnSessionDelivery(session, personId, teacherPersonMap = null) {
  const normalizedPersonId = toPublicId(personId) || cleanPersonId(personId);
  if (!normalizedPersonId || !session) return false;
  return getSessionDeliveryPersonIds(session).some((rawId) => {
    const mapped = resolveMappedPersonId(rawId, teacherPersonMap);
    return mapped ? idsEqual(mapped, normalizedPersonId) : false;
  });
}

function findCoTeacherEntry(session, personId, teacherPersonMap = null) {
  const normalizedPersonId = toPublicId(personId) || cleanPersonId(personId);
  if (!normalizedPersonId) return null;
  return getSessionCoTeachers(session).find((row) => {
    const mapped = resolveMappedPersonId(row.personId, teacherPersonMap);
    return mapped ? idsEqual(mapped, normalizedPersonId) : false;
  }) || null;
}

function isPersonSessionMainTeacher(session, personId, teacherPersonMap = null) {
  const normalizedPersonId = toPublicId(personId) || cleanPersonId(personId);
  if (!normalizedPersonId) return false;
  const mainId = resolveMappedPersonId(getSessionMainTeacherId(session), teacherPersonMap);
  return mainId ? idsEqual(mainId, normalizedPersonId) : false;
}

function isPersonSessionViewer(session, personId, teacherPersonMap = null) {
  return isPersonOnSessionDelivery(session, personId, teacherPersonMap);
}

function isPersonSessionEditor(session, personId, teacherPersonMap = null) {
  if (isPersonSessionMainTeacher(session, personId, teacherPersonMap)) return true;
  const coTeacher = findCoTeacherEntry(session, personId, teacherPersonMap);
  return Boolean(coTeacher && coTeacher.canEdit === true);
}

function applyCoTeachersToDelivery(delivery = {}, coTeachers = [], { mainTeacherId = '' } = {}) {
  const next = delivery && typeof delivery === 'object' ? { ...delivery } : {};
  const resolvedMain = cleanPersonId(mainTeacherId || next.deliveredBy);
  next.coTeachers = normalizeSessionCoTeachers(coTeachers, { mainTeacherId: resolvedMain });
  return next;
}

module.exports = {
  MAX_CO_TEACHERS,
  DEFAULT_ROLE_LABEL,
  normalizeCoTeacherRow,
  normalizeSessionCoTeachers,
  getSessionMainTeacherId,
  getSessionCoTeachers,
  getSessionDeliveryPersonIds,
  isPersonOnSessionDelivery,
  isPersonSessionMainTeacher,
  isPersonSessionViewer,
  isPersonSessionEditor,
  findCoTeacherEntry,
  applyCoTeachersToDelivery
};
