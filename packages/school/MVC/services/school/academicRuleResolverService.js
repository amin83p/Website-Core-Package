const { idsEqual } = require('../../utils/idAdapter');

function resolveProgramSubjectRule(program, subjectId) {
  const subjects = Array.isArray(program?.subjects) ? program.subjects : [];
  const row = subjects.find((subject) => idsEqual(subject.subjectId, subjectId));
  if (!row) return null;
  return {
    minPassingScore: row.minPassingScore ?? null,
    minPassingAverage: row.minPassingAverage ?? null,
    mustPass: row.mustPass === true,
    allowCompensation: row.allowCompensation === true,
    subjectType: String(row.subjectType || 'main')
  };
}

function resolveTermRule(program, termId) {
  const terms = Array.isArray(program?.terms) ? program.terms : [];
  const row = terms.find((term) => idsEqual(term.termId, termId));
  if (!row) return null;
  const rules = row.termAcademicRules && typeof row.termAcademicRules === 'object' ? row.termAcademicRules : {};
  return {
    minimumPassingAverage: rules.minimumPassingAverage ?? null,
    minimumPassingScore: rules.minimumPassingScore ?? null,
    totalAllowedCredits: rules.totalAllowedCredits ?? null,
    minimumRequiredCredits: rules.minimumRequiredCredits ?? null,
    allowOverload: rules.allowOverload === true,
    mustCompleteRequiredSubjects: rules.mustCompleteRequiredSubjects !== false
  };
}

function buildRuleSnapshot({ program, termId, subjectId }) {
  const subjectRule = subjectId ? resolveProgramSubjectRule(program, subjectId) : null;
  const termRule = termId ? resolveTermRule(program, termId) : null;
  return {
    minPassingScore: subjectRule?.minPassingScore ?? termRule?.minimumPassingScore ?? null,
    minPassingAverage: subjectRule?.minPassingAverage ?? termRule?.minimumPassingAverage ?? null,
    mustPass: subjectRule?.mustPass === true,
    allowCompensation: subjectRule?.allowCompensation === true
  };
}

module.exports = {
  resolveProgramSubjectRule,
  resolveTermRule,
  buildRuleSnapshot
};
