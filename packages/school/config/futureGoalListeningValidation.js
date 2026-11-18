'use strict';

/** Shared policy for Future Goal: Listening (template field `futuregoal_listening`). */
const FUTURE_GOAL_LISTENING_FIELD_ID = 'futuregoal_listening';

const FUTURE_GOAL_LISTENING_VALIDATION_RULES = Object.freeze([
  {
    id: 'fg_listen_max_490',
    enabled: true,
    severity: 'error',
    when: 'if_has_value',
    expression: 'len(str(value)) <= 490',
    message: 'Future Goal: Listening must be 490 characters or fewer (including spaces and punctuation).'
  },
  {
    id: 'fg_listen_no_digits_warn',
    enabled: true,
    severity: 'warning',
    when: 'if_has_value',
    expression: 'digits(str(value)) == ""',
    message: 'Avoid unit or page numbers. Do not include book titles, unit numbers, or page references.'
  }
]);

const FUTURE_GOAL_LISTENING_HELP_TEXT = [
  'Max 490 characters (letters, spaces, punctuation).',
  'Future tense, singular (e.g. I will…); up to ~5 sentences.',
  'Do not use "client"—use the student\'s name, "the student", or pronouns (Student Name).',
  'No "Over the next two weeks" (period is already two weeks).',
  'No book titles, units, or page numbers.',
  'Print: Word template (e.g. Arial 10); font is not set here.'
].join(' ');

function applyFutureGoalListeningFieldPolicy(field) {
  if (!field || typeof field !== 'object') return field;
  if (String(field.id || '').trim() !== FUTURE_GOAL_LISTENING_FIELD_ID) return field;
  return {
    ...field,
    helpText: FUTURE_GOAL_LISTENING_HELP_TEXT,
    validationRules: FUTURE_GOAL_LISTENING_VALIDATION_RULES.map((row) => ({ ...row }))
  };
}

module.exports = {
  FUTURE_GOAL_LISTENING_FIELD_ID,
  FUTURE_GOAL_LISTENING_VALIDATION_RULES,
  FUTURE_GOAL_LISTENING_HELP_TEXT,
  applyFutureGoalListeningFieldPolicy
};