const VALID_SKILLS = Object.freeze(['speaking', 'writing', 'reading', 'listening']);
const VALID_TEST_TYPES = Object.freeze(['core', 'academic']);
const LONG_TRANSCRIPT_MAX_CHARS = 50000;
const DICTATION_NORMALIZATION_RULE_DEFAULTS = Object.freeze({
  caseSensitive: false,
  ignorePunctuation: true,
  normalizeWhitespace: true,
  normalizeQuotes: true
});
const TEST_TYPE_LABELS = Object.freeze({
  core: 'PTE Core',
  academic: 'PTE Academic'
});
const QUESTION_TYPE_TEST_TYPE_MAP = Object.freeze({
  speaking_read_aloud: ['core', 'academic'],
  speaking_repeat_sentence: ['core', 'academic'],
  speaking_describe_image: ['core', 'academic'],
  speaking_respond_to_situation: ['core', 'academic'],
  speaking_answer_short_question: ['academic'],
  writing_summarize_written_text: ['core', 'academic'],
  writing_write_email: ['core'],
  writing_short_answer: ['academic'],
  writing_essay: ['academic'],
  reading_mcq_single: ['core', 'academic'],
  reading_mcq_multiple: ['core', 'academic'],
  reading_true_false: ['academic'],
  reading_writing_fill_in_blank: ['core', 'academic'],
  reading_fill_in_blank: ['core', 'academic'],
  reading_reorder_paragraphs: ['core', 'academic'],
  reading_matching: ['academic'],
  listening_summarize_spoken_text: ['core', 'academic'],
  listening_mcq_single: ['core', 'academic'],
  listening_mcq_multiple: ['core', 'academic'],
  listening_fill_in_blank: ['core', 'academic'],
  listening_select_missing_word: ['core', 'academic'],
  listening_highlight_incorrect_words: ['core', 'academic'],
  listening_dictation: ['core', 'academic'],
  listening_matching: ['academic']
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanString(value, { max = 4000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function normalizeNumber(value, fallback = 0, { min = null, max = null } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error('Value must be numeric.');
  if (Number.isFinite(min) && numeric < min) throw new Error(`Value must be at least ${min}.`);
  if (Number.isFinite(max) && numeric > max) throw new Error(`Value must be at most ${max}.`);
  return Number(numeric.toFixed(6));
}

function normalizeInteger(value, fallback = 0, { min = null, max = null } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) throw new Error('Value must be an integer.');
  if (Number.isFinite(min) && numeric < min) throw new Error(`Value must be at least ${min}.`);
  if (Number.isFinite(max) && numeric > max) throw new Error(`Value must be at most ${max}.`);
  return numeric;
}

function parseJsonLike(value, { fallback = null } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  const token = String(value || '').trim();
  if (!token) return fallback;
  try {
    return JSON.parse(token);
  } catch (_) {
    throw new Error('Invalid JSON value.');
  }
}

function normalizeStringArray(value, { maxItem = 300, dedupe = true } = {}) {
  const source = Array.isArray(value)
    ? value
    : String(value || '')
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  const out = [];
  const seen = new Set();
  source.forEach((item) => {
    const clean = cleanString(item, { max: maxItem, allowEmpty: true }) || '';
    if (!clean) return;
    const key = clean.toLowerCase();
    if (dedupe && seen.has(key)) return;
    if (dedupe) seen.add(key);
    out.push(clean);
  });
  return out;
}

function normalizeFieldValue(field, rawValue) {
  const fallback = field.default;
  try {
    if (field.input === 'number') return normalizeNumber(rawValue, fallback, { min: field.min, max: field.max });
    if (field.input === 'integer') return normalizeInteger(rawValue, fallback, { min: field.min, max: field.max });
    if (field.input === 'boolean') return normalizeBoolean(rawValue, fallback === true);
    if (field.input === 'list_string') {
      const hasFallbackRows = Array.isArray(fallback) && fallback.length > 0;
      const isMissing = (
        rawValue === undefined
        || rawValue === null
        || rawValue === ''
        || (Array.isArray(rawValue) && rawValue.length === 0)
      );
      const source = (isMissing && hasFallbackRows) ? fallback : rawValue;
      return normalizeStringArray(source, { maxItem: field.maxItem || 300 });
    }
    if (field.input === 'json') {
      const parsed = parseJsonLike(rawValue, { fallback: field.default });
      if (field.jsonKind === 'array' && !Array.isArray(parsed)) {
        throw new Error(`${field.label} must be a JSON array.`);
      }
      if (field.jsonKind === 'object' && !isPlainObject(parsed)) {
        throw new Error(`${field.label} must be a JSON object.`);
      }
      return parsed;
    }
    if (field.input === 'select') {
      const token = cleanString(rawValue, { max: 120, allowEmpty: true }) || '';
      if (!token) return cleanString(fallback, { max: 120, allowEmpty: true }) || '';
      const options = Array.isArray(field.options) ? field.options.map((item) => String(item.value || item).trim()) : [];
      if (options.length && !options.includes(token)) {
        throw new Error(`${field.label} contains an unsupported value.`);
      }
      return token;
    }
    return cleanString(rawValue, { max: field.max || 4000, allowEmpty: true }) || (fallback || '');
  } catch (error) {
    throw new Error(`${field.label}: ${error.message}`);
  }
}

function isMissingRequiredValue(field, value) {
  if (!field.required) return false;
  if (field.input === 'number' || field.input === 'integer') return value === null || value === undefined || Number.isNaN(Number(value));
  if (field.input === 'boolean') return value === null || value === undefined;
  if (field.input === 'list_string') return !Array.isArray(value) || value.length === 0;
  if (field.input === 'json') {
    if (field.jsonKind === 'array') return !Array.isArray(value) || value.length === 0;
    if (field.jsonKind === 'object') return !isPlainObject(value) || Object.keys(value).length === 0;
    return value === null || value === undefined;
  }
  return !cleanString(value, { max: 4000, allowEmpty: true });
}

function field(key, label, input, options = {}) {
  return {
    key,
    label,
    input,
    required: options.required === true,
    default: options.default,
    min: options.min,
    max: options.max,
    maxItem: options.maxItem,
    jsonKind: options.jsonKind || 'any',
    options: Array.isArray(options.options) ? options.options : []
  };
}

function normalizeTestTypeValue(value, fallback = '') {
  const token = String(value || '').trim().toLowerCase();
  if (VALID_TEST_TYPES.includes(token)) return token;
  const fallbackToken = String(fallback || '').trim().toLowerCase();
  return VALID_TEST_TYPES.includes(fallbackToken) ? fallbackToken : '';
}

function resolveAllowedTestTypesForType(typeKey = '') {
  const key = String(typeKey || '').trim();
  const mapped = QUESTION_TYPE_TEST_TYPE_MAP[key];
  if (Array.isArray(mapped) && mapped.length) {
    const filtered = mapped
      .map((item) => normalizeTestTypeValue(item))
      .filter(Boolean);
    if (filtered.length) return filtered;
  }
  return [...VALID_TEST_TYPES];
}

function inferDefaultTestTypeForType(typeKey = '') {
  const allowed = resolveAllowedTestTypesForType(typeKey);
  if (allowed.length === 1) return allowed[0];
  return 'academic';
}

function isQuestionTypeAllowedForTestType(typeKey = '', testType = '') {
  const token = normalizeTestTypeValue(testType);
  if (!token) return false;
  return resolveAllowedTestTypesForType(typeKey).includes(token);
}

const SPEAKING_SCORING_TRAIT_KEYS = Object.freeze({
  speaking_describe_image: Object.freeze(['content', 'pronunciation', 'fluency']),
  speaking_respond_to_situation: Object.freeze(['appropriacy', 'pronunciation', 'fluency'])
});

const TYPE_REGISTRY = Object.freeze({
  speaking_read_aloud: {
    skill: 'speaking',
    label: 'Speaking - Read Aloud',
    purpose: 'Assess clear oral reading with pronunciation and fluency.',
    requiredFields: [
      field('sourceText', 'Source Text', 'textarea', { required: true, max: 8000 }),
      field('prepTimeSeconds', 'Prep Time (Seconds)', 'integer', { required: true, min: 1, default: 25 }),
      field('responseTimeSeconds', 'Response Time (Seconds)', 'integer', { required: true, min: 1, default: 40 })
    ],
    optionalFields: [
      field('referenceTranscript', 'Reference Transcript', 'textarea', { max: 8000 }),
      field('pronunciationNotes', 'Pronunciation Notes', 'textarea', { max: 2000 }),
      field('sampleAudioAssetId', 'Sample Audio Asset ID', 'text', { max: 180 })
    ],
    hiddenFields: ['options', 'correctOptionKey', 'acceptedAnswers', 'requiredPoints', 'minWords', 'maxWords', 'targetRegister', 'targetFunction', 'imageAssetId'],
    payloadFields: ['sourceText', 'prepTimeSeconds', 'responseTimeSeconds', 'referenceTranscript', 'sampleAudioAssetId'],
    scoringDefaults: {
      method: 'hybrid_ai_audio',
      scorerVersion: 'pte-read-aloud-v1',
      maxScoreMode: 'dynamic_source_word_count_plus_traits',
      maxScore: 5,
      traits: ['content', 'pronunciation', 'fluency'],
      contentScoringMode: 'word_alignment_errors',
      pronunciationMax: 5,
      fluencyMax: 5,
      idealWpmMin: 90,
      idealWpmMax: 160,
      longPauseSeconds: 2,
      minAnalysisConfidence: 0.35
    },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'hybrid_ai_audio' }),
      field('scorerVersion', 'Scorer Version', 'text', { required: true, default: 'pte-read-aloud-v1', max: 120 }),
      field('maxScoreMode', 'Max Score Mode', 'select', {
        required: true,
        default: 'dynamic_source_word_count_plus_traits',
        options: [
          { value: 'dynamic_source_word_count_plus_traits', label: 'Dynamic source word count + speaking traits' },
          { value: 'fixed', label: 'Fixed legacy max score' }
        ]
      }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 5 }),
      field('traits', 'Trait List', 'list_string', { required: true, default: ['content', 'pronunciation', 'fluency'] }),
      field('contentScoringMode', 'Content Scoring Mode', 'select', {
        required: true,
        default: 'word_alignment_errors',
        options: [
          { value: 'word_alignment_errors', label: 'Word alignment errors' }
        ]
      }),
      field('pronunciationMax', 'Pronunciation Max', 'number', { required: true, min: 0.000001, max: 5, default: 5 }),
      field('fluencyMax', 'Fluency Max', 'number', { required: true, min: 0.000001, max: 5, default: 5 }),
      field('idealWpmMin', 'Ideal WPM Minimum', 'integer', { required: true, min: 40, max: 260, default: 90 }),
      field('idealWpmMax', 'Ideal WPM Maximum', 'integer', { required: true, min: 40, max: 260, default: 160 }),
      field('longPauseSeconds', 'Long Pause Seconds', 'number', { required: true, min: 0.5, max: 10, default: 2 }),
      field('minAnalysisConfidence', 'Minimum Analysis Confidence', 'number', { required: true, min: 0, max: 1, default: 0.35 })
    ],
    responseShape: { audioAssetId: 'string', transcript: 'string', durationSeconds: 'number', asrMeta: 'object', timingMeta: 'object' },
    validationRules: [
      'sourceText required',
      'prepTimeSeconds > 0',
      'responseTimeSeconds > 0',
      'valid Read Aloud scorer version and dynamic max score settings',
      'traits must include content/pronunciation/fluency',
      'pronunciationMax and fluencyMax are 5',
      'idealWpmMin >= 40 and idealWpmMax <= 260 with idealWpmMax >= idealWpmMin',
      'longPauseSeconds between 0.5 and 10',
      'minAnalysisConfidence between 0 and 1'
    ],
    previewRules: ['Render source text block with speaking timer controls.'],
    editorBehavior: { partial: 'speaking_read_aloud', mediaInputs: ['sampleAudioAssetId'], timingInputs: ['prepTimeSeconds', 'responseTimeSeconds'] }
  },
  speaking_repeat_sentence: {
    skill: 'speaking',
    label: 'Speaking - Repeat Sentence',
    purpose: 'Assess listening recall and spoken reconstruction accuracy.',
    requiredFields: [
      field('promptAudioAssetId', 'Prompt Audio Asset ID', 'text', { required: true, max: 180 }),
      field('expectedTranscript', 'Expected Transcript', 'textarea', { required: true, max: 5000 }),
      field('responseTimeSeconds', 'Response Time (Seconds)', 'integer', { required: true, min: 1, default: 20 })
    ],
    optionalFields: [
      field('transcriptVariants', 'Transcript Variants', 'list_string', { maxItem: 500 }),
      field('sampleAudioAssetId', 'Sample Audio Asset ID', 'text', { max: 180 })
    ],
    hiddenFields: ['options', 'imageAssetId', 'sourceText', 'requiredPoints', 'minWords', 'maxWords', 'targetRegister', 'targetFunction'],
    payloadFields: ['promptAudioAssetId', 'expectedTranscript', 'transcriptVariants', 'responseTimeSeconds'],
    scoringDefaults: {
      method: 'hybrid_ai_audio_repetition',
      scorerVersion: 'pte-repeat-sentence-v1',
      maxScore: 13,
      maxScoreMode: 'fixed_content_3_plus_traits',
      contentMax: 3,
      pronunciationMax: 5,
      fluencyMax: 5,
      traits: ['content', 'pronunciation', 'fluency'],
      contentScoringMode: 'ordered_prompt_word_coverage',
      idealWpmMin: 90,
      idealWpmMax: 170,
      longPauseSeconds: 2,
      minAnalysisConfidence: 0.35
    },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'hybrid_ai_audio_repetition' }),
      field('scorerVersion', 'Scorer Version', 'text', { required: true, default: 'pte-repeat-sentence-v1' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 13 }),
      field('maxScoreMode', 'Max Score Mode', 'select', {
        required: true,
        default: 'fixed_content_3_plus_traits',
        options: [
          { value: 'fixed_content_3_plus_traits', label: 'Fixed content 3 plus traits' },
          { value: 'fixed', label: 'Fixed legacy max score' }
        ]
      }),
      field('contentMax', 'Content Max', 'number', { required: true, min: 0.000001, max: 3, default: 3 }),
      field('pronunciationMax', 'Pronunciation Max', 'number', { required: true, min: 0.000001, max: 5, default: 5 }),
      field('fluencyMax', 'Fluency Max', 'number', { required: true, min: 0.000001, max: 5, default: 5 }),
      field('traits', 'Trait List', 'list_string', { required: true, default: ['content', 'pronunciation', 'fluency'] }),
      field('contentScoringMode', 'Content Scoring Mode', 'select', {
        required: true,
        default: 'ordered_prompt_word_coverage',
        options: [
          { value: 'ordered_prompt_word_coverage', label: 'Ordered prompt-word coverage' }
        ]
      }),
      field('idealWpmMin', 'Ideal WPM Minimum', 'integer', { required: true, min: 40, max: 260, default: 90 }),
      field('idealWpmMax', 'Ideal WPM Maximum', 'integer', { required: true, min: 40, max: 260, default: 170 }),
      field('longPauseSeconds', 'Long Pause Seconds', 'number', { required: true, min: 0.5, max: 10, default: 2 }),
      field('minAnalysisConfidence', 'Minimum Analysis Confidence', 'number', { required: true, min: 0, max: 1, default: 0.35 })
    ],
    responseShape: { audioAssetId: 'string', transcript: 'string', durationSeconds: 'number', asrMeta: 'object', timingMeta: 'object' },
    validationRules: [
      'promptAudioAssetId required',
      'expectedTranscript required',
      'responseTimeSeconds > 0',
      'valid Repeat Sentence scorer version and fixed content+trait max score settings',
      'traits must include content/pronunciation/fluency',
      'contentMax is 3; pronunciationMax and fluencyMax are 5',
      'idealWpmMin >= 40 and idealWpmMax <= 260 with idealWpmMax >= idealWpmMin',
      'longPauseSeconds between 0.5 and 10',
      'minAnalysisConfidence between 0 and 1'
    ],
    previewRules: ['Render prompt audio player with one-pass listening UI.'],
    editorBehavior: { partial: 'speaking_repeat_sentence', mediaInputs: ['promptAudioAssetId', 'sampleAudioAssetId'], timingInputs: ['responseTimeSeconds'] }
  },
  speaking_describe_image: {
    skill: 'speaking',
    label: 'Speaking - Describe Image',
    purpose: 'Assess spoken description and interpretation of visual data.',
    requiredFields: [
      field('imageAssetId', 'Image Asset ID', 'text', { required: true, max: 180 }),
      field('prepTimeSeconds', 'Prep Time (Seconds)', 'integer', { required: true, min: 1, default: 25 }),
      field('responseTimeSeconds', 'Response Time (Seconds)', 'integer', { required: true, min: 1, default: 40 })
    ],
    optionalFields: [
      field('imageCaption', 'Image Caption', 'text', { max: 300 }),
      field('expectedKeyPoints', 'Expected Key Points', 'list_string'),
      field('chartType', 'Chart Type', 'text', { max: 80 })
    ],
    hiddenFields: ['options', 'correctOptionKey', 'acceptedAnswers', 'requiredPoints', 'minWords', 'maxWords'],
    payloadFields: ['imageAssetId', 'imageCaption', 'expectedKeyPoints', 'prepTimeSeconds', 'responseTimeSeconds', 'chartType'],
    scoringDefaults: {
      method: 'hybrid_ai_audio_visual',
      scorerVersion: 'pte-describe-image-v1',
      maxScore: 15,
      traits: ['content', 'pronunciation', 'fluency'],
      traitWeights: { content: 0.5, pronunciation: 0.25, fluency: 0.25 },
      contentMax: 5,
      pronunciationMax: 5,
      fluencyMax: 5,
      contentCoverageMin: 0.6,
      minResponseSeconds: 20,
      idealWpmMin: 90,
      idealWpmMax: 160,
      longPauseSeconds: 2,
      offTopicPenalty: 0.2,
      minAnalysisConfidence: 0.35
    },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'hybrid_ai_audio_visual' }),
      field('scorerVersion', 'Scorer Version', 'text', { default: 'pte-describe-image-v1' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 15 }),
      field('traits', 'Trait List', 'list_string', { required: true, default: ['content', 'pronunciation', 'fluency'] }),
      field('traitWeights', 'Trait Weights JSON', 'json', {
        required: true,
        jsonKind: 'object',
        default: { content: 0.5, pronunciation: 0.25, fluency: 0.25 }
      }),
      field('contentMax', 'Content Max Score', 'number', { required: true, min: 0.000001, max: 5, default: 5 }),
      field('pronunciationMax', 'Pronunciation Max Score', 'number', { required: true, min: 0.000001, max: 5, default: 5 }),
      field('fluencyMax', 'Fluency Max Score', 'number', { required: true, min: 0.000001, max: 5, default: 5 }),
      field('contentCoverageMin', 'Content Coverage Minimum', 'number', { required: true, min: 0, max: 1, default: 0.6 }),
      field('minResponseSeconds', 'Minimum Response Seconds', 'integer', { required: true, min: 1, default: 20 }),
      field('idealWpmMin', 'Ideal WPM Minimum', 'integer', { required: true, min: 40, max: 260, default: 90 }),
      field('idealWpmMax', 'Ideal WPM Maximum', 'integer', { required: true, min: 40, max: 260, default: 160 }),
      field('longPauseSeconds', 'Long Pause Seconds', 'number', { default: 2, min: 0.5, max: 10 }),
      field('offTopicPenalty', 'Off-topic Penalty', 'number', { required: true, min: 0, max: 1, default: 0.2 }),
      field('minAnalysisConfidence', 'Minimum Analysis Confidence', 'number', { default: 0.35, min: 0, max: 1 })
    ],
    responseShape: { audioAssetId: 'string', transcript: 'string', durationSeconds: 'number', asrMeta: 'object', timingMeta: 'object' },
    validationRules: [
      'imageAssetId required',
      'prepTimeSeconds > 0',
      'responseTimeSeconds > 0',
      'scorerVersion must be pte-describe-image-v1',
      'content/pronunciation/fluency max scores must be > 0 and <= 5',
      'traitWeights must include content/pronunciation/fluency and sum to 1',
      'contentCoverageMin and offTopicPenalty must be between 0 and 1',
      'idealWpmMin >= 40 and idealWpmMax <= 260 with idealWpmMax >= idealWpmMin',
      'longPauseSeconds must be between 0.5 and 10',
      'minAnalysisConfidence must be between 0 and 1'
    ],
    previewRules: ['Render image plus timed speaking response controls.'],
    editorBehavior: { partial: 'speaking_describe_image', mediaInputs: ['imageAssetId'], timingInputs: ['prepTimeSeconds', 'responseTimeSeconds'] }
  },
  speaking_respond_to_situation: {
    skill: 'speaking',
    label: 'Speaking - Respond to Situation',
    purpose: 'Assess contextual oral response with role and register awareness.',
    requiredFields: [
      field('situationText', 'Situation Text', 'textarea', { required: true, max: 8000 }),
      field('role', 'Role', 'text', { required: true, max: 120 }),
      field('audience', 'Audience', 'text', { required: true, max: 120 }),
      field('targetFunction', 'Target Function', 'text', { required: true, max: 120 }),
      field('targetRegister', 'Target Register', 'text', { required: true, max: 120 }),
      field('prepTimeSeconds', 'Prep Time (Seconds)', 'integer', { required: true, min: 1, default: 25 }),
      field('responseTimeSeconds', 'Response Time (Seconds)', 'integer', { required: true, min: 1, default: 40 })
    ],
    optionalFields: [
      field('contextNotes', 'Context Notes', 'textarea', { max: 2000 }),
      field('expectedKeyPoints', 'Expected Key Points', 'list_string'),
      field('politenessLevel', 'Politeness Level', 'text', { max: 80 })
    ],
    hiddenFields: ['options', 'correctOptionKey', 'imageAssetId', 'sourceText', 'minWords', 'maxWords'],
    payloadFields: ['situationText', 'role', 'audience', 'targetFunction', 'targetRegister', 'contextNotes', 'expectedKeyPoints', 'politenessLevel', 'prepTimeSeconds', 'responseTimeSeconds'],
    scoringDefaults: {
      method: 'hybrid_ai_audio_situational',
      scorerVersion: 'pte-respond-to-situation-v1',
      maxScore: 13,
      maxScoreMode: 'fixed_appropriacy_3_plus_traits',
      appropriacyMax: 3,
      pronunciationMax: 5,
      fluencyMax: 5,
      traits: ['appropriacy', 'pronunciation', 'fluency'],
      traitWeights: { appropriacy: 0.5, pronunciation: 0.25, fluency: 0.25 },
      contentCoverageMin: 0.6,
      minResponseSeconds: 20,
      idealWpmMin: 85,
      idealWpmMax: 155,
      longPauseSeconds: 2,
      offTopicPenalty: 0.25,
      minAnalysisConfidence: 0.35
    },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'hybrid_ai_audio_situational' }),
      field('scorerVersion', 'Scorer Version', 'text', { required: true, default: 'pte-respond-to-situation-v1' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 13 }),
      field('maxScoreMode', 'Max Score Mode', 'select', {
        required: true,
        default: 'fixed_appropriacy_3_plus_traits',
        options: [
          { value: 'fixed_appropriacy_3_plus_traits', label: 'Fixed appropriacy 3 plus traits' },
          { value: 'fixed', label: 'Fixed legacy max score' }
        ]
      }),
      field('appropriacyMax', 'Appropriacy Max', 'number', { required: true, min: 0.000001, max: 3, default: 3 }),
      field('pronunciationMax', 'Pronunciation Max', 'number', { required: true, min: 0.000001, max: 5, default: 5 }),
      field('fluencyMax', 'Fluency Max', 'number', { required: true, min: 0.000001, max: 5, default: 5 }),
      field('traits', 'Trait List', 'list_string', { required: true, default: ['appropriacy', 'pronunciation', 'fluency'] }),
      field('traitWeights', 'Trait Weights JSON', 'json', {
        required: true,
        jsonKind: 'object',
        default: { appropriacy: 0.5, pronunciation: 0.25, fluency: 0.25 }
      }),
      field('contentCoverageMin', 'Content Coverage Minimum', 'number', { required: true, min: 0, max: 1, default: 0.6 }),
      field('minResponseSeconds', 'Minimum Response Seconds', 'integer', { required: true, min: 1, default: 20 }),
      field('idealWpmMin', 'Ideal WPM Minimum', 'integer', { required: true, min: 40, max: 260, default: 85 }),
      field('idealWpmMax', 'Ideal WPM Maximum', 'integer', { required: true, min: 40, max: 260, default: 155 }),
      field('longPauseSeconds', 'Long Pause Seconds', 'number', { required: true, min: 0.5, max: 10, default: 2 }),
      field('offTopicPenalty', 'Off-topic Penalty', 'number', { required: true, min: 0, max: 1, default: 0.25 }),
      field('minAnalysisConfidence', 'Minimum Analysis Confidence', 'number', { required: true, min: 0, max: 1, default: 0.35 })
    ],
    responseShape: { audioAssetId: 'string', transcript: 'string', durationSeconds: 'number', asrMeta: 'object', timingMeta: 'object' },
    validationRules: [
      'situationText, role, audience, targetFunction, and targetRegister required',
      'prepTimeSeconds > 0',
      'responseTimeSeconds > 0',
      'valid Respond to a Situation scorer version and fixed max score settings',
      'appropriacyMax is 3; pronunciationMax and fluencyMax are 5',
      'traitWeights must include appropriacy/pronunciation/fluency and sum to 1',
      'contentCoverageMin and offTopicPenalty must be between 0 and 1',
      'idealWpmMin >= 40 and idealWpmMax <= 260 with idealWpmMax >= idealWpmMin',
      'longPauseSeconds between 0.5 and 10',
      'minAnalysisConfidence between 0 and 1'
    ],
    previewRules: ['Render scenario card with role/audience metadata and timed response controls.'],
    editorBehavior: { partial: 'speaking_respond_to_situation', mediaInputs: [], timingInputs: ['prepTimeSeconds', 'responseTimeSeconds'] }
  },
  speaking_answer_short_question: {
    skill: 'speaking',
    label: 'Speaking - Answer Short Question',
    purpose: 'Assess short factual spoken answers with correctness matching.',
    requiredFields: [
      field('promptTextOrAudio', 'Prompt Text or Audio Asset ID', 'text', { required: true, max: 300 }),
      field('acceptedAnswers', 'Accepted Answers', 'list_string', { required: true }),
      field('responseTimeSeconds', 'Response Time (Seconds)', 'integer', { required: true, min: 1, default: 15 })
    ],
    optionalFields: [
      field('transcript', 'Prompt Transcript', 'textarea', { max: 5000 }),
      field('answerAliases', 'Answer Aliases', 'list_string'),
      field('caseSensitive', 'Case Sensitive', 'boolean', { default: false }),
      field('allowSemanticMatch', 'Allow Semantic Match', 'boolean', { default: false })
    ],
    hiddenFields: ['imageAssetId', 'requiredPoints', 'minWords', 'maxWords', 'targetRegister', 'targetFunction', 'options'],
    payloadFields: ['promptTextOrAudio', 'transcript', 'acceptedAnswers', 'answerAliases', 'caseSensitive', 'allowSemanticMatch', 'responseTimeSeconds'],
    scoringDefaults: {
      method: 'hybrid_ai_audio_objective',
      scorerVersion: 'pte-answer-short-question-v1',
      maxScore: 1,
      traits: ['vocabulary'],
      minAnalysisConfidence: 0.35,
      minSemanticConfidence: 0.7
    },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'hybrid_ai_audio_objective' }),
      field('scorerVersion', 'Scorer Version', 'text', { default: 'pte-answer-short-question-v1' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 1 }),
      field('traits', 'Trait List', 'list_string', { required: true, default: ['vocabulary'] }),
      field('minAnalysisConfidence', 'Minimum Analysis Confidence', 'number', { default: 0.35, min: 0, max: 1 }),
      field('minSemanticConfidence', 'Minimum Semantic Match Confidence', 'number', { default: 0.7, min: 0, max: 1 })
    ],
    responseShape: { audioAssetId: 'string', transcript: 'string', durationSeconds: 'number', asrMeta: 'object' },
    validationRules: ['promptTextOrAudio required', 'acceptedAnswers must include at least one value', 'responseTimeSeconds > 0'],
    previewRules: ['Render short prompt with compact recording control.'],
    editorBehavior: { partial: 'speaking_answer_short_question', mediaInputs: ['promptTextOrAudio'], timingInputs: ['responseTimeSeconds'] }
  },
  writing_summarize_written_text: {
    skill: 'writing',
    label: 'Writing - Summarize Written Text',
    purpose: 'Assess concise comprehension summary writing.',
    requiredFields: [
      field('sourceText', 'Source Text', 'textarea', { required: true, max: 12000 }),
      field('minWords', 'Minimum Words', 'integer', { required: true, min: 5, max: 75, default: 5 }),
      field('maxWords', 'Maximum Words', 'integer', { required: true, min: 5, max: 75, default: 75 }),
      field('recommendedTimeMinutes', 'Recommended Time (Minutes)', 'integer', { required: true, min: 1, max: 30, default: 10 })
    ],
    optionalFields: [
      field('sourceTitle', 'Source Title', 'text', { max: 250 }),
      field('expectedSummary', 'Expected Summary', 'textarea', { max: 6000 }),
      field('expectedKeyPoints', 'Expected Key Points', 'list_string')
    ],
    hiddenFields: ['options', 'correctOptionKey', 'imageAssetId', 'targetRegister', 'promptAudioAssetId'],
    payloadFields: ['sourceTitle', 'sourceText', 'expectedSummary', 'expectedKeyPoints', 'minWords', 'maxWords', 'recommendedTimeMinutes'],
    scoringDefaults: { method: 'hybrid_ai', maxScore: 7, traits: ['content', 'form', 'grammar', 'vocabulary'] },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'hybrid_ai' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 7 }),
      field('traits', 'Trait List', 'list_string', { required: true, default: ['content', 'form', 'grammar', 'vocabulary'] })
    ],
    responseShape: { responseText: 'string', wordCount: 'number', typingMeta: 'object', autosaveDrafts: 'array' },
    validationRules: [
      'sourceText required',
      'word limits must stay within 5-75 and maxWords >= minWords',
      'recommendedTimeMinutes must be between 1-30'
    ],
    previewRules: ['Render source passage with constrained writing textarea and live word count.'],
    editorBehavior: { partial: 'writing_summarize_written_text', mediaInputs: [], timingInputs: [] }
  },
  writing_write_email: {
    skill: 'writing',
    label: 'Writing - Write Email',
    purpose: 'Assess functional email writing in contextual scenarios.',
    requiredFields: [
      field('scenarioText', 'Scenario Text', 'textarea', { required: true, max: 12000 }),
      field('recipientRole', 'Recipient Role', 'text', { required: true, max: 120 }),
      field('purpose', 'Purpose', 'text', { required: true, max: 220 }),
      field('requiredPoints', 'Required Points', 'list_string', { required: true }),
      field('minWords', 'Minimum Words', 'integer', { required: true, min: 50, max: 120, default: 50 }),
      field('maxWords', 'Maximum Words', 'integer', { required: true, min: 50, max: 120, default: 120 })
    ],
    optionalFields: [
      field('senderRole', 'Sender Role', 'text', { max: 120 }),
      field('targetRegister', 'Target Register', 'text', { max: 120 }),
      field('suggestedSubject', 'Suggested Subject', 'text', { max: 250 }),
      field('expectedTone', 'Expected Tone', 'text', { max: 120 })
    ],
    hiddenFields: ['options', 'imageAssetId', 'promptAudioAssetId', 'correctOptionKey'],
    payloadFields: ['scenarioText', 'recipientRole', 'senderRole', 'purpose', 'requiredPoints', 'targetRegister', 'suggestedSubject', 'expectedTone', 'minWords', 'maxWords'],
    scoringDefaults: { method: 'hybrid_ai', maxScore: 15, traits: ['content', 'emailConventions', 'form', 'organization', 'vocabulary', 'grammar', 'spelling'] },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'hybrid_ai' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 15 }),
      field('traits', 'Trait List', 'list_string', { required: true, default: ['content', 'emailConventions', 'form', 'organization', 'vocabulary', 'grammar', 'spelling'] })
    ],
    responseShape: { responseText: 'string', wordCount: 'number', typingMeta: 'object', autosaveDrafts: 'array' },
    validationRules: [
      'scenarioText, recipientRole, and purpose required',
      'requiredPoints should include at least three bullet points',
      'minWords and maxWords must stay within 50-120',
      'maxWords >= minWords'
    ],
    previewRules: ['Render email prompt with required points checklist and writing box.'],
    editorBehavior: { partial: 'writing_write_email', mediaInputs: [], timingInputs: [] }
  },
  writing_short_answer: {
    hiddenFromAuthoring: true,
    skill: 'writing',
    label: 'Writing - Short Answer',
    purpose: 'Assess concise textual response to focused prompts.',
    requiredFields: [
      field('promptText', 'Prompt Text', 'textarea', { required: true, max: 6000 })
    ],
    optionalFields: [
      field('expectedKeyPoints', 'Expected Key Points', 'list_string'),
      field('minWords', 'Minimum Words', 'integer', { min: 0, default: 0 }),
      field('maxWords', 'Maximum Words', 'integer', { min: 0, default: 0 }),
      field('answerGuide', 'Answer Guide', 'textarea', { max: 4000 })
    ],
    hiddenFields: ['options', 'imageAssetId', 'targetRegister', 'promptAudioAssetId'],
    payloadFields: ['promptText', 'expectedKeyPoints', 'minWords', 'maxWords', 'answerGuide'],
    scoringDefaults: { method: 'hybrid_ai', maxScore: 5, traits: ['content', 'languageControl'] },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'hybrid_ai' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 5 }),
      field('traits', 'Trait List', 'list_string', { required: true, default: ['content', 'languageControl'] })
    ],
    responseShape: { responseText: 'string', wordCount: 'number' },
    validationRules: ['promptText required', 'if maxWords is set then maxWords >= minWords'],
    previewRules: ['Render short prompt and compact writing area.'],
    editorBehavior: { partial: 'writing_short_answer', mediaInputs: [], timingInputs: [] }
  },
  writing_essay: {
    skill: 'writing',
    label: 'Writing - Essay',
    purpose: 'Assess extended argument writing and language control.',
    requiredFields: [
      field('promptText', 'Prompt Text', 'textarea', { required: true, max: 12000 }),
      field('essayType', 'Essay Type', 'text', { required: true, max: 120 }),
      field('minWords', 'Minimum Words', 'integer', { required: true, min: 1, default: 200 })
    ],
    optionalFields: [
      field('maxWords', 'Maximum Words', 'integer', { min: 0, default: 0 }),
      field('planningTimeMinutes', 'Planning Time (Minutes)', 'integer', { min: 0, default: 0 }),
      field('recommendedTimeMinutes', 'Recommended Time (Minutes)', 'integer', { min: 0, default: 0 }),
      field('expectedPositionTypes', 'Expected Position Types', 'list_string'),
      field('sourceMaterial', 'Source Material', 'textarea', { max: 8000 })
    ],
    hiddenFields: ['options', 'correctOptionKey', 'imageAssetId', 'promptAudioAssetId'],
    payloadFields: ['promptText', 'essayType', 'minWords', 'maxWords', 'planningTimeMinutes', 'recommendedTimeMinutes', 'expectedPositionTypes', 'sourceMaterial'],
    scoringDefaults: { method: 'hybrid_ai', maxScore: 10, traits: ['taskResponse', 'organization', 'vocabulary', 'grammar'] },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'hybrid_ai' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 10 }),
      field('traits', 'Trait List', 'list_string', { required: true, default: ['taskResponse', 'organization', 'vocabulary', 'grammar'] })
    ],
    responseShape: { responseText: 'string', wordCount: 'number', typingMeta: 'object', autosaveDrafts: 'array' },
    validationRules: ['promptText and essayType required', 'minWords > 0'],
    previewRules: ['Render full essay prompt with long-form writing area.'],
    editorBehavior: { partial: 'writing_essay', mediaInputs: [], timingInputs: [] }
  },
  reading_mcq_single: {
    skill: 'reading',
    label: 'Reading - MCQ Single',
    purpose: 'Assess single-choice reading comprehension accuracy.',
    requiredFields: [
      field('passageTitle', 'Reading Title', 'text', { max: 250 }),
      field('passageHtml', 'Reading Text', 'textarea', { required: true, max: 12000 }),
      field('stem', 'Question Stem', 'textarea', { required: true, max: 5000 }),
      field('options', 'Options JSON', 'json', { required: true, jsonKind: 'array', default: [] }),
      field('correctOptionKey', 'Correct Option Key', 'text', { required: true, max: 50 })
    ],
    optionalFields: [
      field('explanation', 'Explanation', 'textarea', { max: 4000 })
    ],
    hiddenFields: ['imageAssetId', 'acceptedAnswers', 'requiredPoints', 'speakingTiming'],
    payloadFields: ['passageTitle', 'passageHtml', 'stem', 'options', 'correctOptionKey', 'explanation'],
    scoringDefaults: { method: 'auto_objective', maxScore: 1, negativeMarking: false },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'auto_objective' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 1 }),
      field('negativeMarking', 'Negative Marking', 'boolean', { default: false })
    ],
    responseShape: { selectedOptionKey: 'string' },
    validationRules: ['passageHtml required', 'stem required', 'options count >= 2', 'exactly one correctOptionKey existing in options'],
    previewRules: ['Render passage and radio-option question view.'],
    editorBehavior: { partial: 'reading_mcq_single', mediaInputs: [], timingInputs: [] }
  },
  reading_mcq_multiple: {
    skill: 'reading',
    label: 'Reading - MCQ Multiple',
    purpose: 'Assess multi-select reading comprehension accuracy.',
    requiredFields: [
      field('passageTitle', 'Reading Title', 'text', { max: 250 }),
      field('passageHtml', 'Reading Text', 'textarea', { required: true, max: 12000 }),
      field('stem', 'Question Stem', 'textarea', { required: true, max: 5000 }),
      field('options', 'Options JSON', 'json', { required: true, jsonKind: 'array', default: [] }),
      field('correctOptionKeys', 'Correct Option Keys', 'list_string', { required: true })
    ],
    optionalFields: [
      field('explanation', 'Explanation', 'textarea', { max: 4000 })
    ],
    hiddenFields: ['imageAssetId', 'acceptedAnswers', 'requiredPoints', 'speakingTiming'],
    payloadFields: ['passageTitle', 'passageHtml', 'stem', 'options', 'correctOptionKeys', 'explanation'],
    scoringDefaults: { method: 'auto_objective', maxScore: 1, negativeMarking: false },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'auto_objective' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 1 }),
      field('negativeMarking', 'Negative Marking', 'boolean', { default: false })
    ],
    responseShape: { selectedOptionKeys: 'array<string>' },
    validationRules: ['passageHtml required', 'stem required', 'options count >= 2', 'at least one correct option key existing in options'],
    previewRules: ['Render passage and checkbox-option question view.'],
    editorBehavior: { partial: 'reading_mcq_multiple', mediaInputs: [], timingInputs: [] }
  },
  reading_true_false: {
    skill: 'reading',
    label: 'Reading - True/False',
    purpose: 'Assess statement verification against reading passage.',
    requiredFields: [
      field('stem', 'Statement', 'textarea', { required: true, max: 5000 }),
      field('correctValue', 'Correct Value', 'select', {
        required: true,
        default: 'true',
        options: [{ value: 'true', label: 'True' }, { value: 'false', label: 'False' }, { value: 'not_given', label: 'Not Given' }]
      })
    ],
    optionalFields: [
      field('passageTitle', 'Passage Title', 'text', { max: 250 }),
      field('passageHtml', 'Passage HTML/Text', 'textarea', { max: 12000 }),
      field('explanation', 'Explanation', 'textarea', { max: 4000 })
    ],
    hiddenFields: ['options', 'imageAssetId', 'requiredPoints', 'speakingTiming'],
    payloadFields: ['passageTitle', 'passageHtml', 'stem', 'correctValue', 'explanation'],
    scoringDefaults: { method: 'auto_objective', maxScore: 1 },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'auto_objective' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 1 })
    ],
    responseShape: { selectedValue: 'string' },
    validationRules: ['stem required', 'correctValue must be true, false, or not_given'],
    previewRules: ['Render statement with true/false/not-given selector.'],
    editorBehavior: { partial: 'reading_true_false', mediaInputs: [], timingInputs: [] }
  },
  reading_writing_fill_in_blank: {
    skill: 'reading',
    label: 'Reading & Writing - Fill In Blanks',
    purpose: 'Assess contextual grammar and vocabulary completion using per-blank drop-down options.',
    requiredFields: [
      field('sourcePassage', 'Original Passage (Untouched)', 'textarea', { required: false, max: 12000 }),
      field('passageWithBlanks', 'Passage With Blanks', 'textarea', { required: true, max: 12000 }),
      field('blankAnswerMap', 'Blank Answer Map JSON', 'json', { required: true, jsonKind: 'object', default: {} }),
      field('blankOptionsMap', 'Blank Options Map JSON', 'json', { required: true, jsonKind: 'object', default: {} })
    ],
    optionalFields: [
      field('passageTitle', 'Passage Title', 'text', { max: 180 }),
      field('caseSensitive', 'Case Sensitive', 'boolean', { default: false }),
      field('explanation', 'Explanation', 'textarea', { max: 4000 })
    ],
    hiddenFields: ['imageAssetId', 'speakingTiming', 'requiredPoints', 'bankOptions', 'allowSynonyms'],
    payloadFields: ['sourcePassage', 'passageWithBlanks', 'blankAnswerMap', 'blankOptionsMap', 'passageTitle', 'caseSensitive', 'explanation'],
    scoringDefaults: { method: 'auto_objective', maxScore: 1, perBlankScore: 1 },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'auto_objective' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 1 }),
      field('perBlankScore', 'Per Blank Score', 'number', { min: 0, default: 1 })
    ],
    responseShape: { blankResponseMap: 'object' },
    validationRules: ['At least one blank required', 'blankAnswerMap required', 'blankOptionsMap required', 'each blank must have exactly four options including the correct answer'],
    previewRules: ['Render passage with inline blanks and per-gap drop-down option sets.'],
    editorBehavior: { partial: 'reading_writing_fill_in_blank', mediaInputs: [], timingInputs: [] }
  },
  reading_fill_in_blank: {
    skill: 'reading',
    label: 'Reading - Fill In Blank',
    purpose: 'Assess contextual lexical completion in reading passages.',
    requiredFields: [
      field('sourcePassage', 'Original Passage (Untouched)', 'textarea', { required: false, max: 12000 }),
      field('passageWithBlanks', 'Passage With Blanks', 'textarea', { required: true, max: 12000 }),
      field('blankAnswerMap', 'Blank Answer Map JSON', 'json', { required: true, jsonKind: 'object', default: {} })
    ],
    optionalFields: [
      field('bankOptions', 'Word Bank Options', 'list_string'),
      field('caseSensitive', 'Case Sensitive', 'boolean', { default: false }),
      field('allowSynonyms', 'Allow Synonyms', 'boolean', { default: false }),
      field('explanation', 'Explanation', 'textarea', { max: 4000 })
    ],
    hiddenFields: ['imageAssetId', 'speakingTiming', 'requiredPoints'],
    payloadFields: ['sourcePassage', 'passageWithBlanks', 'blankAnswerMap', 'bankOptions', 'caseSensitive', 'allowSynonyms', 'explanation'],
    scoringDefaults: { method: 'auto_objective', maxScore: 1, perBlankScore: 1 },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'auto_objective' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 1 }),
      field('perBlankScore', 'Per Blank Score', 'number', { min: 0, default: 1 })
    ],
    responseShape: { blankResponseMap: 'object' },
    validationRules: ['At least one blank required', 'blankAnswerMap required', 'blank ids in passage and answer map must match'],
    previewRules: ['Render passage with inline blanks and optional word bank.'],
    editorBehavior: { partial: 'reading_fill_in_blank', mediaInputs: [], timingInputs: [] }
  },
  reading_reorder_paragraphs: {
    skill: 'reading',
    label: 'Reading - Reorder Paragraphs',
    purpose: 'Assess discourse ordering and structural understanding.',
    requiredFields: [
      field('paragraphItems', 'Paragraph Items', 'json', { required: true, jsonKind: 'array', default: [] }),
      field('correctOrder', 'Correct Order', 'list_string', { required: true })
    ],
    optionalFields: [
      field('sourcePassage', 'Full Passage (Auto Split Source)', 'textarea', { max: LONG_TRANSCRIPT_MAX_CHARS }),
      field('passageTitle', 'Passage Title', 'text', { max: 180 }),
      field('explanation', 'Explanation', 'textarea', { max: 4000 }),
      field('partialCreditEnabled', 'Partial Credit Enabled', 'boolean', { default: false })
    ],
    hiddenFields: ['imageAssetId', 'acceptedAnswers', 'requiredPoints', 'speakingTiming'],
    payloadFields: ['sourcePassage', 'passageTitle', 'paragraphItems', 'correctOrder', 'explanation'],
    scoringDefaults: { method: 'auto_objective', maxScore: 1, partialCreditEnabled: false },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'auto_objective' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 1 }),
      field('partialCreditEnabled', 'Partial Credit Enabled', 'boolean', { default: false })
    ],
    responseShape: { submittedOrder: 'array<string>' },
    validationRules: ['paragraphItems count >= 2', 'correctOrder must contain all paragraph items exactly once'],
    previewRules: ['Render draggable paragraph ordering interface.'],
    editorBehavior: { partial: 'reading_reorder_paragraphs', mediaInputs: [], timingInputs: [] }
  },
  reading_matching: {
    skill: 'reading',
    label: 'Reading - Matching',
    purpose: 'Assess pairwise relationship matching in reading tasks.',
    requiredFields: [
      field('leftItems', 'Left Items JSON', 'json', { required: true, jsonKind: 'array', default: [] }),
      field('rightItems', 'Right Items JSON', 'json', { required: true, jsonKind: 'array', default: [] }),
      field('correctPairs', 'Correct Pairs JSON', 'json', { required: true, jsonKind: 'array', default: [] })
    ],
    optionalFields: [
      field('reusableRightItems', 'Reusable Right Items', 'boolean', { default: false }),
      field('explanation', 'Explanation', 'textarea', { max: 4000 })
    ],
    hiddenFields: ['imageAssetId', 'speakingTiming', 'requiredPoints'],
    payloadFields: ['leftItems', 'rightItems', 'correctPairs', 'reusableRightItems', 'explanation'],
    scoringDefaults: { method: 'auto_objective', maxScore: 1, perPairScore: 1 },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'auto_objective' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 1 }),
      field('perPairScore', 'Per Pair Score', 'number', { min: 0, default: 1 })
    ],
    responseShape: { submittedPairs: 'array<object>' },
    validationRules: ['left/right item arrays required', 'correctPairs must reference valid ids'],
    previewRules: ['Render two-column matching table or drag lines.'],
    editorBehavior: { partial: 'reading_matching', mediaInputs: [], timingInputs: [] }
  },
  listening_summarize_spoken_text: {
    skill: 'listening',
    label: 'Listening - Summarize Spoken Text',
    purpose: 'Assess listening comprehension through short written summaries.',
    requiredFields: [
      field('promptAudioAssetId', 'Prompt Audio Asset ID', 'text', { required: true, max: 180 }),
      field('minWords', 'Minimum Words', 'integer', { required: true, min: 1, default: 50 }),
      field('maxWords', 'Maximum Words', 'integer', { required: true, min: 1, default: 70 }),
      field('recommendedTimeMinutes', 'Recommended Time (Minutes)', 'integer', { required: true, min: 1, default: 10 })
    ],
    optionalFields: [
      field('transcript', 'Transcript', 'textarea', { max: LONG_TRANSCRIPT_MAX_CHARS }),
      field('expectedSummary', 'Expected Summary', 'textarea', { max: 6000 }),
      field('expectedKeyPoints', 'Expected Key Points', 'list_string'),
      field('allowReplay', 'Allow Replay', 'boolean', { default: false }),
      field('explanation', 'Explanation', 'textarea', { max: 4000 })
    ],
    hiddenFields: ['imageAssetId', 'optionBuilder', 'requiredPoints', 'speakingTiming'],
    payloadFields: ['promptAudioAssetId', 'transcript', 'expectedSummary', 'expectedKeyPoints', 'minWords', 'maxWords', 'recommendedTimeMinutes', 'allowReplay', 'explanation'],
    scoringDefaults: { method: 'hybrid_ai', maxScore: 5, traits: ['content', 'form', 'grammar', 'vocabulary'] },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'hybrid_ai' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 5 }),
      field('traits', 'Trait List', 'list_string', { required: true, default: ['content', 'form', 'grammar', 'vocabulary'] })
    ],
    responseShape: { responseText: 'string' },
    validationRules: ['promptAudioAssetId required', 'minWords > 0', 'maxWords >= minWords', 'recommendedTimeMinutes > 0'],
    previewRules: ['Render listening audio and summary response textarea.'],
    editorBehavior: { partial: 'listening_summarize_spoken_text', mediaInputs: ['promptAudioAssetId'], timingInputs: ['recommendedTimeMinutes'] }
  },
  listening_mcq_single: {
    skill: 'listening',
    label: 'Listening - MCQ Single',
    purpose: 'Assess single-choice listening comprehension.',
    requiredFields: [
      field('promptAudioAssetId', 'Prompt Audio Asset ID', 'text', { required: true, max: 180 }),
      field('stem', 'Question Stem', 'textarea', { required: true, max: 5000 }),
      field('options', 'Options JSON', 'json', { required: true, jsonKind: 'array', default: [] }),
      field('correctOptionKey', 'Correct Option Key', 'text', { required: true, max: 50 })
    ],
    optionalFields: [
      field('transcript', 'Transcript', 'textarea', { max: LONG_TRANSCRIPT_MAX_CHARS }),
      field('explanation', 'Explanation', 'textarea', { max: 4000 }),
      field('allowReplay', 'Allow Replay', 'boolean', { default: false })
    ],
    hiddenFields: ['imageAssetId', 'requiredPoints', 'writingWordLimits', 'speakingTiming'],
    payloadFields: ['promptAudioAssetId', 'transcript', 'stem', 'options', 'correctOptionKey', 'allowReplay', 'explanation'],
    scoringDefaults: { method: 'auto_objective', maxScore: 1 },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'auto_objective' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 1 })
    ],
    responseShape: { selectedOptionKey: 'string' },
    validationRules: ['promptAudioAssetId required', 'stem required', 'options count >= 2', 'correctOptionKey required'],
    previewRules: ['Render audio player with single-choice options.'],
    editorBehavior: { partial: 'listening_mcq_single', mediaInputs: ['promptAudioAssetId'], timingInputs: [] }
  },
  listening_mcq_multiple: {
    skill: 'listening',
    label: 'Listening - MCQ Multiple',
    purpose: 'Assess multi-select listening comprehension.',
    requiredFields: [
      field('promptAudioAssetId', 'Prompt Audio Asset ID', 'text', { required: true, max: 180 }),
      field('stem', 'Question Stem', 'textarea', { required: true, max: 5000 }),
      field('options', 'Options JSON', 'json', { required: true, jsonKind: 'array', default: [] }),
      field('correctOptionKeys', 'Correct Option Keys', 'list_string', { required: true })
    ],
    optionalFields: [
      field('transcript', 'Transcript', 'textarea', { max: LONG_TRANSCRIPT_MAX_CHARS }),
      field('partialCreditEnabled', 'Partial Credit Enabled', 'boolean', { default: false }),
      field('allowReplay', 'Allow Replay', 'boolean', { default: false }),
      field('explanation', 'Explanation', 'textarea', { max: 4000 })
    ],
    hiddenFields: ['imageAssetId', 'writingWordLimits', 'speakingRecordFields'],
    payloadFields: ['promptAudioAssetId', 'transcript', 'stem', 'options', 'correctOptionKeys', 'partialCreditEnabled', 'allowReplay', 'explanation'],
    scoringDefaults: { method: 'auto_objective', maxScore: 1, partialCreditEnabled: false },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'auto_objective' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 1 }),
      field('partialCreditEnabled', 'Partial Credit Enabled', 'boolean', { default: false })
    ],
    responseShape: { selectedOptionKeys: 'array<string>' },
    validationRules: ['promptAudioAssetId required', 'at least one correct option key required'],
    previewRules: ['Render audio player with multi-choice options.'],
    editorBehavior: { partial: 'listening_mcq_multiple', mediaInputs: ['promptAudioAssetId'], timingInputs: [] }
  },
  listening_fill_in_blank: {
    skill: 'listening',
    label: 'Listening - Fill In Blank',
    purpose: 'Assess listening transcription completion accuracy.',
    requiredFields: [
      field('promptAudioAssetId', 'Prompt Audio Asset ID', 'text', { required: true, max: 180 }),
      field('transcriptWithBlanks', 'Transcript With Blanks', 'textarea', { required: true, max: LONG_TRANSCRIPT_MAX_CHARS }),
      field('blankAnswerMap', 'Blank Answer Map JSON', 'json', { required: true, jsonKind: 'object', default: {} })
    ],
    optionalFields: [
      field('allowReplay', 'Allow Replay', 'boolean', { default: false }),
      field('caseSensitive', 'Case Sensitive', 'boolean', { default: false }),
      field('explanation', 'Explanation', 'textarea', { max: 4000 })
    ],
    hiddenFields: ['imageAssetId', 'optionBuilder', 'requiredPoints', 'speakingResponseFields'],
    payloadFields: ['promptAudioAssetId', 'transcriptWithBlanks', 'blankAnswerMap', 'allowReplay', 'caseSensitive', 'explanation'],
    scoringDefaults: { method: 'auto_objective', maxScore: 1, perBlankScore: 1 },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'auto_objective' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 1 }),
      field('perBlankScore', 'Per Blank Score', 'number', { min: 0, default: 1 })
    ],
    responseShape: { blankResponseMap: 'object' },
    validationRules: ['promptAudioAssetId required', 'at least one blank required', 'blankAnswerMap must match blanks'],
    previewRules: ['Render audio player plus transcript blank completion UI.'],
    editorBehavior: { partial: 'listening_fill_in_blank', mediaInputs: ['promptAudioAssetId'], timingInputs: [] }
  },
  listening_select_missing_word: {
    skill: 'listening',
    label: 'Listening - Select Missing Word',
    purpose: 'Assess selection of the missing ending word/phrase from options.',
    requiredFields: [
      field('promptAudioAssetId', 'Prompt Audio Asset ID', 'text', { required: true, max: 180 }),
      field('transcriptWithGap', 'Transcript With Gap', 'textarea', { required: true, max: LONG_TRANSCRIPT_MAX_CHARS }),
      field('options', 'Options JSON', 'json', { required: true, jsonKind: 'array', default: [] }),
      field('correctOptionKey', 'Correct Option Key', 'text', { required: true, max: 50 })
    ],
    optionalFields: [
      field('transcript', 'Transcript', 'textarea', { max: LONG_TRANSCRIPT_MAX_CHARS }),
      field('allowReplay', 'Allow Replay', 'boolean', { default: false }),
      field('explanation', 'Explanation', 'textarea', { max: 4000 })
    ],
    hiddenFields: ['imageAssetId', 'requiredPoints', 'writingWordLimits', 'speakingTiming'],
    payloadFields: ['promptAudioAssetId', 'transcriptWithGap', 'options', 'correctOptionKey', 'transcript', 'allowReplay', 'explanation'],
    scoringDefaults: { method: 'auto_objective', maxScore: 1 },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'auto_objective' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 1 })
    ],
    responseShape: { selectedOptionKey: 'string' },
    validationRules: ['promptAudioAssetId required', 'transcriptWithGap required', 'options count >= 2', 'correctOptionKey required'],
    previewRules: ['Render listening audio with single-choice options.'],
    editorBehavior: { partial: 'listening_select_missing_word', mediaInputs: ['promptAudioAssetId'], timingInputs: [] }
  },
  listening_highlight_incorrect_words: {
    skill: 'listening',
    label: 'Listening - Highlight Incorrect Words',
    purpose: 'Assess recognition of words that differ from the audio.',
    requiredFields: [
      field('promptAudioAssetId', 'Prompt Audio Asset ID', 'text', { required: true, max: 180 }),
      field('transcript', 'Source Transcript (Audio-Accurate)', 'textarea', { required: true, max: LONG_TRANSCRIPT_MAX_CHARS }),
      field('transcriptText', 'Transcript Text', 'textarea', { required: true, max: LONG_TRANSCRIPT_MAX_CHARS }),
      field('incorrectWords', 'Incorrect Words', 'list_string', { required: true, maxItem: 200 })
    ],
    optionalFields: [
      field('allowReplay', 'Allow Replay', 'boolean', { default: false }),
      field('explanation', 'Explanation', 'textarea', { max: 4000 })
    ],
    hiddenFields: ['imageAssetId', 'optionBuilder', 'requiredPoints', 'speakingTiming'],
    payloadFields: ['promptAudioAssetId', 'transcript', 'transcriptText', 'incorrectWords', 'allowReplay', 'explanation'],
    scoringDefaults: { method: 'auto_objective', maxScore: 1, perWordScore: 1 },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'auto_objective' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 1 }),
      field('perWordScore', 'Per Word Score', 'number', { min: 0, default: 1 })
    ],
    responseShape: { selectedWords: 'array<string>' },
    validationRules: [
      'promptAudioAssetId required',
      'transcript required',
      'transcriptText required',
      'transcriptText must differ from transcript',
      'incorrectWords required'
    ],
    previewRules: ['Render listening audio with highlight-incorrect-words transcript panel.'],
    editorBehavior: { partial: 'listening_highlight_incorrect_words', mediaInputs: ['promptAudioAssetId'], timingInputs: [] }
  },
  listening_dictation: {
    skill: 'listening',
    label: 'Listening - Dictation',
    purpose: 'Assess exact listening transcription and normalization.',
    requiredFields: [
      field('promptAudioAssetId', 'Prompt Audio Asset ID', 'text', { required: true, max: 180 }),
      field('expectedTranscript', 'Expected Transcript', 'textarea', { required: true, max: LONG_TRANSCRIPT_MAX_CHARS })
    ],
    optionalFields: [
      field('transcriptVariants', 'Transcript Variants', 'list_string', { maxItem: 500 }),
      field('allowReplay', 'Allow Replay', 'boolean', { default: false }),
      field('normalizationRules', 'Normalization Rules JSON', 'json', { jsonKind: 'object', default: DICTATION_NORMALIZATION_RULE_DEFAULTS })
    ],
    hiddenFields: ['optionBuilder', 'imageAssetId', 'requiredPoints', 'writingFields'],
    payloadFields: ['promptAudioAssetId', 'expectedTranscript', 'transcriptVariants', 'allowReplay', 'normalizationRules'],
    scoringDefaults: {
      method: 'auto_objective',
      maxScore: 1,
      perWordScore: 1,
      normalizationRules: DICTATION_NORMALIZATION_RULE_DEFAULTS
    },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'auto_objective' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 1 }),
      field('perWordScore', 'Per Word Score', 'number', { min: 0, default: 1 }),
      field('normalizationRules', 'Normalization Rules JSON', 'json', { jsonKind: 'object', default: DICTATION_NORMALIZATION_RULE_DEFAULTS })
    ],
    responseShape: { responseText: 'string' },
    validationRules: ['promptAudioAssetId required', 'expectedTranscript required'],
    previewRules: ['Render dictation player with single transcript response field.'],
    editorBehavior: { partial: 'listening_dictation', mediaInputs: ['promptAudioAssetId'], timingInputs: [] }
  },
  listening_matching: {
    skill: 'listening',
    label: 'Listening - Matching',
    hiddenFromAuthoring: true,
    purpose: 'Assess matching relationships based on audio content.',
    requiredFields: [
      field('promptAudioAssetId', 'Prompt Audio Asset ID', 'text', { required: true, max: 180 }),
      field('leftItems', 'Left Items JSON', 'json', { required: true, jsonKind: 'array', default: [] }),
      field('rightItems', 'Right Items JSON', 'json', { required: true, jsonKind: 'array', default: [] }),
      field('correctPairs', 'Correct Pairs JSON', 'json', { required: true, jsonKind: 'array', default: [] })
    ],
    optionalFields: [
      field('transcript', 'Transcript', 'textarea', { max: LONG_TRANSCRIPT_MAX_CHARS }),
      field('allowReplay', 'Allow Replay', 'boolean', { default: false }),
      field('reusableRightItems', 'Reusable Right Items', 'boolean', { default: false }),
      field('explanation', 'Explanation', 'textarea', { max: 4000 })
    ],
    hiddenFields: ['imageAssetId', 'writingWordLimits', 'speakingResponseFields'],
    payloadFields: ['promptAudioAssetId', 'transcript', 'leftItems', 'rightItems', 'correctPairs', 'reusableRightItems', 'allowReplay', 'explanation'],
    scoringDefaults: { method: 'auto_objective', maxScore: 1, perPairScore: 1 },
    scoringFields: [
      field('method', 'Scoring Method', 'text', { required: true, default: 'auto_objective' }),
      field('maxScore', 'Max Score', 'number', { required: true, min: 0.000001, default: 1 }),
      field('perPairScore', 'Per Pair Score', 'number', { min: 0, default: 1 })
    ],
    responseShape: { submittedPairs: 'array<object>' },
    validationRules: ['promptAudioAssetId required', 'left/right items required', 'correctPairs required'],
    previewRules: ['Render audio player with matching interaction grid.'],
    editorBehavior: { partial: 'listening_matching', mediaInputs: ['promptAudioAssetId'], timingInputs: [] }
  }
});

