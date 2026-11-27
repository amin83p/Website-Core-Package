'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../MVC/services/school/schoolAiOutputFieldSyncService');
const binding = require('../MVC/services/school/reportTemplateAiBindingService');

const BIMPR_SECTIONS = {
  layout: 'sections',
  sections: [
    {
      resultKey: 'goal_1',
      title: 'Goal 1',
      actions: ['copy', 'apply'],
      inputId: 'goal_1',
      valueField: 'revised',
      changeTypeField: 'changeType',
      changeSummaryField: 'changeSummary'
    }
  ]
};

test('buildAiAssistDisplayUnits uses dot-path applyBindingKey for grouped sections', () => {
  const definition = {
    output: {
      mode: 'json',
      jsonSchema: { type: 'object', properties: {}, 'x-reportUi': BIMPR_SECTIONS }
    },
    outputs: [
      { resultKey: 'goal_1.revised', label: 'Goal 1 revised', type: 'text', status: 'active', actions: ['apply', 'copy'] },
      { resultKey: 'goal_1.changeType', label: 'Change type', type: 'text', status: 'active', actions: ['copy'] }
    ]
  };
  const units = sync.buildAiAssistDisplayUnits(definition, BIMPR_SECTIONS);
  const section = units.find((row) => row.mode === 'section' && row.unitKey === 'goal_1');
  assert.ok(section, 'expected grouped section unit');
  assert.equal(section.applyBindingKey, 'goal_1.revised');
  const leafDup = units.filter((row) => row.mode === 'leaf' && row.unitKey === 'goal_1.revised');
  assert.equal(leafDup.length, 0, 'apply leaf should not duplicate section card');
});

test('buildAiAssistDisplayUnits emits leaf cards for leaf-only outputs', () => {
  const definition = {
    output: { mode: 'json', jsonSchema: { type: 'object', properties: {} } },
    outputs: [
      { resultKey: 'pronunciation', label: 'Pronunciation', type: 'text', status: 'active', actions: ['copy', 'apply'] },
      { resultKey: 'meaning', label: 'Meaning', type: 'textarea', status: 'active', actions: ['copy', 'apply'] }
    ]
  };
  const units = sync.buildAiAssistDisplayUnits(definition, null);
  assert.equal(units.length, 2);
  assert.ok(units.every((row) => row.mode === 'leaf'));
  assert.equal(units[0].applyBindingKey, 'pronunciation');
});

test('buildCatalogEntryFromBinding includes displayUnits', () => {
  const entry = binding.buildCatalogEntryFromBinding(
    {
      id: 'ai_bimpr',
      serviceKey: 'school.bimpr_goals_checker',
      outputBindings: { 'goal_1.revised': { source: 'field', value: 'futuregoal_listening' } }
    },
    {
      prompt: { userPromptTemplate: 'Goals' },
      inputs: [{ id: 'goal_1', type: 'textarea', label: 'Goal 1' }],
      output: {
        mode: 'json',
        jsonSchema: {
          type: 'object',
          properties: {},
          'x-reportUi': BIMPR_SECTIONS
        }
      },
      outputs: [
        { resultKey: 'goal_1.revised', label: 'Goal 1 revised', type: 'text', status: 'active', actions: ['apply', 'copy'] }
      ]
    }
  );
  assert.ok(entry);
  assert.ok(Array.isArray(entry.displayUnits) && entry.displayUnits.length);
  assert.equal(entry.displayUnits[0].applyBindingKey, 'goal_1.revised');
});