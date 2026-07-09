// MVC/controllers/school/timesheetPeriodController.js
const dataService = require('../../services/school/schoolDataService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const settingService = requireCoreModule('MVC/services/settingService');
const { isAjax, buildDataServiceQuery, inferSearchableFields } = requireCoreModule('MVC/utils/generalTools');
const {
    getActiveOrgIdOrThrow: getActiveOrgIdOrThrowShared,
    assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared,
    canCreateOrgScopedItem,
    assertOrgAccess
} = requireCoreModule('MVC/utils/orgContextUtils');

function getActiveOrgIdOrThrow(reqUser) {
    return getActiveOrgIdOrThrowShared(reqUser);
}

async function assertCreateOrgContextOrThrow(reqUser) {
    return assertCreateOrgContextOrThrowShared(reqUser, { scopeLabel: 'timesheet periods' });
}

function assertTimesheetPeriodOrgAccess(period, activeOrgId, reqUser) {
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
            const redirectTo = String(payload.redirectTo || '').trim();
            if (redirectTo) {
                res.redirect(redirectTo);
            } else {
                res.redirect('/school/timesheetPeriods');
            }
        }
        return true;
    }
    return false;
}

exports.listTimesheetPeriods = async (req, res) => {
    try {
        let query = await buildDataServiceQuery(req.query);
        const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
        if (query.q === searchDefaultKeyword) query = {};
        const canCreateTimesheetPeriods = await canCreateOrgScopedItem(req.user, { scopeLabel: 'timesheet periods' });

        const allPeriods = await dataService.fetchData('timesheetPeriods', query, req.user);
        const searchableFields = await inferSearchableFields(allPeriods, { exclude: ['audit'] });
        const { data, pagination } = paginate(allPeriods, query);

        if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

        res.render('school/timesheetPeriod/timesheetPeriodList', {
            title: 'Timesheet Periods',
            tableName: 'Timesheet_Periods_Management',
            data,
            searchableFields,
            newUrl: 'school/timesheetPeriods',
            newLabel: canCreateTimesheetPeriods ? 'New Period' : null,
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

exports.showCreateForm = async (req, res) => {
    try {
        await assertCreateOrgContextOrThrow(req.user);
        res.render('school/timesheetPeriod/timesheetPeriodForm', {
            title: 'New Timesheet Period',
            period: {},
            includeModal: true,
            user: req.user,
            actionStateId: req.actionStateId
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
};

exports.showEditForm = async (req, res) => {
    try {
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        const period = await dataService.getDataById('timesheetPeriods', req.params.id, req.user);
        if (!period) throw new Error('Timesheet Period not found.');
        assertTimesheetPeriodOrgAccess(period, activeOrgId, req.user);

        res.render('school/timesheetPeriod/timesheetPeriodForm', {
            title: `Edit Period: ${period.name}`,
            period,
            includeModal: true,
            user: req.user,
            actionStateId: req.actionStateId
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
};

exports.saveTimesheetPeriod = async (req, res) => {
    let guardKey = '';
    try {
        const { id } = req.params;
        const activeOrgId = id
            ? getActiveOrgIdOrThrow(req.user)
            : await assertCreateOrgContextOrThrow(req.user);
        guardKey = idempotencyGuardService.createGuardKey([
            'timesheet_period_save',
            String(activeOrgId || '').trim(),
            String(id || '').trim(),
            req.body || {}
        ]);
        const guardResult = idempotencyGuardService.beginGuard({
            key: guardKey,
            runningTtlMs: 90000,
            replayTtlMs: 12000
        });
        if (sendGuardedResponse(req, res, guardResult, 'Timesheet period save is already in progress. Please wait.')) return;

        let existingPeriod = null;
        if (id) {
            existingPeriod = await dataService.getDataById('timesheetPeriods', id, req.user);
            if (!existingPeriod) throw new Error('Timesheet Period not found.');
            assertTimesheetPeriodOrgAccess(existingPeriod, activeOrgId, req.user);
        }

        const payload = {
            orgId: existingPeriod?.orgId || activeOrgId,
            name: String(req.body.name || '').trim(),
            startDate: req.body.startDate,
            endDate: req.body.endDate,
            submissionDeadline: req.body.submissionDeadline,
            submissionDeadlineTime: req.body.submissionDeadlineTime || '23:59',
            status: req.body.status || 'open',
            notes: String(req.body.notes || '').trim()
        };

        if (!payload.name || !payload.startDate || !payload.endDate || !payload.submissionDeadline) {
            throw new Error('Name, Start Date, End Date, and Deadline are required.');
        }
        if (new Date(payload.startDate) > new Date(payload.endDate)) {
            throw new Error('Start Date cannot be after End Date.');
        }

        if (id) {
            await dataService.updateData('timesheetPeriods', id, payload, req.user);
        } else {
            await dataService.addData('timesheetPeriods', payload, req.user);
        }

        const payloadOut = {
            status: 'success',
            message: 'Timesheet Period saved successfully.',
            redirectTo: '/school/timesheetPeriods'
        };
        idempotencyGuardService.completeGuard(guardKey, payloadOut);
        if (isAjax(req)) {
            return res.json(payloadOut);
        }
        res.redirect('/school/timesheetPeriods');
    } catch (error) {
        if (guardKey) idempotencyGuardService.failGuard(guardKey);
        if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
        res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
};

exports.deleteTimesheetPeriod = async (req, res) => {
    let guardKey = '';
    try {
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        guardKey = idempotencyGuardService.createGuardKey([
            'timesheet_period_delete',
            String(activeOrgId || '').trim(),
            String(req.params.id || '').trim()
        ]);
        const guardResult = idempotencyGuardService.beginGuard({
            key: guardKey,
            runningTtlMs: 90000,
            replayTtlMs: 12000
        });
        if (sendGuardedResponse(req, res, guardResult, 'Timesheet period delete is already in progress. Please wait.')) return;

        const existingPeriod = await dataService.getDataById('timesheetPeriods', req.params.id, req.user);
        if (!existingPeriod) throw new Error('Timesheet Period not found.');
        assertTimesheetPeriodOrgAccess(existingPeriod, activeOrgId, req.user);

        await dataService.deleteData('timesheetPeriods', req.params.id, req.user);
        const payloadOut = { status: 'success', message: 'Period deleted successfully.', redirectTo: '/school/timesheetPeriods' };
        idempotencyGuardService.completeGuard(guardKey, payloadOut);
        if (isAjax(req)) return res.json(payloadOut);
        res.redirect('/school/timesheetPeriods');
    } catch (error) {
        if (guardKey) idempotencyGuardService.failGuard(guardKey);
        if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
        res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
};