const QUESTION_TYPE_KEYS = Object.freeze(Object.keys(TYPE_REGISTRY));
const AUTHORING_QUESTION_TYPE_KEYS = Object.freeze(
  QUESTION_TYPE_KEYS.filter((key) => TYPE_REGISTRY[key]?.hiddenFromAuthoring !== true)
);

function assertQuestionTypeTestTypeMappingCoverage() {
  const mapKeys = Object.keys(QUESTION_TYPE_TEST_TYPE_MAP);
  const missing = QUESTION_TYPE_KEYS.filter((key) => !Object.prototype.hasOwnProperty.call(QUESTION_TYPE_TEST_TYPE_MAP, key));
  const extras = mapKeys.filter((key) => !QUESTION_TYPE_KEYS.includes(key));
  if (missing.length || extras.length) {
    const bits = [];
    if (missing.length) bits.push(`missing: ${missing.join(', ')}`);
    if (extras.length) bits.push(`extra: ${extras.join(', ')}`);
    throw new Error(`QUESTION_TYPE_TEST_TYPE_MAP coverage mismatch (${bits.join(' | ')})`);
  }

  mapKeys.forEach((key) => {
    const rows = QUESTION_TYPE_TEST_TYPE_MAP[key];
    if (!Array.isArray(rows) || !rows.length) {
      throw new Error(`QUESTION_TYPE_TEST_TYPE_MAP['${key}'] must include at least one test type.`);
    }
    rows.forEach((value) => {
      if (!VALID_TEST_TYPES.includes(String(value || '').trim().toLowerCase())) {
        throw new Error(`QUESTION_TYPE_TEST_TYPE_MAP['${key}'] contains unsupported test type '${value}'.`);
      }
    });
  });
}

