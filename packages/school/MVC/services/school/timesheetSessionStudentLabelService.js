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

function enrollmentCountCacheKey(classId, date, sessionId = '') {
  const sid = String(sessionId || '').trim();
  return sid
    ? `${toPublicId(classId)}::${String(date || '').trim()}::${sid}`
    : `${toPublicId(classId)}::${String(date || '').trim()}`;
}

function findSessionRowInMap(sessionsByClassId, classId, sessionId) {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId || !(sessionsByClassId instanceof Map)) return null;
  const sessions = sessionsByClassId.get(String(classId || '').trim()) || [];
  return (Array.isArray(sessions) ? sessions : []).find((row) => {
    const rowSessionId = String(row?.sessionId || row?.id || '').trim();
    return rowSessionId && idsEqual(rowSessionId, normalizedSessionId);
  }) || null;
}

function buildClassRowsById(classRows = []) {
  const out = new Map();
  (Array.isArray(classRows) ? classRows : []).forEach((row) => {
    const classId = String(row?.id || '').trim();
    if (classId) out.set(classId, row);
  });
  return out;
}

async function resolveExpectedEnrollmentCountForSession({
  classData,
  sessionRow,
  studentToPersonMap,
  statusMap,
  rollingApplicabilityByClassId,
  termEnrollmentCache,
  activeOrgId,
  reqUser
}) {
  if (!classData || !sessionRow) return null;
  const classId = toPublicId(classData?.id);
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
    rollingApplicability: rollingApplicabilityByClassId instanceof Map
      ? rollingApplicabilityByClassId.get(classId)
      : null,
    termEnrollmentPersonIds
  });
  return applicablePersonIds.size;
}

async function resolveEnrolledStudentCountCache(items = [], {
  activeOrgId = '',
  reqUser,
  classRowsById = null,
  sessionsByClassId = null,
  studentToPersonMap = null,
  statusMap = null,
  rollingApplicabilityByClassId = null,
  termEnrollmentCache = null
} = {}) {
  const cache = new Map();
  const classMap = classRowsById instanceof Map ? classRowsById : new Map();
  const studentMap = studentToPersonMap instanceof Map ? studentToPersonMap : new Map();
  const termCache = termEnrollmentCache instanceof Map ? termEnrollmentCache : new Map();
  const rollingMap = rollingApplicabilityByClassId instanceof Map ? rollingApplicabilityByClassId : null;
  const hasSessionContext = sessionsByClassId instanceof Map && statusMap;

  await Promise.all((Array.isArray(items) ? items : []).map(async (item) => {
    const classId = toPublicId(item?.classId);
    const date = String(item?.date || '').trim();
    const sessionId = String(item?.sessionId || '').trim();
    if (!classId || !date) return;
    const key = enrollmentCountCacheKey(classId, date, sessionId);
    const classData = classMap.get(String(classId)) || null;
    const sessionRow = hasSessionContext
      ? (findSessionRowInMap(sessionsByClassId, classId, sessionId) || (item?.sessionRow || null))
      : null;
    if (classData && sessionRow && statusMap) {
      const count = await resolveExpectedEnrollmentCountForSession({
        classData,
        sessionRow,
        studentToPersonMap: studentMap,
        statusMap,
        rollingApplicabilityByClassId: rollingMap,
        termEnrollmentCache: termCache,
        activeOrgId,
        reqUser
      });
      if (count != null) {
        cache.set(key, count);
        return;
      }
    }
    const snapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
      classId,
      classItem: classData,
      reqUser,
      activeOrgId,
      sessionDates: [date],
      startDate: date,
      endDate: date,
      canonicalStatuses: classData && classSessionCapacityService.getClassRegistrationModeKey(classData) === 'rolling'
        ? classEnrollmentReadService.HISTORICAL_ROLLING_ROSTER_STATUSES
        : PERIOD_ENROLLMENT_STATUSES
    });
    const studentIds = snapshot?.studentIds instanceof Set ? snapshot.studentIds : new Set();
    cache.set(key, studentIds.size);
  }));
  return cache;
}

function enrolledStudentCountFromCache(cache, classId, date, sessionId = '') {
  if (!(cache instanceof Map)) return null;
  const sessionKey = enrollmentCountCacheKey(classId, date, sessionId);
  if (cache.has(sessionKey)) return Number(cache.get(sessionKey) || 0);
  const dateKey = enrollmentCountCacheKey(classId, date);
  if (!cache.has(dateKey)) return null;
  return Number(cache.get(dateKey) || 0);
}

async function stampEnrolledStudentCountsOnRows(rows = [], {
  activeOrgId = '',
  reqUser,
  classRows = [],
  sessionsByClassId = null,
  students = [],
  statusMap = null
} = {}) {
  const source = Array.isArray(rows) ? rows : [];
  const classRowsById = buildClassRowsById(classRows);
  const studentToPersonMap = buildStudentToPersonMap(students);
  let rollingApplicabilityByClassId = null;
  if (sessionsByClassId instanceof Map && statusMap && classRowsById.size) {
    const rollingClassRows = Array.from(classRowsById.values())
      .filter((row) => classSessionCapacityService.getClassRegistrationModeKey(row) === 'rolling');
    if (rollingClassRows.length) {
      rollingApplicabilityByClassId = await classSessionCapacityService.buildRollingApplicabilityByClassId(
        rollingClassRows,
        { sessionsByClassId, students, activeOrgId, reqUser }
      );
    }
  }
  const cache = await resolveEnrolledStudentCountCache(
    source.map((row) => ({ classId: row?.classId, date: row?.date, sessionId: row?.sessionId })),
    {
      activeOrgId,
      reqUser,
      classRowsById,
      sessionsByClassId,
      studentToPersonMap,
      statusMap,
      rollingApplicabilityByClassId,
      termEnrollmentCache: new Map()
    }
  );
  return source.map((row) => {
    const count = enrolledStudentCountFromCache(cache, row?.classId, row?.date, row?.sessionId);
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
  const rollingApplicabilityByClassId = await classSessionCapacityService.buildRollingApplicabilityByClassId(
    relevantClassRows,
    { sessionsByClassId, students, activeOrgId, reqUser }
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
      const enrolledStudentCount = await resolveExpectedEnrollmentCountForSession({
        classData,
        sessionRow,
        studentToPersonMap,
        statusMap,
        rollingApplicabilityByClassId,
        termEnrollmentCache,
        activeOrgId,
        reqUser
      });
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
  resolveExpectedEnrollmentCountForSession,
  resolveEnrolledStudentCountCache,
  stampEnrolledStudentCountsOnRows,
  enrichClassLiveSessions
};
