const MICRO_RUBRIC_VERSION = 'pte-speaking-micro-rubric-v1';
const MICRO_SCORING_CONTRACT_VERSION = 2;

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

function getSpeakingMicroDefinitions(questionType = '') {
  const type = normalizeToken(questionType);
  const pronunciation = {
    id: 'pronunciation_quality',
    trait: 'pronunciation',
    answerType: 'descriptor',
    label: 'Pronunciation clarity',
    prompt: 'Choose how intelligible the spoken words are, considering sounds, word endings, stress, and listener effort.'
  };
  const fluency = {
    id: 'fluency_quality',
    trait: 'fluency',
    answerType: 'descriptor',
    label: 'Oral fluency',
    prompt: 'Choose how smooth the delivery is, considering rhythm, phrasing, long pauses, hesitations, repetitions, and restarts.'
  };

  if (type === 'speaking_read_aloud') {
    return [pronunciation, fluency];
  }

  if (type === 'speaking_repeat_sentence') {
    return [pronunciation, fluency];
  }

  if (type === 'speaking_describe_image') {
    return [
      {
        id: 'content_main_idea',
        trait: 'content',
        answerType: 'choice',
        label: 'Main visual idea',
        prompt: 'Does the response state the main idea, trend, relationship, or overall message of the image?'
      },
      {
        id: 'content_key_details',
        trait: 'content',
        answerType: 'choice',
        label: 'Key visual details',
        prompt: 'Does the response include important visual details such as numbers, categories, comparisons, trends, or expected key points?'
      },
      {
        id: 'content_visual_accuracy',
        trait: 'content',
        answerType: 'choice',
        label: 'Visual accuracy',
        prompt: 'Is the response accurate and relevant to the prompt image or supplied visual context, without unsupported claims?'
      },
      pronunciation,
      fluency
    ];
  }

  if (type === 'speaking_respond_to_situation') {
    return [
      {
        id: 'appropriacy_situation',
        trait: 'appropriacy',
        answerType: 'choice',
        label: 'Situation addressed',
        prompt: 'Does the response address the given situation instead of speaking generically or off topic?'
      },
      {
        id: 'appropriacy_function',
        trait: 'appropriacy',
        answerType: 'choice',
        label: 'Target function fulfilled',
        prompt: 'Does the response perform the required function such as apologizing, requesting, declining, explaining, or persuading?'
      },
      {
        id: 'appropriacy_register',
        trait: 'appropriacy',
        answerType: 'choice',
        label: 'Register fit',
        prompt: 'Does the response use a suitable level of formality and tone for the audience?'
      },
      {
        id: 'appropriacy_politeness',
        trait: 'appropriacy',
        answerType: 'choice',
        label: 'Politeness and clarity',
        prompt: 'Is the response polite, clear, and socially appropriate for the situation?'
      },
      {
        id: 'appropriacy_key_points',
        trait: 'appropriacy',
        answerType: 'choice',
        label: 'Required key points',
        prompt: 'Does the response cover the required key points from the prompt context?'
      },
      pronunciation,
      fluency
    ];
  }

  if (type === 'speaking_answer_short_question') {
    return [
      {
        id: 'transcript_usable',
        trait: 'vocabulary',
        answerType: 'choice',
        label: 'Usable spoken answer',
        prompt: 'Does the audio contain a usable short spoken answer?'
      },
      {
        id: 'answer_match_evidence',
        trait: 'vocabulary',
        answerType: 'choice',
        label: 'Accepted answer match',
        prompt: 'Does the recognized answer match the accepted answer set or configured aliases?'
      }
    ];
  }

  return [];
}

