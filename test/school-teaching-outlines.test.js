'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const teachingOutlineCatalogService = require('../packages/school/MVC/services/school/teachingOutlineCatalogService');
const teachingOutlineSuggestionService = require('../packages/school/MVC/services/school/teachingOutlineSuggestionService');
const studentTeachingCoverageService = require('../packages/school/MVC/services/school/studentTeachingCoverageService');
const gradebookSkillCatalogService = require('../packages/school/MVC/services/school/gradebookSkillCatalogService');
const schoolRepositories = require('../packages/school/MVC/repositories/school');
const { WRITING_ITEMS_BY_LEVEL } = require('../packages/school/MVC/services/school/teachingOutlineSeedData');

test('session manager teaching-outline UI template compiles', () => {
  const filename = path.join(__dirname, '../packages/school/MVC/views/school/class/sessionManager.ejs');
  const source = fs.readFileSync(filename, 'utf8');
  assert.doesNotThrow(() => ejs.compile(source, { filename }));
  const start = source.indexOf('/* --- Curriculum: skills covered this session --- */');
  const end = source.indexOf('/* --- Session gradebook (multiple activities per session) --- */');
  assert.ok(start >= 0 && end > start);
  const clientScript = source
    .slice(start, end)
    .replace(/<%[-=][\s\S]*?%>/g, 'null');
  assert.doesNotThrow(() => new Function(clientScript)); // eslint-disable-line no-new-func
  assert.match(source, /outlineSessionPlanUtils\.js/);
  assert.match(source, /outlinePickerCoverageChips/);
  assert.match(source, /skillsCoveredAccordion/);
  assert.match(source, /curriculumReferenceCard/);
});

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

test('Writing defaults keep reference sections visible but not session selectable', () => {
  const sections = teachingOutlineCatalogService.DEFAULT_SECTION_TEMPLATES.writing;
  const policy = Object.fromEntries(sections.map((section) => [section.key, section.isSelectable]));
  assert.equal(policy.benchmark_description, false);
  assert.equal(policy.client_profile, false);
  assert.equal(policy.outcomes_performance, false);
  assert.equal(policy.outcomes_general, true);
  assert.equal(policy.grammar, true);
  assert.equal(policy.tasks, true);
});

test('applyDefaultSectionPolicies updates known flags and preserves custom section data', () => {
  const sections = teachingOutlineCatalogService.applyDefaultSectionPolicies({
    sections: [
      { key: 'outcomes_performance', title: 'Customized conditions', isSelectable: true, displayOrder: 40 },
      { key: 'custom_reference', title: 'Local notes', isSelectable: false, displayOrder: 70 }
    ]
  }, teachingOutlineCatalogService.DEFAULT_SECTION_TEMPLATES.writing);
  const performance = sections.find((section) => section.key === 'outcomes_performance');
  assert.equal(performance.title, 'Customized conditions');
  assert.equal(performance.isSelectable, false);
  assert.ok(sections.some((section) => section.key === 'tasks'));
  assert.ok(sections.some((section) => section.key === 'custom_reference'));
});

test('buildSessionPickerTree separates reference context and preserves nested task hierarchy', () => {
  const template = {
    sections: [
      { key: 'client_profile', title: 'Client Profile', isSelectable: false, displayOrder: 1 },
      { key: 'tasks', title: 'Tasks', isSelectable: true, displayOrder: 2 }
    ]
  };
  const items = [
    { id: 'ref1', levelId: 'l3', sectionKey: 'client_profile', label: 'Reference profile', itemKind: 'checklist', isSelectable: true, isActive: true, displayOrder: 1 },
    { id: 'child1', levelId: 'l3', sectionKey: 'tasks', parentId: 'group1', label: 'Write an email', itemKind: 'checklist', isSelectable: true, isActive: true, displayOrder: 1 },
    { id: 'group1', levelId: 'l3', sectionKey: 'tasks', label: 'Email tasks', itemKind: 'group', isSelectable: false, isActive: true, displayOrder: 10 },
    { id: 'inactive1', levelId: 'l3', sectionKey: 'tasks', label: 'Inactive', itemKind: 'checklist', isSelectable: true, isActive: false, displayOrder: 20 },
    { id: 'orphan1', levelId: 'l3', sectionKey: 'tasks', parentId: 'missing', label: 'Orphan', itemKind: 'checklist', isSelectable: true, isActive: true, displayOrder: 30 }
  ];
  const tree = teachingOutlineCatalogService.buildSessionPickerTree(items, template, {
    levelId: 'l3',
    priorCoveredItemIds: ['child1']
  });
  assert.equal(tree[0].mode, 'reference');
  assert.equal(tree[0].items[0].isSessionSelectable, false);
  assert.equal(tree[1].items.length, 1);
  assert.equal(tree[1].items[0].id, 'group1');
  assert.equal(tree[1].items[0].isSessionSelectable, false);
  assert.equal(tree[1].items[0].children[0].id, 'child1');
  assert.equal(tree[1].items[0].children[0].isSessionSelectable, true);
  assert.equal(tree[1].items[0].children[0].isPreviouslyCovered, true);
  assert.deepEqual(
    teachingOutlineCatalogService.flattenSessionPickerTree(tree, { selectableOnly: true }).map((row) => row.id),
    ['child1']
  );
});

