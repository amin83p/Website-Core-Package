const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const classSessionCapacityService = require('./classSessionCapacityService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const schoolDataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const PERIOD_ENROLLMENT_STATUSES = classSessionCapacityService.PERIOD_ENROLLMENT_STATUSES;

const OPTIONAL_BADGE_ATTENDANCE_STATUSES = new Set([
  'absent',
  'acf',
  'absent_camera_off'
]);

function buildStudentToPersonMap(students = []) {
  return new Map(
    (Array.isArray(students) ? students : [])
      .map((row) => [toPublicId(row?.id), toPublicId(row?.personId)])
      .filter(([studentId, personId]) => Boolean(studentId && personId))
  );
}

function buildPersonNameMap(persons = []) {
  const map = new Map();
  (Array.isArray(persons) ? persons : []).forEach((person) => {
    const id = toPublicId(person?.id || person?.personId);
    if (!id) return;
    const name = `${person?.name?.first || ''} ${person?.name?.last || ''}`.trim()
      || String(person?.displayName || person?.name || '').trim();
    if (name) map.set(id, name);
  });
  return map;
}

function resolveSingleStudentNameFromPersonIds(personIds, personNameMap) {
  if (!(personIds instanceof Set) || personIds.size !== 1) return '';
  const pid = Array.from(personIds)[0];
  return String(personNameMap.get(pid) || '').trim();
}

function normalizeAttendance(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function buildDepartmentCodeMap(departments = []) {
  const map = new Map();
  (Array.isArray(departments) ? departments : []).forEach((department) => {
    const id = toPublicId(department?.id);
    const code = String(department?.code || '').trim();
    if (id && code) map.set(id, code);
  });
  return map;
}

function resolveDepartmentCode(classData = {}, departmentCodeById = new Map()) {
  const direct = String(classData?.deliveryDepartmentCode || classData?.departmentCode || '').trim();
  if (direct) return direct;
  const departmentId = toPublicId(classData?.deliveryDepartmentId || classData?.departmentId);
  if (!departmentId) return '';
  return String(departmentCodeById.get(departmentId) || '').trim();
}

function resolveSingleStudentAttendance(session = {}, context = {}) {
  if (context?.isOneOnOne !== true) return '';
  const candidateIds = [context?.singleStudentPersonId, context?.singleStudentId]
    .map((value) => toPublicId(value))
    .filter(Boolean);
  if (!candidateIds.length) return '';
  const rosterRow = (Array.isArray(session?.roster) ? session.roster : []).find((row) => {
    const rowId = toPublicId(row?.personId || row?.studentId || row?.id);
    return rowId && candidateIds.some((candidateId) => idsEqual(rowId, candidateId));
  });
  return normalizeAttendance(rosterRow?.attendance);
}

function shouldShowOptionalBadge({ isOneOnOne = false, attendance = '', makeUpRequired = false } = {}) {
  if (isOneOnOne !== true) return false;
  return OPTIONAL_BADGE_ATTENDANCE_STATUSES.has(normalizeAttendance(attendance)) || makeUpRequired === true;
}

async function buildPeriodClassStudentContextById(classRows = [], {
  periodStartDate = '',
  periodEndDate = '',
  studentToPersonMap = new Map(),
  personNameMap = new Map(),
  activeOrgId = '',
  reqUser
} = {}) {
  const classEnrollmentReadService = require('./classEnrollmentReadService');
  const out = new Map();
  await Promise.all((Array.isArray(classRows) ? classRows : []).map(async (classData) => {
    const classId = toPublicId(classData?.id);
    if (!classId) return;
    const snapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
      classId,
      classItem: classData,
      reqUser,
      activeOrgId,
      startDate: periodStartDate,
      endDate: periodEndDate,
      canonicalStatuses: PERIOD_ENROLLMENT_STATUSES
    });
    const context = classSessionCapacityService.buildEnrollmentStudentContext(snapshot?.studentIds, {
      studentToPersonMap
    });
    out.set(classId, {
      ...context,
      singleStudentName: context.singleStudentPersonId
        ? String(personNameMap.get(context.singleStudentPersonId) || '').trim()
        : ''
    });
  }));
  return out;
}

function enrollmentCountCacheKey(classId, date) {
  return `${toPublicId(classId)}::${String(date || '').trim()}`;
}

