const test = require('node:test');
const assert = require('node:assert/strict');

const {
  expandKeysForApply,
  resolveMirrorGroup,
  collapseMirrorPrefillChanges
} = require('../MVC/services/school/reportPrefillMirrorKeys');

test('expandKeysForApply mirrors attendance keys on each_student scope', () => {
  const expanded = expandKeysForApply('each_student', ['class_attendance_present']);
  assert.ok(expanded.includes('student_attendance_span_percent'));
  assert.ok(expanded.includes('class_attendance_present'));
});

test('expandKeysForApply does not mirror on class scope', () => {
  const expanded = expandKeysForApply('class', ['class_attendance_present']);
  assert.deepEqual(expanded, ['class_attendance_present']);
});

test('resolveMirrorGroup returns empty group equivalent for class scope', () => {
  const group = resolveMirrorGroup('class', 'class_attendance_present');
  assert.deepEqual(group, ['class_attendance_present']);
});

test('collapseMirrorPrefillChanges merges duplicate attendance preview rows', () => {
  const changes = [
    {
      prefillKey: 'student_attendance_span_percent',
      newRawValue: 60.07,
      fields: [{ fieldId: 'Attendance', newValue: 60.07, currentValue: 25 }]
    },
    {
      prefillKey: 'class_attendance_present',
      newRawValue: 60.07,
      fields: [{ fieldId: 'Attendance', newValue: 60.07, currentValue: 25 }]
    }
  ];
  const template = {
    schema: {
      fields: [{
        id: 'Attendance',
        label: 'Attendance',
        prefillKey: 'student_attendance_span_percent'
      }]
    }
  };
  const collapsed = collapseMirrorPrefillChanges(changes, {
    reportScope: 'each_student',
    template
  });
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].prefillKey, 'student_attendance_span_percent');
  assert.ok((collapsed[0].mirrorKeys || []).includes('class_attendance_present'));
});