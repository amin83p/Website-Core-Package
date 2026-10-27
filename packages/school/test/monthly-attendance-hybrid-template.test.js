const test = require('node:test');
const assert = require('node:assert/strict');
const overallReportTemplateModel = require('../MVC/models/school/overallReportTemplateModel');
const hybridTemplate = require('../../../scripts/school/update-monthly-attendance-hybrid-template');

test('buildPresenceExpression uses flexTwoClassPresence with sourceSlotPopulated', () => {
  const expr = hybridTemplate.buildPresenceExpression('03');
  assert.match(expr, /flexTwoClassPresence/);
  assert.match(expr, /source\("T1", "attendance_presence_03"\)/);
  assert.match(expr, /source\("T2", "attendance_presence_03"\)/);
  assert.match(expr, /sourceSlotPopulated\("T2"\)/);
});

test('buildNoteExpression uses flexTwoClassNote with sourceSlotPopulated', () => {
  const expr = hybridTemplate.buildNoteExpression('03');
  assert.match(expr, /flexTwoClassNote/);
  assert.match(expr, /sourceSlotPopulated\("T2"\)/);
});

test('buildHybridSourceSlots keeps T1 necessary and T2 optional', () => {
  const slots = hybridTemplate.buildHybridSourceSlots([
    { slotKey: 'T1', order: 1, templateId: 'RPTTPL-1', templateVersionAtSelection: 2, requirement: 'necessary' },
    { slotKey: 'T2', order: 2, templateId: 'RPTTPL-1', requirement: 'optional' }
  ]);
  assert.equal(slots.length, 2);
  assert.equal(slots[0].slotKey, 'T1');
  assert.equal(slots[0].requirement, 'necessary');
  assert.equal(slots[1].slotKey, 'T2');
  assert.equal(slots[1].requirement, 'optional');
});

test('transformTemplateFields removes am/pm class fields and rewrites day expressions', () => {
  const fields = [
    { id: 'am_class', label: 'AM', type: 'text', overallValueMode: 'manual' },
    { id: 'day01_yn', label: 'D1', type: 'text', overallValueMode: 'derived_locked', calculationRule: { expression: 'twoClassPresence()' } },
    { id: 'day01_note', label: 'N1', type: 'text', overallValueMode: 'derived_locked', calculationRule: { expression: 'twoClassNote()' } },
    { id: 'pm_class', label: 'PM', type: 'text', overallValueMode: 'manual' }
  ];
  for (let day = 2; day <= hybridTemplate.DAY_COUNT; day += 1) {
    const dd = String(day).padStart(2, '0');
    fields.push(
      { id: `day${dd}_yn`, label: `Y${dd}`, type: 'text', overallValueMode: 'derived_locked', calculationRule: { expression: 'x' } },
      { id: `day${dd}_note`, label: `N${dd}`, type: 'text', overallValueMode: 'derived_locked', calculationRule: { expression: 'x' } }
    );
  }

  const out = hybridTemplate.transformTemplateFields(fields);
  assert.equal(out.some((field) => field.id === 'am_class'), false);
  assert.equal(out.some((field) => field.id === 'pm_class'), false);
  const day15Yn = out.find((field) => field.id === 'day15_yn');
  const day15Note = out.find((field) => field.id === 'day15_note');
  assert.equal(day15Yn.calculationRule.expression, hybridTemplate.buildPresenceExpression('15'));
  assert.equal(day15Note.calculationRule.expression, hybridTemplate.buildNoteExpression('15'));
});

test('buildSanitizedHybridTemplate produces valid two-slot hybrid template', () => {
  const fields = [];
  for (let day = 1; day <= hybridTemplate.DAY_COUNT; day += 1) {
    const dd = String(day).padStart(2, '0');
    fields.push(
      { id: `day${dd}_yn`, label: `Y${dd}`, type: 'text', overallValueMode: 'derived_locked', calculationRule: { enabled: true, expression: 'twoClassPresence()', onError: 'keep_last' } },
      { id: `day${dd}_note`, label: `N${dd}`, type: 'text', overallValueMode: 'derived_locked', calculationRule: { enabled: true, expression: 'twoClassNote()', onError: 'keep_last' } }
    );
  }
  const existing = overallReportTemplateModel.sanitizeTemplate({
    orgId: '900000',
    title: 'Monthly Attendance Report',
    version: 1,
    status: 'active',
    sourceSlots: [
      { slotKey: 'T1', order: 1, templateId: 'RPTTPL-2026-OVERALL-ATTENDANCE', templateVersionAtSelection: 1, requirement: 'necessary' },
      { slotKey: 'T2', order: 2, templateId: 'RPTTPL-2026-OVERALL-ATTENDANCE', templateVersionAtSelection: 1, requirement: 'optional' }
    ],
    schema: { version: 1, fields },
    placeholderMap: {}
  });

  const sanitized = hybridTemplate.buildSanitizedHybridTemplate(existing);
  assert.equal(sanitized.sourceSlots.length, 2);
  assert.equal(sanitized.sourceSlots[1].requirement, 'optional');
  assert.equal(sanitized.schema.fields.find((field) => field.id === 'day15_yn')?.calculationRule?.expression,
    hybridTemplate.buildPresenceExpression('15'));
});