async function resolveEnrolledStudentCountCache(items = [], {
  activeOrgId = '',
  reqUser
} = {}) {
  const cache = new Map();
  const unique = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const classId = toPublicId(item?.classId);
    const date = String(item?.date || '').trim();
    if (!classId || !date) return;
    const key = enrollmentCountCacheKey(classId, date);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push({ classId, date, key });
  });
  await Promise.all(unique.map(async ({ classId, date, key }) => {
    const snapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
      classId,
      reqUser,
      activeOrgId,
      sessionDates: [date],
      startDate: date,
      endDate: date,
      canonicalStatuses: ['active']
    });
    const studentIds = snapshot?.studentIds instanceof Set ? snapshot.studentIds : new Set();
    cache.set(key, studentIds.size);
  }));
  return cache;
}

function enrolledStudentCountFromCache(cache, classId, date) {
  if (!(cache instanceof Map)) return null;
  const key = enrollmentCountCacheKey(classId, date);
  if (!cache.has(key)) return null;
  return Number(cache.get(key) || 0);
}

async function stampEnrolledStudentCountsOnRows(rows = [], {
  activeOrgId = '',
  reqUser
} = {}) {
  const source = Array.isArray(rows) ? rows : [];
  const cache = await resolveEnrolledStudentCountCache(
    source.map((row) => ({ classId: row?.classId, date: row?.date })),
    { activeOrgId, reqUser }
  );
  return source.map((row) => {
    const count = enrolledStudentCountFromCache(cache, row?.classId, row?.date);
    if (count == null) return row;
    return { ...row, enrolledStudentCount: count };
  });
}

async function enrichClassSessionPayloadWithSingleStudentName(sessionPayload, {
  classData,
  sessionRow,
  studentToPersonMap,
  personNameMap,
  statusMap,
  rollingApplicabilityByClassId,
  termEnrollmentCache,
  activeOrgId,
  reqUser
}) {
  if (!sessionPayload || !sessionRow || !classData) return sessionPayload;
  const classId = String(classData?.id || '').trim();
  let termEnrollmentPersonIds = new Set();
  if (classSessionCapacityService.getClassRegistrationModeKey(classData) !== 'rolling') {
    termEnrollmentPersonIds = await classSessionCapacityService.resolveTermEnrollmentPersonIdsForSession({
      classData,
      session: sessionRow,
      studentToPersonMap,
      activeOrgId,
      reqUser,
      enrollmentCache: termEnrollmentCache
    });
  }
  const applicablePersonIds = classSessionCapacityService.resolveSessionEnrollmentPersonIds({
    classData,
    session: sessionRow,
    studentToPersonMap,
    statusMap,
    rollingApplicability: rollingApplicabilityByClassId.get(classId),
    termEnrollmentPersonIds
  });
  const singleStudentName = resolveSingleStudentNameFromPersonIds(applicablePersonIds, personNameMap);
  if (singleStudentName) sessionPayload.singleStudentName = singleStudentName;
  return sessionPayload;
}

