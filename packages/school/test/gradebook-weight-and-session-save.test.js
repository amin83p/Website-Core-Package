const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const sessionGradebookService = require('../MVC/services/school/sessionGradebookService');
const reportServiceSource = fs.readFileSync(
  path.join(__dirname, '../MVC/services/school/reportService.js'),
  'utf8'
);
const sessionManagerSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/class/sessionManager.ejs'),
  'utf8'
);

test('normalizeSessionGradebooksFromRequest persists weight and sanitized attachments', () => {
  const normalized = sessionGradebookService.normalizeSessionGradebooksFromRequest([
    {
      id: 'gb1',
      name: 'Quiz',
      weight: 25,
      totalScore: 10,
      includeInGradeCalculation: true,
      scores: { p1: 8 },
      attachments: [
        {
          id: 'att1',
          name: 'Test paper.pdf',
          url: '/uploads/test.pdf',
          role: 'test',
          uploadedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  ], {
    personIds: ['p1'],
    attendanceByPerson: new Map([['p1', 'present']]),
    existingGradebookById: new Map(),
    sessionSkillPolicy: { selectableIds: [], catalog: [] },
    mergeHistoricalGradebookSkills: (_incoming, _existing, _ids) => []
  });

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].weight, 25);
  assert.equal(normalized[0].totalScore, 10);
  assert.equal(normalized[0].attachments.length, 1);
});

test('normalizeSessionGradebooksFromRequest defaults weight to totalScore when omitted', () => {
  const normalized = sessionGradebookService.normalizeSessionGradebooksFromRequest([
    {
      id: 'gb1',
      name: 'Quiz',
      totalScore: 15,
      includeInGradeCalculation: true,
      scores: { p1: 12 }
    }
  ], {
    personIds: ['p1'],
    attendanceByPerson: new Map([['p1', 'present']]),
    existingGradebookById: new Map(),
    sessionSkillPolicy: { selectableIds: [], catalog: [] },
    mergeHistoricalGradebookSkills: (_incoming, _existing, _ids) => []
  });

  assert.equal(normalized[0].weight, 15);
});

test('reportService period avg_percent uses gradebookWeightService', () => {
  assert.match(reportServiceSource, /gradebookWeightService\.computeWeightedAveragePercent/);
  assert.match(reportServiceSource, /resolveGradebookColumnScore/);
});

test('sessionManager saves gradebooks with weight and total points fields', () => {
  assert.doesNotMatch(sessionManagerSource, /id="btnSaveGradebooks"/);
  assert.match(sessionManagerSource, /markSessionAutosaveGradebookDirty/);
  assert.match(sessionManagerSource, /payload\.gradebooks = JSON\.stringify\(gradebooksState\)/);
  assert.match(sessionManagerSource, /gbModalWeight/);
  assert.match(sessionManagerSource, /gbGradePercentContribution/);
  assert.match(sessionManagerSource, /gbFormatWeightContribution/);
  assert.match(sessionManagerSource, /Worth <strong>/);
  assert.match(sessionManagerSource, /of grade/);
  assert.match(sessionManagerSource, /periodGradebookOtherWeightTotal/);
  assert.doesNotMatch(sessionManagerSource, /gbWeightedContribution/);
  assert.match(sessionManagerSource, /gbModalAttachmentsList/);
  assert.match(sessionManagerSource, /String\(g\.id\) === String\(editId\)/);
});

test('sessionManager attendance roster includes order column and name sort', () => {
  assert.match(sessionManagerSource, /attendance-order-cell/);
  assert.match(sessionManagerSource, /id="attendanceSortName"/);
  assert.match(sessionManagerSource, /sortAttendanceRosterByName/);
  assert.match(sessionManagerSource, /refreshAttendanceOrderNumbers/);
});

test('sessionManager details modal supports removable excuse attachment chip', () => {
  assert.match(sessionManagerSource, /renderExcuseAttachmentPreview/);
  assert.match(sessionManagerSource, /att-excuse-chip-remove/);
  assert.match(sessionManagerSource, /excuseAttachmentId/);
});

test('normalizeSessionGradebooksFromRequest keeps explicit weight distinct from auto default', () => {
  const explicit = sessionGradebookService.normalizeSessionGradebooksFromRequest([
    {
      id: 'gb1',
      name: 'Quiz',
      weight: 25,
      totalScore: 15,
      includeInGradeCalculation: true,
      scores: { p1: 12 }
    }
  ], {
    personIds: ['p1'],
    attendanceByPerson: new Map([['p1', 'present']]),
    existingGradebookById: new Map(),
    sessionSkillPolicy: { selectableIds: [], catalog: [] },
    mergeHistoricalGradebookSkills: (_incoming, _existing, _ids) => []
  });
  assert.equal(explicit[0].weight, 25);
  assert.notEqual(explicit[0].weight, explicit[0].totalScore);
});
