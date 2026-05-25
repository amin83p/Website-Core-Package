const WRITING_MICRO_ASSESSMENT_VERSION = 'pte-writing-micro-assessment-v1';
const WRITING_SCORING_CONTRACT_VERSION = 2;

const CHOICE_POINTS = Object.freeze({
  yes: 1,
  partial: 0.5,
  no: 0,
  unclear: 0
});

const DESCRIPTOR_FACTORS = Object.freeze({
  excellent: 1,
  good: 0.8,
  developing: 0.6,
  limited: 0.25,
  unusable: 0
});

const SWT_TRAIT_MAX = Object.freeze({
  content: 2,
  form: 1,
  grammar: 2,
  vocabulary: 2
});

const EMAIL_TRAIT_MAX = Object.freeze({
  content: 3,
  emailConventions: 2,
  form: 2,
  organization: 2,
  vocabulary: 2,
  grammar: 2,
  spelling: 2
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function s(value, max = 4000) {
  if (value === undefined || value === null) return '';
  const text = String(value).replace(/\0/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function round2(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(2));
}

function normalizeConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const normalized = numeric > 1 ? numeric / 100 : numeric;
  return round2(Math.min(1, Math.max(0, normalized)));
}

function normalizeToken(value = '') {
  return s(value, 120)
    .toLowerCase()
    .replace(/[_\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function normalizeChoice(value = '') {
  const token = normalizeToken(value);
  if (token === 'true' || token === 'correct' || token === 'met' || token === 'covered') return 'yes';
  if (token === 'partly' || token === 'partially' || token === 'somewhat') return 'partial';
  if (token === 'false' || token === 'incorrect' || token === 'not_met' || token === 'missing') return 'no';
  if (Object.prototype.hasOwnProperty.call(CHOICE_POINTS, token)) return token;
  return '';
}

function normalizeDescriptor(value = '') {
  const token = normalizeToken(value);
  if (Object.prototype.hasOwnProperty.call(DESCRIPTOR_FACTORS, token)) return token;
  if (token === 'strong' || token === 'very_good') return 'good';
  if (token === 'fair' || token === 'adequate') return 'developing';
  if (token === 'weak' || token === 'poor') return 'limited';
  if (token === 'none' || token === 'missing') return 'unusable';
  return '';
}

function getWritingMicroDefinitions(questionType = '') {
  const type = normalizeToken(questionType);
  if (type === 'writing_summarize_written_text' || type === 'listening_summarize_spoken_text') {
    return [
      {
        id: 'content_main_idea',
        trait: 'content',
        answerType: 'choice',
        label: 'Main idea coverage',
        prompt: 'Does the summary capture the source text main idea accurately?'
      },
      {
        id: 'content_key_points',
        trait: 'content',
        answerType: 'choice',
        label: 'Key point coverage',
        prompt: 'Does the summary include the most important supporting key points without major omissions?'
      },
      {
        id: 'content_no_distortion',
        trait: 'content',
        answerType: 'choice',
        label: 'Meaning accuracy',
        prompt: 'Does the summary avoid contradiction, invented details, and distorted meaning?'
      },
      {
        id: 'form_single_sentence',
        trait: 'form',
        answerType: 'choice',
        label: 'Single-sentence form',
        prompt: 'Is the response written as one complete sentence?'
      },
      {
        id: 'form_word_limit',
        trait: 'form',
        answerType: 'choice',
        label: 'Word limit',
        prompt: 'Is the response inside the configured word limit?'
      },
      {
        id: 'grammar_control',
        trait: 'grammar',
        answerType: 'descriptor',
        label: 'Grammar control',
        prompt: 'Choose the level of grammar control, sentence structure, and punctuation accuracy.'
      },
      {
        id: 'vocabulary_precision',
        trait: 'vocabulary',
        answerType: 'descriptor',
        label: 'Vocabulary precision',
        prompt: 'Choose the level of word choice precision, paraphrasing, and academic vocabulary control.'
      }
    ];
  }

  if (type === 'writing_write_email') {
    return [
      {
        id: 'content_purpose',
        trait: 'content',
        answerType: 'choice',
        label: 'Purpose fulfilled',
        prompt: 'Does the email clearly achieve the scenario purpose?'
      },
      {
        id: 'content_required_points',
        trait: 'content',
        answerType: 'choice',
        label: 'Required points covered',
        prompt: 'Does the email cover the required points from the prompt?'
      },
      {
        id: 'content_relevance',
        trait: 'content',
        answerType: 'choice',
        label: 'Scenario relevance',
        prompt: 'Is the email relevant to the scenario without unsupported or off-topic content?'
      },
      {
        id: 'email_greeting_closing',
        trait: 'emailConventions',
        answerType: 'choice',
        label: 'Greeting and closing',
        prompt: 'Does the response include an appropriate greeting and closing/sign-off?'
      },
      {
        id: 'email_tone_register',
        trait: 'emailConventions',
        answerType: 'choice',
        label: 'Tone and register',
        prompt: 'Is the tone/register suitable for the recipient and scenario?'
      },
      {
        id: 'form_word_limit',
        trait: 'form',
        answerType: 'choice',
        label: 'Word limit',
        prompt: 'Is the response inside the configured word limit?'
      },
      {
        id: 'form_email_shape',
        trait: 'form',
        answerType: 'choice',
        label: 'Email shape',
        prompt: 'Does the response look like a complete email rather than notes, bullets, or an essay?'
      },
      {
        id: 'organization_sequence',
        trait: 'organization',
        answerType: 'choice',
        label: 'Logical sequence',
        prompt: 'Are ideas arranged in a logical order that a reader can follow?'
      },
      {
        id: 'organization_cohesion',
        trait: 'organization',
        answerType: 'choice',
        label: 'Cohesion',
        prompt: 'Are ideas connected with clear transitions, references, and paragraph flow?'
      },
      {
        id: 'vocabulary_appropriacy',
        trait: 'vocabulary',
        answerType: 'descriptor',
        label: 'Vocabulary appropriacy',
        prompt: 'Choose the level of word choice accuracy, range, and tone-appropriate vocabulary.'
      },
      {
        id: 'grammar_control',
        trait: 'grammar',
        answerType: 'descriptor',
        label: 'Grammar control',
        prompt: 'Choose the level of grammar accuracy, sentence control, and punctuation.'
      },
      {
        id: 'spelling_accuracy',
        trait: 'spelling',
        answerType: 'descriptor',
        label: 'Spelling accuracy',
        prompt: 'Choose the level of spelling accuracy and typo control.'
      }
    ];
  }

  return [];
}

function getDefaultWritingTraitMax(questionType = '') {
  const type = normalizeToken(questionType);
  if (type === 'writing_summarize_written_text' || type === 'listening_summarize_spoken_text') return { ...SWT_TRAIT_MAX };
  if (type === 'writing_write_email') return { ...EMAIL_TRAIT_MAX };
  return {};
}

function buildWritingMicroAssessmentsSchema() {
  return {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: true,
      required: ['id', 'choice', 'evidence', 'confidence'],
      properties: {
        id: { type: 'string' },
        choice: { type: 'string' },
        evidence: { type: 'string' },
        confidence: { type: 'number' }
      }
    }
  };
}

function buildWritingMicroAssessmentPrompt(questionType = '') {
  const definitions = getWritingMicroDefinitions(questionType);
  if (!definitions.length) return '';
  const rows = definitions.map((definition) => {
    const allowed = definition.answerType === 'descriptor'
      ? 'excellent, good, developing, limited, unusable'
      : 'yes, partial, no, unclear';
    return `- ${definition.id}: ${definition.prompt} Allowed choices: ${allowed}.`;
  });
  return [
    'Micro-assessment requirement:',
    'Do not choose final trait scores. Answer each micro-assessment with one predefined choice only.',
    'Return microAssessments as an array of objects with id, choice, evidence, and confidence.',
    'For yes/partial/no/unclear questions, use only: yes, partial, no, unclear.',
    'For descriptor questions, use only: excellent, good, developing, limited, unusable.',
    ...rows
  ].join('\n');
}

function resolveRawMicroRows(input = {}) {
  const row = isPlainObject(input) ? input : {};
  const raw = row.microAssessments
    || row.micro_assessments
    || row.microAssessmentResponses
    || row.microResponses
    || row.micro_answers
    || row.microAnswers
    || row.microRubric?.responses
    || row.microRubric?.microResponses
    || [];
  if (Array.isArray(raw)) return raw;
  if (isPlainObject(raw)) {
    return Object.entries(raw).map(([id, value]) => ({
      id,
      ...(isPlainObject(value) ? value : { choice: value })
    }));
  }
  return [];
}

function normalizeWritingMicroAssessmentRows(input = {}) {
  return resolveRawMicroRows(input)
    .map((row) => {
      if (!isPlainObject(row)) return null;
      const id = s(row.id || row.key || row.questionId || row.question_id, 120);
      if (!id) return null;
      return {
        id,
        choice: s(row.choice ?? row.answer ?? row.value ?? row.descriptor, 80),
        evidence: s(Array.isArray(row.evidence) ? row.evidence.join('; ') : (row.evidence || row.reason || row.notes || row.note), 700),
        confidence: normalizeConfidence(row.confidence)
      };
    })
    .filter(Boolean);
}

function normalizeResponseForDefinition(rawResponse = {}, definition = {}) {
  const choice = definition.answerType === 'descriptor'
    ? normalizeDescriptor(rawResponse.choice)
    : normalizeChoice(rawResponse.choice);
  if (!choice) return null;
  return {
    id: definition.id,
    trait: definition.trait,
    answerType: definition.answerType,
    label: definition.label,
    choice,
    evidence: s(rawResponse.evidence, 700),
    confidence: normalizeConfidence(rawResponse.confidence)
  };
}

function rowFactor(row = {}) {
  if (row.answerType === 'descriptor') return DESCRIPTOR_FACTORS[row.choice] ?? 0;
  return CHOICE_POINTS[row.choice] ?? 0;
}

function rowsToScore(rows = [], maxScore = 0) {
  const list = Array.isArray(rows) ? rows : [];
  const max = Math.max(0, Number(maxScore || 0));
  if (!list.length || max <= 0) return 0;
  const average = list.reduce((sum, row) => sum + rowFactor(row), 0) / list.length;
  return Math.min(max, Math.max(0, Math.round(average * max)));
}

function evaluateWritingMicroAssessments({
  questionType = '',
  aiAnalysis = {},
  traitMax = {}
} = {}) {
  const definitions = getWritingMicroDefinitions(questionType);
  const rawRows = normalizeWritingMicroAssessmentRows(aiAnalysis);
  const rawById = new Map(rawRows.map((row) => [row.id, row]));
  const missingRequired = [];
  const invalidResponses = [];
  const microAssessments = [];

  definitions.forEach((definition) => {
    const raw = rawById.get(definition.id);
    if (!raw) {
      missingRequired.push(definition.id);
      return;
    }
    const normalized = normalizeResponseForDefinition(raw, definition);
    if (!normalized) {
      invalidResponses.push({
        id: definition.id,
        choice: raw.choice,
        allowed: definition.answerType === 'descriptor'
          ? Object.keys(DESCRIPTOR_FACTORS)
          : Object.keys(CHOICE_POINTS)
      });
      return;
    }
    microAssessments.push(normalized);
  });

  const warnings = [];
  microAssessments.forEach((row) => {
    if (row.choice === 'unclear') warnings.push(`${row.label || row.id} was marked unclear by the micro-assessment.`);
  });

  if (missingRequired.length || invalidResponses.length) {
    return {
      ok: false,
      microAssessmentVersion: WRITING_MICRO_ASSESSMENT_VERSION,
      scoringContractVersion: WRITING_SCORING_CONTRACT_VERSION,
      microAssessments,
      microResponses: microAssessments,
      aggregationBreakdown: {},
      traitScores: {},
      missingRequired,
      invalidResponses,
      warnings: [
        ...warnings,
        missingRequired.length ? `Missing required writing micro-assessments: ${missingRequired.join(', ')}.` : '',
        invalidResponses.length ? `Invalid writing micro-assessment choices: ${invalidResponses.map((row) => `${row.id}=${row.choice || '-'}`).join(', ')}.` : ''
      ].filter(Boolean)
    };
  }

  const defaults = getDefaultWritingTraitMax(questionType);
  const grouped = microAssessments.reduce((acc, row) => {
    if (!acc[row.trait]) acc[row.trait] = [];
    acc[row.trait].push(row);
    return acc;
  }, {});
  const traitScores = {};
  const aggregationBreakdown = {};

  Object.entries(grouped).forEach(([trait, rows]) => {
    const maxScore = Math.max(0, Number(traitMax[trait] ?? defaults[trait] ?? 0));
    const score = rowsToScore(rows, maxScore);
    traitScores[trait] = score;
    aggregationBreakdown[trait] = {
      maxScore,
      score,
      method: 'micro_assessment_average',
      responseIds: rows.map((row) => row.id)
    };
  });

  return {
    ok: true,
    microAssessmentVersion: WRITING_MICRO_ASSESSMENT_VERSION,
    scoringContractVersion: WRITING_SCORING_CONTRACT_VERSION,
    microAssessments,
    microResponses: microAssessments,
    aggregationBreakdown,
    traitScores,
    missingRequired,
    invalidResponses,
    warnings
  };
}

function buildWritingMicroFeedbackRows(microEvaluation = {}) {
  const rows = Array.isArray(microEvaluation.microAssessments || microEvaluation.microResponses)
    ? (microEvaluation.microAssessments || microEvaluation.microResponses)
    : [];
  const strengths = [];
  const improvements = [];

  rows.forEach((row) => {
    const label = s(row.label || row.id, 120);
    const evidence = s(row.evidence, 350);
    const message = `${label}: ${row.choice}${evidence ? `. Evidence: ${evidence}` : ''}.`;
    if (row.choice === 'yes' || row.choice === 'excellent' || row.choice === 'good') strengths.push(message);
    else improvements.push(message);
  });

  return { strengths, improvements };
}

module.exports = {
  WRITING_MICRO_ASSESSMENT_VERSION,
  WRITING_SCORING_CONTRACT_VERSION,
  SWT_TRAIT_MAX,
  EMAIL_TRAIT_MAX,
  buildWritingMicroAssessmentsSchema,
  buildWritingMicroAssessmentPrompt,
  buildWritingMicroFeedbackRows,
  evaluateWritingMicroAssessments,
  getDefaultWritingTraitMax,
  getWritingMicroDefinitions,
  normalizeWritingMicroAssessmentRows
};
