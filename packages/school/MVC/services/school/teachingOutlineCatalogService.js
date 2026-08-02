'use strict';

const schoolRepositories = require('../../repositories/school');
const { generateLevelId } = require('../../models/school/teachingOutlineLevelModel');
const { generateTemplateId } = require('../../models/school/teachingOutlineSectionTemplateModel');
const { generateItemId } = require('../../models/school/teachingOutlineItemModel');
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

function buildItemTree(items = [], sectionTemplate = null, options = {}) {
  const includeInactive = options?.includeInactive === true;
  const sections = Array.isArray(sectionTemplate?.sections) ? sectionTemplate.sections : [];
  const bySection = new Map();
  sections.forEach((section) => {
    bySection.set(section.key, { section, roots: [], byId: new Map() });
  });
  const sorted = [...(Array.isArray(items) ? items : [])]
    .filter((row) => row && (includeInactive || row.isActive !== false))
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

function compareOutlineRows(a, b) {
  const orderA = Number(a?.displayOrder || 0);
  const orderB = Number(b?.displayOrder || 0);
  if (orderA !== orderB) return orderA - orderB;
  const labelCompare = String(a?.label || '').localeCompare(String(b?.label || ''));
  if (labelCompare !== 0) return labelCompare;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

function buildSessionPickerTree(items = [], sectionTemplate = null, options = {}) {
  const sections = [...(Array.isArray(sectionTemplate?.sections) ? sectionTemplate.sections : [])]
    .sort((a, b) => Number(a?.displayOrder || 0) - Number(b?.displayOrder || 0));
  const levelId = String(options?.levelId || '').trim();
  const selectedIds = new Set((options?.selectedItemIds || []).map((row) => String(row || '').trim()).filter(Boolean));
  const coveredIds = new Set((options?.priorCoveredItemIds || []).map((row) => String(row || '').trim()).filter(Boolean));
  const sectionByKey = new Map(sections.map((section) => [String(section?.key || '').trim(), section]));
  const nodesById = new Map();

  [...(Array.isArray(items) ? items : [])]
    .filter((row) => {
      if (!row || row.isActive === false) return false;
      if (levelId && String(row.levelId || '') !== levelId) return false;
      return sectionByKey.has(String(row.sectionKey || '').trim());
    })
    .sort(compareOutlineRows)
    .forEach((row) => {
      const section = sectionByKey.get(String(row.sectionKey || '').trim());
      const itemId = String(row.id || '').trim();
      if (!itemId) return;
      nodesById.set(itemId, {
        ...row,
        children: [],
        isSessionSelectable: Boolean(section?.isSelectable)
          && row.isSelectable === true
          && String(row.itemKind || 'checklist').trim().toLowerCase() === 'checklist',
        isPreviouslyCovered: coveredIds.has(itemId),
        isSelected: selectedIds.has(itemId)
      });
    });

  const rootsBySection = new Map(sections.map((section) => [String(section?.key || '').trim(), []]));
  nodesById.forEach((node) => {
    const sectionKey = String(node.sectionKey || '').trim();
    const parentId = String(node.parentId || '').trim();
    if (!parentId) {
      rootsBySection.get(sectionKey)?.push(node);
      return;
    }
    const parent = nodesById.get(parentId);
    if (!parent || String(parent.sectionKey || '').trim() !== sectionKey) return;
    parent.children.push(node);
  });

  function sortChildren(nodes = []) {
    nodes.sort(compareOutlineRows);
    nodes.forEach((node) => sortChildren(node.children));
    return nodes;
  }

  return sections.map((section) => {
    const roots = sortChildren(rootsBySection.get(String(section.key || '').trim()) || []);
    let selectableCount = 0;
    const countSelectable = (nodes) => nodes.forEach((node) => {
      if (node.isSessionSelectable) selectableCount += 1;
      countSelectable(node.children || []);
    });
    countSelectable(roots);
    return {
      ...section,
      mode: section.isSelectable === true ? 'selectable' : 'reference',
      selectableCount,
      items: roots
    };
  });
}

function flattenSessionPickerTree(tree = [], options = {}) {
  const selectableOnly = options?.selectableOnly === true;
  const output = [];
  const visit = (nodes, section) => {
    (Array.isArray(nodes) ? nodes : []).forEach((node) => {
      if (!selectableOnly || node.isSessionSelectable) {
        output.push({
          ...node,
          sectionTitle: String(section?.title || section?.key || '').trim(),
          sectionMode: section?.mode || (section?.isSelectable ? 'selectable' : 'reference')
        });
      }
      visit(node.children, section);
    });
  };
  (Array.isArray(tree) ? tree : []).forEach((section) => visit(section.items, section));
  return output;
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

const REPO_SCOPE = { canViewAll: true };

async function listOrgTeachingOutlineLevels(orgId) {
  return schoolRepositories.teachingOutlineLevels.list({
    query: { orgId__eq: String(orgId || '').trim() },
    scope: REPO_SCOPE
  });
}

async function listOrgTeachingOutlineTemplates(orgId) {
  return schoolRepositories.teachingOutlineSectionTemplates.list({
    query: { orgId__eq: String(orgId || '').trim() },
    scope: REPO_SCOPE
  });
}

async function listOrgTeachingOutlineItems(orgId) {
  return schoolRepositories.teachingOutlineItems.list({
    query: { orgId__eq: String(orgId || '').trim() },
    scope: REPO_SCOPE
  });
}

function applyDefaultSectionPolicies(sectionTemplate = null, defaultSections = []) {
  const currentSections = Array.isArray(sectionTemplate?.sections) ? sectionTemplate.sections : [];
  const defaults = Array.isArray(defaultSections) ? defaultSections : [];
  const defaultByKey = new Map(defaults.map((row) => [String(row?.key || '').trim(), row]));
  const seen = new Set();
  const sections = currentSections.map((section) => {
    const key = String(section?.key || '').trim();
    seen.add(key);
    const policy = defaultByKey.get(key);
    if (!policy) return { ...section };
    return {
      ...section,
      isSelectable: policy.isSelectable === true
    };
  });
  defaults.forEach((section) => {
    const key = String(section?.key || '').trim();
    if (!key || seen.has(key)) return;
    sections.push({ ...section });
  });
  sections.sort((a, b) => Number(a?.displayOrder || 0) - Number(b?.displayOrder || 0));
  return sections;
}

async function reconcileOrgTeachingOutlineSectionPolicies(orgId, userId = 'SYSTEM', options = {}) {
  const org = String(orgId || '').trim();
  if (!org) throw new Error('Organization is required.');
  const requestedSkills = Array.isArray(options?.skillIds) && options.skillIds.length
    ? options.skillIds
    : CLB_SKILLS;
  const skillIds = new Set(requestedSkills.map((row) => String(row || '').trim().toLowerCase()).filter(Boolean));
  const templates = await listOrgTeachingOutlineTemplates(org);
  const reconciled = [];

  for (const template of templates) {
    if (!skillIds.has(template.skillId)) continue;
    const defaults = DEFAULT_SECTION_TEMPLATES[template.skillId] || [];
    if (!defaults.length) continue;
    const sections = applyDefaultSectionPolicies(template, defaults);
    if (JSON.stringify(sections) === JSON.stringify(template.sections || [])) continue;
    // eslint-disable-next-line no-await-in-loop
    const updated = await schoolRepositories.teachingOutlineSectionTemplates.update(template.id, {
      ...template,
      sections,
      audit: {
        ...(template.audit || {}),
        lastUpdateUser: String(userId || 'SYSTEM'),
        lastUpdateDateTime: new Date().toISOString()
      }
    }, { scope: REPO_SCOPE });
    if (updated) reconciled.push(updated);
  }
  return reconciled;
}

async function bulkReplaceItemsForSkillLevelViaRepo(orgId, skillId, levelId, items, userId = 'SYSTEM') {
  const org = String(orgId || '').trim();
  const skill = String(skillId || '').trim().toLowerCase();
  const level = String(levelId || '').trim();
  if (!org || !skill || !level) throw new Error('Organization, skill, and level are required.');

  const existing = await schoolRepositories.teachingOutlineItems.list({
    query: { orgId__eq: org, skillId__eq: skill, levelId__eq: level },
    scope: REPO_SCOPE
  });
  for (const row of (existing || [])) {
    // eslint-disable-next-line no-await-in-loop
    await schoolRepositories.teachingOutlineItems.remove(row.id, { scope: REPO_SCOPE });
  }

  const now = new Date().toISOString();
  const incoming = (Array.isArray(items) ? items : []).map((row) => ({
    ...row,
    orgId: org,
    skillId: skill,
    levelId: level,
    audit: {
      createUser: String(userId || 'SYSTEM'),
      createDateTime: now,
      lastUpdateUser: String(userId || 'SYSTEM'),
      lastUpdateDateTime: now
    }
  }));

  const created = [];
  for (const row of incoming) {
    // eslint-disable-next-line no-await-in-loop
    const saved = await schoolRepositories.teachingOutlineItems.create(row, { scope: REPO_SCOPE });
    if (saved) created.push(saved);
  }
  return created;
}

async function seedOrgTeachingOutlineItems(orgId, levels, userId = 'SYSTEM') {
  const levelMap = new Map((Array.isArray(levels) ? levels : []).map((row) => [row.code, row]));
  for (const [levelCode, levelRow] of levelMap.entries()) {
    const writingSeed = WRITING_ITEMS_BY_LEVEL[levelCode];
    if (writingSeed) {
      // eslint-disable-next-line no-await-in-loop
      await importItemsForSkillLevel(orgId, 'writing', levelRow.id, writingSeed, userId);
    }
    for (const skillId of CLB_SKILLS) {
      if (skillId === 'writing') continue;
      // eslint-disable-next-line no-await-in-loop
      await importItemsForSkillLevel(
        orgId,
        skillId,
        levelRow.id,
        buildLsrPlaceholderItems(skillId, levelCode),
        userId
      );
    }
  }
}

async function ensureOrgTeachingOutlineDefaults(orgId, userId = 'SYSTEM', options = {}) {
  const org = String(orgId || '').trim();
  if (!org) throw new Error('Organization is required.');
  const forceItems = options?.forceItems === true;

  let orgLevels = await listOrgTeachingOutlineLevels(org);
  const levelByCode = new Map(orgLevels.map((row) => [row.code, row]));

  if (!orgLevels.length) {
    for (const seed of DEFAULT_LEVELS) {
      // eslint-disable-next-line no-await-in-loop
      const created = await schoolRepositories.teachingOutlineLevels.create({
        id: generateLevelId(),
        orgId: org,
        ...seed,
        isActive: true,
        audit: { createUser: userId, lastUpdateUser: userId }
      }, { scope: REPO_SCOPE });
      if (created) levelByCode.set(created.code, created);
    }
    orgLevels = await listOrgTeachingOutlineLevels(org);
  }

  const orgTemplates = await listOrgTeachingOutlineTemplates(org);
  const templateSkills = new Set(orgTemplates.map((row) => row.skillId));
  for (const skillId of CLB_SKILLS) {
    if (templateSkills.has(skillId)) continue;
    // eslint-disable-next-line no-await-in-loop
    await schoolRepositories.teachingOutlineSectionTemplates.create({
      id: generateTemplateId(skillId),
      orgId: org,
      skillId,
      sections: DEFAULT_SECTION_TEMPLATES[skillId] || [],
      audit: { createUser: userId, lastUpdateUser: userId }
    }, { scope: REPO_SCOPE });
  }

  if (options?.reconcileSectionPolicies === true) {
    await reconcileOrgTeachingOutlineSectionPolicies(org, userId, {
      skillIds: options?.sectionPolicySkillIds
    });
  }

  const orgItems = await listOrgTeachingOutlineItems(org);
  if (!orgItems.length || forceItems) {
    await seedOrgTeachingOutlineItems(org, orgLevels, userId);
  }

  return {
    levels: await listOrgTeachingOutlineLevels(org),
    templates: await listOrgTeachingOutlineTemplates(org),
    items: await listOrgTeachingOutlineItems(org)
  };
}

async function importItemsForSkillLevel(orgId, skillId, levelId, seedRows, userId = 'SYSTEM') {
  const org = String(orgId || '').trim();
  const skill = String(skillId || '').trim().toLowerCase();
  const level = String(levelId || '').trim();
  const parentLabelToId = new Map();
  const built = [];
  let order = 0;
  for (const seed of (Array.isArray(seedRows) ? seedRows : [])) {
    order += 1;
    const id = generateItemId();
    const parentId = seed.parentKey ? (parentLabelToId.get(String(seed.parentKey)) || null) : null;
    built.push({
      id,
      orgId: org,
      skillId: skill,
      levelId: level,
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
  return bulkReplaceItemsForSkillLevelViaRepo(org, skill, level, built, userId);
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

function buildOutlineExportPayload(skillId, level, template, items = []) {
  const rows = Array.isArray(items) ? items : [];
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const sorted = [...rows].sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0));
  return {
    format: 'school-teaching-outline-export',
    version: 1,
    skillId: String(skillId || '').trim().toLowerCase(),
    levelCode: String(level?.code || '').trim(),
    levelTitle: String(level?.title || '').trim(),
    exportedAt: new Date().toISOString(),
    sections: (Array.isArray(template?.sections) ? template.sections : []).map((sec) => ({
      key: sec.key,
      title: sec.title,
      displayOrder: sec.displayOrder
    })),
    items: sorted.map((row) => {
      const parent = row.parentId ? byId.get(String(row.parentId)) : null;
      return {
        sectionKey: String(row.sectionKey || '').trim(),
        parentKey: parent ? String(parent.label || '').trim() : null,
        itemKind: String(row.itemKind || 'checklist').trim().toLowerCase(),
        label: String(row.label || '').trim(),
        description: String(row.description || '').trim(),
        displayOrder: Number(row.displayOrder || 100),
        isSelectable: row.isSelectable !== false,
        isActive: row.isActive !== false
      };
    })
  };
}

function normalizeOutlineImportRows(payload) {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const rawItems = Array.isArray(body.items)
    ? body.items
    : (Array.isArray(payload) ? payload : []);
  return rawItems
    .filter((row) => row && String(row.label || '').trim())
    .map((row, index) => ({
      sectionKey: String(row.sectionKey || '').trim(),
      parentKey: row.parentKey ? String(row.parentKey).trim() : null,
      itemKind: String(row.itemKind || 'checklist').trim().toLowerCase(),
      label: String(row.label || '').trim(),
      description: String(row.description || '').trim(),
      displayOrder: Number(row.displayOrder || (index + 1) * 10),
      isSelectable: row.isSelectable,
      isActive: row.isActive !== false
    }));
}

module.exports = {
  CLB_SKILLS,
  normalizeAlias,
  listActiveLevels,
  resolveLevelFromStudentText,
  getSectionTemplateForSkill,
  buildItemTree,
  buildSessionPickerTree,
  flattenSessionPickerTree,
  listSelectableItems,
  validateOutlineItemIds,
  applyDefaultSectionPolicies,
  reconcileOrgTeachingOutlineSectionPolicies,
  ensureOrgTeachingOutlineDefaults,
  importItemsForSkillLevel,
  bulkReplaceItemsForSkillLevelViaRepo,
  seedOrgTeachingOutlineItems,
  buildDashboardMatrix,
  enrichOutlineItemsForSession,
  buildOutlineExportPayload,
  normalizeOutlineImportRows,
  DEFAULT_LEVELS,
  DEFAULT_SECTION_TEMPLATES,
  WRITING_ITEMS_BY_LEVEL: require('./teachingOutlineSeedData').WRITING_ITEMS_BY_LEVEL
};
