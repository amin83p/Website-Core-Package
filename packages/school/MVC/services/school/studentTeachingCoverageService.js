'use strict';

const teachingOutlineCatalogService = require('./teachingOutlineCatalogService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');

function isSessionInstructionallyComplete(session, statusPolicyMap = new Map()) {
  const code = String(session?.status || '').trim().toLowerCase();
  const policy = statusPolicyMap.get(code);
  if (policy) return Boolean(policy.isFinal) && !policy.makeUpRequired && !policy.excludeFromAttendance;
  return ['completed', 'complete'].includes(code);
}

function studentWasOnRoster(session, personId) {
  const pid = String(personId || '').trim();
  return (Array.isArray(session?.roster) ? session.roster : []).some((row) => String(row.personId) === pid);
}

async function aggregateCoverageForEnrollment({
  sessions = [],
  personId,
  orgId,
  levels = [],
  items = [],
  templates = [],
  statusPolicyMap = new Map(),
  startDate = '',
  endDate = ''
}) {
  const pid = String(personId || '').trim();
  const levelById = new Map((Array.isArray(levels) ? levels : []).map((row) => [String(row.id), row]));
  const itemById = new Map((Array.isArray(items) ? items : []).map((row) => [String(row.id), row]));
  const bySkill = {};

  teachingOutlineCatalogService.CLB_SKILLS.forEach((skillId) => {
    bySkill[skillId] = {
      levelsCovered: [],
      bySection: {},
      totalSessions: 0,
      items: []
    };
  });

  const levelSeen = new Map();
  const itemAccumulator = new Map();

  const windowStart = String(startDate || '').trim();
  const windowEnd = String(endDate || '').trim();

  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    const sessionDate = String(session?.date || '').trim();
    if (windowStart && sessionDate && sessionDate < windowStart) return;
    if (windowEnd && sessionDate && sessionDate > windowEnd) return;
    if (!studentWasOnRoster(session, pid)) return;
    if (!isSessionInstructionallyComplete(session, statusPolicyMap)) return;

    let sessionContributed = false;
    (Array.isArray(session.skillsCovered) ? session.skillsCovered : []).forEach((row) => {
      const skillId = String(row?.skillId || '').trim().toLowerCase();
      if (!bySkill[skillId]) return;
      (Array.isArray(row.outlineItems) ? row.outlineItems : []).forEach((outlineItem) => {
        const itemId = String(outlineItem?.itemId || outlineItem?.id || '').trim();
        if (!itemId) return;
        sessionContributed = true;
        const catalogItem = itemById.get(itemId);
        const levelId = String(outlineItem?.levelId || catalogItem?.levelId || '').trim();
        const level = levelById.get(levelId);
        if (levelId && level) {
          if (!levelSeen.has(`${skillId}:${levelId}`)) {
            levelSeen.set(`${skillId}:${levelId}`, {
              levelId,
              levelCode: level.code,
              levelTitle: level.title
            });
          }
        }
        const sectionKey = String(outlineItem?.sectionKey || catalogItem?.sectionKey || 'general').trim();
        const key = `${skillId}:${itemId}`;
        if (!itemAccumulator.has(key)) {
          itemAccumulator.set(key, {
            itemId,
            label: String(outlineItem?.label || catalogItem?.label || itemId).trim(),
            sectionKey,
            levelId,
            levelCode: String(outlineItem?.levelCode || level?.code || '').trim(),
            levelTitle: String(outlineItem?.levelTitle || level?.title || '').trim(),
            sessionDates: []
          });
        }
        const entry = itemAccumulator.get(key);
        if (sessionDate && !entry.sessionDates.includes(sessionDate)) {
          entry.sessionDates.push(sessionDate);
        }
      });
    });
    if (sessionContributed) {
      Object.keys(bySkill).forEach((skillId) => {
        const contributed = (session.skillsCovered || []).some((row) => (
          String(row.skillId) === skillId && (row.outlineItems || []).length > 0
        ));
        if (contributed) bySkill[skillId].totalSessions += 1;
      });
    }
  });

  itemAccumulator.forEach((entry, key) => {
    const skillId = key.split(':')[0];
    if (!bySkill[skillId]) return;
    bySkill[skillId].items.push(entry);
    if (!bySkill[skillId].bySection[entry.sectionKey]) {
      bySkill[skillId].bySection[entry.sectionKey] = [];
    }
    bySkill[skillId].bySection[entry.sectionKey].push(entry);
  });

  levelSeen.forEach((level, key) => {
    const skillId = key.split(':')[0];
    if (bySkill[skillId]) bySkill[skillId].levelsCovered.push(level);
  });

  Object.keys(bySkill).forEach((skillId) => {
    bySkill[skillId].levelsCovered.sort((a, b) => String(a.levelCode).localeCompare(String(b.levelCode)));
    bySkill[skillId].items.sort((a, b) => String(a.label).localeCompare(String(b.label)));
    const template = teachingOutlineCatalogService.getSectionTemplateForSkill(templates, skillId, orgId);
    bySkill[skillId].sectionTitles = Object.fromEntries(
      (template?.sections || []).map((section) => [section.key, section.title])
    );
  });

  return {
    personId: pid,
    bySkill
  };
}

async function buildEnrollmentCoverageReport({
  classId,
  personId,
  enrollmentPeriod = {},
  sessions = [],
  levels = [],
  items = [],
  templates = [],
  orgId,
  reqUser
}) {
  const statusPolicyMap = await sessionStatusPolicyService.getStatusMap(orgId);
  return aggregateCoverageForEnrollment({
    sessions: sessions.map((session) => ({ ...session, classId })),
    personId,
    orgId,
    levels,
    items,
    templates,
    statusPolicyMap,
    startDate: enrollmentPeriod?.startDate || '',
    endDate: enrollmentPeriod?.endDate || enrollmentPeriod?.completionDate || ''
  });
}

module.exports = {
  isSessionInstructionallyComplete,
  aggregateCoverageForEnrollment,
  buildEnrollmentCoverageReport
};
