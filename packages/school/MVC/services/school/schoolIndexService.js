// MVC/services/school/schoolIndexService.js
const schoolDataService = require('./schoolDataService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const sessionDeliveryTeamService = require('./sessionDeliveryTeamService');

function normalizeDateOnly(value) {
    const token = String(value || '').trim();
    if (!token) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
    const parsed = new Date(token);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
}

function toStudentBucket(periodStatus = '') {
    const status = String(periodStatus || '').trim().toLowerCase();
    if (status === 'planned') return 'waitlisted';
    if (status === 'active') return 'enrolled';
    if (['withdrawn', 'completed', 'cancelled', 'archived', 'error'].includes(status)) return 'withdrawn';
    return '';
}

/**
 * The Master Rebuild Function
 * Call this whenever a Class or its Roster is updated, saved, or deleted.
 */
async function rebuildIndexesForClass(classId) {
    // 1. Load the Indexes directly from the Data Service
    let teacherIndex = await schoolDataService.getTeacherIndex();
    let studentIndex = await schoolDataService.getStudentIndex();

    // ✅ normalize bad shapes
    if (!teacherIndex || typeof teacherIndex !== 'object' || Array.isArray(teacherIndex)) teacherIndex = {};
    if (!studentIndex || typeof studentIndex !== 'object' || Array.isArray(studentIndex)) studentIndex = {};
    
    // 2. PURGE PHASE: Remove ALL existing references to this classId from both indexes
    for (const personId in teacherIndex) {
        for (const date in teacherIndex[personId]) {
            teacherIndex[personId][date] = teacherIndex[personId][date].filter(session => session.classId !== classId);
            if (teacherIndex[personId][date].length === 0) delete teacherIndex[personId][date];
        }
        if (Object.keys(teacherIndex[personId]).length === 0) delete teacherIndex[personId];
    }

    for (const personId in studentIndex) {
        ['enrolled', 'waitlisted', 'withdrawn'].forEach(status => {
            if (studentIndex[personId][status]) {
                studentIndex[personId][status] = studentIndex[personId][status].filter(id => id !== classId);
            }
        });
    }

    // 3. FETCH LATEST SOURCE OF TRUTH (Using System Context: null)
    const classData = await schoolDataService.getDataById('classes', classId, null);

    // If the class exists and isn't cancelled, rebuild.
    if (classData && classData.status !== 'cancelled') {
        const statusMap = await sessionStatusPolicyService.getStatusMap(classData?.orgId || '', { includeInactive: true });
        
        // --- A. REBUILD STUDENTS ---
        const periodRows = await schoolDataService.getClassEnrollmentPeriodsByClassId(classId, null);
        const canonicalRows = Array.isArray(periodRows) ? periodRows : [];
        const personByStudentId = new Map();

        const unresolvedStudentIds = new Set();
        canonicalRows.forEach((row) => {
            const bucket = toStudentBucket(row?.status);
            if (!bucket) return;
            const studentId = String(row?.studentId || '').trim();
            if (studentId) unresolvedStudentIds.add(studentId);
        });

        if (unresolvedStudentIds.size) {
            const allStudents = await schoolDataService.fetchData('students', {}, null);
            (Array.isArray(allStudents) ? allStudents : []).forEach((student) => {
                const studentId = String(student?.id || '').trim();
                if (!studentId || !unresolvedStudentIds.has(studentId)) return;
                const personId = String(student?.personId || '').trim();
                if (personId) personByStudentId.set(studentId, personId);
            });
        }

        const today = normalizeDateOnly(new Date());
        canonicalRows.forEach((row) => {
            const bucket = toStudentBucket(row?.status);
            if (!bucket) return;
            const start = normalizeDateOnly(row?.startDate);
            const end = normalizeDateOnly(row?.endDate);
            if (bucket === 'enrolled') {
                if (start && start > today) return;
                if (end && end < today) return;
            }
            if (bucket === 'waitlisted' && end && end < today) return;
            const studentId = String(row?.studentId || '').trim();
            const pid = personByStudentId.get(studentId) || '';
            if (!pid) return;
            if (!studentIndex[pid]) studentIndex[pid] = { enrolled: [], waitlisted: [], withdrawn: [] };
            if (!Array.isArray(studentIndex[pid][bucket])) studentIndex[pid][bucket] = [];
            if (!studentIndex[pid][bucket].includes(classId)) studentIndex[pid][bucket].push(classId);
        });

        // --- B. REBUILD TEACHERS ---
        const sessions = await schoolDataService.getClassSessions(classId);

        sessions.forEach(session => {
            const excludeFromTeacherIndex = sessionStatusPolicyService.shouldExcludeFromTeacherIndexByMap(statusMap, {
                status: session?.status,
                notes: session?.notes
            });
            if (excludeFromTeacherIndex) return;
            const deliveryPersonIds = sessionDeliveryTeamService.getSessionDeliveryPersonIds(session);
            deliveryPersonIds.forEach((tid) => {
                if (!tid) return;
                const date = session.date;

                if (!teacherIndex[tid]) teacherIndex[tid] = {};
                if (!teacherIndex[tid][date]) teacherIndex[tid][date] = [];

                teacherIndex[tid][date].push({
                    classId: classId,
                    sessionId: session.sessionId,
                    startTime: session.startTime,
                    endTime: session.endTime,
                    durationHours: session.durationHours
                });
            });
        });
    }

    // 4. Save the freshly rebuilt indexes securely
    await schoolDataService.saveTeacherIndex(teacherIndex);
    await schoolDataService.saveStudentIndex(studentIndex);
}

module.exports = { rebuildIndexesForClass };
