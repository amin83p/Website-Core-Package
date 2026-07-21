const test = require('node:test');
const assert = require('node:assert/strict');

const gradebookSkillCatalogService = require('../packages/school/MVC/services/school/gradebookSkillCatalogService');
const reportService = require('../packages/school/MVC/services/school/reportService');

test('normalizeGradebookSkillIds validates catalog slugs and deduplicates', () => {
  assert.deepEqual(
    gradebookSkillCatalogService.normalizeGradebookSkillIds(['listening', 'LISTENING', 'reading', 'invalid']),
    ['listening', 'reading']
  );
  assert.deepEqual(gradebookSkillCatalogService.normalizeGradebookSkillIds('typing'), ['typing']);
});

test('formatGradebookSkillLabels returns comma-separated labels', () => {
  assert.equal(
    gradebookSkillCatalogService.formatGradebookSkillLabels(['listening', 'reading']),
    'Listening, Reading'
  );
});

test('matchSkillIdsFromLegacyText migrates free-text skillFocus', () => {
  assert.deepEqual(
    gradebookSkillCatalogService.matchSkillIdsFromLegacyText('Reading, Writing practice'),
    ['reading', 'writing']
  );
  assert.deepEqual(
    gradebookSkillCatalogService.matchSkillIdsFromLegacyText('PowerPoint and Excel'),
    ['excel', 'powerpoint']
  );
});

test('normalizeGradebookActivitySkills derives skillFocus from skills', () => {
  const normalized = gradebookSkillCatalogService.normalizeGradebookActivitySkills({
    skills: ['email', 'zoom'],
    skillFocus: 'legacy text'
  });
  assert.deepEqual(normalized.skills, ['email', 'zoom']);
  assert.equal(normalized.skillFocus, 'Email, ZOOM');
});

test('normalizeGradebookActivitySkills migrates legacy skillFocus when skills missing', () => {
  const normalized = gradebookSkillCatalogService.normalizeGradebookActivitySkills({
    skillFocus: 'Listening comprehension and Speaking drills'
  });
  assert.deepEqual(normalized.skills, ['listening', 'speaking']);
  assert.equal(normalized.skillFocus, 'Listening, Speaking');
});

test('normalizeSessionSkillsCovered keeps unique skills with notes and drops invalid ids', () => {
  const normalized = gradebookSkillCatalogService.normalizeSessionSkillsCovered([
    { skillId: 'listening', note: 'Introduced short dialogues' },
    { skillId: 'listening', note: 'Duplicate should be ignored' },
    { skillId: 'not-a-skill', note: 'Invalid' },
    { skillId: 'reading', note: '  Chapter 2 skim  ' },
    { id: 'writing', notes: 'Paragraph outlines' }
  ]);
  assert.deepEqual(normalized, [
    { skillId: 'listening', skillLabel: 'Listening', note: 'Introduced short dialogues' },
    { skillId: 'reading', skillLabel: 'Reading', note: 'Chapter 2 skim' },
    { skillId: 'writing', skillLabel: 'Writing', note: 'Paragraph outlines' }
  ]);
});

test('normalizeSessionSkillsCovered accepts JSON string payloads', () => {
  const normalized = gradebookSkillCatalogService.normalizeSessionSkillsCovered(
    JSON.stringify([{ skillId: 'zoom', note: 'Breakout rooms' }])
  );
  assert.deepEqual(normalized, [
    { skillId: 'zoom', skillLabel: 'ZOOM', note: 'Breakout rooms' }
  ]);
});

test('getPrefillCatalog includes programmatic gradebook skill keys', () => {
  const catalog = reportService.getPrefillCatalog();
  assert.ok(Array.isArray(catalog.gradebookPeriodSkillsClass));
  assert.ok(Array.isArray(catalog.gradebookPeriodSkillsStudent));
  assert.equal(catalog.gradebookPeriodSkillsClass.length, 11 * 6);
  assert.equal(catalog.gradebookPeriodSkillsStudent.length, 11 * 6);
  assert.ok(catalog.gradebookPeriodSkillsStudent.some((item) => item.key === 'student_gradebook_skill_listening_avg_percent'));
  assert.ok(catalog.gradebookPeriodSkillsClass.some((item) => item.key === 'class_gradebook_skill_reading_points_possible'));
});
