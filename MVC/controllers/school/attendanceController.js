// MVC/controllers/school/attendanceController.js
const schoolDataService = require('../../services/school/schoolDataService');
const { idsEqual } = require('../../utils/idAdapter');
const dataService = require('../../services/dataService'); 
const chatRepository = require('../../repositories/chatRepository');
const socketService = require('../../services/socketService'); // IMPORT SOCKET SERVICE
const sessionStatusPolicyService = require('../../services/school/sessionStatusPolicyService');
const classEnrollmentReadService = require('../../services/school/classEnrollmentReadService');
const attendanceMatrixMetricsService = require('../../services/school/attendanceMatrixMetricsService');
const attendanceMatrixPolicyModel = require('../../models/school/attendanceMatrixPolicyModel');
const { userCanManageAttendanceMatrixPolicy } = require('../../middleware/attendanceMatrixPolicyAdminMiddleware');
const accessService = require('../../services/security/index');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const adminChekersService = require('../../services/adminChekersService');
const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });

function normalizeDateOnly(value) {
    const token = String(value || '').trim();
    if (!token) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
    const parsed = new Date(token);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
}

function resolveDateWindow({ sessions = [], startDate = '', endDate = '' } = {}) {
    const sessionDates = (Array.isArray(sessions) ? sessions : [])
        .map((row) => normalizeDateOnly(row?.date))
        .filter(Boolean)
        .sort();
    const start = normalizeDateOnly(startDate) || sessionDates[0] || new Date().toISOString().slice(0, 10);
    const end = normalizeDateOnly(endDate) || sessionDates[sessionDates.length - 1] || start;
    return { start, end };
}

