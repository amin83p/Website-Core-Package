'use strict';

const teachingOutlineCatalogService = require('./teachingOutlineCatalogService');
const gradebookSkillCatalogService = require('./gradebookSkillCatalogService');
const schoolDataService = require('./schoolDataService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');

function isClbSkill(skillId = '') {
  return teachingOutlineCatalogService.CLB_SKILLS.includes(String(skillId || '').trim().toLowerCase());
}

function compareSessionChronology(a, b) {
  const keyA = `${String(a?.date || '')}T${String(a?.startTime || '')}`;
  const keyB = `${String(b?.date || '')}T${String(b?.startTime || '')}`;
  const compared = keyA.localeCompare(keyB);
  if (compared !== 0) return compared;
  return String(a?.sessionId || '').localeCompare(String(b?.sessionId || ''));
}

function collectPriorCoveredItemIds(sessions = [], { classId = null, beforeSessionId = null } = {}) {
  const covered = new Set();
  const sorted = [...(Array.isArray(sessions) ? sessions : [])]
    .filter((session) => {
      if (classId && String(session?.classId || '') !== String(classId)) return false;
      return true;
    })
    .sort(compareSessionChronology);
  const currentIndex = beforeSessionId
    ? sorted.findIndex((session) => String(session?.sessionId || '') === String(beforeSessionId))
    : -1;
  const priorSessions = currentIndex >= 0 ? sorted.slice(0, currentIndex) : sorted;

  priorSessions.forEach((session) => {
    const statusCode = String(session?.status || '').trim().toLowerCase();
    const policy = session._statusPolicy;
    const isComplete = policy
      ? policy.isFinal && !policy.makeUpRequired && !policy.excludeFromAttendance
      : ['completed', 'complete'].includes(statusCode);
    if (!isComplete) return;
    (Array.isArray(session.skillsCovered) ? session.skillsCovered : []).forEach((row) => {
      (Array.isArray(row.outlineItems) ? row.outlineItems : []).forEach((item) => {
        const id = String(item?.itemId || item?.id || '').trim();
        if (id) covered.add(id);
      });
    });
  });
  return covered;
}

function modalLevelIdFromCounts(counts = new Map()) {
  let bestId = null;
  let bestCount = 0;
  counts.forEach((count, levelId) => {
    if (count > bestCount) {
      bestCount = count;
      bestId = levelId;
    }
  });
  return bestId;
}

function suggestionGroupForSection(sectionKey = '') {
  const key = String(sectionKey || '').trim().toLowerCase();
  if (key === 'outcomes_general') return { key: 'objectives', title: 'Learning objectives', limit: 2 };
  if (key === 'grammar') return { key: 'language_focus', title: 'Language focus', limit: 2 };
  if (key === 'tasks') return { key: 'activities', title: 'Activities', limit: 3 };
  return { key: 'additional', title: 'Additional instructional content', limit: 1 };
}

function toSuggestionItem(row, level, section) {
  return {
    itemId: String(row?.id || '').trim(),
    label: String(row?.label || '').trim(),
    sectionKey: String(row?.sectionKey || '').trim(),
    sectionTitle: String(section?.title || section?.key || '').trim(),
    levelId: String(row?.levelId || level?.id || '').trim(),
    levelCode: String(level?.code || '').trim(),
    levelTitle: String(level?.title || level?.code || '').trim(),
    isPreviouslyCovered: row?.isPreviouslyCovered === true,
    isRecommended: false
  };
}

