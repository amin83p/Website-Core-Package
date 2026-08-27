// MVC/controllers/school/scheduleController.js
const crypto = require('crypto');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { resolveOrgTodayFromRequest, resolveOrgTodayFromContext } = requireCoreModule('MVC/utils/timezoneUtils');
const schoolDataService = require('../../services/school/schoolDataService'); 
const schoolRepositories = require('../../repositories/school');
const schoolIdentityLookupService = require('../../services/school/schoolIdentityLookupService');
const schoolAdminAccessService = require('../../services/school/schoolAdminAccessService');
const sessionStatusPolicyService = require('../../services/school/sessionStatusPolicyService');
const sessionStudentCaseService = require('../../services/school/sessionStudentCaseService');
const classEnrollmentReadService = require('../../services/school/classEnrollmentReadService');
const classEnrollmentSessionApplicabilityService = require('../../services/school/classEnrollmentSessionApplicabilityService');
const leaveRequestService = require('../../services/school/leaveRequestService');
const activityService = require('../../services/school/activityService');
const teacherIdentityService = require('../../services/school/teacherIdentityService');
const sessionDeliveryTeamService = require('../../services/school/sessionDeliveryTeamService');
const sessionNavigationService = require('../../services/school/sessionNavigationService');
const sessionMergeService = require('../../services/school/sessionMergeService');
const schoolPersonAccessService = require('../../services/school/schoolPersonAccessService');
const classSessionCapacityService = require('../../services/school/classSessionCapacityService');
const reportAssignmentSessionUtils = requireCoreModule('MVC/utils/reportAssignmentSessionUtils');
const PERIOD_KEYS = Object.freeze(['day', 'week', 'month', 'season', 'year']);
const PERIOD_LABELS = Object.freeze({
    day: 'Daily',
    week: 'Weekly',
    month: 'Monthly',
    season: 'Seasonal',
    year: 'Yearly'
});

