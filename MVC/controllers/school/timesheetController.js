// MVC/controllers/school/timesheetController.js
const dataService = require('../../services/school/schoolDataService');
const { idsEqual } = require('../../utils/idAdapter');
const dataService1 = require('../../services/dataService');
const paginate = require('../../utils/paginationHelper');
const settingService = require('../../services/settingService');
const { isAjax, buildDataServiceQuery, inferSearchableFields } = require('../../utils/generalTools');
const adminChekersService = require('../../services/adminChekersService');
const { assertOrgAccess } = require('../../utils/orgContextUtils');
const sessionStatusPolicyService = require('../../services/school/sessionStatusPolicyService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const { buildReportReflectionLiveSessions } = require('../../services/school/reportTimesheetReflectionService');

function getActiveOrgIdOrThrow(reqUser) {
    const activeOrgId = reqUser?.activeOrgId ? String(reqUser.activeOrgId) : '';
    if (!activeOrgId) throw new Error('<b>Security Violation</b><br>No active organization context found.');
    return activeOrgId;
}

function assertPeriodOrgAccess(period, activeOrgId, reqUser) {
    assertOrgAccess(period, activeOrgId, reqUser, { orgField: 'orgId', allowSystemBypass: true });
}

function sendGuardedResponse(req, res, guardResult, duplicateMessage, duplicateStatus = 409) {
    if (!guardResult || guardResult.status === 'acquired') return false;
    if (guardResult.status === 'busy') {
        const payload = {
            status: 'warning',
            message: duplicateMessage,
            idempotency: {
                state: 'busy',
                retryAfterMs: Number(guardResult.retryAfterMs || 0)
            }
        };
        if (isAjax(req)) {
            res.status(duplicateStatus).json(payload);
        } else {
            res.status(duplicateStatus).render('error', { title: 'Error', message: payload.message, user: req.user });
        }
        return true;
    }
    if (guardResult.status === 'replay') {
        const payload = guardResult.payload && typeof guardResult.payload === 'object'
            ? { ...guardResult.payload }
            : { status: 'success' };
        payload.idempotency = { state: 'replayed' };
        if (isAjax(req)) {
            res.json(payload);
        } else {
            res.render('error', { title: 'Info', message: String(payload.message || 'Operation already completed.'), user: req.user });
        }
        return true;
    }
    return false;
}

function buildPersonName(person) {
    return `${person?.name?.first || ''} ${person?.name?.last || ''}`.trim() || String(person?.id || '');
}

function normalizeOrgRoles(orgMembership) {
    const raw = Array.isArray(orgMembership?.roles)
        ? orgMembership.roles
        : (orgMembership?.role ? [orgMembership.role] : []);
    return raw
        .map((r) => String(r || '').trim().toLowerCase())
        .filter(Boolean)
        .filter((r, i, arr) => arr.indexOf(r) === i);
}

function personHasTeacherOrStaffRoleInOrg(person, orgId) {
    const targetOrgId = String(orgId || '').trim();
    if (!targetOrgId || !person) return false;

    const memberships = Array.isArray(person.organizations) ? person.organizations : [];
    return memberships.some((org) => {
        if (String(org?.orgId || '') !== targetOrgId) return false;
        const memberStatus = String(org?.memberStatus || 'active').trim().toLowerCase();
        if (memberStatus && memberStatus !== 'active') return false;
        const roles = normalizeOrgRoles(org);
        return roles.includes('school_teacher') || roles.includes('school_staff');
    });
}

async function getPersonById(personId, reqUser) {
    const id = String(personId || '').trim();
    if (!id) return null;
    const personQueryOptions = { enrichment: { includeSchoolRoles: false } };

    const direct = await dataService1.getDataById('persons', id, reqUser, personQueryOptions);
    if (direct) return direct;

    const all = await dataService1.fetchData('persons', {}, reqUser, personQueryOptions);
    return (all || []).find((p) => idsEqual(p?.id, id)) || null;
}

async function resolveSelfTeacherOrThrow(req) {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const selfPersonId = String(req.user?.personId || '').trim();
    if (!selfPersonId) {
        throw new Error('<b>Security Error</b><br>Your user account is not linked to a person profile.');
    }

    const person = await getPersonById(selfPersonId, req.user);
    if (!person) {
        throw new Error('<b>Security Error</b><br>Your linked person profile was not found. Please contact an administrator.');
    }

    if (!personHasTeacherOrStaffRoleInOrg(person, activeOrgId)) {
        throw new Error('<b>Access Denied</b><br>You must have an active <b>teacher</b> or <b>staff</b> role in the current organization to manage timesheets.');
    }

    return { teacherId: String(person.id), teacherName: buildPersonName(person) };
}

async function resolveTargetTeacherContext(req, { requireTeacher = true } = {}) {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const isAdmin = adminChekersService.isAdmin(req.user);
    const overrideTeacherId = isAdmin ? String(req.query.teacherId || '').trim() : '';

    // Admin/superadmin can always work via explicit teacher selection,
    // even when their own account has no linked person profile.
    if (overrideTeacherId) {
        const targetPerson = await getPersonById(overrideTeacherId, req.user);
        if (!targetPerson) throw new Error('Selected teacher was not found in person records.');
        if (!personHasTeacherOrStaffRoleInOrg(targetPerson, activeOrgId)) {
            throw new Error('Selected person is not an active teacher/staff member in this organization.');
        }

        let currentTeacherId = '';
        try {
            const self = await resolveSelfTeacherOrThrow(req);
            currentTeacherId = self.teacherId;
        } catch (error) {
            // Allowed for admin with explicit override.
        }

        return {
            isAdmin,
            currentTeacherId,
            targetTeacherId: String(targetPerson.id),
            selectedTeacherName: buildPersonName(targetPerson)
        };
    }

    let currentTeacher = null;
    try {
        currentTeacher = await resolveSelfTeacherOrThrow(req);
    } catch (error) {
        if (!isAdmin || requireTeacher) throw error;
    }

    if (currentTeacher) {
        return {
            isAdmin,
            currentTeacherId: currentTeacher.teacherId,
            targetTeacherId: currentTeacher.teacherId,
            selectedTeacherName: currentTeacher.teacherName
        };
    }

    if (isAdmin && !requireTeacher) {
        return {
            isAdmin,
            currentTeacherId: '',
            targetTeacherId: '',
            selectedTeacherName: ''
        };
    }

    throw new Error('A valid teacher selection is required for this operation.');
}

exports.listEligibleTimesheetPersons = async (req, res) => {
    try {
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        const query = await buildDataServiceQuery(req.query);
        const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
        if (query.q === searchDefaultKeyword) query.q = '';

        const persons = await dataService1.fetchData('persons', {
            q: query.q || '',
            type: query.type || 'contains',
            searchFields: 'id,name.first,name.last,contact.email,contact.emails[0].email'
        }, req.user, { enrichment: { includeSchoolRoles: false } });

        const eligible = (persons || []).filter((p) => personHasTeacherOrStaffRoleInOrg(p, activeOrgId));
        const { data, pagination } = paginate(eligible, query);
        return res.json({ status: 'success', results: data, pagination });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
};

exports.listMyTimesheets = async (req, res) => {
    try {
        let query = await buildDataServiceQuery(req.query);
        const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
        if (query.q === searchDefaultKeyword) query.q = '';

        const requestedTsStatus = query.tsStatus;
        delete query.tsStatus;

        const selectedYear = query.year || new Date().getFullYear().toString();
        delete query.year;

        delete query.teacherId;
        const isSystemSuperAdmin =
            adminChekersService.isSuperAdmin(req.user) &&
            String(req.user?.activeOrgId || '').toUpperCase() === 'SYSTEM';
        const requestedOrgId = String(query.orgId || '').trim();
        if (!isSystemSuperAdmin) delete query.orgId;
        const selectedOrgId = isSystemSuperAdmin ? requestedOrgId : '';

        const allPeriods = await dataService.fetchData('timesheetPeriods', query, req.user);
        const availableYears = [...new Set(allPeriods.map((p) => {
            if (!p.startDate) return new Date().getFullYear();
            return new Date(p.startDate).getFullYear();
        }))].sort((a, b) => b - a);

        const teacherContext = await resolveTargetTeacherContext(req, { requireTeacher: false });

        const allTimesheets = await dataService.fetchData('timesheets', {}, req.user);
        const targetTimesheets = teacherContext.targetTeacherId
            ? allTimesheets.filter((t) => idsEqual(t.teacherId, teacherContext.targetTeacherId))
            : [];

        let orgFilterOptions = [];
        const orgNameById = new Map();
        if (isSystemSuperAdmin) {
            const allPeriodsForOrgOptions = await dataService.fetchData('timesheetPeriods', {}, req.user);
            const orgIds = [...new Set(
                (allPeriodsForOrgOptions || [])
                    .map((p) => String(p.orgId || '').trim())
                    .filter(Boolean)
            )];
            const organizations = await dataService1.fetchData('organizations', {}, req.user);
            (organizations || []).forEach((org) => {
                const label = org?.identity?.displayName || org?.identity?.legalName || org?.name || String(org?.id || '');
                orgNameById.set(String(org?.id || ''), label);
            });
            orgFilterOptions = orgIds
                .map((id) => ({ id, name: orgNameById.get(id) || id }))
                .sort((a, b) => String(a.name).localeCompare(String(b.name)));
        }

        let mappedPeriods = allPeriods
            .filter((p) => new Date(p.startDate || new Date()).getFullYear().toString() === selectedYear.toString())
            .map((p) => {
                const ts = targetTimesheets.find((t) => idsEqual(t.periodId, p.id));
                const orgId = String(p.orgId || '').trim();
                return {
                    ...p,
                    orgId,
                    orgName: orgNameById.get(orgId) || orgId || '-',
                    timesheetId: ts ? ts.id : null,
                    tsStatus: ts ? ts.status : 'not_started',
                    totalHours: ts ? ts.totalHours : 0
                };
            });

        if (isSystemSuperAdmin && selectedOrgId) {
            mappedPeriods = mappedPeriods.filter((p) => String(p.orgId || '') === selectedOrgId);
        }

        if (requestedTsStatus) {
            mappedPeriods = mappedPeriods.filter((p) => p.tsStatus === requestedTsStatus);
        }

        mappedPeriods.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
        const searchableFields = await inferSearchableFields(mappedPeriods, { exclude: ['audit'] });
        const { data, pagination } = paginate(mappedPeriods, query);

        if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

        const viewingOtherTeacher = teacherContext.targetTeacherId && teacherContext.currentTeacherId &&
            !idsEqual(teacherContext.targetTeacherId, teacherContext.currentTeacherId);

        res.render('school/timesheet/timesheetList', {
            title: viewingOtherTeacher
                ? `Timesheets: ${teacherContext.selectedTeacherName}`
                : 'My Timesheets',
            tableName: 'Timesheets_List',
            newUrl: 'school/timesheets/my-timesheets',
            newLabel: null,
            data,
            searchableFields,
            availableYears,
            selectedYear,
            selectedOrgId,
            isSystemSuperAdmin,
            orgFilterOptions,
            isAdmin: teacherContext.isAdmin,
            currentTeacherId: teacherContext.currentTeacherId,
            targetTeacherId: teacherContext.targetTeacherId,
            selectedTeacherName: teacherContext.selectedTeacherName,
            includeModal: true,
            includeModal_Table: true,
            print: true,
            pagination,
            filters: req.query,
            user: req.user,
            actionStateId: req.actionStateId
        });
    } catch (error) {
        if (isAjax(req)) return res.status(500).json({ status: 'error', error, message: error.message });
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
};

exports.viewTimesheet = async (req, res) => {
    try {
        const { periodId } = req.params;
        const activeOrgId = getActiveOrgIdOrThrow(req.user);

        const period = await dataService.getDataById('timesheetPeriods', periodId, req.user);
        if (!period) throw new Error('Period not found.');
        assertPeriodOrgAccess(period, activeOrgId, req.user);

        if (period.status === 'locked') throw new Error('Period is for preview and is not open for submissions.');

        const teacherContext = await resolveTargetTeacherContext(req, { requireTeacher: true });

        const maxDailyHours = 12.0;
        const maxSessionHours = 8.0;
        const sessionStatusMeta = await sessionStatusPolicyService.getClientStatusMeta(period.orgId || activeOrgId || '', { includeInactive: true });
        const statusMap = sessionStatusPolicyService.getStatusMetaMap(sessionStatusMeta);

        const allTimesheets = await dataService.fetchData('timesheets', {}, req.user);
        let timesheet = allTimesheets.find(
            (t) => idsEqual(t.periodId, periodId) && idsEqual(t.teacherId, teacherContext.targetTeacherId)
        );

        if (!timesheet) {
            timesheet = {
                periodId,
                orgId: period.orgId || activeOrgId,
                teacherId: teacherContext.targetTeacherId,
                status: 'draft',
                entries: [],
                totalHours: 0
            };
        }

        const classes = await dataService.fetchData('classes', {}, req.user);
        const liveSessions = [];

        for (const c of classes) {
            const sessions = await dataService.getClassSessions(c.id, req.user);
            const myClassSessions = sessions.filter((s) =>
                idsEqual(s.delivery?.deliveredBy, teacherContext.targetTeacherId) &&
                s.date >= period.startDate &&
                s.date <= period.endDate
            );

            myClassSessions.forEach((s) => {
                const normalizedStatus = sessionStatusPolicyService.normalizeSessionStatus(s.status, s.notes);
                const rawDurationHours = parseFloat(s.durationHours) || 0;
                const timesheetHours = sessionStatusPolicyService.calculateTimesheetHoursByMap(statusMap, {
                    status: s.status,
                    notes: s.notes,
                    durationHours: rawDurationHours
                });
                const isFinalStatus = sessionStatusPolicyService.isFinalStatusByMap(statusMap, {
                    status: s.status,
                    notes: s.notes
                });
                liveSessions.push({
                    sessionId: s.sessionId,
                    classId: c.id,
                    className: c.title,
                    deliveryDepartmentId: c.deliveryDepartmentId || '',
                    deliveryDepartmentName: c.deliveryDepartmentName || '',
                    date: s.date,
                    startTime: s.startTime,
                    endTime: s.endTime,
                    durationHours: rawDurationHours,
                    timesheetHours,
                    status: normalizedStatus,
                    isFinalStatus,
                    notes: s.notes || '',
                    room: s.room || ''
                });
            });
        }

        const reportReflectionSessions = await buildReportReflectionLiveSessions({
            teacherPersonId: teacherContext.targetTeacherId,
            periodStartDate: period.startDate,
            periodEndDate: period.endDate,
            activeOrgId,
            reqUser: req.user
        });
        const mergedLiveSessions = [...liveSessions, ...reportReflectionSessions];

        const allHolidays = await dataService.fetchData('holidays', {}, req.user);
        const holidays = allHolidays.filter((h) => h.date >= period.startDate && h.date <= period.endDate);

        res.render('school/timesheet/timesheetEditor', {
            title: `Timesheet: ${period.name}`,
            period,
            timesheet,
            liveSessions: mergedLiveSessions,
            holidays,
            maxDailyHours,
            maxSessionHours,
            sessionStatusMeta,
            isAdmin: teacherContext.isAdmin,
            user: req.user,
            targetTeacherId: teacherContext.targetTeacherId,
            includeModal: true,
            actionStateId: req.actionStateId
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
};

exports.saveTimesheet = async (req, res) => {
    let guardKey = '';
    try {
        const { periodId } = req.params;
        const { status, entries, totalHours } = req.body;
        const activeOrgId = getActiveOrgIdOrThrow(req.user);

        const teacherContext = await resolveTargetTeacherContext(req, { requireTeacher: true });
        guardKey = idempotencyGuardService.createGuardKey([
            'timesheet_save',
            String(activeOrgId || '').trim(),
            String(periodId || '').trim(),
            String(teacherContext?.targetTeacherId || '').trim(),
            req.body || {}
        ]);
        const guardResult = idempotencyGuardService.beginGuard({
            key: guardKey,
            runningTtlMs: 120000,
            replayTtlMs: 15000
        });
        if (sendGuardedResponse(req, res, guardResult, 'Timesheet save is already in progress. Please wait.')) return;

        const period = await dataService.getDataById('timesheetPeriods', periodId, req.user);
        if (!period) throw new Error('Period not found.');
        assertPeriodOrgAccess(period, activeOrgId, req.user);

        if (period.status === 'processed') {
            throw new Error('<b>Security Error</b><br>This period has been processed by payroll and is locked.');
        }

        const existing = await dataService.getTimesheetByPeriodAndTeacher(periodId, teacherContext.targetTeacherId, req.user);

        if (existing && existing.status === 'submitted' && !teacherContext.isAdmin) {
            throw new Error('<b>Security Error</b><br>This timesheet has been submitted and is locked.<br>Contact an admin to make changes.');
        }

        let nextStatus = (status === 'submitted') ? 'submitted' : 'draft';
        if (existing && existing.status === 'submitted' && teacherContext.isAdmin) {
            nextStatus = 'submitted';
        }

        const parsedEntries = typeof entries === 'string' ? JSON.parse(entries) : entries;
        const entryRows = Array.isArray(parsedEntries) ? parsedEntries : [];

        const sessionStatusMeta = await sessionStatusPolicyService.getClientStatusMeta(period.orgId || activeOrgId || '', { includeInactive: true });
        const statusMap = sessionStatusPolicyService.getStatusMetaMap(sessionStatusMeta);
        const classes = await dataService.fetchData('classes', {}, req.user);
        const liveSessionById = new Map();

        for (const classRow of classes || []) {
            const sessions = await dataService.getClassSessions(classRow.id, req.user);
            (sessions || []).forEach((sessionRow) => {
                if (!idsEqual(sessionRow?.delivery?.deliveredBy, teacherContext.targetTeacherId)) return;
                if (sessionRow.date < period.startDate || sessionRow.date > period.endDate) return;
                const key = String(sessionRow?.sessionId || '').trim();
                if (!key) return;
                liveSessionById.set(key, {
                    classId: String(classRow?.id || ''),
                    className: String(classRow?.title || classRow?.name || ''),
                    status: sessionRow?.status,
                    notes: sessionRow?.notes,
                    durationHours: Number(parseFloat(sessionRow?.durationHours) || 0)
                });
            });
        }

        const normalizedEntries = entryRows.map((entry) => {
            if (!entry || typeof entry !== 'object') return entry;
            if (entry.isDeleted === true) {
                return { sessionId: String(entry.sessionId || ''), isDeleted: true };
            }
            if (entry.isManual === true) {
                return entry;
            }

            const sessionId = String(entry.sessionId || '').trim();
            if (entry.isReportReflection === true || sessionId.startsWith('rptref-')) {
                const hours = Number(parseFloat(entry.hours ?? entry.timesheetHours ?? entry.durationHours) || 0);
                return {
                    ...entry,
                    sessionId,
                    classId: String(entry.classId || ''),
                    className: String(entry.className || ''),
                    status: String(entry.status || 'completed').trim().toLowerCase() || 'completed',
                    hours,
                    timesheetHours: hours,
                    isFinalStatus: true,
                    isReportReflection: true
                };
            }

            const sessionRef = liveSessionById.get(sessionId);
            if (!sessionRef) return entry;

            const normalizedStatus = sessionStatusPolicyService.normalizeSessionStatus(sessionRef.status, sessionRef.notes);
            const hours = sessionStatusPolicyService.calculateTimesheetHoursByMap(statusMap, {
                status: sessionRef.status,
                notes: sessionRef.notes,
                durationHours: sessionRef.durationHours
            });
            const isFinalStatus = sessionStatusPolicyService.isFinalStatusByMap(statusMap, {
                status: sessionRef.status,
                notes: sessionRef.notes
            });

            return {
                ...entry,
                sessionId,
                classId: String(entry.classId || sessionRef.classId || ''),
                className: String(entry.className || sessionRef.className || ''),
                status: normalizedStatus,
                hours,
                timesheetHours: hours,
                isFinalStatus
            };
        });

        if (nextStatus === 'submitted') {
            const hasNonFinalAutoSession = normalizedEntries.some((entry) => {
                if (!entry || entry.isDeleted || entry.isManual) return false;
                return entry.isFinalStatus === false;
            });
            if (hasNonFinalAutoSession) {
                throw new Error('Some auto sessions are not in a final status. Update session statuses before submission.');
            }
        }

        const payload = {
            orgId: existing?.orgId || period.orgId || activeOrgId,
            periodId: String(periodId),
            teacherId: String(teacherContext.targetTeacherId),
            status: nextStatus,
            entries: normalizedEntries,
            totalHours: parseFloat(totalHours) || 0
        };

        if (existing?.id) {
            await dataService.updateData('timesheets', existing.id, payload, req.user);
        } else {
            await dataService.addData('timesheets', payload, req.user);
        }

        const payloadOut = {
            status: 'success',
            message: `Timesheet ${nextStatus === 'submitted' ? 'submitted' : 'saved'} successfully.`
        };
        idempotencyGuardService.completeGuard(guardKey, payloadOut);
        res.json(payloadOut);
    } catch (error) {
        if (guardKey) idempotencyGuardService.failGuard(guardKey);
        res.status(400).json({ status: 'error', message: error.message });
    }
};
