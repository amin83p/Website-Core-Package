'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const deadlineService = require('../packages/school/MVC/services/school/timesheetDeadlineReconciliationService');
const statusPolicyService = require('../packages/school/MVC/services/school/sessionStatusPolicyService');
const priorAdjustmentService = require('../packages/school/MVC/services/school/timesheetPriorPeriodAdjustmentService');
const schoolDependencyService = require('../packages/school/MVC/services/school/schoolDependencyService');
const timesheetModel = require('../packages/school/MVC/models/school/timesheetModel');
const printService = require('../packages/school/MVC/services/school/timesheetPrintService');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const period = {
  id: 'TSP_CURRENT',
  startDate: '2026-05-01',
  submissionDeadline: '2026-05-13',
  endDate: '2026-05-15'
};

test('deadline reconciliation window is inclusive and bounded by the period', () => {
  assert.equal(deadlineService.resolveReconciliationCutoffDate(period), '2026-05-13');
  assert.equal(deadlineService.isDateInReconciliationWindow('2026-05-12', period), false);
  assert.equal(deadlineService.isDateInReconciliationWindow('2026-05-13', period), true);
  assert.equal(deadlineService.isDateInReconciliationWindow('2026-05-15', period), true);
  assert.equal(deadlineService.isDateInReconciliationWindow('2026-05-16', period), false);
  assert.equal(deadlineService.isBlockingNonFinalSession({
    period,
    sessionDate: '2026-05-12',
    isFinalStatus: false
  }), true);
  assert.equal(deadlineService.isBlockingNonFinalSession({
    period,
    sessionDate: '2026-05-13',
    isFinalStatus: false
  }), false);
});

test('cutoff is clamped to period start and a deadline after period end creates no window', () => {
  assert.equal(deadlineService.resolveReconciliationCutoffDate({
    startDate: '2026-05-01',
    submissionDeadline: '2026-04-29',
    endDate: '2026-05-15'
  }), '2026-05-01');
  assert.equal(deadlineService.resolveReconciliationCutoffDate({
    startDate: '2026-05-01',
    submissionDeadline: '2026-05-16',
    endDate: '2026-05-15'
  }), '');
});

test('provisional baseline hours use the configured status formula', () => {
  const statusMap = statusPolicyService.getStatusMetaMap([{
    code: 'scheduled',
    isFinal: false,
    timesheetFormula: 'duration * 0.5'
  }]);
  const baselineHours = statusPolicyService.calculateTimesheetHoursByMap(statusMap, {
    status: 'scheduled',
    durationHours: 2
  });
  const classification = deadlineService.classifySession({
    period,
    sessionDate: '2026-05-13',
    isFinalStatus: false,
    baselineStatus: 'scheduled',
    baselineHours
  });

  assert.equal(baselineHours, 1);
  assert.equal(classification.reconciliationRequired, true);
  assert.equal(classification.isProvisional, true);
  assert.deepEqual(classification.provisionalMeta, {
    policyVersion: 1,
    cutoffDate: '2026-05-13',
    baselineStatus: 'scheduled',
    baselineHours: 1,
    sourceType: 'class_session'
  });
});

test('final deadline-window sessions are reconciliation-required but not provisional', () => {
  const classification = deadlineService.classifySession({
    period,
    sessionDate: '2026-05-15',
    isFinalStatus: true,
    baselineStatus: 'completed',
    baselineHours: 2
  });
  assert.equal(classification.reconciliationRequired, true);
  assert.equal(classification.isProvisional, false);
  assert.equal(classification.provisionalMeta.baselineStatus, 'completed');
});

