'use strict';

const assert = require('assert');
const test = require('node:test');

process.env.MAIN_SECRET_KEY ||= '0123456789abcdef0123456789abcdef';
process.env.SESSION_SECRET ||= 'fedcba9876543210fedcba9876543210';
process.env.SESSION_ENCRYPTION_KEY ||= '00112233445566778899aabbccddeeff';
process.env.ACTION_STATE_KEY ||= 'ffeeddccbbaa99887766554433221100';
process.env.DATA_BACKEND = 'json';
process.env.DATA_BACKEND_STRICT = 'false';

const notificationRuleModel = require('../MVC/models/school/notificationRuleModel');
const registry = require('../MVC/services/school/notificationCenterEvaluatorRegistry');
const scanService = require('../MVC/services/school/notificationCenterSessionRuleScanService');
const bookCoveringReportService = require('../MVC/services/school/bookCoveringReportService');
const sessionUncompletedNotificationService = require('../MVC/services/school/sessionUncompletedNotificationService');
const schoolDataService = require('../MVC/services/school/schoolDataService');

test('notification rule model exposes labels for new session rule types', () => {
  assert.ok(notificationRuleModel.NOTIFICATION_RULE_TYPES.includes('session_without_book_report'));
  assert.equal(
    notificationRuleModel.formatNotificationTokenLabel('session_without_notes'),
    'Sessions without Notes'
  );
  assert.equal(
    notificationRuleModel.formatNotificationTokenLabel('session_with_cases'),
    'Sessions with Cases'
  );
});

test('registry exposes evaluators for new session rule types', () => {
  assert.ok(registry.getEvaluator('session_without_book_report'));
  assert.ok(registry.getEvaluator('session_without_notes'));
  assert.ok(registry.getEvaluator('session_with_cases'));
  assert.ok(registry.getEvaluator('session_with_activities'));
});

test('session scan predicates detect notes, activities, and cases', () => {
  assert.equal(scanService.sessionNotesEmpty({ notes: '   ' }), true);
  assert.equal(scanService.sessionNotesEmpty({ notes: 'done' }), false);
  assert.equal(scanService.sessionHasInstructionalActivities({ quizzes: [{ id: 'Q1' }] }), true);
  assert.equal(scanService.sessionHasInstructionalActivities({}), false);

  const caseIndex = scanService.buildCaseCountIndex([
    { classId: 'C1', sessionId: 'S1', orgId: 'ORG1' }
  ]);
  assert.equal(
    scanService.sessionHasCases({
      classData: { id: 'C1' },
      session: { sessionId: 'S1' },
      caseCountIndex: caseIndex
    }),
    true
  );
});

test('submitted book report predicate ignores draft-only reports', () => {
  const classData = { id: 'C1', orgId: 'ORG1' };
  const session = { sessionId: 'S1', date: '2026-09-15' };
  const orgBookRows = [{
    orgId: 'ORG1',
    classId: 'C1',
    sessionId: 'S1',
    periodType: 'daily',
    periodStartDate: '2026-09-15',
    periodEndDate: '2026-09-15',
    status: 'draft'
  }];
  assert.equal(
    bookCoveringReportService.hasSubmittedBookReportForSession({ classData, session, orgRows: orgBookRows }),
    false
  );
  orgBookRows[0].status = 'submitted';
  assert.equal(
    bookCoveringReportService.hasSubmittedBookReportForSession({ classData, session, orgRows: orgBookRows }),
    true
  );
});

test('evaluateSessionWithoutNotes respects session date range', async () => {
  const originalResolve = sessionUncompletedNotificationService.resolveSessionDateRangeBounds;
  const originalListOrg = sessionUncompletedNotificationService.listOrgClasses;
  const originalListSessions = sessionUncompletedNotificationService.listClassSessions;
  const originalFetch = schoolDataService.fetchAllData;

  sessionUncompletedNotificationService.resolveSessionDateRangeBounds = async () => ({
    fromDate: '2026-09-01',
    throughDate: '2026-09-30'
  });
  sessionUncompletedNotificationService.listOrgClasses = async () => [{ id: 'C1', title: 'Algebra', orgId: 'ORG1' }];
  sessionUncompletedNotificationService.listClassSessions = async () => ([
    { sessionId: 'S1', date: '2026-09-10', notes: '' },
    { sessionId: 'S2', date: '2026-08-01', notes: '' },
    { sessionId: 'S3', date: '2026-09-12', notes: 'filled in' }
  ]);
  schoolDataService.fetchAllData = async () => [];

  try {
    const evaluator = registry.getEvaluator('session_without_notes');
    const { findings } = await evaluator.evaluate({
      orgId: 'ORG1',
      rule: { criteria: { sessionDateRange: { type: 'this_month' } } },
      asOfDate: '2026-09-15',
      reqUser: { activeOrgId: 'ORG1' }
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].id, 'S1');
  } finally {
    sessionUncompletedNotificationService.resolveSessionDateRangeBounds = originalResolve;
    sessionUncompletedNotificationService.listOrgClasses = originalListOrg;
    sessionUncompletedNotificationService.listClassSessions = originalListSessions;
    schoolDataService.fetchAllData = originalFetch;
  }
});
