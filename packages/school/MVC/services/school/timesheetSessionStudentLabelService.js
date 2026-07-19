const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const schoolDataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

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
  statusMap,
  activeOrgId,
  reqUser
}) {
  const studentToPersonMap = buildStudentToPersonMap(students);
  const personNameMap = buildPersonNameMap(persons);
  const rollingApplicabilityByClassId = await buildRollingApplicabilityByClassId(classRows, {
    sessionsByClassId,
    students,
    activeOrgId,
    reqUser
  });
  const termEnrollmentCache = new Map();
  const classMap = new Map((Array.isArray(classRows) ? classRows : []).map((row) => [String(row?.id || '').trim(), row]));

  const enriched = [];
  for (const item of liveSessionBuilders) {
    const classData = classMap.get(String(item?.classId || '').trim());
    const sessionRow = item?.sessionRow || null;
    const payload = { ...item.payload };
    if (classData && sessionRow) {
      // eslint-disable-next-line no-await-in-loop
      await enrichClassSessionPayloadWithSingleStudentName(payload, {
        classData,
        sessionRow,
        studentToPersonMap,
        personNameMap,
        statusMap,
        rollingApplicabilityByClassId,
        termEnrollmentCache,
        activeOrgId,
        reqUser
      });
    }
    enriched.push(payload);
  }
  return enriched;
}

module.exports = {
  getClassRegistrationModeKey,
  buildStudentToPersonMap,
  buildPersonNameMap,
  resolveSingleStudentNameFromPersonIds,
  resolveExpectedStudentPersonIdsForSession,
  enrichClassLiveSessions
};
