'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const makeupReconciliationService = require('../packages/school/MVC/services/school/timesheetMakeupReconciliationService');
const priorAdjustmentService = require('../packages/school/MVC/services/school/timesheetPriorPeriodAdjustmentService');
const timesheetModel = require('../packages/school/MVC/models/school/timesheetModel');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const STATUS_META = [
  { code: 'scheduled', label: 'Scheduled', isFinal: false, timesheetFormula: 'duration' },
  { code: 'completed', label: 'Completed', isFinal: true, timesheetFormula: 'duration' },
  { code: 'missed', label: 'Missed - Make-up Required', isFinal: true, makeUpRequired: true, makeupDurationPercent: 100, timesheetFormula: '0' },
  { code: 'cancelled', label: 'Cancelled', isFinal: true, timesheetFormula: '0' }
];

const CURRENT_PERIOD = {
  id: 'TSP_CURRENT',
  startDate: '2026-05-16',
  submissionDeadline: '2026-05-29',
  endDate: '2026-05-31'
};

function delivery(personId = 'P_1') {
  return { deliveredBy: personId, deliveredByName: personId };
}

function makeup(originalSessionId, overrides = {}) {
  return {
    isMakeup: true,
    originalClassId: 'CLS_1',
    originalSessionId,
    ...overrides
  };
}

function buildGraph(sessions, teacherId = 'P_1') {
  return makeupReconciliationService.buildSessionGraph({
    classes: [{ id: 'CLS_1', title: 'Math' }],
    sessionsByClassId: new Map([['CLS_1', sessions]]),
    statusMeta: STATUS_META,
    teacherId
  });
}

function analyze(sessions, options = {}) {
  const graph = buildGraph(sessions, options.teacherId || 'P_1');
  return makeupReconciliationService.analyzeMakeupChains({
    graph,
    rootRefs: [{ classId: 'CLS_1', sessionId: 'ROOT', sourcePeriodId: 'TSP_PRIOR' }],
    currentPeriod: CURRENT_PERIOD,
    coverage: options.coverage || { isPaid: () => false, isPending: () => false },
    baselineKeys: options.baselineKeys || new Set(['CLS_1::ROOT']),
    teacherId: options.teacherId || 'P_1',
    sourcePeriodId: 'TSP_PRIOR'
  });
}

test('future non-final make-up remains an open carried obligation without duplicating hours', () => {
  const result = analyze([
    { sessionId: 'ROOT', date: '2026-05-14', durationHours: 2, status: 'missed', delivery: delivery() },
    { sessionId: 'M1', date: '2026-06-04', durationHours: 2, status: 'scheduled', delivery: delivery(), makeup: makeup('ROOT') }
  ]);

  assert.equal(result.makeupState, 'open');
  assert.equal(result.adjustments.length, 0);
  assert.equal(result.openMakeupRootRefs.length, 1);
  const child = result.chains[0].nodes.find((row) => row.sessionId === 'M1');
  assert.equal(child.periodDisposition, 'future_period');
  assert.equal(child.paymentDisposition, 'future_period');
  assert.ok(child.openReasons.includes('status_not_final'));
});

test('a non-final child in the current deadline window is marked provisional in chain audit', () => {
  const result = analyze([
    { sessionId: 'ROOT', date: '2026-05-14', durationHours: 2, status: 'missed', delivery: delivery() },
    { sessionId: 'M1', date: '2026-05-30', durationHours: 2, status: 'scheduled', delivery: delivery(), makeup: makeup('ROOT') }
  ]);
  const child = result.chains[0].nodes.find((row) => row.sessionId === 'M1');

  assert.equal(child.periodDisposition, 'current_reconciliation_window');
  assert.equal(child.isProvisional, true);
  assert.equal(child.hasFinalHours, false);
});

test('make-up-required children recurse until a final leaf completes the chain', () => {
  const result = analyze([
    { sessionId: 'ROOT', date: '2026-05-14', durationHours: 2, status: 'missed', delivery: delivery() },
    { sessionId: 'M1', date: '2026-05-18', durationHours: 2, status: 'missed', delivery: delivery(), makeup: makeup('ROOT') },
    { sessionId: 'M2', date: '2026-05-20', durationHours: 2, status: 'completed', delivery: delivery(), makeup: makeup('M1') }
  ]);

  assert.equal(result.makeupState, 'complete');
  assert.deepEqual(result.chains[0].nodes.map((row) => row.sessionId), ['ROOT', 'M1', 'M2']);
  assert.equal(result.chains[0].nodes[2].paymentDisposition, 'current_period');
  assert.equal(result.adjustments.length, 0);
});

