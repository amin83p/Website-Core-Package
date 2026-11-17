'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const reportService = require('../MVC/services/school/reportService');
const reportExportBatchCacheService = require('../MVC/services/school/reportExportBatchCacheService');
const { requireCoreModule } = require('../MVC/services/school/schoolCoreContracts');
const dataServiceGlobal = requireCoreModule('MVC/services/dataService');

function withPatched(target, replacements, callback) {
  const originals = {};
  Object.entries(replacements).forEach(([key, value]) => {
    originals[key] = target[key];
    target[key] = value;
  });
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      Object.entries(originals).forEach(([key, value]) => {
        target[key] = value;
      });
    });
}

function buildPeriodLogSessions({ periodPerformanceLog = true, absentScore = 8 } = {}) {
  return [{
    sessionId: 'SES-605248-0033',
    date: '2026-10-16',
    status: 'completed',
    roster: [
      { personId: 'STU-ABSENT', attendance: 'absent' },
      { personId: 'STU-PRESENT', attendance: 'present' }
    ],
    gradebooks: [{
      id: 'GB-PERIOD-LOG',
      name: 'Period log',
      periodPerformanceLog,
      totalScore: 10,
      includeInGradeCalculation: true,
      skills: ['listening'],
      scores: {
        'STU-ABSENT': absentScore,
        'STU-PRESENT': 9
      }
    }]
  }];
}

test('period performance log counts absent student scores in gradebook skill prefill', () => {
  const sessions = buildPeriodLogSessions();
  const stats = reportService.computeReportPeriodGradebookSkillStats(sessions, 'STU-ABSENT');
  assert.equal(stats.student_gradebook_skill_listening_activity_count, 1);
  assert.equal(stats.student_gradebook_skill_listening_avg_percent, 80);
  assert.equal(stats.student_gradebook_skill_listening_points_earned, 8);
  assert.equal(stats.student_gradebook_skill_listening_points_possible, 10);
});

test('regular gradebook activity omits absent student from gradebook skill prefill', () => {
  const sessions = buildPeriodLogSessions({ periodPerformanceLog: false, absentScore: 8 });
  const stats = reportService.computeReportPeriodGradebookSkillStats(sessions, 'STU-ABSENT');
  assert.equal(stats.student_gradebook_skill_listening_activity_count, 0);
  assert.equal(stats.student_gradebook_skill_listening_avg_percent, 0);
  assert.equal(stats.student_gradebook_skill_listening_points_earned, 0);
});

test('buildPrefillSnapshot includes period log points for absent students in period gradebook keys', async () => {
  const sessions = buildPeriodLogSessions();
  const cache = reportExportBatchCacheService.createExportBatchCache();
  cache.classById.set('CLASS-605248', {
    classData: { id: 'CLASS-605248', className: 'Period log class', orgId: 'ORG1' },
    sessions
  });

  await withPatched(dataServiceGlobal, {
    fetchData: async () => []
  }, async () => {
    const snapshot = await reportService.buildPrefillSnapshot({
      assignment: {
        classId: 'CLASS-605248',
        sessionId: 'SES-605248-0033',
        sessionDate: '2026-10-16',
        reportStartDate: '2026-10-01',
        reportDueDate: '2026-10-31'
      },
      studentId: 'STU-ABSENT',
      reqUser: { id: 'USER-1', activeOrgId: 'ORG1' },
      requiredKeys: [
        'student_gradebook_period_activity_count',
        'student_gradebook_period_points_earned',
        'student_gradebook_skill_listening_avg_percent'
      ],
      dataCache: cache
    });
    assert.equal(snapshot.student_gradebook_period_activity_count, 1);
    assert.equal(snapshot.student_gradebook_period_points_earned, 8);
    assert.equal(snapshot.student_gradebook_skill_listening_avg_percent, 80);
  });
});