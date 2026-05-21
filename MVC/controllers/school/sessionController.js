// MVC/controllers/school/sessionController.js
const schoolDataService = require('../../services/school/schoolDataService');
const { idsEqual } = require('../../utils/idAdapter');
const dataService = require('../../services/dataService');
const sessionStatusPolicyService = require('../../services/school/sessionStatusPolicyService');
const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });

function normalizeDateOrNull(v, label) {
    if (!v) return null;
    const s = String(v).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        throw new Error(`Invalid ${label}. Use YYYY-MM-DD.`);
    }
    return s;
}

function normalizeTimeOrNull(v, label) {
    if (!v) return null;
    const s = String(v).trim();
    if (!/^\d{2}:\d{2}$/.test(s)) {
        throw new Error(`Invalid ${label}. Use HH:mm.`);
    }
    return s;
}

async function showSessionListPage(req, res) {
    try {
        res.render('school/session/sessionList', {
            title: 'Global Session Explorer',
            includeModal: true,
            user: req.user,
            actionStateId: req.actionStateId
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

async function getSessionsApi(req, res) {
    try {
        const q = String(req.query.q || '').trim().toLowerCase();
        const startDate = normalizeDateOrNull(req.query.startDate, 'startDate');
        const endDate = normalizeDateOrNull(req.query.endDate, 'endDate');
        const startTime = normalizeTimeOrNull(req.query.startTime, 'startTime');
        const endTime = normalizeTimeOrNull(req.query.endTime, 'endTime');
        const teacherId = req.query.teacherId ? String(req.query.teacherId).trim() : '';
        const classId = req.query.classId ? String(req.query.classId).trim() : '';
        const statusFilter = String(req.query.status || '').trim().toLowerCase();

        if (startDate && endDate && startDate > endDate) {
            throw new Error('startDate cannot be after endDate.');
        }
        if (startTime && endTime && startTime > endTime) {
            throw new Error('startTime cannot be after endTime.');
        }

        const activeOrgId = String(req.user?.activeOrgId || '').trim();
        const statusMeta = await sessionStatusPolicyService.getClientStatusMeta(activeOrgId || '', { includeInactive: true });
        
        // 1. Fetch Classes (Filter by classId early if provided to save memory)
        let classes = await schoolDataService.fetchData('classes', {}, req.user);
        if (classId) {
            classes = classes.filter(c => idsEqual(c.id, classId));
        }

        let allSessions = [];
        const persons = await dataService.fetchData('persons', {}, req.user, PERSON_QUERY_OPTIONS);

        // 2. Loop through classes and their respective sessions
        for (const c of classes) {
            const sessions = await schoolDataService.getClassSessions(c.id, req.user);
            
            sessions.forEach(s => {
                // Ignore cancelled or holiday sessions from general overviews unless specifically requested
                if (s.notes === 'Holiday/Off') return;

                // A. Filter by Date
                if (startDate && s.date < startDate) return;
                if (endDate && s.date > endDate) return;
                
                // B. Filter by Time (Using simple string comparison for HH:mm)
                if (startTime && s.startTime < startTime) return;
                if (endTime && s.startTime > endTime) return;

                // C. Filter by Teacher
                const sTeacherId = s.delivery?.deliveredBy;
                if (teacherId && !idsEqual(sTeacherId, teacherId)) return;
                const teacher = persons.find((p) => idsEqual(p.id, sTeacherId));
                const teacherName = teacher
                    ? `${teacher.name?.first || ''} ${teacher.name?.last || ''}`.trim()
                    : (s.delivery?.deliveredByName || 'Unassigned');

                // Build the enriched session row
                allSessions.push({
                    id: s.sessionId,
                    sessionId: s.sessionId,
                    classId: c.id,
                    className: c.title,
                    title: `${c.title} | ${s.date} ${s.startTime || ''}-${s.endTime || ''}`.trim(),
                    date: s.date,
                    startTime: s.startTime || '00:00',
                    endTime: s.endTime || '00:00',
                    status: sessionStatusPolicyService.normalizeSessionStatus(s.status, s.notes),
                    locked: s.locked === true || String(s.locked) === 'true',
                    teacherName,
                    notes: s.notes || '',
                    hasComments: (s.roster || []).some(r => r.comments && r.comments.length > 0)
                });
            });
        }

        if (statusFilter) {
            allSessions = allSessions.filter((row) => String(row?.status || '').trim().toLowerCase() === statusFilter);
        }
        if (q) {
            allSessions = allSessions.filter((row) => [
                row.sessionId,
                row.classId,
                row.className,
                row.teacherName,
                row.date,
                row.status
            ]
                .map((token) => String(token || '').toLowerCase())
                .some((token) => token.includes(q)));
        }

        // 3. Sort chronologically (Date -> Time)
        allSessions.sort((a, b) => {
            const dtA = new Date(`${a.date}T${a.startTime}`);
            const dtB = new Date(`${b.date}T${b.startTime}`);
            return dtA - dtB;
        });

        res.json({
            status: 'success',
            data: allSessions,
            pagination: {
                currentPage: 1,
                totalPages: 1,
                totalItems: allSessions.length,
                limit: allSessions.length
            },
            statusMeta
        });

    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
}

module.exports = {
    showSessionListPage,
    getSessionsApi
};