function buildLevelSuggestion({ level, items, template, priorCovered }) {
  const tree = teachingOutlineCatalogService.buildSessionPickerTree(items, template, {
    levelId: level?.id,
    priorCoveredItemIds: [...priorCovered]
  });
  const sections = tree.map((section) => {
    const selectableItems = teachingOutlineCatalogService
      .flattenSessionPickerTree([section], { selectableOnly: true })
      .map((row) => toSuggestionItem(row, level, section));
    return {
      key: section.key,
      title: section.title,
      mode: section.mode,
      selectableCount: section.selectableCount,
      items: selectableItems
    };
  });
  const grouped = new Map();
  sections.forEach((section) => {
    if (section.mode !== 'selectable' || !section.items.length) return;
    const groupMeta = suggestionGroupForSection(section.key);
    if (!grouped.has(groupMeta.key)) {
      grouped.set(groupMeta.key, {
        key: groupMeta.key,
        title: groupMeta.title,
        limit: groupMeta.limit,
        items: []
      });
    }
    grouped.get(groupMeta.key).items.push(...section.items);
  });

  const recommendedIds = new Set();
  grouped.forEach((group) => {
    const ordered = [
      ...group.items.filter((row) => !row.isPreviouslyCovered),
      ...group.items.filter((row) => row.isPreviouslyCovered)
    ];
    ordered.slice(0, group.limit).forEach((row) => recommendedIds.add(row.itemId));
  });
  sections.forEach((section) => {
    section.items = section.items.map((row) => ({
      ...row,
      isRecommended: recommendedIds.has(row.itemId)
    }));
  });
  const markNodes = (nodes = []) => nodes.map((node) => ({
    ...node,
    isRecommended: recommendedIds.has(String(node.id || '')),
    children: markNodes(node.children || [])
  }));
  const markedTree = tree.map((section) => ({ ...section, items: markNodes(section.items) }));
  const groups = [...grouped.values()].map((group) => ({
    key: group.key,
    title: group.title,
    items: group.items.map((row) => ({
      ...row,
      isRecommended: recommendedIds.has(row.itemId)
    }))
  }));

  return {
    levelId: String(level?.id || '').trim(),
    levelCode: String(level?.code || '').trim(),
    levelTitle: String(level?.title || level?.code || '').trim(),
    tree: markedTree,
    sections,
    groups,
    recommendedItemIds: [...recommendedIds]
  };
}

async function buildSuggestionsForSession({
  orgId,
  classId,
  sessionId,
  roster = [],
  sessions = [],
  levels = [],
  items = [],
  templates = [],
  studentsByPersonId = new Map(),
  skillIds = teachingOutlineCatalogService.CLB_SKILLS
}) {
  const priorCovered = collectPriorCoveredItemIds(sessions, { classId, beforeSessionId: sessionId });
  const suggestionsBySkill = {};

  for (const skillId of (Array.isArray(skillIds) ? skillIds : teachingOutlineCatalogService.CLB_SKILLS)) {
    const levelCounts = new Map();
    (Array.isArray(roster) ? roster : []).forEach((row) => {
      const personId = String(row?.personId || '').trim();
      const student = studentsByPersonId.get(personId);
      const history = Array.isArray(student?.clbLevelHistory) ? student.clbLevelHistory : [];
      const latest = [...history].sort((a, b) => String(b?.recordedAt || '').localeCompare(String(a?.recordedAt || '')))[0];
      const clbText = String(latest?.current?.[skillId] || '').trim();
      const resolved = teachingOutlineCatalogService.resolveLevelFromStudentText(levels, clbText);
      if (resolved) {
        levelCounts.set(resolved.id, (levelCounts.get(resolved.id) || 0) + 1);
      }
    });

    const suggestedLevelId = modalLevelIdFromCounts(levelCounts);
    const template = teachingOutlineCatalogService.getSectionTemplateForSkill(templates, skillId, orgId);
    const skillItems = (Array.isArray(items) ? items : [])
      .filter((row) => row.skillId === skillId && row.isActive !== false);
    const levelsById = {};
    (Array.isArray(levels) ? levels : []).forEach((level) => {
      levelsById[String(level.id)] = buildLevelSuggestion({
        level,
        items: skillItems,
        template,
        priorCovered
      });
    });
    const primaryLevel = levelsById[String(suggestedLevelId || '')]
      || Object.values(levelsById)[0]
      || null;
    const recommendedItems = primaryLevel
      ? primaryLevel.sections.flatMap((section) => section.items).filter((row) => row.isRecommended)
      : [];
    suggestionsBySkill[skillId] = {
      suggestedLevelId,
      levelCounts: Object.fromEntries(levelCounts),
      levelDistribution: (Array.isArray(levels) ? levels : [])
        .map((level) => ({
          levelId: String(level.id),
          levelCode: String(level.code || ''),
          levelTitle: String(level.title || level.code || ''),
          count: Number(levelCounts.get(level.id) || 0)
        }))
        .filter((row) => row.count > 0),
      levelsById,
      items: recommendedItems
    };
  }

  return {
    priorCoveredItemIds: [...priorCovered],
    suggestionsBySkill
  };
}

