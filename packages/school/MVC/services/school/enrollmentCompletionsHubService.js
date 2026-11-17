const schoolDataService = require('./schoolDataService');
const weeklyReportsHubService = require('./weeklyReportsHubService');
const sessionEnrollmentContextService = require('./sessionEnrollmentContextService');
const classEnrollmentPeriodProgressService = require('./classEnrollmentPeriodProgressService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const schoolStudentProfileLinkService = require('./schoolStudentProfileLinkService');
const studentAttendanceReportClassOrderService = require('./studentAttendanceReportClassOrderService');
const rollingEnrollmentFunderService = require('./rollingEnrollmentFunderService');
const studentClaimNumberService = require('./studentClaimNumberService');
const scheduleEnrollStudentsService = require('./scheduleEnrollStudentsService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const CLB_SKILL_CODES = Object.freeze([
  ['listening', 'L'],
  ['speaking', 'S'],
  ['reading', 'R'],
  ['writing', 'W']
]);

const EXCLUDED_PERIOD_STATUSES = new Set([
  'draft',
  'planned',
  'to_be_confirmed',
  'waiting_list',
  'cancelled',
  'archived',
  'error',
  'void',
  'voided',
  'rolled_back'
]);

function hubError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(token);
  return match ? match[1] : '';
}