test('buildOutlineExportPayload resolves parentKey and round-trips import rows', () => {
  const payload = teachingOutlineCatalogService.buildOutlineExportPayload('writing', { code: 'clb_1', title: 'CLB 1' }, {
    sections: [{ key: 'tasks', title: 'Tasks' }]
  }, [
    { id: 'g1', sectionKey: 'tasks', itemKind: 'group', label: 'Group A', displayOrder: 1, isActive: true, isSelectable: false },
    { id: 'c1', sectionKey: 'tasks', itemKind: 'checklist', label: 'Child', parentId: 'g1', displayOrder: 2, isActive: true, isSelectable: true }
  ]);
  assert.equal(payload.format, 'school-teaching-outline-export');
  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[1].parentKey, 'Group A');
  const roundTrip = teachingOutlineCatalogService.normalizeOutlineImportRows(payload);
  assert.equal(roundTrip.length, 2);
  assert.equal(roundTrip[1].parentKey, 'Group A');
});

test('WRITING_ITEMS_BY_LEVEL.clb_1 matches Equilibrium PDF structure and verbatim labels', () => {
  const items = WRITING_ITEMS_BY_LEVEL.clb_1;
  assert.equal(items.length, 37);

  const countBySection = (sectionKey) => items.filter((row) => row.sectionKey === sectionKey).length;
  assert.equal(countBySection('benchmark_description'), 1);
  assert.equal(countBySection('client_profile'), 5);
  assert.equal(countBySection('outcomes_general'), 5);
  assert.equal(countBySection('outcomes_performance'), 4);
  assert.equal(countBySection('grammar'), 8);
  assert.equal(countBySection('tasks'), 14);

  const taskGroups = items.filter((row) => row.sectionKey === 'tasks' && row.itemKind === 'group');
  const taskChecklists = items.filter((row) => row.sectionKey === 'tasks' && row.itemKind === 'checklist');
  assert.equal(taskGroups.length, 4);
  assert.equal(taskChecklists.length, 10);

  const selectableProfileAndOutcomes = items.filter((row) => (
    ['client_profile', 'outcomes_general', 'outcomes_performance'].includes(row.sectionKey)
  ));
  assert.ok(selectableProfileAndOutcomes.every((row) => row.itemKind === 'checklist' && row.isSelectable === true));

  const benchmark = items.find((row) => row.sectionKey === 'benchmark_description');
  assert.equal(benchmark.itemKind, 'reference');
  assert.equal(benchmark.isSelectable, false);

  const greetingCard = items.find((row) => row.label.startsWith('Complete a standard greeting card or e-card'));
  assert.ok(greetingCard);
  assert.ok(greetingCard.label.includes('friend’s, family member’s, classmate’s, or co-worker’s special occasion'));

  const guidedWriting = items.find((row) => row.label.includes('My name is _____'));
  assert.ok(guidedWriting);
  assert.equal(guidedWriting.itemKind, 'checklist');
  assert.ok(guidedWriting.parentKey?.includes('Write a few words to complete a short, guided text'));
});

