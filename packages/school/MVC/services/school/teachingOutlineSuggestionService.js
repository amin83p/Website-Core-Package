'use strict';

const teachingOutlineCatalogService = require('./teachingOutlineCatalogService');
const gradebookSkillCatalogService = require('./gradebookSkillCatalogService');
const schoolDataService = require('./schoolDataService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');

function isClbSkill(skillId = '') {
  return teachingOutlineCatalogService.CLB_SKILLS.includes(String(skillId || '').trim().toLowerCase());
}

function collectPriorCoveredItemIds(sessions = [], { classId = null, beforeSessionId = null } = {}) {
  const covered = new Set();
  const sorted = [...(Array.isArray(sessions) ? sessions : [])]
    .filter((session) => {
      if (classId && String(session?.classId || '') !== String(classId)) return false;
      return true;
    })
    .sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));

  sorted.forEach((session) => {
    if (beforeSessionId && String(session.sessionId) === String(beforeSessionId)) return;
    const statusCode = String(session?.status || '').trim().toLowerCase();
    const policy = session._statusPolicy;
    const isComplete = policy ? policy.isFinal && !policy.makeUpRequired : ['completed', 'complete'].includes(statusCode);
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

async function buildSuggestionsForSession({
  orgId,
  classId,
  sessionId,
  roster = [],
  sessions = [],
  levels = [],
  items = [],
  studentsByPersonId = new Map()
}) {
  const priorCovered = collectPriorCoveredItemIds(sessions, { classId, beforeSessionId: sessionId });
  const suggestionsBySkill = {};

  for (const skillId of teachingOutlineCatalogService.CLB_SKILLS) {
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
    const skillItems = (Array.isArray(items) ? items : [])
      .filter((row) => row.skillId === skillId && row.isActive !== false && row.isSelectable);
    const levelFiltered = suggestedLevelId
      ? skillItems.filter((row) => String(row.levelId) === String(suggestedLevelId))
      : skillItems;

    const uncovered = levelFiltered.filter((row) => !priorCovered.has(String(row.id)));
    suggestionsBySkill[skillId] = {
      suggestedLevelId,
      levelCounts: Object.fromEntries(levelCounts),
      items: uncovered.slice(0, 25).map((row) => ({
        itemId: row.id,
        label: row.label,
        sectionKey: row.sectionKey,
        levelId: row.levelId
      }))
    };
  }

  return {
    priorCoveredItemIds: [...priorCovered],
    suggestionsBySkill
  };
}

async function loadSessionOutlineContext(reqUser, { classId, sessionId, roster = [] }) {
  const orgId = String(reqUser?.activeOrgId || reqUser?.organizationId || reqUser?.orgId || '').trim();
  if (!orgId) return null;

  await teachingOutlineCatalogService.ensureOrgTeachingOutlineDefaults(orgId, reqUser?.id || 'SYSTEM');

  const [levels, templates, items, sessions] = await Promise.all([
    schoolDataService.fetchData('teachingOutlineLevels', {}, reqUser),
    schoolDataService.fetchData('teachingOutlineSectionTemplates', {}, reqUser),
    schoolDataService.fetchData('teachingOutlineItems', {}, reqUser),
    schoolDataService.getClassSessions(classId, reqUser)
  ]);

  const orgLevels = teachingOutlineCatalogService.listActiveLevels(
    (levels || []).filter((row) => String(row.orgId) === orgId)
  );
  const orgItems = (items || []).filter((row) => String(row.orgId) === orgId && row.isActive !== false);
  const orgTemplates = (templates || []).filter((row) => String(row.orgId) === orgId);

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
    studentsByPersonId
  });

  const templatesBySkill = {};
  teachingOutlineCatalogService.CLB_SKILLS.forEach((skillId) => {
    templatesBySkill[skillId] = teachingOutlineCatalogService.getSectionTemplateForSkill(orgTemplates, skillId, orgId);
  });

  return {
    levels: orgLevels,
    items: orgItems,
    templatesBySkill,
    priorCoveredItemIds: suggestion.priorCoveredItemIds,
    suggestionsBySkill: suggestion.suggestionsBySkill,
    clbSkills: gradebookSkillCatalogService.listGradebookSkills().filter((skill) => isClbSkill(skill.id))
  };
}

module.exports = {
  isClbSkill,
  collectPriorCoveredItemIds,
  buildSuggestionsForSession,
  loadSessionOutlineContext
};
