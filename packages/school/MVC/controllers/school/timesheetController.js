// MVC/controllers/school/timesheetController.js
const dataService = require('../../services/school/schoolDataService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const settingService = requireCoreModule('MVC/services/settingService');
const { isAjax, buildDataServiceQuery, inferSearchableFields } = requireCoreModule('MVC/utils/generalTools');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
const { assertOrgAccess } = requireCoreModule('MVC/utils/orgContextUtils');
const sessionStatusPolicyService = require('../../services/school/sessionStatusPolicyService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const { buildReportReflectionLiveSessions } = require('../../services/school/reportTimesheetReflectionService');
const activityService = require('../../services/school/activityService');
const timesheetManualConflictService = require('../../services/school/timesheetManualConflictService');
const priorPeriodAdjustmentService = require('../../services/school/timesheetPriorPeriodAdjustmentService');
const schoolDependencyService = require('../../services/school/schoolDependencyService');
const timesheetManualMaterializationService = require('../../services/school/timesheetManualMaterializationService');
const timesheetPayrollContextService = require('../../services/school/timesheetPayrollContextService');
const timesheetPayRateService = require('../../services/school/timesheetPayRateService');
const schoolIdentityLookupService = require('../../services/school/schoolIdentityLookupService');
const { sanitizeSnapshotEntry } = require('../../models/school/timesheetModel');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

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
    return String(person?.displayName || person?.name || '').trim()
        || `${person?.name?.first || ''} ${person?.name?.last || ''}`.trim()
        || String(person?.id || person?.personId || '');
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

    const directRoles = Array.isArray(person.schoolRoles || person.roles) ? (person.schoolRoles || person.roles) : [];
    if (directRoles.includes('school_teacher') || directRoles.includes('school_staff')) return true;

    const memberships = Array.isArray(person.organizations) ? person.organizations : [];
    return memberships.some((org) => {
        if (String(org?.orgId || '') !== targetOrgId) return false;
        const memberStatus = String(org?.memberStatus || 'active').trim().toLowerCase();
        if (memberStatus && memberStatus !== 'active') return false;
        const roles = normalizeOrgRoles(org);
        return roles.includes('school_teacher') || roles.includes('school_staff');
    });
}

function getTimesheetRolesForPersonInOrg(person, orgId) {
    const targetOrgId = String(orgId || '').trim();
    if (!targetOrgId || !person) return [];

    const rolesOut = new Set();
    const directRoles = Array.isArray(person.schoolRoles || person.roles) ? (person.schoolRoles || person.roles) : [];
    if (directRoles.includes('school_teacher')) rolesOut.add('teacher');
    if (directRoles.includes('school_staff')) rolesOut.add('staff');

    const memberships = Array.isArray(person.organizations) ? person.organizations : [];
    memberships.forEach((org) => {
        if (!idsEqual(org?.orgId, targetOrgId)) return;
        const memberStatus = String(org?.memberStatus || 'active').trim().toLowerCase();
        if (memberStatus && memberStatus !== 'active') return;
        const roles = normalizeOrgRoles(org);
        if (roles.includes('school_teacher')) rolesOut.add('teacher');
        if (roles.includes('school_staff')) rolesOut.add('staff');
    });
    return [...rolesOut];
}

function normalizeScheduleRole(value) {
    const token = String(value || '').trim().toLowerCase();
    if (!token) return '';
    if (token.includes('teacher')) return 'teacher';
    if (token.includes('staff')) return 'staff';
    if (token.includes('student')) return 'student';
    return '';
}

function getScheduleRolesForPersonInOrg(person, orgId) {
    const targetOrgId = String(orgId || '').trim();
    if (!targetOrgId || !person) return [];

    const rolesOut = new Set();
    const directRoles = Array.isArray(person.schoolRoles || person.roles) ? (person.schoolRoles || person.roles) : [];
    directRoles.forEach((role) => {
        const normalized = normalizeScheduleRole(role);
        if (normalized) rolesOut.add(normalized);
    });

    const memberships = Array.isArray(person.organizations) ? person.organizations : [];
    memberships.forEach((org) => {
        if (!idsEqual(org?.orgId, targetOrgId)) return;
        const memberStatus = String(org?.memberStatus || 'active').trim().toLowerCase();
        if (memberStatus && memberStatus !== 'active') return;
        const roles = normalizeOrgRoles(org);
        roles.forEach((role) => {
            const normalized = normalizeScheduleRole(role);
            if (normalized) rolesOut.add(normalized);
        });
    });
    return [...rolesOut];
}

async function resolveScheduleRolesForPerson({ activeOrgId, personId, reqUser }) {
    const rolesOut = new Set();
    const person = await getPersonById(personId, reqUser);
    getScheduleRolesForPersonInOrg(person, activeOrgId).forEach((role) => rolesOut.add(role));

    const [teachers, staff, students] = await Promise.all([
        dataService.fetchData('teachers', { orgId__eq: activeOrgId, personId__eq: personId }, reqUser),
        dataService.fetchData('staff', { orgId__eq: activeOrgId, personId__eq: personId }, reqUser),
        dataService.fetchData('students', { orgId__eq: activeOrgId, personId__eq: personId }, reqUser)
    ]);

    const hasActive = (rows = []) => (Array.isArray(rows) ? rows : []).some((row) => !isInactiveSchoolRecord(row));
    if (hasActive(teachers)) rolesOut.add('teacher');
    if (hasActive(staff)) rolesOut.add('staff');
    if (hasActive(students)) rolesOut.add('student');

    return [...rolesOut];
}

function normalizeDateOnly(value) {
    const raw = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function normalizeClockTime(value) {
    return timesheetManualConflictService.normalizeClockTime(value);
}

function calculateHoursFromTimes(startTime, endTime) {
    const start = normalizeClockTime(startTime);
    const end = normalizeClockTime(endTime);
    if (!start || !end) return 0;
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);
    const startMinutes = (startH * 60) + startM;
    const endMinutes = (endH * 60) + endM;
    if (endMinutes <= startMinutes) return 0;
    return Number(((endMinutes - startMinutes) / 60).toFixed(2));
}

function normalizeManualApprovalStatus(value) {
    const token = String(value || '').trim().toLowerCase();
    if (token === 'pending_approval') return 'pending_approval';
    if (token === 'approved') return 'approved';
    if (token === 'unpaid') return 'unpaid';
    return '';
}

function isActiveActivityRow(row) {
    const status = String(row?.status || '').trim().toLowerCase();
    return !['archived', 'deleted', 'inactive', 'removed'].includes(status);
}

function isInactiveSchoolRecord(row) {
    const status = String(row?.status || '').trim().toLowerCase();
    return ['archived', 'deleted', 'inactive', 'terminated'].includes(status);
}

function isActiveClassForManualEntry(row) {
    const status = String(row?.status || '').trim().toLowerCase();
    return status === 'active';
}

async function runTimesheetConflictValidation({
    activeOrgId,
    personId,
    period,
    candidateEntries = [],
    draftEntries = [],
    timesheetEntries = [],
    ignoreSessionId = '',
    reqUser
}) {
    const scheduleRoles = await resolveScheduleRolesForPerson({
        activeOrgId,
        personId,
        reqUser
    });
    const manualCandidates = (Array.isArray(candidateEntries) ? candidateEntries : [])
        .filter((entry) => entry && entry.isDeleted !== true && entry.isManual === true);
    if (!manualCandidates.length && !(Array.isArray(timesheetEntries) ? timesheetEntries : []).some((row) => row?.startTime && row?.endTime)) {
        return [];
    }
    return timesheetManualConflictService.detectRoleAwareManualEntryConflicts({
        activeOrgId,
        personId,
        activeRoles: scheduleRoles,
        startDate: period.startDate,
        endDate: period.endDate,
        candidateEntries: manualCandidates,
        draftEntries,
        timesheetEntries,
        ignoreSessionId,
        reqUser
    });
}

function throwTimesheetConflictError(conflicts = []) {
    const warning = new Error('Selected date/time conflicts with your schedule or another timesheet row. Adjust and try again.');
    warning.status = 'warning';
    warning.code = 'MANUAL_ENTRY_SCHEDULE_CONFLICT';
    warning.conflicts = (Array.isArray(conflicts) ? conflicts : []).slice(0, 20);
    throw warning;
}

function buildDepartmentMap(departments = []) {
    return new Map((Array.isArray(departments) ? departments : [])
        .map((row) => [String(row?.id || '').trim(), row])
        .filter(([id]) => Boolean(id)));
}

function resolveDepartmentName(departmentId, explicitName, departmentMap) {
    const directName = String(explicitName || '').trim();
    if (directName) return directName;
    const id = String(departmentId || '').trim();
    const dept = id ? departmentMap.get(id) : null;
    return String(dept?.name || dept?.title || dept?.departmentName || id || '').trim();
}

function resolveTimesheetEntryHours(entry) {
    if (!entry || entry.isDeleted) return 0;
    const approvalStatus = String(entry?.approvalStatus || '').trim().toLowerCase();
    if (entry?.excludeFromTotals === true || approvalStatus === 'pending_approval') return 0;
    if (entry.isManual || entry.isPriorPeriodAdjustment) {
        return Number(parseFloat(entry.requestedHours ?? entry.durationHours ?? entry.hours) || 0);
    }
    const formulaHours = Number(entry.timesheetHours);
    if (Number.isFinite(formulaHours)) return Number(formulaHours.toFixed(2));
    return Number(parseFloat(entry.durationHours ?? entry.hours) || 0);
}

function buildSubmissionSnapshot({ normalizedEntries, period, existingTimesheet }) {
    if (existingTimesheet?.submissionSnapshot?.submittedAt) {
        return existingTimesheet.submissionSnapshot;
    }
    const entries = normalizedEntries
        .filter((entry) => entry && entry.isDeleted !== true && entry.isPriorPeriodAdjustment !== true)
        .map((entry) => sanitizeSnapshotEntry(entry))
        .filter(Boolean);
    return {
        submittedAt: new Date().toISOString(),
        sourcePeriodId: String(period.id),
        sourcePeriodName: String(period.name || ''),
        entries
    };
}

function normalizeStatusCode(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'scheduled';
}

function formatPeriodDeadlineLabel(period) {
    const deadline = String(period?.submissionDeadline || '').trim();
    if (!deadline) return '-';
    const time = String(period?.submissionDeadlineTime || '23:59').trim() || '23:59';
    return `${deadline} ${time}`;
}

function formatHourlyRateLabel(value) {
    return timesheetPayRateService.formatHourlyRateLabel(value);
}

function dateOrBoundary(value, fallback) {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function ratePeriodOverlapsTimesheetPeriod(ratePeriod, period) {
    return timesheetPayRateService.profileOverlapsPeriod(ratePeriod, period);
}

function withPayrollStamp(entry, payrollContext, period, hoursOverride) {
    if (!entry || entry.isDeleted === true) return entry;
    const hours = hoursOverride !== undefined ? hoursOverride : resolveTimesheetEntryHours(entry);
    const payrollFields = timesheetPayrollContextService.stampEntryPayrollFields({
        entry,
        payrollContext,
        period,
        payRateService: timesheetPayRateService,
        hours
    });
    return { ...entry, ...payrollFields };
}

function shapePayrollContextForEditor(payrollContext) {
    const roles = Array.isArray(payrollContext?.roles) ? payrollContext.roles : [];
    const roleAccounts = {};
    roles.forEach((role) => {
        const meta = payrollContext?.roleRecords?.[role] || {};
        roleAccounts[role] = {
            roleRecordId: meta.roleRecordId || '',
            accountId: meta.accountId || '',
            accountLabel: meta.accountLabel || ''
        };
    });
    return {
        payrollRoles: roles,
        payrollDefaultRole: payrollContext?.defaultRole || roles[0] || 'teacher',
        roleAccounts,
        payrollWarnings: Array.isArray(payrollContext?.warnings) ? payrollContext.warnings : []
    };
}

function shapeTimesheetPeriodPickerRow(period) {
    const id = String(period?.id || '').trim();
    const name = String(period?.name || id || 'Timesheet Period').trim();
    const startDate = String(period?.startDate || '').trim();
    const endDate = String(period?.endDate || '').trim();
    const status = String(period?.status || '').trim();
    const periodWindowLabel = startDate || endDate ? `${startDate || '?'} to ${endDate || '?'}` : '';
    const deadlineLabel = formatPeriodDeadlineLabel(period);
    const subtitle = [periodWindowLabel, deadlineLabel !== '-' ? `Deadline: ${deadlineLabel}` : '', status ? `Status: ${status}` : '']
        .filter(Boolean)
        .join(' | ');
    return {
        ...period,
        id,
        name,
        title: name,
        displayName: name,
        subtitle,
        periodWindowLabel,
        deadlineLabel,
        submissionDeadlineTime: String(period?.submissionDeadlineTime || '23:59')
    };
}

function shapeManualActivityRows(activityRows = []) {
    return (Array.isArray(activityRows) ? activityRows : [])
        .filter((row) => row && row.id)
        .map((row) => ({
            id: String(row.id),
            name: String(row.title || row.name || row.id),
            paid: row.paid === true,
            status: String(row.status || ''),
            categoryId: String(row.categoryId || ''),
            categoryName: String(row.categoryName || ''),
            departmentId: String(row.departmentId || ''),
            departmentName: String(row.departmentName || '')
        }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function buildIncompleteSessionWarningRow(classRow, sessionRow, statusLabel = '') {
    return {
        sessionType: 'class',
        sessionId: String(sessionRow?.sessionId || ''),
        classId: String(classRow?.id || ''),
        className: String(classRow?.title || classRow?.name || classRow?.id || ''),
        date: String(sessionRow?.date || ''),
        startTime: String(sessionRow?.startTime || ''),
        endTime: String(sessionRow?.endTime || ''),
        status: String(sessionRow?.status || ''),
        statusLabel: String(statusLabel || '')
    };
}

function sortIncompleteSessions(rows = []) {
    return [...rows].sort((a, b) => {
        const dateCmp = String(a?.date || '').localeCompare(String(b?.date || ''));
        if (dateCmp !== 0) return dateCmp;
        return String(a?.startTime || '').localeCompare(String(b?.startTime || ''));
    });
}

async function loadTimesheetManagementPeriods(req, query = {}) {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const allPeriods = await dataService.fetchData('timesheetPeriods', { ...query, orgId__eq: activeOrgId }, req.user);
    return (Array.isArray(allPeriods) ? allPeriods : [])
        .filter((row) => idsEqual(row?.orgId, activeOrgId))
        .sort((a, b) => String(b?.startDate || '').localeCompare(String(a?.startDate || '')));
}

async function loadTimesheetEligiblePeople(activeOrgId, reqUser) {
    const [personPayload, teachers, staff, departments] = await Promise.all([
        schoolIdentityLookupService.listSchoolPersons({
            reqUser,
            requireSchoolRole: true,
            query: { limit: 1000 }
        }),
        dataService.fetchData('teachers', { orgId__eq: activeOrgId }, reqUser),
        dataService.fetchData('staff', { orgId__eq: activeOrgId }, reqUser),
        dataService.fetchData('departments', {}, reqUser)
    ]);
    const persons = personPayload.allRows || personPayload.rows || [];

    const departmentMap = buildDepartmentMap(departments);
    const profileRowsByPerson = new Map();
    const addProfileRow = (role, row) => {
        if (!row || isInactiveSchoolRecord(row) || !idsEqual(row?.orgId, activeOrgId)) return;
        const personId = String(row?.personId || '').trim();
        if (!personId) return;
        const list = profileRowsByPerson.get(personId) || [];
        list.push({
            role,
            id: String(row?.id || '').trim(),
            departmentId: String(row?.departmentId || '').trim(),
            departmentName: resolveDepartmentName(row?.departmentId, row?.departmentName, departmentMap)
        });
        profileRowsByPerson.set(personId, list);
    };

    (Array.isArray(teachers) ? teachers : []).forEach((row) => addProfileRow('teacher', row));
    (Array.isArray(staff) ? staff : []).forEach((row) => addProfileRow('staff', row));

    return (Array.isArray(persons) ? persons : [])
        .map((person) => {
            const roles = getTimesheetRolesForPersonInOrg(person, activeOrgId);
            if (!roles.length) return null;
            const personId = String(person?.id || '').trim();
            const profileRows = profileRowsByPerson.get(personId) || [];
            const departmentHints = profileRows
                .map((row) => row.departmentName || row.departmentId)
                .filter(Boolean)
                .filter((value, index, arr) => arr.indexOf(value) === index);
            return {
                person,
                personId,
                name: buildPersonName(person),
                email: String(person?.email || person?.contact?.email || person?.contact?.emails?.[0]?.email || '').trim(),
                roles,
                profileRows,
                departmentHint: departmentHints.join(', ')
            };
        })
        .filter(Boolean)
        .sort((a, b) => String(a.name || a.personId).localeCompare(String(b.name || b.personId)));
}

async function getPersonById(personId, reqUser) {
    const id = String(personId || '').trim();
    if (!id) return null;
    const payload = await schoolIdentityLookupService.listSchoolPersons({
        reqUser,
        requireSchoolRole: false,
        query: { limit: 1000 }
    });
    const all = payload.allRows || payload.rows || [];
    return (all || []).find((p) => idsEqual(p?.id || p?.personId, id)) || null;
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

async function isTimesheetSectionAdmin(reqUser, operationId = OPERATIONS.READ_ALL) {
    return adminAuthorityService.isAdminForRequestAsync(
        reqUser,
        SECTIONS.SCHOOL_TIMESHEETS,
        operationId,
        { section: { id: SECTIONS.SCHOOL_TIMESHEETS } }
    );
}

async function resolveTargetTeacherContext(req, { requireTeacher = true, operationId = OPERATIONS.READ_ALL } = {}) {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const isAdmin = await isTimesheetSectionAdmin(req.user, operationId);
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

        const payload = await schoolIdentityLookupService.listSchoolPersons({
            reqUser: req.user,
            q: query.q || '',
            query: { ...query, limit: 1000 },
            requireSchoolRole: true
        });
        const persons = payload.allRows || payload.rows || [];
        const eligible = (persons || []).filter((p) => {
            const roles = Array.isArray(p.schoolRoles || p.roles) ? (p.schoolRoles || p.roles) : [];
            return roles.includes('school_teacher') || roles.includes('school_staff') || personHasTeacherOrStaffRoleInOrg(p, activeOrgId);
        });
        const { data, pagination } = paginate(eligible, query);
        return res.json({ status: 'success', data, results: data, items: data, pagination });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
};

exports.showTimesheetManagement = async (req, res) => {
    try {
        res.render('school/timesheet/timesheetManage', {
            title: 'Timesheet Management',
            tableName: 'Timesheet_Management',
            newUrl: 'school/timesheets/manage',
            newLabel: null,
            includeModal: true,
            includeModal_Table: true,
            print: true,
            user: req.user,
            actionStateId: req.actionStateId
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
};

exports.listTimesheetManagementPeriods = async (req, res) => {
    try {
        let query = await buildDataServiceQuery(req.query);
        const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
        if (query.q === searchDefaultKeyword) query.q = '';
        delete query.orgId;
        delete query.orgId__eq;
        const periods = await loadTimesheetManagementPeriods(req, query);
        const { data, pagination } = paginate(periods, query);
        return res.json({ status: 'success', results: data.map(shapeTimesheetPeriodPickerRow), pagination });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
};

exports.getTimesheetManagementRoster = async (req, res) => {
    try {
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        const periodId = String(req.query.periodId || '').trim();
        if (!periodId) throw new Error('Timesheet period is required.');

        const period = await dataService.getDataById('timesheetPeriods', periodId, req.user);
        if (!period) throw new Error('Timesheet period not found.');
        assertPeriodOrgAccess(period, activeOrgId, req.user);

        const [eligiblePeople, allTimesheets] = await Promise.all([
            loadTimesheetEligiblePeople(activeOrgId, req.user),
            dataService.fetchData('timesheets', {}, req.user, dataService.buildRouteAccessContext(req))
        ]);
        const timesheetByPersonId = new Map(
            (Array.isArray(allTimesheets) ? allTimesheets : [])
                .filter((row) => idsEqual(row?.orgId, activeOrgId) && idsEqual(row?.periodId, periodId))
                .map((row) => [String(row?.teacherId || '').trim(), row])
                .filter(([id]) => Boolean(id))
        );

        const requestedTimesheetStatus = String(req.query.timesheetStatus || '').trim().toLowerCase();
        const rows = eligiblePeople.map((personRow) => {
            const timesheet = timesheetByPersonId.get(personRow.personId) || null;
            const status = String(timesheet?.status || 'not_started').toLowerCase();
            return {
                personId: personRow.personId,
                name: personRow.name,
                email: personRow.email,
                roles: personRow.roles,
                departmentHint: personRow.departmentHint,
                timesheetId: timesheet?.id || '',
                status,
                totalHours: Number(parseFloat(timesheet?.totalHours) || 0),
                openUrl: `/school/timesheets/editor/${encodeURIComponent(periodId)}?teacherId=${encodeURIComponent(personRow.personId)}`
            };
        }).filter((row) => !requestedTimesheetStatus || row.status === requestedTimesheetStatus);

        return res.json({
            status: 'success',
            period: {
                id: String(period?.id || ''),
                name: String(period?.name || ''),
                startDate: String(period?.startDate || ''),
                endDate: String(period?.endDate || ''),
                submissionDeadline: String(period?.submissionDeadline || ''),
                submissionDeadlineTime: String(period?.submissionDeadlineTime || '23:59'),
                status: String(period?.status || '')
            },
            rows
        });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
};

async function buildEffectiveTimesheetEntries({ period, personId, activeOrgId, reqUser }) {
    const statusMeta = await sessionStatusPolicyService.getClientStatusMeta(period.orgId || activeOrgId || '', { includeInactive: true });
    const statusMap = sessionStatusPolicyService.getStatusMetaMap(statusMeta);
    const [classes, existing] = await Promise.all([
        dataService.fetchData('classes', {}, reqUser),
        dataService.getTimesheetByPeriodAndTeacher(period.id, personId, reqUser)
    ]);

    const classRows = (Array.isArray(classes) ? classes : []).filter((row) => idsEqual(row?.orgId, activeOrgId));
    const liveSessions = [];

    for (const classRow of classRows) {
        // eslint-disable-next-line no-await-in-loop
        const sessions = await dataService.getClassSessions(classRow.id, reqUser);
        (Array.isArray(sessions) ? sessions : [])
            .filter((sessionRow) =>
                idsEqual(sessionRow?.delivery?.deliveredBy, personId) &&
                String(sessionRow?.date || '') >= String(period.startDate || '') &&
                String(sessionRow?.date || '') <= String(period.endDate || '')
            )
            .forEach((sessionRow) => {
                const rawDurationHours = parseFloat(sessionRow?.durationHours) || 0;
                const normalizedStatus = sessionStatusPolicyService.normalizeSessionStatus(sessionRow?.status, sessionRow?.notes);
                const isFinalStatus = sessionStatusPolicyService.isFinalStatusByMap(statusMap, {
                    status: sessionRow?.status,
                    notes: sessionRow?.notes
                });
                if (!isFinalStatus) return;
                const timesheetHours = sessionStatusPolicyService.calculateTimesheetHoursByMap(statusMap, {
                    status: sessionRow?.status,
                    notes: sessionRow?.notes,
                    durationHours: rawDurationHours
                });
                liveSessions.push({
                    sessionId: sessionRow?.sessionId,
                    classId: String(classRow?.id || ''),
                    className: String(classRow?.title || classRow?.name || ''),
                    deliveryDepartmentId: classRow?.deliveryDepartmentId || '',
                    deliveryDepartmentName: classRow?.deliveryDepartmentName || '',
                    date: sessionRow?.date,
                    startTime: sessionRow?.startTime,
                    endTime: sessionRow?.endTime,
                    durationHours: rawDurationHours,
                    timesheetHours,
                    status: normalizedStatus,
                    isFinalStatus,
                    isManual: false
                });
            });
    }

    const reportReflectionSessions = await buildReportReflectionLiveSessions({
        teacherPersonId: personId,
        periodStartDate: period.startDate,
        periodEndDate: period.endDate,
        activeOrgId,
        reqUser
    });

    const activityEntries = await activityService.getTimesheetEntriesForPerson({
        orgId: activeOrgId,
        personId,
        periodStartDate: period.startDate,
        periodEndDate: period.endDate,
        reqUser
    });

    const existingEntries = Array.isArray(existing?.entries) ? existing.entries : [];
    const deletedAutoSessionIds = existingEntries
        .filter((entry) => entry?.isDeleted === true)
        .map((entry) => String(entry?.sessionId || '').trim())
        .filter(Boolean);
    const savedComments = {};
    existingEntries.forEach((entry) => {
        if (!entry || entry.isDeleted || entry.isManual) return;
        const sessionId = String(entry.sessionId || '').trim();
        if (sessionId) savedComments[sessionId] = String(entry.comment || '');
    });

    const manualEntries = existingEntries
        .filter((entry) => entry?.isManual === true && entry?.isDeleted !== true)
        .map((entry) => ({ ...entry, isManual: true }));
    const autoEntries = [...liveSessions, ...reportReflectionSessions, ...activityEntries]
        .filter((entry) => !deletedAutoSessionIds.includes(String(entry?.sessionId || '').trim()))
        .map((entry) => ({
            ...entry,
            comment: savedComments[String(entry?.sessionId || '').trim()] || entry?.comment || '',
            isManual: false
        }));

    return {
        entries: [...manualEntries, ...autoEntries],
        classes: classRows,
        timesheet: existing || null
    };
}

exports.getTimesheetDepartmentSummary = async (req, res) => {
    try {
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        const periodId = String(req.query.periodId || '').trim();
        const personId = String(req.query.personId || req.query.teacherId || '').trim();
        if (!periodId) throw new Error('Timesheet period is required.');
        if (!personId) throw new Error('Person is required.');

        const [period, departments] = await Promise.all([
            dataService.getDataById('timesheetPeriods', periodId, req.user),
            dataService.fetchData('departments', {}, req.user)
        ]);
        if (!period) throw new Error('Timesheet period not found.');
        assertPeriodOrgAccess(period, activeOrgId, req.user);

        const payrollContext = await timesheetPayrollContextService.resolvePayrollPersonContext({
            orgId: activeOrgId,
            personId,
            reqUser: req.user
        });

        const departmentMap = buildDepartmentMap(departments);
        const effective = await buildEffectiveTimesheetEntries({ period, personId, activeOrgId, reqUser: req.user });
        const classMap = new Map((effective.classes || []).map((row) => [String(row?.id || '').trim(), row]));
        const buckets = new Map();

        effective.entries.forEach((entry) => {
            const hours = resolveTimesheetEntryHours(entry);
            if (!Number.isFinite(hours) || hours <= 0) return;
            const stamped = withPayrollStamp(entry, payrollContext, period, hours);
            const classRow = entry?.classId ? classMap.get(String(entry.classId || '').trim()) : null;
            const isReport = entry?.isReportReflection === true || String(entry?.sessionId || '').startsWith('rptref-');
            const isActivity = entry?.isSchoolActivity === true || String(entry?.sessionId || '').startsWith('act-');
            const source = entry?.isManual ? 'manual' : (isReport ? 'report' : (isActivity ? 'activity' : 'auto'));
            const departmentId = String(entry?.deliveryDepartmentId || entry?.departmentId || classRow?.deliveryDepartmentId || '').trim();
            const departmentName = resolveDepartmentName(
                departmentId,
                entry?.deliveryDepartmentName || entry?.departmentName || classRow?.deliveryDepartmentName || '',
                departmentMap
            ) || (entry?.isManual && !entry?.classId ? 'No Department / Manual' : 'No Department');
            const personRole = stamped.personRole || payrollContext.defaultRole || 'teacher';
            const roleMeta = payrollContext.roleRecords?.[personRole] || {};
            const key = `${personRole}::${departmentId || departmentName || 'NO_DEPARTMENT'}`;
            const bucket = buckets.get(key) || {
                personRole,
                roleRecordId: stamped.roleRecordId || roleMeta.roleRecordId || '',
                payrollAccountId: stamped.payrollAccountId || roleMeta.accountId || '',
                accountLabel: roleMeta.accountLabel || '',
                departmentId,
                departmentName,
                autoHours: 0,
                manualHours: 0,
                reportHours: 0,
                activityHours: 0,
                totalHours: 0,
                grossPay: 0,
                entryCount: 0
            };
            if (source === 'manual') bucket.manualHours += hours;
            else if (source === 'report') bucket.reportHours += hours;
            else if (source === 'activity') bucket.activityHours += hours;
            else bucket.autoHours += hours;
            bucket.totalHours += hours;
            if (Number.isFinite(stamped.grossPay)) bucket.grossPay += stamped.grossPay;
            bucket.entryCount += 1;
            buckets.set(key, bucket);
        });

        const rows = [...buckets.values()]
            .map((row) => {
                const roleMeta = payrollContext.roleRecords?.[row.personRole] || {};
                const resolvedRate = timesheetPayRateService.resolveHourlyRate({
                    compensationProfiles: roleMeta.compensationProfiles || [],
                    departmentId: row.departmentId,
                    period
                });
                const grossPay = Number.isFinite(row.grossPay) && row.grossPay > 0
                    ? row.grossPay
                    : timesheetPayRateService.computeGrossPay(row.totalHours, resolvedRate?.hourlyRate);
                return {
                    ...row,
                    autoHours: Number(row.autoHours.toFixed(2)),
                    manualHours: Number(row.manualHours.toFixed(2)),
                    reportHours: Number(row.reportHours.toFixed(2)),
                    activityHours: Number(row.activityHours.toFixed(2)),
                    totalHours: Number(row.totalHours.toFixed(2)),
                    hourlyRate: resolvedRate ? Number(resolvedRate.hourlyRate.toFixed(2)) : null,
                    payRate: resolvedRate ? Number(resolvedRate.hourlyRate.toFixed(2)) : null,
                    payRateLabel: resolvedRate ? timesheetPayRateService.formatHourlyRateLabel(resolvedRate.hourlyRate) : 'N/D',
                    payRateRole: row.personRole,
                    payRateContractId: resolvedRate?.contractId || '',
                    rateStatus: resolvedRate ? 'hourly' : 'missing_hourly_rate',
                    grossPay: grossPay !== null ? Number(grossPay.toFixed(2)) : null,
                    grossPayLabel: timesheetPayRateService.formatGrossPayLabel(grossPay)
                };
            })
            .sort((a, b) => {
                const roleCmp = String(a.personRole).localeCompare(String(b.personRole));
                if (roleCmp) return roleCmp;
                return String(a.departmentName).localeCompare(String(b.departmentName));
            });

        const roleTotals = {};
        const totals = rows.reduce((acc, row) => {
            acc.autoHours += row.autoHours;
            acc.manualHours += row.manualHours;
            acc.reportHours += row.reportHours;
            acc.activityHours += row.activityHours;
            acc.totalHours += row.totalHours;
            acc.grossPay += Number(row.grossPay || 0);
            acc.entryCount += row.entryCount;
            const roleKey = row.personRole || 'teacher';
            if (!roleTotals[roleKey]) {
                roleTotals[roleKey] = { personRole: roleKey, totalHours: 0, grossPay: 0, entryCount: 0 };
            }
            roleTotals[roleKey].totalHours += row.totalHours;
            roleTotals[roleKey].grossPay += Number(row.grossPay || 0);
            roleTotals[roleKey].entryCount += row.entryCount;
            return acc;
        }, { autoHours: 0, manualHours: 0, reportHours: 0, activityHours: 0, totalHours: 0, grossPay: 0, entryCount: 0 });

        return res.json({
            status: 'success',
            period: {
                id: String(period?.id || ''),
                name: String(period?.name || ''),
                startDate: String(period?.startDate || ''),
                endDate: String(period?.endDate || '')
            },
            person: {
                id: payrollContext.personId,
                name: payrollContext.personName,
                roles: payrollContext.roles
            },
            payrollWarnings: payrollContext.warnings || [],
            timesheet: {
                id: effective.timesheet?.id || '',
                status: effective.timesheet?.status || 'not_started'
            },
            rows,
            roleTotals: Object.values(roleTotals).map((row) => ({
                ...row,
                totalHours: Number(row.totalHours.toFixed(2)),
                grossPay: Number(row.grossPay.toFixed(2))
            })),
            totals: {
                autoHours: Number(totals.autoHours.toFixed(2)),
                manualHours: Number(totals.manualHours.toFixed(2)),
                reportHours: Number(totals.reportHours.toFixed(2)),
                activityHours: Number(totals.activityHours.toFixed(2)),
                totalHours: Number(totals.totalHours.toFixed(2)),
                grossPay: Number(totals.grossPay.toFixed(2)),
                entryCount: totals.entryCount
            }
        });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
};

exports.listMyTimesheets = async (req, res) => {
    try {
        let query = await buildDataServiceQuery(req.query);
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
        if (query.q === searchDefaultKeyword) query.q = '';

        const requestedTsStatus = query.tsStatus;
        delete query.tsStatus;

        const selectedYear = query.year || new Date().getFullYear().toString();
        delete query.year;

        delete query.teacherId;
        delete query.orgId;
        delete query.orgId__eq;

        const allPeriods = await dataService.fetchData('timesheetPeriods', { ...query, orgId__eq: activeOrgId }, req.user);
        const availableYears = [...new Set(allPeriods.map((p) => {
            if (!p.startDate) return new Date().getFullYear();
            return new Date(p.startDate).getFullYear();
        }))].sort((a, b) => b - a);

        const teacherContext = await resolveTargetTeacherContext(req, { requireTeacher: false, operationId: OPERATIONS.READ_ALL });

        const allTimesheets = await dataService.fetchData('timesheets', {}, req.user, dataService.buildRouteAccessContext(req));
        const targetTimesheets = teacherContext.targetTeacherId
            ? allTimesheets.filter((t) => idsEqual(t.teacherId, teacherContext.targetTeacherId))
            : [];

        let mappedPeriods = allPeriods
            .filter((p) => idsEqual(p?.orgId, activeOrgId))
            .filter((p) => new Date(p.startDate || new Date()).getFullYear().toString() === selectedYear.toString())
            .map((p) => {
                const ts = targetTimesheets.find((t) => idsEqual(t.periodId, p.id));
                const orgId = String(p.orgId || '').trim();
                return {
                    ...p,
                    orgId,
                    orgName: orgId || '-',
                    timesheetId: ts ? ts.id : null,
                    tsStatus: ts ? ts.status : 'not_started',
                    totalHours: ts ? ts.totalHours : 0
                };
            });

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
            selectedOrgId: activeOrgId,
            isSystemSuperAdmin: false,
            orgFilterOptions: [],
            isAdmin: teacherContext.isAdmin,
            currentTeacherId: teacherContext.currentTeacherId,
            targetTeacherId: teacherContext.targetTeacherId,
            selectedTeacherName: teacherContext.selectedTeacherName,
            includeModal: true,
            includeModal_Table: true,
            print: true,
            pagination,
            filters: { ...req.query, orgId: undefined, orgId__eq: undefined },
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

        const teacherContext = await resolveTargetTeacherContext(req, { requireTeacher: true, operationId: OPERATIONS.READ_ALL });

        const maxDailyHours = 12.0;
        const maxSessionHours = 8.0;
        const sessionStatusMeta = await sessionStatusPolicyService.getClientStatusMeta(period.orgId || activeOrgId || '', { includeInactive: true });
        const statusMap = sessionStatusPolicyService.getStatusMetaMap(sessionStatusMeta);

        const allTimesheets = await dataService.fetchData('timesheets', {}, req.user, dataService.buildRouteAccessContext(req));
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
        const scopedClasses = (Array.isArray(classes) ? classes : []).filter((row) => idsEqual(row?.orgId, activeOrgId));
        const liveSessions = [];
        const incompleteSessions = [];

        for (const c of scopedClasses) {
            const sessions = await dataService.getClassSessions(c.id, req.user);
            const myClassSessions = sessions.filter((s) =>
                idsEqual(s.delivery?.deliveredBy, teacherContext.targetTeacherId) &&
                s.date >= period.startDate &&
                s.date <= period.endDate
            );

            myClassSessions.forEach((s) => {
                const normalizedStatus = sessionStatusPolicyService.normalizeSessionStatus(s.status, s.notes);
                const rawDurationHours = parseFloat(s.durationHours) || 0;
                const isFinalStatus = sessionStatusPolicyService.isFinalStatusByMap(statusMap, {
                    status: s.status,
                    notes: s.notes
                });
                const statusLabel = (() => {
                    const normalizedCode = normalizeStatusCode(s.status);
                    const meta = (Array.isArray(sessionStatusMeta) ? sessionStatusMeta : []).find((row) => normalizeStatusCode(row?.code) === normalizedCode);
                    if (meta?.label) return String(meta.label);
                    return normalizedStatus || normalizedCode;
                })();
                if (!isFinalStatus) {
                    const duePeriodId = String(s?.attendanceDuePeriodId || '').trim();
                    if (duePeriodId && !idsEqual(duePeriodId, period.id)) {
                        return;
                    }
                    incompleteSessions.push(buildIncompleteSessionWarningRow(c, s, statusLabel));
                    return;
                }
                const timesheetHours = sessionStatusPolicyService.calculateTimesheetHoursByMap(statusMap, {
                    status: s.status,
                    notes: s.notes,
                    durationHours: rawDurationHours
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

        for (const c of scopedClasses) {
            const sessions = await dataService.getClassSessions(c.id, req.user);
            (Array.isArray(sessions) ? sessions : []).forEach((s) => {
                if (!idsEqual(s.delivery?.deliveredBy, teacherContext.targetTeacherId)) return;
                const duePeriodId = String(s?.attendanceDuePeriodId || '').trim();
                if (!duePeriodId || !idsEqual(duePeriodId, period.id)) return;
                const normalizedStatus = sessionStatusPolicyService.normalizeSessionStatus(s.status, s.notes);
                const isFinalStatus = sessionStatusPolicyService.isFinalStatusByMap(statusMap, {
                    status: s.status,
                    notes: s.notes
                });
                if (isFinalStatus) return;
                const statusLabel = (() => {
                    const normalizedCode = normalizeStatusCode(s.status);
                    const meta = (Array.isArray(sessionStatusMeta) ? sessionStatusMeta : []).find((row) => normalizeStatusCode(row?.code) === normalizedCode);
                    if (meta?.label) return String(meta.label);
                    return normalizedStatus || normalizedCode;
                })();
                if (incompleteSessions.some((row) => row.sessionId === s.sessionId && row.classId === c.id)) return;
                incompleteSessions.push(buildIncompleteSessionWarningRow(c, s, statusLabel));
            });
        }

        const incompleteActivitySessions = await activityService.getIncompleteActivityWorkSessionsForPerson({
            orgId: activeOrgId,
            personId: teacherContext.targetTeacherId,
            periodStartDate: period.startDate,
            periodEndDate: period.endDate,
            reqUser: req.user
        });
        incompleteSessions.push(...(Array.isArray(incompleteActivitySessions) ? incompleteActivitySessions : []));
        const sortedIncompleteSessions = sortIncompleteSessions(incompleteSessions);

        const reportReflectionSessions = await buildReportReflectionLiveSessions({
            teacherPersonId: teacherContext.targetTeacherId,
            periodStartDate: period.startDate,
            periodEndDate: period.endDate,
            activeOrgId,
            reqUser: req.user
        });
        const activityLiveSessions = await activityService.getTimesheetEntriesForPerson({
            orgId: activeOrgId,
            personId: teacherContext.targetTeacherId,
            periodStartDate: period.startDate,
            periodEndDate: period.endDate,
            reqUser: req.user
        });
        const mergedLiveSessions = [...liveSessions, ...reportReflectionSessions, ...(Array.isArray(activityLiveSessions) ? activityLiveSessions : [])];

        const payrollContext = await timesheetPayrollContextService.resolvePayrollPersonContext({
            orgId: activeOrgId,
            personId: teacherContext.targetTeacherId,
            reqUser: req.user
        });
        const payrollEditor = shapePayrollContextForEditor(payrollContext);
        const stampedLiveSessions = mergedLiveSessions.map((row) => withPayrollStamp(row, payrollContext, period));

        const [allHolidays] = await Promise.all([
            dataService.fetchData('holidays', {}, req.user)
        ]);
        const holidays = allHolidays.filter((h) => h.date >= period.startDate && h.date <= period.endDate);
        const eligibleManualActivities = await activityService.listManualEntryActivitiesForPerson({
            orgId: activeOrgId,
            personId: teacherContext.targetTeacherId,
            reqUser: req.user
        });
        const manualActivities = shapeManualActivityRows(eligibleManualActivities);

        const useFrozenSnapshot = ['submitted', 'approved', 'processed'].includes(String(timesheet.status || '').toLowerCase())
            && Array.isArray(timesheet?.submissionSnapshot?.entries)
            && timesheet.submissionSnapshot.entries.length > 0;
        const canAdminApprove = teacherContext.isAdmin && String(timesheet.status || '').toLowerCase() === 'submitted';
        const canAdminReopen = teacherContext.isAdmin && ['approved', 'processed'].includes(String(timesheet.status || '').toLowerCase());
        const isReadOnly = !teacherContext.isAdmin && (
            timesheet.status === 'submitted' ||
            timesheet.status === 'approved' ||
            timesheet.status === 'processed' ||
            period.status === 'processed'
        );

        let priorReviewPending = false;
        if (!isReadOnly && (timesheet.status === 'draft' || !timesheet.id)) {
            const prior = await priorPeriodAdjustmentService.findPriorSubmittedTimesheet({
                teacherId: teacherContext.targetTeacherId,
                currentPeriod: period,
                activeOrgId,
                reqUser: req.user
            });
            if (prior) {
                const alreadyReviewed = Boolean(
                    timesheet.priorPeriodAdjustmentsAppliedFrom &&
                    idsEqual(timesheet.priorPeriodAdjustmentsAppliedFrom, prior.priorPeriod.id)
                );
                priorReviewPending = !alreadyReviewed;
            }
        }

        const viewingOtherPerson = Boolean(
            teacherContext.isAdmin &&
            teacherContext.targetTeacherId &&
            teacherContext.currentTeacherId &&
            !idsEqual(teacherContext.targetTeacherId, teacherContext.currentTeacherId)
        );

        res.render('school/timesheet/timesheetEditor', {
            title: `Timesheet: ${period.name}`,
            period,
            timesheet,
            liveSessions: stampedLiveSessions,
            incompleteSessions: sortedIncompleteSessions,
            holidays,
            manualActivities,
            maxDailyHours,
            maxSessionHours,
            sessionStatusMeta,
            isAdmin: teacherContext.isAdmin,
            isReadOnly,
            user: req.user,
            targetTeacherId: teacherContext.targetTeacherId,
            personName: teacherContext.selectedTeacherName || '',
            viewingOtherPerson,
            payrollRoles: payrollEditor.payrollRoles,
            payrollDefaultRole: payrollEditor.payrollDefaultRole,
            roleAccounts: payrollEditor.roleAccounts,
            payrollWarnings: payrollEditor.payrollWarnings,
            includeModal: true,
            actionStateId: req.actionStateId,
            showPriorAdjustmentReview: priorReviewPending,
            useFrozenSnapshot,
            canAdminApprove,
            canAdminReopen
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
        const maxSessionHours = 8.0;

        const teacherContext = await resolveTargetTeacherContext(req, { requireTeacher: true, operationId: OPERATIONS.UPDATE });
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

        if (existing && ['submitted', 'approved', 'processed'].includes(String(existing.status || '').toLowerCase()) && !teacherContext.isAdmin) {
            throw new Error('<b>Security Error</b><br>This timesheet has been submitted and is locked.<br>Contact an admin to make changes.');
        }

        let nextStatus = (status === 'submitted') ? 'submitted' : 'draft';
        if (existing && existing.status === 'submitted' && teacherContext.isAdmin) {
            nextStatus = 'submitted';
        }
        if (existing && String(existing.status || '').toLowerCase() === 'approved' && teacherContext.isAdmin && nextStatus !== 'approved') {
            throw new Error('Approved timesheets must be reopened before editing. Use Reopen Timesheet.');
        }

        const parsedEntries = typeof entries === 'string' ? JSON.parse(entries) : entries;
        const entryRows = Array.isArray(parsedEntries) ? parsedEntries : [];

        const payrollContext = await timesheetPayrollContextService.resolvePayrollPersonContext({
            orgId: activeOrgId,
            personId: teacherContext.targetTeacherId,
            reqUser: req.user
        });

        const sessionStatusMeta = await sessionStatusPolicyService.getClientStatusMeta(period.orgId || activeOrgId || '', { includeInactive: true });
        const statusMap = sessionStatusPolicyService.getStatusMetaMap(sessionStatusMeta);
        const classes = await dataService.fetchData('classes', {}, req.user);
        const scopedClasses = (Array.isArray(classes) ? classes : []).filter((row) => idsEqual(row?.orgId, activeOrgId));
        const liveSessionById = new Map();

        for (const classRow of scopedClasses || []) {
            const sessions = await dataService.getClassSessions(classRow.id, req.user);
            (sessions || []).forEach((sessionRow) => {
                if (!idsEqual(sessionRow?.delivery?.deliveredBy, teacherContext.targetTeacherId)) return;
                if (sessionRow.date < period.startDate || sessionRow.date > period.endDate) return;
                const key = String(sessionRow?.sessionId || '').trim();
                if (!key) return;
                const isFinalStatus = sessionStatusPolicyService.isFinalStatusByMap(statusMap, {
                    status: sessionRow?.status,
                    notes: sessionRow?.notes
                });
                if (!isFinalStatus) return;
                liveSessionById.set(key, {
                    classId: String(classRow?.id || ''),
                    className: String(classRow?.title || classRow?.name || ''),
                    status: sessionRow?.status,
                    notes: sessionRow?.notes,
                    durationHours: Number(parseFloat(sessionRow?.durationHours) || 0)
                });
            });
        }

        const activityLiveSessions = await activityService.getTimesheetEntriesForPerson({
            orgId: activeOrgId,
            personId: teacherContext.targetTeacherId,
            periodStartDate: period.startDate,
            periodEndDate: period.endDate,
            reqUser: req.user
        });
        const activityLiveById = new Map();
        (Array.isArray(activityLiveSessions) ? activityLiveSessions : []).forEach((row) => {
            const key = String(row?.sessionId || '').trim();
            if (key) activityLiveById.set(key, row);
        });

        const hasManualRows = entryRows.some((entry) => entry && entry.isDeleted !== true && entry.isManual === true);
        let activityById = new Map();
        if (hasManualRows) {
            const allActivities = await activityService.listActivities({ orgId: activeOrgId, reqUser: req.user });
            activityById = new Map((Array.isArray(allActivities) ? allActivities : [])
                .filter((row) => isActiveActivityRow(row))
                .map((row) => [String(row?.id || '').trim(), row])
                .filter(([id]) => Boolean(id)));
        }

        const normalizedEntries = entryRows.map((entry) => {
            if (!entry || typeof entry !== 'object') return entry;
            if (entry.isDeleted === true) {
                return { sessionId: String(entry.sessionId || ''), isDeleted: true };
            }
            if (entry.isManual === true) {
                const sessionId = String(entry.sessionId || '').trim();
                if (!sessionId) throw new Error('Manual entry session id is required.');
                const classId = String(entry.classId || '').trim();
                const activityId = String(entry.activityId || '').trim();
                const activityRow = activityId ? activityById.get(activityId) : null;
                if (activityId && !activityRow) {
                    throw new Error('Selected activity is not active or no longer available. Please reselect the activity.');
                }
                if (activityRow && !activityService.isPersonEligibleForActivity(activityRow, teacherContext.targetTeacherId)) {
                    throw new Error('You are not eligible for the selected activity. Please choose another activity.');
                }
                if (activityRow && String(activityRow?.status || '').toLowerCase() !== 'posted') {
                    throw new Error('Selected activity must be posted before it can be used on a timesheet.');
                }

                const dateValue = normalizeDateOnly(entry.date);
                if (!dateValue || dateValue < period.startDate || dateValue > period.endDate) {
                    throw new Error('Manual entry date must be within the selected timesheet period.');
                }

                let startTime = normalizeClockTime(entry.startTime || '');
                let endTime = normalizeClockTime(entry.endTime || '');
                let requestedHours = Number(parseFloat(entry.requestedHours ?? entry.durationHours ?? entry.hours) || 0);
                if (classId || activityId) {
                    if (!startTime || !endTime) {
                        throw new Error('Manual entries with a class or activity require start and end time.');
                    }
                    const calculatedHours = calculateHoursFromTimes(startTime, endTime);
                    if (!Number.isFinite(calculatedHours) || calculatedHours <= 0) {
                        throw new Error('Manual entries with a class or activity require a valid time range where end time is after start time.');
                    }
                    requestedHours = calculatedHours;
                } else {
                    startTime = '';
                    endTime = '';
                }
                if (!Number.isFinite(requestedHours) || requestedHours <= 0) {
                    throw new Error('Manual entry hours must be greater than 0.');
                }
                if (requestedHours > maxSessionHours) {
                    throw new Error(`A single manual entry cannot exceed ${maxSessionHours} hours.`);
                }

                const activityName = String(activityRow?.title || activityRow?.name || entry.activityName || '').trim();
                const activityPaid = activityRow ? activityRow.paid === true : entry.activityPaid === true;
                const manualApproval = normalizeManualApprovalStatus(entry.approvalStatus);
                const approvalStatus = activityId
                    ? (activityPaid ? (manualApproval || 'pending_approval') : 'unpaid')
                    : (manualApproval || 'approved');
                const excludeFromTotals = entry.excludeFromTotals === true || approvalStatus === 'pending_approval';
                const payableHours = excludeFromTotals ? 0 : requestedHours;

                const classNameRaw = String(entry.className || '').trim();
                const description = String(entry.description || '').trim();
                const resolvedClassName = classNameRaw || description || activityName || 'Manual Activity';
                const requestedRole = timesheetPayrollContextService.normalizePayrollRole(entry.personRole);
                if (payrollContext.roles.length > 1 && !requestedRole) {
                    throw new Error('Manual entries require a payroll role when the person has multiple teacher/staff roles.');
                }
                if (requestedRole && !payrollContext.roles.includes(requestedRole)) {
                    throw new Error('Selected payroll role is not valid for this person.');
                }

                const normalizedManual = {
                    ...entry,
                    sessionId,
                    date: dateValue,
                    classId: classId || null,
                    className: resolvedClassName,
                    hours: Number(payableHours.toFixed(2)),
                    timesheetHours: Number(payableHours.toFixed(2)),
                    durationHours: Number(requestedHours.toFixed(2)),
                    requestedHours: Number(requestedHours.toFixed(2)),
                    startTime: startTime || '',
                    endTime: endTime || '',
                    status: approvalStatus === 'pending_approval'
                        ? 'pending_approval'
                        : (String(entry.status || 'manual').trim().toLowerCase() || 'manual'),
                    comment: String(entry.comment || '').trim(),
                    isManual: true,
                    activityId: activityId || '',
                    activityName,
                    activityPaid: activityId ? activityPaid : (entry.activityPaid === true),
                    approvalStatus,
                    excludeFromTotals,
                    deliveryDepartmentId: String(entry.deliveryDepartmentId || activityRow?.departmentId || '').trim(),
                    deliveryDepartmentName: String(entry.deliveryDepartmentName || activityRow?.departmentName || '').trim(),
                    categoryName: String(entry.categoryName || activityRow?.categoryName || '').trim(),
                    description,
                    personRole: requestedRole || payrollContext.defaultRole || 'teacher'
                };
                if (!activityId) {
                    normalizedManual.activityPaid = false;
                }
                return normalizedManual;
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

            if (entry.isSchoolActivity === true || sessionId.startsWith('act-')) {
                const activityRef = activityLiveById.get(sessionId);
                if (!activityRef) {
                    return {
                        sessionId,
                        isDeleted: true,
                        ignoredReason: 'ineligible_or_missing_activity_session'
                    };
                }
                const hours = Number(parseFloat(entry.hours ?? entry.timesheetHours ?? entry.durationHours ?? activityRef.timesheetHours) || 0);
                return {
                    ...entry,
                    sessionId,
                    classId: entry.classId || null,
                    className: String(entry.className || activityRef.className || ''),
                    activityId: String(entry.activityId || activityRef.activityId || ''),
                    activityEntryId: String(entry.activityEntryId || activityRef.activityEntryId || ''),
                    deliveryDepartmentId: String(entry.deliveryDepartmentId || activityRef.deliveryDepartmentId || activityRef.departmentId || ''),
                    deliveryDepartmentName: String(entry.deliveryDepartmentName || activityRef.deliveryDepartmentName || activityRef.departmentName || ''),
                    status: String(entry.status || activityRef.status || 'activity'),
                    hours,
                    timesheetHours: hours,
                    durationHours: hours,
                    isFinalStatus: true,
                    isSchoolActivity: true,
                    compensationLookup: entry.compensationLookup || activityRef.compensationLookup
                };
            }

            const sessionRef = liveSessionById.get(sessionId);
            if (!sessionRef) {
                return {
                    sessionId,
                    isDeleted: true,
                    ignoredReason: 'non_final_or_missing_session'
                };
            }

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

        const payrollStampedEntries = normalizedEntries.map((entry) => {
            if (!entry || entry.isDeleted === true) return entry;
            return withPayrollStamp(entry, payrollContext, period);
        });

        const manualRows = payrollStampedEntries.filter((entry) => entry && entry.isDeleted !== true && entry.isManual === true);
        if (manualRows.length || payrollStampedEntries.some((entry) => entry?.startTime && entry?.endTime)) {
            const conflicts = await runTimesheetConflictValidation({
                activeOrgId,
                personId: teacherContext.targetTeacherId,
                period,
                candidateEntries: manualRows,
                draftEntries: manualRows,
                timesheetEntries: payrollStampedEntries.filter((entry) => entry && entry.isDeleted !== true),
                reqUser: req.user
            });
            if (Array.isArray(conflicts) && conflicts.length) {
                throwTimesheetConflictError(conflicts);
            }
        }

        if (nextStatus === 'submitted') {
            const hasNonFinalAutoSession = payrollStampedEntries.some((entry) => {
                if (!entry || entry.isDeleted || entry.isManual) return false;
                if (entry.isPriorPeriodAdjustment === true) return false;
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
            entries: payrollStampedEntries,
            totalHours: parseFloat(totalHours) || 0
        };

        if (nextStatus === 'submitted') {
            payload.submissionSnapshot = buildSubmissionSnapshot({
                normalizedEntries: payrollStampedEntries,
                period,
                existingTimesheet: existing
            });
        }

        if (existing?.priorPeriodAdjustmentsAppliedFrom) {
            payload.priorPeriodAdjustmentsAppliedFrom = existing.priorPeriodAdjustmentsAppliedFrom;
        }

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
        if (error?.status === 'warning') {
            return res.status(409).json({
                status: 'warning',
                code: String(error?.code || 'TIMESHEET_WARNING'),
                message: error.message,
                data: {
                    conflicts: Array.isArray(error?.conflicts) ? error.conflicts : []
                }
            });
        }
        res.status(400).json({ status: 'error', message: error.message });
    }
};

exports.getPriorAdjustments = async (req, res) => {
    try {
        const { periodId } = req.params;
        const activeOrgId = getActiveOrgIdOrThrow(req.user);

        const period = await dataService.getDataById('timesheetPeriods', periodId, req.user);
        if (!period) throw new Error('Period not found.');
        assertPeriodOrgAccess(period, activeOrgId, req.user);

        const teacherContext = await resolveTargetTeacherContext(req, { requireTeacher: true, operationId: OPERATIONS.READ_ALL });
        const existing = await dataService.getTimesheetByPeriodAndTeacher(periodId, teacherContext.targetTeacherId, req.user);

        const prior = await priorPeriodAdjustmentService.findPriorSubmittedTimesheet({
            teacherId: teacherContext.targetTeacherId,
            currentPeriod: period,
            activeOrgId,
            reqUser: req.user
        });

        if (!prior) {
            return res.json({
                status: 'success',
                hasPriorPeriod: false,
                needsReview: false,
                adjustments: [],
                alreadyApplied: false
            });
        }

        const alreadyApplied = Boolean(
            existing?.priorPeriodAdjustmentsAppliedFrom &&
            idsEqual(existing.priorPeriodAdjustmentsAppliedFrom, prior.priorPeriod.id)
        );

        const snapshotEntries = priorPeriodAdjustmentService.resolveSnapshotEntries(prior.priorTimesheet);
        const priorReviewSummary = {
            entryCount: snapshotEntries.length,
            totalSnapshotHours: Number(snapshotEntries.reduce((sum, entry) => sum + (Number(entry?.hours) || 0), 0).toFixed(2)),
            submittedAt: String(prior.priorTimesheet?.submissionSnapshot?.submittedAt || prior.priorTimesheet?.audit?.lastUpdateDateTime || '')
        };

        let adjustments = [];
        if (!alreadyApplied) {
            adjustments = await priorPeriodAdjustmentService.detectAdjustments({
                priorTimesheet: prior.priorTimesheet,
                priorPeriod: prior.priorPeriod,
                currentPeriod: period,
                teacherId: teacherContext.targetTeacherId,
                activeOrgId,
                reqUser: req.user
            });
        }

        const existingAdjIds = new Set(
            (Array.isArray(existing?.entries) ? existing.entries : [])
                .filter((entry) => entry?.isPriorPeriodAdjustment === true)
                .map((entry) => String(entry?.sessionId || '').trim())
                .filter(Boolean)
        );
        const pendingAdjustments = adjustments.filter(
            (adj) => !existingAdjIds.has(String(adj.adjustmentSessionId || '').trim())
        );

        const needsReview = !alreadyApplied;

        return res.json({
            status: 'success',
            hasPriorPeriod: true,
            needsReview,
            priorPeriod: {
                id: String(prior.priorPeriod.id || ''),
                name: String(prior.priorPeriod.name || ''),
                startDate: String(prior.priorPeriod.startDate || ''),
                endDate: String(prior.priorPeriod.endDate || '')
            },
            priorReviewSummary,
            adjustments: pendingAdjustments,
            alreadyApplied
        });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
};

exports.applyPriorAdjustments = async (req, res) => {
    let guardKey = '';
    try {
        const { periodId } = req.params;
        const activeOrgId = getActiveOrgIdOrThrow(req.user);

        const teacherContext = await resolveTargetTeacherContext(req, { requireTeacher: true, operationId: OPERATIONS.UPDATE });
        guardKey = idempotencyGuardService.createGuardKey([
            'timesheet_apply_prior_adjustments',
            String(activeOrgId || '').trim(),
            String(periodId || '').trim(),
            String(teacherContext?.targetTeacherId || '').trim()
        ]);
        const guardResult = idempotencyGuardService.beginGuard({
            key: guardKey,
            runningTtlMs: 120000,
            replayTtlMs: 15000
        });
        if (sendGuardedResponse(req, res, guardResult, 'Prior-period adjustment apply is already in progress. Please wait.')) return;

        const period = await dataService.getDataById('timesheetPeriods', periodId, req.user);
        if (!period) throw new Error('Period not found.');
        assertPeriodOrgAccess(period, activeOrgId, req.user);

        if (period.status === 'processed') {
            throw new Error('<b>Security Error</b><br>This period has been processed by payroll and is locked.');
        }

        const existing = await dataService.getTimesheetByPeriodAndTeacher(periodId, teacherContext.targetTeacherId, req.user);
        if (existing && existing.status === 'submitted') {
            throw new Error('Cannot apply prior-period adjustments to a submitted timesheet.');
        }

        const prior = await priorPeriodAdjustmentService.findPriorSubmittedTimesheet({
            teacherId: teacherContext.targetTeacherId,
            currentPeriod: period,
            activeOrgId,
            reqUser: req.user
        });
        if (!prior) throw new Error('No prior submitted timesheet found for adjustment.');

        if (
            existing?.priorPeriodAdjustmentsAppliedFrom &&
            idsEqual(existing.priorPeriodAdjustmentsAppliedFrom, prior.priorPeriod.id)
        ) {
            const payloadOut = {
                status: 'success',
                message: 'Prior-period adjustments were already applied.',
                entries: existing.entries || []
            };
            idempotencyGuardService.completeGuard(guardKey, payloadOut);
            return res.json(payloadOut);
        }

        const adjustments = await priorPeriodAdjustmentService.detectAdjustments({
            priorTimesheet: prior.priorTimesheet,
            priorPeriod: prior.priorPeriod,
            currentPeriod: period,
            teacherId: teacherContext.targetTeacherId,
            activeOrgId,
            reqUser: req.user
        });

        const existingAdjIds = new Set(
            (Array.isArray(existing?.entries) ? existing.entries : [])
                .filter((entry) => entry?.isPriorPeriodAdjustment === true)
                .map((entry) => String(entry?.sessionId || '').trim())
                .filter(Boolean)
        );
        const pendingAdjustments = adjustments.filter(
            (adj) => !existingAdjIds.has(String(adj.adjustmentSessionId || '').trim())
        );

        let mergedEntries = Array.isArray(existing?.entries) ? [...existing.entries] : [];
        if (pendingAdjustments.length > 0) {
            const adjustmentEntries = priorPeriodAdjustmentService.buildAdjustmentEntries({
                adjustments: pendingAdjustments,
                applyDate: period.startDate
            });
            mergedEntries = priorPeriodAdjustmentService.mergeAdjustmentEntries(mergedEntries, adjustmentEntries);
        }

        const totalHours = mergedEntries.reduce((sum, entry) => {
            if (!entry || entry.isDeleted) return sum;
            return sum + (Number(entry.hours) || 0);
        }, 0);

        const payload = {
            orgId: existing?.orgId || period.orgId || activeOrgId,
            periodId: String(periodId),
            teacherId: String(teacherContext.targetTeacherId),
            status: 'draft',
            entries: mergedEntries,
            totalHours: Number(totalHours.toFixed(2)),
            priorPeriodAdjustmentsAppliedFrom: String(prior.priorPeriod.id)
        };

        let saved;
        if (existing?.id) {
            saved = await dataService.updateData('timesheets', existing.id, payload, req.user);
        } else {
            saved = await dataService.addData('timesheets', payload, req.user);
        }

        const appliedCount = pendingAdjustments.length;
        const payloadOut = {
            status: 'success',
            message: appliedCount > 0
                ? `Applied ${appliedCount} prior-period adjustment(s).`
                : 'Prior-period review completed. No adjustments were required.',
            entries: saved?.entries || mergedEntries,
            actionStateId: req.actionStateId || null
        };
        idempotencyGuardService.completeGuard(guardKey, payloadOut);
        return res.json(payloadOut);
    } catch (error) {
        if (guardKey) idempotencyGuardService.failGuard(guardKey);
        return res.status(400).json({ status: 'error', message: error.message });
    }
};

exports.listManualEntryClasses = async (req, res) => {
    try {
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        const classes = await dataService.fetchData('classes', {}, req.user);
        const results = (Array.isArray(classes) ? classes : [])
            .filter((row) => idsEqual(row?.orgId, activeOrgId))
            .filter((row) => isActiveClassForManualEntry(row))
            .filter((row) => !isInactiveSchoolRecord(row))
            .map((row) => ({
                id: String(row?.id || '').trim(),
                title: String(row?.title || row?.name || row?.id || '').trim(),
                name: String(row?.title || row?.name || row?.id || '').trim(),
                status: String(row?.status || '').trim()
            }))
            .filter((row) => row.id)
            .sort((a, b) => String(a.title).localeCompare(String(b.title)));
        return res.json({ status: 'success', results, data: results, items: results, total: results.length });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
};

exports.validateManualTimesheetRow = async (req, res) => {
    try {
        const { periodId } = req.params;
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        const teacherContext = await resolveTargetTeacherContext(req, { requireTeacher: true, operationId: OPERATIONS.UPDATE });
        const period = await dataService.getDataById('timesheetPeriods', periodId, req.user);
        if (!period) throw new Error('Period not found.');
        assertPeriodOrgAccess(period, activeOrgId, req.user);

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const proposed = body.proposed || body.row || body;
        const draftEntries = Array.isArray(body.draftEntries) ? body.draftEntries : [];
        const timesheetEntries = Array.isArray(body.timesheetEntries) ? body.timesheetEntries : draftEntries;
        const ignoreSessionId = String(body.editSessionId || proposed?.editSessionId || '').trim();

        if (String(proposed?.activityId || '').trim()) {
            const activityRow = await activityService.getActivity(proposed.activityId, req.user);
            if (!activityRow || !activityService.isPersonEligibleForActivity(activityRow, teacherContext.targetTeacherId)) {
                throw new Error('You are not eligible for the selected activity.');
            }
        }
        if (String(proposed?.classId || '').trim()) {
            const classRow = await dataService.getDataById('classes', proposed.classId, req.user);
            if (!classRow || !isActiveClassForManualEntry(classRow) || isInactiveSchoolRecord(classRow)) {
                throw new Error('Selected class is not active or is no longer available.');
            }
        }

        const conflicts = await runTimesheetConflictValidation({
            activeOrgId,
            personId: teacherContext.targetTeacherId,
            period,
            candidateEntries: [{ ...proposed, isManual: true }],
            draftEntries,
            timesheetEntries,
            ignoreSessionId,
            reqUser: req.user
        });
        if (conflicts.length) {
            return res.status(409).json({
                status: 'warning',
                code: 'MANUAL_ENTRY_SCHEDULE_CONFLICT',
                message: 'Selected date/time conflicts with your schedule or another timesheet row.',
                conflicts
            });
        }
        return res.json({ status: 'success', conflicts: [] });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
};

exports.approveTimesheet = async (req, res) => {
    let guardKey = '';
    try {
        const { periodId } = req.params;
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        const teacherContext = await resolveTargetTeacherContext(req, { requireTeacher: true, operationId: OPERATIONS.UPDATE });
        if (!teacherContext.isAdmin) {
            throw new Error('Only administrators can approve timesheets.');
        }
        guardKey = idempotencyGuardService.createGuardKey([
            'timesheet_approve',
            String(activeOrgId || '').trim(),
            String(periodId || '').trim(),
            String(teacherContext?.targetTeacherId || '').trim()
        ]);
        const guardResult = idempotencyGuardService.beginGuard({ key: guardKey, runningTtlMs: 120000, replayTtlMs: 15000 });
        if (sendGuardedResponse(req, res, guardResult, 'Timesheet approval is already in progress. Please wait.')) return;

        const period = await dataService.getDataById('timesheetPeriods', periodId, req.user);
        if (!period) throw new Error('Period not found.');
        assertPeriodOrgAccess(period, activeOrgId, req.user);
        const existing = await dataService.getTimesheetByPeriodAndTeacher(periodId, teacherContext.targetTeacherId, req.user);
        if (!existing) throw new Error('Timesheet not found.');
        if (String(existing.status || '').toLowerCase() !== 'submitted') {
            throw new Error('Only submitted timesheets can be approved.');
        }
        if (!existing.submissionSnapshot?.submittedAt) {
            throw new Error('Submission snapshot is missing. Ask the teacher to resubmit the timesheet.');
        }

        const materialized = await timesheetManualMaterializationService.materializeApprovedTimesheetManualEntries({
            timesheet: existing,
            period,
            reqUser: req.user
        });
        const timesheetForLock = materialized?.timesheet || existing;

        const lockSummary = await schoolDependencyService.lockSourcesForApprovedTimesheet(timesheetForLock, req.user);
        const payload = {
            ...timesheetForLock,
            orgId: timesheetForLock.orgId || period.orgId || activeOrgId,
            status: 'approved',
            approvedAt: new Date().toISOString(),
            approvedBy: String(req.user?.id || req.user?.username || '').trim(),
            lockedSourceRefs: lockSummary.lockedSourceRefs || [],
            materializationSummary: materialized?.summary || null
        };
        await dataService.updateData('timesheets', existing.id, payload, req.user);
        const payloadOut = { status: 'success', message: 'Timesheet approved and linked sessions/activities were locked.', lockSummary, materializationSummary: materialized?.summary || null };
        idempotencyGuardService.completeGuard(guardKey, payloadOut);
        return res.json(payloadOut);
    } catch (error) {
        if (guardKey) idempotencyGuardService.failGuard(guardKey);
        return res.status(400).json({ status: 'error', message: error.message });
    }
};

exports.reopenTimesheet = async (req, res) => {
    let guardKey = '';
    try {
        const { periodId } = req.params;
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        const teacherContext = await resolveTargetTeacherContext(req, { requireTeacher: true, operationId: OPERATIONS.UPDATE });
        if (!teacherContext.isAdmin) {
            throw new Error('Only administrators can reopen approved timesheets.');
        }
        guardKey = idempotencyGuardService.createGuardKey([
            'timesheet_reopen',
            String(activeOrgId || '').trim(),
            String(periodId || '').trim(),
            String(teacherContext?.targetTeacherId || '').trim()
        ]);
        const guardResult = idempotencyGuardService.beginGuard({ key: guardKey, runningTtlMs: 120000, replayTtlMs: 15000 });
        if (sendGuardedResponse(req, res, guardResult, 'Timesheet reopen is already in progress. Please wait.')) return;

        const period = await dataService.getDataById('timesheetPeriods', periodId, req.user);
        if (!period) throw new Error('Period not found.');
        assertPeriodOrgAccess(period, activeOrgId, req.user);
        const existing = await dataService.getTimesheetByPeriodAndTeacher(periodId, teacherContext.targetTeacherId, req.user);
        if (!existing) throw new Error('Timesheet not found.');
        const status = String(existing.status || '').toLowerCase();
        if (!['approved', 'processed'].includes(status)) {
            throw new Error('Only approved or processed timesheets can be reopened.');
        }

        await timesheetManualMaterializationService.revertMaterializedRecordsForTimesheet({
            timesheetId: existing.id,
            reqUser: req.user
        });
        await schoolDependencyService.unlockSourcesForTimesheet(existing, req.user);
        const payload = {
            ...existing,
            status: 'submitted',
            reopenedAt: new Date().toISOString(),
            reopenedBy: String(req.user?.id || req.user?.username || '').trim(),
            lockedSourceRefs: []
        };
        delete payload.approvedAt;
        delete payload.approvedBy;
        await dataService.updateData('timesheets', existing.id, payload, req.user);
        const payloadOut = { status: 'success', message: 'Timesheet reopened to submitted status and source locks were released.' };
        idempotencyGuardService.completeGuard(guardKey, payloadOut);
        return res.json(payloadOut);
    } catch (error) {
        if (guardKey) idempotencyGuardService.failGuard(guardKey);
        return res.status(400).json({ status: 'error', message: error.message });
    }
};

