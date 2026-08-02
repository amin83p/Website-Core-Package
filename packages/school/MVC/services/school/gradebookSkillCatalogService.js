const {
  DEFAULT_SKILL_DEFINITIONS,
  CLB_SKILL_CODES
} = require('../../../config/skillDefinitions');

const DEFAULT_SKILL_CATALOG = Object.freeze(
  DEFAULT_SKILL_DEFINITIONS.map((skill) => Object.freeze({
    id: skill.code,
    label: skill.label,
    kind: skill.kind,
    supportsTeachingOutline: skill.supportsTeachingOutline === true,
    active: true,
    sortOrder: Number(skill.sortOrder || 0)
  }))
);
const GRADEBOOK_SKILLS = Object.freeze(
  DEFAULT_SKILL_CATALOG.map((skill) => Object.freeze({ id: skill.id, label: skill.label }))
);

const CLB_SKILL_IDS = new Set(CLB_SKILL_CODES);

function normalizeSkillToken(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeCatalogRows(options = {}) {
  const source = Array.isArray(options?.skillCatalog)
    ? options.skillCatalog
    : (Array.isArray(options?.catalog) ? options.catalog : DEFAULT_SKILL_CATALOG);
  return source.map((row, index) => ({
    id: normalizeSkillToken(row?.id || row?.code),
    label: String(row?.label || row?.id || row?.code || '').trim(),
    kind: String(row?.kind || '').trim().toLowerCase(),
    supportsTeachingOutline: row?.supportsTeachingOutline === true,
    active: row?.active !== false,
    sortOrder: Number(row?.sortOrder || index)
  })).filter((row) => row.id && row.label);
}

function buildCatalogMaps(options = {}) {
  const rows = normalizeCatalogRows(options);
  return {
    rows,
    byId: new Map(rows.map((row) => [row.id, row])),
    byLabel: new Map(rows.map((row) => [row.label.toLowerCase(), row.id]))
  };
}

function listGradebookSkills(options = {}) {
  if (!Array.isArray(options?.skillCatalog) && !Array.isArray(options?.catalog)) {
    return GRADEBOOK_SKILLS.map((skill) => ({ ...skill }));
  }
  return normalizeCatalogRows(options).map((skill) => ({ ...skill }));
}

function getGradebookSkillById(skillId = '', options = {}) {
  const normalized = normalizeSkillToken(skillId);
  return buildCatalogMaps(options).byId.get(normalized) || null;
}

function normalizeGradebookSkillIds(input, options = {}) {
  const source = Array.isArray(input) ? input : (input ? [input] : []);
  const { byId } = buildCatalogMaps(options);
  const seen = new Set();
  const output = [];
  source.forEach((value) => {
    const token = normalizeSkillToken(value);
    if (!token || !byId.has(token) || seen.has(token)) return;
    seen.add(token);
    output.push(token);
  });
  return output;
}

function formatGradebookSkillLabels(skillIds = [], options = {}) {
  const { byId } = buildCatalogMaps(options);
  return normalizeGradebookSkillIds(skillIds, options)
    .map((id) => byId.get(id)?.label || id)
    .join(', ')
    .slice(0, 500);
}

function matchSkillIdsFromLegacyText(skillFocus = '', options = {}) {
  const text = String(skillFocus || '').trim();
  if (!text) return [];

  const { rows, byId, byLabel } = buildCatalogMaps(options);
  const matched = new Set();
  const lower = text.toLowerCase();

  rows.forEach((skill) => {
    const label = String(skill.label || '').trim().toLowerCase();
    if (label && lower.includes(label)) {
      matched.add(skill.id);
    }
  });

  if (!matched.size) {
    text.split(/[,;/|]+/).forEach((part) => {
      const token = normalizeSkillToken(part);
      if (byId.has(token)) matched.add(token);
      const matchedLabel = byLabel.get(String(part || '').trim().toLowerCase());
      if (matchedLabel) matched.add(matchedLabel);
    });
  }

  return normalizeGradebookSkillIds([...matched], options);
}

function normalizeGradebookActivitySkills(activity = {}, options = {}) {
  const skills = normalizeGradebookSkillIds(
    activity?.skills || matchSkillIdsFromLegacyText(activity?.skillFocus, options),
    options
  );
  return {
    skills,
    skillFocus: formatGradebookSkillLabels(skills, options)
  };
}

/**
 * Session curriculum rows: one entry per gradebook skill with optional coverage note and outline items.
 * @returns {{ skillId: string, skillLabel: string, primaryLevelId?: string, primaryLevelCode?: string, primaryLevelTitle?: string, note: string, outlineItems: object[] }[]}
 */
function normalizeSessionOutlineItems(raw = [], catalogItems = [], levels = [], options = {}) {
  const itemById = new Map((Array.isArray(catalogItems) ? catalogItems : []).map((row) => [String(row.id), row]));
  const levelById = new Map((Array.isArray(levels) ? levels : []).map((row) => [String(row.id), row]));
  const hasCatalog = itemById.size > 0;
  const skillId = String(options?.skillId || '').trim().toLowerCase();
  const preservedIds = new Set((options?.preserveItemIds || []).map((row) => String(row || '').trim()).filter(Boolean));
  const sectionTemplate = options?.sectionTemplate || null;
  const sectionByKey = new Map(
    (Array.isArray(sectionTemplate?.sections) ? sectionTemplate.sections : [])
      .map((section) => [String(section?.key || '').trim(), section])
  );
  const source = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const output = [];
  source.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const itemId = String(row.itemId || row.id || '').trim();
    if (!itemId || seen.has(itemId)) return;
    const catalog = itemById.get(itemId);
    const isPreserved = preservedIds.has(itemId);
    if (!catalog && (!row.label || (hasCatalog && !isPreserved))) return;
    if (catalog) {
      const catalogSkillId = String(catalog?.skillId || '').trim().toLowerCase();
      const section = sectionByKey.get(String(catalog?.sectionKey || row?.sectionKey || '').trim());
      const sectionAllowsSelection = !sectionTemplate || section?.isSelectable === true;
      const itemKind = String(catalog?.itemKind || 'checklist').trim().toLowerCase();
      const isSelectable = catalog?.isActive !== false
        && catalog?.isSelectable === true
        && itemKind === 'checklist'
        && sectionAllowsSelection
        && (!skillId || !catalogSkillId || catalogSkillId === skillId);
      if (!isSelectable && !isPreserved) return;
    }
    seen.add(itemId);
    const levelId = String(catalog?.levelId || row.levelId || '').trim();
    const level = levelById.get(levelId);
    output.push({
      itemId,
      label: String(catalog?.label || row.label || itemId).trim().slice(0, 2000),
      sectionKey: String(catalog?.sectionKey || row.sectionKey || '').trim().slice(0, 60),
      levelId,
      levelCode: String(level?.code || row.levelCode || '').trim().slice(0, 80),
      levelTitle: String(level?.title || row.levelTitle || '').trim().slice(0, 160)
    });
  });
  return output;
}

