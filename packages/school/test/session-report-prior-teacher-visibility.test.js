'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { canViewerSeeSessionReportRow } = require('../MVC/services/school/sessionReportInstanceService');

test('canViewerSeeSessionReportRow grants rows to previous teacher with session edit access', () => {
  const session = {
    sessionId: 'SES-605381-0037',
    delivery: {
      deliveredBy: '530933',
      coTeachers: [{
        personId: '545482',
        roleLabel: 'Previous Teacher',
        canEdit: true,
        paid: false
      }]
    }
  };
  const row = {
    id: 'pending-515316-session-SES-605381-0037-student-524260',
    teacherId: '530933',
    assignmentId: '515316',
    studentId: '524260'
  };
  const viewerContext = {
    currentUserPersonId: '545482',
    assignmentMap: new Map([['515316', { id: '515316' }]]),
    session
  };

  assert.equal(canViewerSeeSessionReportRow(row, viewerContext), true);
});

test('canViewerSeeSessionReportRow still hides unrelated teachers without session edit access', () => {
  const session = {
    sessionId: 'SES-1',
    delivery: {
      deliveredBy: '530933',
      coTeachers: [{
        personId: '545482',
        roleLabel: 'Previous Teacher',
        canEdit: true
      }]
    }
  };
  const row = {
    teacherId: '530933',
    assignmentId: '515316'
  };
  const viewerContext = {
    currentUserPersonId: '999999',
    assignmentMap: new Map([['515316', { id: '515316', reportScope: 'class' }]]),
    session
  };

  assert.equal(canViewerSeeSessionReportRow(row, viewerContext), false);
});
