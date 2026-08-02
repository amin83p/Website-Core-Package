'use strict';

const teachingOutlineLevelModel = require('../../models/school/teachingOutlineLevelModel');
const teachingOutlineSectionTemplateModel = require('../../models/school/teachingOutlineSectionTemplateModel');
const teachingOutlineItemModel = require('../../models/school/teachingOutlineItemModel');
const {
  CLB_SKILLS,
  DEFAULT_LEVELS,
  DEFAULT_SECTION_TEMPLATES,
  WRITING_ITEMS_BY_LEVEL,
  buildLsrPlaceholderItems
} = require('./teachingOutlineSeedData');

function normalizeAlias(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function listActiveLevels(levels = []) {
  return (Array.isArray(levels) ? levels : [])
    .filter((row) => row && row.isActive !== false)
    .sort((a, b) => {
      const orderA = Number(a?.sortOrder || 0);
      const orderB = Number(b?.sortOrder || 0);
      if (orderA !== orderB) return orderA - orderB;
      return String(a?.title || '').localeCompare(String(b?.title || ''));
    });
}

function resolveLevelFromStudentText(levels, text = '') {
  const raw = String(text || '').trim();
  if (!raw || raw === '-') return null;
  const normalized = normalizeAlias(raw);
  if (!normalized) return null;
  const active = listActiveLevels(levels);
  let best = null;
  let bestScore = 0;
  active.forEach((level) => {
    const aliases = [level.code, level.title, level.shortTitle, ...(level.matchAliases || [])];
    aliases.forEach((alias) => {
      const aliasNorm = normalizeAlias(alias);
      if (!aliasNorm) return;
      if (normalized === aliasNorm) {
        best = level;
        bestScore = 100;
        return;
      }
      if (aliasNorm.length >= 2 && (normalized.includes(aliasNorm) || aliasNorm.includes(normalized))) {
        const score = aliasNorm.length;
        if (score > bestScore) {
          best = level;
          bestScore = score;
        }
      }
    });
  });
  return best;
}

function getSectionTemplateForSkill(templates, skillId, orgId) {
  const skill = String(skillId || '').trim().toLowerCase();
  const rows = (Array.isArray(templates) ? templates : []).filter((row) => row.skillId === skill);
  const orgMatch = rows.find((row) => String(row.orgId) === String(orgId));
  if (orgMatch) return orgMatch;
  return rows[0] || null;
}

function buildItemTree(items = [], sectionTemplate = null) {
  const sections = Array.isArray(sectionTemplate?.sections) ? sectionTemplate.sections : [];
  const bySection = new Map();
  sections.forEach((section) => {
    bySection.set(section.key, { section, roots: [], byId: new Map() });
  });
  const sorted = [...(Array.isArray(items) ? items : [])]
    .filter((row) => row && row.isActive !== false)
    .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0));

  sorted.forEach((row) => {
    const bucket = bySection.get(row.sectionKey);
    if (!bucket) return;
    const node = { ...row, children: [] };
    bucket.byId.set(row.id, node);
    if (row.parentId && bucket.byId.has(row.parentId)) {
      bucket.byId.get(row.parentId).children.push(node);
    } else {
      bucket.roots.push(node);
    }
  });

  return sections.map((section) => ({
    ...section,
    items: (bySection.get(section.key)?.roots) || []
  }));
}

function listSelectableItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((row) => row && row.isActive !== false && row.isSelectable)
    .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0));
}

function validateOutlineItemIds(items, itemIds = []) {
  const ids = Array.isArray(itemIds) ? itemIds : [];
  const byId = new Map((Array.isArray(items) ? items : []).map((row) => [String(row.id), row]));
  const output = [];
  const seen = new Set();
  ids.forEach((id) => {
    const key = String(id || '').trim();
    if (!key || seen.has(key)) return;
    const row = byId.get(key);
    if (!row || row.isActive === false || !row.isSelectable) return;
    seen.add(key);
    output.push(row);
  });
  return output;
}

