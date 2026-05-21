// MVC/controllers/school/scheduleController.js
const dataService = require('../../services/dataService');
const { idsEqual } = require('../../utils/idAdapter');
const schoolDataService = require('../../services/school/schoolDataService'); 
const schoolRepositories = require('../../repositories/school');
const adminChekersService = require('../../services/adminChekersService');
const sessionStatusPolicyService = require('../../services/school/sessionStatusPolicyService');
const classEnrollmentReadService = require('../../services/school/classEnrollmentReadService');
const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });
const PERIOD_KEYS = Object.freeze(['day', 'week', 'month', 'season', 'year']);
const PERIOD_LABELS = Object.freeze({
    day: 'Daily',
    week: 'Weekly',
    month: 'Monthly',
    season: 'Seasonal',
    year: 'Yearly'
});

function normalizeId(value) {
    return String(value || '').trim();
}

function normalizeTime(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return raw;
    const hour = Math.max(0, Math.min(23, Number(match[1]) || 0));
    const minute = Math.max(0, Math.min(59, Number(match[2]) || 0));
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseDateOrToday(value) {
    const raw = String(value || '').trim();
    if (!raw) return new Date();
    const parsed = new Date(`${raw}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toIsoDate(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function addDays(dateObj, days) {
    const next = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    next.setDate(next.getDate() + days);
    return next;
}

function buildRangeLabel(startIso, endIso) {
    if (!startIso || !endIso) return '';
    if (startIso === endIso) return startIso;
    return `${startIso} -> ${endIso}`;
}

function buildPeriodRanges(anchorDate) {
    const anchor = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());

    const dayStart = new Date(anchor);
    const dayEnd = new Date(anchor);

    const weekOffset = (anchor.getDay() + 6) % 7;
    const weekStart = addDays(anchor, -weekOffset);
    const weekEnd = addDays(weekStart, 6);

    const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);

    const seasonStartMonth = Math.floor(anchor.getMonth() / 3) * 3;
    const seasonStart = new Date(anchor.getFullYear(), seasonStartMonth, 1);
    const seasonEnd = new Date(anchor.getFullYear(), seasonStartMonth + 3, 0);

    const yearStart = new Date(anchor.getFullYear(), 0, 1);
    const yearEnd = new Date(anchor.getFullYear(), 11, 31);

    const ranges = {
        day: { start: toIsoDate(dayStart), end: toIsoDate(dayEnd) },
        week: { start: toIsoDate(weekStart), end: toIsoDate(weekEnd) },
        month: { start: toIsoDate(monthStart), end: toIsoDate(monthEnd) },
        season: { start: toIsoDate(seasonStart), end: toIsoDate(seasonEnd) },
        year: { start: toIsoDate(yearStart), end: toIsoDate(yearEnd) }
    };

    PERIOD_KEYS.forEach((key) => {
        ranges[key].label = buildRangeLabel(ranges[key].start, ranges[key].end);
    });

    return ranges;
}

function normalizePeriod(value) {
    const key = String(value || '').trim().toLowerCase();
    return PERIOD_KEYS.includes(key) ? key : 'week';
}

function parseTimeToMinutes(value) {
    const normalized = normalizeTime(value);
    if (!normalized || !normalized.includes(':')) return null;
    const [h, m] = normalized.split(':');
    const hour = Number(h);
    const minute = Number(m);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return (hour * 60) + minute;
}

function computeDurationHours(session) {
    const explicit = Number(session?.durationHours);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;

    const startMinutes = parseTimeToMinutes(session?.startTime);
    const endMinutes = parseTimeToMinutes(session?.endTime);
    if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) return 0;
    return Number(((endMinutes - startMinutes) / 60).toFixed(2));
}

function inferAssignmentTargetType(assignment) {
    const explicit = String(assignment?.targetType || '').trim().toLowerCase();
    if (explicit === 'date') return 'date';
    if (explicit === 'session') return 'session';
    return String(assignment?.sessionId || '').trim() ? 'session' : 'date';
}

function inferAssignmentReportScope(assignment) {
    const explicit = String(assignment?.reportScope || '').trim().toLowerCase();
    if (['class', 'each_student', 'selected_students'].includes(explicit)) return explicit;
    return 'class';
}

function resolveAssignmentTargetDate(assignment) {
    const targetType = inferAssignmentTargetType(assignment);
    if (targetType === 'session') return String(assignment?.sessionDate || assignment?.dueDate || '').trim();
    return String(assignment?.dueDate || assignment?.sessionDate || '').trim();
}

function normalizeTaskWindowTime(value) {
    const normalized = normalizeTime(value);
    if (!normalized || !/^\d{2}:\d{2}$/.test(normalized)) return '';
    return normalized;
}

function resolveAssignmentTimeWindow(assignment, classSessionsById = new Map()) {
    const fromAssignmentStart = normalizeTaskWindowTime(assignment?.taskStartTime);
    const fromAssignmentEnd = normalizeTaskWindowTime(assignment?.taskEndTime);
    if (fromAssignmentStart && fromAssignmentEnd && fromAssignmentStart < fromAssignmentEnd) {
        return { start: fromAssignmentStart, end: fromAssignmentEnd };
    }

    const classId = normalizeId(assignment?.classId);
    const sessionId = normalizeId(assignment?.sessionId);
    if (!classId || !sessionId) return { start: '', end: '' };
    const classSessions = classSessionsById.get(classId) || [];
    const session = classSessions.find((row) => normalizeId(row?.sessionId) === sessionId) || null;
    const start = normalizeTaskWindowTime(session?.startTime);
    const end = normalizeTaskWindowTime(session?.endTime);
    if (!start || !end || start >= end) return { start: '', end: '' };
    return { start, end };
}

function normalizeSessionStatus(session) {
    return sessionStatusPolicyService.normalizeSessionStatus(session?.status, session?.notes);
}

function hasInstructorMatch(classRow, personId) {
    const normalizedPersonId = normalizeId(personId);
    const instructors = Array.isArray(classRow?.instructors) ? classRow.instructors : [];
    return instructors.some((inst) => idsEqual(inst?.personId, normalizedPersonId));
}

function buildTeacherPersonMap(teachers = []) {
    const map = new Map();
    (Array.isArray(teachers) ? teachers : []).forEach((teacher) => {
        const teacherId = normalizeId(teacher?.id);
        const personId = normalizeId(teacher?.personId);
        if (teacherId && personId) {
            map.set(teacherId, personId);
        }
    });
    return map;
}

function resolveLinkedPersonId(rawId, teacherPersonMap = new Map()) {
    const normalized = normalizeId(rawId);
    if (!normalized) return '';
    return normalizeId(teacherPersonMap.get(normalized) || normalized);
}

function hasInstructorMatchWithTeacherLink(classRow, personId, teacherPersonMap = new Map()) {
    const normalizedPersonId = normalizeId(personId);
    const instructors = Array.isArray(classRow?.instructors) ? classRow.instructors : [];
    return instructors.some((inst) => {
        const linkedPersonId = resolveLinkedPersonId(inst?.personId, teacherPersonMap);
        return linkedPersonId && idsEqual(linkedPersonId, normalizedPersonId);
    });
}

function hasSessionDeliveryMatch(classRow, personId, teacherPersonMap = new Map()) {
    const normalizedPersonId = normalizeId(personId);
    const sessions = Array.isArray(classRow?.sessions) ? classRow.sessions : [];
    return sessions.some((session) => {
        const deliveredBy = resolveLinkedPersonId(session?.delivery?.deliveredBy, teacherPersonMap);
        return deliveredBy && idsEqual(deliveredBy, normalizedPersonId);
    });
}

function buildPersonDisplayName(person, fallbackId = '') {
    const fullName = `${person?.name?.first || ''} ${person?.name?.last || ''}`.trim();
    if (fullName) return fullName;
    if (person?.displayName) return String(person.displayName).trim();
    return String(fallbackId || person?.id || '').trim();
}

function extractPersonRolesInOrg(person, orgId) {
    const activeOrgId = normalizeId(orgId);
    const memberships = Array.isArray(person?.organizations) ? person.organizations : [];
    const roles = new Set();

    memberships.forEach((org) => {
        if (activeOrgId && !idsEqual(org?.orgId, activeOrgId)) return;
        const memberStatus = String(org?.memberStatus || 'active').trim().toLowerCase();
        if (memberStatus && memberStatus !== 'active') return;
        const rawRoles = Array.isArray(org?.roles)
            ? org.roles
            : (org?.role ? [org.role] : []);
        rawRoles.forEach((role) => {
            const normalized = String(role || '').trim().toLowerCase();
            if (normalized) roles.add(normalized);
        });
    });

    return [...roles];
}

function sortEventsChronologically(events) {
    events.sort((a, b) => {
        const aDate = new Date(`${a.date}T${a.start || '00:00'}`);
        const bDate = new Date(`${b.date}T${b.start || '00:00'}`);
        return aDate - bDate;
    });
}

function normalizeClassRegistrationMode(value) {
    return String(value || '').trim().toLowerCase() === 'rolling' ? 'rolling' : 'term_based';
}

function buildClassLifecycleSnapshot(classRow) {
    const row = classRow || {};
    const registrationMode = normalizeClassRegistrationMode(row.registrationMode);
    const parsedCycleNo = Number.parseInt(String(row.cycleNo || '').trim(), 10);
    const cycleNo = Number.isFinite(parsedCycleNo) && parsedCycleNo > 0 ? parsedCycleNo : 1;
    return {
        registrationMode,
        cycleNo,
        cycleGroupId: normalizeId(row.cycleGroupId),
        cycleStartDate: String(row.cycleStartDate || '').trim(),
        cycleEndDate: String(row.cycleEndDate || '').trim(),
        isClosedForNewEnrollment: row.isClosedForNewEnrollment === true || String(row.isClosedForNewEnrollment || '').trim().toLowerCase() === 'true',
        previousClassId: normalizeId(row.previousClassId),
        nextClassId: normalizeId(row.nextClassId)
    };
}

function normalizeDateOnly(value) {
    const token = String(value || '').trim();
    if (!token) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
    const parsed = new Date(token);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
}

function isOpenCanonicalEnrollmentPeriod(row, referenceDate = '') {
    const status = String(row?.status || '').trim().toLowerCase();
    if (!['active', 'planned'].includes(status)) return false;
    const day = normalizeDateOnly(referenceDate) || new Date().toISOString().slice(0, 10);
    const start = normalizeDateOnly(row?.startDate);
    const end = normalizeDateOnly(row?.endDate);
    if (start && start > day && status !== 'planned') return false;
    if (end && end < day) return false;
    return true;
}

function isAllowedSessionEmbeddedReportOverlap(leftEvent, rightEvent) {
    const aType = String(leftEvent?.eventType || '').trim().toLowerCase();
    const bType = String(rightEvent?.eventType || '').trim().toLowerCase();

    // Explicitly marked report tasks are treated as intentionally permitted overlap.
    if (aType === 'report_task' && Boolean(leftEvent?.conflictPermitted)) return true;
    if (bType === 'report_task' && Boolean(rightEvent?.conflictPermitted)) return true;

    const hasReportTask = aType === 'report_task' || bType === 'report_task';
    const hasClassSession = aType === 'class_session' || bType === 'class_session';
    if (!hasReportTask || !hasClassSession) return false;

    const reportEvent = aType === 'report_task' ? leftEvent : rightEvent;
    const sessionEvent = aType === 'class_session' ? leftEvent : rightEvent;
    const targetType = String(reportEvent?.targetType || '').trim().toLowerCase();
    if (targetType !== 'session') return false;

    const sameDate = String(reportEvent?.date || '') === String(sessionEvent?.date || '');
    const sameClass = idsEqual(reportEvent?.classId, sessionEvent?.classId);
    if (!sameDate || !sameClass) return false;

    const reportSessionId = normalizeId(reportEvent?.sourceSessionId);
    const sessionId = normalizeId(sessionEvent?.sessionId);
    if (reportSessionId && sessionId) return reportSessionId === sessionId;

    return true;
}

function markOverlappingEvents(events) {
    for (let i = 0; i < events.length - 1; i++) {
        const current = events[i];
        const next = events[i + 1];

        if (current.date !== next.date) continue;

        const currentEnd = new Date(`${current.date}T${current.end || '00:00'}`);
        const nextStart = new Date(`${next.date}T${next.start || '00:00'}`);
        if (currentEnd > nextStart) {
            if (isAllowedSessionEmbeddedReportOverlap(current, next)) continue;
            current.hasOverlap = true;
            next.hasOverlap = true;
        }
    }
}

function filterEventsByRange(events, range) {
    if (!range?.start || !range?.end) return [];
    return events.filter((event) => event.date >= range.start && event.date <= range.end);
}

function buildReportDetailUrl({ assignment, personId, role }) {
    const assignmentId = normalizeId(assignment?.id);
    if (!assignmentId) return '';

    if (role === 'Student') {
        const params = new URLSearchParams();
        params.set('studentId', normalizeId(personId));
        const fallbackTeacher = normalizeId((assignment?.teacherIds || [])[0]);
        if (fallbackTeacher) params.set('teacherId', fallbackTeacher);
        return `/school/reports/instances/start/${encodeURIComponent(assignmentId)}?${params.toString()}`;
    }

    const params = new URLSearchParams();
    params.set('teacherId', normalizeId(personId));
    return `/school/reports/instances/start/${encodeURIComponent(assignmentId)}?${params.toString()}`;
}

async function appendReportEventsForPerson({
    events,
    assignments,
    templateMap,
    personId,
    personOrgRoles,
    startDate,
    endDate,
    classMap,
    classSessionsById,
    studentClassIds,
    linkedStudentIds = [],
    reqUser,
    isStudentActiveOnDate = null
}) {
    const normalizedPersonId = normalizeId(personId);
    if (!normalizedPersonId) return;
    const isLikelyStaffOnly = personOrgRoles.includes('school_staff') && !personOrgRoles.includes('school_teacher');

    for (const assignment of (Array.isArray(assignments) ? assignments : [])) {
        const status = String(assignment?.status || '').trim().toLowerCase();
        if (status !== 'active') continue;

        const teacherIds = Array.isArray(assignment?.teacherIds)
            ? assignment.teacherIds.map((id) => normalizeId(id)).filter(Boolean)
            : [];
        const isTeacherAssigned = teacherIds.includes(normalizedPersonId);

        const classId = normalizeId(assignment?.classId);
        const classRow = classMap.get(classId) || null;
        let classSessions = classSessionsById.get(classId) || null;
        if (!classSessions && classId) {
            // eslint-disable-next-line no-await-in-loop
            classSessions = await schoolDataService.getClassSessions(classId, reqUser);
            classSessionsById.set(classId, Array.isArray(classSessions) ? classSessions : []);
        }
        classSessions = classSessionsById.get(classId) || [];
        const reportScope = inferAssignmentReportScope(assignment);

        let date = resolveAssignmentTargetDate(assignment);
        if (!date) {
            const sourceSessionId = normalizeId(assignment?.sessionId);
            if (sourceSessionId) {
                const matchedSession = classSessions.find((row) => normalizeId(row?.sessionId) === sourceSessionId) || null;
                date = normalizeId(matchedSession?.date);
            }
        }
        if (!date || date < startDate || date > endDate) continue;

        let isStudentAssigned = false;
        if (reportScope === 'selected_students') {
            const selectedStudents = Array.isArray(assignment?.targetStudentIds)
                ? assignment.targetStudentIds.map((id) => normalizeId(id)).filter(Boolean)
                : [];
            const linked = Array.isArray(linkedStudentIds) ? linkedStudentIds : [];
            const selectedMatch = linked.some((sid) => selectedStudents.some((t) => idsEqual(t, sid)));
            if (selectedMatch) {
                if (typeof isStudentActiveOnDate === 'function') {
                    // eslint-disable-next-line no-await-in-loop
                    isStudentAssigned = await isStudentActiveOnDate({
                        classId,
                        classRow,
                        sessions: classSessions,
                        sessionDate: date
                    });
                } else {
                    isStudentAssigned = true;
                }
            }
        } else if (reportScope === 'each_student') {
            if (typeof isStudentActiveOnDate === 'function') {
                // eslint-disable-next-line no-await-in-loop
                isStudentAssigned = await isStudentActiveOnDate({
                    classId,
                    classRow,
                    sessions: classSessions,
                    sessionDate: date
                });
            } else {
                isStudentAssigned = studentClassIds.has(classId);
            }
        }

        if (!isTeacherAssigned && !isStudentAssigned) continue;

        const window = resolveAssignmentTimeWindow(assignment, classSessionsById);
        if (!window.start || !window.end) continue;

        const windowDurationHours = Number((((parseTimeToMinutes(window.end) || 0) - (parseTimeToMinutes(window.start) || 0)) / 60).toFixed(2));
        let durationHoursForEvent = 0;
        if (assignment?.timesheetReflection === true) {
            if (isTeacherAssigned) {
                const alloc = Number(assignment?.allocatedHours);
                if (Number.isFinite(alloc) && alloc > 0) {
                    durationHoursForEvent = Number(alloc.toFixed(2));
                }
            } else {
                durationHoursForEvent = windowDurationHours;
            }
        }

        const templateTitle = String(templateMap.get(normalizeId(assignment?.templateId)) || assignment?.templateId || 'Report').trim();
        const classTitle = String(classRow?.title || classId || 'Class').trim() || 'Class';
        const classLifecycle = buildClassLifecycleSnapshot(classRow);
        const role = isTeacherAssigned ? (isLikelyStaffOnly ? 'Staff' : 'Teacher') : 'Student';
        const roleLabel = role;
        const eventId = `RPT-${normalizeId(assignment?.id)}-${role.toLowerCase()}-${normalizedPersonId}`;

        events.push({
            id: eventId,
            sessionId: '',
            sourceSessionId: normalizeId(assignment?.sessionId),
            targetType: inferAssignmentTargetType(assignment),
            conflictPermitted: Boolean(assignment?.conflictPermitted),
            assignmentId: normalizeId(assignment?.id),
            personId: normalizedPersonId,
            date,
            start: window.start,
            end: window.end,
            classId,
            className: `${classTitle} | Report: ${templateTitle}`,
            classLifecycle,
            duration: durationHoursForEvent,
            status: 'scheduled',
            locked: false,
            roles: [role],
            roleLabel,
            hasOverlap: false,
            eventType: 'report_task',
            detailsUrl: buildReportDetailUrl({ assignment, personId: normalizedPersonId, role })
        });
    }
}

function summarizeEvents(events, statusMeta = []) {
    const statusCounts = {};
    const knownCodes = new Set(
        (Array.isArray(statusMeta) ? statusMeta : [])
            .map((row) => sessionStatusPolicyService.normalizeStatusCode(row?.code))
            .filter(Boolean)
    );
    knownCodes.forEach((code) => { statusCounts[code] = 0; });
    statusCounts.other = 0;

    let totalHours = 0;
    for (const event of events) {
        totalHours += Number(event?.duration || 0);
        const status = sessionStatusPolicyService.normalizeStatusCode(event?.status || '');
        if (status && Object.prototype.hasOwnProperty.call(statusCounts, status)) {
            statusCounts[status] += 1;
        } else {
            statusCounts.other += 1;
        }
    }

    return {
        sessionCount: events.length,
        totalHours: Number(totalHours.toFixed(2)),
        statusCounts
    };
}

async function getPersonById(personId, reqUser) {
    const targetPersonId = normalizeId(personId);
    if (!targetPersonId) return null;

    const direct = await dataService.getDataById('persons', targetPersonId, reqUser, PERSON_QUERY_OPTIONS);
    if (direct) return direct;

    const persons = await dataService.fetchData('persons', {
        q: targetPersonId,
        type: 'exact_match',
        searchFields: 'id'
    }, reqUser, PERSON_QUERY_OPTIONS);

    return (persons || []).find((row) => idsEqual(row?.id, targetPersonId)) || null;
}

async function buildEventsForPersonAndRange({ personId, startDate, endDate, reqUser, activeOrgId, statusMap = null }) {
    const [studentIndex, allClasses, allAssignments, allTemplates, allTeachers, allStudents] = await Promise.all([
        schoolDataService.getStudentIndex(),
        schoolDataService.fetchData('classes', {}, reqUser),
        schoolRepositories.reportAssignments.list({ query: {}, scope: { canViewAll: true } }),
        schoolRepositories.reportTemplates.list({ query: {}, scope: { canViewAll: true } }),
        schoolDataService.fetchData('teachers', {}, reqUser),
        schoolDataService.fetchData('students', {}, reqUser)
    ]);
    const teacherPersonMap = buildTeacherPersonMap(allTeachers);
    const normalizedPersonId = resolveLinkedPersonId(personId, teacherPersonMap);
    const effectiveStatusMap = statusMap instanceof Map
        ? statusMap
        : await sessionStatusPolicyService.getStatusMap(activeOrgId || '', { includeInactive: true });
    const classMap = new Map(
        (allClasses || [])
            .map((row) => [normalizeId(row?.id), row])
            .filter(([id]) => Boolean(id))
    );
    const classSessionsById = new Map();
    const templateTitleMap = new Map(
        (Array.isArray(allTemplates) ? allTemplates : [])
            .map((row) => [normalizeId(row?.id), String(row?.title || '').trim()])
            .filter(([id]) => Boolean(id))
    );

    const person = await getPersonById(normalizedPersonId, reqUser);
    const personName = buildPersonDisplayName(person, normalizedPersonId);
    const personOrgRoles = extractPersonRolesInOrg(person, activeOrgId);
    const instructorRoleLabel =
        personOrgRoles.includes('school_staff') && !personOrgRoles.includes('school_teacher')
            ? 'Staff'
            : 'Teacher';

    const studentClassIds = new Set(
        [
            ...(studentIndex?.[normalizedPersonId]?.enrolled || []),
            ...(studentIndex?.[normalizedPersonId]?.waitlisted || [])
        ]
            .map((id) => normalizeId(id))
            .filter(Boolean)
    );
    const linkedStudentIds = (Array.isArray(allStudents) ? allStudents : [])
        .filter((row) => idsEqual(row?.personId, normalizedPersonId))
        .map((row) => normalizeId(row?.id))
        .filter(Boolean);

    const canonicalPeriodsByStudent = new Map();
    let hasCanonicalPeriods = false;
    if (linkedStudentIds.length) {
        const canonicalRowsByStudent = await Promise.all(linkedStudentIds.map(async (studentId) => {
            const rows = await schoolDataService.getClassEnrollmentPeriodsByStudentId(studentId, reqUser);
            return {
                studentId,
                rows: (Array.isArray(rows) ? rows : [])
                    .filter((row) => !activeOrgId || idsEqual(row?.orgId, activeOrgId))
            };
        }));

        canonicalRowsByStudent.forEach(({ studentId, rows }) => {
            canonicalPeriodsByStudent.set(studentId, rows);
            if (rows.length) hasCanonicalPeriods = true;
            rows.forEach((row) => {
                const classId = normalizeId(row?.classId);
                if (!classId) return;
                const start = normalizeDateOnly(row?.startDate);
                const end = normalizeDateOnly(row?.endDate);
                const overlapsVisibleRange = (!start || start <= endDate) && (!end || end >= startDate);
                if (overlapsVisibleRange) studentClassIds.add(classId);
            });
        });
    }

    const studentActiveCache = new Map();
    const isStudentActiveOnDate = async ({ classId = '', classRow = null, sessions = [], sessionDate = '' } = {}) => {
        const normalizedClassId = normalizeId(classId);
        const normalizedDate = normalizeDateOnly(sessionDate);
        if (!normalizedClassId || !normalizedDate) return false;

        const cacheKey = `${normalizedClassId}::${normalizedDate}`;
        if (studentActiveCache.has(cacheKey)) return studentActiveCache.get(cacheKey);

        let isActive = false;
        if (linkedStudentIds.length && hasCanonicalPeriods) {
            for (const studentId of linkedStudentIds) {
                const rows = canonicalPeriodsByStudent.get(studentId) || [];
                if (rows.some((row) => idsEqual(row?.classId, normalizedClassId) && isOpenCanonicalEnrollmentPeriod(row, normalizedDate))) {
                    isActive = true;
                    break;
                }
            }
        } else if (linkedStudentIds.length) {
            for (const studentId of linkedStudentIds) {
                // eslint-disable-next-line no-await-in-loop
                const result = await classEnrollmentReadService.hasActiveEnrollmentForStudentInClass({
                    classId: normalizedClassId,
                    studentId,
                    classItem: classRow,
                    reqUser,
                    activeOrgId,
                    referenceDate: normalizedDate
                });
                if (Boolean(result?.exists)) {
                    isActive = true;
                    break;
                }
            }
        } else {
            isActive = studentClassIds.has(normalizedClassId);
        }

        if (!isActive) {
            isActive = studentClassIds.has(normalizedClassId);
        }

        studentActiveCache.set(cacheKey, isActive);
        return isActive;
    };

    const candidateClassIds = new Set();
    studentClassIds.forEach((id) => candidateClassIds.add(id));

    for (const classRow of allClasses || []) {
        const classId = normalizeId(classRow?.id);
        if (!classId) continue;
        if (
            hasInstructorMatchWithTeacherLink(classRow, normalizedPersonId, teacherPersonMap)
            || studentClassIds.has(classId)
            || hasSessionDeliveryMatch(classRow, normalizedPersonId, teacherPersonMap)
        ) {
            candidateClassIds.add(classId);
        }
    }

    const classIdsToScan = candidateClassIds.size
        ? [...candidateClassIds]
        : [...classMap.keys()];

    const events = [];

    for (const classId of classIdsToScan) {
        const classDef = classMap.get(classId) || null;
        const classHasInstructor = hasInstructorMatchWithTeacherLink(classDef, normalizedPersonId, teacherPersonMap);
        const sessions = await schoolDataService.getClassSessions(classId, reqUser);
        classSessionsById.set(classId, Array.isArray(sessions) ? sessions : []);

        for (const session of sessions || []) {
            const sessionDate = normalizeId(session?.date);
            if (!sessionDate || sessionDate < startDate || sessionDate > endDate) continue;

            const deliveredBy = resolveLinkedPersonId(session?.delivery?.deliveredBy, teacherPersonMap);
            const excludeTeacher = sessionStatusPolicyService.shouldExcludeFromTeacherIndexByMap(effectiveStatusMap, {
                status: session?.status,
                notes: session?.notes
            });
            const excludeStudent = sessionStatusPolicyService.shouldExcludeFromStudentIndexByMap(effectiveStatusMap, {
                status: session?.status,
                notes: session?.notes
            });
            const isInstructorEvent = !excludeTeacher && (classHasInstructor || (deliveredBy && idsEqual(deliveredBy, normalizedPersonId)));
            const isStudentEvent = !excludeStudent && (await isStudentActiveOnDate({
                classId,
                classRow: classDef,
                sessions,
                sessionDate
            }));
            if (!isInstructorEvent && !isStudentEvent) continue;

            const roles = [];
            if (isInstructorEvent) roles.push(instructorRoleLabel);
            if (isStudentEvent) roles.push('Student');
            if (!roles.length) roles.push('Participant');

            const sessionId = normalizeId(session?.sessionId);
            const eventId = sessionId || `${classId}-${sessionDate}-${normalizeTime(session?.startTime) || '00:00'}`;
            const className = classDef?.title || classDef?.name || `Class ${classId}`;
            const classLifecycle = buildClassLifecycleSnapshot(classDef);

            events.push({
                id: eventId,
                sessionId,
                sourceSessionId: '',
                targetType: 'session',
                conflictPermitted: false,
                personId: normalizedPersonId,
                date: sessionDate,
                start: normalizeTime(session?.startTime),
                end: normalizeTime(session?.endTime),
                classId,
                className: String(className || '').trim() || `Class ${classId}`,
                classLifecycle,
                duration: computeDurationHours(session),
                status: normalizeSessionStatus(session),
                locked: session?.locked === true || String(session?.locked) === 'true',
                roles,
                roleLabel: roles.join(' / '),
                hasOverlap: false,
                eventType: 'class_session'
            });
        }
    }

    await appendReportEventsForPerson({
        events,
        assignments: (Array.isArray(allAssignments) ? allAssignments : []).filter((row) => {
            if (!activeOrgId) return true;
            return idsEqual(row?.orgId, activeOrgId);
        }),
        templateMap: templateTitleMap,
        personId: normalizedPersonId,
        personOrgRoles,
        startDate,
        endDate,
        classMap,
        classSessionsById,
        studentClassIds,
        linkedStudentIds,
        reqUser,
        isStudentActiveOnDate
    });

    sortEventsChronologically(events);
    markOverlappingEvents(events);

    return { events, personName, personOrgRoles };
}

async function showMySchedulePage(req, res) {
    try {
        const isAdminViewer = adminChekersService.isOrgAdmin(req.user);
        const queryPersonId = normalizeId(req.query.personId);
        const queryPersonName = String(req.query.personName || '').trim();

        let selfPersonId = '';
        let selfPersonName = '';

        if (!isAdminViewer) {
            selfPersonId = normalizeId(req.user?.personId);
            if (!selfPersonId) {
                throw new Error('Your account is not linked to a person profile. Contact an administrator.');
            }
            const person = await getPersonById(selfPersonId, req.user);
            selfPersonName = buildPersonDisplayName(person, selfPersonId);
        }

        let prefillPersonId = '';
        let prefillPersonName = '';
        if (isAdminViewer && queryPersonId) {
            const selectedPerson = await getPersonById(queryPersonId, req.user);
            prefillPersonId = queryPersonId;
            prefillPersonName = queryPersonName || buildPersonDisplayName(selectedPerson, queryPersonId);
        } else if (!isAdminViewer) {
            prefillPersonId = selfPersonId;
            prefillPersonName = selfPersonName;
        }

        res.render('school/schedule/mySchedule', {
            title: 'Schedule Overview',
            includeModal: true,
            user: req.user,
            isAdminViewer,
            selfPersonId,
            selfPersonName,
            prefillPersonId,
            prefillPersonName
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
}

async function getMyScheduleData(req, res) {
    try {
        const isAdminViewer = adminChekersService.isOrgAdmin(req.user);
        const requestedPersonId = normalizeId(req.query.personId);
        const selfPersonId = normalizeId(req.user?.personId);
        const targetPersonId = isAdminViewer ? requestedPersonId : selfPersonId;

        if (!targetPersonId) {
            if (isAdminViewer) throw new Error('Select a person to view schedule.');
            throw new Error('Your user account is not linked to a person profile.');
        }
        if (!isAdminViewer && requestedPersonId && !idsEqual(requestedPersonId, selfPersonId)) {
            throw new Error('You can only view your own schedule.');
        }

        const period = normalizePeriod(req.query.period);
        const anchorDate = parseDateOrToday(req.query.anchorDate);
        const ranges = buildPeriodRanges(anchorDate);
        const selectedRange = ranges[period];
        const scanRange = ranges.year;

        const activeOrgId = normalizeId(req.user?.activeOrgId);
        const statusMeta = await sessionStatusPolicyService.getClientStatusMeta(activeOrgId || '', { includeInactive: true });
        const statusMap = sessionStatusPolicyService.getStatusMetaMap(statusMeta);
        const result = await buildEventsForPersonAndRange({
            personId: targetPersonId,
            startDate: scanRange.start,
            endDate: scanRange.end,
            reqUser: req.user,
            activeOrgId,
            statusMap
        });

        const yearlyEvents = result.events || [];
        const totalsByPeriod = {};
        PERIOD_KEYS.forEach((key) => {
            const periodEvents = filterEventsByRange(yearlyEvents, ranges[key]);
            totalsByPeriod[key] = {
                period: key,
                periodLabel: PERIOD_LABELS[key] || key,
                rangeLabel: ranges[key].label,
                ...summarizeEvents(periodEvents, statusMeta)
            };
        });

        const selectedEvents = filterEventsByRange(yearlyEvents, selectedRange).map((event) => ({
            ...event,
            detailsUrl: String(event?.detailsUrl || '').trim() || (
                event.sessionId
                    ? `/school/classes/${encodeURIComponent(event.classId)}/sessions/${encodeURIComponent(event.sessionId)}`
                    : ''
            )
        }));
        const selectedSummary = summarizeEvents(selectedEvents, statusMeta);

        res.json({
            status: 'success',
            person: {
                id: targetPersonId,
                name: result.personName || targetPersonId,
                orgRoles: result.personOrgRoles || []
            },
            period,
            periodLabel: PERIOD_LABELS[period] || period,
            anchorDate: toIsoDate(anchorDate),
            statusMeta,
            selectedRange,
            ranges,
            totalsByPeriod,
            selectedSummary,
            events: selectedEvents
        });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
}

async function showSchedulePage(req, res) {
    try {
        // Intercept Deep Link parameters from the URL
        const { personId, personName, date } = req.query;

        res.render('school/schedule/personSchedule', {
            // Dynamically set the page title if a name is provided
            title: personName ? `Schedule: ${personName}` : 'Master Schedule Viewer',
            includeModal: true,
            user: req.user,
            
            // Pass the variables to the view (fallback to empty strings if null)
            prefillId: personId || '',
            prefillName: personName || '',
            prefillDate: date || '',
            //
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
}

async function getPersonSchedule(req, res) {
    try {
        const { personId, startDate, endDate } = req.query;
        if (!personId || !startDate || !endDate) {
            throw new Error('Person ID, Start Date, and End Date are required.');
        }

        const activeOrgId = normalizeId(req.user?.activeOrgId);
        const statusMeta = await sessionStatusPolicyService.getClientStatusMeta(activeOrgId || '', { includeInactive: true });
        const statusMap = sessionStatusPolicyService.getStatusMetaMap(statusMeta);
        const personResult = await buildEventsForPersonAndRange({
            personId: String(personId || '').trim(),
            startDate: String(startDate || '').trim(),
            endDate: String(endDate || '').trim(),
            reqUser: req.user,
            activeOrgId,
            statusMap
        });

        const events = (Array.isArray(personResult?.events) ? personResult.events : []).map((event) => ({
            ...event,
            role: event?.roles?.[0] || event?.role || 'Participant',
            detailsUrl: String(event?.detailsUrl || '').trim() || (
                event.sessionId
                    ? `/school/classes/${encodeURIComponent(event.classId)}/sessions/${encodeURIComponent(event.sessionId)}`
                    : ''
            )
        }));

        res.json({ status: 'success', events, statusMeta });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
}

async function showGlobalSchedulePage(req, res) {
    res.render('school/schedule/globalSchedule', {
        title: 'Global Schedule Comparison',
        includeModal: true,
        user: req.user
    });
}

async function getGlobalSchedule(req, res) {
    try {
        const { personIds, startDate, endDate } = req.query;
        if (!personIds || !startDate || !endDate) throw new Error('Person IDs, Start Date, and End Date are required.');
        const activeOrgId = normalizeId(req.user?.activeOrgId);
        const statusMeta = await sessionStatusPolicyService.getClientStatusMeta(activeOrgId || '', { includeInactive: true });
        const statusMap = sessionStatusPolicyService.getStatusMetaMap(statusMeta);

        const pIdArray = personIds.split(',').map(id => id.trim()).filter(Boolean);
        let events = [];
        for (const personId of pIdArray) {
            // eslint-disable-next-line no-await-in-loop
            const result = await buildEventsForPersonAndRange({
                personId,
                startDate: String(startDate || '').trim(),
                endDate: String(endDate || '').trim(),
                reqUser: req.user,
                activeOrgId,
                statusMap
            });
            const personName = String(result?.personName || personId).trim() || personId;
            const personEvents = (Array.isArray(result?.events) ? result.events : []).map((event) => ({
                ...event,
                personId: normalizeId(event?.personId || personId),
                personName,
                role: event?.roles?.[0] || event?.role || 'Participant'
            }));
            events.push(...personEvents);
        }

        events.sort((a, b) => {
            const dateA = new Date(`${a.date}T${a.start || '00:00'}`);
            const dateB = new Date(`${b.date}T${b.start || '00:00'}`);
            return dateA - dateB;
        });

        // Overlap Detection (Only flag overlaps if the SAME person is double booked)
        for (let i = 0; i < events.length; i++) {
            for (let j = i + 1; j < events.length; j++) {
                const current = events[i];
                const next = events[j];
                if (current.date !== next.date) break; // Array is sorted, so we can break early
                
                if (current.personId === next.personId) {
                    const currentEnd = new Date(`${current.date}T${current.end}`);
                    const nextStart = new Date(`${next.date}T${next.start}`);
                    if (currentEnd > nextStart) {
                        if (isAllowedSessionEmbeddedReportOverlap(current, next)) continue;
                        current.hasOverlap = true;
                        next.hasOverlap = true;
                    }
                }
            }
        }

        res.json({ status: 'success', events, statusMeta });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
}

module.exports = {
    showSchedulePage,
    showMySchedulePage,
    getMyScheduleData,
    getPersonSchedule,
    showGlobalSchedulePage,
    getGlobalSchedule
};
