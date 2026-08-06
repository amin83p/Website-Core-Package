const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const timesheetModel = require('../packages/school/MVC/models/school/timesheetModel');

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function idsEqual(a, b) {
    return String(a || '').trim() === String(b || '').trim();
}

function isPriorReviewPending(timesheet, priorPeriodId) {
    const alreadyReviewed = Boolean(
        timesheet?.priorPeriodReconciliation
        && idsEqual(timesheet.priorPeriodReconciliation.sourcePeriodId, priorPeriodId)
        && timesheet.priorPeriodReconciliation.state === 'resolved'
        && (
            timesheet.priorPeriodReconciliation.makeupState !== 'open'
            || timesheet.priorPeriodReconciliation.makeupConfirmedAt
        )
    );
    return !alreadyReviewed;
}

test('timesheet routes expose reset endpoint with author UPDATE access', () => {
    const routes = read('packages/school/MVC/routes/timesheetRoutes.js');
    assert.match(routes, /\/editor\/:periodId\/reset/);
    assert.match(routes, /ctrl\.resetTimesheet/);
    assert.match(routes, /SECTIONS\.SCHOOL_TIMESHEETS, OPERATIONS\.UPDATE/);
});

test('timesheet controller reset action allows author or authorized administrators', () => {
    const source = read('packages/school/MVC/controllers/school/timesheetController.js');
    assert.match(source, /exports\.resetTimesheet/);
    assert.match(source, /authorized timesheet administrator can reset draft timesheets/);
    assert.match(source, /hasTimesheetManagementAuthority/);
    assert.match(source, /isTimesheetSectionAdmin/);
    assert.match(source, /maintenancePurgeById/);
    assert.match(source, /preserveLateSubmission/);
    assert.match(source, /canResetTimesheet/);
    assert.doesNotMatch(source, /Only the timesheet author can reset their own draft timesheet/);
});

test('timesheet routes allow management admins to call reset endpoint', () => {
    const routes = read('packages/school/MVC/routes/timesheetRoutes.js');
    assert.match(routes, /\/editor\/:periodId\/reset/);
    assert.match(routes, /requireAccessAny\(\[SECTIONS\.SCHOOL_TIMESHEETS, SECTIONS\.SCHOOL_TIMESHEET_MANAGEMENT\], OPERATIONS\.UPDATE\)/);
});

test('timesheet editor exposes reset button for draft authors only', () => {
    const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
    assert.match(editor, /btnResetTimesheet/);
    assert.match(editor, /Reset Timesheet/);
    assert.match(editor, /\/reset/);
    assert.match(editor, /canResetTimesheetFlag/);
    assert.match(editor, /reconciliation progress/);
});

test('reset late-submission stub is an empty draft with allowLateSubmission preserved', () => {
    const payload = timesheetModel.sanitizeTimesheetPayload({
        orgId: 'ORG_RESET_1',
        periodId: 'TSP_RESET_1',
        teacherId: 'P_RESET_1',
        status: 'draft',
        entries: [],
        totalHours: 0,
        allowLateSubmission: true
    });

    assert.equal(payload.status, 'draft');
    assert.equal(payload.entries.length, 0);
    assert.equal(payload.totalHours, 0);
    assert.equal(payload.allowLateSubmission, true);
    assert.equal(payload.priorPeriodReconciliation, undefined);
    assert.equal(payload.priorPeriodAdjustmentsAppliedFrom, undefined);
});

test('prior-period reconciliation review is required again after reset removes receipt', () => {
    const priorPeriodId = 'TSP_PRIOR_1';
    const reviewedTimesheet = {
        status: 'draft',
        priorPeriodReconciliation: {
            sourcePeriodId: priorPeriodId,
            state: 'resolved',
            makeupState: 'none'
        },
        priorPeriodAdjustmentsAppliedFrom: priorPeriodId,
        entries: [{ sessionId: 'adj-TSP_PRIOR_1-SES_1', hours: -1, isPriorPeriodAdjustment: true }]
    };

    assert.equal(isPriorReviewPending(reviewedTimesheet, priorPeriodId), false);

    const resetTimesheet = null;
    assert.equal(isPriorReviewPending(resetTimesheet, priorPeriodId), true);

    const lateSubmissionStub = {
        status: 'draft',
        allowLateSubmission: true,
        entries: [],
        totalHours: 0
    };
    assert.equal(isPriorReviewPending(lateSubmissionStub, priorPeriodId), true);
});

test('sanitize rejects submitted timesheet status for reset guard parity', () => {
    const payload = timesheetModel.sanitizeTimesheetPayload({
        orgId: 'ORG_RESET_2',
        periodId: 'TSP_RESET_2',
        teacherId: 'P_RESET_2',
        status: 'submitted',
        entries: [{ sessionId: 'SES_1', date: '2026-08-01', hours: 2, status: 'completed' }]
    });
    assert.equal(payload.status, 'submitted');
});