test('all Writing PDF seeds preserve complete section counts and exact source text', () => {
  const expectations = {
    pre_beginner_limited_ed: {
      total: 24,
      selectable: 24,
      groups: 0,
      sections: { client_profile: 5, outcomes_performance: 3, grammar: 7, tasks: 9 },
      digest: '82b8d75d2fa9a19b7490d3a4ea62ae06db30c12f31fae3ef62c9b7e1a29ebc64'
    },
    pre_beginner_prior_ed: {
      total: 27,
      selectable: 27,
      groups: 0,
      sections: { client_profile: 6, outcomes_performance: 4, grammar: 7, tasks: 10 },
      digest: '68fe2c097610e6a57487508670461f0754d4512455a1a7b28fd088bd75957c5e'
    },
    clb_1: {
      total: 37,
      selectable: 32,
      groups: 4,
      sections: { benchmark_description: 1, client_profile: 5, outcomes_general: 5, outcomes_performance: 4, grammar: 8, tasks: 14 },
      digest: '26463f892335f5ae5295cf720ac708514db75a4119e0b9de779ff76c4681d4c9'
    },
    clb_2: {
      total: 52,
      selectable: 47,
      groups: 4,
      sections: { benchmark_description: 1, client_profile: 6, outcomes_general: 3, outcomes_performance: 4, grammar: 17, tasks: 21 },
      digest: '1733309950f3dfc7cafff79032736a75193a8e3832bab3054768644580221adc'
    },
    clb_3: {
      total: 56,
      selectable: 51,
      groups: 4,
      sections: { benchmark_description: 1, client_profile: 6, outcomes_general: 5, outcomes_performance: 3, grammar: 21, tasks: 20 },
      digest: 'fdd8461e894f4550587acb69a447bb3007375be06ba3e0dffa68012f7192f8b1'
    },
    clb_4: {
      total: 61,
      selectable: 55,
      groups: 5,
      sections: { benchmark_description: 1, client_profile: 8, outcomes_general: 3, outcomes_performance: 8, grammar: 23, tasks: 18 },
      digest: '4a3a392deac8a9fc055a3658f08bc9c06d76606c2d97ef1ff644d42e12b73318'
    },
    clb_5: {
      total: 68,
      selectable: 61,
      groups: 5,
      sections: { benchmark_description: 1, client_profile: 8, outcomes_general: 6, outcomes_performance: 5, grammar: 33, tasks: 15 },
      digest: '50c6987a6f3ee12c265e785bc9162367f7650d351d5111c4082bde5c009fc773'
    },
    clb_6: {
      total: 74,
      selectable: 68,
      groups: 5,
      sections: { benchmark_description: 1, client_profile: 9, outcomes_general: 6, outcomes_performance: 5, grammar: 33, tasks: 20 },
      digest: '11e499c1487f836fbe030658f6db83341afbca0790ba33518b323e2d7f62ef25'
    },
    clb_7: {
      total: 54,
      selectable: 47,
      groups: 5,
      sections: { benchmark_description: 1, client_profile: 9, outcomes_general: 1, grammar: 21, tasks: 22 },
      digest: 'b4eeeeda5a7530338b8916dcbacdcfdd140438755f4fdd11f189ef968f8dbd65'
    }
  };

  Object.entries(expectations).forEach(([levelCode, expected]) => {
    const rows = WRITING_ITEMS_BY_LEVEL[levelCode];
    assert.equal(rows.length, expected.total, `${levelCode}: total rows`);
    assert.equal(rows.filter((row) => row.isSelectable).length, expected.selectable, `${levelCode}: selectable rows`);
    assert.equal(rows.filter((row) => row.itemKind === 'group').length, expected.groups, `${levelCode}: task groups`);

    const sectionCounts = {};
    rows.forEach((row) => {
      sectionCounts[row.sectionKey] = (sectionCounts[row.sectionKey] || 0) + 1;
      assert.equal(row.label, row.label.trim(), `${levelCode}: labels must be trimmed`);
      assert.ok(row.label.length > 0, `${levelCode}: labels must not be empty`);
      if (row.itemKind === 'checklist') assert.equal(row.isSelectable, true, `${levelCode}: checklist must be selectable`);
      if (row.itemKind === 'group') assert.equal(row.isSelectable, false, `${levelCode}: group must not be selectable`);
    });
    assert.deepEqual(sectionCounts, expected.sections, `${levelCode}: section counts`);

    const groupLabels = new Set(rows.filter((row) => row.itemKind === 'group').map((row) => row.label));
    rows.filter((row) => row.parentKey).forEach((row) => {
      assert.ok(groupLabels.has(row.parentKey), `${levelCode}: missing task parent for ${row.label}`);
    });

    const digestRows = rows.map(({
      sectionKey,
      parentKey,
      itemKind,
      label,
      displayOrder,
      isSelectable,
      isActive
    }) => ({
      sectionKey,
      parentKey,
      itemKind,
      label,
      displayOrder,
      isSelectable,
      isActive
    }));
    const digest = crypto.createHash('sha256').update(JSON.stringify(digestRows)).digest('hex');
    assert.equal(digest, expected.digest, `${levelCode}: exact PDF text digest`);
  });

  assert.ok(WRITING_ITEMS_BY_LEVEL.pre_beginner_limited_ed.some((row) => row.label === 'My revert to first language'));
  assert.ok(WRITING_ITEMS_BY_LEVEL.pre_beginner_prior_ed.some((row) => row.label.includes('My name is ____. I am ____')));
  assert.ok(WRITING_ITEMS_BY_LEVEL.clb_2.some((row) => row.label.includes('country or origin, marital status')));
  assert.ok(WRITING_ITEMS_BY_LEVEL.clb_3.some((row) => row.label.endsWith('related to personally.')));
  assert.ok(WRITING_ITEMS_BY_LEVEL.clb_4.some((row) => row.label === 'Write an email to an organization to request information or cancel a service'));
  assert.ok(WRITING_ITEMS_BY_LEVEL.clb_5.some((row) => row.label === 'Reflective Pronouns'));
  assert.ok(WRITING_ITEMS_BY_LEVEL.clb_6.some((row) => row.label.includes('detailed person information')));
  assert.ok(WRITING_ITEMS_BY_LEVEL.clb_7.some((row) => row.label.includes('Express best wished for a quick recovery')));
});