async function loadSessionOutlineContext(reqUser, { classId, sessionId, roster = [], skillIds = null, prefetchedSessions = null } = {}) {
  const orgId = String(reqUser?.activeOrgId || reqUser?.organizationId || reqUser?.orgId || '').trim();
  if (!orgId) return null;

  await teachingOutlineCatalogService.ensureOrgTeachingOutlineDefaults(orgId, reqUser?.id || 'SYSTEM');

  const sessionsPromise = Array.isArray(prefetchedSessions)
    ? Promise.resolve(prefetchedSessions)
    : schoolDataService.getClassSessions(classId, reqUser);

  const [levels, templates, items, sessions] = await Promise.all([
    schoolDataService.fetchAllData('teachingOutlineLevels', {}, reqUser),
    schoolDataService.fetchAllData('teachingOutlineSectionTemplates', {}, reqUser),
    schoolDataService.fetchAllData('teachingOutlineItems', {}, reqUser),
    sessionsPromise
  ]);

  const orgLevels = teachingOutlineCatalogService.listActiveLevels(
    (levels || []).filter((row) => String(row.orgId) === orgId)
  );
  const requestedSkillIds = Array.isArray(skillIds)
    ? [...new Set(skillIds.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))]
    : [...teachingOutlineCatalogService.CLB_SKILLS];
  const allowedSkillIds = new Set(requestedSkillIds);
  const orgItems = (items || []).filter((row) => (
    String(row.orgId) === orgId
    && row.isActive !== false
    && allowedSkillIds.has(String(row?.skillId || '').trim().toLowerCase())
  ));
  const orgTemplates = (templates || []).filter((row) => (
    String(row.orgId) === orgId
    && allowedSkillIds.has(String(row?.skillId || '').trim().toLowerCase())
  ));

  const personIds = (Array.isArray(roster) ? roster : []).map((row) => String(row.personId || '').trim()).filter(Boolean);
  const students = personIds.length
    ? await schoolDataService.fetchData('students', { personId: personIds }, reqUser)
    : [];
  const studentsByPersonId = new Map((students || []).map((row) => [String(row.personId), row]));

  const statusPolicy = await sessionStatusPolicyService.getStatusMap(orgId);
  const enrichedSessions = (Array.isArray(sessions) ? sessions : []).map((session) => ({
    ...session,
    classId,
    _statusPolicy: statusPolicy.get(String(session?.status || '').toLowerCase()) || null
  }));

  const suggestion = await buildSuggestionsForSession({
    orgId,
    classId,
    sessionId,
    roster,
    sessions: enrichedSessions,
    levels: orgLevels,
    items: orgItems,
    templates: orgTemplates,
    studentsByPersonId,
    skillIds: requestedSkillIds
  });

  const templatesBySkill = {};
  requestedSkillIds.forEach((skillId) => {
    templatesBySkill[skillId] = teachingOutlineCatalogService.getSectionTemplateForSkill(orgTemplates, skillId, orgId);
  });

  return {
    levels: orgLevels,
    items: orgItems,
    templatesBySkill,
    priorCoveredItemIds: suggestion.priorCoveredItemIds,
    suggestionsBySkill: suggestion.suggestionsBySkill,
    clbSkills: gradebookSkillCatalogService.listGradebookSkills()
      .filter((skill) => allowedSkillIds.has(skill.id) && isClbSkill(skill.id))
  };
}

module.exports = {
  isClbSkill,
  collectPriorCoveredItemIds,
  buildSuggestionsForSession,
  loadSessionOutlineContext
};