test('a descendant that is also due for reconciliation stays inside its ancestor chain once', () => {
  const sessions = [
    { sessionId: 'ROOT', date: '2026-05-14', durationHours: 2, status: 'missed', delivery: delivery() },
    { sessionId: 'M1', date: '2026-05-30', durationHours: 2, status: 'missed', delivery: delivery(), makeup: makeup('ROOT') },
    { sessionId: 'M2', date: '2026-06-10', durationHours: 2, status: 'scheduled', delivery: delivery(), makeup: makeup('M1') }
  ];
  const graph = buildGraph(sessions);
  const result = makeupReconciliationService.analyzeMakeupChains({
    graph,
    rootRefs: [
      { classId: 'CLS_1', sessionId: 'ROOT', sourcePeriodId: 'TSP_OLDER' },
      { classId: 'CLS_1', sessionId: 'M1', sourcePeriodId: 'TSP_PRIOR' }
    ],
    currentPeriod: CURRENT_PERIOD,
    coverage: { isPaid: () => false, isPending: () => false },
    baselineKeys: new Set(['CLS_1::ROOT', 'CLS_1::M1']),
    teacherId: 'P_1',
    sourcePeriodId: 'TSP_PRIOR'
  });

  assert.equal(result.chains.length, 1);
  assert.deepEqual(result.chains[0].nodes.map((row) => row.sessionId), ['ROOT', 'M1', 'M2']);
});

test('partial allocation keeps a branch open even when its scheduled child is final', () => {
  const result = analyze([
    { sessionId: 'ROOT', date: '2026-05-14', durationHours: 2, status: 'missed', delivery: delivery() },
    { sessionId: 'M1', date: '2026-05-20', durationHours: 1, status: 'completed', delivery: delivery(), makeup: makeup('ROOT') }
  ]);

  assert.equal(result.makeupState, 'open');
  const root = result.chains[0].nodes[0];
  assert.equal(root.remainingDurationHours, 1);
  assert.ok(root.openReasons.includes('makeup_not_fully_scheduled'));
});

test('chain audit exposes server-calculated baseline, final, and signed difference hours', () => {
  const graph = buildGraph([
    { sessionId: 'ROOT', date: '2026-05-10', durationHours: 2, status: 'completed', delivery: delivery() }
  ]);
  const result = makeupReconciliationService.analyzeMakeupChains({
    graph,
    rootRefs: [{ classId: 'CLS_1', sessionId: 'ROOT', sourcePeriodId: 'TSP_PRIOR' }],
    currentPeriod: CURRENT_PERIOD,
    coverage: { isPaid: () => true, isPending: () => false },
    baselineKeys: new Set(['CLS_1::ROOT']),
    baselineHoursByKey: new Map([['CLS_1::ROOT', 1]]),
    teacherId: 'P_1',
    sourcePeriodId: 'TSP_PRIOR'
  });
  const root = result.chains[0].nodes[0];

  assert.equal(root.baselineHours, 1);
  assert.equal(root.finalHours, 2);
  assert.equal(root.hasFinalHours, true);
  assert.equal(root.adjustmentHours, 1);
});

test('closed-period unpaid final make-up creates one deterministic catch-up', () => {
  const sessions = [
    { sessionId: 'ROOT', date: '2026-05-01', durationHours: 1.5, status: 'missed', delivery: delivery() },
    { sessionId: 'M1', date: '2026-05-10', durationHours: 1.5, status: 'completed', delivery: delivery(), makeup: makeup('ROOT') }
  ];
  const result = analyze(sessions, {
    coverage: {
      isPaid: (node) => node.sessionId === 'ROOT',
      isPending: () => false
    },
    baselineKeys: new Set()
  });

  assert.equal(result.adjustments.length, 1);
  assert.equal(result.adjustments[0].sourceSessionId, 'M1');
  assert.equal(result.adjustments[0].adjustmentHours, 1.5);
  assert.equal(result.adjustments[0].assignedPersonId, 'P_1');
  assert.equal(result.adjustments[0].adjustmentSessionId, 'adj-TSP_PRIOR-makeup-CLS_1-M1-P_1');
});

test('a carried chain keeps its original source period in catch-up identity and audit', () => {
  const graph = buildGraph([
    { sessionId: 'ROOT', date: '2026-04-01', durationHours: 1.5, status: 'missed', delivery: delivery() },
    { sessionId: 'M1', date: '2026-05-10', durationHours: 1.5, status: 'completed', delivery: delivery(), makeup: makeup('ROOT') }
  ]);
  const result = makeupReconciliationService.analyzeMakeupChains({
    graph,
    carriedRootRefs: [{ classId: 'CLS_1', sessionId: 'ROOT', sourcePeriodId: 'TSP_ORIGINAL' }],
    currentPeriod: CURRENT_PERIOD,
    coverage: {
      isPaid: (node) => node.sessionId === 'ROOT',
      isPending: () => false
    },
    baselineKeys: new Set(),
    teacherId: 'P_1',
    sourcePeriodId: 'TSP_IMMEDIATE_PRIOR'
  });

  assert.equal(result.adjustments.length, 1);
  assert.equal(result.adjustments[0].sourcePeriodId, 'TSP_ORIGINAL');
  assert.equal(result.adjustments[0].makeupRootSourcePeriodId, 'TSP_ORIGINAL');
  assert.equal(result.adjustments[0].adjustmentSessionId, 'adj-TSP_ORIGINAL-makeup-CLS_1-M1-P_1');
});