assertQuestionTypeTestTypeMappingCoverage();

function normalizePayloadForType(typeKey, payloadInput = {}) {
  const def = TYPE_REGISTRY[typeKey];
  if (!def) throw new Error(`Unsupported question type '${typeKey}'.`);
  const source = isPlainObject(payloadInput) ? { ...payloadInput } : {};
  if (typeKey === 'reading_fill_in_blank' || typeKey === 'reading_writing_fill_in_blank') {
    const sourcePassage = cleanString(source.sourcePassage, { max: LONG_TRANSCRIPT_MAX_CHARS, allowEmpty: true });
    const editedPassage = cleanString(source.passageWithBlanks, { max: LONG_TRANSCRIPT_MAX_CHARS, allowEmpty: true });
    if (sourcePassage && !editedPassage) {
      source.passageWithBlanks = sourcePassage;
    } else if (!sourcePassage && editedPassage) {
      source.sourcePassage = editedPassage;
    }
  }
  if (
    typeKey === 'listening_highlight_incorrect_words'
    && !cleanString(source.transcript, { max: LONG_TRANSCRIPT_MAX_CHARS, allowEmpty: true })
    && cleanString(source.sourceTranscript, { max: LONG_TRANSCRIPT_MAX_CHARS, allowEmpty: true })
  ) {
    source.transcript = source.sourceTranscript;
  }
  const out = {};
  const fields = [...def.requiredFields, ...def.optionalFields];
  fields.forEach((row) => {
    out[row.key] = normalizeFieldValue(row, source[row.key]);
  });
  if (typeKey === 'reading_reorder_paragraphs') {
    const sourcePassage = cleanString(source.sourcePassage, { max: LONG_TRANSCRIPT_MAX_CHARS, allowEmpty: true });
    const paragraphItems = Array.isArray(out.paragraphItems)
      ? out.paragraphItems.map((row) => cleanString(row, { max: LONG_TRANSCRIPT_MAX_CHARS, allowEmpty: true })).filter(Boolean)
      : [];
    const effectiveParagraphItems = paragraphItems.length >= 2
      ? paragraphItems
      : (sourcePassage ? splitReorderPassageIntoParagraphItems(sourcePassage) : paragraphItems);
    const correctOrder = Array.isArray(out.correctOrder)
      ? out.correctOrder.map((row) => cleanString(row, { max: LONG_TRANSCRIPT_MAX_CHARS, allowEmpty: true })).filter(Boolean)
      : [];
    out.sourcePassage = sourcePassage || '';
    out.paragraphItems = effectiveParagraphItems;
    out.correctOrder = correctOrder.length ? correctOrder : effectiveParagraphItems.slice();
  }
  if (typeKey === 'reading_writing_fill_in_blank') {
    const answerMap = isPlainObject(out.blankAnswerMap) ? out.blankAnswerMap : {};
    const optionsMap = isPlainObject(out.blankOptionsMap) ? out.blankOptionsMap : {};
    const normalizedAnswerMap = {};
    Object.entries(answerMap).forEach(([rawKey, rawValue]) => {
      const key = cleanString(rawKey, { max: 120, allowEmpty: true });
      const value = cleanString(rawValue, { max: 300, allowEmpty: true });
      if (!key || !value) return;
      normalizedAnswerMap[key] = value;
    });
    const normalizedOptionsMap = {};
    Object.entries(optionsMap).forEach(([rawKey, rawValue]) => {
      const key = cleanString(rawKey, { max: 120, allowEmpty: true });
      if (!key) return;
      const sourceRows = Array.isArray(rawValue)
        ? rawValue
        : String(rawValue == null ? '' : rawValue).split(/[\r\n,]+/g);
      normalizedOptionsMap[key] = sourceRows
        .map((row) => cleanString(row, { max: 300, allowEmpty: true }))
        .filter(Boolean);
    });
    out.blankAnswerMap = normalizedAnswerMap;
    out.blankOptionsMap = normalizedOptionsMap;
  }
  return out;
}

