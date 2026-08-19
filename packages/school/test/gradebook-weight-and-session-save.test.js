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

test('normalizeSessionGradebooksFromRequest persists sanitized attachments', () => {
  const normalized = sessionGradebookService.normalizeSessionGradebooksFromRequest([
    {
      id: 'gb1',
      name: 'Quiz',
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
        },
        {
          name: 'bad',
          url: '',
          role: 'test'
        },
        {
          name: 'hack.exe',
          url: '/uploads/hack.exe',
          role: 'invalid_role'
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
  assert.equal(normalized[0].attachments.length, 1);
  assert.equal(normalized[0].attachments[0].role, 'test');
  assert.equal(normalized[0].attachments[0].name, 'Test paper.pdf');
});

test('reportService period avg_percent uses earned over possible', () => {
  assert.match(reportServiceSource, /student_gradebook_period_avg_percent:\s*percentFromEarnedPossible\(studentEarned, studentPossible\)/);
  assert.match(reportServiceSource, /class_gradebook_period_avg_percent:\s*percentFromEarnedPossible\(classEarned, classPossible\)/);
  assert.match(reportServiceSource, /Weighted average percent/);
});

test('sessionManager saves gradebooks via Save session', () => {
  assert.doesNotMatch(sessionManagerSource, /id="btnSaveGradebooks"/);
  assert.match(sessionManagerSource, /markSessionAutosaveGradebookDirty/);
  assert.match(sessionManagerSource, /payload\.gradebooks = JSON\.stringify\(gradebooksState\)/);
  assert.match(sessionManagerSource, /gb-total-score-info/);
  assert.match(sessionManagerSource, /gbModalAttachmentsList/);
});
