// MVC/controllers/school/attendanceController.js
const schoolDataService = require('../../services/school/schoolDataService');
const schoolIdentityLookupService = require('../../services/school/schoolIdentityLookupService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { resolveOrgTodayFromRequest, resolveOrgTodayFromContext } = requireCoreModule('MVC/utils/timezoneUtils');
const chatRepository = requireCoreModule('MVC/repositories/chatRepository');
const socketService = requireCoreModule('MVC/services/socketService'); // IMPORT SOCKET SERVICE
const sessionStatusPolicyService = require('../../services/school/sessionStatusPolicyService');
const classEnrollmentReadService = require('../../services/school/classEnrollmentReadService');
const classEnrollmentSessionApplicabilityService = require('../../services/school/classEnrollmentSessionApplicabilityService');
const leaveRequestService = require('../../services/school/leaveRequestService');
const attendanceMatrixMetricsService = require('../../services/school/attendanceMatrixMetricsService');
const attendanceExcelExportService = require('../../services/school/attendanceExcelExportService');
const attendanceMatrixPolicyModel = require('../../models/school/attendanceMatrixPolicyModel');
const schoolStudentProfileLinkService = require('../../services/school/schoolStudentProfileLinkService');
const schoolFileService = require('../../services/school/schoolFileService');
const { userCanManageAttendanceMatrixPolicy } = require('../../middleware/attendanceMatrixPolicyAdminMiddleware');
const accessService = requireCoreModule('MVC/services/security/index');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');

function resolveClassTeacherName(classData = {}) {
    const instructors = Array.isArray(classData?.instructors) ? classData.instructors : [];
    const primary = instructors.find((row) => row && (row.primary === true || row.isPrimary === true))
        || instructors[0]
        || null;
    return String(primary?.name || primary?.displayName || '').trim();
}

function readPersonEmail(person = {}) {
    const emails = Array.isArray(person?.contact?.emails) ? person.contact.emails : [];
    return String(
        person?.contact?.email
        || person?.contact?.primaryEmail
        || person?.email
        || emails[0]?.email
        || ''
    ).trim();
}

function readUserEmail(user = {}) {
    return String(user?.email || user?.identity?.email || user?.profile?.email || '').trim();
}

function normalizeCommentMentions(mentions = []) {
    return (Array.isArray(mentions) ? mentions : [])
        .map((mention) => ({
            id: String(mention?.id || mention?.userId || '').trim(),
            name: String(mention?.name || mention?.displayName || '').trim(),
            email: String(mention?.email || '').trim()
        }))
        .filter((mention) => mention.id);
}

function buildUserContactLookup(users = []) {
    const byId = new Map();
    (Array.isArray(users) ? users : []).forEach((user) => {
        const id = String(user?.id || user?.userId || '').trim();
        if (!id) return;
        byId.set(id, {
            name: String(user?.displayName || user?.name || user?.username || '').trim(),
            email: readUserEmail(user)
        });
    });
    return byId;
}

function enrichAttendanceComments(comments = [], userById = new Map()) {
    return (Array.isArray(comments) ? comments : []).map((comment) => {
        if (!comment || typeof comment === 'string') return comment;
        const authorId = String(comment.authorId || '').trim();
        const lookup = authorId ? userById.get(authorId) : null;
        const mentions = normalizeCommentMentions(comment.mentions).map((mention) => {
            const mentionLookup = userById.get(mention.id);
            return {
                ...mention,
                name: mention.name || mentionLookup?.name || '',
                email: mention.email || mentionLookup?.email || ''
            };
        });
        return {
            ...comment,
            authorName: String(comment.authorName || lookup?.name || '').trim(),
            authorEmail: String(comment.authorEmail || lookup?.email || '').trim(),
            mentions
        };
    });
}

function getLatestClbLevelEntry(studentRecord = {}) {
    const history = Array.isArray(studentRecord?.clbLevelHistory) ? studentRecord.clbLevelHistory : [];
    return [...history].sort((a, b) => {
        const dateCmp = String(b?.recordedAt || '').localeCompare(String(a?.recordedAt || ''));
        if (dateCmp !== 0) return dateCmp;
        return String(b?.id || '').localeCompare(String(a?.id || ''));
    })[0] || null;
}

function resolveEnrollmentDatesForPerson({
    periodRows = [],
    studentToPersonMap,
    personId = '',
    studentRecordId = '',
    windowStart = '',
    windowEnd = ''
} = {}) {
    const targetPersonId = String(personId || '').trim();
    const targetStudentId = String(studentRecordId || '').trim();
    const matches = (Array.isArray(periodRows) ? periodRows : []).filter((row) => {
        const sid = String(row?.studentId || '').trim();
        if (!sid) return false;
        if (targetStudentId && sid === targetStudentId) return true;
        const mappedPerson = String(studentToPersonMap?.get(sid) || '').trim();
        return (mappedPerson && mappedPerson === targetPersonId) || sid === targetPersonId;
    });
    if (!matches.length) {
        return { enrollmentStartDate: '', enrollmentEndDate: '', funderType: '', funderId: '' };
    }

    const ws = normalizeDateOnly(windowStart) || '0000-01-01';
    const we = normalizeDateOnly(windowEnd) || '9999-12-31';
    const overlapping = matches.filter((row) => {
        const start = normalizeDateOnly(row?.startDate);
        if (!start) return false;
        const effectiveEnd = classEnrollmentSessionApplicabilityService.periodEffectiveEndDate(row) || '9999-12-31';
        return start <= we && effectiveEnd >= ws;
    });
    const pool = (overlapping.length ? overlapping : matches).slice().sort((a, b) => (
        String(b?.startDate || '').localeCompare(String(a?.startDate || ''))
    ));
    const chosen = pool[0] || null;
    if (!chosen) return { enrollmentStartDate: '', enrollmentEndDate: '', funderType: '', funderId: '' };

    const enrollmentStartDate = normalizeDateOnly(chosen.startDate);
    const rawEnd = normalizeDateOnly(chosen.endDate)
        || normalizeDateOnly(chosen.completionDate);
    const enrollmentEndDate = rawEnd && rawEnd !== '9999-12-31' ? rawEnd : '';
    return {
        enrollmentStartDate,
        enrollmentEndDate,
        funderType: String(chosen.funderType || '').trim(),
        funderId: String(chosen.funderId || '').trim()
    };
}

function resolveClbMapsForStudent(studentRecord = null) {
    const latest = getLatestClbLevelEntry(studentRecord || {});
    if (!latest) {
        return { clbCurrent: {}, clbGoal: {} };
    }
    return {
        clbCurrent: latest.current && typeof latest.current === 'object' ? latest.current : {},
        clbGoal: latest.goal && typeof latest.goal === 'object' ? latest.goal : {}
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

async function assertAttendanceMatrixSessionEditable(req, classData, session) {
    const isSessionLocked = session.locked === true || String(session.locked) === 'true';
    const canOverride = await adminAuthorityService.isAdminForRequestAsync(
        req.user,
        SECTIONS.SCHOOL_ATTENDANCES,
        OPERATIONS.UPDATE,
        { section: { id: SECTIONS.SCHOOL_ATTENDANCES } }
    );
    if (isSessionLocked && !canOverride) {
        throw new Error('This session is locked and cannot be edited. Please contact an administrator.');
    }

    const statusMap = await sessionStatusPolicyService.getStatusMap(
        String(classData?.orgId || req.user?.activeOrgId || '').trim(),
        { includeInactive: true }
    );
    if (sessionStatusPolicyService.shouldForceNotApplicableAttendanceByMap(statusMap, {
        status: session?.status,
        notes: session?.notes
    })) {
        throw new Error('This original session is inactive because its status requires a make-up session. Attendance cannot be changed from the matrix. Create or open the make-up session instead.');
    }
}

function resolveDateWindow({ sessions = [], startDate = '', endDate = '', orgToday = '' } = {}) {
    const sessionDates = (Array.isArray(sessions) ? sessions : [])
        .map((row) => normalizeDateOnly(row?.date))
        .filter(Boolean)
        .sort();
    const fallbackToday = resolveOrgTodayFromContext({ orgToday });
    const start = normalizeDateOnly(startDate) || sessionDates[0] || fallbackToday;
    const end = normalizeDateOnly(endDate) || sessionDates[sessionDates.length - 1] || start;
    return { start, end };
}

function historicalRosterPeriodOverlapsWindow(period, windowStart, windowEnd) {
    const status = String(period?.status || '').trim().toLowerCase();
    if (!classEnrollmentReadService.HISTORICAL_ROLLING_ROSTER_STATUSES.includes(status)) return false;
    const start = normalizeDateOnly(period?.startDate);
    const end = normalizeDateOnly(period?.endDate) || '9999-12-31';
    const ws = normalizeDateOnly(windowStart);
    const we = normalizeDateOnly(windowEnd);
    if (!start || !ws || !we) return false;
    return start <= we && end >= ws;
}

function historicalRosterPeriodCoversDate(period, sessionDate) {
    const date = normalizeDateOnly(sessionDate);
    if (!date) return false;
    return historicalRosterPeriodOverlapsWindow(period, date, date);
}

function buildAttendanceApplicabilityKey(personId, sessionId) {
    return String(personId || '').trim() + '::' + String(sessionId || '').trim();
}

function isRollingEnrollmentClass(classData = {}) {
    return String(classData?.registrationMode || '').trim().toLowerCase() === 'rolling';
}

async function resolveAttendanceEnrollmentWindow({ classData, session, studentPersonId, reqUser }) {
    if (!isRollingEnrollmentClass(classData)) {
        return { withinEnrollmentWindow: true, reason: '', periodId: '' };
    }

    const [periodRows, students] = await Promise.all([
        schoolDataService.getClassEnrollmentPeriodsByClassId(classData.id, reqUser),
        schoolDataService.fetchData('students', {}, reqUser)
    ]);
    const studentToPersonMap = new Map(
        (Array.isArray(students) ? students : [])
            .map((row) => [String(row?.id || '').trim(), String(row?.personId || '').trim()])
            .filter(([studentId, personId]) => studentId && personId)
    );
    return classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentWindowForPerson({
        periodRows: Array.isArray(periodRows) ? periodRows : [],
        studentToPersonMap,
        personId: studentPersonId,
        session,
        activeOrgId: String(classData?.orgId || reqUser?.activeOrgId || '').trim(),
        allowedStatuses: classEnrollmentSessionApplicabilityService.OPEN_OR_HISTORICAL_STATUSES
    });
}

async function assertAttendanceEnrollmentWindow({ classData, session, studentPersonId, reqUser }) {
    const enrollmentWindow = await resolveAttendanceEnrollmentWindow({
        classData,
        session,
        studentPersonId,
        reqUser
    });
    if (enrollmentWindow.withinEnrollmentWindow) return enrollmentWindow;
    const sessionDate = normalizeDateOnly(session?.date) || 'this session date';
    throw new Error(`Attendance cannot be updated because this student was not enrolled in the class on ${sessionDate}.`);
}

function isActiveAttendanceClass(row = {}) {
    const status = String(row?.status || '').trim().toLowerCase();
    return status === 'active';
}

function classBelongsToActiveOrg(row = {}, activeOrgId = '') {
    const scopedOrgId = String(activeOrgId || '').trim();
    if (!scopedOrgId) return true;
    const rowOrgId = String(row?.orgId || row?.organizationId || row?.schoolOrgId || '').trim();
    if (!rowOrgId) return true;
    return idsEqual(rowOrgId, scopedOrgId);
}

async function showAttendancePage(req, res) {
    try {
        const canManageAttendanceMatrixPolicy = await userCanManageAttendanceMatrixPolicy(req.user, req.ip);
        const editEval = await accessService.evaluateAccess({
            user: req.user,
            sectionId: SECTIONS.SCHOOL_ATTENDANCES,
            operationId: OPERATIONS.UPDATE,
            ipAddress: req.ip
        });
        const canEditAttendanceRoster = Boolean(editEval?.allowed);
        let canOverrideSessionLock = await adminAuthorityService.isAdminForRequestAsync(
            req.user,
            SECTIONS.SCHOOL_ATTENDANCES,
            OPERATIONS.UPDATE,
            { section: { id: SECTIONS.SCHOOL_ATTENDANCES } }
        );

        const q = req.query || {};
        const initialClassId = String(q.classId || '').trim();
        const initialStartDate = String(q.startDate || '').trim();
        const initialEndDate = String(q.endDate || '').trim();
        const initialStudentId = String(q.studentId || '').trim();
        const initialSessionId = String(q.sessionId || '').trim();
        const initialRange = String(q.range || '').trim();
        let initialClassName = String(q.className || '').trim();
        if (initialClassId && !initialClassName) {
            try {
                const classRow = await schoolDataService.getDataById('classes', initialClassId, req.user);
                if (classRow?.title) initialClassName = String(classRow.title).trim();
            } catch (e) {
                /* leave name empty */
            }
        }

        res.render('school/attendance/attendanceViewer', {
            title: 'Attendance Matrix',
            includeModal: true,
            user: req.user,
            actionStateId: req.actionStateId,
            tableName: 'Attendance_Matrix',
            canManageAttendanceMatrixPolicy,
            canEditAttendanceRoster,
            canOverrideSessionLock,
            initialClassId,
            initialClassName,
            initialStartDate,
            initialEndDate,
            initialStudentId,
            initialSessionId,
            initialRange
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

async function listActiveAttendanceClasses(req, res) {
    try {
        const activeOrgId = String(req.user?.activeOrgId || '').trim();
        const classes = await schoolDataService.fetchData('classes', {}, req.user);
        const items = (Array.isArray(classes) ? classes : [])
            .filter((row) => classBelongsToActiveOrg(row, activeOrgId))
            .filter(isActiveAttendanceClass)
            .map((row) => ({
                id: String(row?.id || '').trim(),
                classId: String(row?.id || '').trim(),
                title: String(row?.title || row?.name || row?.id || '').trim(),
                name: String(row?.title || row?.name || row?.id || '').trim(),
                status: String(row?.status || '').trim(),
                orgId: String(row?.orgId || '').trim(),
                registrationMode: String(row?.registrationMode || '').trim(),
                cycleNo: row?.cycleNo || ''
            }))
            .filter((row) => row.id)
            .sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));

        res.json({
            status: 'success',
            items,
            data: items,
            total: items.length
        });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
}

async function showAttendanceMatrixSettings(req, res) {
    try {
        const activeOrgId = String(req.user?.activeOrgId || '').trim();
        let policyItems = await attendanceMatrixPolicyModel.listPolicyItemsForOrg(activeOrgId);
        if (!policyItems.length) {
            policyItems = [{
                ...attendanceMatrixPolicyModel.DEFAULT_POLICY,
                id: '',
                isDefault: true
            }];
        }
        const policy = await attendanceMatrixPolicyModel.getPolicyForOrg(activeOrgId);
        res.render('school/attendance/attendanceMatrixPolicy', {
            title: 'Attendance Matrix — Threshold Settings',
            includeModal: true,
            user: req.user,
            actionStateId: req.actionStateId,
            policy,
            policyItems,
            policyOrgKey: attendanceMatrixPolicyModel.orgKey(activeOrgId),
            saved: req.query.saved === '1',
            errorMessage: null
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

async function saveAttendanceMatrixSettings(req, res) {
    try {
        const activeOrgId = String(req.user?.activeOrgId || '').trim();
        const rawItems = attendanceMatrixPolicyModel.parsePolicyItemsFromBody(req.body || {});
        await attendanceMatrixPolicyModel.savePolicyItemsForOrg(activeOrgId, rawItems, req.user?.id);
        res.redirect('/school/attendances/settings?saved=1');
    } catch (error) {
        const activeOrgId = String(req.user?.activeOrgId || '').trim();
        let policyItems = [];
        try {
            policyItems = attendanceMatrixPolicyModel.normalizePolicyItemsForSave(
                attendanceMatrixPolicyModel.parsePolicyItemsFromBody(req.body || {})
            );
        } catch (_) {
            policyItems = await attendanceMatrixPolicyModel.listPolicyItemsForOrg(activeOrgId);
        }
        const policy = await attendanceMatrixPolicyModel.getPolicyForOrg(activeOrgId);
        res.status(400).render('school/attendance/attendanceMatrixPolicy', {
            title: 'Attendance Matrix — Threshold Settings',
            includeModal: true,
            user: req.user,
            actionStateId: req.actionStateId,
            policy,
            policyItems: policyItems.length ? policyItems : [{
                ...attendanceMatrixPolicyModel.DEFAULT_POLICY,
                id: '',
                isDefault: true
            }],
            policyOrgKey: attendanceMatrixPolicyModel.orgKey(req.user?.activeOrgId),
            saved: false,
            errorMessage: error.message || 'Could not save settings.'
        });
    }
}

async function buildAttendanceMatrixPayload(req) {
        const { classId, startDate, endDate } = req.query;
        if (!classId) throw new Error('Class ID is required.');

        const classData = await schoolDataService.getDataById('classes', classId, req.user);
        if (!classData) throw new Error('Class not found.');
        
        const allSessions = await schoolDataService.getClassSessions(classId, req.user);

        const statusMap = await sessionStatusPolicyService.getStatusMap(classData?.orgId || req.user?.activeOrgId || '', {
            includeInactive: true
        });
        const filteredSessions = [];
        (allSessions || []).forEach((sessionRow) => {
            if (sessionStatusPolicyService.shouldExcludeFromAttendanceByMap(statusMap, {
                status: sessionRow?.status,
                notes: sessionRow?.notes
            })) return;
            if (startDate && sessionRow.date < startDate) return;
            if (endDate && sessionRow.date > endDate) return;
            filteredSessions.push(sessionRow);
        });
        filteredSessions.sort((a, b) => new Date(a.date) - new Date(b.date));

        const [persons, students, taggableUsersPayload] = await Promise.all([
            schoolIdentityLookupService.listSchoolPersonRecords({
                reqUser: req.user,
                requireSchoolRole: false,
                query: { limit: 1000 }
            }).then((payload) => payload.allRows || payload.rows || []),
            schoolDataService.fetchData('students', {}, req.user),
            schoolIdentityLookupService.listTaggableUsers({
                reqUser: req.user,
                query: { limit: 1000 }
            }).catch(() => ({ allRows: [], rows: [] }))
        ]);
        const userContactById = buildUserContactLookup(
            taggableUsersPayload.allRows || taggableUsersPayload.rows || []
        );

        const studentToPersonMap = new Map(
            (Array.isArray(students) ? students : [])
                .map((row) => [String(row?.id || '').trim(), String(row?.personId || '').trim()])
                .filter(([studentId, personId]) => studentId && personId)
        );

        const activeOrgId = String(req.user?.activeOrgId || classData?.orgId || '').trim();
        const forceNotApplicableSessionKeys = sessionStatusPolicyService.buildForceNotApplicableAttendanceSessionKeys(statusMap, filteredSessions);
        const sessionDates = filteredSessions.map((row) => String(row?.date || '').trim()).filter(Boolean);
        const enrollmentSnapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
            classId: classData.id,
            classItem: classData,
            reqUser: req.user,
            activeOrgId,
            sessionDates,
            startDate: String(startDate || '').trim(),
            endDate: String(endDate || '').trim(),
            // Attendance Matrix should use historical rolling rosters for matching session/date windows.
            canonicalStatuses: ['active']
        });
        const registrationMode = String(classData?.registrationMode || '').trim().toLowerCase();
        const activePersonIds = new Set();
        let rollingApplicability = null;
        const enrollmentPeriodRows = await schoolDataService.getClassEnrollmentPeriodsByClassId(classData.id, req.user)
            .then((rows) => (Array.isArray(rows) ? rows : []))
            .catch(() => []);
        let rollingPeriodRows = [];

        if (registrationMode === 'rolling') {
            rollingPeriodRows = enrollmentPeriodRows;
            rollingApplicability = await classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentApplicabilityWithLeaves({
                sessions: filteredSessions,
                periodRows: rollingPeriodRows,
                studentToPersonMap,
                activeOrgId,
                orgId: classData?.orgId || activeOrgId,
                reqUser: req.user,
                allowedStatuses: classEnrollmentSessionApplicabilityService.OPEN_OR_HISTORICAL_STATUSES,
                forceNotApplicableSessionKeys
            });
            rollingApplicability.personIds.forEach((personId) => activePersonIds.add(String(personId || '').trim()));
        } else {
            const studentIds = enrollmentSnapshot.studentIds instanceof Set
                ? enrollmentSnapshot.studentIds
                : new Set();
            studentIds.forEach((id) => {
                const studentId = String(id || '').trim();
                if (!studentId) return;
                activePersonIds.add(String(studentToPersonMap.get(studentId) || studentId).trim());
            });
        }

        const personToStudentMap = schoolStudentProfileLinkService.buildPersonIdToStudentRecordIdMap(students, activeOrgId);
        const studentsById = new Map(
            (Array.isArray(students) ? students : [])
                .map((row) => [String(row?.id || '').trim(), row])
                .filter(([id]) => id)
        );
        const exportWindowStart = String(startDate || '').trim() || (sessionDates[0] || '');
        const exportWindowEnd = String(endDate || '').trim() || (sessionDates[sessionDates.length - 1] || '');

        let studentList = Array.from(activePersonIds).map(uid => {
            const person = persons.find(p => String(p.id) === uid);
            const firstName = String(person?.name?.first || '').trim();
            const lastName = String(person?.name?.last || '').trim();
            const name = person
                ? `${firstName} ${lastName}`.trim() || `Person ${uid}`
                : `Person ${uid}`;
            const studentRecordId = schoolStudentProfileLinkService.resolveStudentRecordId({
                personId: uid,
                personToStudentMap
            });
            const studentRecord = studentsById.get(String(studentRecordId || '').trim()) || null;
            const { enrollmentStartDate, enrollmentEndDate, funderType, funderId } = resolveEnrollmentDatesForPerson({
                periodRows: enrollmentPeriodRows,
                studentToPersonMap,
                personId: uid,
                studentRecordId,
                windowStart: exportWindowStart,
                windowEnd: exportWindowEnd
            });
            const { clbCurrent, clbGoal } = resolveClbMapsForStudent(studentRecord);
            return {
                personId: uid,
                name,
                firstName,
                lastName,
                email: readPersonEmail(person || {}),
                studentRecordId,
                enrollmentStartDate,
                enrollmentEndDate,
                funderType,
                funderId,
                clbCurrent,
                clbGoal
            };
        });
        studentList.sort((a, b) => a.name.localeCompare(b.name));

        const orgPolicyLayer = await attendanceMatrixPolicyModel.getPolicyForOrg(
            String(req.user?.activeOrgId || classData?.orgId || '').trim()
        );
        const orgPolicyItems = await attendanceMatrixPolicyModel.listPolicyItemsForOrg(
            String(req.user?.activeOrgId || classData?.orgId || '').trim()
        );
        const orgPolicyCatalog = { items: orgPolicyItems };
        const attendancePolicy = attendanceMatrixMetricsService.resolvePolicy(classData, orgPolicyLayer);
        const enabledAttendanceStatuses = attendanceMatrixMetricsService.resolveEnabledAttendanceStatuses(classData);

        const getApplicabilityForSession = (stu, ses) => {
            if (registrationMode !== 'rolling') return { expected: true, reason: 'date_window' };
            return classEnrollmentSessionApplicabilityService.getApplicabilityState(
                rollingApplicability?.stateByKey,
                stu.personId,
                ses,
                ses?.sessionId || ses?.id
            ) || { expected: false, reason: 'not_enrolled' };
        };
        const enrollmentWindowStateByKey = new Map();
        const getEnrollmentWindowForSession = (stu, ses) => {
            if (registrationMode !== 'rolling') return { withinEnrollmentWindow: true, reason: '', periodId: '' };
            const key = buildAttendanceApplicabilityKey(stu.personId, ses?.sessionId || ses?.id);
            if (!enrollmentWindowStateByKey.has(key)) {
                enrollmentWindowStateByKey.set(key, classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentWindowForPerson({
                    periodRows: rollingPeriodRows,
                    studentToPersonMap,
                    personId: stu.personId,
                    session: ses,
                    activeOrgId,
                    allowedStatuses: classEnrollmentSessionApplicabilityService.OPEN_OR_HISTORICAL_STATUSES
                }));
            }
            return enrollmentWindowStateByKey.get(key);
        };
        const matrix = studentList.map((stu) => {
            const records = filteredSessions.map(ses => {
                const rosterRecord = ses.roster?.find(r => String(r.personId) === stu.personId);
                const sessionLocked = ses.locked === true || String(ses.locked) === 'true';
                const applicabilityState = getApplicabilityForSession(stu, ses);
                const enrollmentWindow = getEnrollmentWindowForSession(stu, ses);
                const withinEnrollmentWindow = enrollmentWindow.withinEnrollmentWindow === true;
                const forceNotApplicable = forceNotApplicableSessionKeys.has(String(ses?.sessionId || ses?.id || '').trim())
                    || forceNotApplicableSessionKeys.has(String(ses?.date || '').trim());
                const expectedForSession = withinEnrollmentWindow && !forceNotApplicable && Boolean(applicabilityState.expected);
                const hasApprovedLeave = applicabilityState.reason === 'approved_leave';
                let status = !withinEnrollmentWindow
                    ? attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE
                    : (forceNotApplicable
                    ? attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE
                    : (rosterRecord
                        ? attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(rosterRecord.attendance, '')
                        : (expectedForSession ? '' : attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE)));
                let applicability = !withinEnrollmentWindow
                    ? 'not_enrolled'
                    : (forceNotApplicable ? 'makeup_required' : (rosterRecord ? 'manual' : (expectedForSession ? 'expected_missing' : (applicabilityState.reason || 'not_enrolled'))));
                if (withinEnrollmentWindow && !forceNotApplicable && hasApprovedLeave && (!rosterRecord || attendanceMatrixMetricsService.isAbsentLikeStatus(status))) {
                    status = attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE;
                    applicability = 'approved_leave';
                } else if (withinEnrollmentWindow && !forceNotApplicable && status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE && rosterRecord) {
                    applicability = 'manual_not_applicable';
                }
                return {
                    sessionId: ses.sessionId,
                    date: ses.date,
                    status,
                    applicability,
                    expectedForSession,
                    withinEnrollmentWindow,
                    enrollmentWindowReason: withinEnrollmentWindow ? '' : enrollmentWindow.reason,
                    hasApprovedLeave,
                    lateMinutes: status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE ? 0 : (rosterRecord?.lateMinutes || 0),
                    earlyLeaveMinutes: status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE ? 0 : (rosterRecord?.earlyLeaveMinutes || 0),
                    excuseRef: rosterRecord?.excuseRef || '',
                    excuseAttachment: rosterRecord?.excuseAttachment || null,
                    teacherNotes: (rosterRecord?.notes) || ses.notes || '',
                    rosterStudentNotes: rosterRecord?.notes || '',
                    sessionLevelNote: ses.notes || '',
                    sessionLocked,
                    comments: enrichAttendanceComments(rosterRecord?.comments || [], userContactById),
                    scheduledMinutes: attendanceMatrixMetricsService.scheduledMinutesFromSession(
                        ses,
                        attendancePolicy.scheduledMinutes
                    )
                };
            });
            const summary = attendanceMatrixMetricsService.computeStudentMatrixSummary(
                records,
                classData,
                orgPolicyCatalog
            );
            return { ...stu, records, summary };
        });

        const canManageAttendanceMatrixPolicy = await userCanManageAttendanceMatrixPolicy(req.user, req.ip);
        const payload = {
            classId: classId,
            className: classData.title,
            teacherName: resolveClassTeacherName(classData),
            startDate: String(startDate || '').trim(),
            endDate: String(endDate || '').trim(),
            sessions: filteredSessions.map(s => ({ id: s.sessionId, date: s.date, status: s.status })),
            matrix,
            enabledAttendanceStatuses,
            enrollmentSource: registrationMode === 'rolling'
                ? 'canonical_active_only_rolling'
                : String(enrollmentSnapshot?.source || 'legacy'),
            enrollmentUsedFallback: Boolean(enrollmentSnapshot?.usedFallback)
        };
        // Threshold numbers are admin-only; matrix itself is also admin-gated at the route.
        if (canManageAttendanceMatrixPolicy) {
            payload.attendancePolicy = attendancePolicy;
            payload.attendancePolicyItems = orgPolicyItems;
        }
        return payload;
}

async function getAttendanceData(req, res) {
    try {
        const payload = await buildAttendanceMatrixPayload(req);
        res.json({
            status: 'success',
            ...payload
        });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
}

async function exportAttendanceExcel(req, res) {
    try {
        const payload = await buildAttendanceMatrixPayload(req);
        const filteredPayload = attendanceExcelExportService.filterMatrixByPersonIds(
            payload,
            req.query?.personIds
        );
        const { buffer, filename } = await attendanceExcelExportService.buildAttendanceExcelWorkbook(filteredPayload);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', buffer.length);
        return res.status(200).send(buffer);
    } catch (error) {
        const wantsJson = String(req.headers.accept || '').includes('application/json')
            || String(req.headers['x-ajax-request'] || '') === 'true';
        if (wantsJson) {
            return res.status(400).json({ status: 'error', message: error.message });
        }
        return res.status(400).send(error.message || 'Unable to export attendance Excel.');
    }
}

// --- Interactive Comment Engine with Chat Integration ---
async function addAttendanceComment(req, res) {
    try {
        const { classId, sessionId, studentPersonId, text, mentions, attachment } = req.body;
        if (!classId || !sessionId || !studentPersonId || !text) throw new Error('Missing required fields.');

        const classData = await schoolDataService.getDataById('classes', classId, req.user);
        const sessions = await schoolDataService.getClassSessions(classId, req.user);
        const sessionIndex = sessions.findIndex(s => s.sessionId === sessionId);
        if (sessionIndex === -1) throw new Error('Session not found.');

        const session = sessions[sessionIndex];
        await assertAttendanceMatrixSessionEditable(req, classData, session);
        await assertAttendanceEnrollmentWindow({
            classData,
            session,
            studentPersonId,
            reqUser: req.user
        });

        if (!session.roster) session.roster = [];
        
        let rosterRecord = session.roster.find(r => idsEqual(r.personId, studentPersonId));
        
        if (!rosterRecord) {
            rosterRecord = { personId: studentPersonId, attendance: 'present', notes: '', comments: [] };
            session.roster.push(rosterRecord);
        }

        if (!rosterRecord.comments) rosterRecord.comments = [];

        const normalizedMentions = normalizeCommentMentions(mentions);
        const newComment = {
            id: 'cmt_' + Date.now(),
            authorId: req.user.id,
            authorName: req.user.identity?.displayName || req.user.name || req.user.username || 'Admin',
            authorEmail: readUserEmail(req.user),
            text: text.trim(),
            timestamp: new Date().toISOString(),
            mentions: normalizedMentions,
            attachment: attachment && typeof attachment === 'object' ? attachment : null
        };

        rosterRecord.comments.push(newComment);
        await schoolDataService.saveClassSessions(classId, sessions, req.user);

        // =========================================================================
        // NEW: AUTOMATIC CHAT MESSAGE ENGINE
        // =========================================================================
        if (normalizedMentions.length > 0) {
            const className = classData ? classData.title : 'a class';
            
            // Format the message with HTML to include a styled, clickable link!
            // Format the message with HTML to include a styled, clickable link!
            const chatMsgContent = `
                ðŸ“ <b>System Message:</b> I mentioned you in an attendance note for <b>${className}</b> (Date: ${session.date}):
                <br><br>
                <div style="border-left: 3px solid #0d6efd; padding-left: 10px; color: #6c757d; font-style: italic;">
                    "${text.trim()}"
                </div>
                <br>
                <a href="/school/attendances?classId=${classId}&studentId=${studentPersonId}&sessionId=${sessionId}" target="_blank" class="text-decoration-none fw-bold">
                    âž¡ï¸ Open Specific Note
                </a>
            `;

            for (const mention of normalizedMentions) {
                try {
                    // FIX 1: Strictly convert IDs to Strings to prevent "Unknown User" and duplicate chat bugs!
                    const authorIdStr = String(req.user.id);
                    const targetIdStr = String(mention.id);

                    // FIX 2: Get or create a direct conversation.
                    // Because the IDs are now Strings, chatModel will successfully find the existing chat!
                    const conv = await chatRepository.create({ userIds: [authorIdStr, targetIdStr] });

                    // FIX 3: Save the message to the chat database using the author's exact ID
                    const savedMsg = await chatRepository.addMessage(conv.id, authorIdStr, chatMsgContent.trim(), 'text', null);

                    // Broadcast the message in real-time via Socket.io
                    try {
                        const io = socketService.getIo();
                        io.to(conv.id).emit('new_message', {
                            convId: conv.id,
                            message: savedMsg
                        });
                    } catch (socketErr) {
                        // Ignore socket errors (e.g., if the user is currently offline)
                    }
                } catch (chatErr) {
                    console.error(`Failed to send chat message to ${mention.id}:`, chatErr);
                }
            }
        }
        // =========================================================================

        res.json({ status: 'success', message: 'Note added successfully.', comment: newComment });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
}

async function uploadAttendanceFile(req, res) {
    try {
        const classId = String(req.body?.classId || '').trim();
        const sessionId = String(req.body?.sessionId || '').trim();
        const studentPersonId = String(req.body?.studentPersonId || '').trim();
        const kind = String(req.body?.kind || 'attendance').trim() || 'attendance';
        if (!classId || !sessionId) throw new Error('classId and sessionId are required.');
        if (!req.file) throw new Error('No file was uploaded.');

        const classData = await schoolDataService.getDataById('classes', classId, req.user);
        if (!classData) throw new Error('Class not found.');
        const sessions = await schoolDataService.getClassSessions(classId, req.user);
        const session = (Array.isArray(sessions) ? sessions : []).find((row) => idsEqual(row?.sessionId, sessionId));
        if (!session) throw new Error('Session not found.');
        if (studentPersonId) {
            await assertAttendanceEnrollmentWindow({
                classData,
                session,
                studentPersonId,
                reqUser: req.user
            });
        }

        const file = schoolFileService.normalizeUploadedFile(req.file, {
            kind,
            classId,
            sessionId,
            studentPersonId,
            uploadedBy: req.user?.id
        });

        return res.json({ status: 'success', message: 'File uploaded.', file });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
}

async function updateAttendanceRosterCell(req, res) {
    try {
        const classId = String(req.body?.classId || '').trim();
        const sessionId = String(req.body?.sessionId || '').trim();
        const studentPersonId = String(req.body?.studentPersonId || '').trim();
        if (!classId || !sessionId || !studentPersonId) {
            throw new Error('classId, sessionId, and studentPersonId are required.');
        }

        const classData = await schoolDataService.getDataById('classes', classId, req.user);
        if (!classData) throw new Error('Class not found.');

        const sessions = await schoolDataService.getClassSessions(classId, req.user);
        const sessionIndex = sessions.findIndex((s) => s.sessionId === sessionId);
        if (sessionIndex === -1) throw new Error('Session not found.');

        const session = sessions[sessionIndex];
        await assertAttendanceMatrixSessionEditable(req, classData, session);
        await assertAttendanceEnrollmentWindow({
            classData,
            session,
            studentPersonId,
            reqUser: req.user
        });

        const previousAttendance = session.roster?.find((r) => idsEqual(r.personId, studentPersonId))?.attendance;
        const enabledAttendanceStatuses = attendanceMatrixMetricsService.resolveEnabledAttendanceStatuses(classData);
        const normalizedAttendance = attendanceMatrixMetricsService.assertAttendanceStatusAllowedForSave({
            status: req.body?.attendance,
            enabledStatuses: enabledAttendanceStatuses,
            previousStatus: previousAttendance,
            allowSystemNotApplicable: true
        });

        if (!session.roster) session.roster = [];
        let rosterRecord = session.roster.find((r) => idsEqual(r.personId, studentPersonId));
        if (!rosterRecord) {
            rosterRecord = { personId: studentPersonId, attendance: normalizedAttendance, notes: '', comments: [] };
            session.roster.push(rosterRecord);
        }

        rosterRecord.attendance = normalizedAttendance;

        const parseNonNegInt = (v) => {
            const n = Number(v);
            return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
        };
        if (req.body?.lateMinutes !== undefined) {
            rosterRecord.lateMinutes = parseNonNegInt(req.body.lateMinutes);
        }
        if (req.body?.earlyLeaveMinutes !== undefined) {
            rosterRecord.earlyLeaveMinutes = parseNonNegInt(req.body.earlyLeaveMinutes);
        }
        if (req.body?.excuseRef !== undefined) {
            rosterRecord.excuseRef = String(req.body.excuseRef || '').trim();
        }
        if (req.body?.excuseAttachment !== undefined) {
            rosterRecord.excuseAttachment = req.body.excuseAttachment && typeof req.body.excuseAttachment === 'object'
                ? req.body.excuseAttachment
                : null;
        }
        if (req.body?.notes !== undefined) {
            rosterRecord.notes = String(req.body.notes || '').trim();
        }
        if (!rosterRecord.comments) rosterRecord.comments = [];

        const orgPolicyItemsCell = await attendanceMatrixPolicyModel.listPolicyItemsForOrg(classData?.orgId || '');
        const sessionScheduledMinutes = attendanceMatrixMetricsService.scheduledMinutesFromSession(
            session,
            attendanceMatrixPolicyModel.DEFAULT_POLICY.scheduledMinutes
        );
        const orgPolicyLayerCell = attendanceMatrixMetricsService.pickOrgPolicyLayerForMinutes(
            { items: orgPolicyItemsCell },
            sessionScheduledMinutes
        );
        const matrixPolicyCell = attendanceMatrixMetricsService.resolvePolicy(classData, orgPolicyLayerCell);
        Object.assign(
            rosterRecord,
            attendanceMatrixMetricsService.applyAttendanceMatrixRosterRules(rosterRecord, matrixPolicyCell)
        );
        rosterRecord.attendance = attendanceMatrixMetricsService.coerceAttendanceStatusToEnabled(
            rosterRecord.attendance,
            enabledAttendanceStatuses
        );

        await schoolDataService.saveClassSessions(classId, sessions, req.user);
        await classEnrollmentSessionApplicabilityService.recomputeSessionCappedEnrollmentCompletionsForClass({
            classData,
            sessions,
            reqUser: req.user,
            activeOrgId: classData?.orgId || req.user?.activeOrgId || ''
        });
        const indexService = require('../../services/school/schoolIndexService');
        await indexService.rebuildIndexesForClass(classId);

        return res.json({
            status: 'success',
            message: 'Attendance updated.',
            record: {
                attendance: rosterRecord.attendance,
                lateMinutes: rosterRecord.lateMinutes || 0,
                earlyLeaveMinutes: rosterRecord.earlyLeaveMinutes || 0,
                excuseRef: rosterRecord.excuseRef || '',
                excuseAttachment: rosterRecord.excuseAttachment || null,
                notes: rosterRecord.notes || ''
            }
        });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
}

module.exports = {
    showAttendancePage,
    showAttendanceMatrixSettings,
    saveAttendanceMatrixSettings,
    listActiveAttendanceClasses,
    getAttendanceData,
    exportAttendanceExcel,
    uploadAttendanceFile,
    addAttendanceComment,
    updateAttendanceRosterCell
};
