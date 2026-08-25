'use strict';

const CLB_SKILLS = ['listening', 'speaking', 'reading', 'writing'];

/**
 * Strip +/- from CLB tokens and parse as integer 1–12.
 * @param {string|number} value
 * @returns {number|null}
 */
function normalizeClbLevelToken(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const stripped = s.replace(/[+\-]/g, '');
  const n = Number(stripped);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return n;
}

/**
 * Latest clbLevelHistory row by recordedAt (then id).
 * @param {object} student
 * @returns {object|null}
 */
function getLatestCurrentClbEntry(student) {
  const history = Array.isArray(student?.clbLevelHistory) ? student.clbLevelHistory : [];
  if (!history.length) return null;
  const sorted = [...history].sort((a, b) => {
    const dateCmp = String(b.recordedAt || '').localeCompare(String(a.recordedAt || ''));
    if (dateCmp !== 0) return dateCmp;
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
  const entry = sorted[0];
  if (!entry?.current || typeof entry.current !== 'object') return null;
  return entry;
}

/**
 * @param {object} student
 * @returns {{ entry: object|null, bySkill: Record<string, number>, levelSet: Set<number> }}
 */
function buildNormalizedCurrentClbMaps(student) {
  const entry = getLatestCurrentClbEntry(student);
  if (!entry) {
    return { entry: null, bySkill: {}, levelSet: new Set() };
  }
  const bySkill = {};
  const levelSet = new Set();
  CLB_SKILLS.forEach((skill) => {
    const n = normalizeClbLevelToken(entry.current[skill]);
    if (n !== null) {
      bySkill[skill] = n;
      levelSet.add(n);
    }
  });
  return { entry, bySkill, levelSet };
}

function buildNormalizedCurrentClbLevelSet(student) {
  return buildNormalizedCurrentClbMaps(student).levelSet;
}

/**
 * @param {object} subject
 * @returns {number|null}
 */
function getSubjectClbLevel(subject) {
  const clb = subject?.configuration?.clb;
  if (!clb || typeof clb !== 'object') return null;
  const raw = clb.level;
  if (raw === '' || raw === undefined || raw === null) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return n;
}

/**
 * Per-skill CLB levels for a subject, falling back to band level for unset skills.
 * @param {object} subject
 * @returns {Record<string, number>|null}
 */
function getSubjectClbSkillLevels(subject) {
  const clb = subject?.configuration?.clb;
  if (!clb || typeof clb !== 'object') return null;
  const bandLevel = getSubjectClbLevel(subject);
  const skillsInput = (clb.skills && typeof clb.skills === 'object' && !Array.isArray(clb.skills))
    ? clb.skills
    : {};
  const levels = {};
  CLB_SKILLS.forEach((skill) => {
    const raw = skillsInput[skill];
    if (raw === '' || raw === undefined || raw === null) {
      levels[skill] = bandLevel;
    } else {
      const n = Number(raw);
      levels[skill] = (Number.isInteger(n) && n >= 1 && n <= 12) ? n : null;
    }
  });
  if (!CLB_SKILLS.some((skill) => levels[skill] !== null)) return null;
  return levels;
}

/**
 * Skills on the subject where the student is below the required CLB level.
 * @param {object} subject
 * @param {Record<string, number>} bySkill
 * @returns {string[]}
 */
function getUnsatisfiedClbSkills(subject, bySkill) {
  const required = getSubjectClbSkillLevels(subject);
  if (!required) return CLB_SKILLS.slice();
  const unsatisfied = [];
  CLB_SKILLS.forEach((skill) => {
    const req = required[skill];
    if (req === null) return;
    const studentLevel = bySkill[skill];
    if (studentLevel === undefined || studentLevel === null || studentLevel < req) {
      unsatisfied.push(skill);
    }
  });
  return unsatisfied;
}

/**
 * @param {object} subject
 * @param {Record<string, number>} bySkill
 * @returns {boolean}
 */
function isSubjectSatisfiedByStudentClb(subject, bySkill) {
  const required = getSubjectClbSkillLevels(subject);
  if (!required) return false;
  return getUnsatisfiedClbSkills(subject, bySkill).length === 0;
}

function getProgramSubjectIds(program) {
  const rows = Array.isArray(program?.subjects) ? program.subjects : [];
  return rows
    .map((row) => String(row?.subjectId || row?.id || '').trim())
    .filter(Boolean);
}

function toSubjectCatalogMap(subjectCatalog) {
  if (subjectCatalog instanceof Map) return subjectCatalog;
  if (Array.isArray(subjectCatalog)) {
    return new Map(
      subjectCatalog
        .map((s) => [String(s?.id || '').trim(), s])
        .filter(([id]) => id)
    );
  }
  return new Map();
}

/**
 * @param {object[]} missingSubjects
 * @param {object} student
 * @param {Map|Array} subjectCatalog
 * @returns {{ clbSatisfiedMissingSubjects: object[], missingSubjects: object[] }}
 */
function partitionMissingSubjectsByClbCoverage(missingSubjects, student, subjectCatalog) {
  const { bySkill } = buildNormalizedCurrentClbMaps(student);
  const catalogMap = toSubjectCatalogMap(subjectCatalog);
  const clbSatisfiedMissingSubjects = [];
  const stillMissingSubjects = [];
  (Array.isArray(missingSubjects) ? missingSubjects : []).forEach((row) => {
    const id = String(row?.id || row?.subjectId || '').trim();
    const subject = catalogMap.get(id);
    if (isSubjectSatisfiedByStudentClb(subject, bySkill)) {
      clbSatisfiedMissingSubjects.push(row);
    } else {
      stillMissingSubjects.push(row);
    }
  });
  return { clbSatisfiedMissingSubjects, missingSubjects: stillMissingSubjects };
}

/**
 * @param {object} params
 * @returns {{ subjectIds: string[], entry: object|null, normalizedLevels: number[], matchedSubjectIds: string[] }}
 */
function suggestPlacementSubjectIds({
  student,
  program,
  missingSubjectIds,
  subjectCatalog
}) {
  const { entry, bySkill } = buildNormalizedCurrentClbMaps(student);
  if (!entry || Object.keys(bySkill).length === 0) {
    return { subjectIds: [], entry, normalizedLevels: [], matchedSubjectIds: [] };
  }

  const missingSet = new Set(
    (Array.isArray(missingSubjectIds) ? missingSubjectIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );
  const programIds = new Set(getProgramSubjectIds(program));
  const catalogMap = toSubjectCatalogMap(subjectCatalog);
  const matched = [];

  programIds.forEach((subjectId) => {
    if (!missingSet.has(subjectId)) return;
    const subject = catalogMap.get(subjectId);
    if (!isSubjectSatisfiedByStudentClb(subject, bySkill)) return;
    matched.push(subjectId);
  });

  const normalizedLevels = [...new Set(Object.values(bySkill))].sort((a, b) => a - b);
  return {
    subjectIds: matched,
    entry,
    normalizedLevels,
    matchedSubjectIds: matched
  };
}

/**
 * @param {object} clbEntry
 * @param {number[]} normalizedLevels
 * @returns {string}
 */
function buildPlacementEvidenceNote(clbEntry, normalizedLevels = []) {
  const current = clbEntry?.current || {};
  const skillLabels = { listening: 'L', speaking: 'S', reading: 'R', writing: 'W' };
  const parts = CLB_SKILLS
    .map((skill) => {
      const token = String(current[skill] || '').trim();
      if (!token) return '';
      return `${skillLabels[skill]}${token}`;
    })
    .filter(Boolean);
  const recordedAt = String(clbEntry?.recordedAt || '').trim();
  const levels = (Array.isArray(normalizedLevels) ? normalizedLevels : []).join(',');
  return `CLB placement (Current): ${parts.join(' ')} recorded ${recordedAt} → levels ${levels}`;
}

function buildClassSubjectInsightRow(subjectId, catalogMap, bySkill) {
  const id = String(subjectId || '').trim();
  const subject = catalogMap.get(id);
  const clbLevel = getSubjectClbLevel(subject);
  return {
    id,
    code: String(subject?.code || '').trim(),
    title: String(subject?.title || '').trim(),
    clbLevel,
    matchesStudentLevels: isSubjectSatisfiedByStudentClb(subject, bySkill)
  };
}

function buildQualificationSummary({
  prerequisitesSatisfied,
  normalizedLevels,
  classSubjects,
  matchedProgramSubjectCount,
  hasCurrentClb
}) {
  const levelsText = (Array.isArray(normalizedLevels) && normalizedLevels.length)
    ? normalizedLevels.join(', ')
    : '';
  if (prerequisitesSatisfied) {
    const matchedClass = (Array.isArray(classSubjects) ? classSubjects : [])
      .filter((row) => row.matchesStudentLevels);
    if (hasCurrentClb && matchedClass.length) {
      return `Prerequisites are satisfied. Latest Current CLB levels (${levelsText}) align with ${matchedClass.length} class subject CLB band(s).`;
    }
    if (hasCurrentClb && levelsText) {
      return `Prerequisites are satisfied for the selected start date. Current CLB normalized levels: ${levelsText}.`;
    }
    return 'Prerequisites for this class are satisfied for the selected start date.';
  }
  if (hasCurrentClb && levelsText) {
    return `Current CLB levels (${levelsText}) map to ${matchedProgramSubjectCount} program subject band(s); prerequisite credits may still be required.`;
  }
  return 'Prerequisite requirements are not satisfied for this class.';
}

/**
 * @param {object} params
 * @returns {object}
 */
function buildClbPlacementSlice({
  student,
  program,
  missingSubjects,
  clbSatisfiedMissingSubjects = [],
  subjectCatalogMap,
  classSubjectIds = [],
  prerequisitesSatisfied = false
}) {
  const placementMissingIds = (Array.isArray(clbSatisfiedMissingSubjects) ? clbSatisfiedMissingSubjects : [])
    .map((row) => String(row?.id || row?.subjectId || '').trim())
    .filter(Boolean);
  const result = suggestPlacementSubjectIds({
    student,
    program,
    missingSubjectIds: placementMissingIds,
    subjectCatalog: subjectCatalogMap
  });
  const { entry, bySkill } = buildNormalizedCurrentClbMaps(student);
  const normalizedLevels = result.normalizedLevels.length
    ? result.normalizedLevels
    : [...new Set(Object.values(bySkill))].sort((a, b) => a - b);
  const hasCurrentClb = entry !== null && normalizedLevels.length > 0;
  const catalogMap = toSubjectCatalogMap(subjectCatalogMap);
  const classSubjects = (Array.isArray(classSubjectIds) ? classSubjectIds : [])
    .map((subjectId) => buildClassSubjectInsightRow(subjectId, catalogMap, bySkill));

  const programIds = getProgramSubjectIds(program);
  let matchedProgramSubjectCount = 0;
  let hasProgramClbSubjects = false;
  programIds.forEach((subjectId) => {
    const subject = catalogMap.get(subjectId);
    const clbLevel = getSubjectClbLevel(subject);
    if (clbLevel === null) return;
    hasProgramClbSubjects = true;
    if (isSubjectSatisfiedByStudentClb(subject, bySkill)) matchedProgramSubjectCount += 1;
  });

  const hasClbClassSubjects = classSubjects.some((row) => row.clbLevel !== null);
  const hasInsight = hasCurrentClb || hasClbClassSubjects || hasProgramClbSubjects;

  const currentClb = entry
    ? {
      recordedAt: String(entry.recordedAt || '').trim(),
      current: CLB_SKILLS.reduce((acc, skill) => {
        acc[skill] = String(entry.current?.[skill] || '').trim();
        return acc;
      }, {}),
      normalizedBySkill: { ...bySkill },
      normalizedLevels
    }
    : null;

  const clbSatisfiedRows = (Array.isArray(clbSatisfiedMissingSubjects) ? clbSatisfiedMissingSubjects : [])
    .map((row) => ({
      id: String(row?.id || row?.subjectId || '').trim(),
      label: String(row?.label || '').trim(),
      reason: String(row?.reason || '').trim()
    }))
    .filter((row) => row.id);

  return {
    hasCurrentClb,
    normalizedLevels,
    matchedSubjectCount: result.subjectIds.length,
    placementSubjectIds: result.matchedSubjectIds,
    canApplyPlacement: hasCurrentClb && result.subjectIds.length > 0,
    hasInsight,
    currentClb,
    classSubjects,
    matchedProgramSubjectCount,
    clbSatisfiedMissingSubjects: clbSatisfiedRows,
    prerequisitesSatisfied: prerequisitesSatisfied === true,
    qualificationSummary: buildQualificationSummary({
      prerequisitesSatisfied,
      normalizedLevels,
      classSubjects,
      matchedProgramSubjectCount,
      hasCurrentClb
    })
  };
}

module.exports = {
  CLB_SKILLS,
  normalizeClbLevelToken,
  getLatestCurrentClbEntry,
  buildNormalizedCurrentClbMaps,
  buildNormalizedCurrentClbLevelSet,
  getSubjectClbLevel,
  getSubjectClbSkillLevels,
  getUnsatisfiedClbSkills,
  isSubjectSatisfiedByStudentClb,
  partitionMissingSubjectsByClbCoverage,
  suggestPlacementSubjectIds,
  buildPlacementEvidenceNote,
  buildClbPlacementSlice
};