test('closed-period non-final make-up carries forward and is never converted to zero', () => {
  const result = analyze([
    { sessionId: 'ROOT', date: '2026-05-01', durationHours: 2, status: 'missed', delivery: delivery() },
    { sessionId: 'M1', date: '2026-05-10', durationHours: 2, status: 'scheduled', delivery: delivery(), makeup: makeup('ROOT') }
  ], { baselineKeys: new Set() });

  assert.equal(result.adjustments.length, 0);
  const child = result.chains[0].nodes.find((row) => row.sessionId === 'M1');
  assert.equal(child.paymentDisposition, 'pending_finalization');
  assert.ok(child.openReasons.includes('status_not_final'));
});

test('payment coverage is composite-keyed and does not confuse identical session IDs in different classes', () => {
  const coverage = makeupReconciliationService.buildPaymentCoverage({
    teacherId: 'P_1',
    periods: [{ id: 'TSP_1', status: 'processed' }],
    timesheets: [{
      teacherId: 'P_1',
      periodId: 'TSP_1',
      status: 'processed',
      submissionSnapshot: { entries: [{ classId: 'CLS_A', sessionId: 'SAME' }] }
    }]
  });

  assert.equal(coverage.isPaid({ key: 'CLS_A::SAME', sessionId: 'SAME' }), true);
  assert.equal(coverage.isPaid({ key: 'CLS_B::SAME', sessionId: 'SAME' }), false);
});

test('a reassigned closed-period session is credited once to its current delivery person', () => {
  const graph = buildGraph([
    { sessionId: 'MOVE', date: '2026-05-10', durationHours: 2, status: 'completed', delivery: delivery('P_NEW') }
  ], 'P_NEW');
  const coverage = makeupReconciliationService.buildPaymentCoverage({
    periods: [{ id: 'TSP_ORIGINAL', startDate: '2026-05-01', status: 'processed' }],
    timesheets: [{
      teacherId: 'P_OLD',
      periodId: 'TSP_ORIGINAL',
      status: 'processed',
      submissionSnapshot: {
        entries: [{ classId: 'CLS_1', sessionId: 'MOVE', hours: 2 }]
      }
    }],
    teacherId: 'P_NEW'
  });
  const result = makeupReconciliationService.analyzeMakeupChains({
    graph,
    currentPeriod: CURRENT_PERIOD,
    coverage,
    baselineKeys: new Set(),
    teacherId: 'P_NEW',
    sourcePeriodId: 'TSP_IMMEDIATE_PRIOR'
  });

  assert.equal(result.adjustments.length, 1);
  assert.equal(result.adjustments[0].sourceSessionId, 'MOVE');
  assert.equal(result.adjustments[0].adjustmentHours, 2);
  assert.equal(result.adjustments[0].sourcePeriodId, 'TSP_ORIGINAL');
  assert.equal(result.adjustments[0].sourceType, 'class_session');
  assert.equal(result.adjustments[0].reconciliationReason, 'reassigned_closed_period_catchup');
  assert.equal(result.adjustments[0].adjustmentSessionId, 'adj-TSP_ORIGINAL-makeup-CLS_1-MOVE-P_NEW');
});

test('cycles and over-allocation produce stable graph conflicts', () => {
  const graph = buildGraph([
    { sessionId: 'ROOT', date: '2026-05-01', durationHours: 1, status: 'missed', delivery: delivery(), makeup: makeup('M1') },
    { sessionId: 'M1', date: '2026-05-02', durationHours: 2, status: 'missed', delivery: delivery(), makeup: makeup('ROOT') }
  ]);
  const result = makeupReconciliationService.analyzeMakeupChains({
    graph,
    rootRefs: [{ classId: 'CLS_1', sessionId: 'ROOT', sourcePeriodId: 'TSP_PRIOR' }],
    currentPeriod: CURRENT_PERIOD,
    coverage: { isPaid: () => false, isPending: () => false },
    baselineKeys: new Set(['CLS_1::ROOT']),
    teacherId: 'P_1',
    sourcePeriodId: 'TSP_PRIOR'
  });

  assert.equal(result.makeupState, 'conflict');
  assert.ok(result.conflicts.some((row) => row.code === 'makeup_cycle'));
  assert.ok(result.conflicts.some((row) => row.code === 'makeup_over_allocated'));
});

