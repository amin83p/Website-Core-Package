const { requireCoreModule } = require('./schoolCoreModuleResolver');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const reportAssignmentSessionUtils = requireCoreModule('MVC/utils/reportAssignmentSessionUtils');
const gradebookSkillCatalogService = require('./gradebookSkillCatalogService');
const sessionGradebookMakeupService = require('./sessionGradebookMakeupService');

const STUDENT_GRADEBOOK_SKILL_SUFFIXES = [
  'activity_count',
  'avg_percent',
  'min_percent',
  'max_percent',
  'points_earned',
  'points_possible'
];

function skillIdFromStudentGradebookPrefillKey(rawKey = '') {
  const normalized = String(rawKey || '').trim().toLowerCase();
  if (!normalized.startsWith('student_gradebook_skill_')) return '';
  const rest = normalized.slice('student_gradebook_skill_'.length);
  for (const suffix of STUDENT_GRADEBOOK_SKILL_SUFFIXES) {
    const token = `_${suffix}`;
    if (rest.endsWith(token)) {
      return rest.slice(0, -token.length);
    }
  }
  return '';
}

function extractSkillIdsFromTemplateSchema(schema = {}) {
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  const out = new Set();
  fields.forEach((field) => {
    const skillId = skillIdFromStudentGradebookPrefillKey(field?.prefillKey);
    if (skillId) out.add(skillId);
  });
  return gradebookSkillCatalogService.normalizeGradebookSkillIds([...out]);
}

function extractSkillIdsFromPrefillKeys(keys = []) {
  const out = new Set();
  (Array.isArray(keys) ? keys : []).forEach((raw) => {
    const skillId = skillIdFromStudentGradebookPrefillKey(raw);
    if (skillId) out.add(skillId);
  });
  return gradebookSkillCatalogService.normalizeGradebookSkillIds([...out]);
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return '';
  return token;
}

function normalizeActivitySkills(gb = {}) {
  if (Array.isArray(gb.skills) && gb.skills.length) {
    return gradebookSkillCatalogService.normalizeGradebookSkillIds(gb.skills);
  }
  return gradebookSkillCatalogService.matchSkillIdsFromLegacyText(gb.skillFocus);
}

function sessionInPeriod(session, startDate, endDate) {
  const date = normalizeDateOnly(session?.date);
  if (!date) return false;
  const start = normalizeDateOnly(startDate);
  const end = normalizeDateOnly(endDate);
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function collectGradebookActivitiesInPeriod(sessions = [], startDate = '', endDate = '') {
  const activities = [];
  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    if (!sessionInPeriod(session, startDate, endDate)) return;
    const sessionId = String(session?.sessionId || session?.id || '').trim();
    (Array.isArray(session?.gradebooks) ? session.gradebooks : []).forEach((gb) => {
      if (sessionGradebookMakeupService.isMakeupLinkedGradebookActivity(gb)) return;
      const gradebookId = String(gb?.id || '').trim();
      if (!gradebookId) return;
      const skills = normalizeActivitySkills(gb);
      if (!skills.length) return;
      activities.push({
        sessionId,
        sessionDate: normalizeDateOnly(session?.date),
        gradebookId,
        name: String(gb?.name || 'Activity').trim(),
        skills
      });
    });
  });
  return activities;
}

function countActivitiesBySkill(activities = []) {
  const counts = new Map();
  (Array.isArray(activities) ? activities : []).forEach((row) => {
    const key = `${row.sessionId}|${row.gradebookId}`;
    (Array.isArray(row.skills) ? row.skills : []).forEach((skillId) => {
      const id = String(skillId || '').trim();
      if (!id) return;
      if (!counts.has(id)) counts.set(id, new Set());
      counts.get(id).add(key);
    });
  });
  const out = new Map();
  counts.forEach((set, skillId) => out.set(skillId, set.size));
  return out;
}

function resolveTemplateIdsForSessionAssignments(assignments = [], sessionContext = {}) {
  const templateIds = new Set();
  (Array.isArray(assignments) ? assignments : []).forEach((assignment) => {
    if (!reportAssignmentSessionUtils.reportAssignmentMatchesSession(assignment, sessionContext)) return;
    const templateId = toPublicId(assignment?.templateId);
    if (templateId) templateIds.add(templateId);
  });
  return [...templateIds];
}

