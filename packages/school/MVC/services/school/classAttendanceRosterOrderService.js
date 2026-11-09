const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const schoolDataService = require('./schoolDataService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const schoolStudentProfileLinkService = require('./schoolStudentProfileLinkService');
const rollingEnrollmentWorkspaceService = require('./rollingEnrollmentWorkspaceService');

const MAX_ORDER_LENGTH = 500;

function cleanPersonId(value) {
  return toPublicId(value);
}

function normalizeAttendanceRosterPersonOrder(raw) {
  const seen = new Set();
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach((entry) => {
    const personId = cleanPersonId(entry);
    if (!personId || seen.has(personId)) return;
    seen.add(personId);
    out.push(personId);
    if (out.length >= MAX_ORDER_LENGTH) return;
  });
  return out;
}

function buildAttendancePersonOrderMap(order = []) {
  return new Map(
    normalizeAttendanceRosterPersonOrder(order).map((id, index) => [id, index])
  );
}

function compareByAttendancePersonOrder(rowA, rowB, orderMap, { resolvePersonId, nameKey = 'name' } = {}) {
  const resolveId = typeof resolvePersonId === 'function'
    ? resolvePersonId
    : (row) => cleanPersonId(row?.personId);
  const aId = cleanPersonId(resolveId(rowA));
  const bId = cleanPersonId(resolveId(rowB));
  const aOrder = orderMap.has(aId) ? orderMap.get(aId) : Number.MAX_SAFE_INTEGER;
  const bOrder = orderMap.has(bId) ? orderMap.get(bId) : Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;
  const nameA = String(rowA?.[nameKey] || '').trim();
  const nameB = String(rowB?.[nameKey] || '').trim();
  return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
}

function sortByAttendancePersonOrder(rows = [], order = [], options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const orderMap = buildAttendancePersonOrderMap(order);
  if (!orderMap.size) return [...list];
  return [...list].sort((a, b) => compareByAttendancePersonOrder(a, b, orderMap, options));
}

function sortRosterRowsByPersonOrder(rows = [], order = []) {
  return sortByAttendancePersonOrder(rows, order, { nameKey: 'name' });
}

function buildEditorRows({ savedOrder = [], eligibleRows = [] } = {}) {
  const eligible = Array.isArray(eligibleRows) ? eligibleRows : [];
  const eligibleById = new Map(
    eligible.map((row) => [cleanPersonId(row?.personId), row]).filter(([id]) => Boolean(id))
  );
  const normalizedSaved = normalizeAttendanceRosterPersonOrder(savedOrder);
  const used = new Set();
  const ordered = [];

  normalizedSaved.forEach((personId) => {
    const row = eligibleById.get(personId);
    if (!row) return;
    used.add(personId);
    ordered.push(row);
  });

  const remainder = eligible
    .filter((row) => {
      const personId = cleanPersonId(row?.personId);
      return personId && !used.has(personId);
    })
    .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { sensitivity: 'base' }));

  return [...ordered, ...remainder];
}

function normalizeOrderForSave({ order = [], eligiblePersonIdSet = null } = {}) {
  const eligible = eligiblePersonIdSet instanceof Set ? eligiblePersonIdSet : new Set();
  const normalized = normalizeAttendanceRosterPersonOrder(order);
  if (!eligible.size) return normalized;
  return normalized.filter((personId) => {
    for (const candidate of eligible) {
      if (idsEqual(candidate, personId)) return true;
    }
    return false;
  });
}

function resolveOrgToday(reqUser = {}) {
  return String(reqUser?.orgToday || '').trim();
}

function normalizeSortDate(value) {
  const token = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
}

function readPersonFirstName(person = {}) {
  return String(person?.name?.first || person?.firstName || person?.first_name || '').trim();
}

function readPersonLastName(person = {}) {
  return String(person?.name?.last || person?.lastName || person?.last_name || '').trim();
}

