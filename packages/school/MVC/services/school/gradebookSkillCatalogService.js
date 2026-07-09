const GRADEBOOK_SKILLS = Object.freeze([
  Object.freeze({ id: 'listening', label: 'Listening' }),
  Object.freeze({ id: 'speaking', label: 'Speaking' }),
  Object.freeze({ id: 'reading', label: 'Reading' }),
  Object.freeze({ id: 'writing', label: 'Writing' }),
  Object.freeze({ id: 'typing', label: 'Typing' }),
  Object.freeze({ id: 'typing_one_handed', label: 'Typing One-Handed' }),
  Object.freeze({ id: 'excel', label: 'Excel' }),
  Object.freeze({ id: 'word', label: 'Word' }),
  Object.freeze({ id: 'powerpoint', label: 'PowerPoint' }),
  Object.freeze({ id: 'email', label: 'Email' }),
  Object.freeze({ id: 'zoom', label: 'ZOOM' })
]);

const SKILL_BY_ID = new Map(GRADEBOOK_SKILLS.map((skill) => [skill.id, skill]));
const SKILL_BY_LABEL = new Map(
  GRADEBOOK_SKILLS.map((skill) => [String(skill.label || '').trim().toLowerCase(), skill.id])
);

function normalizeSkillToken(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function listGradebookSkills() {
  return GRADEBOOK_SKILLS.map((skill) => ({ ...skill }));
}

function getGradebookSkillById(skillId = '') {
  const normalized = normalizeSkillToken(skillId);
  return SKILL_BY_ID.get(normalized) || null;
}

function normalizeGradebookSkillIds(input) {
  const source = Array.isArray(input) ? input : (input ? [input] : []);
  const seen = new Set();
  const output = [];
  source.forEach((value) => {
    const token = normalizeSkillToken(value);
    if (!token || !SKILL_BY_ID.has(token) || seen.has(token)) return;
    seen.add(token);
    output.push(token);
  });
  return output;
}

function formatGradebookSkillLabels(skillIds = []) {
  return normalizeGradebookSkillIds(skillIds)
    .map((id) => SKILL_BY_ID.get(id)?.label || id)
    .join(', ')
    .slice(0, 500);
}

function matchSkillIdsFromLegacyText(skillFocus = '') {
  const text = String(skillFocus || '').trim();
  if (!text) return [];

  const matched = new Set();
  const lower = text.toLowerCase();

  GRADEBOOK_SKILLS.forEach((skill) => {
    const label = String(skill.label || '').trim().toLowerCase();
    if (label && lower.includes(label)) {
      matched.add(skill.id);
    }
  });

  if (!matched.size) {
    text.split(/[,;/|]+/).forEach((part) => {
      const token = normalizeSkillToken(part);
      if (SKILL_BY_ID.has(token)) matched.add(token);
      const byLabel = SKILL_BY_LABEL.get(String(part || '').trim().toLowerCase());
      if (byLabel) matched.add(byLabel);
    });
  }

  return normalizeGradebookSkillIds([...matched]);
}

function normalizeGradebookActivitySkills(activity = {}) {
  const skills = normalizeGradebookSkillIds(
    activity?.skills || matchSkillIdsFromLegacyText(activity?.skillFocus)
  );
  return {
    skills,
    skillFocus: formatGradebookSkillLabels(skills)
  };
}

module.exports = {
  GRADEBOOK_SKILLS,
  listGradebookSkills,
  getGradebookSkillById,
  normalizeGradebookSkillIds,
  formatGradebookSkillLabels,
  matchSkillIdsFromLegacyText,
  normalizeGradebookActivitySkills
};