test('reconciliation outcomes preserve lifetime payment and never zero unresolved sessions', () => {
  const priorPeriod = { id: 'TSP_PRIOR', startDate: '2026-05-01', endDate: '2026-05-15' };
  const currentPeriod = { id: 'TSP_CURRENT', startDate: '2026-05-16', endDate: '2026-05-31' };
  const snapshotEntry = {
    sessionId: 'SES_1',
    classId: 'CLS_1',
    className: 'Math',
    date: '2026-05-14',
    status: 'scheduled',
    hours: 2,
    provisionalMeta: { baselineStatus: 'scheduled', sourceType: 'class_session' }
  };

  const finalizedPrior = priorAdjustmentService.buildReconciliationAdjustment({
    snapshotEntry,
    live: {
      assignedToTeacher: true,
      isFinalStatus: true,
      status: 'completed',
      date: '2026-05-14',
      hours: 1.5,
      classId: 'CLS_1'
    },
    priorPeriod,
    currentPeriod
  });
  assert.equal(finalizedPrior.state, 'resolved');
  assert.equal(finalizedPrior.adjustmentHours, -0.5);
  assert.equal(finalizedPrior.finalStatus, 'completed');

  const increased = priorAdjustmentService.buildReconciliationAdjustment({
    snapshotEntry: { ...snapshotEntry, hours: 1 },
    live: {
      assignedToTeacher: true,
      isFinalStatus: true,
      status: 'completed',
      date: '2026-05-14',
      hours: 2,
      classId: 'CLS_1'
    },
    priorPeriod,
    currentPeriod
  });
  assert.equal(increased.adjustmentHours, 1);

  const unchanged = priorAdjustmentService.buildReconciliationAdjustment({
    snapshotEntry,
    live: {
      assignedToTeacher: true,
      isFinalStatus: true,
      status: 'completed',
      date: '2026-05-14',
      hours: 2,
      classId: 'CLS_1'
    },
    priorPeriod,
    currentPeriod
  });
  assert.equal(unchanged.adjustmentHours, 0);

  const cancelled = priorAdjustmentService.buildReconciliationAdjustment({
    snapshotEntry,
    live: {
      assignedToTeacher: true,
      isFinalStatus: true,
      status: 'cancelled',
      date: '2026-05-14',
      hours: 0,
      classId: 'CLS_1'
    },
    priorPeriod,
    currentPeriod
  });
  assert.equal(cancelled.adjustmentHours, -2);
  assert.equal(cancelled.currentHours, 0);

  const movedCurrent = priorAdjustmentService.buildReconciliationAdjustment({
    snapshotEntry,
    live: {
      assignedToTeacher: true,
      isFinalStatus: true,
      status: 'completed',
      date: '2026-05-20',
      hours: 1.5,
      classId: 'CLS_1'
    },
    priorPeriod,
    currentPeriod
  });
  assert.equal(movedCurrent.movedIntoCurrentPeriod, true);
  assert.equal(movedCurrent.adjustmentHours, -2);
  assert.equal(2 + movedCurrent.adjustmentHours + movedCurrent.currentHours, 1.5);

  const movedFuture = priorAdjustmentService.buildReconciliationAdjustment({
    snapshotEntry,
    live: {
      assignedToTeacher: true,
      isFinalStatus: true,
      status: 'completed',
      date: '2026-06-10',
      hours: 1.5,
      classId: 'CLS_1'
    },
    priorPeriod,
    currentPeriod
  });
  assert.equal(movedFuture.adjustmentHours, -2);
  assert.equal(movedFuture.resolutionReason, 'moved_outside_review_periods');

  const unresolved = priorAdjustmentService.buildReconciliationAdjustment({
    snapshotEntry,
    live: {
      assignedToTeacher: true,
      isFinalStatus: false,
      status: 'scheduled',
      date: '2026-05-14',
      hours: 2,
      classId: 'CLS_1'
    },
    priorPeriod,
    currentPeriod
  });
  assert.equal(unresolved.state, 'unresolved');
  assert.equal(unresolved.adjustmentHours, 0);
  assert.equal(unresolved.resolutionReason, 'source_not_final');

  const removed = priorAdjustmentService.buildReconciliationAdjustment({
    snapshotEntry,
    live: null,
    priorPeriod,
    currentPeriod
  });
  assert.equal(removed.adjustmentHours, -2);
  assert.equal(removed.resolutionReason, 'removed_or_reassigned');

  const reassigned = priorAdjustmentService.buildReconciliationAdjustment({
    snapshotEntry,
    live: {
      assignedToTeacher: false,
      isFinalStatus: true,
      status: 'completed',
      date: '2026-05-14',
      hours: 2,
      classId: 'CLS_1'
    },
    priorPeriod,
    currentPeriod
  });
  assert.equal(reassigned.adjustmentHours, -2);
  assert.equal(reassigned.resolutionReason, 'removed_or_reassigned');
});

test('source-period adjustment replacement removes stale draft rows without duplication', () => {
  const existing = [
    { sessionId: 'adj-TSP_PRIOR-SES_1', isPriorPeriodAdjustment: true, adjustmentMeta: { sourcePeriodId: 'TSP_PRIOR' } },
    { sessionId: 'adj-OTHER-SES_2', isPriorPeriodAdjustment: true, adjustmentMeta: { sourcePeriodId: 'OTHER' } },
    { sessionId: 'MAN_1', isManual: true }
  ];
  const replacement = [{
    sessionId: 'adj-TSP_PRIOR-SES_3',
    isPriorPeriodAdjustment: true,
    adjustmentMeta: { sourcePeriodId: 'TSP_PRIOR' }
  }];

  const merged = priorAdjustmentService.mergeAdjustmentEntriesForSource(existing, replacement, 'TSP_PRIOR');
  assert.deepEqual(merged.map((row) => row.sessionId), ['adj-OTHER-SES_2', 'MAN_1', 'adj-TSP_PRIOR-SES_3']);
  const cleared = priorAdjustmentService.mergeAdjustmentEntriesForSource(merged, [], 'TSP_PRIOR');
  assert.deepEqual(cleared.map((row) => row.sessionId), ['adj-OTHER-SES_2', 'MAN_1']);
});