function activePeriodOverlapsWindow(period, windowStart, windowEnd) {
    const status = String(period?.status || '').trim().toLowerCase();
    if (status !== 'active') return false;
    const start = normalizeDateOnly(period?.startDate);
    const end = normalizeDateOnly(period?.endDate) || '9999-12-31';
    const ws = normalizeDateOnly(windowStart);
    const we = normalizeDateOnly(windowEnd);
    if (!start || !ws || !we) return false;
    return start <= we && end >= ws;
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
        let canOverrideSessionLock = await adminChekersService.isAdminForRequestAsync(
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
            title: 'Class Attendance Viewer',
            includeModal: true,
            user: req.user,
            actionStateId: req.actionStateId,
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

async function showAttendanceMatrixSettings(req, res) {
    try {
        const activeOrgId = String(req.user?.activeOrgId || '').trim();
        const policy = await attendanceMatrixPolicyModel.getPolicyForOrg(activeOrgId);
        res.render('school/attendance/attendanceMatrixPolicy', {
            title: 'Attendance Matrix — Threshold Settings',
            includeModal: true,
            user: req.user,
            actionStateId: req.actionStateId,
            policy,
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
        await attendanceMatrixPolicyModel.savePolicyForOrg(activeOrgId, req.body, req.user?.id);
        res.redirect('/school/attendances/settings?saved=1');
    } catch (error) {
        const policy = await attendanceMatrixPolicyModel.getPolicyForOrg(String(req.user?.activeOrgId || '').trim());
        res.status(400).render('school/attendance/attendanceMatrixPolicy', {
            title: 'Attendance Matrix — Threshold Settings',
            includeModal: true,
            user: req.user,
            actionStateId: req.actionStateId,
            policy,
            policyOrgKey: attendanceMatrixPolicyModel.orgKey(req.user?.activeOrgId),
            saved: false,
            errorMessage: error.message || 'Could not save settings.'
        });
    }
}

async function getAttendanceData(req, res) {
    try {
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

        const [persons, students] = await Promise.all([
            dataService.fetchData('persons', {}, req.user, PERSON_QUERY_OPTIONS),
            schoolDataService.fetchData('students', {}, req.user)
        ]);

        const studentToPersonMap = new Map(
            (Array.isArray(students) ? students : [])
                .map((row) => [String(row?.id || '').trim(), String(row?.personId || '').trim()])
                .filter(([studentId, personId]) => studentId && personId)
        );

        const activeOrgId = String(req.user?.activeOrgId || classData?.orgId || '').trim();
        const sessionDates = filteredSessions.map((row) => String(row?.date || '').trim()).filter(Boolean);
        const enrollmentSnapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
            classId: classData.id,
            classItem: classData,
            reqUser: req.user,
            activeOrgId,
            sessionDates,
            startDate: String(startDate || '').trim(),
            endDate: String(endDate || '').trim(),
            // Attendance Matrix should show only approved/active rolling enrollments.
            canonicalStatuses: ['active']
        });
        const registrationMode = String(classData?.registrationMode || '').trim().toLowerCase();
        const activePersonIds = new Set();

        if (registrationMode === 'rolling') {
            const window = resolveDateWindow({
                sessions: filteredSessions,
                startDate: String(startDate || '').trim(),
                endDate: String(endDate || '').trim()
            });
            const periodRows = await schoolDataService.getClassEnrollmentPeriodsByClassId(classData.id, req.user);
            (Array.isArray(periodRows) ? periodRows : []).forEach((period) => {
                if (activeOrgId && !idsEqual(period?.orgId, activeOrgId)) return;
                if (!activePeriodOverlapsWindow(period, window.start, window.end)) return;
                const sid = String(period?.studentId || '').trim();
                const pid = String(studentToPersonMap.get(sid) || '').trim();
                if (pid) activePersonIds.add(pid);
            });
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

        let studentList = Array.from(activePersonIds).map(uid => {
            const person = persons.find(p => String(p.id) === uid);
            const name = person ? `${person.name?.first || ''} ${person.name?.last || ''}`.trim() : `Person ${uid}`;
            return { personId: uid, name };
        });
        studentList.sort((a, b) => a.name.localeCompare(b.name));

        const orgPolicyLayer = await attendanceMatrixPolicyModel.getPolicyForOrg(
            String(req.user?.activeOrgId || classData?.orgId || '').trim()
        );
        const attendancePolicy = attendanceMatrixMetricsService.resolvePolicy(classData, orgPolicyLayer);

        const matrix = studentList.map((stu) => {
            const records = filteredSessions.map(ses => {
                const rosterRecord = ses.roster?.find(r => String(r.personId) === stu.personId);
                const sessionLocked = ses.locked === true || String(ses.locked) === 'true';
                return {
                    sessionId: ses.sessionId,
                    date: ses.date,
                    status: rosterRecord ? rosterRecord.attendance : 'N/A',
                    lateMinutes: rosterRecord?.lateMinutes || 0,
                    earlyLeaveMinutes: rosterRecord?.earlyLeaveMinutes || 0,
                    excuseRef: rosterRecord?.excuseRef || '',
                    teacherNotes: (rosterRecord?.notes) || ses.notes || '',
                    rosterStudentNotes: rosterRecord?.notes || '',
                    sessionLevelNote: ses.notes || '',
                    sessionLocked,
                    comments: rosterRecord?.comments || [],
                    scheduledMinutes: attendanceMatrixMetricsService.scheduledMinutesFromSession(
                        ses,
                        attendancePolicy.scheduledMinutes
                    )
                };
            });
            const summary = attendanceMatrixMetricsService.computeStudentMatrixSummary(records, classData, orgPolicyLayer);
            return { ...stu, records, summary };
        });

        res.json({ 
            status: 'success', 
            classId: classId,
            className: classData.title,
            sessions: filteredSessions.map(s => ({ id: s.sessionId, date: s.date, status: s.status })),
            matrix,
            attendancePolicy,
            enrollmentSource: registrationMode === 'rolling'
                ? 'canonical_active_only_rolling'
                : String(enrollmentSnapshot?.source || 'legacy'),
            enrollmentUsedFallback: Boolean(enrollmentSnapshot?.usedFallback)
        });

    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
}

// --- Interactive Comment Engine with Chat Integration ---
async function addAttendanceComment(req, res) {
    try {
        const { classId, sessionId, studentPersonId, text, mentions } = req.body;
        if (!classId || !sessionId || !studentPersonId || !text) throw new Error('Missing required fields.');

        const classData = await schoolDataService.getDataById('classes', classId, req.user);
        const sessions = await schoolDataService.getClassSessions(classId, req.user);
        const sessionIndex = sessions.findIndex(s => s.sessionId === sessionId);
        if (sessionIndex === -1) throw new Error('Session not found.');

        const session = sessions[sessionIndex];
        if (!session.roster) session.roster = [];
        
        let rosterRecord = session.roster.find(r => idsEqual(r.personId, studentPersonId));
        
        if (!rosterRecord) {
            rosterRecord = { personId: studentPersonId, attendance: 'present', notes: '', comments: [] };
            session.roster.push(rosterRecord);
        }

        if (!rosterRecord.comments) rosterRecord.comments = [];

        const newComment = {
            id: 'cmt_' + Date.now(),
            authorId: req.user.id,
            authorName: req.user.identity?.displayName || req.user.name || req.user.username || 'Admin',
            text: text.trim(),
            timestamp: new Date().toISOString(),
            mentions: mentions || [] 
        };

        rosterRecord.comments.push(newComment);
        await schoolDataService.saveClassSessions(classId, sessions, req.user);

        // =========================================================================
        // NEW: AUTOMATIC CHAT NOTIFICATION ENGINE
        // =========================================================================
        if (mentions && mentions.length > 0) {
            const className = classData ? classData.title : 'a class';
            
            // Format the message with HTML to include a styled, clickable link!
            // Format the message with HTML to include a styled, clickable link!
            const chatMsgContent = `
                📍 <b>System Notification:</b> I mentioned you in an attendance note for <b>${className}</b> (Date: ${session.date}):
                <br><br>
                <div style="border-left: 3px solid #0d6efd; padding-left: 10px; color: #6c757d; font-style: italic;">
                    "${text.trim()}"
                </div>
                <br>
                <a href="/school/attendances?classId=${classId}&studentId=${studentPersonId}&sessionId=${sessionId}" target="_blank" class="text-decoration-none fw-bold">
                    ➡️ Open Specific Note
                </a>
            `;

            for (const mention of mentions) {
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
                    console.error(`Failed to send chat notification to ${mention.id}:`, chatErr);
                }
            }
        }
        // =========================================================================

        res.json({ status: 'success', message: 'Note added successfully.', comment: newComment });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
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
        const isSessionLocked = session.locked === true || String(session.locked) === 'true';
        let canOverride = await adminChekersService.isAdminForRequestAsync(
            req.user,
            SECTIONS.SCHOOL_ATTENDANCES,
            OPERATIONS.UPDATE,
            { section: { id: SECTIONS.SCHOOL_ATTENDANCES } }
        );
        if (isSessionLocked && !canOverride) {
            throw new Error('This session is locked and cannot be edited. Please contact an administrator.');
        }

        const allowedAttendance = new Set(['present', 'late', 'excused', 'absent']);
        const normalizedAttendance = String(req.body?.attendance || '').trim().toLowerCase();
        if (!allowedAttendance.has(normalizedAttendance)) {
            throw new Error('Invalid attendance. Use present, late, excused, or absent.');
        }

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
        if (req.body?.notes !== undefined) {
            rosterRecord.notes = String(req.body.notes || '').trim();
        }
        if (!rosterRecord.comments) rosterRecord.comments = [];

        const orgPolicyLayerCell = await attendanceMatrixPolicyModel.getPolicyForOrg(classData?.orgId || '');
        const matrixPolicyCell = attendanceMatrixMetricsService.resolvePolicy(classData, orgPolicyLayerCell);
        Object.assign(
            rosterRecord,
            attendanceMatrixMetricsService.applyAttendanceMatrixRosterRules(rosterRecord, matrixPolicyCell)
        );

        await schoolDataService.saveClassSessions(classId, sessions, req.user);
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
    getAttendanceData,
    addAttendanceComment,
    updateAttendanceRosterCell
};
