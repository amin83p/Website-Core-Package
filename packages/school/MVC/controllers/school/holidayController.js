// MVC/controllers/school/holidayController.js
const schoolDataService = require('../../services/school/schoolDataService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
 // ✅ Replaced model with service
const { isAjax, buildDataServiceQuery, inferSearchableFields } = requireCoreModule('MVC/utils/generalTools');
const settingService = requireCoreModule('MVC/services/settingService'); 
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
const { respondSchoolDeleteError } = require('../../utils/schoolDeleteErrorResponse');
const { resolveOrgYearFromRequest, resolveOrgTodayFromRequest } = requireCoreModule('MVC/utils/timezoneUtils');
const holidayCopyYearService = require('../../services/school/holidayCopyYearService');
const holidayCulturalObservancesAiService = require('../../services/school/holidayCulturalObservancesAiService');
const holidayAiObservanceBatchService = require('../../services/school/holidayAiObservanceBatchService');
const schoolAiUsageLimitService = require('../../services/school/schoolAiUsageLimitService');

function getActiveOrgIdOrThrow(reqUser) {
    const activeOrgId = reqUser?.activeOrgId ? String(reqUser.activeOrgId) : '';
    if (!activeOrgId) throw new Error('<b>Security Violation</b><br>No active organization context found.');
    return activeOrgId;
}

function assertHolidayOrgAccess(holiday, activeOrgId, reqUser) {
    if (!holiday) return;
    if (adminAuthorityService.isSuperAdmin(reqUser)) return;
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

async function resolveHolidayAiObservanceAccess(req) {
    const accessContext = schoolDataService.buildRouteAccessContext(req);
    const orgId = getActiveOrgIdOrThrow(req.user);
    const userId = String(req.user?.id || '').trim();
    return schoolAiUsageLimitService.evaluateServiceAccess({
        orgId,
        userId,
        serviceKey: holidayCulturalObservancesAiService.SERVICE_KEY,
        requestingUser: req.user,
        accessContext,
        noLimitMessage: `Holiday AI observances require an active usage limit for your account under AI Assist → Usage Limits (Holiday Cultural Observances or All services).`
    });
}

async function listHolidays(req, res) {
    try {
        const query = await buildDataServiceQuery(req.query, { allowedExactKeys: null });
        const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
        if(query.q === searchDefaultKeyword) query.q='';

        // Extract the UI year filter for post-load filtering.
        // Keep repository queries backend-safe by not sending year as a direct DB filter.
        const requestedYear = String(query.year || '').trim();
        const targetYear = /^\d{4}$/.test(requestedYear) ? requestedYear : resolveOrgYearFromRequest(req);
        const orgToday = resolveOrgTodayFromRequest(req);
        const selectedYear = Number(targetYear) || Number(resolveOrgYearFromRequest(req));
        const yearOptions = [];
        for (let year = selectedYear - 2; year <= selectedYear + 3; year += 1) {
          yearOptions.push(String(year));
        }
        const dataQuery = { ...query };
        if (Object.prototype.hasOwnProperty.call(dataQuery, 'year')) delete dataQuery.year;

        // Fetch using the Data Service
        const allHolidays = await schoolDataService.fetchAllData('holidays', dataQuery, req.user);
        
        const searchableFields = await inferSearchableFields(allHolidays, { exclude: ['audit', 'attachments'] });
        
        // Filter by year if requested, default to current year
        const filteredHolidays = allHolidays.filter(h => h.date && h.date.startsWith(targetYear));

        const { data, pagination } = paginate(filteredHolidays, query.page, query.limit);
        const holidayYearsWithData = holidayCopyYearService.listDistinctHolidayYears(allHolidays);
        const holidayYearCounts = holidayCopyYearService.countHolidaysByYear(allHolidays);
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        let holidayAiObservanceAccess = { allowed: false, message: '' };
        let holidayAiUndoState = { canUndo: false, batch: null };
        try {
            holidayAiObservanceAccess = await resolveHolidayAiObservanceAccess(req);
            const state = await holidayAiObservanceBatchService.getStateForOrgYear(
                activeOrgId,
                targetYear,
                req.user
            );
            holidayAiUndoState = await holidayAiObservanceBatchService.getUndoReview(state, req.user);
        } catch (_) {
            holidayAiObservanceAccess = { allowed: false, message: 'AI observance access could not be resolved.' };
        }
        const orgTimeZone = String(res.locals?.orgTimeZone || '').trim();

        if (isAjax(req)) {
            return res.json({ status: 'success', results: data, pagination });
        }

        res.render('school/holiday/holidays', {
            title: 'School Holidays & Off Days',
            data,
            yearHolidayData: filteredHolidays,
            holidayYearsWithData,
            holidayYearCounts,
            searchableFields,
            currentYear: targetYear,
            orgToday,
            yearOptions,
            tableName: 'Holidays_Management',
            includeModal: true,
            includeModal_Table: true,
            includeModal_FileImport: true,
            print: true,
            pagination,
            filters: req.query,
            user: req.user,
            actionStateId: req.actionStateId,
            holidayAiObservanceAccess,
            holidayAiUndoState,
            orgTimeZone
        });
    } catch (error) {
        if (isAjax(req)) return res.status(500).json({ status: 'error', error, message: error.message });
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
}

async function saveHoliday(req, res) {
    let guardKey = '';
    try {
        const { id, date, title, type, notes, statutoryHolidayPayable, countsAsSchoolOff } = req.body;
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        guardKey = idempotencyGuardService.createGuardKey([
            'holiday_save',
            String(activeOrgId || '').trim(),
            String(id || '').trim(),
            { date, title, type, notes, statutoryHolidayPayable, countsAsSchoolOff }
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
            const holiday = await schoolDataService.updateData('holidays', id, {
                orgId: existing?.orgId || activeOrgId,
                date,
                title,
                type,
                notes,
                statutoryHolidayPayable: statutoryHolidayPayable === true || statutoryHolidayPayable === 'true',
                countsAsSchoolOff
            }, req.user);
            const payloadOut = { status: 'success', message: 'Holiday updated successfully.', holiday };
            idempotencyGuardService.completeGuard(guardKey, payloadOut);
            return res.json(payloadOut);
        } else {
            // Add via Data Service
            const holiday = await schoolDataService.addData('holidays', {
                orgId: activeOrgId,
                date,
                title,
                type,
                notes,
                statutoryHolidayPayable: statutoryHolidayPayable === true || statutoryHolidayPayable === 'true',
                countsAsSchoolOff
            }, req.user);
            const payloadOut = { status: 'success', message: 'Holiday added successfully.', holiday };
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
        return respondSchoolDeleteError(req, res, error, { user: req.user });
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
        const startToken = String(start).trim();
        const endToken = String(end).trim();
        const holidays = (allHolidays || []).filter(h => {
            if (!h || !h.date) return false;
            const dateToken = String(h.date).trim().slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateToken)) return false;
            return dateToken >= startToken && dateToken <= endToken;
        });

        return res.json({ status: 'success', holidays });
    } catch (error) {
        return res.status(500).json({ status: 'error', message: error.message });
    }
}

async function copyHolidaysFromYear(req, res) {
    let guardKey = '';
    try {
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        const sourceYear = String(req.body?.sourceYear || '').trim();
        const targetYear = String(req.body?.targetYear || req.query?.year || '').trim()
            || resolveOrgYearFromRequest(req);
        const duplicateMode = req.body?.duplicateMode;

        holidayCopyYearService.normalizeDuplicateMode(duplicateMode);

        guardKey = idempotencyGuardService.createGuardKey([
            'holiday_copy_year',
            String(activeOrgId),
            sourceYear,
            targetYear,
            duplicateMode
        ]);
        const guardResult = idempotencyGuardService.beginGuard({
            key: guardKey,
            runningTtlMs: 120000,
            replayTtlMs: 15000
        });
        if (sendGuardedResponse(req, res, guardResult, 'Holiday copy is already in progress. Please wait.')) return;

        const allHolidays = await schoolDataService.fetchAllData('holidays', {}, req.user);
        const summary = await holidayCopyYearService.copyHolidaysFromYear({
            holidays: allHolidays,
            orgId: activeOrgId,
            sourceYear,
            targetYear,
            duplicateMode,
            addFn: (payload) => schoolDataService.addData('holidays', payload, req.user),
            updateFn: (id, payload) => schoolDataService.updateData('holidays', id, payload, req.user)
        });

        const parts = [];
        if (summary.created) parts.push(`${summary.created} created`);
        if (summary.updated) parts.push(`${summary.updated} updated`);
        if (summary.skipped) parts.push(`${summary.skipped} skipped`);
        if (summary.failed) parts.push(`${summary.failed} failed`);
        const detail = parts.length ? parts.join(', ') : 'No holidays were copied';
        const message = summary.failed
            ? `<b>Copy completed with warnings</b><br>${detail}.`
            : `<b>Copy complete</b><br>${detail}.`;

        const payloadOut = {
            status: summary.failed ? 'warning' : 'success',
            message,
            summary: {
                ...summary,
                sourceYear,
                targetYear,
                duplicateMode
            }
        };
        idempotencyGuardService.completeGuard(guardKey, payloadOut);
        const statusCode = summary.failed ? 207 : 200;
        return res.status(statusCode).json(payloadOut);
    } catch (error) {
        if (guardKey) idempotencyGuardService.failGuard(guardKey);
        const statusCode = Number(error?.statusCode) === 409 ? 409 : 400;
        return res.status(statusCode).json({ status: 'error', message: error.message });
    }
}

async function analyzeAiObservances(req, res) {
    try {
        const accessGate = await resolveHolidayAiObservanceAccess(req);
        if (!accessGate.allowed) {
            const status = Number(accessGate.statusCode) || 403;
            return res.status(status).json({
                status: 'error',
                message: accessGate.message || 'AI observances are not available for your account.',
                code: accessGate.code
            });
        }
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        const year = String(req.body?.year || req.query?.year || '').trim();
        const occasions = String(req.body?.occasions || '').trim();
        const regionHint = String(req.body?.regionHint || '').trim();
        const allHolidays = await schoolDataService.fetchAllData('holidays', {}, req.user);
        const orgHolidays = (allHolidays || []).filter((row) => String(row.orgId) === activeOrgId);
        const accessContext = schoolDataService.buildRouteAccessContext(req);
        const result = await holidayCulturalObservancesAiService.analyze({
            year,
            occasions,
            regionHint,
            existingHolidays: orgHolidays,
            requestingUser: req.user,
            accessContext
        });
        return res.json({
            status: 'success',
            ...result
        });
    } catch (error) {
        return res.status(Number(error?.statusCode) || 400).json({ status: 'error', message: error.message });
    }
}

async function applyAiObservances(req, res) {
    let guardKey = '';
    try {
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        const year = String(req.body?.year || '').trim();
        const previewItems = Array.isArray(req.body?.previewItems) ? req.body.previewItems : [];
        guardKey = idempotencyGuardService.createGuardKey([
            'holiday_ai_apply',
            activeOrgId,
            year,
            previewItems.length
        ]);
        const guardResult = idempotencyGuardService.beginGuard({
            key: guardKey,
            runningTtlMs: 120000,
            replayTtlMs: 15000
        });
        if (sendGuardedResponse(req, res, guardResult, 'AI holiday apply is already in progress. Please wait.')) return;

        const summary = await holidayAiObservanceBatchService.applyPreview({
            orgId: activeOrgId,
            year,
            previewItems,
            occasionInput: String(req.body?.occasionInput || '').trim(),
            regionHint: String(req.body?.regionHint || '').trim(),
            traceId: String(req.body?.traceId || '').trim(),
            usageRecordId: String(req.body?.usageRecordId || '').trim(),
            meta: req.body?.meta || {},
            requestingUser: req.user
        });
        const payloadOut = {
            status: 'success',
            message: `Added ${summary.created} cultural observance day(s) to the calendar.`,
            summary
        };
        idempotencyGuardService.completeGuard(guardKey, payloadOut);
        return res.json(payloadOut);
    } catch (error) {
        if (guardKey) idempotencyGuardService.failGuard(guardKey);
        return res.status(400).json({ status: 'error', message: error.message });
    }
}

async function undoLastAiObservances(req, res) {
    let guardKey = '';
    try {
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        const year = String(req.body?.year || req.query?.year || '').trim();
        guardKey = idempotencyGuardService.createGuardKey([
            'holiday_ai_undo',
            activeOrgId,
            year
        ]);
        const guardResult = idempotencyGuardService.beginGuard({
            key: guardKey,
            runningTtlMs: 120000,
            replayTtlMs: 15000
        });
        if (sendGuardedResponse(req, res, guardResult, 'Undo is already in progress. Please wait.')) return;

        const summary = await holidayAiObservanceBatchService.undoLastBatch({
            orgId: activeOrgId,
            year,
            requestingUser: req.user
        });
        const payloadOut = {
            status: 'success',
            message: `Removed ${summary.deleted} holiday row(s) from the last AI import.`,
            summary
        };
        idempotencyGuardService.completeGuard(guardKey, payloadOut);
        return res.json(payloadOut);
    } catch (error) {
        if (guardKey) idempotencyGuardService.failGuard(guardKey);
        return res.status(400).json({ status: 'error', message: error.message });
    }
}

async function getAiObservanceState(req, res) {
    try {
        const activeOrgId = getActiveOrgIdOrThrow(req.user);
        const year = String(req.query?.year || '').trim() || resolveOrgYearFromRequest(req);
        const state = await holidayAiObservanceBatchService.getStateForOrgYear(activeOrgId, year, req.user);
        const undo = await holidayAiObservanceBatchService.getUndoReview(state, req.user);
        return res.json({ status: 'success', year, undo });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
}

module.exports = {
    listHolidays,
    saveHoliday,
    deleteHoliday,
    listHolidaysInRange,
    copyHolidaysFromYear,
    analyzeAiObservances,
    applyAiObservances,
    undoLastAiObservances,
    getAiObservanceState
};
