const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function normalizeId(value) {
  return String(value || '').trim();
}

function buildTeacherPersonMap(teachers = []) {
  const map = new Map();
  (Array.isArray(teachers) ? teachers : []).forEach((teacher) => {
    const teacherId = normalizeId(teacher?.id);
    const personId = normalizeId(teacher?.personId);
    if (teacherId && personId) {
      map.set(teacherId, personId);
    }
  });
  return map;
}

function resolveTeacherPersonId(rawId, teacherPersonMap = new Map()) {
  const normalized = normalizeId(rawId);
  if (!normalized) return '';
  return normalizeId(teacherPersonMap.get(normalized) || normalized);
}

function sessionDeliveredByMatchesPerson(session, personId, teacherPersonMap = new Map()) {
  const sessionDeliveryTeamService = require('./sessionDeliveryTeamService');
  return sessionDeliveryTeamService.isPersonOnSessionDelivery(session, personId, teacherPersonMap);
}

function collectTeacherRecordIdsForPerson(personId, teacherPersonMap = new Map()) {
  const normalizedPersonId = toPublicId(personId);
  if (!normalizedPersonId) return [];
  const ids = [normalizedPersonId];
  teacherPersonMap.forEach((mappedPersonId, teacherRecordId) => {
    if (idsEqual(mappedPersonId, normalizedPersonId)) {
      ids.push(teacherRecordId);
    }
  });
  return ids;
}

module.exports = {
  buildTeacherPersonMap,
  resolveTeacherPersonId,
  sessionDeliveredByMatchesPerson,
  collectTeacherRecordIdsForPerson
};
