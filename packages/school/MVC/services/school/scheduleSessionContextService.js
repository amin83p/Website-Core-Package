const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const schoolDataService = require('./schoolDataService');
const schoolIdentityLookupService = require('./schoolIdentityLookupService');
const schoolStudentProfileLinkService = require('./schoolStudentProfileLinkService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const classSessionCapacityService = require('./classSessionCapacityService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');

function cleanPersonId(value) {
    return String(value || '').trim();
}

function normalizeDateOnly(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.slice(0, 10);
}

function buildSessionSummary(classData, session) {
    const classId = toPublicId(classData?.id);
    const sessionId = toPublicId(session?.sessionId || session?.id);
    return {
        classId,
        className: String(classData?.title || classData?.name || classId || '').trim(),
        sessionId,
        date: normalizeDateOnly(session?.date),
        start: String(session?.startTime || '').trim(),
        end: String(session?.endTime || '').trim(),
        status: String(session?.status || '').trim(),
        locked: session?.locked === true || String(session?.locked) === 'true'
    };
}

async function loadSessionContext(classId, sessionId, reqUser) {
    const normalizedClassId = toPublicId(classId);
    const normalizedSessionId = toPublicId(sessionId);
    if (!normalizedClassId || !normalizedSessionId) {
        throw new Error('Class ID and session ID are required.');
    }

    const classData = await schoolDataService.getDataById('classes', normalizedClassId, reqUser);
    if (!classData) throw new Error('Class not found.');

    const sessions = await schoolDataService.getClassSessions(normalizedClassId, reqUser);
    const session = (Array.isArray(sessions) ? sessions : [])
        .find((row) => idsEqual(row?.sessionId || row?.id, normalizedSessionId));
    if (!session) throw new Error('Session not found.');

    const [personsPayload, students] = await Promise.all([
        schoolIdentityLookupService.listSchoolPersonRecords({
            reqUser,
            requireSchoolRole: false,
            query: { limit: 2000 }
        }),
        schoolDataService.fetchAllData('students', {}, reqUser)
    ]);
    const persons = Array.isArray(personsPayload?.allRows)
        ? personsPayload.allRows
        : (Array.isArray(personsPayload?.rows) ? personsPayload.rows : []);
    const studentRows = Array.isArray(students) ? students : [];
    const studentToPersonMap = new Map(
        studentRows
            .map((row) => [toPublicId(row?.id), cleanPersonId(row?.personId)])
            .filter(([studentId, personId]) => Boolean(studentId && personId))
    );
    const personById = new Map(
        persons
            .map((row) => [cleanPersonId(row?.id), row])
            .filter(([id]) => Boolean(id))
    );
    const activeOrgId = String(reqUser?.activeOrgId || classData?.orgId || '').trim();
    const personToStudentMap = schoolStudentProfileLinkService.buildPersonIdToStudentRecordIdMap(studentRows, activeOrgId);

    return {
        classData,
        session,
        sessions,
        persons,
        studentRows,
        studentToPersonMap,
        personById,
        personToStudentMap,
        activeOrgId
    };
}

function resolvePersonDisplayName(person, personId) {
    if (person?.name) {
        const name = `${person.name.first || ''} ${person.name.last || ''}`.trim();
        if (name) return name;
    }
    return `Person ${personId}`;
}

function buildStudentRow(personId, personById, personToStudentMap) {
    const pid = cleanPersonId(personId);
    const person = personById.get(pid);
    return {
        personId: pid,
        name: resolvePersonDisplayName(person, pid),
        studentRecordId: schoolStudentProfileLinkService.resolveStudentRecordId({
            personId: pid,
            personToStudentMap
        })
    };
}

function formatApplicabilityLabel(state = {}) {
    if (!state || typeof state !== 'object') return 'Eligible';
    if (state.expected) return 'Eligible';
    const reason = String(state.reason || '').trim().toLowerCase();
    const map = {
        approved_leave: 'Approved leave',
        makeup_required: 'Make-up required',
        manual_not_applicable: 'Marked N/A',
        enrollment_excluded: 'Excluded from enrollment',
        hour_cap_reached: 'Hour cap reached',
        session_cap_reached: 'Session cap reached',
        not_enrolled: 'Not enrolled',
        student_not_enrolled: 'Not enrolled in class',
        session_date_missing: 'Session date missing'
    };
    return map[reason] || (reason ? reason.replace(/_/g, ' ') : 'Not eligible');
}

async function resolveRosterResolution({
    classData,
    session,
    sessions,
    reqUser,
    studentRows,
    studentToPersonMap,
    activeOrgId
}) {
    const registrationMode = classSessionCapacityService.getClassRegistrationModeKey(classData);
    const sessionDate = normalizeDateOnly(session?.date);

    if (registrationMode === 'rolling') {
        const periodRows = await schoolDataService.getClassEnrollmentPeriodsByClassId(classData.id, reqUser);
        const statusMap = await sessionStatusPolicyService.getStatusMap(classData?.orgId || activeOrgId, { includeInactive: true });
        const applicability = await classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentApplicabilityWithLeaves({
            sessions: Array.isArray(sessions) && sessions.length ? sessions : [session],
            periodRows,
            studentToPersonMap,
            activeOrgId,
            orgId: classData?.orgId || activeOrgId,
            reqUser,
            allowedStatuses: classEnrollmentSessionApplicabilityService.OPEN_OR_HISTORICAL_STATUSES,
            forceNotApplicableSessionKeys: sessionStatusPolicyService.buildForceNotApplicableAttendanceSessionKeys(statusMap, sessions)
        });
        const personIds = new Set();
        const applicabilityByPersonId = new Map();
        applicability.personIds.forEach((personId) => {
            const state = classEnrollmentSessionApplicabilityService.getApplicabilityState(
                applicability.stateByKey,
                personId,
                session,
                session?.sessionId || session?.id
            );
            if (!state) return;
            if (state.expected
                || state.reason === classEnrollmentSessionApplicabilityService.APPLICABILITY_REASON.APPROVED_LEAVE
                || state.reason === classEnrollmentSessionApplicabilityService.APPLICABILITY_REASON.MANUAL_NOT_APPLICABLE
                || state.reason === classEnrollmentSessionApplicabilityService.APPLICABILITY_REASON.MAKEUP_REQUIRED) {
                const normalizedPersonId = cleanPersonId(personId);
                personIds.add(normalizedPersonId);
                applicabilityByPersonId.set(normalizedPersonId, state);
            }
        });
        return { personIds, applicabilityByPersonId, periodRows, registrationMode };
    }

    const rosterStatuses = ['active'];
    const enrollmentSnapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
        classId: classData.id,
        classItem: classData,
        reqUser,
        activeOrgId,
        sessionDates: sessionDate ? [sessionDate] : [],
        startDate: sessionDate,
        endDate: sessionDate,
        canonicalStatuses: rosterStatuses
    });
    const snapshotIds = enrollmentSnapshot?.studentIds instanceof Set
        ? enrollmentSnapshot.studentIds
        : new Set();
    const personIds = new Set();
    snapshotIds.forEach((id) => {
        const studentId = toPublicId(id);
        if (!studentId) return;
        const personId = cleanPersonId(studentToPersonMap.get(studentId));
        if (personId) personIds.add(personId);
    });
    return { personIds, applicabilityByPersonId: new Map(), periodRows: [], registrationMode };
}

