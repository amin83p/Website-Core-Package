const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const timesheetModel = require('../packages/school/MVC/models/school/timesheetModel');
const priorPeriodAdjustmentService = require('../packages/school/MVC/services/school/timesheetPriorPeriodAdjustmentService');

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('timesheet model stores submission snapshot on sanitize', () => {
    const payload = timesheetModel.sanitizeTimesheetPayload({
        orgId: '900000',
        periodId: 'TSP_1',
        teacherId: 'P_1',
        status: 'submitted',
        entries: [{
            sessionId: 'SES_1',
            date: '2026-05-10',
            className: 'Math 101',
            classId: 'CLS_1',
            hours: 2,
            status: 'completed',
            isManual: false
        }],
        submissionSnapshot: {
            submittedAt: '2026-05-15T12:00:00.000Z',
            sourcePeriodId: 'TSP_1',
            sourcePeriodName: 'May 1-15',
            entries: [{
                sessionId: 'SES_1',
                date: '2026-05-10',
                className: 'Math 101',
                classId: 'CLS_1',
                hours: 2,
                status: 'completed',
                isManual: false
            }]
        }
    });

    assert.equal(payload.status, 'submitted');
    assert.equal(payload.submissionSnapshot.sourcePeriodId, 'TSP_1');
    assert.equal(payload.submissionSnapshot.entries.length, 1);
    assert.equal(payload.submissionSnapshot.entries[0].hours, 2);
});

test('timesheet model allows negative hours for prior-period adjustment entries', () => {
    const entry = timesheetModel.sanitizeTimesheetPayload({
        orgId: '900000',
        periodId: 'TSP_2',
        teacherId: 'P_1',
        status: 'draft',
        entries: [{
            sessionId: 'adj-TSP_1-SES_1',
            date: '2026-06-01',
            className: 'Math 101',
            classId: 'CLS_1',
            hours: -2,
            status: 'adjustment',
            comment: 'Prior period adjustment',
            isManual: true,
            isPriorPeriodAdjustment: true,
            adjustmentMeta: {
                sourcePeriodId: 'TSP_1',
                sourceSessionId: 'SES_1',
                sourceSessionDate: '2026-05-10',
                snapshotHours: 2,
                currentHours: 0,
                deltaHours: -2
            }
        }]
    }).entries[0];

    assert.equal(entry.isPriorPeriodAdjustment, true);
    assert.equal(entry.hours, -2);
    assert.equal(entry.adjustmentMeta.deltaHours, -2);
});

test('resolveSnapshotEntries prefers submissionSnapshot and excludes deleted rows', () => {
    const entries = priorPeriodAdjustmentService.resolveSnapshotEntries({
        submissionSnapshot: {
            submittedAt: '2026-05-15T12:00:00.000Z',
            sourcePeriodId: 'TSP_1',
            entries: [
                { sessionId: 'SES_1', hours: 2, isManual: false },
                { sessionId: 'SES_2', isDeleted: true }
            ]
        },
        entries: [{ sessionId: 'LEGACY', hours: 1, isManual: false }]
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].sessionId, 'SES_1');
});

test('buildAdjustmentSessionId is stable', () => {
    const id = priorPeriodAdjustmentService.buildAdjustmentSessionId('TSP_1', 'SES_1');
    assert.equal(id, 'adj-TSP_1-SES_1');
});

test('buildAdjustmentEntries creates locked manual rows on apply date', () => {
    const rows = priorPeriodAdjustmentService.buildAdjustmentEntries({
        applyDate: '2026-06-01',
        adjustments: [{
            adjustmentSessionId: 'adj-TSP_1-SES_1',
            sourcePeriodId: 'TSP_1',
            sourceSessionId: 'SES_1',
            sourceSessionDate: '2026-05-10',
            classId: 'CLS_1',
            className: 'Math 101',
            snapshotHours: 2,
            currentHours: 0,
            deltaHours: -2,
            comment: 'Cancelled after payment'
        }]
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].date, '2026-06-01');
    assert.equal(rows[0].hours, -2);
    assert.equal(rows[0].isPriorPeriodAdjustment, true);
    assert.equal(rows[0].isManual, true);
});

test('mergeAdjustmentEntries replaces prior adjustment rows by session id', () => {
    const merged = priorPeriodAdjustmentService.mergeAdjustmentEntries(
        [
            { sessionId: 'adj-TSP_1-SES_1', hours: -1, isPriorPeriodAdjustment: true },
            { sessionId: 'MAN_1', hours: 1, isManual: true }
        ],
        [
            { sessionId: 'adj-TSP_1-SES_1', hours: -2, isPriorPeriodAdjustment: true, isManual: true }
        ]
    );

    assert.equal(merged.length, 2);
    const adj = merged.find((row) => row.sessionId === 'adj-TSP_1-SES_1');
    assert.equal(adj.hours, -2);
});

test('timesheet routes expose prior-period adjustment endpoints', () => {
    const routes = read('packages/school/MVC/routes/timesheetRoutes.js');
    assert.match(routes, /prior-adjustments/);
    assert.match(routes, /apply-prior-adjustments/);
    assert.match(routes, /getPriorAdjustments/);
    assert.match(routes, /applyPriorAdjustments/);
    assert.match(routes, /trackActionState\(SECTIONS\.SCHOOL_TIMESHEETS, OPERATIONS\.UPDATE\)/);
    assert.match(routes, /allowOperationTokenFallback:\s*true/);
});

test('timesheet controller captures submission snapshot on submit', () => {
    const source = read('packages/school/MVC/controllers/school/timesheetController.js');
    assert.match(source, /buildSubmissionSnapshot/);
    assert.match(source, /submissionSnapshot/);
    assert.match(source, /getPriorAdjustments/);
    assert.match(source, /applyPriorAdjustments/);
});

test('timesheet editor includes prior-period adjustment review modal and locked row styling', () => {
    const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
    assert.match(editor, /priorAdjustmentModal/);
    assert.match(editor, /loadPriorAdjustmentsReview/);
    assert.match(editor, /row-prior-adjustment/);
    assert.match(editor, /isPriorPeriodAdjustment/);
    assert.match(editor, /needsReview/);
    assert.match(editor, /btnPriorAdjustmentContinue/);
    assert.match(editor, /priorReviewSummary/);
});