function normalizeScoringForType(typeKey, scoringInput = {}) {
  const def = TYPE_REGISTRY[typeKey];
  if (!def) throw new Error(`Unsupported question type '${typeKey}'.`);
  const source = isPlainObject(scoringInput) ? scoringInput : {};
  const out = {};
  def.scoringFields.forEach((row) => {
    const fallback = isPlainObject(def.scoringDefaults) ? def.scoringDefaults[row.key] : row.default;
    out[row.key] = normalizeFieldValue({ ...row, default: fallback }, source[row.key]);
  });
  const derivedMaxScore = deriveCompositeSpeakingMaxScore(typeKey, out);
  if (Number.isFinite(derivedMaxScore) && derivedMaxScore > 0) {
    out.maxScore = Number(derivedMaxScore.toFixed(6));
  }
  return out;
}

function deriveCompositeSpeakingMaxScore(typeKey, scoring = {}) {
  const componentKeysByType = {
    speaking_repeat_sentence: ['contentMax', 'pronunciationMax', 'fluencyMax'],
    speaking_describe_image: ['contentMax', 'pronunciationMax', 'fluencyMax'],
    speaking_respond_to_situation: ['appropriacyMax', 'pronunciationMax', 'fluencyMax']
  };
  const componentKeys = componentKeysByType[typeKey];
  if (!componentKeys) return null;
  const values = componentKeys.map((key) => Number(scoring[key]));
  if (!values.every((value) => Number.isFinite(value))) return null;
  return values.reduce((total, value) => total + value, 0);
}