test('receipt sanitization preserves make-up chain audit and confirmation metadata', () => {
  const result = analyze([
    { sessionId: 'ROOT', date: '2026-05-14', durationHours: 2, status: 'missed', delivery: delivery() },
    { sessionId: 'M1', date: '2026-06-04', durationHours: 2, status: 'scheduled', delivery: delivery(), makeup: makeup('ROOT') }
  ]);
  const receipt = priorAdjustmentService.buildReconciliationReceipt({
    priorPeriod: { id: 'TSP_PRIOR' },
    result: { items: [], adjustments: [], ...result, makeupChains: result.chains, makeupConflicts: result.conflicts },
    confirmOpenMakeupChains: true
  });
  const sanitized = timesheetModel.sanitizePriorPeriodReconciliation(receipt);

  assert.equal(sanitized.makeupState, 'open');
  assert.ok(sanitized.makeupConfirmedAt);
  assert.equal(sanitized.makeupChains[0].nodes[1].paymentDisposition, 'future_period');
  assert.equal(sanitized.openMakeupRootRefs[0].sessionId, 'ROOT');
  assert.equal(priorAdjustmentService.isMakeupConfirmationCurrent(receipt, {
    items: [], adjustments: [], ...result, makeupChains: result.chains, makeupConflicts: result.conflicts
  }), true);
});

test('catch-up adjustment audit metadata survives entry sanitization', () => {
  const entry = priorAdjustmentService.buildAdjustmentEntries({
    applyDate: '2026-05-16',
    adjustments: [{
      adjustmentSessionId: 'adj-TSP_PRIOR-makeup-CLS_1-M1-P_1',
      sourcePeriodId: 'TSP_PRIOR',
      sourceSessionId: 'M1',
      sourceClassId: 'CLS_1',
      sourceSessionDate: '2026-05-10',
      sourceType: 'makeup_session',
      classId: 'CLS_1',
      adjustmentHours: 1.5,
      currentHours: 1.5,
      paymentDisposition: 'catch_up',
      makeupRootClassId: 'CLS_1',
      makeupRootSessionId: 'ROOT',
      makeupRootSourcePeriodId: 'TSP_PRIOR',
      makeupDepth: 1,
      assignedPersonId: 'P_1',
      claimKey: 'abc123'
    }]
  })[0];
  const sanitized = timesheetModel.sanitizeTimesheetPayload({
    orgId: '900000',
    periodId: 'TSP_CURRENT',
    teacherId: 'P_1',
    status: 'draft',
    entries: [entry]
  });

  assert.equal(sanitized.entries[0].adjustmentMeta.sourceClassId, 'CLS_1');
  assert.equal(sanitized.entries[0].adjustmentMeta.paymentDisposition, 'catch_up');
  assert.equal(sanitized.entries[0].adjustmentMeta.makeupRootSessionId, 'ROOT');
  assert.equal(sanitized.entries[0].adjustmentMeta.claimKey, 'abc123');
});

test('re-review removes stale carried catch-ups without touching unrelated older adjustments', () => {
  const staleCatchup = {
    sessionId: 'adj-TSP_OLD-makeup-CLS_1-M1-P_1',
    isPriorPeriodAdjustment: true,
    adjustmentMeta: {
      sourcePeriodId: 'TSP_OLD',
      reconciliationReason: 'makeup_closed_period_catchup'
    }
  };
  const unrelated = {
    sessionId: 'adj-TSP_OLD-OTHER',
    isPriorPeriodAdjustment: true,
    adjustmentMeta: {
      sourcePeriodId: 'TSP_OLD',
      reconciliationReason: 'hours_changed'
    }
  };
  const merged = priorAdjustmentService.mergeAdjustmentEntriesForSource(
    [staleCatchup, unrelated],
    [],
    'TSP_PRIOR',
    ['TSP_OLD']
  );

  assert.deepEqual(merged.map((row) => row.sessionId), ['adj-TSP_OLD-OTHER']);
});

test('timesheet-locked make-up-required parents keep the dedicated scheduling action only', () => {
  const controller = read('packages/school/MVC/controllers/school/classController.js');
  const view = read('packages/school/MVC/views/school/class/sessionManager.ejs');

  assert.match(controller, /canCreateMakeupWhileLocked/);
  assert.match(controller, /String\(session\?\.lockReason \|\| ''\) === 'timesheet_approved'/);
  assert.match(controller, /originalIsLocked[\s\S]*timesheet_approved[\s\S]*cannot be used to create a make-up session/);
  assert.match(view, /typeof canCreateMakeupWhileLocked !== 'undefined'/);
  assert.match(view, /const canCreateMakeupSession = Boolean/);
});
