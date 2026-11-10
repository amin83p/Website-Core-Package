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

const OPEN_END_SORT_SENTINEL = '9999-99-99';
const NICKNAME_MAX_LENGTH = 60;

function enrollmentPeriodIncludesDate(periodStart, periodEnd, dateValue) {
  const day = normalizeSortDate(dateValue);
  if (!day) return false;
  const pStart = normalizeSortDate(periodStart);
  if (!pStart) return false;
  const pEnd = normalizeSortDate(periodEnd) || '9999-12-31';
  return pStart <= day && pEnd >= day;
}

function readPersonLegalName(person = {}) {
  const first = readPersonFirstName(person);
  const last = readPersonLastName(person);
  const legal = [first, last].filter(Boolean).join(' ').trim();
  if (legal) return legal;
  return String(
    person?.organizationProfile?.legalName
    || person?.organizationLegalName
    || person?.displayName
    || ''
  ).trim();
}

function formatRosterNameWithNickname({ legalName = '', nickname = '', wrap = true } = {}) {
  const legal = String(legalName || '').trim();
  const nick = String(nickname || '').trim();
  if (!nick) return legal;
  if (!legal) return nick;
  return wrap ? `${legal} (${nick})` : `${legal} ${nick}`;
}

function normalizeAttendanceRosterNicknames(raw) {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  let count = 0;
  Object.entries(raw).forEach(([key, value]) => {
    const personId = cleanPersonId(key);
    const nickname = String(value ?? '').trim().slice(0, NICKNAME_MAX_LENGTH);
    if (!personId || !nickname || out[personId]) return;
    out[personId] = nickname;
    count += 1;
    if (count >= MAX_ORDER_LENGTH) return;
  });
  return out;
}

function normalizeNicknamesForSave({ nicknames = {}, eligiblePersonIdSet = null } = {}) {
  const eligible = eligiblePersonIdSet instanceof Set ? eligiblePersonIdSet : new Set();
  const normalized = normalizeAttendanceRosterNicknames(nicknames);
  if (!eligible.size) return normalized;
  const out = {};
  Object.entries(normalized).forEach(([personId, nickname]) => {
    for (const candidate of eligible) {
      if (idsEqual(candidate, personId)) {
        out[personId] = nickname;
        break;
      }
    }
  });
  return out;
}

function buildRosterNicknameMapForPersonIds(rosterNicknames = {}, personIds = []) {
  const source = normalizeAttendanceRosterNicknames(rosterNicknames);
  const map = {};
  (Array.isArray(personIds) ? personIds : []).forEach((rawId) => {
    const personId = cleanPersonId(rawId);
    if (!personId || !source[personId]) return;
    map[personId] = source[personId];
  });
  return map;
}

function enrichStudentListWithRosterNicknames(studentList = [], classData = {}, personById = new Map()) {
  const rosterNicknames = normalizeAttendanceRosterNicknames(classData?.attendanceRosterNicknames);
  const list = (Array.isArray(studentList) ? studentList : []).map((row) => {
    const personId = cleanPersonId(row?.personId);
    const person = personById instanceof Map ? personById.get(String(personId || '')) : null;
    const legalName = readPersonLegalName(person)
      || String(row?.legalName || row?.name || '').trim();
    const rosterNickname = personId ? String(rosterNicknames[personId] || '').trim() : '';
    return {
      ...row,
      personId,
      legalName,
      rosterNickname,
      name: legalName || String(row?.name || '').trim()
    };
  });
  return { studentList: list, rosterNicknames };
}

function decorateRowWithRosterNickname(row = {}, rosterNicknames = {}, options = {}) {
  const personId = cleanPersonId(row?.personId);
  const nickname = personId ? String(rosterNicknames[personId] || '').trim() : '';
  const legalName = String(
    row?.legalName
    || (options.preferLegal !== false && row?.name && !nickname ? row.name : '')
    || row?.name
    || ''
  ).trim();
  const next = {
    ...row,
    legalName: legalName || String(row?.name || '').trim(),
    rosterNickname: nickname
  };
  if (options.applyDisplayName !== false) {
    next.name = formatRosterNameWithNickname({
      legalName: next.legalName,
      nickname,
      wrap: options.wrapNickname !== false
    }) || next.legalName;
  }
  return next;
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

function buildSoonestClassEnrollmentEndByPersonId({
  periodRows = [],
  classId = '',
  studentToPersonMap = new Map(),
  activeOrgId = '',
  orgToday = ''
} = {}) {
  const map = new Map();
  const targetClassId = toPublicId(classId);
  const today = normalizeSortDate(orgToday);
  (Array.isArray(periodRows) ? periodRows : []).forEach((row) => {
    if (!idsEqual(row?.classId, targetClassId)) return;
    if (activeOrgId && !idsEqual(row?.orgId, activeOrgId)) return;
    if (today && !enrollmentPeriodIncludesDate(row?.startDate, row?.endDate, today)) return;
    const studentId = toPublicId(row?.studentId);
    if (!studentId) return;
    const personId = cleanPersonId(studentToPersonMap.get(studentId));
    if (!personId) return;
    const end = normalizeSortDate(row?.endDate) || OPEN_END_SORT_SENTINEL;
    const existing = map.get(personId);
    if (!existing || end < existing) map.set(personId, end);
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
  const enrollmentEndByPersonId = buildSoonestClassEnrollmentEndByPersonId({
    periodRows,
    classId,
    studentToPersonMap,
    activeOrgId,
    orgToday
  });
  const rosterNicknames = normalizeAttendanceRosterNicknames(classData?.attendanceRosterNicknames);

  const rows = [];
  personIds.forEach((rawPersonId) => {
    const personId = cleanPersonId(rawPersonId);
    if (!personId) return;
    const person = personRows.find((row) => idsEqual(row?.id, personId)) || null;
    const legalName = readPersonLegalName(person) || schoolPersonAccessService.formatPersonName(person, '') || 'Unknown Student';
    rows.push({
      personId,
      name: legalName,
      legalName,
      nickname: rosterNicknames[personId] || '',
      firstName: readPersonFirstName(person),
      lastName: readPersonLastName(person),
      dateOfBirth: readPersonDateOfBirth(person),
      enrollmentStartDate: enrollmentStartByPersonId.get(personId) || '',
      enrollmentEndDate: enrollmentEndByPersonId.get(personId) || '',
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
  buildSoonestClassEnrollmentEndByPersonId,
  normalizeSortDate,
  OPEN_END_SORT_SENTINEL,
  normalizeAttendanceRosterNicknames,
  normalizeNicknamesForSave,
  readPersonLegalName,
  formatRosterNameWithNickname,
  buildRosterNicknameMapForPersonIds,
  decorateRowWithRosterNickname,
  enrichStudentListWithRosterNicknames,
  enrollmentPeriodIncludesDate
};
