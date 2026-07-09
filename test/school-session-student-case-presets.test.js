const test = require('node:test');
const assert = require('node:assert/strict');

const presetService = require('../packages/school/MVC/services/school/sessionStudentCasePresetService');
const { sanitizeCaseInput } = require('../packages/school/MVC/models/school/sessionStudentCaseModel');

test('sessionStudentCasePresetService exposes five presets for standard categories', () => {
  ['learning', 'technology', 'engagement', 'behavior', 'support', 'resources', 'lesson_delivery'].forEach((category) => {
    const presets = presetService.getPresetsForCategory(category);
    assert.equal(presets.length, 5, `${category} should have 5 presets`);
  });
  assert.deepEqual(presetService.getPresetsForCategory('other'), []);
});

test('deriveCaseSummary builds category-prefixed summary text', () => {
  const summary = presetService.deriveCaseSummary('learning', 'Struggled with today\'s material');
  assert.equal(summary, 'Learning: Struggled with today\'s material');
  assert.equal(presetService.isPresetDetail('learning', 'Struggled with today\'s material'), true);
  assert.equal(presetService.isPresetDetail('learning', 'Custom issue'), false);
});

test('sanitizeCaseInput requires details and derives summary when omitted', () => {
  const row = sanitizeCaseInput({
    orgId: 'ORG-1',
    classId: 'CLS-1',
    sessionId: 'SES-1',
    studentPersonId: 'STU-1',
    category: 'behavior',
    severity: 'warning',
    details: 'Disruptive to class'
  });
  assert.equal(row.details, 'Disruptive to class');
  assert.equal(row.summary, 'Behavior: Disruptive to class');
});

test('sanitizeCaseInput rejects missing details', () => {
  assert.throws(() => sanitizeCaseInput({
    orgId: 'ORG-1',
    classId: 'CLS-1',
    sessionId: 'SES-1',
    studentPersonId: 'STU-1',
    category: 'learning',
    summary: 'Legacy summary only'
  }), /issue details are required/i);
});