function buildScheduleEventsFingerprint(events = []) {
    const parts = (Array.isArray(events) ? events : [])
        .map((event) => [
            String(event?.eventType || '').trim(),
            String(event?.sessionId || event?.id || '').trim(),
            String(event?.date || '').trim(),
            String(event?.start || '').trim(),
            String(event?.end || '').trim(),
            String(event?.status || '').trim(),
            event?.locked === true || String(event?.locked) === 'true' ? '1' : '0'
        ].join(':'))
        .sort();
    return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

async function resolvePersonScheduleRequest(req) {
    const { personId, startDate, endDate, role } = req.query;
    const viewerScheduleAccess = await buildScheduleViewerAccess(req.user);
    let effectivePersonId = normalizeId(personId);
    let effectiveRole = normalizeScheduleRole(role);

    if (!viewerScheduleAccess.canSelectAnyPerson) {
        if (!viewerScheduleAccess.lockedPersonId) {
            throw new Error('Your user account is not linked to a school student, staff, or teacher profile.');
        }
        if (effectivePersonId && !idsEqual(effectivePersonId, viewerScheduleAccess.lockedPersonId)) {
            throw new Error('You can only view your own school schedule.');
        }
        effectivePersonId = viewerScheduleAccess.lockedPersonId;

        const allowedRoles = (Array.isArray(viewerScheduleAccess.availableRoles) ? viewerScheduleAccess.availableRoles : [])
            .map((item) => normalizeScheduleRole(item?.key))
            .filter(Boolean);
        if (!allowedRoles.length) {
            throw new Error('Your user account is not linked to a school student, staff, or teacher profile.');
        }
        if (!effectiveRole && allowedRoles.length === 1) effectiveRole = allowedRoles[0];
        if (!effectiveRole && allowedRoles.length > 1) {
            throw new Error('Select one of your school roles to view this schedule.');
        }
        if (effectiveRole && allowedRoles.length && !allowedRoles.includes(effectiveRole)) {
            throw new Error('You can only view schedule roles attached to your school profile.');
        }
    }

    if (!effectivePersonId || !startDate || !endDate) {
        throw new Error('Person ID, Start Date, and End Date are required.');
    }

    return {
        effectivePersonId: String(effectivePersonId || '').trim(),
        effectiveRole,
        startDate: String(startDate || '').trim(),
        endDate: String(endDate || '').trim(),
        viewerScheduleAccess,
        activeOrgId: getActiveScheduleOrgId(req.user)
    };
}
function normalizeId(value) {
    return String(value || '').trim();
}

function isScheduleAdminViewer(reqUser) {
    return schoolAdminAccessService.isSchedulesAdminViewer(reqUser);
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

function wantsSessionsWithCasesOnly(query = {}) {
    return ['1', 'true', 'yes', 'on'].includes(String(query?.hasCases || '').trim().toLowerCase());
}

function filterEventsWithCasesIfRequested(events, query = {}) {
    if (!wantsSessionsWithCasesOnly(query)) return Array.isArray(events) ? events : [];
    return (Array.isArray(events) ? events : []).filter((event) => event?.caseSummary?.hasCases === true);
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

function resolveClassSessionSchedulePolicy(statusMap, session, { teacherAssigned = false } = {}) {
    const makeUpRequired = sessionStatusPolicyService.isMakeUpRequiredByMap(statusMap, {
        status: session?.status,
        notes: session?.notes
    });
    const excludedFromTeacherIndex = sessionStatusPolicyService.shouldExcludeFromTeacherIndexByMap(statusMap, {
        status: session?.status,
        notes: session?.notes
    });
    const excludedFromStudentIndex = sessionStatusPolicyService.shouldExcludeFromStudentIndexByMap(statusMap, {
        status: session?.status,
        notes: session?.notes
    });
    const teacherVisible = Boolean(teacherAssigned) && (makeUpRequired || !excludedFromTeacherIndex);
    const scheduleDisplayOnly = teacherVisible && makeUpRequired;

    return {
        makeUpRequired,
        teacherVisible,
        studentVisible: !excludedFromStudentIndex,
        scheduleDisplayOnly,
        countsTowardHours: !scheduleDisplayOnly,
        blocksConflicts: !scheduleDisplayOnly
    };
}

function resolveClassSessionScheduleHours(statusMap, session, scheduledDuration, schedulePolicy) {
    const safeScheduled = Number(scheduledDuration);
    if (!Number.isFinite(safeScheduled) || safeScheduled <= 0) {
        return { duration: 0, countsTowardHours: false, timesheetHours: 0 };
    }
    if (!schedulePolicy?.scheduleDisplayOnly) {
        return {
            duration: safeScheduled,
            countsTowardHours: true,
            timesheetHours: safeScheduled
        };
    }
    const timesheetHours = sessionStatusPolicyService.calculateTimesheetHoursByMap(statusMap, {
        status: session?.status,
        notes: session?.notes || '',
        durationHours: safeScheduled,
        session
    });
    return {
        duration: timesheetHours,
        countsTowardHours: timesheetHours > 0,
        timesheetHours
    };
}

function doesScheduleEventCountTowardHours(event) {
    return event?.countsTowardHours !== false;
}

function doesScheduleEventBlockConflicts(event) {
    return event?.scheduleDisplayOnly !== true && event?.blocksConflicts !== false;
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

const SCHEDULE_ROLE_META = Object.freeze({
    student: Object.freeze({ key: 'student', label: 'Student', dataKey: 'students', roleToken: 'school_student' }),
    teacher: Object.freeze({ key: 'teacher', label: 'Teacher', dataKey: 'teachers', roleToken: 'school_teacher' }),
    staff: Object.freeze({ key: 'staff', label: 'Staff', dataKey: 'staff', roleToken: 'school_staff' }),
});

function normalizeScheduleRole(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    if (!normalized) return '';
    if (normalized === 'school_student' || normalized === 'student' || normalized === 'students' || normalized.endsWith('school_student') || normalized.includes('school_student')) return 'student';
    if (normalized === 'school_teacher' || normalized === 'teacher' || normalized === 'teachers' || normalized.endsWith('school_teacher') || normalized.includes('school_teacher')) return 'teacher';
    if (normalized === 'school_staff' || normalized === 'staff' || normalized === 'staffs' || normalized.endsWith('school_staff') || normalized.includes('school_staff')) return 'staff';
    return normalized;
}

const SCHEDULE_SCHOOL_ROLE_LABELS = Object.freeze({
    teacher: 'Teacher',
    student: 'Student',
    staff: 'Staff'
});

function schoolRoleDisplayLabel(roleToken = '') {
    return SCHEDULE_SCHOOL_ROLE_LABELS[normalizeScheduleRole(roleToken)] || '';
}

function getScheduleEventHourCategoryLabels(event = {}) {
    if (isApprovedLeaveScheduleEvent(event)) return ['Approved Leave'];

    const schoolRoles = new Set();
    const roleSources = [
        ...(Array.isArray(event?.roles) ? event.roles : []),
        event?.role,
        event?.roleLabel
    ];
    roleSources.forEach((value) => {
        String(value || '')
            .split('/')
            .map((part) => part.trim())
            .filter(Boolean)
            .forEach((part) => {
                const label = schoolRoleDisplayLabel(part);
                if (label) schoolRoles.add(label);
            });
    });
    if (schoolRoles.size) return [...schoolRoles];

    const labels = [];
    [event?.roleLabel, event?.role].forEach((value) => {
        String(value || '')
            .split('/')
            .map((part) => part.trim())
            .filter(Boolean)
            .forEach((label) => {
                if (label && !labels.includes(label)) labels.push(label);
            });
    });
    return labels.length ? labels : ['Schedule'];
}

function isApprovedLeaveScheduleEvent(event) {
    return [
        event?.eventType,
        event?.targetType,
        event?.status,
        event?.role,
        event?.roleLabel,
    ].some((value) => {
        const normalized = String(value || '').trim().toLowerCase();
        return normalized === 'leave_request'
            || normalized === 'approved_leave'
            || normalized === 'approved_leave_snapshot'
            || normalized === 'leave';
    });
}

function scheduleEventMatchesRole(event, requestedRole) {
    const role = normalizeScheduleRole(requestedRole);
    if (!role) return true;
    const candidates = [
        event?.role,
        event?.roleLabel,
        event?.targetRole,
        event?.schoolRole,
        event?.requesterRole,
        ...(Array.isArray(event?.roles) ? event.roles : []),
    ].map(normalizeScheduleRole).filter(Boolean);
    return candidates.includes(role);
}

function filterScheduleEventsForRole(events, requestedRole) {
    const role = normalizeScheduleRole(requestedRole);
    if (!role) return Array.isArray(events) ? events : [];
    return (Array.isArray(events) ? events : []).filter((event) => scheduleEventMatchesRole(event, role));
}

function getActiveScheduleOrgId(reqUser = {}) {
    return normalizeId(
        reqUser.activeOrgId
        || reqUser.activeOrganizationId
        || reqUser.currentOrgId
        || reqUser.currentOrganizationId
        || reqUser.selectedOrgId
        || reqUser.orgId
        || reqUser.organizationId
        || reqUser.activeOrg?.id
        || reqUser.organization?.id
    );
}

function getUserPersonId(reqUser = {}) {
    return normalizeId(
        reqUser.personId
        || reqUser.person?.id
        || reqUser.person?._id
        || reqUser.profile?.personId
        || reqUser.account?.personId
    );
}

async function listSchoolPersonRecords(reqUser, { q = '', query = {}, requireSchoolRole = false, allowedSchoolRoles = [] } = {}) {
    const payload = await schoolIdentityLookupService.listSchoolPersonRecords({
        reqUser,
        q,
        query,
        requireSchoolRole,
        allowedSchoolRoles
    });
    return payload?.allRows || payload?.rows || [];
}

async function getSchoolPersonRecordById(personId, reqUser) {
    const normalizedPersonId = normalizeId(personId);
    if (!normalizedPersonId) return null;
    try {
        const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
        const dataService = requireCoreModule('MVC/services/dataService');
        const row = await dataService.getDataById('persons', normalizedPersonId, reqUser, {
            enrichment: { includeSchoolRoles: false }
        });
        if (row) {
            return {
                ...row,
                id: normalizeId(row.id || row.personId || normalizedPersonId)
            };
        }
    } catch (_) {}
    const persons = await listSchoolPersonRecords(reqUser, {
        q: normalizedPersonId,
        query: { q: normalizedPersonId, limit: 50 }
    }).catch(() => []);
    return (Array.isArray(persons) ? persons : []).find((row) => idsEqual(row?.id, normalizedPersonId) || idsEqual(row?._id, normalizedPersonId)) || null;
}

function rowBelongsToActiveOrg(row = {}, activeOrgId = '') {
    const orgId = normalizeId(activeOrgId);
    if (!orgId) return true;
    const rowOrgIds = [
        row.orgId,
        row.organizationId,
        row.organizationID,
        row.orgID,
        row.schoolOrgId,
        row.activeOrgId,
    ].map(normalizeId).filter(Boolean);
    if (!rowOrgIds.length) return true;
    return rowOrgIds.some((rowOrgId) => idsEqual(rowOrgId, orgId));
}

function isActiveSchoolIdentityRow(row = {}) {
    const status = String(row.status || row.state || '').trim().toLowerCase();
    return !['archived', 'deleted', 'inactive', 'disabled', 'removed'].includes(status);
}

function addScheduleRoleOption(roleMap, roleKey, source = 'backend') {
    const normalized = normalizeScheduleRole(roleKey);
    const meta = SCHEDULE_ROLE_META[normalized];
    if (!meta || roleMap.has(normalized)) return;
    roleMap.set(normalized, { key: meta.key, label: meta.label, source });
}

function getScheduleViewerName({ person, reqUser, personId }) {
    return (person ? buildPersonDisplayName(person) : '')
        || String(reqUser?.displayName || reqUser?.name || reqUser?.fullName || reqUser?.username || '').trim()
        || personId
        || '';
}

async function buildScheduleViewerAccess(reqUser = {}) {
    const canSelectAnyPerson = Boolean(
        isScheduleAdminViewer(reqUser)
    );
    const activeOrgId = getActiveScheduleOrgId(reqUser);

    if (canSelectAnyPerson) {
        return {
            canSelectAnyPerson: true,
            activeOrgId,
            lockedPersonId: '',
            lockedPersonName: '',
            availableRoles: [],
            selectedRole: '',
        };
    }

    const personId = getUserPersonId(reqUser);
    const roleMap = new Map();
    let person = null;

    if (personId) {
        try {
            const [students, teachers, staffRows] = await Promise.all([
                schoolDataService.fetchAllData('students', { orgId__eq: activeOrgId }, reqUser),
                schoolDataService.fetchAllData('teachers', { orgId__eq: activeOrgId }, reqUser),
                schoolDataService.fetchAllData('staff', { orgId__eq: activeOrgId }, reqUser),
            ]);

            let persons = [];
            try {
                persons = await listSchoolPersonRecords(reqUser, { query: { limit: 1000 } });
            } catch (lookupError) {
                persons = [];
            }

            person = (Array.isArray(persons) ? persons : []).find((row) => idsEqual(row?.id, personId) || idsEqual(row?._id, personId)) || null;

            [
                { key: 'student', rows: students },
                { key: 'teacher', rows: teachers },
                { key: 'staff', rows: staffRows },
            ].forEach(({ key, rows }) => {
                const hasLinkedRow = (Array.isArray(rows) ? rows : []).some((row) => (
                    idsEqual(row?.personId, personId)
                    && rowBelongsToActiveOrg(row, activeOrgId)
                    && isActiveSchoolIdentityRow(row)
                ));
                if (hasLinkedRow) addScheduleRoleOption(roleMap, key, 'school-record');
            });

            const orgRoles = extractPersonRolesInOrg(person || reqUser.person || reqUser, activeOrgId);
            (Array.isArray(orgRoles) ? orgRoles : []).forEach((roleToken) => {
                const role = normalizeScheduleRole(roleToken);
                if (SCHEDULE_ROLE_META[role]) addScheduleRoleOption(roleMap, role, 'person-role');
            });
        } catch (error) {
            const orgRoles = extractPersonRolesInOrg(reqUser.person || reqUser, activeOrgId);
            (Array.isArray(orgRoles) ? orgRoles : []).forEach((roleToken) => {
                const role = normalizeScheduleRole(roleToken);
                if (SCHEDULE_ROLE_META[role]) addScheduleRoleOption(roleMap, role, 'person-role');
            });
        }
    }

    const availableRoles = Array.from(roleMap.values());
    return {
        canSelectAnyPerson: false,
        activeOrgId,
        lockedPersonId: personId,
        lockedPersonName: getScheduleViewerName({ person, reqUser, personId }),
        availableRoles,
        selectedRole: availableRoles.length === 1 ? availableRoles[0].key : '',
    };
}

async function buildScheduleRoleOptionsForPerson({ personId, activeOrgId, reqUser, students, teachers, staffRows, persons } = {}) {
    const normalizedPersonId = normalizeId(personId);
    const roleMap = new Map();
    if (!normalizedPersonId) return [];

    try {
        const [studentRows, teacherRows, staffList] = (students || teachers || staffRows)
            ? [students || [], teachers || [], staffRows || []]
            : await Promise.all([
                schoolDataService.fetchAllData('students', {}, reqUser),
                schoolDataService.fetchAllData('teachers', {}, reqUser),
                schoolDataService.fetchAllData('staff', {}, reqUser),
            ]);

        [
            { key: 'student', rows: studentRows },
            { key: 'teacher', rows: teacherRows },
            { key: 'staff', rows: staffList },
        ].forEach(({ key, rows }) => {
            const hasLinkedRow = (Array.isArray(rows) ? rows : []).some((row) => (
                idsEqual(row?.personId, normalizedPersonId)
                && rowBelongsToActiveOrg(row, activeOrgId)
                && isActiveSchoolIdentityRow(row)
            ));
            if (hasLinkedRow) addScheduleRoleOption(roleMap, key, 'school-record');
        });
    } catch (error) {
        // Role discovery should improve the admin filter, not block schedule viewing.
    }

    try {
        const personList = Array.isArray(persons)
            ? persons
            : await listSchoolPersonRecords(reqUser, { query: { limit: 1000 } });
        const person = (Array.isArray(personList) ? personList : []).find((row) => idsEqual(row?.id, normalizedPersonId) || idsEqual(row?._id, normalizedPersonId))
            || await getSchoolPersonRecordById(normalizedPersonId, reqUser);
        const orgRoles = person ? extractPersonRolesInOrg(person, activeOrgId) : [];
        (Array.isArray(orgRoles) ? orgRoles : []).forEach((roleToken) => {
            const role = normalizeScheduleRole(roleToken);
            if (SCHEDULE_ROLE_META[role]) addScheduleRoleOption(roleMap, role, 'person-role');
        });
    } catch (error) {
        // Ignore display/profile role lookup failures; school-owned rows above are authoritative enough.
    }

    return Array.from(roleMap.values());
}

function getPersonSearchText(person, roleOptions = []) {
    return [
        person?.id,
        person?._id,
        person?.displayName,
        person?.fullName,
        person?.name?.first,
        person?.name?.middle,
        person?.name?.last,
        person?.contact?.email,
        person?.contact?.primaryEmail,
        ...(Array.isArray(roleOptions) ? roleOptions.map((role) => role?.label || role?.key) : []),
    ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean).join(' ');
}

async function buildSchoolSchedulePersonPickerRows({ activeOrgId, reqUser }) {
    const [students, teachers, staffRows, persons] = await Promise.all([
        schoolDataService.fetchAllData('students', {}, reqUser),
        schoolDataService.fetchAllData('teachers', {}, reqUser),
        schoolDataService.fetchAllData('staff', {}, reqUser),
        listSchoolPersonRecords(reqUser, { query: { limit: 1000 } }),
    ]);

    const roleMapByPersonId = new Map();
    const addRole = (personId, roleKey, source) => {
        const normalizedPersonId = normalizeId(personId);
        if (!normalizedPersonId) return;
        if (!roleMapByPersonId.has(normalizedPersonId)) roleMapByPersonId.set(normalizedPersonId, new Map());
        addScheduleRoleOption(roleMapByPersonId.get(normalizedPersonId), roleKey, source);
    };

    [
        { key: 'student', rows: students },
        { key: 'teacher', rows: teachers },
        { key: 'staff', rows: staffRows },
    ].forEach(({ key, rows }) => {
        (Array.isArray(rows) ? rows : []).forEach((row) => {
            if (!rowBelongsToActiveOrg(row, activeOrgId) || !isActiveSchoolIdentityRow(row)) return;
            addRole(row?.personId, key, 'school-record');
        });
    });

    (Array.isArray(persons) ? persons : []).forEach((person) => {
        const personId = normalizeId(person?.id || person?._id);
        if (!personId) return;
        extractPersonRolesInOrg(person, activeOrgId).forEach((roleToken) => {
            const role = normalizeScheduleRole(roleToken);
            if (SCHEDULE_ROLE_META[role]) addRole(personId, role, 'person-role');
        });
    });

    const personMap = new Map((Array.isArray(persons) ? persons : []).map((person) => [normalizeId(person?.id || person?._id), person]));

    return Array.from(roleMapByPersonId.entries()).map(([personId, rolesForPerson]) => {
        const person = personMap.get(personId) || { id: personId };
        const availableRoles = Array.from(rolesForPerson.values());
        const displayName = buildPersonDisplayName(person, personId);
        return {
            id: personId,
            personId,
            firstName: person?.name?.first || '',
            middleName: person?.name?.middle || '',
            lastName: person?.name?.last || '',
            displayName,
            name: displayName,
            email: person?.contact?.email || person?.contact?.primaryEmail || '',
            availableRoles,
            roles: availableRoles.map((role) => role.key),
            roleLabels: availableRoles.map((role) => role.label),
            searchText: getPersonSearchText(person, availableRoles),
        };
    }).sort((a, b) => String(a.displayName || a.id).localeCompare(String(b.displayName || b.id)));
}

const { buildTeacherPersonMap, resolveTeacherPersonId } = teacherIdentityService;
const resolveLinkedPersonId = resolveTeacherPersonId;

function collectClassIdsFromTeacherIndex(teacherIndex, personId, teacherPersonMap = new Map()) {
    const classIds = new Set();
    const keys = teacherIdentityService.collectTeacherRecordIdsForPerson(personId, teacherPersonMap);
    const indexRoot = teacherIndex && typeof teacherIndex === 'object' && !Array.isArray(teacherIndex)
        ? teacherIndex
        : {};
    keys.forEach((key) => {
        const byDate = indexRoot[key];
        if (!byDate || typeof byDate !== 'object') return;
        Object.values(byDate).forEach((entries) => {
            (Array.isArray(entries) ? entries : []).forEach((entry) => {
                const classId = normalizeId(entry?.classId);
                if (classId) classIds.add(classId);
            });
        });
    });
    return classIds;
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
    const sessions = Array.isArray(classRow?.sessions) ? classRow.sessions : [];
    return sessions.some((session) => sessionDeliveryTeamService.isPersonOnSessionDelivery(session, personId, teacherPersonMap));
}

function buildPersonDisplayName(person, fallbackId = '') {
    const fullName = `${person?.name?.first || ''} ${person?.name?.last || ''}`.trim();
    if (fullName) return fullName;
    if (person?.displayName) return String(person.displayName).trim();
    if (person?.fullName) return String(person.fullName).trim();
    if (typeof person?.name === 'string') return String(person.name).trim();
    return String(fallbackId || person?.id || '').trim();
}

function isOpaqueDisplayLabel(label, ...candidateIds) {
    const cleaned = String(label || '').trim();
    if (!cleaned) return true;
    const candidates = candidateIds.map((id) => normalizeId(id)).filter(Boolean);
    return candidates.some((id) => idsEqual(cleaned, id));
}

function isNumericOnlyLabel(label) {
    return /^[0-9]+$/.test(String(label || '').trim());
}

function resolveReadableStudentLabel(name, studentId = '', personId = '', personNameById = new Map()) {
    const fromPerson = personId ? String(personNameById.get(normalizeId(personId)) || '').trim() : '';
    const direct = String(name || '').trim();
    const directUsable = direct
        && !isOpaqueDisplayLabel(direct, studentId, personId)
        && !isNumericOnlyLabel(direct);
    if (fromPerson && !isOpaqueDisplayLabel(fromPerson, studentId, personId)) {
        if (!directUsable) return fromPerson;
    }
    if (directUsable) return direct;
    if (fromPerson && !isOpaqueDisplayLabel(fromPerson, studentId, personId)) return fromPerson;
    return '';
}

async function buildSchedulePersonNameById({
    reqUser,
    students = [],
    persons = [],
    enrollmentPeriods = [],
    classes = []
} = {}) {
    const personNameById = new Map(
        (Array.isArray(persons) ? persons : [])
            .map((person) => [normalizeId(person?.id || person?._id), buildPersonDisplayName(person, '')])
            .filter(([id, name]) => Boolean(id && name && !isOpaqueDisplayLabel(name, id)))
    );

    const personIds = new Set();
    const addPersonId = (value) => {
        const id = normalizeId(value);
        if (id) personIds.add(id);
    };

    (Array.isArray(students) ? students : []).forEach((student) => addPersonId(student?.personId));
    (Array.isArray(enrollmentPeriods) ? enrollmentPeriods : []).forEach((row) => addPersonId(row?.personId));
    (Array.isArray(classes) ? classes : []).forEach((classRow) => {
        (Array.isArray(classRow?.enrollment?.students) ? classRow.enrollment.students : []).forEach((entry) => {
            addPersonId(entry?.personId);
        });
    });

    const missingPersonIds = [...personIds].filter((personId) => {
        const existing = personNameById.get(personId);
        return !existing || isOpaqueDisplayLabel(existing, personId);
    });

    if (missingPersonIds.length) {
        const personById = await schoolPersonAccessService.buildPersonByIdMap({
            reqUser,
            personIds: missingPersonIds
        });
        missingPersonIds.forEach((personId) => {
            const person = personById.get(personId);
            const name = schoolPersonAccessService.formatPersonName(person, '');
            if (name && !isOpaqueDisplayLabel(name, personId)) {
                personNameById.set(personId, name);
            }
        });
    }

    return personNameById;
}

function buildStudentDisplayName(student, personNameById = new Map(), fallbackId = '', studentNameByStudentId = new Map()) {
    const studentId = normalizeId(student?.id || student?._id || fallbackId);
    const personId = normalizeId(student?.personId || student?.person?.id || student?.person?._id);
    const mappedStudentName = studentId ? String(studentNameByStudentId.get(studentId) || '').trim() : '';
    if (
        mappedStudentName
        && !isNumericOnlyLabel(mappedStudentName)
        && !isOpaqueDisplayLabel(mappedStudentName, studentId, personId)
    ) {
        return mappedStudentName;
    }
    const personName = personId ? String(personNameById.get(personId) || '').trim() : '';
    if (personName && !isOpaqueDisplayLabel(personName, studentId, personId)) return personName;
    const studentName = buildPersonDisplayName(student, '');
    if (studentName) return studentName;
    const fromParts = `${student?.firstName || ''} ${student?.lastName || ''}`.trim();
    if (fromParts) return fromParts;
    return '';
}

function resolveEnrollmentStudentRowDisplayName(entry = {}) {
    if (!entry || typeof entry !== 'object') return '';
    const direct = String(
        entry.studentName
        || entry.displayName
        || entry.fullName
        || entry.name
        || ''
    ).trim();
    if (direct && direct !== '[object Object]') return direct;
    const fromParts = `${entry.firstName || entry.name?.first || ''} ${entry.lastName || entry.name?.last || ''}`.trim();
    if (fromParts) return fromParts;
    return buildPersonDisplayName(entry, '');
}

function enrichStudentNameMaps({
    students = [],
    classes = [],
    enrollmentPeriods = [],
    personNameById = new Map(),
    studentNameByStudentId = new Map()
} = {}) {
    (Array.isArray(classes) ? classes : []).forEach((classRow) => {
        (Array.isArray(classRow?.enrollment?.students) ? classRow.enrollment.students : []).forEach((entry) => {
            const name = resolveEnrollmentStudentRowDisplayName(entry);
            if (!name) return;
            const studentId = normalizeId(entry?.studentId || entry?.id || entry?._id);
            const personId = normalizeId(entry?.personId);
            if (studentId) studentNameByStudentId.set(studentId, name);
            if (personId) personNameById.set(personId, name);
        });
    });
    (Array.isArray(enrollmentPeriods) ? enrollmentPeriods : []).forEach((row) => {
        const name = resolveEnrollmentStudentRowDisplayName(row);
        const studentId = normalizeId(row?.studentId);
        const personId = normalizeId(row?.personId);
        if (name && !isOpaqueDisplayLabel(name, studentId, personId)) {
            if (studentId) studentNameByStudentId.set(studentId, name);
            if (personId) personNameById.set(personId, name);
        } else if (personId && personNameById.has(personId) && studentId) {
            studentNameByStudentId.set(studentId, personNameById.get(personId));
        }
    });
    (Array.isArray(students) ? students : []).forEach((student) => {
        const studentId = normalizeId(student?.id || student?._id);
        const personId = normalizeId(student?.personId);
        const name = buildStudentDisplayName(student, personNameById, studentId, studentNameByStudentId);
        if (studentId && name) studentNameByStudentId.set(studentId, name);
        if (personId && name) personNameById.set(personId, name);
    });
}

function resolveStudentNameFromSessionRoster(session = {}, soloStudent = {}) {
    const roster = Array.isArray(session?.roster) ? session.roster : [];
    const candidateIds = [
        soloStudent?.soloStudentPersonId,
        soloStudent?.soloStudentId
    ].map((value) => normalizeId(value)).filter(Boolean);
    if (!candidateIds.length) return '';
    const row = roster.find((entry) => {
        const rowId = normalizeId(entry?.personId || entry?.studentId || entry?.id);
        return rowId && candidateIds.some((candidateId) => idsEqual(rowId, candidateId));
    });
    return resolveEnrollmentStudentRowDisplayName(row);
}

function buildSoloStudentResolver({
    students = [],
    persons = [],
    enrollmentPeriods = [],
    classes = [],
    activeOrgId = '',
    personNameByIdSeed = null
} = {}) {
    const personNameById = new Map();
    if (personNameByIdSeed instanceof Map) {
        personNameByIdSeed.forEach((name, id) => {
            const personId = normalizeId(id);
            const label = String(name || '').trim();
            if (personId && label && !isOpaqueDisplayLabel(label, personId)) {
                personNameById.set(personId, label);
            }
        });
    }
    (Array.isArray(persons) ? persons : [])
        .forEach((person) => {
            const id = normalizeId(person?.id || person?._id);
            const name = buildPersonDisplayName(person, '');
            if (id && name && !isOpaqueDisplayLabel(name, id) && !personNameById.has(id)) {
                personNameById.set(id, name);
            }
        });
    const studentNameByStudentId = new Map();
    enrichStudentNameMaps({
        students,
        classes,
        enrollmentPeriods,
        personNameById,
        studentNameByStudentId
    });
    const studentById = new Map(
        (Array.isArray(students) ? students : [])
            .map((student) => [normalizeId(student?.id || student?._id), student])
            .filter(([id]) => Boolean(id))
    );
    const coreResolver = classSessionCapacityService.buildSoloStudentResolver({
        students,
        enrollmentPeriods,
        classes,
        activeOrgId,
        normalizeId,
        normalizeDateOnly
    });

    return function resolveSoloStudentForSession(classRow = {}, sessionDate = '') {
        const result = coreResolver(classRow, sessionDate);
        if (!result) return null;
        const studentId = normalizeId(result.soloStudentId);
        const student = studentById.get(studentId) || { id: studentId };
        const studentPersonId = normalizeId(result.soloStudentPersonId || student?.personId);
        const enrollmentRow = (Array.isArray(classRow?.enrollment?.students) ? classRow.enrollment.students : [])
            .find((entry) => idsEqual(entry?.studentId || entry?.id || entry?._id, studentId));
        const enrollmentName = resolveEnrollmentStudentRowDisplayName(enrollmentRow);
        const studentName = resolveReadableStudentLabel(
            buildStudentDisplayName(student, personNameById, studentId, studentNameByStudentId) || enrollmentName,
            studentId,
            studentPersonId,
            personNameById
        );
        return {
            soloStudentId: studentId,
            soloStudentPersonId: studentPersonId,
            soloStudentName: studentName
        };
    };
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

function isOpenCanonicalEnrollmentPeriod(row, referenceDate = '', orgToday = '') {
    const status = String(row?.status || '').trim().toLowerCase();
    if (!['active', 'planned'].includes(status)) return false;
    const day = normalizeDateOnly(referenceDate) || normalizeDateOnly(orgToday) || resolveOrgTodayFromContext({ orgToday });
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

function isAllowedMergedSessionOverlap(leftEvent, rightEvent) {
    const aType = String(leftEvent?.eventType || '').trim().toLowerCase();
    const bType = String(rightEvent?.eventType || '').trim().toLowerCase();
    if (aType !== 'class_session' || bType !== 'class_session') return false;

    const sessionA = {
        sessionId: leftEvent?.sessionId,
        id: leftEvent?.sessionId,
        merged: leftEvent?.merged,
        mergedPartner: leftEvent?.mergedPartner
    };
    const sessionB = {
        sessionId: rightEvent?.sessionId,
        id: rightEvent?.sessionId,
        merged: rightEvent?.merged,
        mergedPartner: rightEvent?.mergedPartner
    };
    return sessionMergeService.areMergeLinkedSessions(
        sessionA,
        leftEvent?.classId,
        sessionB,
        rightEvent?.classId
    );
}

function markOverlappingEvents(events, { samePersonOnly = false } = {}) {
    const list = Array.isArray(events) ? events : [];
    list.forEach((event) => {
        if (event && typeof event === 'object') event.hasOverlap = false;
    });

    for (let i = 0; i < list.length - 1; i += 1) {
        const current = list[i];
        if (!doesScheduleEventBlockConflicts(current)) continue;
        const currentStart = parseTimeToMinutes(current?.start);
        const currentEnd = parseTimeToMinutes(current?.end);
        if (currentStart == null || currentEnd == null || currentEnd <= currentStart) continue;

        for (let j = i + 1; j < list.length; j += 1) {
            const next = list[j];
            if (current?.date !== next?.date) break;
            const nextStart = parseTimeToMinutes(next?.start);
            const nextEnd = parseTimeToMinutes(next?.end);
            if (nextStart == null || nextEnd == null || nextEnd <= nextStart) continue;
            if (nextStart >= currentEnd) break;
            if (samePersonOnly && !idsEqual(current?.personId, next?.personId)) continue;
            if (!doesScheduleEventBlockConflicts(next)) continue;
            if (isAllowedSessionEmbeddedReportOverlap(current, next)) continue;
            if (isAllowedMergedSessionOverlap(current, next)) continue;

            current.hasOverlap = true;
            next.hasOverlap = true;
        }
    }
}

async function attachCaseSummariesToSessionEvents(events, reqUser) {
    const sessionRefs = (Array.isArray(events) ? events : [])
        .filter((event) => String(event?.eventType || '').trim().toLowerCase() === 'class_session')
        .filter((event) => normalizeId(event?.classId) && normalizeId(event?.sessionId))
        .map((event) => ({ classId: event.classId, sessionId: event.sessionId }));
    if (!sessionRefs.length) return events;

    const caseSummaries = await sessionStudentCaseService.listSessionCaseSummaries({ sessionRefs, reqUser });
    return (Array.isArray(events) ? events : []).map((event) => {
        if (String(event?.eventType || '').trim().toLowerCase() !== 'class_session') return event;
        const key = sessionStudentCaseService.getSessionCaseSummaryKey(event.classId, event.sessionId);
        const caseSummary = caseSummaries.get(key) || null;
        return caseSummary ? { ...event, caseSummary } : event;
    });
}

function filterEventsByRange(events, range) {
    if (!range?.start || !range?.end) return [];
    return events.filter((event) => event.date >= range.start && event.date <= range.end);
}

function buildReportDetailUrl({ assignment, personId, role }) {
    const assignmentId = normalizeId(assignment?.id);
    if (!assignmentId) return '';

    const params = new URLSearchParams();
    params.set('assignmentId', assignmentId);
    if (assignment?.assignmentRowId) params.set('assignmentRowId', normalizeId(assignment.assignmentRowId));
    if (assignment?.sessionId) params.set('sessionId', normalizeId(assignment.sessionId));
    const assignmentDate = normalizeId(assignment?.sessionDate || assignment?.dueDate || '');
    if (assignmentDate) params.set('sessionDate', assignmentDate);
    if (role === 'Student') {
        params.set('studentId', normalizeId(personId));
    } else {
        params.set('teacherId', normalizeId(personId));
    }
    params.set('autoOpenSingle', '1');
    return `/school/reports/instances?${params.toString()}`;
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

    const expandedAssignments = [];
    for (const assignment of (Array.isArray(assignments) ? assignments : [])) {
        const targetRows = reportAssignmentSessionUtils.getEffectiveTargetRows(assignment);
        (targetRows.length ? targetRows : [{}]).forEach((targetRow) => {
            expandedAssignments.push(reportAssignmentSessionUtils.applyTargetRow(assignment, targetRow));
        });
    }

    for (const assignment of expandedAssignments) {
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
        const eventTargetKey = normalizeId(assignment?.assignmentRowId) || normalizeId(assignment?.sessionId) || normalizeId(assignment?.dueDate) || date;
        const eventId = `RPT-${normalizeId(assignment?.id)}-${eventTargetKey}-${role.toLowerCase()}-${normalizedPersonId}`;

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
        if (doesScheduleEventCountTowardHours(event)) {
            totalHours += Number(event?.duration || 0);
        }
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

function summarizeTimesheetHoursForEvents(events, statusMap) {
    const list = Array.isArray(events) ? events : [];
    let totalTimesheetHours = 0;
    let overlapCount = 0;

    for (const event of list) {
        if (event?.hasOverlap) overlapCount += 1;

        if (!doesScheduleEventCountTowardHours(event)) {
            continue;
        }

        if (isApprovedLeaveScheduleEvent(event)) {
            continue;
        }

        const eventType = String(event?.eventType || '').trim().toLowerCase();
        if (eventType === 'class_session' || (!eventType && event?.sessionId)) {
            const explicitTimesheetHours = Number(event?.timesheetHours);
            if (Number.isFinite(explicitTimesheetHours)) {
                totalTimesheetHours += explicitTimesheetHours;
            } else {
                const durationHours = event?.scheduleDisplayOnly === true
                    ? Number(event?.scheduledDuration ?? event?.duration ?? 0)
                    : Number(event?.duration || 0);
                totalTimesheetHours += sessionStatusPolicyService.calculateTimesheetHoursByMap(statusMap, {
                    status: event?.status,
                    notes: event?.notes || '',
                    durationHours,
                    session: event
                });
            }
        } else {
            totalTimesheetHours += Number(event?.timesheetHours ?? event?.duration ?? 0);
        }
    }

    return {
        totalTimesheetHours: Number(totalTimesheetHours.toFixed(2)),
        eventCount: list.length,
        overlapCount
    };
}

async function getPersonById(personId, reqUser) {
    return getSchoolPersonRecordById(personId, reqUser);
}

async function buildEventsForPersonAndRange({
    personId,
    startDate,
    endDate,
    reqUser,
    activeOrgId,
    statusMap = null,
    accessContext = {},
    skipEnrichment = false
}) {
    const [studentIndex, teacherIndex, allClasses, allAssignments, allTemplates, allTeachers, allStudents, allEnrollmentPeriods] = await Promise.all([
        schoolDataService.getStudentIndex(),
        schoolDataService.getTeacherIndex(),
        schoolDataService.fetchAllData('classes', {}, reqUser, accessContext),
        schoolRepositories.reportAssignments.list({ query: {}, scope: { canViewAll: true } }),
        schoolRepositories.reportTemplates.list({ query: {}, scope: { canViewAll: true } }),
        schoolDataService.fetchAllData('teachers', {}, reqUser, accessContext),
        schoolDataService.fetchAllData('students', {}, reqUser, accessContext),
        activeOrgId
            ? schoolDataService.getClassEnrollmentPeriodsByOrg(activeOrgId, reqUser, accessContext).catch(() => [])
            : schoolDataService.fetchAllData('classEnrollmentPeriods', {}, reqUser, accessContext).catch(() => [])
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

    const person = await getSchoolPersonRecordById(normalizedPersonId, reqUser);
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
                if (rows.some((row) => idsEqual(row?.classId, normalizedClassId) && isOpenCanonicalEnrollmentPeriod(row, normalizedDate, reqUser?.orgToday))) {
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

    collectClassIdsFromTeacherIndex(teacherIndex, normalizedPersonId, teacherPersonMap)
        .forEach((classId) => candidateClassIds.add(classId));

    for (const classId of candidateClassIds) {
        if (classMap.has(classId)) continue;
        // eslint-disable-next-line no-await-in-loop
        const classRow = await schoolDataService.getDataById('classes', classId, reqUser, accessContext);
        if (classRow) classMap.set(classId, classRow);
    }

    const schedulePersonNameById = await buildSchedulePersonNameById({
        reqUser,
        students: allStudents,
        persons: [person].filter(Boolean),
        enrollmentPeriods: allEnrollmentPeriods,
        classes: allClasses
    });
    const resolveSoloStudentForSession = buildSoloStudentResolver({
        students: allStudents,
        persons: [person].filter(Boolean),
        enrollmentPeriods: allEnrollmentPeriods,
        classes: [...classMap.values()],
        activeOrgId,
        personNameByIdSeed: schedulePersonNameById
    });

    const classIdsToScan = candidateClassIds.size
        ? [...candidateClassIds]
        : [...classMap.keys()];

    const events = [];

    for (const classId of classIdsToScan) {
        const classDef = classMap.get(classId) || null;
        const classHasInstructor = hasInstructorMatchWithTeacherLink(classDef, normalizedPersonId, teacherPersonMap);
        const sessions = await schoolDataService.getClassSessions(classId, reqUser, accessContext);
        classSessionsById.set(classId, Array.isArray(sessions) ? sessions : []);

        for (const session of sessions || []) {
            const sessionDate = normalizeId(session?.date);
            if (!sessionDate || sessionDate < startDate || sessionDate > endDate) continue;

            const deliveredBy = resolveLinkedPersonId(session?.delivery?.deliveredBy, teacherPersonMap);
            const isOnDeliveryTeam = sessionDeliveryTeamService.isPersonOnSessionDelivery(
                session,
                normalizedPersonId,
                teacherPersonMap
            );
            const teacherAssigned = (
                deliveredBy || sessionDeliveryTeamService.getSessionCoTeachers(session).length
                    ? isOnDeliveryTeam
                    : classHasInstructor
            );
            const schedulePolicy = resolveClassSessionSchedulePolicy(effectiveStatusMap, session, { teacherAssigned });
            const isInstructorEvent = schedulePolicy.teacherVisible;
            const isStudentEvent = schedulePolicy.studentVisible && (await isStudentActiveOnDate({
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

            const sessionId = normalizeId(session?.sessionId || session?.id);
            const eventId = sessionId || `${classId}-${sessionDate}-${normalizeTime(session?.startTime) || '00:00'}`;
            const className = classDef?.title || classDef?.name || `Class ${classId}`;
            const classLifecycle = buildClassLifecycleSnapshot(classDef);
            const scheduledDuration = computeDurationHours(session);
            const scheduleHours = resolveClassSessionScheduleHours(
                effectiveStatusMap,
                session,
                scheduledDuration,
                schedulePolicy
            );
            const detailsUrl = sessionId
                ? sessionNavigationService.buildManageSessionHref(classId, { sessionId, date: sessionDate })
                : '';
            const soloStudent = resolveSoloStudentForSession(classDef, sessionDate);
            const resolvedSoloStudentName = soloStudent
                ? resolveReadableStudentLabel(
                    soloStudent.soloStudentName || resolveStudentNameFromSessionRoster(session, soloStudent) || '',
                    soloStudent.soloStudentId,
                    soloStudent.soloStudentPersonId,
                    schedulePersonNameById
                )
                : '';

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
                duration: scheduleHours.duration,
                scheduledDuration,
                timesheetHours: scheduleHours.timesheetHours,
                makeUpRequired: schedulePolicy.makeUpRequired,
                scheduleDisplayOnly: schedulePolicy.scheduleDisplayOnly,
                countsTowardHours: scheduleHours.countsTowardHours,
                blocksConflicts: schedulePolicy.blocksConflicts,
                status: normalizeSessionStatus(session),
                locked: session?.locked === true || String(session?.locked) === 'true',
                roles,
                roleLabel: roles.join(' / '),
                hasOverlap: false,
                eventType: 'class_session',
                detailsUrl,
                isOneOnOneClass: Boolean(soloStudent),
                soloStudentId: soloStudent?.soloStudentId || '',
                soloStudentPersonId: soloStudent?.soloStudentPersonId || '',
                soloStudentName: resolvedSoloStudentName,
                singleStudentName: resolvedSoloStudentName,
                merged: session?.merged && typeof session.merged === 'object' ? { ...session.merged } : null,
                mergedPartner: session?.mergedPartner && typeof session.mergedPartner === 'object' ? { ...session.mergedPartner } : null
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

    const approvedLeaveEvents = await leaveRequestService.getApprovedLeaveEventsForPerson({
        orgId: activeOrgId,
        personId: normalizedPersonId,
        startDate,
        endDate,
        reqUser
    });
    events.push(...approvedLeaveEvents);

    const activityEvents = await activityService.getScheduleEventsForPerson({
        orgId: activeOrgId,
        personId: normalizedPersonId,
        startDate,
        endDate,
        reqUser
    });
    events.push(...activityEvents);

    if (!skipEnrichment) {
        events.splice(0, events.length, ...await attachCaseSummariesToSessionEvents(events, reqUser));
    }
    sortEventsChronologically(events);
    if (!skipEnrichment) {
        markOverlappingEvents(events);
    }

    return { events, personName, personOrgRoles, allStudents, allTeachers, person };
}

async function showMySchedulePage(req, res) {
    try {
        const isAdminViewer = isScheduleAdminViewer(req.user);
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
        const isAdminViewer = isScheduleAdminViewer(req.user);
        const requestedPersonId = normalizeId(req.query.personId);
        const selfPersonId = getUserPersonId(req.user);
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
            statusMap,
            accessContext: schoolDataService.buildRouteAccessContext(req)
        });

        const yearlyEvents = result.events || [];
        const totalsByPeriod = {};
        PERIOD_KEYS.forEach((key) => {
            const periodEvents = filterEventsWithCasesIfRequested(filterEventsByRange(yearlyEvents, ranges[key]), req.query);
            totalsByPeriod[key] = {
                period: key,
                periodLabel: PERIOD_LABELS[key] || key,
                rangeLabel: ranges[key].label,
                ...summarizeEvents(periodEvents, statusMeta)
            };
        });

        const selectedEvents = filterEventsWithCasesIfRequested(filterEventsByRange(yearlyEvents, selectedRange), req.query).map((event) => ({
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
        const viewerScheduleAccess = await buildScheduleViewerAccess(req.user);
        const safePersonId = viewerScheduleAccess.canSelectAnyPerson ? (personId || '') : (viewerScheduleAccess.lockedPersonId || '');
        const safePersonName = viewerScheduleAccess.canSelectAnyPerson ? (personName || '') : (viewerScheduleAccess.lockedPersonName || '');

        res.render('school/schedule/personSchedule', {
            title: 'Master Schedule Viewer',
            includeModal: true,
            includePrintManager: true,
            user: req.user,
            
            // Pass the variables to the view (fallback to empty strings if null)
            prefillId: safePersonId,
            prefillName: safePersonName,
            prefillDate: date || '',
            viewerScheduleAccess,
            //
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
}

async function getPersonSchedule(req, res) {
    try {
        const {
            effectivePersonId,
            effectiveRole,
            startDate,
            endDate,
            viewerScheduleAccess,
            activeOrgId
        } = await resolvePersonScheduleRequest(req);

        const statusMeta = await sessionStatusPolicyService.getClientStatusMeta(activeOrgId || '', { includeInactive: true });
        const statusMap = sessionStatusPolicyService.getStatusMetaMap(statusMeta);
        const personResult = await buildEventsForPersonAndRange({
            personId: effectivePersonId,
            startDate,
            endDate,
            reqUser: req.user,
            activeOrgId,
            statusMap,
            accessContext: schoolDataService.buildRouteAccessContext(req)
        });

        const availableRoles = viewerScheduleAccess.canSelectAnyPerson
            ? await buildScheduleRoleOptionsForPerson({
                personId: effectivePersonId,
                activeOrgId,
                reqUser: req.user,
                students: personResult?.allStudents,
                teachers: personResult?.allTeachers,
                persons: personResult?.person ? [personResult.person] : []
            })
            : (Array.isArray(viewerScheduleAccess.availableRoles) ? viewerScheduleAccess.availableRoles : []);

        const filteredEvents = filterEventsWithCasesIfRequested(
            filterScheduleEventsForRole(personResult?.events, effectiveRole),
            req.query
        );
        const fingerprint = buildScheduleEventsFingerprint(filteredEvents);
        const events = filteredEvents.map((event) => {
            const isLeaveEvent = isApprovedLeaveScheduleEvent(event);
            const mapped = {
                ...event,
                role: isLeaveEvent ? 'Leave' : (event?.roles?.[0] || event?.role || 'Participant'),
                hourCategoryLabels: getScheduleEventHourCategoryLabels(event),
                detailsUrl: String(event?.detailsUrl || '').trim() || (
                    event.sessionId
                        ? `/school/classes/${encodeURIComponent(event.classId)}/sessions/${encodeURIComponent(event.sessionId)}`
                        : ''
                )
            };
            return mapped;
        });

        res.json({ status: 'success', events, statusMeta, viewerScheduleAccess, availableRoles, selectedRole: effectiveRole, fingerprint });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
}

async function getPersonScheduleVersion(req, res) {
    try {
        const {
            effectivePersonId,
            effectiveRole,
            startDate,
            endDate,
            activeOrgId
        } = await resolvePersonScheduleRequest(req);

        const statusMap = await sessionStatusPolicyService.getStatusMap(activeOrgId || '', { includeInactive: true });
        const personResult = await buildEventsForPersonAndRange({
            personId: effectivePersonId,
            startDate,
            endDate,
            reqUser: req.user,
            activeOrgId,
            statusMap,
            accessContext: schoolDataService.buildRouteAccessContext(req),
            skipEnrichment: true
        });

        const events = filterEventsWithCasesIfRequested(
            filterScheduleEventsForRole(personResult?.events, effectiveRole),
            req.query
        );
        const fingerprint = buildScheduleEventsFingerprint(events);

        res.json({ status: 'success', fingerprint, eventCount: events.length });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
}

async function pickerSchoolSchedulePersons(req, res) {
    try {
        const activeOrgId = getActiveScheduleOrgId(req.user);
        const q = String(req.query.q || req.query.search || '').trim().toLowerCase();
        const roleFilter = normalizeScheduleRole(req.query.role);
        const page = Math.max(1, Number(req.query.page || 1) || 1);
        const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || req.query.limit || 25) || 25));
        const rows = await buildSchoolSchedulePersonPickerRows({ activeOrgId, reqUser: req.user });
        const filtered = rows
            .filter((row) => !roleFilter || (Array.isArray(row.roles) && row.roles.map(normalizeScheduleRole).includes(roleFilter)))
            .filter((row) => !q || String(row.searchText || '').includes(q));
        const start = (page - 1) * pageSize;
        const items = filtered.slice(start, start + pageSize).map(({ searchText, ...row }) => row);
        const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
        const pagination = {
            page,
            currentPage: page,
            limit: pageSize,
            pageSize,
            totalItems: filtered.length,
            totalPages
        };
        res.json({
            status: 'success',
            items,
            data: items,
            results: items,
            total: filtered.length,
            page,
            pageSize,
            totalPages,
            pagination
        });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
}

async function listActiveTeacherSchedulePersons(req, res) {
    try {
        const activeOrgId = getActiveScheduleOrgId(req.user);
        const [teachers, persons] = await Promise.all([
            schoolDataService.fetchAllData('teachers', {}, req.user),
            listSchoolPersonRecords(req.user, { query: { limit: 1000 } }),
        ]);

        const personMap = new Map((Array.isArray(persons) ? persons : [])
            .map((person) => [normalizeId(person?.id || person?._id), person]));
        const seenPersonIds = new Set();
        const items = [];

        (Array.isArray(teachers) ? teachers : []).forEach((teacher) => {
            if (!rowBelongsToActiveOrg(teacher, activeOrgId) || !isActiveSchoolIdentityRow(teacher)) return;
            const personId = normalizeId(teacher?.personId);
            if (!personId || seenPersonIds.has(personId)) return;
            seenPersonIds.add(personId);

            const person = personMap.get(personId) || { id: personId };
            const displayName = buildPersonDisplayName(person, personId);
            const availableRoles = [{ key: 'teacher', label: 'Teacher', source: 'school-record' }];
            items.push({
                id: personId,
                personId,
                teacherId: normalizeId(teacher?.id),
                firstName: person?.name?.first || teacher?.firstName || '',
                middleName: person?.name?.middle || '',
                lastName: person?.name?.last || teacher?.lastName || '',
                displayName,
                name: displayName,
                availableRoles,
                roles: ['teacher'],
                roleLabels: ['Teacher'],
                selectedRole: 'teacher'
            });
        });

        items.sort((a, b) => String(a.displayName || a.id).localeCompare(String(b.displayName || b.id)));
        const pagination = {
            page: 1,
            currentPage: 1,
            limit: items.length,
            pageSize: items.length,
            totalItems: items.length,
            totalPages: 1
        };

        res.json({
            status: 'success',
            items,
            data: items,
            results: items,
            total: items.length,
            pagination
        });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
}

async function showGlobalSchedulePage(req, res) {
    res.render('school/schedule/globalSchedule', {
        title: 'Global Schedule Comparison',
        includeModal: true,
        user: req.user,
        tableName: 'Global_Schedule_Comparison'
    });
}

async function getGlobalSchedule(req, res) {
    try {
        const { personIds, personRoles, startDate, endDate } = req.query;
        if (!personIds || !startDate || !endDate) throw new Error('Person IDs, Start Date, and End Date are required.');
        const activeOrgId = normalizeId(req.user?.activeOrgId);
        const statusMeta = await sessionStatusPolicyService.getClientStatusMeta(activeOrgId || '', { includeInactive: true });
        const statusMap = sessionStatusPolicyService.getStatusMetaMap(statusMeta);

        const pIdArray = String(personIds || '').split(',').map((id) => id.trim()).filter(Boolean);
        const roleArray = String(personRoles || '').split(',').map((role) => role.trim());
        const selections = pIdArray.map((personId, index) => ({
            personId,
            role: normalizeScheduleRole(roleArray[index] || '')
        }));

        let events = [];
        const personSummaries = [];

        for (let selectionIndex = 0; selectionIndex < selections.length; selectionIndex += 1) {
            const { personId, role } = selections[selectionIndex];
            // eslint-disable-next-line no-await-in-loop
            const result = await buildEventsForPersonAndRange({
                personId,
                startDate: String(startDate || '').trim(),
                endDate: String(endDate || '').trim(),
                reqUser: req.user,
                activeOrgId,
                statusMap,
                accessContext: schoolDataService.buildRouteAccessContext(req)
            });
            const personName = String(result?.personName || personId).trim() || personId;
            let personEvents = Array.isArray(result?.events) ? result.events : [];
            if (role) {
                personEvents = filterScheduleEventsForRole(personEvents, role);
            }
            personEvents = filterEventsWithCasesIfRequested(personEvents, req.query);
            personEvents = personEvents.map((event) => ({
                ...event,
                personId: normalizeId(event?.personId || personId),
                personName,
                selectionIndex,
                selectionRole: role,
                role: event?.roles?.[0] || event?.role || 'Participant'
            }));

            personSummaries.push({
                personId: normalizeId(personId),
                personName,
                role,
                ...summarizeTimesheetHoursForEvents(personEvents, statusMap)
            });
            events.push(...personEvents);
        }

        events.sort((a, b) => {
            const dateA = new Date(`${a.date}T${a.start || '00:00'}`);
            const dateB = new Date(`${b.date}T${b.start || '00:00'}`);
            return dateA - dateB;
        });

        // Overlap detection only flags blocking events owned by the same person.
        markOverlappingEvents(events, { samePersonOnly: true });

        for (let i = 0; i < personSummaries.length; i += 1) {
            const selectionEvents = events.filter((event) => event.selectionIndex === i);
            const refreshed = summarizeTimesheetHoursForEvents(selectionEvents, statusMap);
            personSummaries[i].totalTimesheetHours = refreshed.totalTimesheetHours;
            personSummaries[i].eventCount = refreshed.eventCount;
            personSummaries[i].overlapCount = refreshed.overlapCount;
        }

        res.json({ status: 'success', events, statusMeta, personSummaries });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
}

module.exports = {
    showSchedulePage,
    showMySchedulePage,
    getMyScheduleData,
    getPersonSchedule,
    getPersonScheduleVersion,
    pickerSchoolSchedulePersons,
    listActiveTeacherSchedulePersons,
    showGlobalSchedulePage,
    getGlobalSchedule,
    buildScheduleViewerAccess,
    buildSchoolSchedulePersonPickerRows,
    buildEventsForPersonAndRange,
    buildScheduleEventsFingerprint,
    filterScheduleEventsForRole,
    summarizeEvents,
    summarizeTimesheetHoursForEvents,
    getScheduleEventHourCategoryLabels,
    resolveClassSessionSchedulePolicy,
    resolveClassSessionScheduleHours,
    doesScheduleEventCountTowardHours,
    doesScheduleEventBlockConflicts,
    markOverlappingEvents,
    isAllowedMergedSessionOverlap
};