function validateOptionsForMcq(options) {
  if (!Array.isArray(options) || options.length < 2) return false;
  return options.every((item) => isPlainObject(item) && cleanString(item.key, { max: 80, allowEmpty: true }) && cleanString(item.text, { max: 5000, allowEmpty: true }));
}

function tokenizeComparableWords(text = '') {
  const source = String(text || '');
  const regex = /[A-Za-z0-9]+(?:[-'’][A-Za-z0-9]+)*/g;
  const out = [];
  let match = null;
  while ((match = regex.exec(source)) !== null) {
    const raw = String(match[0] || '').trim();
    if (!raw) continue;
    out.push({
      raw,
      norm: raw.toLowerCase()
    });
  }
  return out;
}

function splitReorderPassageIntoParagraphItems(text = '') {
  const source = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!source) return [];

  const fromBlankLines = source
    .split(/\n\s*\n+/)
    .map((row) => cleanString(row, { max: LONG_TRANSCRIPT_MAX_CHARS, allowEmpty: true }))
    .filter(Boolean);
  if (fromBlankLines.length >= 2) return fromBlankLines;

  const fromLines = source
    .split(/\n+/)
    .map((row) => cleanString(row, { max: LONG_TRANSCRIPT_MAX_CHARS, allowEmpty: true }))
    .filter(Boolean);
  if (fromLines.length >= 2) return fromLines;

  const sentences = source
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/)
    .map((row) => cleanString(row, { max: LONG_TRANSCRIPT_MAX_CHARS, allowEmpty: true }))
    .filter(Boolean);
  if (sentences.length <= 1) return [source];

  const totalWords = sentences.reduce((acc, row) => acc + row.split(/\s+/).filter(Boolean).length, 0);
  const desiredParagraphCount = Math.max(2, Math.min(6, Math.round(totalWords / 80)));
  const groupSize = Math.max(1, Math.ceil(sentences.length / desiredParagraphCount));
  const grouped = [];
  for (let i = 0; i < sentences.length; i += groupSize) {
    const chunk = sentences.slice(i, i + groupSize).join(' ').trim();
    if (chunk) grouped.push(chunk);
  }
  return grouped.length ? grouped : [source];
}