async function enrichClassLiveSessions({
  classRows = [],
  sessionsByClassId = new Map(),
  liveSessionBuilders = [],
  students = [],
  persons = [],
  departments = [],
  statusMap,
  periodStartDate = '',
  periodEndDate = '',
  activeOrgId,
  reqUser
}) {
  const studentToPersonMap = buildStudentToPersonMap(students);
  const personNameMap = buildPersonNameMap(persons);
  const targetClassIds = new Set(
    (Array.isArray(liveSessionBuilders) ? liveSessionBuilders : [])
      .map((item) => toPublicId(item?.classId))
      .filter(Boolean)
  );
  const relevantClassRows = (Array.isArray(classRows) ? classRows : [])
    .filter((row) => targetClassIds.has(toPublicId(row?.id)));
  const departmentCodeById = buildDepartmentCodeMap(departments);
  const classMap = new Map(relevantClassRows.map((row) => [String(row?.id || '').trim(), row]));
  const termEnrollmentCache = new Map();
  const enrollmentPeriodsByClassId = new Map();
  const enrollmentCountCache = await resolveEnrolledStudentCountCache(
    (Array.isArray(liveSessionBuilders) ? liveSessionBuilders : []).map((item) => ({
      classId: item?.classId,
      date: item?.sessionRow?.date || item?.payload?.date
    })),
    { activeOrgId, reqUser }
  );

  await Promise.all(relevantClassRows.map(async (classRow) => {
    if (classSessionCapacityService.getClassRegistrationModeKey(classRow) !== 'rolling') return;
    const classId = String(classRow?.id || '').trim();
    if (!classId) return;
    const periods = await schoolDataService.getClassEnrollmentPeriodsByClassId(classId, reqUser);
    enrollmentPeriodsByClassId.set(classId, Array.isArray(periods) ? periods : []);
  }));

  const enriched = [];
  for (const item of liveSessionBuilders) {
    const classData = classMap.get(String(item?.classId || '').trim());
    const sessionRow = item?.sessionRow || null;
    const payload = { ...item.payload };
    if (classData && sessionRow) {
      const classId = toPublicId(classData?.id);
      const capacityContext = await classSessionCapacityService.resolveSessionOneOnOneContext({
        classData,
        session: sessionRow,
        reqUser,
        activeOrgId,
        studentToPersonMap,
        statusMap,
        enrollmentPeriods: enrollmentPeriodsByClassId.get(classId) || null,
        termEnrollmentCache
      });
      const singleStudentPersonId = toPublicId(capacityContext?.singleStudentPersonId);
      const singleStudentName = singleStudentPersonId
        ? String(personNameMap.get(singleStudentPersonId) || '').trim()
        : '';
      const singleStudentAttendance = resolveSingleStudentAttendance(sessionRow, {
        isOneOnOne: capacityContext?.isOneOnOne === true,
        singleStudentPersonId: capacityContext?.singleStudentPersonId || '',
        singleStudentId: capacityContext?.singleStudentId || ''
      });
      const normalizedStatus = sessionStatusPolicyService.normalizeSessionStatus(sessionRow?.status, sessionRow?.notes);
      const statusDefinition = statusMap instanceof Map ? statusMap.get(normalizedStatus) : null;
      const makeUpRequired = statusDefinition?.makeUpRequired === true;
      const makeupDurationPercent = sessionStatusPolicyService.normalizeMakeupDurationPercent(
        statusDefinition?.makeupDurationPercent,
        100
      );
      const classMaxCapacity = classSessionCapacityService.resolveClassMaxCapacity(classData);
      const isOneOnOne = capacityContext?.isOneOnOne === true;
      payload.deliveryDepartmentCode = resolveDepartmentCode(classData, departmentCodeById);
      payload.classMaxCapacity = classMaxCapacity;
      payload.isOneOnOne = isOneOnOne;
      payload.capacityMode = capacityContext?.capacityMode || 'group';
      payload.singleStudentId = capacityContext?.singleStudentId || '';
      payload.singleStudentPersonId = capacityContext?.singleStudentPersonId || '';
      payload.singleStudentName = singleStudentName;
      payload.singleStudentAttendance = singleStudentAttendance;
      payload.makeUpRequired = makeUpRequired;
      payload.makeupDurationPercent = makeupDurationPercent;
      if (makeUpRequired) {
        const baseDuration = Number(payload.durationHours ?? item?.payload?.durationHours ?? 0);
        payload.allowedDurationHours = sessionStatusPolicyService.calculateMakeupSessionDurationHours(
          baseDuration,
          makeupDurationPercent
        );
      }
      payload.showOptionalBadge = shouldShowOptionalBadge({
        isOneOnOne,
        attendance: singleStudentAttendance,
        makeUpRequired
      });
      const enrolledStudentCount = enrolledStudentCountFromCache(
        enrollmentCountCache,
        classId,
        sessionRow?.date || payload.date
      );
      if (enrolledStudentCount != null) payload.enrolledStudentCount = enrolledStudentCount;
    }
    enriched.push(payload);
  }
  return enriched;
}

module.exports = {
  PERIOD_ENROLLMENT_STATUSES,
  getClassRegistrationModeKey: classSessionCapacityService.getClassRegistrationModeKey,
  buildStudentToPersonMap,
  buildPersonNameMap,
  normalizeAttendance,
  buildDepartmentCodeMap,
  resolveDepartmentCode,
  resolveClassMaxCapacity: classSessionCapacityService.resolveClassMaxCapacity,
  buildPeriodStudentContext: classSessionCapacityService.buildEnrollmentStudentContext,
  buildPeriodClassStudentContextById,
  resolveSingleStudentAttendance,
  shouldShowOptionalBadge,
  resolveSingleStudentNameFromPersonIds,
  resolveExpectedStudentPersonIdsForSession: classSessionCapacityService.resolveSessionEnrollmentPersonIds,
  resolveEnrolledStudentCountCache,
  stampEnrolledStudentCountsOnRows,
  enrichClassLiveSessions
};
