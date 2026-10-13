'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const rollingEnrollmentCompletionCellService = require('../MVC/services/school/rollingEnrollmentCompletionCellService');

const { resolveEnrollmentCompletionDisplay } = rollingEnrollmentCompletionCellService;

function closedRow(overrides = {}) {
  return {
    status: 'completed',
    endDate: '2026-10-09',
    transactionSummary: {
      lastCloseSnapshot: {
        closedEndDate: '2026-10-09',
        closedAt: '2026-10-13T12:00:00.000Z'
      }
    },
    ...overrides
  };
}

test('manual scheduled close with later enrollment end omits target completing session date', () => {
  const display = resolveEnrollmentCompletionDisplay(
    closedRow({
      endDate: '2026-10-09',
      status: 'withdrawn',
      targetSessionCount: 46,
      completionDate: '2026-10-01'
    }),
    { date: '2026-10-01', sessionId: 'SES_42' }
  );
  assert.equal(display.showCompletingSessionDate, false);
  assert.equal(display.primaryDate, '2026-10-09');
  assert.equal(display.enrollmentEndDate, '');
  assert.equal(display.closedOnDate, '2026-10-13');
  assert.equal(display.completionSessionId, 'SES_42');
  assert.equal(display.dateLineCount, 2);
});

test('completion display omits enrollment end line when it matches completing session date', () => {
  const display = resolveEnrollmentCompletionDisplay(
    closedRow({ endDate: '2026-10-01' }),
    { date: '2026-10-01', sessionId: 'SES_42' }
  );
  assert.equal(display.primaryDate, '2026-10-01');
  assert.equal(display.enrollmentEndDate, '');
  assert.equal(display.closedOnDate, '2026-10-13');
  assert.equal(display.dateLineCount, 2);
});

test('active enrollment with only session completion shows one date line and session', () => {
  const display = resolveEnrollmentCompletionDisplay(
    { status: 'active', endDate: '2026-07-16' },
    { date: '2026-07-16', sessionId: 'SES_1' }
  );
  assert.equal(display.primaryDate, '2026-07-16');
  assert.equal(display.showClosedOn, false);
  assert.equal(display.dateLineCount, 1);
});

test('active enrollment without completion shows no dates', () => {
  const display = resolveEnrollmentCompletionDisplay(
    { status: 'active', endDate: '' },
    null
  );
  assert.equal(display.primaryDate, '');
  assert.equal(display.dateLineCount, 0);
});