function extractChangedWordsFromTranscripts(sourceTranscript = '', displayTranscript = '') {
  const sourceWords = tokenizeComparableWords(sourceTranscript);
  const displayWords = tokenizeComparableWords(displayTranscript);
  const changed = [];
  const seen = new Set();

  if (!sourceWords.length || !displayWords.length) return changed;

  let i = 0;
  let j = 0;
  while (i < sourceWords.length || j < displayWords.length) {
    const sourceWord = sourceWords[i] || null;
    const displayWord = displayWords[j] || null;
    if (!sourceWord && !displayWord) break;

    if (sourceWord && displayWord && sourceWord.norm === displayWord.norm) {
      i += 1;
      j += 1;
      continue;
    }

    // Source-only token (deletion in display): skip source and keep alignment.
    const nextSource = sourceWords[i + 1] || null;
    if (sourceWord && displayWord && nextSource && nextSource.norm === displayWord.norm) {
      i += 1;
      continue;
    }

    // Display-only token (insertion in display): treat inserted token as incorrect.
    const nextDisplay = displayWords[j + 1] || null;
    if (sourceWord && displayWord && nextDisplay && sourceWord.norm === nextDisplay.norm) {
      if (!seen.has(displayWord.norm)) {
        changed.push(displayWord.raw);
        seen.add(displayWord.norm);
      }
      j += 1;
      continue;
    }

    if (displayWord && !seen.has(displayWord.norm)) {
      changed.push(displayWord.raw);
      seen.add(displayWord.norm);
    }
    if (sourceWord) i += 1;
    if (displayWord) j += 1;
  }

  return changed;
}

