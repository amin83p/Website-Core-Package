/**
 * Report "shared across students" merge and partition (each_student scope).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const reportService = require('../MVC/services/school/reportService');

test('mergeTemplateData uses assignment.sharedAnswers for shared fields when each_student', () => {
  const template = {
    schema: {
      fields: [
        { id: 'common', type: 'text', sharedAcrossStudents: true },
        { id: 'per', type: 'text', sharedAcrossStudents: false }
      ]
    }
  };
  const instance = {
    answers: { per: 'p1' },
    prefillSnapshot: {}
  };
  const assignment = {
    reportScope: 'each_student',
    sharedAnswers: { common: 'ALL' }
  };
  const merged = reportService.mergeTemplateData(template, instance, assignment);
  assert.equal(merged.common, 'ALL');
  assert.equal(merged.per, 'p1');
});

test('mergeTemplateData prefers prefill snapshot for readOnly fields with prefillKey', () => {
  const template = {
    schema: {
      fields: [
        { id: 'ro', type: 'text', readOnly: true, prefillKey: 'teacher_name' }
      ]
    }
  };
  const instance = {
    answers: { ro: 'stale from old save' },
    prefillSnapshot: { teacher_name: 'Ms. Smith' }
  };
  const merged = reportService.mergeTemplateData(template, instance, null);
  assert.equal(merged.ro, 'Ms. Smith');
});

test('partitionInstanceSave splits shared vs student answers for each_student', () => {
  const template = {
    schema: {
      fields: [
        { id: 's', type: 'text', sharedAcrossStudents: true },
        { id: 't', type: 'text', sharedAcrossStudents: false }
      ]
    }
  };
  const assignment = { reportScope: 'each_student' };
  const full = { s: 'sharedVal', t: 'studentVal' };
  const { studentAnswers, sharedAnswers } = reportService.partitionInstanceSave(template, assignment, full);
  assert.deepEqual(sharedAnswers, { s: 'sharedVal' });
  assert.deepEqual(studentAnswers, { t: 'studentVal' });
});

test('partitionInstanceSave puts all fields on student when scope is class', () => {
  const template = {
    schema: {
      fields: [
        { id: 's', type: 'text', sharedAcrossStudents: true },
        { id: 't', type: 'text', sharedAcrossStudents: false }
      ]
    }
  };
  const assignment = { reportScope: 'class' };
  const full = { s: 'a', t: 'b' };
  const { studentAnswers, sharedAnswers } = reportService.partitionInstanceSave(template, assignment, full);
  assert.deepEqual(studentAnswers, { s: 'a', t: 'b' });
  assert.deepEqual(sharedAnswers, {});
});

test('partitionInstanceSave ignores visual-only section/subheader rows', () => {
  const template = {
    schema: {
      fields: [
        { id: '__section_1', type: 'section' },
        { id: '__sub_1', type: 'subheader' },
        { id: 's', type: 'text', sharedAcrossStudents: true },
        { id: 't', type: 'text', sharedAcrossStudents: false }
      ]
    }
  };
  const assignment = { reportScope: 'each_student' };
  const full = { __section_1: 'x', __sub_1: 'y', s: 'a', t: 'b' };
  const { studentAnswers, sharedAnswers } = reportService.partitionInstanceSave(template, assignment, full);
  assert.deepEqual(sharedAnswers, { s: 'a' });
  assert.deepEqual(studentAnswers, { t: 'b' });
});

test('mergeTemplateData does not emit values for visual-only rows', () => {
  const template = {
    schema: {
      fields: [
        { id: '__section_1', type: 'section' },
        { id: 'per', type: 'text', sharedAcrossStudents: false }
      ]
    }
  };
  const instance = {
    answers: { per: 'ok', __section_1: 'should_not_surface' },
    prefillSnapshot: {}
  };
  const merged = reportService.mergeTemplateData(template, instance, { reportScope: 'class' });
  assert.equal(merged.per, 'ok');
  assert.equal(Object.prototype.hasOwnProperty.call(merged, '__section_1'), false);
});
