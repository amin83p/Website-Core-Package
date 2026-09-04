const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const schoolDataService = require('./schoolDataService');
const classEnrollmentPeriodModel = require('../../models/school/classEnrollmentPeriodModel');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const PERIOD_ENROLLMENT_STATUSES = Object.freeze([
  'active',
  'planned',
  'to_be_confirmed',
  'completed',
  'withdrawn'
]);

const SCHEDULE_SOLO_STUDENT_ENROLLMENT_STATUSES = new Set([
  'active',
  'planned',
  'to_be_confirmed',
  'registered'
]);

function cleanText(value) {
  return String(value || '').trim();
}

function getClassRegistrationModeKey(classData) {
  return String(classData?.registrationMode || 'term_based').trim().toLowerCase() === 'rolling' ? 'rolling' : 'term_based';
}

function resolveClassMaxCapacity(classData = {}) {
  const raw = classData?.enrollment?.maxCapacity
    ?? classData?.maxCapacity
    ?? classData?.capacity
    ?? classData?.studentCapacity
    ?? 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRollingCapacityOneClass(classData = {}) {
  return getClassRegistrationModeKey(classData) === 'rolling'
    && resolveClassMaxCapacity(classData) === 1;
}

function resolveSessionMaxStudents(classData = {}) {
  const maxCapacity = resolveClassMaxCapacity(classData);
  if (maxCapacity === 1) return 1;
  return maxCapacity > 0 ? maxCapacity : 0;
}

function resolveEffectiveSessionCapacityType(classData = {}, sessionCapacityType = '') {
  const normalized = normalizeSessionCapacityType(sessionCapacityType);
  if (isRollingCapacityOneClass(classData)) return 'one_on_one';
  return normalized;
}

function shouldSkipClassLevelCapacityLimit(classData = {}) {
  return isRollingCapacityOneClass(classData);
}

function buildEnrollmentStudentContext(studentIds, {
  studentToPersonMap = new Map()
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
    singleStudentPersonId
  };
}

function resolveIsOneOnOne({
  classData = {},
  enrollmentStudentCount = null,
  enrollmentContext = null
} = {}) {
  const classMaxCapacity = resolveClassMaxCapacity(classData);
  if (classMaxCapacity === 1) return true;
  if (enrollmentContext?.isOneOnOne === true) return true;
  if (typeof enrollmentStudentCount === 'number' && enrollmentStudentCount === 1) return true;
  return false;
}

function resolveCapacityModeFromIsOneOnOne(isOneOnOne) {
  return isOneOnOne === true ? 'one_on_one' : 'group';
}

function resolveCapacityModeFromEnrollment({
  classData = {},
  enrollmentStudentCount = null,
  enrollmentContext = null
} = {}) {
  return resolveCapacityModeFromIsOneOnOne(resolveIsOneOnOne({
    classData,
    enrollmentStudentCount,
    enrollmentContext
  }));
}

function normalizeSessionCapacityType(value) {
  try {
    return classEnrollmentPeriodModel.sanitizeSessionCapacityType(value, { defaultValue: 'group' });
  } catch {
    return 'group';
  }
}

function resolveRosterStudentIds(session = {}, studentToPersonMap = new Map()) {
  const roster = Array.isArray(session?.roster) ? session.roster : [];
  const studentIds = new Set();
  roster.forEach((row) => {
    const directStudentId = toPublicId(row?.studentId);
    if (directStudentId) studentIds.add(directStudentId);
    const personId = toPublicId(row?.personId);
    if (!personId) return;
    for (const [studentId, mappedPersonId] of studentToPersonMap.entries()) {
      if (idsEqual(mappedPersonId, personId)) studentIds.add(studentId);
    }
  });
  return studentIds;
}

function resolveRollingSessionCapacityFromEnrollment({
  classData = null,
  session,
  enrollmentPeriods = [],
  studentToPersonMap = new Map()
} = {}) {
  if (classData && isRollingCapacityOneClass(classData)) {
    return 'one_on_one';
  }

  const rosterCount = Array.isArray(session?.roster) ? session.roster.length : 0;
  if (rosterCount !== 1) return 'group';

  const sessionDate = String(session?.date || '').trim();
  if (!sessionDate) return 'group';

  const rosterStudentIds = resolveRosterStudentIds(session, studentToPersonMap);
  if (rosterStudentIds.size !== 1) return 'group';
  const studentId = Array.from(rosterStudentIds)[0];

  const matchingPeriods = (Array.isArray(enrollmentPeriods) ? enrollmentPeriods : []).filter((row) => (
    idsEqual(row?.studentId, studentId)
    && scheduleEnrollmentPeriodContainsDate(row, sessionDate)
  ));

  if (matchingPeriods.some((row) => normalizeSessionCapacityType(row?.sessionCapacityType) === 'one_on_one')) {
    return 'one_on_one';
  }
  return 'group';
}

function isDepartmentOneOnOneEntry(entry = {}, classRow = {}) {
  if (entry?.isSchoolActivity === true || entry?.isActivity === true || cleanText(entry?.activityId)) return false;
  const sessionId = cleanText(entry?.sessionId).toLowerCase();
  if (sessionId.startsWith('act-')) return false;
  const capacity = Number(entry?.classMaxCapacity ?? resolveClassMaxCapacity(classRow));
  if (capacity === 1) return true;
  return entry.isOneOnOne === true;
}

function resolveSessionEnrollmentPersonIds({
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
  if (enrollmentCache?.has(cacheKey)) return enrollmentCache.get(cacheKey);

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
  if (enrollmentCache) enrollmentCache.set(cacheKey, personIds);
  return personIds;
}

async function buildRollingApplicabilityByClassId(classRows = [], {
  sessionsByClassId = new Map(),
  students = [],
  activeOrgId = '',
  reqUser
} = {}) {
  const studentToPersonMap = new Map(
    (Array.isArray(students) ? students : [])
      .map((row) => [toPublicId(row?.id), toPublicId(row?.personId)])
      .filter(([studentId, personId]) => Boolean(studentId && personId))
  );
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

async function resolveSessionOneOnOneContext({
  classData,
  session,
  reqUser,
  activeOrgId = '',
  studentToPersonMap = new Map(),
  statusMap = null,
  rollingApplicabilityByClassId = null,
  termEnrollmentCache = null,
  rollingApplicability = null,
  termEnrollmentPersonIds = null,
  enrollmentPeriods = null
} = {}) {
  const classMaxCapacity = resolveClassMaxCapacity(classData);
  const classId = toPublicId(classData?.id);

  if (getClassRegistrationModeKey(classData) === 'rolling') {
    let rollingEnrollmentPeriods = enrollmentPeriods;
    if (!rollingEnrollmentPeriods && classId) {
      rollingEnrollmentPeriods = await schoolDataService.getClassEnrollmentPeriodsByClassId(classId, reqUser);
    }
    const capacityMode = resolveRollingSessionCapacityFromEnrollment({
      classData,
      session,
      enrollmentPeriods: rollingEnrollmentPeriods,
      studentToPersonMap
    });
    const rosterStudentIds = resolveRosterStudentIds(session, studentToPersonMap);
    const enrollmentContext = buildEnrollmentStudentContext(rosterStudentIds, { studentToPersonMap });
    let singleStudentId = enrollmentContext.singleStudentId || '';
    let singleStudentPersonId = enrollmentContext.singleStudentPersonId || '';
    if (!singleStudentPersonId && rosterStudentIds.size === 1) {
      singleStudentPersonId = toPublicId(
        studentToPersonMap.get(Array.from(rosterStudentIds)[0])
      );
    }
    if (!singleStudentId && rosterStudentIds.size === 1) {
      singleStudentId = Array.from(rosterStudentIds)[0];
    }
    const applicablePersonIds = new Set(
      Array.from(rosterStudentIds)
        .map((studentId) => toPublicId(studentToPersonMap.get(studentId)))
        .filter(Boolean)
    );
    return {
      isOneOnOne: capacityMode === 'one_on_one',
      capacityMode,
      classMaxCapacity,
      singleStudentId,
      singleStudentPersonId,
      applicablePersonIds,
      enrollmentStudentCount: rosterStudentIds.size
    };
  }

  let resolvedStatusMap = statusMap;
  if (!resolvedStatusMap) {
    resolvedStatusMap = await sessionStatusPolicyService.getStatusMap(
      classData?.orgId || activeOrgId,
      { includeInactive: true }
    );
  }

  let rollingApplicabilityRow = rollingApplicability;
  if (!rollingApplicabilityRow && rollingApplicabilityByClassId instanceof Map && classId) {
    rollingApplicabilityRow = rollingApplicabilityByClassId.get(classId);
  }

  let termPersonIds = termEnrollmentPersonIds;
  if (!termPersonIds && getClassRegistrationModeKey(classData) !== 'rolling') {
    const cache = termEnrollmentCache instanceof Map ? termEnrollmentCache : new Map();
    termPersonIds = await resolveTermEnrollmentPersonIdsForSession({
      classData,
      session,
      studentToPersonMap,
      activeOrgId,
      reqUser,
      enrollmentCache: cache
    });
  }

  const applicablePersonIds = resolveSessionEnrollmentPersonIds({
    classData,
    session,
    studentToPersonMap,
    statusMap: resolvedStatusMap,
    rollingApplicability: rollingApplicabilityRow,
    termEnrollmentPersonIds: termPersonIds
  });

  const enrollmentStudentCount = applicablePersonIds.size;
  const enrollmentContext = buildEnrollmentStudentContext(
    new Set(
      Array.from(applicablePersonIds).map((personId) => {
        for (const [studentId, mappedPersonId] of studentToPersonMap.entries()) {
          if (idsEqual(mappedPersonId, personId)) return studentId;
        }
        return '';
      }).filter(Boolean)
    ),
    { studentToPersonMap }
  );

  const isOneOnOne = resolveIsOneOnOne({
    classData,
    enrollmentStudentCount,
    enrollmentContext
  });

  let singleStudentId = enrollmentContext.singleStudentId || '';
  let singleStudentPersonId = enrollmentContext.singleStudentPersonId || '';
  if (!singleStudentPersonId && applicablePersonIds.size === 1) {
    singleStudentPersonId = Array.from(applicablePersonIds)[0];
  }
  if (!singleStudentId && singleStudentPersonId) {
    for (const [studentId, personId] of studentToPersonMap.entries()) {
      if (idsEqual(personId, singleStudentPersonId)) {
        singleStudentId = studentId;
        break;
      }
    }
  }

  return {
    isOneOnOne,
    capacityMode: resolveCapacityModeFromIsOneOnOne(isOneOnOne),
    classMaxCapacity,
    singleStudentId,
    singleStudentPersonId,
    applicablePersonIds,
    enrollmentStudentCount
  };
}

function isSoloStudentEnrollmentStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized || SCHEDULE_SOLO_STUDENT_ENROLLMENT_STATUSES.has(normalized);
}

function scheduleEnrollmentPeriodContainsDate(row = {}, sessionDate = '', {
  normalizeDateOnly = (v) => String(v || '').trim(),
  normalizeId = (v) => String(v || '').trim()
} = {}) {
  const date = normalizeId(sessionDate);
  if (!date || !isSoloStudentEnrollmentStatus(row?.status)) return false;
  const start = normalizeDateOnly(row?.startDate);
  const end = classEnrollmentSessionApplicabilityService.periodEffectiveEndDate(row);
  if (start && start > date) return false;
  if (end && end < date) return false;
  return true;
}

function buildSoloStudentResolver({
  students = [],
  enrollmentPeriods = [],
  classes = [],
  activeOrgId = '',
  normalizeId = (v) => String(v || '').trim(),
  normalizeDateOnly = (v) => String(v || '').trim(),
  studentIdByPersonId = null
} = {}) {
  const studentById = new Map(
    (Array.isArray(students) ? students : [])
      .map((student) => [normalizeId(student?.id || student?._id), student])
      .filter(([id]) => Boolean(id))
  );
  const personIdToStudentId = studentIdByPersonId instanceof Map
    ? studentIdByPersonId
    : new Map(
      (Array.isArray(students) ? students : [])
        .map((student) => [normalizeId(student?.personId), normalizeId(student?.id || student?._id)])
        .filter(([personId, studentId]) => Boolean(personId && studentId))
    );

  const canonicalByClassId = new Map();
  (Array.isArray(enrollmentPeriods) ? enrollmentPeriods : []).forEach((row) => {
    if (activeOrgId && row?.orgId && !idsEqual(row.orgId, activeOrgId)) return;
    const classId = normalizeId(row?.classId);
    if (!classId) return;
    if (!canonicalByClassId.has(classId)) canonicalByClassId.set(classId, []);
    canonicalByClassId.get(classId).push(row);
  });

  return function resolveSoloStudentForSession(classRow = {}, sessionDate = '') {
    const classId = normalizeId(classRow?.id || classRow?._id);
    if (!classId) return null;

    const classMaxCapacity = resolveClassMaxCapacity(classRow);
    if (classMaxCapacity === 1) {
      const canonicalRows = canonicalByClassId.get(classId) || [];
      let studentIds = [];
      if (canonicalRows.length) {
        studentIds = Array.from(new Set(
          canonicalRows
            .filter((row) => scheduleEnrollmentPeriodContainsDate(row, sessionDate, { normalizeDateOnly, normalizeId }))
            .map((row) => normalizeId(row?.studentId))
            .filter(Boolean)
        ));
      } else {
        studentIds = Array.from(new Set(
          (Array.isArray(classRow?.enrollment?.students) ? classRow.enrollment.students : [])
            .filter((row) => isSoloStudentEnrollmentStatus(row?.status || row?.enrollmentStatus))
            .map((row) => normalizeId(row?.studentId || row?.id || row?._id) || personIdToStudentId.get(normalizeId(row?.personId)) || '')
            .filter(Boolean)
        ));
      }
      const studentId = studentIds[0] || '';
      const student = studentById.get(studentId) || { id: studentId };
      return {
        soloStudentId: studentId,
        soloStudentPersonId: normalizeId(student?.personId),
        soloStudentName: ''
      };
    }

    const canonicalRows = canonicalByClassId.get(classId) || [];
    let studentIds = [];
    if (canonicalRows.length) {
      studentIds = Array.from(new Set(
        canonicalRows
          .filter((row) => scheduleEnrollmentPeriodContainsDate(row, sessionDate, { normalizeDateOnly, normalizeId }))
          .map((row) => normalizeId(row?.studentId))
          .filter(Boolean)
      ));
    } else {
      studentIds = Array.from(new Set(
        (Array.isArray(classRow?.enrollment?.students) ? classRow.enrollment.students : [])
          .filter((row) => isSoloStudentEnrollmentStatus(row?.status || row?.enrollmentStatus))
          .map((row) => normalizeId(row?.studentId || row?.id || row?._id) || personIdToStudentId.get(normalizeId(row?.personId)) || '')
          .filter(Boolean)
      ));
    }

    if (studentIds.length !== 1) return null;
    const studentId = studentIds[0];
    const student = studentById.get(studentId) || { id: studentId };
    return {
      soloStudentId: studentId,
      soloStudentPersonId: normalizeId(student?.personId),
      soloStudentName: ''
    };
  };
}

module.exports = {
  PERIOD_ENROLLMENT_STATUSES,
  SCHEDULE_SOLO_STUDENT_ENROLLMENT_STATUSES,
  getClassRegistrationModeKey,
  resolveClassMaxCapacity,
  isRollingCapacityOneClass,
  resolveSessionMaxStudents,
  resolveEffectiveSessionCapacityType,
  shouldSkipClassLevelCapacityLimit,
  buildEnrollmentStudentContext,
  resolveIsOneOnOne,
  resolveCapacityModeFromIsOneOnOne,
  resolveCapacityModeFromEnrollment,
  normalizeSessionCapacityType,
  resolveRosterStudentIds,
  resolveRollingSessionCapacityFromEnrollment,
  isDepartmentOneOnOneEntry,
  resolveSessionEnrollmentPersonIds,
  resolveTermEnrollmentPersonIdsForSession,
  buildRollingApplicabilityByClassId,
  resolveSessionOneOnOneContext,
  isSoloStudentEnrollmentStatus,
  scheduleEnrollmentPeriodContainsDate,
  buildSoloStudentResolver
};
