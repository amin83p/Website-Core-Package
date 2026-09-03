const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const gradebookSkillCatalogService = require('./gradebookSkillCatalogService');
const gradebookWeightService = require('./gradebookWeightService');
const schoolFileService = require('./schoolFileService');

const GRADEBOOK_ATTACHMENT_ROLES = new Set(['test', 'answer_sheet', 'other']);
const MAX_GRADEBOOK_ATTACHMENTS = 10;
const MAX_SCORE_COMMENT_LENGTH = 2000;

function sanitizeGradebookAttachments(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  for (const row of rawList) {
    if (!row || typeof row !== 'object') continue;
    const role = String(row.role || 'other').trim().toLowerCase();
    if (!GRADEBOOK_ATTACHMENT_ROLES.has(role)) continue;
    const normalized = schoolFileService.normalizeExistingAttachment(row);
    if (!normalized) continue;
    const url = String(normalized.url || normalized.storagePath || '').trim();
    if (!url) continue;
    out.push({
      id: normalized.id,
      name: normalized.name,
      url: normalized.url,
      role,
      uploadedAt: normalized.uploadedAt || row.uploadedAt || null,
      uploadedBy: normalized.uploadedBy || row.uploadedBy || null
    });
    if (out.length >= MAX_GRADEBOOK_ATTACHMENTS) break;
  }
  return out;
}

function normalizeSessionGradebooksFromRequest(rawList, context = {}) {
  const {
    personIds = [],
    attendanceByPerson = new Map(),
    existingGradebookById = new Map(),
    sessionSkillPolicy = { selectableIds: [], catalog: [] }
  } = context;

  if (!Array.isArray(rawList)) {
    throw new Error('gradebooks must be an array.');
  }

  const normalized = [];
  for (const gb of rawList) {
    const totalScore = Number(gb.totalScore);
    if (!Number.isFinite(totalScore) || totalScore <= 0) {
      throw new Error('Each activity must have a positive total score.');
    }
    const weight = gradebookWeightService.resolveActivityWeight(gb);
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error('Each activity must have a positive weight.');
    }
    const name = String(gb.name || '').trim();
    if (!name) {
      throw new Error('Each gradebook activity must have a name.');
    }

    const gbId = String(gb.id || '').trim() || `gb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const rawScores = gb.scores && typeof gb.scores === 'object' ? gb.scores : {};
    const rawScoreComments = gb.scoreComments && typeof gb.scoreComments === 'object' ? gb.scoreComments : {};
    const scores = {};
    const scoreComments = {};

    for (const pid of personIds) {
      const att = attendanceByPerson.has(pid) ? attendanceByPerson.get(pid) : '';
      const isGradeBlocked = attendanceMatrixMetricsService.isUnmarkedAttendanceStatus(att)
        || attendanceMatrixMetricsService.isAbsentLikeStatus(att)
        || att === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE;
      let v = rawScores[pid];
      if (v === undefined) v = rawScores[String(pid)];
      if (v === '' || v === undefined) v = null;
      if (v !== null && v !== undefined) v = Number(v);

      if (isGradeBlocked) {
        scores[pid] = null;
      } else if (v === null || Number.isNaN(v)) {
        scores[pid] = null;
      } else if (v < 0 || v > totalScore) {
        throw new Error(`Scores must be between 0 and ${totalScore} (${name}).`);
      } else {
        scores[pid] = v;
      }

      if (isGradeBlocked) continue;
      let comment = rawScoreComments[pid];
      if (comment === undefined) comment = rawScoreComments[String(pid)];
      comment = String(comment || '').trim().slice(0, MAX_SCORE_COMMENT_LENGTH);
      if (comment) scoreComments[pid] = comment;
    }

    const existing = existingGradebookById.get(gbId);
    const mergedSkillIds = context.mergeHistoricalGradebookSkills
      ? context.mergeHistoricalGradebookSkills(gb, existing, sessionSkillPolicy.selectableIds)
      : (Array.isArray(gb.skills) ? gb.skills : []);
    const { skills, skillFocus } = gradebookSkillCatalogService.normalizeGradebookActivitySkills({
      ...gb,
      skills: mergedSkillIds
    }, {
      skillCatalog: sessionSkillPolicy.catalog
    });

    normalized.push({
      id: gbId,
      name: name.slice(0, 200),
      skills,
      skillFocus,
      weight,
      totalScore,
      activityContent: String(gb.activityContent || ''),
      includeInGradeCalculation: Boolean(gb.includeInGradeCalculation),
      scores,
      scoreComments,
      attachments: sanitizeGradebookAttachments(gb.attachments)
    });
  }

  return normalized;
}

module.exports = {
  GRADEBOOK_ATTACHMENT_ROLES,
  MAX_GRADEBOOK_ATTACHMENTS,
  sanitizeGradebookAttachments,
  normalizeSessionGradebooksFromRequest
};