async function ensureOrgTeachingOutlineDefaults(orgId, userId = 'SYSTEM') {
  const org = String(orgId || '').trim();
  if (!org) throw new Error('Organization is required.');

  const [levels, templates, items] = await Promise.all([
    teachingOutlineLevelModel.getAllTeachingOutlineLevels(),
    teachingOutlineSectionTemplateModel.getAllTeachingOutlineSectionTemplates(),
    teachingOutlineItemModel.getAllTeachingOutlineItems()
  ]);

  const orgLevels = levels.filter((row) => String(row.orgId) === org);
  const levelByCode = new Map(orgLevels.map((row) => [row.code, row]));

  if (!orgLevels.length) {
    for (const seed of DEFAULT_LEVELS) {
      const created = await teachingOutlineLevelModel.addTeachingOutlineLevel({
        orgId: org,
        ...seed,
        isActive: true,
        audit: { createUser: userId, lastUpdateUser: userId }
      });
      levelByCode.set(created.code, created);
    }
  }

  const freshLevels = orgLevels.length
    ? orgLevels
    : await teachingOutlineLevelModel.getAllTeachingOutlineLevels().then((rows) => rows.filter((row) => String(row.orgId) === org));

  const orgTemplates = templates.filter((row) => String(row.orgId) === org);
  const templateSkills = new Set(orgTemplates.map((row) => row.skillId));
  for (const skillId of CLB_SKILLS) {
    if (templateSkills.has(skillId)) continue;
    await teachingOutlineSectionTemplateModel.addTeachingOutlineSectionTemplate({
      orgId: org,
      skillId,
      sections: DEFAULT_SECTION_TEMPLATES[skillId] || [],
      audit: { createUser: userId, lastUpdateUser: userId }
    });
  }

  const orgItems = items.filter((row) => String(row.orgId) === org);
  if (!orgItems.length) {
    const levelMap = new Map(freshLevels.map((row) => [row.code, row]));
    for (const [levelCode, levelRow] of levelMap.entries()) {
      const writingSeed = WRITING_ITEMS_BY_LEVEL[levelCode];
      if (writingSeed) {
        await importItemsForSkillLevel(org, 'writing', levelRow.id, writingSeed, userId);
      }
      for (const skillId of CLB_SKILLS) {
        if (skillId === 'writing') continue;
        await importItemsForSkillLevel(org, skillId, levelRow.id, buildLsrPlaceholderItems(skillId, levelCode), userId);
      }
    }
  }

  return {
    levels: freshLevels.length ? freshLevels : await teachingOutlineLevelModel.getAllTeachingOutlineLevels().then((rows) => rows.filter((row) => String(row.orgId) === org)),
    templates: await teachingOutlineSectionTemplateModel.getAllTeachingOutlineSectionTemplates().then((rows) => rows.filter((row) => String(row.orgId) === org)),
    items: await teachingOutlineItemModel.getAllTeachingOutlineItems().then((rows) => rows.filter((row) => String(row.orgId) === org))
  };
}

async function importItemsForSkillLevel(orgId, skillId, levelId, seedRows, userId = 'SYSTEM') {
  const parentLabelToId = new Map();
  const built = [];
  let order = 0;
  for (const seed of (Array.isArray(seedRows) ? seedRows : [])) {
    order += 1;
    const id = teachingOutlineItemModel.generateItemId();
    const parentId = seed.parentKey ? (parentLabelToId.get(String(seed.parentKey)) || null) : null;
    built.push({
      id,
      orgId,
      skillId,
      levelId,
      sectionKey: seed.sectionKey,
      parentId,
      itemKind: seed.itemKind || 'checklist',
      label: seed.label,
      description: seed.description || '',
      displayOrder: seed.displayOrder || order,
      isSelectable: seed.isSelectable !== undefined ? seed.isSelectable : (seed.itemKind || 'checklist') === 'checklist',
      isActive: seed.isActive !== false
    });
    if (seed.itemKind === 'group') {
      parentLabelToId.set(seed.label, id);
    }
  }
  return teachingOutlineItemModel.bulkReplaceItemsForSkillLevel(orgId, skillId, levelId, built, userId);
}

function buildDashboardMatrix(levels, items, templates) {
  const activeLevels = listActiveLevels(levels);
  return CLB_SKILLS.map((skillId) => {
    const template = getSectionTemplateForSkill(templates, skillId);
    const skillItems = (Array.isArray(items) ? items : []).filter((row) => row.skillId === skillId && row.isActive !== false);
    const cells = activeLevels.map((level) => ({
      levelId: level.id,
      levelCode: level.code,
      levelTitle: level.title,
      itemCount: skillItems.filter((row) => String(row.levelId) === String(level.id)).length
    }));
    return {
      skillId,
      skillLabel: skillId.charAt(0).toUpperCase() + skillId.slice(1),
      sectionCount: (template?.sections || []).length,
      cells
    };
  });
}

function enrichOutlineItemsForSession(items, levels) {
  const levelById = new Map((Array.isArray(levels) ? levels : []).map((row) => [String(row.id), row]));
  return (Array.isArray(items) ? items : []).map((row) => {
    const level = levelById.get(String(row.levelId || ''));
    return {
      itemId: String(row.itemId || row.id || '').trim(),
      label: String(row.label || '').trim().slice(0, 2000),
      sectionKey: String(row.sectionKey || '').trim(),
      levelId: String(row.levelId || '').trim(),
      levelCode: String(row.levelCode || level?.code || '').trim(),
      levelTitle: String(row.levelTitle || level?.title || '').trim()
    };
  }).filter((row) => row.itemId && row.label);
}

module.exports = {
  CLB_SKILLS,
  normalizeAlias,
  listActiveLevels,
  resolveLevelFromStudentText,
  getSectionTemplateForSkill,
  buildItemTree,
  listSelectableItems,
  validateOutlineItemIds,
  ensureOrgTeachingOutlineDefaults,
  importItemsForSkillLevel,
  buildDashboardMatrix,
  enrichOutlineItemsForSession,
  DEFAULT_LEVELS,
  DEFAULT_SECTION_TEMPLATES,
  WRITING_ITEMS_BY_LEVEL: require('./teachingOutlineSeedData').WRITING_ITEMS_BY_LEVEL
};