function resolveRequiredSkillsForSessionReports({
  assignments = [],
  sessionContext = {},
  templatesById = new Map(),
  instanceRows = []
} = {}) {
  const required = new Set();
  let gateFromTemplate = false;

  const templateIdsFromAssignments = resolveTemplateIdsForSessionAssignments(assignments, sessionContext);
  const templateIdsFromInstances = new Set();
  (Array.isArray(instanceRows) ? instanceRows : []).forEach((row) => {
    const tid = toPublicId(row?.templateId);
    if (tid) templateIdsFromInstances.add(tid);
  });

  const allTemplateIds = new Set([...templateIdsFromAssignments, ...templateIdsFromInstances]);
  allTemplateIds.forEach((templateId) => {
    const template = templatesById instanceof Map
      ? templatesById.get(templateId)
      : (templatesById && typeof templatesById === 'object' ? templatesById[templateId] : null);
    if (!template) return;
    const skills = gradebookSkillCatalogService.normalizeGradebookSkillIds(template.requiredGradebookSkills);
    skills.forEach((id) => required.add(id));
    if (skills.length && template.requireGradebookSkillsBeforeFill !== false) {
      gateFromTemplate = true;
    }
  });

  return {
    requiredSkillIds: [...required],
    gateActive: required.size > 0 && gateFromTemplate
  };
}

function evaluatePeriodSkillCoverage({
  requiredSkillIds = [],
  sessions = [],
  startDate = '',
  endDate = '',
  skillCatalog = null
} = {}) {
  const catalog = Array.isArray(skillCatalog) && skillCatalog.length
    ? skillCatalog
    : gradebookSkillCatalogService.listGradebookSkills();
  const labelById = new Map(catalog.map((row) => [String(row.id), String(row.label || row.id)]));
  const required = gradebookSkillCatalogService.normalizeGradebookSkillIds(requiredSkillIds);
  const activities = collectGradebookActivitiesInPeriod(sessions, startDate, endDate);
  const counts = countActivitiesBySkill(activities);

  const coveredSkills = [];
  const missingSkills = [];
  required.forEach((skillId) => {
    const activityCount = counts.get(skillId) || 0;
    const row = {
      id: skillId,
      label: labelById.get(skillId) || skillId,
      activityCount
    };
    if (activityCount > 0) coveredSkills.push(row);
    else missingSkills.push(row);
  });

  return {
    ready: missingSkills.length === 0,
    period: {
      startDate: normalizeDateOnly(startDate),
      endDate: normalizeDateOnly(endDate)
    },
    requiredSkills: required.map((id) => ({
      id,
      label: labelById.get(id) || id,
      activityCount: counts.get(id) || 0
    })),
    coveredSkills,
    missingSkills,
    activityCountInPeriod: activities.length
  };
}

function buildSessionSkillCoveragePayload({
  assignments = [],
  sessionContext = {},
  templatesById = new Map(),
  instanceRows = [],
  sessions = [],
  periodStart = '',
  periodDue = ''
} = {}) {
  const { requiredSkillIds, gateActive } = resolveRequiredSkillsForSessionReports({
    assignments,
    sessionContext,
    templatesById,
    instanceRows
  });

  if (!requiredSkillIds.length) {
    return {
      ready: true,
      gateActive: false,
      message: 'No required gradebook skills are configured on report templates assigned to this session.',
      requiredSkillIds: [],
      missingSkills: [],
      period: {
        startDate: normalizeDateOnly(periodStart),
        endDate: normalizeDateOnly(periodDue)
      }
    };
  }

  const evaluation = evaluatePeriodSkillCoverage({
    requiredSkillIds,
    sessions,
    startDate: periodStart,
    endDate: periodDue
  });

  return {
    ...evaluation,
    gateActive,
    requiredSkillIds,
    message: evaluation.ready
      ? 'All required gradebook skills have at least one activity in the report period.'
      : 'Some required skills do not have a gradebook activity in the report period yet.'
  };
}

module.exports = {
  extractSkillIdsFromTemplateSchema,
  extractSkillIdsFromPrefillKeys,
  collectGradebookActivitiesInPeriod,
  evaluatePeriodSkillCoverage,
  resolveRequiredSkillsForSessionReports,
  buildSessionSkillCoveragePayload
};
