'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const reportTemplateModel = require('../MVC/models/school/reportTemplateModel');
const coverageService = require('../MVC/services/school/reportPeriodGradebookSkillCoverageService');

test('sanitizeTemplate persists requiredGradebookSkills and rejects invalid ids', () => {
  const sanitized = reportTemplateModel.sanitizeTemplate({
    orgId: 'ORG1',
    type: 'progress',
    title: 'Test',
    status: 'draft',
    schema: { fields: [] },
    requiredGradebookSkills: ['reading', 'reading', 'writing'],
    requireGradebookSkillsBeforeFill: true
  });
  assert.deepEqual(sanitized.requiredGradebookSkills, ['reading', 'writing']);
  assert.equal(sanitized.requireGradebookSkillsBeforeFill, true);
  assert.throws(() => reportTemplateModel.sanitizeTemplate({
    orgId: 'ORG1',
    type: 'progress',
    title: 'Test',
    status: 'draft',
    schema: { fields: [] },
    requiredGradebookSkills: ['not_a_real_skill']
  }), /Invalid gradebook skill id/);
});

test('extractSkillIdsFromTemplateSchema reads student gradebook skill prefill keys', () => {
  const ids = coverageService.extractSkillIdsFromTemplateSchema({
    fields: [
      { id: 'f1', label: 'R', type: 'text', prefillKey: 'student_gradebook_skill_reading_avg_percent' },
      { id: 'f2', label: 'W', type: 'text', prefillKey: 'student_gradebook_skill_writing_activity_count' },
      { id: 'f3', label: 'N', type: 'text', prefillKey: 'teacher_name' }
    ]
  });
  assert.deepEqual(ids.sort(), ['reading', 'writing'].sort());
});

test('evaluatePeriodSkillCoverage detects missing and covered skills', () => {
  const sessions = [
    {
      sessionId: 'S1',
      date: '2026-03-05',
      gradebooks: [{
        id: 'GB1',
        name: 'Quiz',
        skills: ['reading', 'writing'],
        scores: {}
      }]
    },
    {
      sessionId: 'S2',
      date: '2026-03-20',
      gradebooks: [{
        id: 'GB2',
        name: 'Out of period',
        skills: ['speaking'],
        scores: {}
      }]
    }
  ];
  const result = coverageService.evaluatePeriodSkillCoverage({
    requiredSkillIds: ['reading', 'speaking'],
    sessions,
    startDate: '2026-03-01',
    endDate: '2026-03-10'
  });
  assert.equal(result.ready, false);
  assert.equal(result.coveredSkills.length, 1);
  assert.equal(result.coveredSkills[0].id, 'reading');
  assert.equal(result.missingSkills.length, 1);
  assert.equal(result.missingSkills[0].id, 'speaking');
});

test('buildSessionSkillCoveragePayload gateActive false when no required skills configured', () => {
  const payload = coverageService.buildSessionSkillCoveragePayload({
    assignments: [],
    sessionContext: { classId: 'C1', sessionId: 'S1' },
    templatesById: new Map(),
    instanceRows: [],
    sessions: [],
    periodStart: '2026-03-01',
    periodDue: '2026-03-31'
  });
  assert.equal(payload.gateActive, false);
  assert.equal(payload.ready, true);
});
