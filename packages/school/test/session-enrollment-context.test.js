'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const sessionEnrollmentContextService = require('../MVC/services/school/sessionEnrollmentContextService');

test('buildClbContextFromStudent maps latest CLB entry', () => {
  const context = sessionEnrollmentContextService.buildClbContextFromStudent({
    clbLevelHistory: [{
      id: 'CLB_2',
      recordedAt: '2026-02-01',
      current: { listening: '4', speaking: '4', reading: '3', writing: '3' },
      goal: { listening: '5', speaking: '5', reading: '4', writing: '4' }
    }, {
      id: 'CLB_1',
      recordedAt: '2026-01-01',
      current: { listening: '3', speaking: '3', reading: '2', writing: '2' },
      goal: { listening: '4', speaking: '4', reading: '3', writing: '3' }
    }]
  });

  assert.equal(context.enrollmentClbRecordedAt, '2026-02-01');
  assert.equal(context.enrollmentClbCurrent.listening, '4');
  assert.equal(context.enrollmentClbGoal.writing, '4');
});

test('resolveExpectedFinishDate prefers completionDate', () => {
  const finish = sessionEnrollmentContextService.resolveExpectedFinishDate({
    period: {
      completionDate: '2026-03-01',
      endDate: '2026-06-01',
      targetSessionCount: 10
    },
    sessions: [],
    statusMap: {}
  });
  assert.equal(finish, '2026-03-01');
});

test('resolveExpectedFinishDate uses sessionCompletion date from progress row', () => {
  const finish = sessionEnrollmentContextService.resolveExpectedFinishDate({
    period: {
      startDate: '2026-01-01',
      endDate: '2026-06-01',
      targetSessionCount: 2
    },
    sessions: [],
    statusMap: {},
    enrichedPeriodRow: {
      sessionCompletion: { date: '2026-02-15', sessionId: 'SES_2' }
    }
  });
  assert.equal(finish, '2026-02-15');
});

test('resolveExpectedFinishDate uses anticipated finish for session target', () => {
  const finish = sessionEnrollmentContextService.resolveExpectedFinishDate({
    period: {
      startDate: '2026-01-01',
      endDate: '2026-06-01',
      targetSessionCount: 2
    },
    sessions: [
      { sessionId: 'SES_1', date: '2026-01-05', status: 'scheduled', durationHours: 1 },
      { sessionId: 'SES_2', date: '2026-01-12', status: 'scheduled', durationHours: 1 },
      { sessionId: 'SES_3', date: '2026-01-19', status: 'scheduled', durationHours: 1 }
    ],
    statusMap: {}
  });
  assert.equal(finish, '2026-01-12');
});

test('resolveExpectedFinishDate prefers scheduled closing date over anticipated cap finish', () => {
  const finish = sessionEnrollmentContextService.resolveExpectedFinishDate({
    period: {
      status: 'completed',
      startDate: '2026-01-01',
      endDate: '2026-10-21',
      targetSessionCount: 2,
      completionDate: '2026-10-08',
      transactionSummary: {
        lastCloseSnapshot: {
          closedEndDate: '2026-10-21',
          closedAt: '2026-10-08T15:30:00.000Z'
        }
      }
    },
    sessions: [
      { sessionId: 'SES_1', date: '2026-01-05', status: 'scheduled', durationHours: 1 },
      { sessionId: 'SES_2', date: '2026-01-12', status: 'scheduled', durationHours: 1 },
      { sessionId: 'SES_3', date: '2026-01-19', status: 'scheduled', durationHours: 1 }
    ],
    statusMap: {}
  });
  assert.equal(finish, '2026-10-21');
});

test('resolveExpectedFinishDate falls back to endDate when no target', () => {
  const finish = sessionEnrollmentContextService.resolveExpectedFinishDate({
    period: {
      startDate: '2026-01-01',
      endDate: '2026-06-01'
    },
    sessions: [],
    statusMap: {}
  });
  assert.equal(finish, '2026-06-01');
});

test('resolveExpectedFinishDate returns empty string when no period', () => {
  assert.equal(sessionEnrollmentContextService.resolveExpectedFinishDate({ period: null }), '');
});

test('sanitizeEnrollmentNotes trims and caps length', () => {
  const longNote = `x${'y'.repeat(1200)}`;
  const sanitized = sessionEnrollmentContextService.sanitizeEnrollmentNotes(`  ${longNote}  `);
  assert.equal(sanitized.length, 1000);
  assert.equal(sanitized.startsWith('xy'), true);
});

test('buildRosterEnrollmentContextBatch exposes closing and closed-on dates', async () => {
  const map = await sessionEnrollmentContextService.buildRosterEnrollmentContextBatch({
    personIds: ['PER_1'],
    session: { date: '2026-10-08' },
    classData: { registrationMode: 'rolling', id: 'CLS_1', orgId: 'ORG_1' },
    periodRows: [{
      id: 'ENR_1',
      studentId: 'STU_1',
      orgId: 'ORG_1',
      status: 'completed',
      startDate: '2026-06-01',
      endDate: '2026-10-21',
      targetSessionCount: 10,
      notes: '',
      transactionSummary: {
        lastCloseSnapshot: {
          closedEndDate: '2026-10-21',
          closedAt: '2026-10-08T20:00:00.000Z'
        }
      }
    }],
    students: [{ id: 'STU_1', personId: 'PER_1' }],
    sessions: [],
    reqUser: { activeOrgId: 'ORG_1' },
    registrationMode: 'rolling'
  });

  const context = map.get('PER_1');
  assert.ok(context);
  assert.equal(context.enrollmentExpectedFinishDate, '2026-10-21');
  assert.equal(context.enrollmentClosingDate, '2026-10-21');
  assert.equal(context.enrollmentClosedOnDate, '2026-10-08');
});

test('buildRosterEnrollmentContextBatch attaches CLB for term classes without enrollment fields', async () => {
  const map = await sessionEnrollmentContextService.buildRosterEnrollmentContextBatch({
    personIds: ['PER_1'],
    session: { date: '2026-02-01' },
    classData: { registrationMode: 'term' },
    periodRows: [],
    students: [{
      id: 'STU_1',
      personId: 'PER_1',
      clbLevelHistory: [{
        id: 'CLB_1',
        recordedAt: '2026-01-15',
        current: { listening: '2' },
        goal: { listening: '3' }
      }]
    }],
    sessions: [],
    reqUser: { activeOrgId: 'ORG_1' },
    registrationMode: 'term'
  });

  const context = map.get('PER_1');
  assert.ok(context);
  assert.equal(context.enrollmentPeriodId, '');
  assert.equal(context.enrollmentNotes, '');
  assert.equal(context.enrollmentClbCurrent.listening, '2');
});
