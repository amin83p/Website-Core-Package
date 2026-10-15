const test = require('node:test');
const assert = require('node:assert/strict');

const naming = require('../MVC/services/school/classTemplateNamingService');
const snapshot = require('../MVC/services/school/classTemplateSnapshotService');

test('applyTitlePattern fills EAL example tokens with static delivery segment', () => {
  const title = naming.applyTitlePattern('EAL-{{period}}-I/{{format}}-{{teacherName}}', {
    period: 'PM',
    format: 'group',
    teacherName: 'Jane Doe'
  });
  assert.equal(title, 'EAL-PM-I/G-Jane Doe');
});

test('applyTitlePattern rejects {{delivery}} placeholder in pattern', () => {
  assert.throws(
    () => naming.applyTitlePattern('EAL-{{period}}-{{delivery}}/{{format}}-{{teacherName}}', {
      period: 'PM',
      format: 'group',
      teacherName: 'Jane Doe'
    }),
    /must not use \{\{delivery\}\}/i
  );
});

test('assertTitlePatternAllowsNoDeliveryPlaceholder on save validation', () => {
  assert.throws(
    () => naming.assertTitlePatternAllowsNoDeliveryPlaceholder('foo-{{delivery}}-bar'),
    /must not use \{\{delivery\}\}/i
  );
  naming.assertTitlePatternAllowsNoDeliveryPlaceholder('EAL-{{period}}-I/{{format}}-{{teacherName}}');
});

test('applyTitlePattern rejects empty resolved title', () => {
  assert.throws(
    () => naming.applyTitlePattern('{{teacherName}}', { teacherName: '' }),
    /empty/i
  );
});

test('stripForbiddenSnapshotFields removes instructors and sessions', () => {
  const cleaned = snapshot.stripForbiddenSnapshotFields({
    instructors: [{ personId: '1' }],
    sessions: [{ id: 's1' }],
    curriculum: { subjects: [] }
  });
  assert.equal(cleaned.instructors, undefined);
  assert.equal(cleaned.sessions, undefined);
  assert.deepEqual(cleaned.curriculum, { subjects: [] });
});

test('applyStartDateToSnapshot sets rolling cycle and program term dates', () => {
  const next = snapshot.applyStartDateToSnapshot({
    registrationMode: 'rolling',
    allowedProgramTerms: [{ programId: 'P1', termId: 'T1' }]
  }, '2026-09-01');
  assert.equal(next.cycleStartDate, '2026-09-01');
  assert.equal(next.allowedProgramTerms[0].classesStartDate, '2026-09-01');
});