test('reconciliation receipt fingerprint detects stale review results', () => {
  const result = {
    items: [{
      sourceSessionId: 'SES_1',
      sourceSessionDate: '2026-05-14',
      baselineStatus: 'scheduled',
      currentStatus: 'completed',
      finalStatus: 'completed',
      baselineHours: 2,
      currentHours: 1.5,
      deltaHours: -0.5,
      adjustmentHours: -0.5,
      state: 'resolved',
      resolutionReason: 'finalized_in_prior_period'
    }],
    adjustments: []
  };
  const receipt = priorAdjustmentService.buildReconciliationReceipt({
    priorPeriod: { id: 'TSP_PRIOR' },
    result
  });

  assert.equal(priorAdjustmentService.isReconciliationReceiptCurrent(receipt, result), true);
  assert.equal(priorAdjustmentService.isReconciliationReceiptCurrent(receipt, {
    ...result,
    items: [{ ...result.items[0], currentHours: 1, deltaHours: -1, adjustmentHours: -1 }]
  }), false);
  const sanitized = timesheetModel.sanitizePriorPeriodReconciliation(receipt);
  assert.equal(sanitized.fingerprint, receipt.fingerprint);
});

test('timesheet sanitization preserves optional provisional and reconciliation receipt metadata', () => {
  const sanitized = timesheetModel.sanitizeTimesheetPayload({
    orgId: '900000',
    periodId: 'TSP_CURRENT',
    teacherId: 'P_1',
    status: 'draft',
    entries: [{
      sessionId: 'SES_1',
      classId: 'CLS_1',
      date: '2026-05-13',
      status: 'scheduled',
      hours: 2,
      isFinalStatus: false,
      reconciliationRequired: true,
      isProvisional: true,
      provisionalMeta: {
        policyVersion: 1,
        cutoffDate: '2026-05-13',
        baselineStatus: 'scheduled',
        baselineHours: 2,
        sourceType: 'class_session'
      }
    }],
    priorPeriodReconciliation: {
      sourcePeriodId: 'TSP_PRIOR',
      state: 'resolved',
      reviewedAt: '2026-05-16T12:00:00.000Z',
      items: [{
        sourceSessionId: 'SES_PRIOR',
        classId: 'CLS_1',
        sourceSessionDate: '2026-05-14',
        baselineStatus: 'scheduled',
        currentStatus: 'completed',
        baselineHours: 2,
        currentHours: 1.5,
        deltaHours: -0.5,
        adjustmentHours: -0.5,
        state: 'resolved',
        resolutionReason: 'finalized_in_prior_period'
      }]
    }
  });

  assert.equal(sanitized.entries[0].isProvisional, true);
  assert.equal(sanitized.entries[0].provisionalMeta.baselineHours, 2);
  assert.equal(sanitized.priorPeriodReconciliation.state, 'resolved');
  assert.equal(sanitized.priorPeriodReconciliation.items[0].adjustmentHours, -0.5);
});

test('submission snapshots preserve signed adjustment rows for printing but not future reconciliation', () => {
  const snapshot = timesheetModel.sanitizeSubmissionSnapshot({
    submittedAt: '2026-05-16T12:00:00.000Z',
    sourcePeriodId: 'TSP_CURRENT',
    entries: [{
      sessionId: 'adj-TSP_PRIOR-SES_1',
      date: '2026-05-16',
      classId: 'CLS_1',
      className: 'Math',
      status: 'adjustment',
      hours: -2,
      isManual: true,
      isPriorPeriodAdjustment: true,
      adjustmentMeta: {
        sourcePeriodId: 'TSP_PRIOR',
        sourceSessionId: 'SES_1',
        sourceSessionDate: '2026-05-14',
        baselineStatus: 'scheduled',
        finalStatus: 'cancelled',
        reconciliationReason: 'finalized_in_prior_period',
        snapshotHours: 2,
        currentHours: 0,
        deltaHours: -2
      }
    }]
  });

  assert.equal(snapshot.entries[0].hours, -2);
  assert.equal(snapshot.entries[0].isPriorPeriodAdjustment, true);
  assert.equal(snapshot.entries[0].adjustmentMeta.finalStatus, 'cancelled');
  assert.deepEqual(priorAdjustmentService.resolveSnapshotEntries({ submissionSnapshot: snapshot }), []);
});

