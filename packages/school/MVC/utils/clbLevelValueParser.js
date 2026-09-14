'use strict';

const CLB_SKILLS = ['listening', 'speaking', 'reading', 'writing'];
const SKILL_LABELS = {
  listening: 'Listening',
  speaking: 'Speaking',
  reading: 'Reading',
  writing: 'Writing'
};

/**
 * Parse a single CLB level token (e.g. 3, 3+, 4-).
 * Ordering: N < N+ < (N+1)- < (N+1)
 * @param {string|number} raw
 * @returns {{ raw: string, valid: boolean, base?: number, modifier?: string, sortKey?: number }}
 */
function parseClbLevelValue(raw) {
  const text = String(raw || '').trim();
  if (!text || text === '-') {
    return { raw: text, valid: false };
  }
  const match = text.match(/^(\d{1,2})([+\-])?$/);
  if (!match) {
    return { raw: text, valid: false };
  }
  const base = Number(match[1]);
  const modifier = match[2] || '';
  if (!Number.isInteger(base) || base < 1 || base > 12) {
    return { raw: text, valid: false };
  }
  let sortKey = base;
  if (modifier === '+') sortKey = base + 0.25;
  else if (modifier === '-') sortKey = base - 0.25;
  return { raw: text, valid: true, base, modifier, sortKey };
}

/**
 * @param {string|number} raw
 * @returns {number|null}
 */
function getClbBaseInteger(raw) {
  const parsed = parseClbLevelValue(raw);
  return parsed.valid ? parsed.base : null;
}

/**
 * @param {string|number} a
 * @param {string|number} b
 * @returns {-1|0|1|null}
 */
function compareClbLevelValues(a, b) {
  const left = parseClbLevelValue(a);
  const right = parseClbLevelValue(b);
  if (!left.valid || !right.valid) return null;
  if (left.sortKey < right.sortKey) return -1;
  if (left.sortKey > right.sortKey) return 1;
  return 0;
}

function readSkillGroup(entry, group) {
  const source = entry && typeof entry === 'object' ? entry[group] : null;
  return source && typeof source === 'object' ? source : {};
}

function compareSkillValues(lowerLabel, higherLabel, lowerValue, higherValue, skill) {
  const cmp = compareClbLevelValues(lowerValue, higherValue);
  if (cmp === null || cmp >= 0) return null;
  const skillLabel = SKILL_LABELS[skill] || skill;
  return {
    skill,
    field: lowerLabel,
    message: `${skillLabel}: ${lowerLabel} (${lowerValue}) is below ${higherLabel} (${higherValue}).`
  };
}

/**
 * @param {object} entry
 * @param {{ mode?: string, previousEntry?: object|null }} context
 * @returns {Array<{ skill: string, field: string, message: string }>}
 */
function evaluateClbEntryWarnings(entry, context = {}) {
  const warnings = [];
  const goal = readSkillGroup(entry, 'goal');
  const current = readSkillGroup(entry, 'current');
  const result = readSkillGroup(entry, 'result');
  const previousResult = readSkillGroup(context.previousEntry, 'result');

  CLB_SKILLS.forEach((skill) => {
    const goalWarn = compareSkillValues('goal', 'current', goal[skill], current[skill], skill);
    if (goalWarn) warnings.push(goalWarn);
    const resultWarn = compareSkillValues('result', 'current', result[skill], current[skill], skill);
    if (resultWarn) warnings.push(resultWarn);
    if (context.mode === 'new' && context.previousEntry) {
      const priorWarn = compareSkillValues('current', 'previous result', current[skill], previousResult[skill], skill);
      if (priorWarn) warnings.push(priorWarn);
    }
  });

  return warnings;
}

/**
 * @param {{ goal?: object, current?: object, result?: object }} groups
 * @param {{ mode?: string, previousEntry?: object|null }} context
 * @returns {Record<string, { skill: string, field: string, message: string }>}
 */
function evaluateClbEditorWarnings(groups = {}, context = {}) {
  const warnings = evaluateClbEntryWarnings(groups, context);
  const byField = {};
  warnings.forEach((warning) => {
    const key = `${warning.field}:${warning.skill}`;
    if (!byField[key]) byField[key] = warning;
  });
  return byField;
}

/**
 * Map editor warning to input id suffix used by CLB forms.
 * @param {{ field: string, skill: string }} warning
 * @param {'student'|'rolling'} formKind
 * @returns {string}
 */
function resolveClbEditorInputId(warning, formKind = 'student') {
  const prefix = formKind === 'rolling' ? 'inp_rolling_clb_' : 'inp_clb_';
  const groupMap = {
    goal: 'goal',
    current: 'current',
    result: 'result',
    'previous result': 'current'
  };
  const group = groupMap[warning.field] || 'current';
  return `${prefix}${group}_${warning.skill}`;
}

module.exports = {
  CLB_SKILLS,
  SKILL_LABELS,
  parseClbLevelValue,
  getClbBaseInteger,
  compareClbLevelValues,
  evaluateClbEntryWarnings,
  evaluateClbEditorWarnings,
  resolveClbEditorInputId
};
