'use strict';

const SKILL_KINDS = Object.freeze({
  CLB: 'clb',
  DIGITAL_LITERACY: 'digital_literacy',
  GENERAL: 'general'
});

const DEFAULT_SKILL_DEFINITIONS = Object.freeze([
  Object.freeze({ code: 'listening', label: 'Listening', kind: SKILL_KINDS.CLB, supportsTeachingOutline: true, sortOrder: 10 }),
  Object.freeze({ code: 'speaking', label: 'Speaking', kind: SKILL_KINDS.CLB, supportsTeachingOutline: true, sortOrder: 20 }),
  Object.freeze({ code: 'reading', label: 'Reading', kind: SKILL_KINDS.CLB, supportsTeachingOutline: true, sortOrder: 30 }),
  Object.freeze({ code: 'writing', label: 'Writing', kind: SKILL_KINDS.CLB, supportsTeachingOutline: true, sortOrder: 40 }),
  Object.freeze({ code: 'typing', label: 'Typing', kind: SKILL_KINDS.DIGITAL_LITERACY, supportsTeachingOutline: false, sortOrder: 50 }),
  Object.freeze({ code: 'typing_one_handed', label: 'Typing One-Handed', kind: SKILL_KINDS.DIGITAL_LITERACY, supportsTeachingOutline: false, sortOrder: 60 }),
  Object.freeze({ code: 'excel', label: 'Excel', kind: SKILL_KINDS.DIGITAL_LITERACY, supportsTeachingOutline: false, sortOrder: 70 }),
  Object.freeze({ code: 'word', label: 'Word', kind: SKILL_KINDS.DIGITAL_LITERACY, supportsTeachingOutline: false, sortOrder: 80 }),
  Object.freeze({ code: 'powerpoint', label: 'PowerPoint', kind: SKILL_KINDS.DIGITAL_LITERACY, supportsTeachingOutline: false, sortOrder: 90 }),
  Object.freeze({ code: 'email', label: 'Email', kind: SKILL_KINDS.DIGITAL_LITERACY, supportsTeachingOutline: false, sortOrder: 100 }),
  Object.freeze({ code: 'zoom', label: 'ZOOM', kind: SKILL_KINDS.DIGITAL_LITERACY, supportsTeachingOutline: false, sortOrder: 110 })
]);

const CLB_SKILL_CODES = Object.freeze(
  DEFAULT_SKILL_DEFINITIONS
    .filter((skill) => skill.kind === SKILL_KINDS.CLB)
    .map((skill) => skill.code)
);

function normalizeSkillCode(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function getDefaultSkillDefinition(code = '') {
  const normalized = normalizeSkillCode(code);
  return DEFAULT_SKILL_DEFINITIONS.find((skill) => skill.code === normalized) || null;
}

module.exports = {
  SKILL_KINDS,
  DEFAULT_SKILL_DEFINITIONS,
  CLB_SKILL_CODES,
  normalizeSkillCode,
  getDefaultSkillDefinition
};
