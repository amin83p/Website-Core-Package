const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const schoolDataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const PERIOD_ENROLLMENT_STATUSES = Object.freeze([
  'active',
  'planned',
  'to_be_confirmed',
  'completed',
  'withdrawn'
]);

const OPTIONAL_BADGE_ATTENDANCE_STATUSES = new Set([
  'absent',
  'acf',
  'absent_camera_off'
]);

function getClassRegistrationModeKey(classData) {
  return String(classData?.registrationMode || 'term_based').trim().toLowerCase() === 'rolling' ? 'rolling' : 'term_based';
}

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

function resolveClassMaxCapacity(classData = {}) {
  const raw = classData?.enrollment?.maxCapacity ?? classData?.maxCapacity ?? 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildPeriodStudentContext(studentIds, {
  studentToPersonMap = new Map(),
  personNameMap = new Map()
} = {}) {
  const normalizedStudentIds = new Set(
    Array.from(studentIds instanceof Set ? studentIds : [])
      .map((studentId) => toPublicId(studentId))
      .filter(Boolean)
  );
  const isOneOnOne = normalizedStudentIds.size === 1;
  const singleStudentId = isOneOnOne ? Array.from(normalizedStudentIds)[0] : '';
  const singleStudentPersonId = singleStudentId
    ? toPublicId(studentToPersonMap.get(singleStudentId))
    : '';
  return {
    studentIds: normalizedStudentIds,
    isOneOnOne,
    singleStudentId,
    singleStudentPersonId,
    singleStudentName: singleStudentPersonId
      ? String(personNameMap.get(singleStudentPersonId) || '').trim()
      : ''
  };
}

async function buildPeriodClassStudentContextById(classRows = [], {
  periodStartDate = '',
  periodEndDate = '',
  studentToPersonMap = new Map(),
  personNameMap = new Map(),
  activeOrgId = '',
  reqUser
} = {}) {
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
    out.set(classId, buildPeriodStudentContext(snapshot?.studentIds, {
      studentToPersonMap,
      personNameMap
    }));
  }));
  return out;
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

function resolveExpectedStudentPersonIdsForSession({
  classData,
  session,
  studentToPersonMap,
  statusMap,
  rollingApplicability,
  termEnrollmentPersonIds
}) {
  const forceNotApplicable = sessionStatusPolicyService.shouldForceNotApplicableAttendanceByMap(statusMap, {
    status: session?.status,
    notes: session?.notes
  });
  if (forceNotApplicable) return new Set();

  if (getClassRegistrationModeKey(classData) === 'rolling') {
    if (!rollingApplicability || !(rollingApplicability.personIds instanceof Set)) return new Set();
    const personIds = new Set();
    rollingApplicability.personIds.forEach((personId) => {
      const state = classEnrollmentSessionApplicabilityService.getApplicabilityState(
        rollingApplicability.stateByKey,
        personId,
        session,
        session?.sessionId || session?.id
      );
      if (state?.expected === true) {
        const normalizedPersonId = toPublicId(personId);
        if (normalizedPersonId) personIds.add(normalizedPersonId);
      }
    });
    return personIds;
  }

  return termEnrollmentPersonIds instanceof Set ? new Set(termEnrollmentPersonIds) : new Set();
}

async function buildRollingApplicabilityByClassId(classRows = [], {
  sessionsByClassId = new Map(),
  students = [],
  activeOrgId = '',
  reqUser
} = {}) {
  const studentToPersonMap = buildStudentToPersonMap(students);
  const rollingClasses = (Array.isArray(classRows) ? classRows : [])
    .filter((row) => getClassRegistrationModeKey(row) === 'rolling');
  const out = new Map();

  await Promise.all(rollingClasses.map(async (classRow) => {
    const classId = String(classRow?.id || '').trim();
    if (!classId) return;
    const sessions = sessionsByClassId.get(classId) || [];
    const periodRows = await schoolDataService.getClassEnrollmentPeriodsByClassId(classId, reqUser);
    const statusMap = await sessionStatusPolicyService.getStatusMap(classRow?.orgId || activeOrgId, { includeInactive: true });
    const applicability = await classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentApplicabilityWithLeaves({
      sessions,
      periodRows: Array.isArray(periodRows) ? periodRows : [],
      studentToPersonMap,
      activeOrgId,
      orgId: classRow?.orgId || activeOrgId,
      reqUser,
      allowedStatuses: classEnrollmentSessionApplicabilityService.OPEN_OR_HISTORICAL_STATUSES,
      forceNotApplicableSessionKeys: sessionStatusPolicyService.buildForceNotApplicableAttendanceSessionKeys(statusMap, sessions)
    });
    out.set(classId, applicability);
  }));

  return out;
}