function collectValidationErrorsForType(typeKey, payload, scoring) {
  const def = TYPE_REGISTRY[typeKey];
  if (!def) return [`Unsupported question type '${typeKey}'.`];

  const errors = [];
  [...def.requiredFields, ...def.optionalFields].forEach((row) => {
    if (isMissingRequiredValue(row, payload[row.key])) {
      errors.push(`${row.label} is required.`);
    }
  });

  def.scoringFields.forEach((row) => {
    if (isMissingRequiredValue(row, scoring[row.key])) {
      errors.push(`Scoring field '${row.label}' is required.`);
    }
  });

  if (Number(scoring.maxScore || 0) <= 0) {
    errors.push('Scoring maxScore must be greater than 0.');
  }

  if (typeKey === 'speaking_read_aloud') {
    const traitTokens = Array.isArray(scoring.traits)
      ? scoring.traits.map((row) => cleanString(row, { max: 120, allowEmpty: true }).toLowerCase()).filter(Boolean)
      : [];
    const traitSet = new Set(traitTokens);
    ['content', 'pronunciation', 'fluency'].forEach((trait) => {
      if (!traitSet.has(trait)) errors.push(`Scoring traits are missing: ${trait}.`);
    });
    if (String(scoring.scorerVersion || '').trim() !== 'pte-read-aloud-v1') {
      errors.push('scorerVersion must be pte-read-aloud-v1.');
    }
    if (!['dynamic_source_word_count_plus_traits', 'fixed'].includes(String(scoring.maxScoreMode || '').trim())) {
      errors.push('maxScoreMode contains an unsupported value.');
    }
    if (String(scoring.contentScoringMode || '').trim() !== 'word_alignment_errors') {
      errors.push('contentScoringMode must be word_alignment_errors.');
    }
    const pronunciationMax = Number(scoring.pronunciationMax);
    const fluencyMax = Number(scoring.fluencyMax);
    if (!Number.isFinite(pronunciationMax) || pronunciationMax <= 0 || pronunciationMax > 5) {
      errors.push('pronunciationMax must be greater than 0 and no more than 5.');
    }
    if (!Number.isFinite(fluencyMax) || fluencyMax <= 0 || fluencyMax > 5) {
      errors.push('fluencyMax must be greater than 0 and no more than 5.');
    }
    const idealWpmMin = Number.parseInt(String(scoring.idealWpmMin), 10);
    const idealWpmMax = Number.parseInt(String(scoring.idealWpmMax), 10);
    if (!Number.isFinite(idealWpmMin) || Number.isNaN(idealWpmMin) || idealWpmMin < 40) {
      errors.push('idealWpmMin must be an integer greater than or equal to 40.');
    }
    if (!Number.isFinite(idealWpmMax) || Number.isNaN(idealWpmMax) || idealWpmMax > 260) {
      errors.push('idealWpmMax must be an integer less than or equal to 260.');
    }
    if (Number.isFinite(idealWpmMin) && Number.isFinite(idealWpmMax) && idealWpmMax < idealWpmMin) {
      errors.push('idealWpmMax must be greater than or equal to idealWpmMin.');
    }
    const longPauseSeconds = Number(scoring.longPauseSeconds);
    if (!Number.isFinite(longPauseSeconds) || longPauseSeconds < 0.5 || longPauseSeconds > 10) {
      errors.push('longPauseSeconds must be between 0.5 and 10.');
    }
    const minAnalysisConfidence = Number(scoring.minAnalysisConfidence);
    if (!Number.isFinite(minAnalysisConfidence) || minAnalysisConfidence < 0 || minAnalysisConfidence > 1) {
      errors.push('minAnalysisConfidence must be between 0 and 1.');
    }
  }

  if (typeKey === 'speaking_repeat_sentence') {
    const traitTokens = Array.isArray(scoring.traits)
      ? scoring.traits.map((row) => cleanString(row, { max: 120, allowEmpty: true }).toLowerCase()).filter(Boolean)
      : [];
    const traitSet = new Set(traitTokens);
    ['content', 'pronunciation', 'fluency'].forEach((trait) => {
      if (!traitSet.has(trait)) errors.push(`Scoring traits are missing: ${trait}.`);
    });
    if (String(scoring.scorerVersion || '').trim() !== 'pte-repeat-sentence-v1') {
      errors.push('scorerVersion must be pte-repeat-sentence-v1.');
    }
    if (!['fixed_content_3_plus_traits', 'fixed'].includes(String(scoring.maxScoreMode || '').trim())) {
      errors.push('maxScoreMode contains an unsupported value.');
    }
    if (String(scoring.contentScoringMode || '').trim() !== 'ordered_prompt_word_coverage') {
      errors.push('contentScoringMode must be ordered_prompt_word_coverage.');
    }
    const contentMax = Number(scoring.contentMax);
    const pronunciationMax = Number(scoring.pronunciationMax);
    const fluencyMax = Number(scoring.fluencyMax);
    if (!Number.isFinite(contentMax) || contentMax <= 0 || contentMax > 3) {
      errors.push('contentMax must be greater than 0 and no more than 3.');
    }
    if (!Number.isFinite(pronunciationMax) || pronunciationMax <= 0 || pronunciationMax > 5) {
      errors.push('pronunciationMax must be greater than 0 and no more than 5.');
    }
    if (!Number.isFinite(fluencyMax) || fluencyMax <= 0 || fluencyMax > 5) {
      errors.push('fluencyMax must be greater than 0 and no more than 5.');
    }
    if (
      Number.isFinite(contentMax)
      && Number.isFinite(pronunciationMax)
      && Number.isFinite(fluencyMax)
      && Number.isFinite(Number(scoring.maxScore))
      && Math.abs(Number(scoring.maxScore) - (contentMax + pronunciationMax + fluencyMax)) > 0.01
    ) {
      errors.push('maxScore must equal contentMax + pronunciationMax + fluencyMax.');
    }
    const idealWpmMin = Number.parseInt(String(scoring.idealWpmMin), 10);
    const idealWpmMax = Number.parseInt(String(scoring.idealWpmMax), 10);
    if (!Number.isFinite(idealWpmMin) || Number.isNaN(idealWpmMin) || idealWpmMin < 40) {
      errors.push('idealWpmMin must be an integer greater than or equal to 40.');
    }
    if (!Number.isFinite(idealWpmMax) || Number.isNaN(idealWpmMax) || idealWpmMax > 260) {
      errors.push('idealWpmMax must be an integer less than or equal to 260.');
    }
    if (Number.isFinite(idealWpmMin) && Number.isFinite(idealWpmMax) && idealWpmMax < idealWpmMin) {
      errors.push('idealWpmMax must be greater than or equal to idealWpmMin.');
    }
    const longPauseSeconds = Number(scoring.longPauseSeconds);
    if (!Number.isFinite(longPauseSeconds) || longPauseSeconds < 0.5 || longPauseSeconds > 10) {
      errors.push('longPauseSeconds must be between 0.5 and 10.');
    }
    const minAnalysisConfidence = Number(scoring.minAnalysisConfidence);
    if (!Number.isFinite(minAnalysisConfidence) || minAnalysisConfidence < 0 || minAnalysisConfidence > 1) {
      errors.push('minAnalysisConfidence must be between 0 and 1.');
    }
  }

  if (typeKey === 'speaking_respond_to_situation') {
    if (String(scoring.scorerVersion || '').trim() !== 'pte-respond-to-situation-v1') {
      errors.push('scorerVersion must be pte-respond-to-situation-v1.');
    }
    if (!['fixed_appropriacy_3_plus_traits', 'fixed'].includes(String(scoring.maxScoreMode || '').trim())) {
      errors.push('maxScoreMode contains an unsupported value.');
    }
    const appropriacyMax = Number(scoring.appropriacyMax);
    const pronunciationMax = Number(scoring.pronunciationMax);
    const fluencyMax = Number(scoring.fluencyMax);
    if (!Number.isFinite(appropriacyMax) || appropriacyMax <= 0 || appropriacyMax > 3) {
      errors.push('appropriacyMax must be greater than 0 and no more than 3.');
    }
    if (!Number.isFinite(pronunciationMax) || pronunciationMax <= 0 || pronunciationMax > 5) {
      errors.push('pronunciationMax must be greater than 0 and no more than 5.');
    }
    if (!Number.isFinite(fluencyMax) || fluencyMax <= 0 || fluencyMax > 5) {
      errors.push('fluencyMax must be greater than 0 and no more than 5.');
    }
    if (
      Number.isFinite(appropriacyMax)
      && Number.isFinite(pronunciationMax)
      && Number.isFinite(fluencyMax)
      && Number.isFinite(Number(scoring.maxScore))
      && Math.abs(Number(scoring.maxScore) - (appropriacyMax + pronunciationMax + fluencyMax)) > 0.01
    ) {
      errors.push('maxScore must equal appropriacyMax + pronunciationMax + fluencyMax.');
    }
    const longPauseSeconds = Number(scoring.longPauseSeconds);
    if (!Number.isFinite(longPauseSeconds) || longPauseSeconds < 0.5 || longPauseSeconds > 10) {
      errors.push('longPauseSeconds must be between 0.5 and 10.');
    }
    const minAnalysisConfidence = Number(scoring.minAnalysisConfidence);
    if (!Number.isFinite(minAnalysisConfidence) || minAnalysisConfidence < 0 || minAnalysisConfidence > 1) {
      errors.push('minAnalysisConfidence must be between 0 and 1.');
    }
  }

  const scoringTraitKeys = Array.isArray(SPEAKING_SCORING_TRAIT_KEYS[typeKey])
    ? SPEAKING_SCORING_TRAIT_KEYS[typeKey]
    : [];
  if (scoringTraitKeys.length) {
    const traitTokens = Array.isArray(scoring.traits)
      ? scoring.traits.map((row) => cleanString(row, { max: 120, allowEmpty: true }).toLowerCase()).filter(Boolean)
      : [];
    if (!traitTokens.length) {
      errors.push('Scoring traits must include the required speaking traits.');
    } else {
      const traitSet = new Set(traitTokens);
      const missingTraits = scoringTraitKeys.filter((row) => !traitSet.has(row));
      if (missingTraits.length) {
        errors.push(`Scoring traits are missing: ${missingTraits.join(', ')}.`);
      }
    }

    const weights = isPlainObject(scoring.traitWeights) ? scoring.traitWeights : null;
    if (!weights) {
      errors.push('traitWeights must be a JSON object.');
    } else {
      const weightKeys = Object.keys(weights)
        .map((row) => cleanString(row, { max: 120, allowEmpty: true }).toLowerCase())
        .filter(Boolean);
      const expectedSet = new Set(scoringTraitKeys);
      const extras = weightKeys.filter((row) => !expectedSet.has(row));
      const missing = scoringTraitKeys.filter((row) => !weightKeys.includes(row));
      if (extras.length) errors.push(`traitWeights contains unsupported keys: ${extras.join(', ')}.`);
      if (missing.length) errors.push(`traitWeights is missing keys: ${missing.join(', ')}.`);

      let totalWeight = 0;
      scoringTraitKeys.forEach((key) => {
        const weightValue = Number(weights[key]);
        if (!Number.isFinite(weightValue)) {
          errors.push(`traitWeights.${key} must be numeric.`);
          return;
        }
        if (weightValue < 0 || weightValue > 1) {
          errors.push(`traitWeights.${key} must be between 0 and 1.`);
          return;
        }
        totalWeight += weightValue;
      });
      if (Math.abs(totalWeight - 1) > 0.01) {
        errors.push('traitWeights values must sum to 1 (±0.01).');
      }
    }

    const contentCoverageMin = Number(scoring.contentCoverageMin);
    if (!Number.isFinite(contentCoverageMin) || contentCoverageMin < 0 || contentCoverageMin > 1) {
      errors.push('contentCoverageMin must be between 0 and 1.');
    }

    const minResponseSeconds = Number.parseInt(String(scoring.minResponseSeconds), 10);
    if (!Number.isFinite(minResponseSeconds) || Number.isNaN(minResponseSeconds) || minResponseSeconds < 1) {
      errors.push('minResponseSeconds must be an integer greater than or equal to 1.');
    }

    const idealWpmMin = Number.parseInt(String(scoring.idealWpmMin), 10);
    const idealWpmMax = Number.parseInt(String(scoring.idealWpmMax), 10);
    if (!Number.isFinite(idealWpmMin) || Number.isNaN(idealWpmMin) || idealWpmMin < 40) {
      errors.push('idealWpmMin must be an integer greater than or equal to 40.');
    }
    if (!Number.isFinite(idealWpmMax) || Number.isNaN(idealWpmMax) || idealWpmMax > 260) {
      errors.push('idealWpmMax must be an integer less than or equal to 260.');
    }
    if (Number.isFinite(idealWpmMin) && Number.isFinite(idealWpmMax) && idealWpmMax < idealWpmMin) {
      errors.push('idealWpmMax must be greater than or equal to idealWpmMin.');
    }

    const offTopicPenalty = Number(scoring.offTopicPenalty);
    if (!Number.isFinite(offTopicPenalty) || offTopicPenalty < 0 || offTopicPenalty > 1) {
      errors.push('offTopicPenalty must be between 0 and 1.');
    }
  }

  if (typeKey === 'speaking_describe_image') {
    if (String(scoring.scorerVersion || '').trim() !== 'pte-describe-image-v1') {
      errors.push('scorerVersion must be pte-describe-image-v1.');
    }
    const contentMax = Number(scoring.contentMax);
    const pronunciationMax = Number(scoring.pronunciationMax);
    const fluencyMax = Number(scoring.fluencyMax);
    [
      ['contentMax', contentMax],
      ['pronunciationMax', pronunciationMax],
      ['fluencyMax', fluencyMax]
    ].forEach(([label, value]) => {
      if (!Number.isFinite(value) || value <= 0 || value > 5) {
        errors.push(`${label} must be greater than 0 and no more than 5.`);
      }
    });
    if (
      Number.isFinite(contentMax)
      && Number.isFinite(pronunciationMax)
      && Number.isFinite(fluencyMax)
      && Number.isFinite(Number(scoring.maxScore))
      && Math.abs(Number(scoring.maxScore) - (contentMax + pronunciationMax + fluencyMax)) > 0.01
    ) {
      errors.push('maxScore must equal contentMax + pronunciationMax + fluencyMax.');
    }
    const longPauseSeconds = Number(scoring.longPauseSeconds);
    if (!Number.isFinite(longPauseSeconds) || longPauseSeconds < 0.5 || longPauseSeconds > 10) {
      errors.push('longPauseSeconds must be between 0.5 and 10.');
    }
    const minAnalysisConfidence = Number(scoring.minAnalysisConfidence);
    if (!Number.isFinite(minAnalysisConfidence) || minAnalysisConfidence < 0 || minAnalysisConfidence > 1) {
      errors.push('minAnalysisConfidence must be between 0 and 1.');
    }
  }

  if (typeKey === 'writing_summarize_written_text' || typeKey === 'writing_write_email') {
    if (Number(payload.maxWords || 0) < Number(payload.minWords || 0)) {
      errors.push('maxWords must be greater than or equal to minWords.');
    }
  }

  if (typeKey === 'writing_write_email') {
    const requiredPoints = Array.isArray(payload.requiredPoints) ? payload.requiredPoints : [];
    if (requiredPoints.length < 3) {
      errors.push('requiredPoints must include at least three items for Write Email.');
    }
    if (Number(payload.minWords || 0) < 50 || Number(payload.maxWords || 0) > 120) {
      errors.push('Write Email word limits must stay within 50 to 120 words.');
    }
  }

  if (typeKey === 'writing_summarize_written_text') {
    const minWords = Number(payload.minWords || 0);
    const maxWords = Number(payload.maxWords || 0);
    const recommendedTimeMinutes = Number(payload.recommendedTimeMinutes || 0);
    if (minWords < 5 || maxWords > 75) {
      errors.push('Summarize Written Text word limits must stay within 5 to 75 words.');
    }
    if (recommendedTimeMinutes < 1 || recommendedTimeMinutes > 30) {
      errors.push('recommendedTimeMinutes must be between 1 and 30 for Summarize Written Text.');
    }
  }

  if (typeKey === 'writing_short_answer' && Number(payload.maxWords || 0) > 0 && Number(payload.maxWords || 0) < Number(payload.minWords || 0)) {
    errors.push('maxWords must be greater than or equal to minWords when provided.');
  }

  if (typeKey === 'reading_mcq_single') {
    if (!validateOptionsForMcq(payload.options)) errors.push('Options must be a JSON array with at least two items in {key,text} format.');
    const optionKeys = Array.isArray(payload.options) ? payload.options.map((item) => String(item.key || '').trim()) : [];
    if (!optionKeys.includes(String(payload.correctOptionKey || '').trim())) {
      errors.push('correctOptionKey must match one of the option keys.');
    }
  }

  if (typeKey === 'reading_mcq_multiple' || typeKey === 'listening_mcq_multiple') {
    if (!validateOptionsForMcq(payload.options)) errors.push('Options must be a JSON array with at least two items in {key,text} format.');
    const optionKeys = new Set(Array.isArray(payload.options) ? payload.options.map((item) => String(item.key || '').trim()).filter(Boolean) : []);
    const correctKeys = Array.isArray(payload.correctOptionKeys) ? payload.correctOptionKeys : [];
    if (!correctKeys.length) errors.push('At least one correct option key is required.');
    correctKeys.forEach((key) => {
      if (!optionKeys.has(String(key || '').trim())) {
        errors.push(`Correct option key '${key}' does not exist in options.`);
      }
    });
  }

  if (typeKey === 'listening_mcq_single') {
    if (!validateOptionsForMcq(payload.options)) errors.push('Options must be a JSON array with at least two items in {key,text} format.');
    const optionKeys = Array.isArray(payload.options) ? payload.options.map((item) => String(item.key || '').trim()) : [];
    if (!optionKeys.includes(String(payload.correctOptionKey || '').trim())) {
      errors.push('correctOptionKey must match one of the option keys.');
    }
  }

  if (typeKey === 'listening_select_missing_word') {
    if (!validateOptionsForMcq(payload.options)) errors.push('Options must be a JSON array with at least two items in {key,text} format.');
    const optionKeys = Array.isArray(payload.options) ? payload.options.map((item) => String(item.key || '').trim()) : [];
    if (!optionKeys.includes(String(payload.correctOptionKey || '').trim())) {
      errors.push('correctOptionKey must match one of the option keys.');
    }
  }

  if (typeKey === 'listening_highlight_incorrect_words') {
    const sourceTranscriptToken = cleanString(payload.transcript, { max: LONG_TRANSCRIPT_MAX_CHARS, allowEmpty: true }).toLowerCase();
    const transcriptTextToken = String(payload.transcriptText || '').toLowerCase();
    const incorrectWords = Array.isArray(payload.incorrectWords)
      ? payload.incorrectWords.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const derivedIncorrectWords = extractChangedWordsFromTranscripts(payload.transcript, payload.transcriptText);
    const derivedIncorrectSet = new Set(derivedIncorrectWords.map((row) => String(row || '').toLowerCase()).filter(Boolean));
    const incorrectWordSet = new Set(incorrectWords.map((row) => String(row || '').toLowerCase()).filter(Boolean));

    if (!incorrectWords.length) {
      errors.push('incorrectWords must include at least one value.');
    } else {
      const missingInTranscript = incorrectWords.filter((word) => !transcriptTextToken.includes(String(word || '').toLowerCase()));
      if (missingInTranscript.length) {
        errors.push(`incorrectWords must appear in transcriptText: ${missingInTranscript.join(', ')}.`);
      }
      if (sourceTranscriptToken && derivedIncorrectSet.size) {
        const missingFromIncorrectWords = Array.from(derivedIncorrectSet.values()).filter((word) => !incorrectWordSet.has(word));
        if (missingFromIncorrectWords.length) {
          errors.push(`incorrectWords must include all changed words found in transcript comparison: ${missingFromIncorrectWords.join(', ')}.`);
        }
        const extraIncorrectWords = Array.from(incorrectWordSet.values()).filter((word) => !derivedIncorrectSet.has(word));
        if (extraIncorrectWords.length) {
          errors.push(`incorrectWords contains value(s) not detected as changed against source transcript: ${extraIncorrectWords.join(', ')}.`);
        }
      }
    }
    if (sourceTranscriptToken && !derivedIncorrectSet.size) {
      errors.push('transcriptText must contain at least one changed word compared with transcript.');
    }
  }

  if (typeKey === 'reading_fill_in_blank' || typeKey === 'listening_fill_in_blank' || typeKey === 'reading_writing_fill_in_blank') {
    if (!isPlainObject(payload.blankAnswerMap) || !Object.keys(payload.blankAnswerMap).length) {
      errors.push('blankAnswerMap must include at least one blank mapping.');
    }
  }

  if (typeKey === 'reading_writing_fill_in_blank') {
    const answerMap = isPlainObject(payload.blankAnswerMap) ? payload.blankAnswerMap : {};
    const optionsMap = isPlainObject(payload.blankOptionsMap) ? payload.blankOptionsMap : {};
    const answerKeys = Object.keys(answerMap).map((row) => cleanString(row, { max: 120, allowEmpty: true })).filter(Boolean);
    if (!isPlainObject(payload.blankOptionsMap) || !Object.keys(optionsMap).length) {
      errors.push('blankOptionsMap must include options for each blank.');
    }
    answerKeys.forEach((blankKey) => {
      const correctAnswer = cleanString(answerMap[blankKey], { max: 300, allowEmpty: true });
      const options = Array.isArray(optionsMap[blankKey])
        ? optionsMap[blankKey].map((row) => cleanString(row, { max: 300, allowEmpty: true })).filter(Boolean)
        : [];
      if (options.length !== 4) {
        errors.push(`blankOptionsMap['${blankKey}'] must contain exactly 4 options.`);
        return;
      }
      const optionSet = new Set(options.map((row) => String(row || '').toLowerCase()));
      if (optionSet.size !== options.length) {
        errors.push(`blankOptionsMap['${blankKey}'] must contain unique options.`);
      }
      if (!correctAnswer || !optionSet.has(String(correctAnswer || '').toLowerCase())) {
        errors.push(`blankOptionsMap['${blankKey}'] must include the correct answer from blankAnswerMap.`);
      }
    });
    const extraOptionKeys = Object.keys(optionsMap)
      .map((row) => cleanString(row, { max: 120, allowEmpty: true }))
      .filter(Boolean)
      .filter((key) => !answerKeys.includes(key));
    if (extraOptionKeys.length) {
      errors.push(`blankOptionsMap has keys not found in blankAnswerMap: ${extraOptionKeys.join(', ')}.`);
    }
  }

  if (typeKey === 'reading_reorder_paragraphs') {
    const paragraphs = Array.isArray(payload.paragraphItems)
      ? payload.paragraphItems.map((item) => cleanString(item, { max: LONG_TRANSCRIPT_MAX_CHARS, allowEmpty: true })).filter(Boolean)
      : [];
    const orderRows = Array.isArray(payload.correctOrder)
      ? payload.correctOrder.map((item) => cleanString(item, { max: LONG_TRANSCRIPT_MAX_CHARS, allowEmpty: true })).filter(Boolean)
      : [];

    if (paragraphs.length < 2) {
      errors.push('paragraphItems must include at least two items.');
    }
    if (!orderRows.length) {
      errors.push('correctOrder is required.');
    }
    if (paragraphs.length >= 2) {
      const paragraphCounts = new Map();
      paragraphs.forEach((row) => {
        paragraphCounts.set(row, (paragraphCounts.get(row) || 0) + 1);
      });
      const duplicateParagraphs = Array.from(paragraphCounts.entries()).filter(([, count]) => count > 1).map(([row]) => row);
      if (duplicateParagraphs.length) {
        errors.push('paragraphItems must be unique to avoid ambiguous ordering.');
      }
    }
    if (paragraphs.length && orderRows.length) {
      if (orderRows.length !== paragraphs.length) {
        errors.push('correctOrder must contain the same number of items as paragraphItems.');
      } else {
        const paragraphSet = new Set(paragraphs);
        const orderSet = new Set(orderRows);
        const missingFromOrder = paragraphs.filter((row) => !orderSet.has(row));
        const extraInOrder = orderRows.filter((row) => !paragraphSet.has(row));
        const duplicateInOrder = orderRows.filter((row, index) => orderRows.indexOf(row) !== index);
        if (missingFromOrder.length || extraInOrder.length || duplicateInOrder.length) {
          errors.push('correctOrder must include each paragraph item exactly once.');
        }
      }
    }
  }

  if (typeKey === 'listening_summarize_spoken_text') {
    if (Number(payload.maxWords || 0) > 0 && Number(payload.maxWords || 0) < Number(payload.minWords || 0)) {
      errors.push('maxWords must be greater than or equal to minWords when provided.');
    }
    if (Number(payload.recommendedTimeMinutes || 0) <= 0) {
      errors.push('recommendedTimeMinutes must be greater than 0.');
    }
  }

  if (typeKey === 'reading_matching' || typeKey === 'listening_matching') {
    if (!Array.isArray(payload.leftItems) || !payload.leftItems.length) errors.push('leftItems are required.');
    if (!Array.isArray(payload.rightItems) || !payload.rightItems.length) errors.push('rightItems are required.');
    if (!Array.isArray(payload.correctPairs) || !payload.correctPairs.length) errors.push('correctPairs are required.');
  }

  if (typeKey === 'speaking_answer_short_question') {
    if (!Array.isArray(payload.acceptedAnswers) || !payload.acceptedAnswers.length) {
      errors.push('acceptedAnswers must include at least one answer.');
    }
    const traitTokens = Array.isArray(scoring.traits)
      ? scoring.traits.map((row) => cleanString(row, { max: 120, allowEmpty: true }).toLowerCase()).filter(Boolean)
      : [];
    if (!traitTokens.includes('vocabulary') && !traitTokens.includes('correctness')) {
      errors.push('Scoring traits are missing: vocabulary.');
    }
    if (scoring.scorerVersion && String(scoring.scorerVersion || '').trim() !== 'pte-answer-short-question-v1') {
      errors.push('scorerVersion must be pte-answer-short-question-v1.');
    }
    const minAnalysisConfidence = Number(scoring.minAnalysisConfidence ?? 0.35);
    if (!Number.isFinite(minAnalysisConfidence) || minAnalysisConfidence < 0 || minAnalysisConfidence > 1) {
      errors.push('minAnalysisConfidence must be between 0 and 1.');
    }
    const minSemanticConfidence = Number(scoring.minSemanticConfidence ?? 0.7);
    if (!Number.isFinite(minSemanticConfidence) || minSemanticConfidence < 0 || minSemanticConfidence > 1) {
      errors.push('minSemanticConfidence must be between 0 and 1.');
    }
  }

  return errors;
}