function filterSessionsThroughDate(sessions, asOfDate) {
    const cutoff = normalizeDateOnly(asOfDate);
    if (!cutoff) return Array.isArray(sessions) ? sessions : [];
    return (Array.isArray(sessions) ? sessions : [])
        .filter((row) => {
            const sessionDate = normalizeDateOnly(row?.date);
            return sessionDate && sessionDate <= cutoff;
        });
}

function resolvePeriodEndDate(period = {}) {
    const endDate = normalizeDateOnly(period?.endDate);
    const completionDate = normalizeDateOnly(period?.completionDate);
    if (completionDate && endDate) return completionDate < endDate ? completionDate : endDate;
    return completionDate || endDate || '';
}

function buildEnrollmentCapLabel(targetSessionCount, targetHours) {
    const sessions = Number(targetSessionCount);
    const hours = Number(targetHours);
    const parts = [];
    if (Number.isFinite(sessions) && sessions > 0) parts.push(`${sessions} session${sessions === 1 ? '' : 's'}`);
    if (Number.isFinite(hours) && hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
    return parts.join(' / ') || '';
}

function buildConsumedRemainingLabel({
    targetSessionCount = null,
    targetHours = null,
    consumedCount = null,
    consumedHours = null,
    remainingCount = null,
    remainingHours = null
} = {}) {
    const sessionCap = Number(targetSessionCount) > 0;
    const hourCap = Number(targetHours) > 0;
    const consumedParts = [];
    const remainingParts = [];
    if (sessionCap && consumedCount != null) consumedParts.push(String(consumedCount));
    if (hourCap && consumedHours != null) consumedParts.push(`${consumedHours}h`);
    if (sessionCap && remainingCount != null) remainingParts.push(String(remainingCount));
    if (hourCap && remainingHours != null) remainingParts.push(`${remainingHours}h`);
    return {
        consumedLabel: consumedParts.length ? consumedParts.join(' · ') : '—',
        remainingLabel: remainingParts.length ? remainingParts.join(' · ') : '—'
    };
}

function findEnrollmentPeriodRow(periodRows, periodId, personId, studentToPersonMap) {
    const targetPeriodId = toPublicId(periodId);
    const targetPersonId = cleanPersonId(personId);
    return (Array.isArray(periodRows) ? periodRows : []).find((period) => {
        const pid = cleanPersonId(period?.personId || studentToPersonMap.get(toPublicId(period?.studentId)));
        if (targetPersonId && pid !== targetPersonId) return false;
        if (targetPeriodId && !idsEqual(period?.id, targetPeriodId)) return false;
        return true;
    }) || null;
}

async function buildSessionAttendanceList({ classId, sessionId, reqUser }) {
    const context = await loadSessionContext(classId, sessionId, reqUser);
    const {
        classData,
        session,
        sessions,
        personById,
        personToStudentMap,
        studentRows,
        studentToPersonMap,
        activeOrgId
    } = context;

    const rosterResolution = await resolveRosterResolution({
        classData,
        session,
        sessions,
        reqUser,
        studentRows,
        studentToPersonMap,
        activeOrgId
    });
    const activePersonIds = rosterResolution.personIds;
    const applicabilityByPersonId = rosterResolution.applicabilityByPersonId;

    const workingRoster = Array.isArray(session?.roster)
        ? session.roster.map((row) => ({ ...row }))
        : [];
    if (rosterResolution.registrationMode === 'rolling') {
        const filtered = workingRoster.filter((row) => {
            const pid = cleanPersonId(row?.personId);
            return pid && activePersonIds.has(pid);
        });
        workingRoster.length = 0;
        workingRoster.push(...filtered);
    }

    const statusMap = await sessionStatusPolicyService.getStatusMap(classData?.orgId || activeOrgId, { includeInactive: true });
    const forceSessionNotApplicable = sessionStatusPolicyService.shouldForceNotApplicableAttendanceByMap(statusMap, {
        status: session?.status,
        notes: session?.notes
    });

    activePersonIds.forEach((personId) => {
        if (!workingRoster.find((row) => idsEqual(row?.personId, personId))) {
            const applicability = applicabilityByPersonId.get(personId);
            const defaultAttendance = (forceSessionNotApplicable
                || applicability?.reason === classEnrollmentSessionApplicabilityService.APPLICABILITY_REASON.APPROVED_LEAVE)
                ? attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE
                : '';
            workingRoster.push({
                personId,
                attendance: defaultAttendance,
                notes: '',
                comments: []
            });
        }
    });

    const students = workingRoster
        .map((row) => {
            const pid = cleanPersonId(row?.personId);
            if (!pid) return null;
            const normalized = attendanceMatrixMetricsService.normalizeLegacyAbsenceExcusedRecord(row);
            const applicability = applicabilityByPersonId.get(pid);
            const notes = String(normalized?.notes || '').trim();
            const rosterStudentNotes = String(normalized?.rosterStudentNotes || '').trim();
            const hasComments = Array.isArray(normalized?.comments) && normalized.comments.length > 0;
            const notesPreview = [notes, rosterStudentNotes].filter(Boolean).join(' · ');
            return {
                ...buildStudentRow(pid, personById, personToStudentMap),
                attendance: String(normalized?.attendance || '').trim(),
                lateMinutes: Number(normalized?.lateMinutes) || 0,
                earlyLeaveMinutes: Number(normalized?.earlyLeaveMinutes) || 0,
                lateExcused: normalized?.lateExcused === true,
                earlyLeaveExcused: normalized?.earlyLeaveExcused === true,
                absenceExcused: normalized?.absenceExcused === true || normalized?.status === 'excused',
                hasNotes: Boolean(notes || rosterStudentNotes || hasComments),
                notesPreview,
                commentCount: hasComments ? normalized.comments.length : 0,
                applicability: applicability
                    ? formatApplicabilityLabel(applicability)
                    : (rosterResolution.registrationMode === 'rolling' ? 'Eligible' : 'Enrolled')
            };
        })
        .filter(Boolean)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    return {
        session: buildSessionSummary(classData, session),
        students
    };
}

async function buildSessionEnrollmentList({ classId, sessionId, reqUser, asOfDate = '' }) {
    const context = await loadSessionContext(classId, sessionId, reqUser);
    const {
        classData,
        session,
        sessions,
        personById,
        personToStudentMap,
        studentRows,
        studentToPersonMap,
        activeOrgId
    } = context;

    const registrationMode = classSessionCapacityService.getClassRegistrationModeKey(classData);
    const sessionDate = normalizeDateOnly(session?.date);
    const effectiveAsOfDate = normalizeDateOnly(asOfDate) || sessionDate;
    const students = [];

    if (registrationMode === 'rolling') {
        const periodRows = await schoolDataService.getClassEnrollmentPeriodsByClassId(classData.id, reqUser);
        const statusMap = await sessionStatusPolicyService.getStatusMap(classData?.orgId || activeOrgId, { includeInactive: true });
        const sessionsForMetrics = filterSessionsThroughDate(sessions, effectiveAsOfDate);
        const applicability = await classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentApplicabilityWithLeaves({
            sessions: sessionsForMetrics.length ? sessionsForMetrics : [session],
            periodRows,
            studentToPersonMap,
            activeOrgId,
            orgId: classData?.orgId || activeOrgId,
            reqUser,
            allowedStatuses: classEnrollmentSessionApplicabilityService.OPEN_OR_HISTORICAL_STATUSES,
            forceNotApplicableSessionKeys: sessionStatusPolicyService.buildForceNotApplicableAttendanceSessionKeys(statusMap, sessionsForMetrics)
        });
        const seenPersonIds = new Set();
        applicability.personIds.forEach((personId) => {
            const pid = cleanPersonId(personId);
            if (!pid || seenPersonIds.has(pid)) return;
            const enrollmentWindow = classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentWindowForPerson({
                periodRows,
                studentToPersonMap,
                personId: pid,
                session,
                activeOrgId,
                allowedStatuses: classEnrollmentSessionApplicabilityService.OPEN_OR_HISTORICAL_STATUSES
            });
            if (enrollmentWindow.withinEnrollmentWindow !== true) return;
            seenPersonIds.add(pid);

            const applicabilityState = classEnrollmentSessionApplicabilityService.getApplicabilityState(
                applicability.stateByKey,
                pid,
                session,
                session?.sessionId || session?.id
            );
            const periodId = toPublicId(enrollmentWindow.periodId || applicabilityState?.periodId);
            const period = findEnrollmentPeriodRow(periodRows, periodId, pid, studentToPersonMap);
            const summary = periodId ? applicability.summariesByPeriodId.get(periodId) : null;
            const useSummaryMetrics = effectiveAsOfDate !== sessionDate && summary;
            const targetSessionCount = Number(period?.targetSessionCount || summary?.targetSessionCount || applicabilityState?.targetSessionCount) || null;
            const targetHours = Number(period?.targetHours || summary?.targetHours || applicabilityState?.targetHours) || null;
            const consumedCount = useSummaryMetrics ? summary.consumedCount : (applicabilityState?.consumedCount ?? summary?.consumedCount ?? null);
            const consumedHours = useSummaryMetrics ? summary.consumedHours : (applicabilityState?.consumedHours ?? summary?.consumedHours ?? null);
            const remainingCount = useSummaryMetrics
                ? summary.remainingCount
                : (targetSessionCount > 0 && consumedCount != null ? Math.max(0, targetSessionCount - consumedCount) : summary?.remainingCount ?? null);
            const remainingHours = useSummaryMetrics
                ? summary.remainingHours
                : (targetHours > 0 && consumedHours != null ? Math.max(0, Number((targetHours - consumedHours).toFixed(2))) : summary?.remainingHours ?? null);
            const usage = buildConsumedRemainingLabel({
                targetSessionCount,
                targetHours,
                consumedCount,
                consumedHours,
                remainingCount,
                remainingHours
            });

            students.push({
                ...buildStudentRow(pid, personById, personToStudentMap),
                eligible: true,
                reason: 'Within enrollment window',
                periodId,
                enrollmentStartDate: normalizeDateOnly(period?.startDate),
                enrollmentEndDate: resolvePeriodEndDate(period),
                targetSessionCount: targetSessionCount || null,
                targetHours: targetHours || null,
                capLabel: buildEnrollmentCapLabel(targetSessionCount, targetHours),
                consumedCount,
                consumedHours,
                remainingCount,
                remainingHours,
                consumedLabel: usage.consumedLabel,
                remainingLabel: usage.remainingLabel
            });
        });
    } else {
        const enrollmentSnapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
            classId: classData.id,
            classItem: classData,
            reqUser,
            activeOrgId,
            sessionDates: sessionDate ? [sessionDate] : [],
            startDate: sessionDate,
            endDate: sessionDate,
            canonicalStatuses: ['active']
        });
        const snapshotIds = enrollmentSnapshot?.studentIds instanceof Set
            ? enrollmentSnapshot.studentIds
            : new Set();
        snapshotIds.forEach((studentId) => {
            const sid = toPublicId(studentId);
            if (!sid) return;
            const personId = cleanPersonId(studentToPersonMap.get(sid));
            if (!personId) return;
            students.push({
                ...buildStudentRow(personId, personById, personToStudentMap),
                eligible: true,
                reason: 'Active enrollment',
                periodId: '',
                enrollmentStartDate: '',
                enrollmentEndDate: '',
                targetSessionCount: null,
                targetHours: null,
                capLabel: '',
                consumedCount: null,
                consumedHours: null,
                remainingCount: null,
                remainingHours: null,
                consumedLabel: '—',
                remainingLabel: '—'
            });
        });
    }

    students.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    return {
        session: buildSessionSummary(classData, session),
        asOfDate: effectiveAsOfDate,
        asOfMode: effectiveAsOfDate === sessionDate ? 'session' : 'current',
        students
    };
}

module.exports = {
    buildSessionAttendanceList,
    buildSessionEnrollmentList,
    buildSessionSummary
};