async function resolveTermEnrollmentPersonIdsForSession({
  classData,
  session,
  studentToPersonMap,
  activeOrgId,
  reqUser,
  enrollmentCache
}) {
  const sessionDate = String(session?.date || '').trim();
  const classId = String(classData?.id || '').trim();
  const cacheKey = `${classId}::${sessionDate}`;
  if (enrollmentCache.has(cacheKey)) return enrollmentCache.get(cacheKey);

  const snapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
    classId,
    classItem: classData,
    reqUser,
    activeOrgId,
    sessionDates: sessionDate ? [sessionDate] : [],
    startDate: sessionDate,
    endDate: sessionDate,
    canonicalStatuses: ['active']
  });
  const studentIds = snapshot?.studentIds instanceof Set ? snapshot.studentIds : new Set();
  const personIds = new Set();
  studentIds.forEach((studentId) => {
    const pid = studentToPersonMap.get(toPublicId(studentId));
    if (pid) personIds.add(pid);
  });
  enrollmentCache.set(cacheKey, personIds);
  return personIds;
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
  if (getClassRegistrationModeKey(classData) !== 'rolling') {
    termEnrollmentPersonIds = await resolveTermEnrollmentPersonIdsForSession({
      classData,
      session: sessionRow,
      studentToPersonMap,
      activeOrgId,
      reqUser,
      enrollmentCache: termEnrollmentCache
    });
  }
  const applicablePersonIds = resolveExpectedStudentPersonIdsForSession({
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
  const periodClassStudentContextById = await buildPeriodClassStudentContextById(relevantClassRows, {
    periodStartDate,
    periodEndDate,
    studentToPersonMap,
    personNameMap,
    activeOrgId,
    reqUser
  });
  const departmentCodeById = buildDepartmentCodeMap(departments);
  const classMap = new Map(relevantClassRows.map((row) => [String(row?.id || '').trim(), row]));

  const enriched = [];
  for (const item of liveSessionBuilders) {
    const classData = classMap.get(String(item?.classId || '').trim());
    const sessionRow = item?.sessionRow || null;
    const payload = { ...item.payload };
    if (classData && sessionRow) {
      const classId = toPublicId(classData?.id);
      const context = periodClassStudentContextById.get(classId) || buildPeriodStudentContext(new Set());
      const singleStudentAttendance = resolveSingleStudentAttendance(sessionRow, context);
      const normalizedStatus = sessionStatusPolicyService.normalizeSessionStatus(sessionRow?.status, sessionRow?.notes);
      const statusDefinition = statusMap instanceof Map ? statusMap.get(normalizedStatus) : null;
      const makeUpRequired = statusDefinition?.makeUpRequired === true;
      const makeupDurationPercent = sessionStatusPolicyService.normalizeMakeupDurationPercent(
        statusDefinition?.makeupDurationPercent,
        100
      );
      const classMaxCapacity = resolveClassMaxCapacity(classData);
      const isOneOnOne = context.isOneOnOne === true || classMaxCapacity === 1;
      payload.deliveryDepartmentCode = resolveDepartmentCode(classData, departmentCodeById);
      payload.classMaxCapacity = classMaxCapacity;
      payload.isOneOnOne = isOneOnOne;
      payload.singleStudentId = context.singleStudentId || '';
      payload.singleStudentPersonId = context.singleStudentPersonId || '';
      payload.singleStudentName = context.singleStudentName || '';
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
    }
    enriched.push(payload);
  }
  return enriched;
}

module.exports = {
  PERIOD_ENROLLMENT_STATUSES,
  getClassRegistrationModeKey,
  buildStudentToPersonMap,
  buildPersonNameMap,
  normalizeAttendance,
  buildDepartmentCodeMap,
  resolveDepartmentCode,
  resolveClassMaxCapacity,
  buildPeriodStudentContext,
  buildPeriodClassStudentContextById,
  resolveSingleStudentAttendance,
  shouldShowOptionalBadge,
  resolveSingleStudentNameFromPersonIds,
  resolveExpectedStudentPersonIdsForSession,
  enrichClassLiveSessions
};