function readPersonDateOfBirth(person = {}) {
  return normalizeSortDate(person?.demographics?.dateOfBirth || person?.dateOfBirth);
}

function buildEarliestClassEnrollmentStartByPersonId({
  periodRows = [],
  classId = '',
  studentToPersonMap = new Map(),
  activeOrgId = ''
} = {}) {
  const map = new Map();
  const targetClassId = toPublicId(classId);
  (Array.isArray(periodRows) ? periodRows : []).forEach((row) => {
    if (!idsEqual(row?.classId, targetClassId)) return;
    if (activeOrgId && !idsEqual(row?.orgId, activeOrgId)) return;
    const studentId = toPublicId(row?.studentId);
    if (!studentId) return;
    const personId = cleanPersonId(studentToPersonMap.get(studentId));
    if (!personId) return;
    const start = normalizeSortDate(row?.startDate);
    if (!start) return;
    const existing = map.get(personId);
    if (!existing || start < existing) map.set(personId, start);
  });
  return map;
}

async function listEligibleRosterRowsForToday({
  classData = null,
  reqUser = null,
  students = null,
  persons = null
} = {}) {
  const classId = toPublicId(classData?.id);
  if (!classId || !reqUser) return [];

  const activeOrgId = toPublicId(classData?.orgId || reqUser?.activeOrgId || '');
  const orgToday = resolveOrgToday(reqUser);
  const studentRows = Array.isArray(students)
    ? students
    : [];
  const personRows = Array.isArray(persons)
    ? persons
    : [];

  const studentToPersonMap = rollingEnrollmentWorkspaceService.buildStudentToPersonMap(studentRows, activeOrgId);
  const canonicalStatuses = classEnrollmentReadService.getReportRosterStatusesForClass(classData);

  const enrollmentSnapshot = await classEnrollmentReadService.listPersonIdsOverlappingEnrollmentWindow({
    classId,
    classItem: classData,
    reqUser,
    activeOrgId,
    startDate: orgToday,
    endDate: orgToday,
    orgToday,
    canonicalStatuses,
    studentToPersonMap
  });

  const personIds = enrollmentSnapshot?.personIds instanceof Set ? enrollmentSnapshot.personIds : new Set();
  const personToStudentMap = schoolStudentProfileLinkService.buildPersonIdToStudentRecordIdMap(personRows, activeOrgId);
  const periodRows = await schoolDataService.getClassEnrollmentPeriodsByClassId(classId, reqUser);
  const enrollmentStartByPersonId = buildEarliestClassEnrollmentStartByPersonId({
    periodRows,
    classId,
    studentToPersonMap,
    activeOrgId
  });

  const rows = [];
  personIds.forEach((rawPersonId) => {
    const personId = cleanPersonId(rawPersonId);
    if (!personId) return;
    const person = personRows.find((row) => idsEqual(row?.id, personId)) || null;
    const name = schoolPersonAccessService.formatPersonName(person, '') || 'Unknown Student';
    rows.push({
      personId,
      name,
      firstName: readPersonFirstName(person),
      lastName: readPersonLastName(person),
      dateOfBirth: readPersonDateOfBirth(person),
      enrollmentStartDate: enrollmentStartByPersonId.get(personId) || '',
      studentRecordId: schoolStudentProfileLinkService.resolveStudentRecordId({
        personId,
        personToStudentMap
      })
    });
  });

  rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
  return rows;
}

module.exports = {
  MAX_ORDER_LENGTH,
  normalizeAttendanceRosterPersonOrder,
  buildAttendancePersonOrderMap,
  compareByAttendancePersonOrder,
  sortByAttendancePersonOrder,
  sortRosterRowsByPersonOrder,
  buildEditorRows,
  normalizeOrderForSave,
  listEligibleRosterRowsForToday,
  resolveOrgToday,
  buildEarliestClassEnrollmentStartByPersonId,
  normalizeSortDate
};