const questionTypeRegistry = {
  VALID_SKILLS,
  VALID_TEST_TYPES,
  QUESTION_TYPE_KEYS,

  listTypes() {
    return AUTHORING_QUESTION_TYPE_KEYS.map((key) => {
      const def = TYPE_REGISTRY[key];
      return {
        key,
        label: def.label,
        skill: def.skill,
        purpose: def.purpose,
        testTypes: resolveAllowedTestTypesForType(key)
      };
    });
  },

  listTestTypes() {
    return VALID_TEST_TYPES.map((value) => ({
      value,
      label: TEST_TYPE_LABELS[value] || value
    }));
  },

  getDefinition(typeKey) {
    const key = String(typeKey || '').trim();
    if (!TYPE_REGISTRY[key]) return null;
    return deepClone({
      key,
      ...TYPE_REGISTRY[key]
    });
  },

  getEditorRegistry() {
    return AUTHORING_QUESTION_TYPE_KEYS.map((key) => {
      const def = TYPE_REGISTRY[key];
      return deepClone({
        key,
        skill: def.skill,
        testTypes: resolveAllowedTestTypesForType(key),
        label: def.label,
        purpose: def.purpose,
        requiredFields: def.requiredFields,
        optionalFields: def.optionalFields,
        hiddenFields: def.hiddenFields,
        payloadFields: def.payloadFields,
        scoringFields: def.scoringFields,
        scoringDefaults: def.scoringDefaults,
        responseShape: def.responseShape,
        validationRules: def.validationRules,
        previewRules: def.previewRules,
        editorBehavior: def.editorBehavior
      });
    });
  },

  getAllowedTestTypesForType(typeKey) {
    return resolveAllowedTestTypesForType(typeKey);
  },

  inferDefaultTestTypeForType(typeKey) {
    return inferDefaultTestTypeForType(typeKey);
  },

  isTypeAllowedForTestType(typeKey, testType) {
    return isQuestionTypeAllowedForTestType(typeKey, testType);
  },

  normalizeQuestionContracts(typeKey, payloadInput = {}, scoringInput = {}) {
    const key = String(typeKey || '').trim();
    const def = TYPE_REGISTRY[key];
    if (!def) throw new Error(`Unsupported question type '${key}'.`);
    const payload = normalizePayloadForType(key, payloadInput);
    const scoringConfig = normalizeScoringForType(key, scoringInput);
    const errors = collectValidationErrorsForType(key, payload, scoringConfig);
    return {
      payload,
      scoringConfig,
      responseContract: deepClone(def.responseShape),
      errors
    };
  },

  validateQuestionContracts(typeKey, payload = {}, scoringConfig = {}) {
    const key = String(typeKey || '').trim();
    if (!TYPE_REGISTRY[key]) return [`Unsupported question type '${key}'.`];
    return collectValidationErrorsForType(key, payload, scoringConfig);
  }
};

module.exports = questionTypeRegistry;
