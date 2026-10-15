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
  assert.equal(title, 'EAL-PM-I/G-JANE');
});

test('formatFromStudentCount maps 1 to 1 and 2+ to G', () => {
  assert.equal(naming.formatFromStudentCount(1), '1');
  assert.equal(naming.formatFromStudentCount(8), 'G');
  assert.throws(() => naming.formatFromStudentCount(0), /integer from 1 to 30/i);
  assert.throws(() => naming.formatFromStudentCount(31), /integer from 1 to 30/i);
});

test('applyTitlePattern derives format from studentCount', () => {
  const one = naming.applyTitlePattern('EAL-{{period}}-I/{{format}}-{{teacherName}}', {
    period: 'AM',
    studentCount: 1,
    teacherName: 'Jane Doe'
  });
  assert.equal(one, 'EAL-AM-I/1-JANE');
  const group = naming.applyTitlePattern('EAL-{{period}}-I/{{format}}-{{teacherName}}', {
    period: 'PM',
    studentCount: 12,
    teacherName: { firstName: 'sam' }
  });
  assert.equal(group, 'EAL-PM-I/G-SAM');
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

test('buildSnapshotFromClassFormBody normalizes isClosedForNewEnrollment boolean', () => {
  const openSnapshot = snapshot.buildSnapshotFromClassFormBody({ isClosedForNewEnrollment: 'false' });
  const closedSnapshot = snapshot.buildSnapshotFromClassFormBody({ isClosedForNewEnrollment: 'true' });
  assert.equal(openSnapshot.isClosedForNewEnrollment, false);
  assert.equal(closedSnapshot.isClosedForNewEnrollment, true);
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
