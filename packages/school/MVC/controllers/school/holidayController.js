// MVC/controllers/school/holidayController.js
const schoolDataService = require('../../services/school/schoolDataService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
 // ✅ Replaced model with service
const { isAjax, buildDataServiceQuery, inferSearchableFields } = requireCoreModule('MVC/utils/generalTools');
const settingService = requireCoreModule('MVC/services/settingService'); 
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');

function getActiveOrgIdOrThrow(reqUser) {
    const activeOrgId = reqUser?.activeOrgId ? String(reqUser.activeOrgId) : '';
    if (!activeOrgId) throw new Error('<b>Security Violation</b><br>No active organization context found.');
    return activeOrgId;
}

function assertHolidayOrgAccess(holiday, activeOrgId, reqUser) {
    if (!holiday) return;
    if (adminChekersService.isSuperAdmin(reqUser)) return;
    if (holiday.orgId && !idsEqual(holiday.orgId, activeOrgId)) {
        throw new Error('<b>Security Violation</b><br>Unauthorized organization access.');
    }
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

async function listHolidays(req, res) {
    try {
        const query = await buildDataServiceQuery(req.query, { allowedExactKeys: null });
        const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
        if(query.q === searchDefaultKeyword) query.q='';

        // Extract the UI year filter for post-load filtering.
        // Keep repository queries backend-safe by not sending year as a direct DB filter.
        const requestedYear = String(query.year || '').trim();
        const targetYear = /^\d{4}$/.test(requestedYear) ? requestedYear : new Date().getFullYear().toString();
        const dataQuery = { ...query };
        if (Object.prototype.hasOwnProperty.call(dataQuery, 'year')) delete dataQuery.year;

        // Fetch using the Data Service
        const allHolidays = await schoolDataService.fetchData('holidays', dataQuery, req.user);
        
        const searchableFields = await inferSearchableFields(allHolidays, { exclude: ['audit', 'attachments'] });
        
        // Filter by year if requested, default to current year
        const filteredHolidays = allHolidays.filter(h => h.date && h.date.startsWith(targetYear));

        const { data, pagination } = paginate(filteredHolidays, query.page, query.limit);

        if (isAjax(req)) {
            return res.json({ status: 'success', results: data, pagination });
        }

        res.render('school/holiday/holidays', {
            title: 'School Holidays & Off Days',
            data,
            yearHolidayData: filteredHolidays,
            searchableFields,
            currentYear: targetYear,
            tableName: 'Holidays_Management',
            includeModal: true,
            includeModal_Table: true,
            includeModal_FileImport: true,
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
}

async function saveHoliday(req, res) {
    let guardKey = '';
    try {
        const { id, date, title, type, notes } = req.body;
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        guardKey = idempotencyGuardService.createGuardKey([
            'holiday_save',
            String(activeOrgId || '').trim(),
            String(id || '').trim(),
            { date, title, type, notes }
        ]);
        const guardResult = idempotencyGuardService.beginGuard({
            key: guardKey,
            runningTtlMs: 60000,
            replayTtlMs: 10000
        });
        if (sendGuardedResponse(req, res, guardResult, 'Holiday save is already in progress. Please wait.')) return;
        
        if (!date || !title) throw new Error("Date and Title are required.");

        if (id) {
            const existing = await schoolDataService.getDataById('holidays', id, req.user);
            if (!existing) throw new Error('Holiday not found.');
            assertHolidayOrgAccess(existing, activeOrgId, req.user);

            // Update via Data Service
            await schoolDataService.updateData('holidays', id, {
                orgId: existing?.orgId || activeOrgId,
                date,
                title,
                type,
                notes
            }, req.user);
            const payloadOut = { status: 'success', message: 'Holiday updated successfully.' };
            idempotencyGuardService.completeGuard(guardKey, payloadOut);
            return res.json(payloadOut);
        } else {
            // Add via Data Service
            await schoolDataService.addData('holidays', { orgId: activeOrgId, date, title, type, notes }, req.user);
            const payloadOut = { status: 'success', message: 'Holiday added successfully.' };
            idempotencyGuardService.completeGuard(guardKey, payloadOut);
            return res.json(payloadOut);
        }
    } catch (error) {
        if (guardKey) idempotencyGuardService.failGuard(guardKey);
        res.status(400).json({ status: 'error', message: error.message });
    }
}

async function deleteHoliday(req, res) {
    let guardKey = '';
    try {
        const { id } = req.params;
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        guardKey = idempotencyGuardService.createGuardKey([
            'holiday_delete',
            String(activeOrgId || '').trim(),
            String(id || '').trim()
        ]);
        const guardResult = idempotencyGuardService.beginGuard({
            key: guardKey,
            runningTtlMs: 60000,
            replayTtlMs: 10000
        });
        if (sendGuardedResponse(req, res, guardResult, 'Holiday delete is already in progress. Please wait.')) return;

        const existing = await schoolDataService.getDataById('holidays', id, req.user);
        if (!existing) throw new Error('Holiday not found.');
        assertHolidayOrgAccess(existing, activeOrgId, req.user);

        await schoolDataService.deleteData('holidays', id, req.user);
        const payloadOut = { status: 'success', message: 'Holiday removed successfully.' };
        idempotencyGuardService.completeGuard(guardKey, payloadOut);
        res.json(payloadOut);
    } catch (error) {
        if (guardKey) idempotencyGuardService.failGuard(guardKey);
        res.status(400).json({ status: 'error', message: error.message });
    }
}


async function listHolidaysInRange(req, res) {
    try {
        const { start, end } = req.query;
        if (!start || !end) return res.status(400).json({ status: 'error', message: 'start and end are required (YYYY-MM-DD).' });

        const startD = new Date(start);
        const endD = new Date(end);
        if (isNaN(startD.getTime()) || isNaN(endD.getTime())) {
            return res.status(400).json({ status: 'error', message: 'Invalid date format. Use YYYY-MM-DD.' });
        }

        // pull all holidays then filter in-range
        const allHolidays = await schoolDataService.fetchData('holidays', { q: '' }, req.user);
        const holidays = (allHolidays || []).filter(h => {
            if (!h || !h.date) return false;
            const d = new Date(h.date);
            if (isNaN(d.getTime())) return false;
            return d >= startD && d <= endD;
        });

        return res.json({ status: 'success', holidays });
    } catch (error) {
        return res.status(500).json({ status: 'error', message: error.message });
    }
}


module.exports = {
    listHolidays,
    saveHoliday,
    deleteHoliday,
    listHolidaysInRange
};
