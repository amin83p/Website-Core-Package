const test = require('node:test');
const assert = require('node:assert/strict');
const overallReportTemplateModel = require('../MVC/models/school/overallReportTemplateModel');
const singleClassTemplate = require('../../../scripts/school/update-monthly-attendance-single-class-template');

test('buildPresenceExpression uses T1 attendance presence only', () => {
  assert.equal(
    singleClassTemplate.buildPresenceExpression('15'),
    'source("T1", "attendance_presence_15")'
  );
});

test('buildNoteExpression uses T1 attendance note only', () => {
  assert.equal(
    singleClassTemplate.buildNoteExpression('15'),
    'source("T1", "attendance_note_15")'
  );
});

test('buildSingleSourceSlots keeps one necessary T1 slot', () => {
  const slots = singleClassTemplate.buildSingleSourceSlots([
    { slotKey: 'T1', order: 1, templateId: 'RPTTPL-1', templateVersionAtSelection: 2, requirement: 'necessary' },
    { slotKey: 'T2', order: 2, templateId: 'RPTTPL-1', requirement: 'optional' }
  ]);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].slotKey, 'T1');
  assert.equal(slots[0].requirement, 'necessary');
  assert.equal(slots[0].templateId, 'RPTTPL-1');
  assert.equal(slots[0].templateVersionAtSelection, 2);
});

test('transformTemplateFields removes am/pm class fields and rewrites day expressions', () => {
  const fields = [
    { id: 'am_class', label: 'AM', type: 'text', overallValueMode: 'manual' },
    { id: 'day01_yn', label: 'D1', type: 'text', overallValueMode: 'derived_locked', calculationRule: { expression: 'twoClassPresence()' } },
    { id: 'day01_note', label: 'N1', type: 'text', overallValueMode: 'derived_locked', calculationRule: { expression: 'twoClassNote()' } },
    { id: 'pm_class', label: 'PM', type: 'text', overallValueMode: 'manual' }
  ];
  for (let day = 2; day <= singleClassTemplate.DAY_COUNT; day += 1) {
    const dd = String(day).padStart(2, '0');
    fields.push(
      { id: `day${dd}_yn`, label: `Y${dd}`, type: 'text', overallValueMode: 'derived_locked', calculationRule: { expression: 'x' } },
      { id: `day${dd}_note`, label: `N${dd}`, type: 'text', overallValueMode: 'derived_locked', calculationRule: { expression: 'x' } }
    );
  }

  const out = singleClassTemplate.transformTemplateFields(fields);
  assert.equal(out.some((field) => field.id === 'am_class'), false);
  assert.equal(out.some((field) => field.id === 'pm_class'), false);
  const day15Yn = out.find((field) => field.id === 'day15_yn');
  const day15Note = out.find((field) => field.id === 'day15_note');
  assert.equal(day15Yn.calculationRule.expression, singleClassTemplate.buildPresenceExpression('15'));
  assert.equal(day15Note.calculationRule.expression, singleClassTemplate.buildNoteExpression('15'));
});

test('buildSanitizedSingleClassTemplate produces valid single-slot template', () => {
  const fields = [];
  for (let day = 1; day <= singleClassTemplate.DAY_COUNT; day += 1) {
    const dd = String(day).padStart(2, '0');
    fields.push(
      { id: `day${dd}_yn`, label: `Y${dd}`, type: 'text', overallValueMode: 'derived_locked', calculationRule: { enabled: true, expression: 'twoClassPresence()', onError: 'keep_last' } },
      { id: `day${dd}_note`, label: `N${dd}`, type: 'text', overallValueMode: 'derived_locked', calculationRule: { enabled: true, expression: 'twoClassNote()', onError: 'keep_last' } }
    );
  }
  const existing = overallReportTemplateModel.sanitizeTemplate({
    orgId: '900000',
    title: 'Monthly Attendance Report - Single Class',
    version: 1,
    status: 'active',
    sourceSlots: [
      { slotKey: 'T1', order: 1, templateId: 'RPTTPL-2026-OVERALL-ATTENDANCE', templateVersionAtSelection: 1, requirement: 'necessary' },
      { slotKey: 'T2', order: 2, templateId: 'RPTTPL-2026-OVERALL-ATTENDANCE', templateVersionAtSelection: 1, requirement: 'optional' }
    ],
    schema: { version: 1, fields },
    placeholderMap: {}
  });

  const sanitized = singleClassTemplate.buildSanitizedSingleClassTemplate(existing);
  assert.equal(sanitized.sourceSlots.length, 1);
  assert.equal(sanitized.sourceSlots[0].slotKey, 'T1');
  assert.equal(sanitized.schema.fields.find((field) => field.id === 'day15_yn')?.calculationRule?.expression,
    singleClassTemplate.buildPresenceExpression('15'));
});
