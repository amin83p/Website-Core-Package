const { toPublicId } = require('../../utils/idAdapter');
const schoolRepositories = require('../../repositories/school');

function addRoleToIndex(index, personId, roleTag) {
  const normalizedId = toPublicId(personId);
  const key = String(normalizedId || '').trim();
  if (!key) return;
  if (!index.has(key)) index.set(key, new Set());
  index.get(key).add(String(roleTag || '').trim().toLowerCase());
}

/**
 * Maps personId to canonical school role tags.
 * Uses the active data backend (JSON files vs Mongo) via school repositories.
 */
async function buildSchoolRoleIndex() {
  const [students, teachers, staffs] = await Promise.all([
    schoolRepositories.students.list({ query: {}, scope: { canViewAll: true } }),
    schoolRepositories.teachers.list({ query: {}, scope: { canViewAll: true } }),
    schoolRepositories.staff.list({ query: {}, scope: { canViewAll: true } })
  ]);

  const index = new Map();
  (Array.isArray(students) ? students : []).forEach((s) => {
    if (String(s?.academicStatus || '').trim().toLowerCase() === 'archived') return;
    addRoleToIndex(index, s?.personId, 'school_student');
  });
  (Array.isArray(teachers) ? teachers : []).forEach((t) => {
    if (String(t?.status || '').trim().toLowerCase() === 'archived') return;
    addRoleToIndex(index, t?.personId, 'school_teacher');
  });
  (Array.isArray(staffs) ? staffs : []).forEach((st) => {
    if (String(st?.status || '').trim().toLowerCase() === 'archived') return;
    addRoleToIndex(index, st?.personId, 'school_staff');
  });
  return index;
}

module.exports = {
  buildSchoolRoleIndex
};
