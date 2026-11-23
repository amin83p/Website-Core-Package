'use strict';

/**
 * Suggested inputs/prompts for registered services when no org-specific row exists yet.
 * Admins can change these in School AI Assist → Service Definitions.
 */

const PRESETS = Object.freeze({
  'school.bimpr_goals_checker': Object.freeze({
    inputs: [
      {
        id: 'goal_1',
        label: 'Goal 1',
        type: 'textarea',
        required: false,
        helpText: 'Optional. Up to four goals; leave blank if not used.',
        defaultValue: ''
      },
      {
        id: 'goal_2',
        label: 'Goal 2',
        type: 'textarea',
        required: false,
        helpText: 'Optional.',
        defaultValue: ''
      },
      {
        id: 'goal_3',
        label: 'Goal 3',
        type: 'textarea',
        required: false,
        helpText: 'Optional.',
        defaultValue: ''
      },
      {
        id: 'goal_4',
        label: 'Goal 4',
        type: 'textarea',
        required: false,
        helpText: 'Optional.',
        defaultValue: ''
      },
      {
        id: 'student_name',
        label: 'Student name (for pronouns/naming)',
        type: 'text',
        required: false,
        helpText: 'Use instead of the word "client" when revising goals.',
        defaultValue: ''
      }
    ],
    prompt: Object.freeze({
      systemPrompt: `You are an expert editor for Bi-MPR future-goal statements on two-week student evaluation reports.
Revise only the goal text supplied by the user. Keep the same meaning and intent unless a guideline requires a wording change.
Do not invent new goals. Skip any goal input that is empty or whitespace-only.`,
      userPromptTemplate: `Revise each non-empty goal below according to the requirements. Return one revised block per goal that had input.

Requirements / expectations / criteria (apply to each revised goal; each single goal must be at most 490 characters including letters, spaces, and punctuation):
- Write future goals in future tense, singular form.
- Do not use the word "client"; use the student name if provided ({{student_name}}), otherwise "the student", or subject pronouns.
- Avoid unnecessary phrases such as "Over the next two weeks" and similar, because the report already refers to two weeks.
- Do not include book titles, unit titles, unit numbers, or page numbers.
- Do not use phrases like "in this period", "in the next two weeks", or equivalent time-frame boilerplate.

Inputs:
Goal 1:
{{goal_1}}

Goal 2:
{{goal_2}}

Goal 3:
{{goal_3}}

Goal 4:
{{goal_4}}

Student name (optional): {{student_name}}

Output format (markdown):
For each goal that had non-empty input, output a section:

## Goal N (revised)
<revised text only, max 490 characters>

If a goal was empty, omit its section entirely.
After all sections, add:

## Notes
Brief bullet list of material edits you made (optional, keep short).`
    }),
    output: Object.freeze({
      mode: 'markdown',
      jsonSchema: null,
      jsonInstructions: ''
    })
  })
});

function getDefinitionPreset(serviceKey = '') {
  const key = String(serviceKey || '').trim();
  const preset = PRESETS[key];
  if (!preset) return null;
  return {
    inputs: preset.inputs.map((row) => ({ ...row, options: Array.isArray(row.options) ? [...row.options] : [] })),
    prompt: { ...preset.prompt },
    output: { ...preset.output }
  };
}

module.exports = {
  PRESETS,
  getDefinitionPreset
};