'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const gradebookWeightService = require('../MVC/services/school/gradebookWeightService');
const { computeReportPeriodGradebookSkillStats } = require('../MVC/services/school/reportService');

const STUDENT_PERSON = 'PERSON/STUDENT_1';

function buildSessions() {
  return [
    {
      sessionId: 'SES/1',
      date: '2026-03-01',
      status: 'completed',
      roster: [{ personId: STUDENT_PERSON, attendance: 'present' }],
      gradebooks: [{
        id: 'GB/1',
        totalScore: 100,
        weight: 1,
        includeInGradeCalculation: true,
        skills: ['writing'],
        scores: {}
      }]
    },
    {
      sessionId: 'SES/2',
      date: '2026-03-08',
      status: 'completed',
      roster: [{ personId: STUDENT_PERSON, attendance: 'present' }],
      gradebooks: [{
        id: 'GB/2',
        totalScore: 100,
        weight: 1,
        includeInGradeCalculation: true,
        skills: ['reading', 'writing'],
        scores: { [STUDENT_PERSON]: 75 }
      }]
    }
  ];
}

test('per-skill report averages treat missing as zero and avoid double-counting multi-skill points', () => {
  const stats = computeReportPeriodGradebookSkillStats(buildSessions(), STUDENT_PERSON, new Map());
  assert.equal(stats.student_gradebook_skill_reading_avg_percent, 75);
  assert.equal(stats.student_gradebook_skill_writing_avg_percent, 37.5);
  assert.equal(stats.student_gradebook_skill_reading_activity_count, 1);
  assert.equal(stats.student_gradebook_skill_writing_activity_count, 2);
});

test('student skill avg ignores class-period columns the student did not earn roster credit on', () => {
  const sessions = [
    {
      sessionId: 'SES/1',
      date: '2026-03-01',
      status: 'completed',
      roster: [{ personId: STUDENT_PERSON, attendance: 'present' }],
      gradebooks: [{
        id: 'GB/extra1',
        totalScore: 100,
        weight: 1,
        includeInGradeCalculation: true,
        skills: ['writing'],
        scores: {}
      }]
    },
    {
      sessionId: 'SES/2',
      date: '2026-03-02',
      status: 'completed',
      roster: [{ personId: STUDENT_PERSON, attendance: 'present' }],
      gradebooks: [{
        id: 'GB/extra2',
        totalScore: 100,
        weight: 1,
        includeInGradeCalculation: true,
        skills: ['writing'],
        scores: {}
      }]
    },
    {
      sessionId: 'SES/3',
      date: '2026-03-08',
      status: 'completed',
      roster: [{ personId: STUDENT_PERSON, attendance: 'present' }],
      gradebooks: [{
        id: 'GB/dual',
        totalScore: 100,
        weight: 1,
        includeInGradeCalculation: true,
        skills: ['reading', 'writing'],
        scores: { [STUDENT_PERSON]: 75 }
      }]
    },
    {
      sessionId: 'SES/4',
      date: '2026-03-09',
      status: 'completed',
      roster: [{ personId: 'PERSON/OTHER', attendance: 'present' }],
      gradebooks: [{
        id: 'GB/other-only',
        totalScore: 100,
        weight: 1,
        includeInGradeCalculation: true,
        skills: ['writing'],
        scores: { 'PERSON/OTHER': 50 }
      }]
    }
  ];
  const stats = computeReportPeriodGradebookSkillStats(sessions, STUDENT_PERSON, new Map());
  assert.equal(stats.student_gradebook_skill_reading_avg_percent, 75);
  assert.equal(stats.student_gradebook_skill_writing_avg_percent, 25);
  assert.equal(stats.student_gradebook_skill_writing_activity_count, 3);
});

test('skill avg falls back to activity percents not points ratio when weighted average is unavailable', () => {
  const original = gradebookWeightService.computeWeightedAveragePercent;
  gradebookWeightService.computeWeightedAveragePercent = () => null;
  try {
    const stats = computeReportPeriodGradebookSkillStats(buildSessions(), STUDENT_PERSON, new Map());
    assert.equal(stats.student_gradebook_skill_reading_avg_percent, 75);
    assert.equal(stats.student_gradebook_skill_writing_avg_percent, 37.5);
    assert.notEqual(stats.student_gradebook_skill_writing_avg_percent, 18.8);
  } finally {
    gradebookWeightService.computeWeightedAveragePercent = original;
  }
});