function parseMonthKey(monthValue = '') {
  const token = String(monthValue || '').trim();
  const match = /^(\d{4})-(\d{2})$/.exec(token);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  const monthStart = `${match[1]}-${match[2]}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEnd = `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`;
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
  return { monthKey: token, monthStart, monthEnd, monthLabel };
}

function dateInMonth(dateOnly, monthKey) {
  const date = normalizeDateOnly(dateOnly);
  if (!date || !monthKey) return false;
  return date.slice(0, 7) === String(monthKey).trim();
}

function isRollingClass(classRow = {}) {
  return String(classRow?.registrationMode || '').trim().toLowerCase() === 'rolling';
}

function isIncludedPeriodStatus(period = {}) {
  const status = String(period?.status || '').trim().toLowerCase();
  if (!status) return false;
  return !EXCLUDED_PERIOD_STATUSES.has(status);
}

function formatTeacherNames(classRow = {}, personNameById = new Map()) {
  const instructors = (Array.isArray(classRow?.instructors) ? classRow.instructors : [])
    .filter((row) => weeklyReportsHubService.isActiveClassInstructor(row));
  const names = instructors.map((row) => {
    const personId = toPublicId(row?.personId);
    const fromMap = personId ? String(personNameById.get(personId) || '').trim() : '';
    if (fromMap) return fromMap;
    return String(row?.name || row?.displayName || '').trim();
  }).filter(Boolean);
  return names.length ? names.join(', ') : 'Unassigned';
}

function buildEnrollmentPeriodNotes({
  period = {},
  periodRows = [],
  effectiveFinish = '',
  studentPersonId = '',
  studentToPersonMap = new Map()
} = {}) {
  const parts = [];
  const resolvePerson = classEnrollmentSessionApplicabilityService.resolveStudentPersonId;
  const periodId = toPublicId(period?.id);

  if (period?.enrollmentKind === 'extension' || period?.extensionOfPeriodId) {
    parts.push('Extension enrollment');
  }

  (Array.isArray(periodRows) ? periodRows : []).forEach((row) => {
    if (!idsEqual(row?.extensionOfPeriodId, periodId)) return;
    if (idsEqual(row?.id, periodId)) return;
    const label = String(row?.enrollmentKind || 'extension').trim();
    parts.push(`Linked extension (${label}) starting ${normalizeDateOnly(row?.startDate) || '—'}`);
  });

  (Array.isArray(periodRows) ? periodRows : []).forEach((row) => {
    if (idsEqual(row?.id, periodId)) return;
    if (!idsEqual(resolvePerson(row, studentToPersonMap), studentPersonId)) return;
    const start = normalizeDateOnly(row?.startDate);
    if (!start || !effectiveFinish || start <= effectiveFinish) return;
    const kind = String(row?.enrollmentKind || row?.status || 'enrollment').trim();
    parts.push(`Follow-on: ${start} (${kind})`);
  });

  const reasonStart = String(period?.reasonStart || '').trim();
  if (reasonStart) parts.push(reasonStart);
  const notes = String(period?.notes || '').trim();
  if (notes) parts.push(notes.slice(0, 200));

  return parts.join('; ');
}

function buildEnrollmentNewEnrollmentSummary({
  period = {},
  periodRows = [],
  effectiveFinish = '',
  studentPersonId = '',
  studentToPersonMap = new Map(),
  sessions = [],
  statusMap = {}
} = {}) {
  const resolvePerson = classEnrollmentSessionApplicabilityService.resolveStudentPersonId;
  const periodId = toPublicId(period?.id);
  const followOns = [];

  (Array.isArray(periodRows) ? periodRows : []).forEach((row) => {
    if (idsEqual(row?.id, periodId)) return;
    if (!idsEqual(resolvePerson(row, studentToPersonMap), studentPersonId)) return;
    const start = normalizeDateOnly(row?.startDate);
    if (!start || !effectiveFinish || start <= effectiveFinish) return;
    const end = sessionEnrollmentContextService.resolveExpectedFinishDate({
      period: row,
      sessions,
      statusMap,
      enrichedPeriodRow: row
    }) || normalizeDateOnly(row?.endDate) || '—';
    followOns.push({ start, end });
  });

  if (!followOns.length) return '—';
  return followOns
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    .map((row) => `${row.start} – ${row.end}`)
    .join('; ');
}

function looksLikeOpaqueId(value = '') {
  const token = String(value || '').trim();
  if (!token) return false;
  return /^(PERSON|STU|USER|TEA)\//i.test(token);
}

function formatClbSkillLevels(skills = {}) {
  const parts = [];
  CLB_SKILL_CODES.forEach(([key, letter]) => {
    const value = String(skills?.[key] || '').trim();
    if (value) parts.push(`${letter}${value}`);
  });
  return parts.join(' ');
}

function formatClbGoalCurrentLabel(entry = null) {
  const fields = formatClbGoalCurrentFields(entry);
  if (fields.clbGoalLabel === '—' && fields.clbCurrentLabel === '—') return '—';
  return [fields.clbGoalLabel, fields.clbCurrentLabel].filter((line) => line !== '—').join('\n');
}

function formatClbGoalCurrentFields(entry = null) {
  if (!entry || typeof entry !== 'object') {
    return { clbGoalLabel: '—', clbCurrentLabel: '—' };
  }
  const goalText = formatClbSkillLevels(entry.goal || {});
  const currentText = formatClbSkillLevels(entry.current || {});
  return {
    clbGoalLabel: goalText ? `Goal: ${goalText}` : '—',
    clbCurrentLabel: currentText ? `Current: ${currentText}` : '—'
  };
}

function formatStudentRecordDisplayName(student = null) {
  if (!student || typeof student !== 'object') return '';
  const displayName = String(student.displayName || '').trim();
  if (displayName && !looksLikeOpaqueId(displayName)) return displayName;
  const name = student.name;
  if (typeof name === 'string' && name.trim() && !looksLikeOpaqueId(name)) return name.trim();
  if (name && typeof name === 'object') {
    const full = `${String(name.first || '').trim()} ${String(name.last || '').trim()}`.trim();
    if (full) return full;
  }
  const fromPersonFormatter = schoolPersonAccessService.formatPersonName(student, '');
  if (fromPersonFormatter && !looksLikeOpaqueId(fromPersonFormatter)) return fromPersonFormatter;
  return '';
}

function getLatestClbLevelEntry(studentRecord = {}) {
  const history = Array.isArray(studentRecord?.clbLevelHistory) ? studentRecord.clbLevelHistory : [];
  const sorted = [...history].sort((a, b) => {
    const dateCmp = String(b?.recordedAt || '').localeCompare(String(a?.recordedAt || ''));
    if (dateCmp !== 0) return dateCmp;
    return String(b?.id || '').localeCompare(String(a?.id || ''));
  });
  return sorted[0] || null;
}

function buildStudentsByPersonId(students = []) {
  const map = new Map();
  (Array.isArray(students) ? students : []).forEach((row) => {
    const personId = toPublicId(row?.personId);
    if (personId) map.set(personId, row);
  });
  return map;
}

function buildStudentsByRecordId(students = []) {
  const map = new Map();
  (Array.isArray(students) ? students : []).forEach((row) => {
    const studentId = toPublicId(row?.id || row?.studentId);
    if (studentId) map.set(studentId, row);
  });
  return map;
}

function resolveStudentDisplayName({
  studentPersonId = '',
  studentRecord = null,
  personNameById = new Map(),
  period = {}
} = {}) {
  const pid = toPublicId(studentPersonId);
  const mapped = pid ? String(personNameById.get(pid) || '').trim() : '';
  if (mapped && !looksLikeOpaqueId(mapped)) return mapped;
  const fromStudent = formatStudentRecordDisplayName(studentRecord);
  if (fromStudent) return fromStudent;
  const periodName = String(period?.studentName || period?.studentDisplayName || '').trim();
  if (periodName && !looksLikeOpaqueId(periodName)) return periodName;
  if (periodName) return periodName;
  return 'Unknown student';
}

function resolveClassDaypartLabel(classRow = {}, sessions = []) {
  const className = String(classRow?.title || classRow?.name || classRow?.className || '').trim();
  const sortRow = studentAttendanceReportClassOrderService.attachScheduleSortFields(
    { className },
    Array.isArray(sessions) ? sessions : []
  );
  const { DAYPART_RANK } = studentAttendanceReportClassOrderService;
  const rank = Number(sortRow?.daypartRank);
  if (rank === DAYPART_RANK.AM) return 'AM';
  if (rank === DAYPART_RANK.PM) return 'PM';
  const inferred = studentAttendanceReportClassOrderService.inferDaypartRankFromClassName(className);
  if (inferred === DAYPART_RANK.AM) return 'AM';
  if (inferred === DAYPART_RANK.PM) return 'PM';
  return '';
}

function enrollmentActiveOnFinishDate(entry = {}, effectiveFinish = '') {
  const finish = normalizeDateOnly(effectiveFinish);
  if (!finish) return true;
  const start = normalizeDateOnly(entry?.startDate);
  const end = normalizeDateOnly(
    entry?.effectiveEnd
      || entry?.period?.completionDate
      || entry?.period?.endDate
  );
  if (start && finish < start) return false;
  if (end && finish > end) return false;
  return true;
}

function resolveAmPmEnrollmentTeachers(
  studentPersonId = '',
  studentClassPeriods = [],
  personNameById = new Map(),
  anchor = {}
) {
  const pid = toPublicId(studentPersonId);
  const effectiveFinish = normalizeDateOnly(anchor?.effectiveFinish);
  const anchorClassId = toPublicId(anchor?.classId);
  const anchorPeriodId = toPublicId(anchor?.enrollmentPeriodId);

  let entries = (Array.isArray(studentClassPeriods) ? studentClassPeriods : [])
    .filter((row) => idsEqual(row?.studentPersonId, pid));
  if (effectiveFinish) {
    entries = entries.filter((row) => enrollmentActiveOnFinishDate(row, effectiveFinish));
  }

  const sorted = [...entries].sort((a, b) => {
    const byStart = String(a?.startDate || '').localeCompare(String(b?.startDate || ''));
    if (byStart !== 0) return byStart;
    return String(a?.className || '').localeCompare(String(b?.className || ''));
  });

  let amEntry = null;
  let pmEntry = null;

  const anchorEntry = sorted.find((row) => idsEqual(row?.classId, anchorClassId)
    && (!anchorPeriodId || idsEqual(row?.period?.id, anchorPeriodId)))
    || sorted.find((row) => idsEqual(row?.classId, anchorClassId));

  if (anchorEntry) {
    const sessions = Array.isArray(anchorEntry?.sessions) ? anchorEntry.sessions : [];
    const daypart = resolveClassDaypartLabel(anchorEntry?.classRow || {}, sessions);
    if (daypart === 'AM') amEntry = anchorEntry;
    if (daypart === 'PM') pmEntry = anchorEntry;
  }

  sorted.forEach((entry) => {
    if (anchorEntry && idsEqual(entry?.classId, anchorEntry?.classId)
      && idsEqual(entry?.period?.id, anchorEntry?.period?.id)) return;
    const sessions = Array.isArray(entry?.sessions) ? entry.sessions : [];
    const daypart = resolveClassDaypartLabel(entry?.classRow || {}, sessions);
    if (daypart === 'AM' && !amEntry) amEntry = entry;
    if (daypart === 'PM' && !pmEntry) pmEntry = entry;
  });

  if (!amEntry || !pmEntry) {
    sorted.forEach((entry, index) => {
      if (amEntry && pmEntry) return;
      if (anchorEntry && idsEqual(entry?.classId, anchorEntry?.classId)
        && idsEqual(entry?.period?.id, anchorEntry?.period?.id)) return;
      const sessions = Array.isArray(entry?.sessions) ? entry.sessions : [];
      const daypart = resolveClassDaypartLabel(entry?.classRow || {}, sessions);
      if (daypart) return;
      if (!amEntry && index === 0) amEntry = entry;
      else if (!pmEntry && index === 1) pmEntry = entry;
    });
  }

  return {
    teacherAmNames: amEntry ? formatTeacherNames(amEntry.classRow, personNameById) : '—',
    teacherPmNames: pmEntry ? formatTeacherNames(pmEntry.classRow, personNameById) : '—'
  };
}

function buildPersonNameMap(students = [], persons = [], teachers = []) {
  const map = new Map();
  (Array.isArray(persons) ? persons : []).forEach((row) => {
    const id = toPublicId(row?.id);
    if (!id) return;
    const name = schoolPersonAccessService.formatPersonName(row, '');
    if (name && !looksLikeOpaqueId(name)) map.set(id, name);
  });
  (Array.isArray(students) ? students : []).forEach((row) => {
    const personId = toPublicId(row?.personId);
    if (!personId) return;
    const fromStudent = formatStudentRecordDisplayName(row);
    if (fromStudent) {
      map.set(personId, fromStudent);
      return;
    }
    const name = schoolPersonAccessService.formatPersonName(row, '');
    if (name && !looksLikeOpaqueId(name)) map.set(personId, name);
  });
  (Array.isArray(teachers) ? teachers : []).forEach((row) => {
    const personId = toPublicId(row?.personId);
    if (!personId) return;
    const name = schoolPersonAccessService.formatPersonName(row, '');
    if (name && !looksLikeOpaqueId(name)) map.set(personId, name);
  });
  return map;
}

async function buildEnrollmentCompletionsPersonNameMap(reqUser, students = [], persons = [], teachers = []) {
  const syncMap = buildPersonNameMap(students, persons, teachers);
  const personIds = new Set([...syncMap.keys()]);
  (Array.isArray(students) ? students : []).forEach((row) => {
    const personId = toPublicId(row?.personId);
    if (personId) personIds.add(personId);
  });

  if (!personIds.size) return syncMap;

  const personById = await schoolPersonAccessService.buildPersonByIdMap({
    reqUser,
    personIds: [...personIds]
  });

  const map = new Map(syncMap);
  personIds.forEach((pid) => {
    if (map.has(pid)) {
      const existing = String(map.get(pid) || '').trim();
      if (existing && !looksLikeOpaqueId(existing)) return;
    }
    const fromPerson = schoolPersonAccessService.formatPersonName(personById.get(pid) || {}, '');
    if (fromPerson && !looksLikeOpaqueId(fromPerson)) {
      map.set(pid, fromPerson);
      return;
    }
    const studentRow = (Array.isArray(students) ? students : []).find((row) => idsEqual(row?.personId, pid));
    const fromStudent = formatStudentRecordDisplayName(studentRow);
    if (fromStudent) map.set(pid, fromStudent);
  });
  return map;
}

function buildFunderGroupKey(funderId = '', funderType = '') {
  const normalized = rollingEnrollmentFunderService.normalizeEnrollmentFunderSelection({ funderId, funderType });
  if (normalized.funderType === 'self' || rollingEnrollmentFunderService.isSelfFund(normalized.funderId)) {
    return 'self';
  }
  const id = toPublicId(normalized.funderId) || String(normalized.funderId || '').trim();
  return id ? `funder:${id}` : 'self';
}

async function buildFunderLabelByIdMap(activeOrgId = '', reqUser = null) {
  const activeFunders = await scheduleEnrollStudentsService.loadActiveFunderOptions(reqUser, activeOrgId).catch(() => []);
  const map = new Map();
  (Array.isArray(activeFunders) ? activeFunders : []).forEach((row) => {
    const id = toPublicId(row?.id);
    if (!id) return;
    const label = String(row?.label || id).trim();
    map.set(id, label);
    const rawId = String(row?.id || '').trim();
    if (rawId && !idsEqual(rawId, id)) map.set(rawId, label);
  });
  return map;
}

function resolveClaimNumberDisplay(period = {}, studentRecord = null) {
  const enriched = studentClaimNumberService.enrichPeriodClaimFields(period, studentRecord);
  return String(enriched?.claimNumber || period?.claimNumber || '').trim();
}

function buildFunderGroupsFromRows(rows = []) {
  const byKey = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = String(row?.funderGroupKey || 'self').trim() || 'self';
    if (!byKey.has(key)) {
      byKey.set(key, {
        funderGroupKey: key,
        funderLabel: String(row?.funderLabel || 'Self Fund').trim() || 'Self Fund',
        funderType: String(row?.funderType || 'self').trim() || 'self',
        rowCount: 0
      });
    }
    byKey.get(key).rowCount += 1;
  });
  const groups = [...byKey.values()];
  groups.sort((a, b) => {
    if (a.funderGroupKey === 'self' && b.funderGroupKey !== 'self') return -1;
    if (b.funderGroupKey === 'self' && a.funderGroupKey !== 'self') return 1;
    return String(a.funderLabel || '').localeCompare(String(b.funderLabel || ''), undefined, { sensitivity: 'base' });
  });
  return groups;
}

function consolidateEnrollmentCompletionRows(rows = []) {
  const byBucket = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const pid = toPublicId(row?.studentPersonId);
    const funderKey = String(row?.funderGroupKey || 'self').trim() || 'self';
    if (!pid) return;
    const bucketKey = `${pid}|${funderKey}`;
    if (!byBucket.has(bucketKey)) byBucket.set(bucketKey, []);
    byBucket.get(bucketKey).push(row);
  });

  const consolidated = [];
  byBucket.forEach((studentRows) => {
    const finishDates = [...new Set(
      studentRows
        .map((row) => normalizeDateOnly(row?.enrollmentFinishDate))
        .filter(Boolean)
    )].sort();
    if (!finishDates.length) return;

    const representative = [...studentRows].sort((a, b) => String(a?.enrollmentFinishDate || '')
      .localeCompare(String(b?.enrollmentFinishDate || '')))[0];
    const primaryFinish = finishDates.length === 1 ? finishDates[0] : '';

    consolidated.push({
      ...representative,
      enrollmentFinishDate: primaryFinish,
      enrollmentFinishDates: finishDates
    });
  });
  return consolidated;
}

function sortCompletionRows(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const nameCompare = String(a?.studentName || '').localeCompare(String(b?.studentName || ''));
    if (nameCompare !== 0) return nameCompare;
    const dateA = String(a?.enrollmentFinishDate || (Array.isArray(a?.enrollmentFinishDates) ? a.enrollmentFinishDates[0] : '') || '');
    const dateB = String(b?.enrollmentFinishDate || (Array.isArray(b?.enrollmentFinishDates) ? b.enrollmentFinishDates[0] : '') || '');
    const dateCompare = dateA.localeCompare(dateB);
    if (dateCompare !== 0) return dateCompare;
    return String(a?.className || '').localeCompare(String(b?.className || ''));
  });
}

function filterProgramOptionsByDepartments(programCatalog = [], departmentIds = []) {
  const normalizedDepartmentIds = weeklyReportsHubService.parseFilterIdList(departmentIds);
  if (!normalizedDepartmentIds.length) return [];
  const deptSet = new Set(normalizedDepartmentIds.map((id) => toPublicId(id)).filter(Boolean));
  return (Array.isArray(programCatalog) ? programCatalog : []).filter((row) => {
    const programDeptId = toPublicId(row?.departmentId) || '';
    return programDeptId && deptSet.has(programDeptId);
  });
}

function normalizeFunderFilterId(value = '') {
  const token = String(value || '').trim();
  if (!token) return '';
  if (token.toLowerCase() === 'self') return 'self';
  return toPublicId(token) || token;
}

function parseFunderFilterIdList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeFunderFilterId(item)).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((item) => normalizeFunderFilterId(item))
    .filter(Boolean);
}

function rowMatchesFunderFilter(row = {}, funderFilterIds = []) {
  const normalized = parseFunderFilterIdList(funderFilterIds);
  if (!normalized.length) return true;
  const groupKey = String(row?.funderGroupKey || 'self').trim() || 'self';
  return normalized.some((funderId) => {
    if (funderId === 'self') return groupKey === 'self';
    return groupKey === buildFunderGroupKey(funderId, 'funder');
  });
}

function filterRowsByFunderIds(rows = [], funderIds = []) {
  const normalized = parseFunderFilterIdList(funderIds);
  if (!normalized.length) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => rowMatchesFunderFilter(row, normalized));
}

async function resolveEnrollmentCompletionsFunderOptions(reqUser = {}) {
  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  const activeFunders = await scheduleEnrollStudentsService.loadActiveFunderOptions(reqUser, activeOrgId).catch(() => []);
  const options = [{ id: 'self', name: 'Self Fund', label: 'Self Fund' }];
  (Array.isArray(activeFunders) ? activeFunders : []).forEach((row) => {
    const id = toPublicId(row?.id);
    if (!id) return;
    const label = String(row?.label || id).trim();
    options.push({ id, name: label, label });
  });
  options.sort((a, b) => {
    if (a.id === 'self' && b.id !== 'self') return -1;
    if (b.id === 'self' && a.id !== 'self') return 1;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  });
  return options;
}

async function resolveEnrollmentCompletionsProgramCatalog(reqUser = {}) {
  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  const programs = await schoolDataService.fetchAllData('programs', {}, reqUser);
  return (Array.isArray(programs) ? programs : [])
    .filter((row) => !String(row?.orgId || '').trim() || idsEqual(row?.orgId, activeOrgId))
    .map((row) => {
      const id = toPublicId(row?.id);
      const code = String(row?.code || '').trim();
      const name = String(row?.name || row?.id || 'Program').trim();
      const label = [code, name].filter(Boolean).join(' - ') || name || id;
      const departmentId = toPublicId(row?.departmentId) || '';
      return { id, name: label, departmentId };
    })
    .filter((row) => row.id)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

async function resolveFilterOptions(reqUser = {}, { departmentIds = [] } = {}) {
  const [departmentOptions, programCatalog, funderOptions] = await Promise.all([
    weeklyReportsHubService.resolveWeeklyReportsDepartmentOptions(reqUser),
    resolveEnrollmentCompletionsProgramCatalog(reqUser),
    resolveEnrollmentCompletionsFunderOptions(reqUser)
  ]);
  const programOptions = filterProgramOptionsByDepartments(programCatalog, departmentIds);
  return { departmentOptions, programOptions, programCatalog, funderOptions };
}

async function buildEnrollmentCompletionsReport({
  reqUser,
  orgToday = '',
  month,
  departmentIds = [],
  programIds = [],
  funderIds = []
} = {}) {
  const parsedMonth = parseMonthKey(month);
  if (!parsedMonth) {
    throw hubError('Choose a valid month (YYYY-MM).');
  }

  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  const normalizedDepartmentIds = weeklyReportsHubService.parseFilterIdList(departmentIds);
  const normalizedProgramIds = weeklyReportsHubService.parseFilterIdList(programIds);
  const normalizedFunderIds = parseFunderFilterIdList(funderIds);

  const allClasses = await schoolDataService.fetchAllData('classes', {}, reqUser);
  const classes = weeklyReportsHubService
    .filterClassesForEnrollmentCompletions(allClasses, {
      activeOrgId,
      departmentIds: normalizedDepartmentIds,
      programIds: normalizedProgramIds
    })
    .filter(isRollingClass);

  const [students, teachers, persons] = await Promise.all([
    schoolDataService.fetchAllData('students', {}, reqUser),
    schoolDataService.fetchAllData('teachers', {}, reqUser),
    schoolDataService.fetchAllData('persons', {}, reqUser).catch(() => [])
  ]);

  const personNameById = await buildEnrollmentCompletionsPersonNameMap(reqUser, students, persons, teachers);
  const funderLabelById = await buildFunderLabelByIdMap(activeOrgId, reqUser);
  const studentsByPersonId = buildStudentsByPersonId(students);
  const studentsByRecordId = buildStudentsByRecordId(students);
  const studentToPersonMap = classEnrollmentSessionApplicabilityService.normalizeStudentToPersonMap(students);
  const personToStudentMap = schoolStudentProfileLinkService.buildPersonIdToStudentRecordIdMap(
    students,
    activeOrgId
  );

  const statusMapByOrgKey = new Map();
  const studentClassPeriods = [];
  const pendingRows = [];
  const studentIdsInReport = new Set();

  for (const classRow of classes) {
    const classId = toPublicId(classRow?.id);
    if (!classId) continue;

    const periodRows = await schoolDataService.getClassEnrollmentPeriodsByClassId(classId, reqUser);
    if (!Array.isArray(periodRows) || !periodRows.length) continue;

    const enrichedPeriods = await classEnrollmentPeriodProgressService.attachSessionProgressToEnrollmentPeriodRows(
      periodRows,
      classRow,
      reqUser,
      students
    );

    const orgKey = String(toPublicId(classRow?.orgId) || activeOrgId || '').trim();
    let statusMap = statusMapByOrgKey.get(orgKey);
    if (!statusMap) {
      statusMap = await sessionStatusPolicyService.getStatusMap(
        classRow?.orgId || activeOrgId,
        { includeInactive: true }
      );
      statusMapByOrgKey.set(orgKey, statusMap);
    }

    const sessions = await schoolDataService.getClassSessions(classId, reqUser);

    for (const period of enrichedPeriods) {
      if (!isIncludedPeriodStatus(period)) continue;

      const studentPersonId = classEnrollmentSessionApplicabilityService.resolveStudentPersonId(
        period,
        studentToPersonMap
      );
      if (!studentPersonId) continue;

      const startDate = normalizeDateOnly(period?.startDate);
      const className = String(classRow?.title || classRow?.name || classId).trim();

      const periodEffectiveEnd = sessionEnrollmentContextService.resolveExpectedFinishDate({
        period,
        sessions,
        statusMap,
        enrichedPeriodRow: period
      });

      studentClassPeriods.push({
        studentPersonId,
        startDate,
        period,
        effectiveEnd: periodEffectiveEnd,
        classRow,
        className,
        classId,
        sessions
      });

      const effectiveFinish = sessionEnrollmentContextService.resolveExpectedFinishDate({
        period,
        sessions,
        statusMap,
        enrichedPeriodRow: period
      });
      if (!dateInMonth(effectiveFinish, parsedMonth.monthKey)) continue;

      const studentRecordId = schoolStudentProfileLinkService.resolveStudentRecordId({
        personId: studentPersonId,
        personToStudentMap
      });
      const studentRecord = studentsByPersonId.get(toPublicId(studentPersonId))
        || studentsByRecordId.get(toPublicId(period?.studentId))
        || studentsByRecordId.get(toPublicId(studentRecordId))
        || null;
      const studentName = resolveStudentDisplayName({
        studentPersonId,
        studentRecord,
        personNameById,
        period
      });
      const latestClb = getLatestClbLevelEntry(studentRecord || {});
      const { clbGoalLabel, clbCurrentLabel } = formatClbGoalCurrentFields(latestClb);
      const funderSelection = rollingEnrollmentFunderService.normalizeEnrollmentFunderSelection(period);
      const funderLabel = rollingEnrollmentFunderService.resolveEnrollmentFunderLabel(period, funderLabelById);
      const funderGroupKey = buildFunderGroupKey(funderSelection.funderId, funderSelection.funderType);
      const claimNumberDisplay = resolveClaimNumberDisplay(period, studentRecord);
      const enrollmentFollowOnNotes = buildEnrollmentNewEnrollmentSummary({
        period,
        periodRows: enrichedPeriods,
        effectiveFinish,
        studentPersonId,
        studentToPersonMap,
        sessions,
        statusMap
      });

      studentIdsInReport.add(studentPersonId);

      pendingRows.push({
        enrollmentPeriodId: toPublicId(period?.id),
        studentPersonId,
        studentRecordId,
        studentName,
        classId,
        className,
        enrollmentFinishDate: effectiveFinish,
        funderId: funderSelection.funderId,
        funderType: funderSelection.funderType,
        funderLabel,
        funderGroupKey,
        claimNumberDisplay,
        enrollmentFollowOnNotes,
        clbGoalLabel,
        clbCurrentLabel,
        clbLabel: formatClbGoalCurrentLabel(latestClb)
      });
    }
  }

  const rows = pendingRows.map((row) => {
    const { teacherAmNames, teacherPmNames } = resolveAmPmEnrollmentTeachers(
      row.studentPersonId,
      studentClassPeriods,
      personNameById,
      {
        classId: row.classId,
        enrollmentPeriodId: row.enrollmentPeriodId,
        effectiveFinish: row.enrollmentFinishDate
      }
    );
    return {
      ...row,
      teacherAmNames,
      teacherPmNames,
      firstClassTeacherNames: teacherAmNames,
      secondEnrollmentTeacherNames: teacherPmNames
    };
  });

  const consolidatedRows = consolidateEnrollmentCompletionRows(rows);
  const sortedRows = sortCompletionRows(consolidatedRows);
  const filteredRows = filterRowsByFunderIds(sortedRows, normalizedFunderIds);
  const funderGroups = buildFunderGroupsFromRows(filteredRows);

  return {
    rows: filteredRows,
    funderGroups,
    filters: {
      month: parsedMonth.monthKey,
      departmentIds: normalizedDepartmentIds,
      programIds: normalizedProgramIds,
      funderIds: normalizedFunderIds,
      orgToday: String(orgToday || '').trim()
    },
    summary: {
      totalRows: filteredRows.length,
      totalStudents: new Set(filteredRows.map((row) => toPublicId(row?.studentPersonId)).filter(Boolean)).size,
      funderGroupCount: funderGroups.length
    },
    monthLabel: parsedMonth.monthLabel,
    refreshedAt: new Date().toISOString()
  };
}

module.exports = {
  EXCLUDED_PERIOD_STATUSES,
  parseMonthKey,
  dateInMonth,
  isRollingClass,
  isIncludedPeriodStatus,
  formatTeacherNames,
  buildEnrollmentPeriodNotes,
  buildEnrollmentNewEnrollmentSummary,
  buildPersonNameMap,
  buildEnrollmentCompletionsPersonNameMap,
  formatClbGoalCurrentFields,
  formatClbGoalCurrentLabel,
  formatStudentRecordDisplayName,
  getLatestClbLevelEntry,
  resolveStudentDisplayName,
  resolveClassDaypartLabel,
  enrollmentActiveOnFinishDate,
  resolveAmPmEnrollmentTeachers,
  looksLikeOpaqueId,
  consolidateEnrollmentCompletionRows,
  buildFunderGroupKey,
  buildFunderGroupsFromRows,
  resolveClaimNumberDisplay,
  sortCompletionRows,
  filterProgramOptionsByDepartments,
  parseFunderFilterIdList,
  rowMatchesFunderFilter,
  filterRowsByFunderIds,
  resolveFilterOptions,
  buildEnrollmentCompletionsReport
};