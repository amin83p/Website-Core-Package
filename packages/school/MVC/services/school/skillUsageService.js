'use strict';

const schoolDataService = require('./schoolDataService');
const { normalizeSkillCode } = require('../../../config/skillDefinitions');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function classHref(classId) {
  return `/school/classes/edit/${encodeURIComponent(classId)}`;
}

function sessionHref(classId, sessionId) {
  return `/school/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}`;
}

function pushUsage(usages, seen, usage) {
  const key = `${usage.type}:${usage.id}:${usage.detail || ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  usages.push(usage);
}

async function findSkillUsage(skillCode, orgId, reqUser) {
  const code = normalizeSkillCode(skillCode);
  const org = String(orgId || '').trim();
  if (!code || !org) return [];
  const usages = [];
  const seen = new Set();
  const [allClasses, templates, items] = await Promise.all([
    schoolDataService.fetchAllData('classes', {}, reqUser),
    schoolDataService.fetchAllData('teachingOutlineSectionTemplates', {}, reqUser),
    schoolDataService.fetchAllData('teachingOutlineItems', {}, reqUser)
  ]);
  const classes = (Array.isArray(allClasses) ? allClasses : []).filter((row) => idsEqual(row?.orgId, org));

  for (const classRow of classes) {
    const classId = toPublicId(classRow?.id);
    if (!classId) continue;
    if ((Array.isArray(classRow?.skillIds) ? classRow.skillIds : []).some((value) => normalizeSkillCode(value) === code)) {
      pushUsage(usages, seen, {
        type: 'class',
        id: classId,
        label: String(classRow?.title || classId),
        detail: 'Class assignment',
        href: classHref(classId)
      });
    }
    // eslint-disable-next-line no-await-in-loop
    const sessions = await schoolDataService.getClassSessions(classId, reqUser);
    (Array.isArray(sessions) ? sessions : []).forEach((session) => {
      const sessionId = toPublicId(session?.sessionId || session?.id);
      const covered = (Array.isArray(session?.skillsCovered) ? session.skillsCovered : [])
        .some((row) => normalizeSkillCode(row?.skillId) === code);
      const gradebook = (Array.isArray(session?.gradebooks) ? session.gradebooks : [])
        .some((row) => (Array.isArray(row?.skills) ? row.skills : [])
          .some((value) => normalizeSkillCode(value) === code));
      if (!covered && !gradebook) return;
      pushUsage(usages, seen, {
        type: 'session',
        id: sessionId || classId,
        label: `${String(classRow?.title || classId)} — ${String(session?.date || sessionId || 'Session')}`,
        detail: covered && gradebook ? 'Curriculum and gradebook' : (covered ? 'Curriculum' : 'Gradebook'),
        href: sessionId ? sessionHref(classId, sessionId) : classHref(classId)
      });
    });
  }

  (Array.isArray(templates) ? templates : [])
    .filter((row) => idsEqual(row?.orgId, org) && normalizeSkillCode(row?.skillId) === code)
    .forEach((row) => pushUsage(usages, seen, {
      type: 'teachingOutlineTemplate',
      id: String(row?.id || code),
      label: `${code} section template`,
      detail: 'Teaching outline template',
      href: `/school/teaching-outlines/${encodeURIComponent(code)}/sections`
    }));

  (Array.isArray(items) ? items : [])
    .filter((row) => idsEqual(row?.orgId, org) && normalizeSkillCode(row?.skillId) === code)
    .slice(0, 5)
    .forEach((row) => pushUsage(usages, seen, {
      type: 'teachingOutlineItem',
      id: String(row?.id || ''),
      label: String(row?.label || row?.id || 'Outline item'),
      detail: 'Teaching outline item',
      href: '/school/teaching-outlines'
    }));

  return usages;
}

module.exports = {
  findSkillUsage
};