test('bulkReplaceItemsForSkillLevelViaRepo removes existing rows and creates incoming items', async () => {
  const originals = {
    list: schoolRepositories.teachingOutlineItems.list,
    remove: schoolRepositories.teachingOutlineItems.remove,
    create: schoolRepositories.teachingOutlineItems.create
  };
  const removed = [];
  const created = [];

  schoolRepositories.teachingOutlineItems.list = async ({ query } = {}) => {
    if (query?.skillId__eq === 'writing' && query?.levelId__eq === 'lvl1') {
      return [{ id: 'old-1', orgId: 'ORG1', skillId: 'writing', levelId: 'lvl1' }];
    }
    return [];
  };
  schoolRepositories.teachingOutlineItems.remove = async (id) => {
    removed.push(id);
  };
  schoolRepositories.teachingOutlineItems.create = async (row) => {
    created.push(row);
    return row;
  };

  try {
    const result = await teachingOutlineCatalogService.bulkReplaceItemsForSkillLevelViaRepo(
      'ORG1',
      'writing',
      'lvl1',
      [{
        id: 'new-1',
        sectionKey: 'grammar',
        itemKind: 'checklist',
        label: 'Past tense',
        displayOrder: 1,
        isSelectable: true,
        isActive: true
      }],
      'TEST_USER'
    );
    assert.deepEqual(removed, ['old-1']);
    assert.equal(created.length, 1);
    assert.equal(created[0].id, 'new-1');
    assert.equal(created[0].orgId, 'ORG1');
    assert.equal(created[0].skillId, 'writing');
    assert.equal(created[0].levelId, 'lvl1');
    assert.equal(created[0].audit.createUser, 'TEST_USER');
    assert.equal(result.length, 1);
  } finally {
    schoolRepositories.teachingOutlineItems.list = originals.list;
    schoolRepositories.teachingOutlineItems.remove = originals.remove;
    schoolRepositories.teachingOutlineItems.create = originals.create;
  }
});