test('normal processing source collection excludes reconciliation-required sessions', () => {
  const refs = schoolDependencyService.collectTimesheetSourceRefs({
    submissionSnapshot: {
      entries: [
        { sessionId: 'SES_NORMAL', classId: 'CLS_1' },
        { sessionId: 'SES_WINDOW', classId: 'CLS_1', reconciliationRequired: true, isProvisional: true },
        { sessionId: 'adj-TSP_PRIOR-SES_OLD', classId: 'CLS_1', isManual: true, isPriorPeriodAdjustment: true }
      ]
    }
  });

  assert.ok(refs.some((ref) => ref.sessionId === 'SES_NORMAL'));
  assert.equal(refs.some((ref) => ref.sessionId === 'SES_WINDOW'), false);
  assert.equal(refs.some((ref) => ref.sessionId.startsWith('adj-')), false);
});

test('print shaping preserves actual statuses and exposes reconciliation separately', () => {
  const provisional = printService.shapePrintEntry({
    sessionId: 'SES_P',
    status: 'scheduled',
    hours: 2,
    timesheetHours: 2,
    isProvisional: true,
    reconciliationRequired: true
  });
  const finalWindow = printService.shapePrintEntry({
    sessionId: 'SES_F',
    status: 'completed',
    hours: 2,
    timesheetHours: 2,
    reconciliationRequired: true
  });

  const normal = printService.shapePrintEntry({
    sessionId: 'SES_N',
    status: 'completed',
    hours: 2,
    timesheetHours: 2
  });

  assert.equal(provisional.statusLabel, 'Scheduled');
  assert.equal(provisional.showReconciliationBadge, true);
  assert.equal(provisional.isProvisional, true);
  assert.equal(finalWindow.statusLabel, 'Completed');
  assert.equal(finalWindow.showReconciliationBadge, true);
  assert.equal(normal.statusLabel, 'Completed');
  assert.equal(normal.showReconciliationBadge, false);
});

test('controller and views expose trusted rebuild, conflict codes, and reconciliation presentation', () => {
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');
  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  const manageView = read('packages/school/MVC/views/school/timesheet/timesheetManage.ejs');
  const printView = read('packages/school/MVC/views/school/timesheet/timesheetPrint.ejs');

  assert.match(controller, /const requiredWindowSessions = trustedLiveSessions\.filter/);
  assert.match(controller, /applySessionClassification/);
  assert.match(controller, /PRIOR_RECONCILIATION_UNRESOLVED/);
  assert.match(controller, /lockReconciliationSourceRefs/);
  assert.match(editor, /provisionalSessionsSummary/);
  assert.match(editor, /row-provisional/);
  assert.match(editor, /let reconciliationHours = 0/);
  assert.match(editor, /reconciliationHours \+= Math\.max\(0, hrs\)/);
  assert.match(editor, /if \(reconciliationHours > 0\)/);
  assert.doesNotMatch(editor, /if \(reconciliationSessionCount > 0\)/);
  assert.match(editor, /class="ts-reconciliation-note mb-4 d-none"/);
  assert.match(editor, /return `\$\{statusChip\}\$\{reconciliationChip\}`/);
  assert.match(editor, /label: reconciliationLabel/);
  assert.doesNotMatch(editor, /label: `Provisional -/);
  assert.doesNotMatch(editor, />Recheck<\/span>/);
  assert.doesNotMatch(editor, /const reconciliationBadge/);
  assert.match(editor, /resolvedNoChange/);
  assert.match(editor, /Deadline-window sessions must remain/);
  assert.match(manageView, /row\.provisionalCount/);
  assert.match(manageView, /row\.provisionalHours/);
  assert.match(manageView, /reconciliation session/);
  assert.doesNotMatch(manageView, /\brecheck\b/i);
  assert.match(printView, /Deadline-window reconciliation/);
  assert.match(printView, /entry\.showReconciliationBadge/);
  assert.match(printView, />Reconciliation<\/span>/);
  assert.doesNotMatch(printView, /recheck-badge/);
});

test('timesheet load warnings are serialized and prior review refreshes explicitly', () => {
  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');

  assert.match(editor, /function waitForTimesheetPageLoad\(\)/);
  assert.match(editor, /document\.readyState === 'complete'/);
  assert.match(editor, /async function initializeTimesheetLoadWarnings\(\)[\s\S]*await showIncompleteSessionWarningOnLoad\(\);[\s\S]*await waitForTimesheetPageLoad\(\);[\s\S]*await loadPriorAdjustmentsReview\(\);/);
  assert.match(editor, /void initializeTimesheetLoadWarnings\(\);/);
  assert.match(editor, /id="btnPriorAdjustmentLater"[^>]*>[\s\S]*Refresh Timesheet<\/button>/);
  assert.match(editor, /function refreshTimesheetAfterPriorReview\(\)[\s\S]*showTimesheetWaitingModal\([\s\S]*window\.location\.reload\(\);/);
  assert.match(editor, /btnPriorAdjustmentLater'\)\.onclick = refreshTimesheetAfterPriorReview/);
});