function normalizeSessionSkillsCovered(raw = [], options = {}) {
  const catalogItems = options.catalogItems || [];
  const levels = options.levels || [];
  const templates = options.templates || [];
  const preserveBySkill = options.preserveOutlineItemIdsBySkill || {};
  const skillMaps = buildCatalogMaps(options);
  const levelById = new Map((Array.isArray(levels) ? levels : []).map((row) => [String(row.id), row]));
  const source = typeof raw === 'string'
    ? (() => {
      try { return JSON.parse(raw || '[]'); } catch (_e) { return []; }
    })()
    : raw;
  if (!Array.isArray(source)) return [];

  const seen = new Set();
  const output = [];
  source.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const skillId = normalizeGradebookSkillIds([row.skillId || row.id || row.skill], options)[0];
    if (!skillId || seen.has(skillId)) return;
    seen.add(skillId);
    const skill = skillMaps.byId.get(skillId);
    const isClbSkill = skill?.kind === 'clb' || CLB_SKILL_IDS.has(skillId);
    const note = String(row.note || row.notes || row.coverageNote || '').trim().slice(0, 2000);
    const sectionTemplate = (Array.isArray(templates) ? templates : []).find((template) => (
      String(template?.skillId || '').trim().toLowerCase() === skillId
    )) || null;
    const outlineItems = normalizeSessionOutlineItems(row.outlineItems, catalogItems, levels, {
      skillId,
      sectionTemplate,
      preserveItemIds: preserveBySkill?.[skillId] || []
    });
    if (isClbSkill && !note && !outlineItems.length) {
      throw new Error(`${skill?.label || skillId} requires at least one instructional outline item or a session note.`);
    }
    const normalized = {
      skillId,
      skillLabel: skill?.label || String(row.skillLabel || row.label || skillId).trim().slice(0, 120),
      note,
      outlineItems
    };
    if (isClbSkill) {
      const requestedPrimaryLevelId = String(row.primaryLevelId || '').trim();
      const fallbackPrimaryLevelId = String(outlineItems[0]?.levelId || '').trim();
      const primaryLevelId = levelById.has(requestedPrimaryLevelId)
        ? requestedPrimaryLevelId
        : fallbackPrimaryLevelId;
      if (primaryLevelId) {
        const primaryLevel = levelById.get(primaryLevelId);
        normalized.primaryLevelId = primaryLevelId;
        normalized.primaryLevelCode = String(
          primaryLevel?.code
          || (primaryLevelId === requestedPrimaryLevelId ? row.primaryLevelCode : outlineItems[0]?.levelCode)
          || ''
        ).trim().slice(0, 80);
        normalized.primaryLevelTitle = String(
          primaryLevel?.title
          || (primaryLevelId === requestedPrimaryLevelId ? row.primaryLevelTitle : outlineItems[0]?.levelTitle)
          || ''
        ).trim().slice(0, 160);
      }
    }
    output.push(normalized);
  });
  return output;
}

module.exports = {
  GRADEBOOK_SKILLS,
  listGradebookSkills,
  getGradebookSkillById,
  normalizeGradebookSkillIds,
  formatGradebookSkillLabels,
  matchSkillIdsFromLegacyText,
  normalizeGradebookActivitySkills,
  normalizeSessionOutlineItems,
  normalizeSessionSkillsCovered
};
