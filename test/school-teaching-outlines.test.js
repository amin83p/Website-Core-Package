'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const teachingOutlineCatalogService = require('../packages/school/MVC/services/school/teachingOutlineCatalogService');
const teachingOutlineSuggestionService = require('../packages/school/MVC/services/school/teachingOutlineSuggestionService');
const studentTeachingCoverageService = require('../packages/school/MVC/services/school/studentTeachingCoverageService');
const gradebookSkillCatalogService = require('../packages/school/MVC/services/school/gradebookSkillCatalogService');

test('resolveLevelFromStudentText matches CLB aliases', () => {
  const levels = [
    { id: 'l3', code: 'clb_3', title: 'CLB 3', isActive: true, matchAliases: ['CLB 3', '3', 'clb_3'] },
    { id: 'l4', code: 'clb_4', title: 'CLB 4', isActive: true, matchAliases: ['CLB 4', '4'] }
  ];
  const resolved = teachingOutlineCatalogService.resolveLevelFromStudentText(levels, 'CLB 3');
  assert.equal(resolved?.id, 'l3');
  assert.equal(teachingOutlineCatalogService.resolveLevelFromStudentText(levels, '3')?.id, 'l3');
});

test('buildItemTree groups items by section template', () => {
  const template = {
    sections: [
      { key: 'grammar', title: 'Grammar', isSelectable: true, displayOrder: 1 },
      { key: 'tasks', title: 'Tasks', isSelectable: true, allowsGroups: true, displayOrder: 2 }
    ]
  };
  const items = [
    { id: 'g1', sectionKey: 'grammar', label: 'Simple Past', itemKind: 'checklist', isSelectable: true, isActive: true, displayOrder: 1, parentId: null },
    { id: 't1', sectionKey: 'tasks', label: 'Write email', itemKind: 'checklist', isSelectable: true, isActive: true, displayOrder: 2, parentId: null }
  ];
  const tree = teachingOutlineCatalogService.buildItemTree(items, template);
  assert.equal(tree.length, 2);
  assert.equal(tree[0].items.length, 1);
  assert.equal(tree[0].items[0].label, 'Simple Past');
});

test('normalizeSessionSkillsCovered preserves outlineItems with denormalized labels', () => {
  const catalogItems = [
    { id: 'toi1', label: 'Write a note', sectionKey: 'tasks', levelId: 'lvl1', isSelectable: true, isActive: true }
  ];
  const levels = [{ id: 'lvl1', code: 'clb_3', title: 'CLB 3' }];
  const normalized = gradebookSkillCatalogService.normalizeSessionSkillsCovered([
    {
      skillId: 'writing',
      note: 'Session focus',
      outlineItems: [{ itemId: 'toi1' }]
    }
  ], { catalogItems, levels });
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].outlineItems[0].label, 'Write a note');
  assert.equal(normalized[0].outlineItems[0].levelCode, 'clb_3');
  assert.equal(normalized[0].outlineItems[0].levelTitle, 'CLB 3');
});

test('collectPriorCoveredItemIds reads completed session outline items', () => {
  const sessions = [
    {
      sessionId: 's1',
      status: 'completed',
      skillsCovered: [{ skillId: 'writing', outlineItems: [{ itemId: 'a1', label: 'A' }] }]
    },
    {
      sessionId: 's2',
      status: 'scheduled',
      skillsCovered: [{ skillId: 'writing', outlineItems: [{ itemId: 'b1', label: 'B' }] }]
    }
  ];
  const covered = teachingOutlineSuggestionService.collectPriorCoveredItemIds(sessions, { beforeSessionId: 's9' });
  assert.deepEqual(covered, new Set(['a1']));
});

test('aggregateCoverageForEnrollment groups by skill and section', async () => {
  const sessions = [
    {
      date: '2026-01-10',
      status: 'completed',
      roster: [{ personId: 'p1' }],
      skillsCovered: [{
        skillId: 'writing',
        outlineItems: [{
          itemId: 'i1',
          label: 'Write email',
          sectionKey: 'tasks',
          levelId: 'l3',
          levelCode: 'clb_3',
          levelTitle: 'CLB 3'
        }]
      }]
    }
  ];
  const report = await studentTeachingCoverageService.aggregateCoverageForEnrollment({
    sessions,
    personId: 'p1',
    orgId: 'ORG1',
    levels: [{ id: 'l3', code: 'clb_3', title: 'CLB 3' }],
    items: [{ id: 'i1', label: 'Write email', sectionKey: 'tasks', levelId: 'l3' }],
    templates: [{ skillId: 'writing', sections: [{ key: 'tasks', title: 'Tasks' }] }],
    statusPolicyMap: new Map([['completed', { isFinal: true, makeUpRequired: false, excludeFromAttendance: false }]])
  });
  assert.equal(report.bySkill.writing.items.length, 1);
  assert.equal(report.bySkill.writing.bySection.tasks[0].label, 'Write email');
  assert.deepEqual(report.bySkill.writing.bySection.tasks[0].sessionDates, ['2026-01-10']);
});