function buildMicroResponsesSchema() {
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

function buildMicroRubricPrompt(questionType = '') {
  const definitions = getSpeakingMicroDefinitions(questionType);
  if (!definitions.length) return '';
  const rows = definitions.map((definition) => {
    const allowed = definition.answerType === 'descriptor'
      ? 'excellent, good, developing, limited, unusable'
      : 'yes, partial, no, unclear';
    return `- ${definition.id}: ${definition.prompt} Allowed choices: ${allowed}.`;
  });
  return [
    'Micro-rubric requirement:',
    'Do not choose final trait scores. Answer each micro question with one predefined choice only.',
    'Return microResponses as an array of objects with id, choice, evidence, and confidence.',
    'For yes/partial/no/unclear questions, use only: yes, partial, no, unclear.',
    'For pronunciation and fluency descriptor questions, use only: excellent, good, developing, limited, unusable.',
    ...rows
  ].join('\n');
}

function resolveRawMicroRows(input = {}) {
  const row = isPlainObject(input) ? input : {};
  const raw = row.microResponses
    || row.micro_answers
    || row.microAnswers
    || row.microRubricResponses
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

function normalizeMicroResponseRows(input = {}) {
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

function descriptorToScore(descriptor = '', maxScore = 5) {
  const factor = DESCRIPTOR_FACTORS[descriptor] ?? 0;
  const max = Math.max(0, Number(maxScore || 0));
  return Math.min(max, Math.max(0, Math.round(max * factor)));
}

function choiceResponsesToScore(rows = [], maxScore = 5) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return 0;
  const total = list.reduce((sum, row) => sum + (CHOICE_POINTS[row.choice] ?? 0), 0);
  const max = Math.max(0, Number(maxScore || 0));
  return Math.min(max, Math.max(0, Math.round((total / list.length) * max)));
}

function evaluateSpeakingMicroRubric({
  questionType = '',
  aiAnalysis = {},
  traitMax = {}
} = {}) {
  const definitions = getSpeakingMicroDefinitions(questionType);
  const rawRows = normalizeMicroResponseRows(aiAnalysis);
  const rawById = new Map(rawRows.map((row) => [row.id, row]));
  const missingRequired = [];
  const invalidResponses = [];
  const microResponses = [];

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
    microResponses.push(normalized);
  });

  const warnings = [];
  microResponses.forEach((row) => {
    if (row.choice === 'unclear') warnings.push(`${row.label || row.id} was marked unclear by the micro rubric.`);
  });

  if (missingRequired.length || invalidResponses.length) {
    return {
      ok: false,
      microRubricVersion: MICRO_RUBRIC_VERSION,
      scoringContractVersion: MICRO_SCORING_CONTRACT_VERSION,
      microResponses,
      aggregationBreakdown: {},
      traitScores: {},
      missingRequired,
      invalidResponses,
      warnings: [
        ...warnings,
        missingRequired.length ? `Missing required micro-rubric responses: ${missingRequired.join(', ')}.` : '',
        invalidResponses.length ? `Invalid micro-rubric response choices: ${invalidResponses.map((row) => `${row.id}=${row.choice || '-'}`).join(', ')}.` : ''
      ].filter(Boolean)
    };
  }

  const grouped = microResponses.reduce((acc, row) => {
    if (!acc[row.trait]) acc[row.trait] = [];
    acc[row.trait].push(row);
    return acc;
  }, {});
  const traitScores = {};
  const aggregationBreakdown = {};

  Object.entries(grouped).forEach(([trait, rows]) => {
    const maxScore = Math.max(0, Number(traitMax[trait] ?? 5));
    const descriptor = rows.find((row) => row.answerType === 'descriptor');
    const score = descriptor
      ? descriptorToScore(descriptor.choice, maxScore)
      : choiceResponsesToScore(rows, maxScore);
    traitScores[trait] = score;
    aggregationBreakdown[trait] = {
      maxScore,
      score,
      method: descriptor ? 'descriptor_mapping' : 'choice_average',
      responseIds: rows.map((row) => row.id)
    };
  });

  return {
    ok: true,
    microRubricVersion: MICRO_RUBRIC_VERSION,
    scoringContractVersion: MICRO_SCORING_CONTRACT_VERSION,
    microResponses,
    aggregationBreakdown,
    traitScores,
    missingRequired,
    invalidResponses,
    warnings
  };
}

function collectLegacyDirectModelScores(aiAnalysis = {}, traits = []) {
  const analysis = isPlainObject(aiAnalysis) ? aiAnalysis : {};
  return traits.reduce((acc, trait) => {
    const row = isPlainObject(analysis[trait]) ? analysis[trait] : {};
    const value = row.score ?? row.band ?? row.rawScore ?? analysis[`${trait}Score`] ?? analysis[`${trait}Band`];
    const numeric = Number(value);
    acc[trait] = Number.isFinite(numeric) ? numeric : null;
    return acc;
  }, {});
}

function buildMicroFeedbackRows(microEvaluation = {}) {
  const strengths = [];
  const improvements = [];
  const rows = Array.isArray(microEvaluation.microResponses) ? microEvaluation.microResponses : [];
  rows.forEach((row) => {
    const label = row.label || row.id;
    const evidence = row.evidence ? ` Evidence: ${row.evidence}` : '';
    if (row.choice === 'yes' || row.choice === 'excellent' || row.choice === 'good') {
      strengths.push(`${label}: ${row.choice}.${evidence}`);
      return;
    }
    improvements.push(`${label}: ${row.choice}.${evidence}`);
  });
  return { strengths, improvements };
}

function buildAnswerShortQuestionMicroEvaluation({ transcript = '', match = {}, confidence = 0 } = {}) {
  const transcriptUsable = s(transcript, 50000) ? 'yes' : 'no';
  const matchChoice = match?.isCorrect ? 'yes' : 'no';
  return {
    ok: true,
    microRubricVersion: MICRO_RUBRIC_VERSION,
    scoringContractVersion: MICRO_SCORING_CONTRACT_VERSION,
    microResponses: [
      {
        id: 'transcript_usable',
        trait: 'vocabulary',
        answerType: 'choice',
        label: 'Usable spoken answer',
        choice: transcriptUsable,
        evidence: transcriptUsable === 'yes' ? s(transcript, 300) : 'No usable spoken answer was recognized.',
        confidence: normalizeConfidence(confidence)
      },
      {
        id: 'answer_match_evidence',
        trait: 'vocabulary',
        answerType: 'choice',
        label: 'Accepted answer match',
        choice: matchChoice,
        evidence: s(match?.matchedAnswer || match?.normalizedTranscript || match?.matchType || '', 300),
        confidence: normalizeConfidence(confidence)
      }
    ],
    aggregationBreakdown: {
      vocabulary: {
        maxScore: 1,
        score: match?.isCorrect ? 1 : 0,
        method: 'deterministic_answer_match',
        responseIds: ['transcript_usable', 'answer_match_evidence']
      }
    },
    traitScores: {
      vocabulary: match?.isCorrect ? 1 : 0
    },
    warnings: []
  };
}

module.exports = {
  MICRO_RUBRIC_VERSION,
  MICRO_SCORING_CONTRACT_VERSION,
  buildMicroResponsesSchema,
  buildMicroRubricPrompt,
  buildMicroFeedbackRows,
  buildAnswerShortQuestionMicroEvaluation,
  collectLegacyDirectModelScores,
  evaluateSpeakingMicroRubric,
  getSpeakingMicroDefinitions,
  normalizeMicroResponseRows
};