test('importItemsForSkillLevel builds parent links then bulk replaces via repository', async () => {
  const originals = {
    list: schoolRepositories.teachingOutlineItems.list,
    remove: schoolRepositories.teachingOutlineItems.remove,
    create: schoolRepositories.teachingOutlineItems.create
  };
  const created = [];

  schoolRepositories.teachingOutlineItems.list = async () => [];
  schoolRepositories.teachingOutlineItems.remove = async () => {};
  schoolRepositories.teachingOutlineItems.create = async (row) => {
    created.push(row);
    return row;
  };

  try {
    await teachingOutlineCatalogService.importItemsForSkillLevel('ORG1', 'writing', 'lvl1', [
      { sectionKey: 'tasks', itemKind: 'group', label: 'Email tasks', displayOrder: 1 },
      { sectionKey: 'tasks', itemKind: 'checklist', label: 'Write greeting', parentKey: 'Email tasks', displayOrder: 2 }
    ], 'TEST_USER');
    assert.equal(created.length, 2);
    assert.equal(created[0].itemKind, 'group');
    assert.equal(created[1].parentId, created[0].id);
    assert.equal(created[1].label, 'Write greeting');
  } finally {
    schoolRepositories.teachingOutlineItems.list = originals.list;
    schoolRepositories.teachingOutlineItems.remove = originals.remove;
    schoolRepositories.teachingOutlineItems.create = originals.create;
  }
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

test('normalizeSessionSkillsCovered persists primary level with mixed-level instructional snapshots', () => {
  const catalogItems = [
    { id: 'objective3', skillId: 'writing', label: 'Write a short paragraph', sectionKey: 'outcomes_general', levelId: 'l3', itemKind: 'checklist', isSelectable: true, isActive: true },
    { id: 'task4', skillId: 'writing', label: 'Write a formal email', sectionKey: 'tasks', levelId: 'l4', itemKind: 'checklist', isSelectable: true, isActive: true }
  ];
  const levels = [
    { id: 'l3', code: 'clb_3', title: 'CLB 3' },
    { id: 'l4', code: 'clb_4', title: 'CLB 4' }
  ];
  const templates = [{
    skillId: 'writing',
    sections: [
      { key: 'outcomes_general', isSelectable: true },
      { key: 'tasks', isSelectable: true }
    ]
  }];
  const normalized = gradebookSkillCatalogService.normalizeSessionSkillsCovered([{
    skillId: 'writing',
    primaryLevelId: 'l3',
    outlineItems: [{ itemId: 'objective3' }, { itemId: 'task4' }]
  }], { catalogItems, levels, templates });
  assert.equal(normalized[0].primaryLevelId, 'l3');
  assert.equal(normalized[0].primaryLevelCode, 'clb_3');
  assert.equal(normalized[0].primaryLevelTitle, 'CLB 3');
  assert.deepEqual(normalized[0].outlineItems.map((row) => row.levelId), ['l3', 'l4']);
});

test('normalizeSessionSkillsCovered requires instructional content or a note for CLB skills', () => {
  assert.throws(
    () => gradebookSkillCatalogService.normalizeSessionSkillsCovered([{ skillId: 'writing' }]),
    /requires at least one instructional outline item or a session note/
  );
});

test('normalizeSessionSkillsCovered rejects new selections from reference sections but preserves historical ones', () => {
  const catalogItems = [{
    id: 'condition1',
    skillId: 'writing',
    label: 'Performance condition',
    sectionKey: 'outcomes_performance',
    levelId: 'l3',
    itemKind: 'checklist',
    isSelectable: true,
    isActive: true
  }];
  const levels = [{ id: 'l3', code: 'clb_3', title: 'CLB 3' }];
  const templates = [{
    skillId: 'writing',
    sections: [{ key: 'outcomes_performance', isSelectable: false }]
  }];
  const incoming = [{
    skillId: 'writing',
    note: 'Reference discussed',
    outlineItems: [{ itemId: 'condition1' }]
  }];
  const fresh = gradebookSkillCatalogService.normalizeSessionSkillsCovered(incoming, {
    catalogItems,
    levels,
    templates
  });
  assert.equal(fresh[0].outlineItems.length, 0);
  const historical = gradebookSkillCatalogService.normalizeSessionSkillsCovered(incoming, {
    catalogItems,
    levels,
    templates,
    preserveOutlineItemIdsBySkill: { writing: ['condition1'] }
  });
  assert.equal(historical[0].outlineItems.length, 1);
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

test('collectPriorCoveredItemIds excludes the current and future completed sessions', () => {
  const sessions = [
    { sessionId: 's3', date: '2026-01-30', status: 'completed', skillsCovered: [{ skillId: 'writing', outlineItems: [{ itemId: 'future' }] }] },
    { sessionId: 's1', date: '2026-01-10', status: 'completed', skillsCovered: [{ skillId: 'writing', outlineItems: [{ itemId: 'prior' }] }] },
    { sessionId: 's2', date: '2026-01-20', status: 'completed', skillsCovered: [{ skillId: 'writing', outlineItems: [{ itemId: 'current' }] }] }
  ];
  const covered = teachingOutlineSuggestionService.collectPriorCoveredItemIds(sessions, { beforeSessionId: 's2' });
  assert.deepEqual(covered, new Set(['prior']));
});

test('buildSuggestionsForSession returns level distribution, hierarchy, and balanced groups', async () => {
  const levels = [
    { id: 'l3', code: 'clb_3', title: 'CLB 3', isActive: true, sortOrder: 30 },
    { id: 'l4', code: 'clb_4', title: 'CLB 4', isActive: true, sortOrder: 40 }
  ];
  const templates = [{
    orgId: 'ORG1',
    skillId: 'writing',
    sections: [
      { key: 'client_profile', title: 'Client Profile', isSelectable: false, displayOrder: 1 },
      { key: 'outcomes_general', title: 'General Writing Ability', isSelectable: true, displayOrder: 2 },
      { key: 'grammar', title: 'Grammar', isSelectable: true, displayOrder: 3 },
      { key: 'tasks', title: 'Tasks', isSelectable: true, displayOrder: 4 }
    ]
  }];
  const items = [
    { id: 'ref', skillId: 'writing', levelId: 'l3', sectionKey: 'client_profile', label: 'Profile', itemKind: 'reference', isSelectable: false, isActive: true, displayOrder: 1 },
    { id: 'objective', skillId: 'writing', levelId: 'l3', sectionKey: 'outcomes_general', label: 'Objective', itemKind: 'checklist', isSelectable: true, isActive: true, displayOrder: 1 },
    { id: 'grammar', skillId: 'writing', levelId: 'l3', sectionKey: 'grammar', label: 'Past tense', itemKind: 'checklist', isSelectable: true, isActive: true, displayOrder: 1 },
    { id: 'group', skillId: 'writing', levelId: 'l3', sectionKey: 'tasks', label: 'Email group', itemKind: 'group', isSelectable: false, isActive: true, displayOrder: 1 },
    { id: 'task', skillId: 'writing', levelId: 'l3', sectionKey: 'tasks', parentId: 'group', label: 'Write email', itemKind: 'checklist', isSelectable: true, isActive: true, displayOrder: 2 }
  ];
  const studentsByPersonId = new Map([[
    'p1',
    { personId: 'p1', clbLevelHistory: [{ recordedAt: '2026-01-01', current: { writing: 'CLB 3' } }] }
  ]]);
  const result = await teachingOutlineSuggestionService.buildSuggestionsForSession({
    orgId: 'ORG1',
    classId: 'c1',
    sessionId: 's2',
    roster: [{ personId: 'p1' }],
    sessions: [{
      sessionId: 's1',
      classId: 'c1',
      date: '2026-01-01',
      status: 'completed',
      skillsCovered: [{ skillId: 'writing', outlineItems: [{ itemId: 'grammar' }] }]
    }],
    levels,
    templates,
    items,
    studentsByPersonId
  });
  const writing = result.suggestionsBySkill.writing;
  assert.equal(writing.suggestedLevelId, 'l3');
  assert.deepEqual(writing.levelDistribution, [{ levelId: 'l3', levelCode: 'clb_3', levelTitle: 'CLB 3', count: 1 }]);
  assert.deepEqual(writing.levelsById.l3.groups.map((group) => group.key), ['objectives', 'language_focus', 'activities']);
  assert.equal(writing.levelsById.l3.tree[0].mode, 'reference');
  assert.equal(writing.levelsById.l3.sections.find((section) => section.key === 'grammar').items[0].isPreviouslyCovered, true);
  assert.ok(writing.items.some((row) => row.sectionKey === 'outcomes_general'));
  assert.ok(writing.items.some((row) => row.sectionKey === 'grammar'));
  assert.ok(writing.items.some((row) => row.sectionKey === 'tasks'));
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
    },
    {
      date: '2026-01-11',
      status: 'scheduled',
      roster: [{ personId: 'p1' }],
      skillsCovered: [{
        skillId: 'writing',
        outlineItems: [{
          itemId: 'i2',
          label: 'Planned paragraph',
          sectionKey: 'outcomes_general',
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
    items: [
      { id: 'i1', label: 'Write email', sectionKey: 'tasks', levelId: 'l3' },
      { id: 'i2', label: 'Planned paragraph', sectionKey: 'outcomes_general', levelId: 'l3' }
    ],
    templates: [{ skillId: 'writing', sections: [{ key: 'tasks', title: 'Tasks' }] }],
    statusPolicyMap: new Map([['completed', { isFinal: true, makeUpRequired: false, excludeFromAttendance: false }]])
  });
  assert.equal(report.bySkill.writing.items.length, 1);
  assert.equal(report.bySkill.writing.bySection.tasks[0].label, 'Write email');
  assert.deepEqual(report.bySkill.writing.bySection.tasks[0].sessionDates, ['2026-01-10']);
  assert.equal(report.bySkill.writing.totalSessions, 1);
});

const outlineSessionPlanUtils = require('../public/scripts/outlineSessionPlanUtils.js');

test('getOutlineSectionCoverage detects missing canonical sections', () => {
  const complete = outlineSessionPlanUtils.getOutlineSectionCoverage([
    { sectionKey: 'outcomes_general', label: 'Objective' },
    { sectionKey: 'grammar', label: 'Past tense' },
    { sectionKey: 'tasks', label: 'Write email' }
  ]);
  assert.equal(complete.complete, true);
  assert.equal(complete.missing.length, 0);

  const partial = outlineSessionPlanUtils.getOutlineSectionCoverage([
    { sectionKey: 'grammar', label: 'Past tense' },
    { sectionKey: 'tasks', label: 'Write email' }
  ]);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.missing.map((row) => row.key), ['objectives']);
  assert.equal(partial.objectives, false);
  assert.equal(partial.language_focus, true);
  assert.equal(partial.activities, true);
});

test('buildOutlineItemSnapshot resolves activity group label from parent group', () => {
  const catalogById = new Map([
    ['group1', { id: 'group1', itemKind: 'group', label: 'Convey personal messages in short correspondence.' }],
    ['task1', {
      id: 'task1',
      parentId: 'group1',
      sectionKey: 'tasks',
      label: 'Write a personal message to cancel an appointment.',
      levelId: 'l6',
      itemKind: 'checklist'
    }]
  ]);
  const snapshot = outlineSessionPlanUtils.buildOutlineItemSnapshot(
    catalogById.get('task1'),
    catalogById,
    () => ({ code: 'clb_6', title: 'CLB 6' })
  );
  assert.equal(snapshot.groupLabel, 'Convey personal messages in short correspondence.');
  assert.equal(snapshot.parentId, 'group1');
  assert.equal(snapshot.levelTitle, 'CLB 6');
});

test('renderOutlinePlanHtml groups activities under parent competency text', () => {
  const html = outlineSessionPlanUtils.renderOutlinePlanHtml([
    { sectionKey: 'outcomes_general', label: 'Write connected paragraphs.', levelTitle: 'CLB 6' },
    {
      sectionKey: 'tasks',
      label: 'Write a personal message to cancel an appointment.',
      groupLabel: 'Convey personal messages in short correspondence.',
      levelTitle: 'CLB 6'
    }
  ], (value) => String(value));
  assert.match(html, /Objectives/);
  assert.match(html, /Activities/);
  assert.match(html, /Convey personal messages in short correspondence/);
  assert.match(html, /Write a personal message to cancel an appointment/);
});
