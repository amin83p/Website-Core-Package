// MVC/services/ielts/step3ScoringService.js

const aiService = require('./aiService');
const essayAnalysisService = require('./essayAnalysisService');
const { scoringRules, scoringRuleHelpers } = require('./scoringRules'); 
const crypto = require('crypto');
const { applyLanguageEvidenceCalibrationGuards } = require('./languageEvidenceCalibration');
const {
  normalizeScoringAnswerToken,
  normalizeScoringAnswerList,
  evaluateRowPassResult: evaluateAnswerContractPassResult
} = require('./answerContractUtils');

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function normalizeValue(val, typeInfo) {
  const s = String(val ?? '').trim().toLowerCase();
  if (typeInfo.kind === 'boolean' || typeInfo.kind === 'boolean_count') {
    if (['yes', 'true', '1'].includes(s)) return 'Yes';
    if (['no', 'false', '0'].includes(s)) return 'No';
  }
  if (typeInfo.options && typeInfo.options.length > 0) {
    const match = typeInfo.options.find(opt => opt.toLowerCase() === s);
    if (match) return match;
  }
  return String(val ?? ''); 
}

function parseAnswerType(answerType) {
  const t = String(answerType ?? '').trim().toLowerCase();
  if (t === 'boolean' || t === 'boolean/count') {
    return { kind: 'boolean', options: ['Yes', 'No'] };
  }
  const match = t.match(/\(([^)]+)\)/);
  if (match) {
    const options = match[1].split('/').map(s => s.trim());
    if (t.startsWith('categorical')) return { kind: 'categorical', options };
    if (t.startsWith('ordinal')) return { kind: 'ordinal', options };
  }
  return { kind: 'unknown', options: [] };
}

function toPromptAnswerLabel(token) {
  const normalized = normalizeScoringAnswerToken(token);
  if (!normalized) return '';
  return normalized
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatScoringAnswerListForPrompt(list) {
  const normalized = normalizeScoringAnswerList(list);
  if (!normalized.length) return '(not configured)';
  return normalized.map(toPromptAnswerLabel).join(' / ');
}

function normalizeRunMode(mode) {
  const m = String(mode || '').trim().toLowerCase();
  return m === 'operationalized_only' ? 'operationalized_only' : 'hybrid_extension';
}

function normalizeStabilityProfile(profile) {
  return String(profile || '').trim().toLowerCase() === 'strict' ? 'strict' : 'standard';
}

function hasTaskEchoSignals(taskEcho) {
  if (!taskEcho || typeof taskEcho !== 'object') return false;
  return (
    Number.isFinite(Number(taskEcho.effectiveContentWordCount)) &&
    Number.isFinite(Number(taskEcho.effectiveContentRatio)) &&
    Number.isFinite(Number(taskEcho.wordOverlapRatio))
  );
}

function isGeneratedNoPromptTaskEcho(taskEcho) {
  if (!hasTaskEchoSignals(taskEcho)) return false;
  return (
    String(taskEcho.detectionVersion || '') === 'v2_robust_phrase' &&
    Number(taskEcho.wordOverlapRatio || 0) === 0 &&
    Number(taskEcho.reusedPromptPhraseCount || 0) === 0 &&
    Number(taskEcho.reusedPromptSentenceLikeCount || 0) === 0 &&
    Number(taskEcho.copiedWordEstimate || 0) === 0 &&
    Number(taskEcho.anchorReuseCount || 0) === 0 &&
    String(taskEcho.severity || '').toLowerCase() === 'none'
  );
}

function withTaskEchoSignals(step2Features, essayObj, taskPrompt) {
  const baseStep2 = (step2Features && typeof step2Features === 'object') ? step2Features : {};
  const promptText = String(taskPrompt || '').trim();
  if (hasTaskEchoSignals(baseStep2.taskEcho) && (!promptText || !isGeneratedNoPromptTaskEcho(baseStep2.taskEcho))) {
    return baseStep2;
  }

  const computedTaskEcho = essayAnalysisService.computeTaskEchoSignals(essayObj || {}, promptText);

  return {
    ...baseStep2,
    taskEcho: computedTaskEcho
  };
}

function renderTemplateContent(templateContent, context = {}) {
  return String(templateContent || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = context[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function buildStep4ProfilePromptBlock(profile) {
  const p = normalizeStabilityProfile(profile);
  if (p === 'strict') {
    return `
STABILITY PROFILE: STRICT
- Use only explicit textual evidence; avoid inference-heavy interpretation.
- If uncertain or borderline, prefer "No" for deterministic reproducibility.
- Keep evidence minimal and high-confidence (strongest refs only).
- Do not over-credit weak or indirect support.
`.trim();
  }
  return `
STABILITY PROFILE: STANDARD
- Use explicit evidence and reasonable examiner interpretation.
- Balance fairness and coverage while remaining conservative.
- Include relevant evidence without over-expanding weak support.
`.trim();
}

function normalizeSignalClassification(value, signalKind) {
  const explicit = String(value || '').trim().toLowerCase();
  if (['deterministic', 'hybrid', 'ai_only'].includes(explicit)) return explicit;
  const kind = String(signalKind || '').trim().toLowerCase();
  if (kind === 'deterministic' || kind === 'external') return 'deterministic';
  if (kind === 'ai') return 'ai_only';
  return 'hybrid';
}

function normalizeScope(scope) {
  return String(scope || '').trim().toLowerCase() === 'paragraph' ? 'paragraph' : 'essay';
}

function normalizeParagraphRoleConstraint(value) {
  const v = String(value || '').trim().toLowerCase();
  if (['intro', 'body', 'conclusion'].includes(v)) return v;
  return 'any';
}

function parseBooleanish(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(raw)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(raw)) return false;
  return fallback;
}

function normalizeQuestionWeight(value, fallback = 1) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  return fallback;
}

function roundMetric(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(digits));
}

const LEGACY_LEXICAL_RANGE = ['basic', 'adequate', 'wide'];
const LEGACY_LEXICAL_PRECISION = ['low', 'mixed', 'high'];
const LEGACY_UNCOMMON_SKILL = ['none', 'some', 'skilful'];
const LEGACY_ERROR_PROFILE = ['rare', 'occasional', 'frequent'];

const LEXICAL_CONTROL_ENUMS = {
  rangeBand: ['limited', 'adequate', 'sufficient', 'wide'],
  precisionBand: ['low', 'mixed', 'good', 'high'],
  collocationControl: ['weak', 'mixed', 'good'],
  awkwardExpressionCountBand: ['none', 'few', 'some', 'many'],
  spellingImpact: ['none', 'minor', 'some', 'frequent'],
  wordFormationImpact: ['none', 'minor', 'some', 'frequent'],
  repetitionImpact: ['none', 'mild', 'noticeable', 'strong'],
  clarityImpactFromLexis: ['none', 'minor', 'some', 'major']
};

const GRAMMAR_CONTROL_ENUMS = {
  structureRange: ['simple_only', 'mixed', 'varied', 'wide'],
  complexSentenceControl: ['weak', 'mixed', 'good'],
  errorFrequency: ['rare', 'occasional', 'noticeable', 'frequent'],
  subjectVerbAgreement: ['strong', 'mixed', 'weak'],
  articleControl: ['strong', 'mixed', 'weak'],
  prepositionControl: ['strong', 'mixed', 'weak'],
  punctuationControl: ['strong', 'mixed', 'weak'],
  sentenceBoundaryControl: ['strong', 'mixed', 'weak'],
  clarityImpactFromGrammar: ['none', 'minor', 'some', 'major'],
  errorFreeSentenceShareBand: ['very_low', 'low', 'moderate', 'high']
};

function pickEnumValue(value, allowed, fallback = null) {
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return fallback;
  return allowed.includes(token) ? token : fallback;
}

function normalizeLegacyLexicalQuality(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const range = pickEnumValue(raw.range, LEGACY_LEXICAL_RANGE, null);
  const precision = pickEnumValue(raw.precision, LEGACY_LEXICAL_PRECISION, null);
  const uncommonSkill = pickEnumValue(raw.uncommonSkill, LEGACY_UNCOMMON_SKILL, null);
  if (!range && !precision && !uncommonSkill) return null;
  return {
    range: range || 'adequate',
    precision: precision || 'mixed',
    uncommonSkill: uncommonSkill || 'some'
  };
}

function normalizeLegacyErrorProfiles(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const grammar = pickEnumValue(raw.grammar, LEGACY_ERROR_PROFILE, null);
  const lexical = pickEnumValue(raw.lexical, LEGACY_ERROR_PROFILE, null);
  const punctuation = pickEnumValue(raw.punctuation, LEGACY_ERROR_PROFILE, null);
  if (!grammar && !lexical && !punctuation) return null;
  return {
    grammar: grammar || 'occasional',
    lexical: lexical || 'occasional',
    punctuation: punctuation || 'occasional'
  };
}

function normalizeLexicalControl(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const hasAnySignal = Object.keys(LEXICAL_CONTROL_ENUMS).some((key) => String(raw[key] ?? '').trim() !== '');
  if (!hasAnySignal) return null;
  return {
    rangeBand: pickEnumValue(raw.rangeBand, LEXICAL_CONTROL_ENUMS.rangeBand, 'adequate'),
    precisionBand: pickEnumValue(raw.precisionBand, LEXICAL_CONTROL_ENUMS.precisionBand, 'mixed'),
    collocationControl: pickEnumValue(raw.collocationControl, LEXICAL_CONTROL_ENUMS.collocationControl, 'mixed'),
    awkwardExpressionCountBand: pickEnumValue(raw.awkwardExpressionCountBand, LEXICAL_CONTROL_ENUMS.awkwardExpressionCountBand, 'some'),
    spellingImpact: pickEnumValue(raw.spellingImpact, LEXICAL_CONTROL_ENUMS.spellingImpact, 'minor'),
    wordFormationImpact: pickEnumValue(raw.wordFormationImpact, LEXICAL_CONTROL_ENUMS.wordFormationImpact, 'minor'),
    repetitionImpact: pickEnumValue(raw.repetitionImpact, LEXICAL_CONTROL_ENUMS.repetitionImpact, 'mild'),
    clarityImpactFromLexis: pickEnumValue(raw.clarityImpactFromLexis, LEXICAL_CONTROL_ENUMS.clarityImpactFromLexis, 'minor')
  };
}

function normalizeGrammarControl(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const hasAnySignal = Object.keys(GRAMMAR_CONTROL_ENUMS).some((key) => String(raw[key] ?? '').trim() !== '');
  if (!hasAnySignal) return null;
  return {
    structureRange: pickEnumValue(raw.structureRange, GRAMMAR_CONTROL_ENUMS.structureRange, 'mixed'),
    complexSentenceControl: pickEnumValue(raw.complexSentenceControl, GRAMMAR_CONTROL_ENUMS.complexSentenceControl, 'mixed'),
    errorFrequency: pickEnumValue(raw.errorFrequency, GRAMMAR_CONTROL_ENUMS.errorFrequency, 'occasional'),
    subjectVerbAgreement: pickEnumValue(raw.subjectVerbAgreement, GRAMMAR_CONTROL_ENUMS.subjectVerbAgreement, 'mixed'),
    articleControl: pickEnumValue(raw.articleControl, GRAMMAR_CONTROL_ENUMS.articleControl, 'mixed'),
    prepositionControl: pickEnumValue(raw.prepositionControl, GRAMMAR_CONTROL_ENUMS.prepositionControl, 'mixed'),
    punctuationControl: pickEnumValue(raw.punctuationControl, GRAMMAR_CONTROL_ENUMS.punctuationControl, 'mixed'),
    sentenceBoundaryControl: pickEnumValue(raw.sentenceBoundaryControl, GRAMMAR_CONTROL_ENUMS.sentenceBoundaryControl, 'mixed'),
    clarityImpactFromGrammar: pickEnumValue(raw.clarityImpactFromGrammar, GRAMMAR_CONTROL_ENUMS.clarityImpactFromGrammar, 'minor'),
    errorFreeSentenceShareBand: pickEnumValue(raw.errorFreeSentenceShareBand, GRAMMAR_CONTROL_ENUMS.errorFreeSentenceShareBand, 'moderate')
  };
}

function mapLexicalQualityFromLexicalControl(lexicalControl) {
  if (!lexicalControl) return null;
  const rangeMap = {
    limited: 'basic',
    adequate: 'adequate',
    sufficient: 'adequate',
    wide: 'wide'
  };
  const precisionMap = {
    low: 'low',
    mixed: 'mixed',
    good: 'high',
    high: 'high'
  };
  const uncommonMap = {
    weak: 'none',
    mixed: 'some',
    good: 'skilful'
  };
  return {
    range: rangeMap[lexicalControl.rangeBand] || 'adequate',
    precision: precisionMap[lexicalControl.precisionBand] || 'mixed',
    uncommonSkill: uncommonMap[lexicalControl.collocationControl] || 'some'
  };
}

function mapErrorProfilesFromRichSignals(grammarControl, lexicalControl) {
  const grammarMap = {
    rare: 'rare',
    occasional: 'occasional',
    noticeable: 'occasional',
    frequent: 'frequent'
  };
  const punctuationMap = {
    strong: 'rare',
    mixed: 'occasional',
    weak: 'frequent'
  };
  const lexicalImpactScore = (() => {
    if (!lexicalControl) return 1;
    const impactToScore = { none: 0, minor: 1, some: 2, frequent: 3, mild: 1, noticeable: 2, strong: 3, major: 3 };
    const values = [
      lexicalControl.spellingImpact,
      lexicalControl.wordFormationImpact,
      lexicalControl.clarityImpactFromLexis,
      lexicalControl.repetitionImpact
    ];
    return Math.max(...values.map((v) => impactToScore[v] ?? 1));
  })();
  const lexicalProfile = lexicalImpactScore >= 3
    ? 'frequent'
    : lexicalImpactScore >= 2
      ? 'occasional'
      : 'rare';
  return {
    grammar: grammarMap[grammarControl?.errorFrequency] || 'occasional',
    lexical: lexicalProfile,
    punctuation: punctuationMap[grammarControl?.punctuationControl] || 'occasional'
  };
}

function mapLexicalControlFromLegacy(lexicalQuality, errorProfiles) {
  if (!lexicalQuality && !errorProfiles) return null;
  const rangeMap = {
    basic: 'limited',
    adequate: 'adequate',
    wide: 'wide'
  };
  const precisionMap = {
    low: 'low',
    mixed: 'mixed',
    high: 'high'
  };
  const collocationMap = {
    none: 'weak',
    some: 'mixed',
    skilful: 'good'
  };
  const lexicalImpactMap = {
    rare: 'minor',
    occasional: 'some',
    frequent: 'frequent'
  };
  const legacyLexical = normalizeLegacyLexicalQuality(lexicalQuality) || {
    range: 'adequate',
    precision: 'mixed',
    uncommonSkill: 'some'
  };
  const legacyErrors = normalizeLegacyErrorProfiles(errorProfiles) || {
    grammar: 'occasional',
    lexical: 'occasional',
    punctuation: 'occasional'
  };
  return {
    rangeBand: rangeMap[legacyLexical.range] || 'adequate',
    precisionBand: precisionMap[legacyLexical.precision] || 'mixed',
    collocationControl: collocationMap[legacyLexical.uncommonSkill] || 'mixed',
    awkwardExpressionCountBand: legacyLexical.precision === 'low' ? 'many' : (legacyLexical.precision === 'high' ? 'few' : 'some'),
    spellingImpact: lexicalImpactMap[legacyErrors.lexical] || 'some',
    wordFormationImpact: lexicalImpactMap[legacyErrors.lexical] || 'some',
    repetitionImpact: legacyLexical.range === 'basic' ? 'strong' : (legacyLexical.range === 'wide' ? 'none' : 'mild'),
    clarityImpactFromLexis:
      legacyErrors.lexical === 'frequent' || legacyLexical.precision === 'low'
        ? 'some'
        : (legacyErrors.lexical === 'rare' && legacyLexical.precision === 'high' ? 'none' : 'minor')
  };
}

function mapGrammarControlFromLegacy(errorProfiles) {
  const legacyErrors = normalizeLegacyErrorProfiles(errorProfiles);
  if (!legacyErrors) return null;
  const grammar = legacyErrors.grammar;
  const punctuation = legacyErrors.punctuation;
  const controlMap = {
    rare: 'strong',
    occasional: 'mixed',
    frequent: 'weak'
  };
  const structureRangeMap = {
    rare: 'varied',
    occasional: 'mixed',
    frequent: 'simple_only'
  };
  const complexMap = {
    rare: 'good',
    occasional: 'mixed',
    frequent: 'weak'
  };
  const clarityMap = {
    rare: 'none',
    occasional: 'minor',
    frequent: 'some'
  };
  const errorFreeShareMap = {
    rare: 'high',
    occasional: 'moderate',
    frequent: 'low'
  };
  return {
    structureRange: structureRangeMap[grammar] || 'mixed',
    complexSentenceControl: complexMap[grammar] || 'mixed',
    errorFrequency: grammar || 'occasional',
    subjectVerbAgreement: controlMap[grammar] || 'mixed',
    articleControl: controlMap[grammar] || 'mixed',
    prepositionControl: controlMap[grammar] || 'mixed',
    punctuationControl: controlMap[punctuation] || 'mixed',
    sentenceBoundaryControl: controlMap[punctuation] || 'mixed',
    clarityImpactFromGrammar: clarityMap[grammar] || 'minor',
    errorFreeSentenceShareBand: errorFreeShareMap[grammar] || 'moderate'
  };
}

function buildLanguageEvidenceSourceMeta({
  richLexicalInput = null,
  richGrammarInput = null,
  lexicalControl = null,
  grammarControl = null
} = {}) {
  const lexicalControlSource = richLexicalInput
    ? 'rich'
    : (lexicalControl ? 'legacy_mapped' : 'missing');
  const grammarControlSource = richGrammarInput
    ? 'rich'
    : (grammarControl ? 'legacy_mapped' : 'missing');
  return {
    lexicalControl: lexicalControlSource,
    grammarControl: grammarControlSource
  };
}

function normalizeStep3ExtractionEvidence(extraction) {
  if (!extraction || typeof extraction !== 'object') {
    return {
      normalizedExtraction: extraction,
      calibration: {
        applied: false,
        adjustmentCount: 0,
        adjustments: []
      }
    };
  }
  const hasAnyLanguageSignal = Boolean(
    extraction?.lexicalControl ||
    extraction?.grammarControl ||
    extraction?.lexicalQuality ||
    extraction?.errorProfiles
  );
  if (!hasAnyLanguageSignal) {
    return {
      normalizedExtraction: {
        ...extraction,
        _languageEvidenceSource: buildLanguageEvidenceSourceMeta({})
      },
      calibration: {
        applied: false,
        adjustmentCount: 0,
        adjustments: []
      }
    };
  }

  const legacyLexicalQuality = normalizeLegacyLexicalQuality(extraction?.lexicalQuality);
  const legacyErrorProfiles = normalizeLegacyErrorProfiles(extraction?.errorProfiles);
  const richLexicalInput = normalizeLexicalControl(extraction?.lexicalControl);
  const richGrammarInput = normalizeGrammarControl(extraction?.grammarControl);
  const hasRichInput = Boolean(richLexicalInput || richGrammarInput);
  let lexicalControl = richLexicalInput;
  let grammarControl = richGrammarInput;

  if (!lexicalControl) lexicalControl = mapLexicalControlFromLegacy(legacyLexicalQuality, legacyErrorProfiles);
  if (!grammarControl) grammarControl = mapGrammarControlFromLegacy(legacyErrorProfiles);

  const calibration = applyLanguageEvidenceCalibrationGuards({ lexicalControl, grammarControl });
  lexicalControl = calibration.lexicalControl || lexicalControl;
  grammarControl = calibration.grammarControl || grammarControl;

  const lexicalQuality = hasRichInput
    ? (mapLexicalQualityFromLexicalControl(lexicalControl) || legacyLexicalQuality)
    : (legacyLexicalQuality || mapLexicalQualityFromLexicalControl(lexicalControl));
  const errorProfiles = hasRichInput
    ? (mapErrorProfilesFromRichSignals(grammarControl, lexicalControl) || legacyErrorProfiles)
    : (legacyErrorProfiles || mapErrorProfilesFromRichSignals(grammarControl, lexicalControl));

  if (!lexicalControl) lexicalControl = mapLexicalControlFromLegacy(lexicalQuality, errorProfiles);
  if (!grammarControl) grammarControl = mapGrammarControlFromLegacy(errorProfiles);
  const languageEvidenceSource = buildLanguageEvidenceSourceMeta({
    richLexicalInput,
    richGrammarInput,
    lexicalControl,
    grammarControl
  });

  return {
    normalizedExtraction: {
    ...extraction,
    lexicalQuality: lexicalQuality || extraction?.lexicalQuality,
    errorProfiles: errorProfiles || extraction?.errorProfiles,
    lexicalControl: lexicalControl || extraction?.lexicalControl || null,
    grammarControl: grammarControl || extraction?.grammarControl || null,
    _languageEvidenceSource: languageEvidenceSource
    },
    calibration: calibration || {
      applied: false,
      adjustmentCount: 0,
      adjustments: []
    }
  };
}

const KNOWN_FAULT_CHECK_BASE_KEYS = new Set([
  // Low-band compatibility keys (v2 low-band starter bank)
  'TR1-1', 'TR2-1', 'TR2-2', 'TR2-3A', 'TR2-3B', 'TR3-1', 'TR3-2', 'TR3-3A', 'TR3-3B', 'TR3-3C',
  'CC1-1', 'CC2-1A', 'CC2-1B', 'CC3-1A', 'CC3-1B', 'CC3-2',
  'LR1-1', 'LR2-1', 'LR3-1', 'LR3-2',
  'GRA1-1', 'GRA2-1', 'GRA3-1'
]);

function normalizePolarityToken(raw) {
  const token = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '_');
  if (!token) return null;
  if (['FAULT_CHECK', 'FAULT', 'NEGATIVE'].includes(token)) return 'FAULT_CHECK';
  if (['FEATURE_CHECK', 'FEATURE', 'POSITIVE'].includes(token)) return 'FEATURE_CHECK';
  return null;
}

function resolveAssessmentPolarity(item, baseKey) {
  const explicit = normalizePolarityToken(
    item?.polarity ??
    item?.questionPolarity ??
    item?.polarityType ??
    item?.signalPolarity ??
    item?.polarity_hint
  );
  if (explicit) {
    return { polarity: explicit, polaritySource: 'metadata' };
  }

  const normalizedBaseKey = String(baseKey || '').trim().toUpperCase();
  if (KNOWN_FAULT_CHECK_BASE_KEYS.has(normalizedBaseKey)) {
    return { polarity: 'FAULT_CHECK', polaritySource: 'basekey_compat' };
  }

  if (isFaultCheckQuestion(item?.atomic_question || item?.atomicQuestion || item?.question, item?.rubric_anchor || item?.rubricAnchor)) {
    return { polarity: 'FAULT_CHECK', polaritySource: 'question_inference' };
  }

  return { polarity: 'FEATURE_CHECK', polaritySource: 'default_feature' };
}

function normalizeAssessmentDefinition(item) {
  const baseKey = String(item?.baseKey || item?.question_key || item?.id || '').trim();
  const scope = normalizeScope(item?.scope);
  const signalClassification = normalizeSignalClassification(item?.signalClassification, item?.signal_kind);
  const polarityInfo = resolveAssessmentPolarity(item, baseKey);
  const typeInfo = parseAnswerType(item?.answer_type);
  const scoredAnswers = normalizeScoringAnswerList(item?.scoredAnswers ?? item?.scored_answers);
  const notScoredAnswers = normalizeScoringAnswerList(item?.notScoredAnswers ?? item?.not_scored_answers);
  const hasExplicitScoringContract = scoredAnswers.length > 0 || notScoredAnswers.length > 0;
  return {
    ...item,
    baseKey,
    question_key: baseKey, // compatibility alias for legacy functions
    typeInfo,
    weight: normalizeQuestionWeight(item?.weight),
    subconstruct: item?.subconstruct || item?.title || item?.criterion || 'General',
    scope,
    expectedEvidenceType: String(item?.expectedEvidenceType || 'sentence_indices').trim().toLowerCase(),
    signalClassification,
    operationalizedOnlyEligible: parseBooleanish(
      item?.operationalizedOnlyEligible,
      signalClassification === 'deterministic'
    ),
    polarity: polarityInfo.polarity,
    polaritySource: polarityInfo.polaritySource,
    scoredAnswers,
    notScoredAnswers,
    hasExplicitScoringContract,
    paragraphRoleConstraint: normalizeParagraphRoleConstraint(item?.paragraphRoleConstraint),
    feedbackRole: String(item?.feedbackRole || 'general').trim().toLowerCase() || 'general'
  };
}

function buildAssessmentInstances(definitions, step2Features) {
  const perParagraphFeatures = Array.isArray(step2Features?.perParagraphFeatures)
    ? step2Features.perParagraphFeatures
    : [];
  const out = [];

  for (const def of definitions) {
    if (!def?.baseKey) continue;
    if (def.scope !== 'paragraph') {
      out.push({
        ...def,
        instanceKey: def.baseKey,
        question_key: def.baseKey,
        paragraphIndex: null,
        paragraphNumber: null
      });
      continue;
    }

    const eligibleParagraphs = perParagraphFeatures.filter((p) => {
      if (!Number.isInteger(p?.paragraphIndex)) return false;
      if (def.paragraphRoleConstraint === 'any') return true;
      return String(p?.role || '').toLowerCase() === def.paragraphRoleConstraint;
    });

    for (const paragraph of eligibleParagraphs) {
      const paragraphNumber = Number.isInteger(paragraph.paragraphNumber)
        ? paragraph.paragraphNumber
        : paragraph.paragraphIndex + 1;
      const instanceKey = `${def.baseKey}::P${paragraphNumber}`;
      out.push({
        ...def,
        instanceKey,
        question_key: instanceKey,
        paragraphIndex: paragraph.paragraphIndex,
        paragraphNumber
      });
    }
  }

  return out;
}

function getParagraphFeature(step2Features, paragraphIndex) {
  if (!Number.isInteger(paragraphIndex)) return null;
  const perParagraphFeatures = Array.isArray(step2Features?.perParagraphFeatures)
    ? step2Features.perParagraphFeatures
    : [];
  return perParagraphFeatures.find((row) => Number(row?.paragraphIndex) === paragraphIndex) || null;
}

function getEssayParagraph(essayObj, paragraphIndex) {
  if (!Number.isInteger(paragraphIndex)) return null;
  const paragraphs = Array.isArray(essayObj?.paragraphs) ? essayObj.paragraphs : [];
  return paragraphs[paragraphIndex] || null;
}

function getParagraphSentences(essayObj, paragraphIndex) {
  if (!Number.isInteger(paragraphIndex)) return [];
  const sentences = Array.isArray(essayObj?.sentences) ? essayObj.sentences : [];
  return sentences.filter((s) => Number(s?.paragraphIndex) === paragraphIndex);
}

function buildItemRuntimeContext(baseCtx, question) {
  const paragraphIndex = Number.isInteger(question?.paragraphIndex) ? question.paragraphIndex : null;
  const paragraphFeature = getParagraphFeature(baseCtx?.step2, paragraphIndex);
  const essayParagraph = getEssayParagraph(baseCtx?.essay, paragraphIndex);
  const paragraphSentences = getParagraphSentences(baseCtx?.essay, paragraphIndex);

  const structureRoles = Array.isArray(baseCtx?.step2?.structure?.paragraphRoles)
    ? baseCtx.step2.structure.paragraphRoles
    : [];
  const roleFromStructure = paragraphIndex !== null ? (structureRoles[paragraphIndex] || null) : null;
  const paragraphRole = paragraphFeature?.role || roleFromStructure || null;

  const topicSentenceByParagraph = Array.isArray(baseCtx?.step25?.topicSentenceByParagraph)
    ? baseCtx.step25.topicSentenceByParagraph
    : [];
  const paragraphTopicSentence = paragraphIndex !== null
    ? (topicSentenceByParagraph.find((row) => Number(row?.paragraphIndex) === paragraphIndex) || null)
    : null;

  const bodySupportRows = Array.isArray(baseCtx?.step25?.bodySupport)
    ? baseCtx.step25.bodySupport
    : [];
  const paragraphBodySupport = paragraphIndex !== null
    ? (bodySupportRows.find((row) => Number(row?.paragraphIndex) === paragraphIndex) || null)
    : null;

  const paragraphNumber = Number.isInteger(question?.paragraphNumber)
    ? question.paragraphNumber
    : Number.isInteger(paragraphFeature?.paragraphNumber)
      ? paragraphFeature.paragraphNumber
      : Number.isInteger(essayParagraph?.paragraphNumber)
        ? essayParagraph.paragraphNumber
        : (paragraphIndex !== null ? paragraphIndex + 1 : null);

  const currentItem = {
    baseKey: question?.baseKey || question?.question_key || null,
    instanceKey: question?.instanceKey || question?.baseKey || question?.question_key || null,
    scope: question?.scope || 'essay',
    criterion: question?.criterion || null,
    band: question?.band,
    paragraphIndex,
    paragraphNumber,
    paragraphRoleConstraint: question?.paragraphRoleConstraint || 'any'
  };

  const currentParagraph = paragraphIndex === null
    ? null
    : {
      paragraphIndex,
      paragraphNumber,
      role: paragraphRole,
      feature: paragraphFeature || null,
      features: paragraphFeature || null,
      text: typeof essayParagraph?.text === 'string' ? essayParagraph.text : null,
      paragraphText: typeof essayParagraph?.text === 'string' ? essayParagraph.text : null,
      sentences: paragraphSentences,
      topicSentence: paragraphTopicSentence,
      bodySupport: paragraphBodySupport
    };

  return {
    essay: baseCtx?.essay,
    step1: baseCtx?.step1,
    step2: baseCtx?.step2,
    step25: baseCtx?.step25,
    taskPrompt: baseCtx?.taskPrompt,
    results: baseCtx?.results || {},
    currentItem,
    item: currentItem,
    currentParagraph,
    paragraph: currentParagraph
  };
}

function buildSentenceBlock(essayObj) {
  if (!essayObj || !essayObj.sentences) return "";
  return essayObj.sentences
    .map(s => `P${s.paragraphIndex} S${s.index}: ${s.text}`)
    .join('\n');
}

function buildAnalysisContext(step2, step1) {
  const structure = step2?.structure || {};
  const cohesion = step2?.cohesion || {};
  const taskEcho = step2?.taskEcho || {};
  const stats = step1?.stats || {};
  const sentenceCount = Number(stats?.sentenceCount || structure?.sentenceCount || 0);
  const paragraphSentenceCounts = Array.isArray(structure?.paragraphSentenceCounts)
    ? structure.paragraphSentenceCounts
    : [];
  const paragraphVirtualSentenceCounts = Array.isArray(structure?.paragraphVirtualSentenceCounts)
    ? structure.paragraphVirtualSentenceCounts
    : [];
  const virtualSplitSentenceCount = Number(structure?.virtualSplitSentenceCount || 0);
  const recoveredSentenceDelta = Number(structure?.recoveredSentenceDelta || 0);
  const virtualRecoveryApplied = Boolean(structure?.virtualRecoveryApplied);
  const sentenceShape = paragraphSentenceCounts.length
    ? `[${paragraphSentenceCounts.join(', ')}]`
    : 'Unknown';
  const virtualShape = paragraphVirtualSentenceCounts.length
    ? `[${paragraphVirtualSentenceCounts.join(', ')}]`
    : 'Unknown';
  const taskEchoSeverity = String(taskEcho?.severity || 'none');
  const taskEchoEffectiveWords = Number(taskEcho?.effectiveContentWordCount || 0);
  const taskEchoCopiedWords = Number(taskEcho?.copiedWordEstimate || 0);
  const taskEchoSentenceLike = Number(taskEcho?.reusedPromptSentenceLikeCount || 0);
  const taskEchoPhraseLike = Number(taskEcho?.reusedPromptPhraseCount || 0);
  const taskEchoOverlap = Number(taskEcho?.wordOverlapRatio || 0);
  const taskEchoDiagCount = Array.isArray(taskEcho?.matchedUnitDiagnostics)
    ? taskEcho.matchedUnitDiagnostics.length
    : 0;

  return `
- **Word Count:** ${stats.wordCount || 0} words.
- **Sentence Units:** ${sentenceCount}.
- **Paragraphs:** ${structure.paragraphCount || 0} detected.
- **Structure:** ${structure.paragraphRoles?.join(' -> ') || 'Unknown'}.
- **Paragraph Sentence Counts:** ${sentenceShape}.
- **Virtual Recovery:** ${virtualRecoveryApplied ? 'Applied' : 'Not applied'} (virtual sentence rows=${virtualSplitSentenceCount}, recovered delta=${recoveredSentenceDelta}, per-paragraph virtual counts=${virtualShape}).
- **Task Echo:** severity=${taskEchoSeverity}, effectiveWords=${taskEchoEffectiveWords}, copiedWords~${taskEchoCopiedWords}, sentenceLikeReuse=${taskEchoSentenceLike}, phraseReuse=${taskEchoPhraseLike}, overlap=${taskEchoOverlap}, diagnostics=${taskEchoDiagCount}.
- **Cohesion:** ${cohesion.densityPer100 || 0} linking words per 100 words. (Target > 5).
`.trim();
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch (_) {
    return 'null';
  }
}

function buildStep4LanguageEvidenceContext(step25 = {}) {
  const lexicalControl = step25?.lexicalControl || null;
  const grammarControl = step25?.grammarControl || null;
  const lexicalQuality = step25?.lexicalQuality || null;
  const errorProfiles = step25?.errorProfiles || null;

  return [
    `lexicalControl: ${safeJsonStringify(lexicalControl)}`,
    `grammarControl: ${safeJsonStringify(grammarControl)}`,
    `lexicalQuality (legacy): ${safeJsonStringify(lexicalQuality)}`,
    `errorProfiles (legacy): ${safeJsonStringify(errorProfiles)}`
  ].join('\n');
}

// ----------------------------------------------------------------
// STABILITY HELPERS (Step 4)
// ----------------------------------------------------------------

const CRIT_ORDER = { TR: 1, CC: 2, LR: 3, GRA: 4 };

// Prompt cache (per process)
const _step4PromptCache = new Map();

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

//Update from V2.0 to this version
const NEGATIVE_KEYWORDS = [
  'limited', 'unclear', 'inadequate', 'irrelevant', 'repetitive', 'lack', 'error',
  'fault', 'faulty', 'mechanical', 'not always clear', 'not sufficiently', 'uneven',
  'inaccurate', 'misuse', 'under-use', 'over-use', 'rarely', 'difficulty', 'difficult', 'problem', 'issue', 'fails to',
  'absent', 'missing', 'no conclusion', 'inappropriate', 'does not', 'cannot', 'unable',
  'barely', 'very little', 'no position', 'no clear position', 'no real development',
  'largely undeveloped', 'largely irrelevant', 'not organised logically', 'not well supported', 'not always logical',
  'overgeneralise', 'overgeneralize', 'tendency to overgeneralise', 'tendency to overgeneralize',
  'memorised phrases', 'isolated words', 'completely unrelated',
  'predominate', 'predominates', 'distort meaning', 'severely distort',
  'partial', 'partially', 'tangential', 'superficial', 'underdeveloped', 'under-developed', 'only briefly'
];

const NEGATIVE_FAULT_PATTERNS = [
  /\bis\s+no\b/i,
  /\bno\s+clear\b/i,
  /\bdoes\s+the\s+response\s+barely\b/i,
  /\bvery\s+little\b/i,
  /\bvery\s+limited\b/i,
  /\bfails?\s+to\b/i,
  /\bcan(?:\s+the\s+writer)?\s+not\b/i,
  /\bnot\s+use\b/i,
  /\bexcept\s+in\s+memor(?:i|y)sed\s+phrases\b/i,
  /\bonly\s+a\s+few\s+isolated\s+words\b/i,
  /\bcompletely\s+unrelated\b/i,
  /\bseverely\s+distort\b/i,
  /\blargely\s+undeveloped\b/i,
  /\blargely\s+irrelevant\b/i
];

function isFaultCheckQuestion(qText, rubricAnchor = '') {
  const t = `${String(qText || '')} ${String(rubricAnchor || '')}`.toLowerCase();
  if (NEGATIVE_KEYWORDS.some((k) => t.includes(k))) return true;
  return NEGATIVE_FAULT_PATTERNS.some((pattern) => pattern.test(t));
}

function getQuestionPolarity(q) {
  const explicit = normalizePolarityToken(
    q?.polarity ??
    q?.questionPolarity ??
    q?.polarityType ??
    q?.signalPolarity ??
    q?.polarity_hint
  );
  if (explicit) return explicit;

  const baseKey = String(q?.baseKey || q?.question_key || '').trim().toUpperCase();
  if (KNOWN_FAULT_CHECK_BASE_KEYS.has(baseKey)) return 'FAULT_CHECK';

  return isFaultCheckQuestion(q?.atomic_question || q?.atomicQuestion || q?.question, q?.rubric_anchor || q?.rubricAnchor)
    ? 'FAULT_CHECK'
    : 'FEATURE_CHECK';
}

const LEXICAL_RICH_EVIDENCE_REQUIRED_BASE_KEYS = new Set([
  'LR5-1',
  'LR5-2',
  'LR5-3',
  'LR5-4',
  'LR6-1',
  'LR6-2',
  'LR6-3',
  'LR6-4',
  'LR7-1',
  'LR7-2',
  'LR7-3',
  'LR8-1',
  'LR8-2',
  'LR8-3',
  'LR9-1',
  'LR9-2'
]);

const GRAMMAR_RICH_EVIDENCE_REQUIRED_BASE_KEYS = new Set([
  'GRA4-3',
  'GRA4-4',
  'GRA4-5',
  'GRA6-1',
  'GRA6-2',
  'GRA6-3',
  'GRA7-1',
  'GRA7-2',
  'GRA7-3',
  'GRA7-4',
  'GRA8-1',
  'GRA8-2',
  'GRA8-3',
  'GRA9-1',
  'GRA9-2'
]);

const DETERMINISTIC_RULE_TRACE_BASE_KEYS = new Set(['TR7-1', 'LR6-2', 'GRA7-2']);

function normalizeEvidenceSourceToken(raw) {
  const token = String(raw || '').trim().toLowerCase();
  if (token === 'rich') return 'rich';
  if (token === 'legacy_mapped') return 'legacy_mapped';
  if (token === 'missing') return 'missing';
  return 'missing';
}

function evaluateDeterministicRuleConfidence(question, itemCtx) {
  const baseKey = String(question?.baseKey || question?.question_key || '').trim().toUpperCase();
  if (!baseKey) return null;
  const sourceMeta = itemCtx?.step25?._languageEvidenceSource || {};

  if (LEXICAL_RICH_EVIDENCE_REQUIRED_BASE_KEYS.has(baseKey)) {
    const lexicalSource = normalizeEvidenceSourceToken(sourceMeta?.lexicalControl);
    if (lexicalSource !== 'rich') {
      return {
        code: 'lexical_rich_evidence_required',
        detail: { lexicalControlSource: lexicalSource }
      };
    }
  }

  if (GRAMMAR_RICH_EVIDENCE_REQUIRED_BASE_KEYS.has(baseKey)) {
    const grammarSource = normalizeEvidenceSourceToken(sourceMeta?.grammarControl);
    if (grammarSource !== 'rich') {
      return {
        code: 'grammar_rich_evidence_required',
        detail: { grammarControlSource: grammarSource }
      };
    }
  }

  return null;
}

function shouldCaptureDeterministicRuleTrace(baseKey) {
  const token = String(baseKey || '').trim().toUpperCase();
  return DETERMINISTIC_RULE_TRACE_BASE_KEYS.has(token);
}

function normalizeDeterministicRuleTraceDiagnostics(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const helperProfiles = (raw.helperProfiles && typeof raw.helperProfiles === 'object')
    ? raw.helperProfiles
    : null;
  const decisionSignals = (raw.decisionSignals && typeof raw.decisionSignals === 'object')
    ? raw.decisionSignals
    : null;
  const version = String(raw.version || '').trim() || null;
  if (!helperProfiles && !decisionSignals && !version) return null;
  return {
    version,
    helperProfiles,
    decisionSignals
  };
}

function buildDeterministicRuleTrace({ question, itemCtx, canUseDeterministicRule, fallbackReason, calculatedValue }) {
  const baseKey = String(question?.baseKey || question?.question_key || '').trim().toUpperCase();
  if (!shouldCaptureDeterministicRuleTrace(baseKey)) return null;

  const patchGroupName = String(scoringRuleHelpers?.patchGroupByRuleKey?.[baseKey] || '').trim() || null;
  const patchGroupMeta = patchGroupName && scoringRuleHelpers?.patchGroupMeta
    ? scoringRuleHelpers.patchGroupMeta[patchGroupName]
    : null;
  const patchGroupEnabled = patchGroupName && typeof scoringRuleHelpers?.isRulePatchGroupEnabled === 'function'
    ? Boolean(scoringRuleHelpers.isRulePatchGroupEnabled(patchGroupName))
    : null;
  const rawDiagnostics = itemCtx?.__ruleDiagnostics?.[baseKey] || itemCtx?.__ruleDiagnostics?.[question?.baseKey] || null;
  const diagnostics = normalizeDeterministicRuleTraceDiagnostics(rawDiagnostics);

  return {
    baseKey,
    canUseDeterministicRule: canUseDeterministicRule === true,
    fallbackReason: String(fallbackReason || '').trim() || null,
    calculatedValue: calculatedValue !== null && calculatedValue !== undefined
      ? String(calculatedValue)
      : null,
    patchGroup: {
      name: patchGroupName,
      enabled: patchGroupEnabled,
      status: patchGroupMeta?.status || null,
      introducedByBatch: patchGroupMeta?.introducedByBatch || null
    },
    diagnostics
  };
}

function safeJsonParse(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const attempts = [];
  const pushAttempt = (value) => {
    const candidate = String(value || '').trim();
    if (!candidate) return;
    if (attempts.includes(candidate)) return;
    attempts.push(candidate);
  };

  const stripMarkdownFence = (value) => {
    const input = String(value || '').trim();
    if (!input) return '';
    const fence = input.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence && fence[1]) return String(fence[1]).trim();
    return input.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  };

  const normalizeLooseJson = (value) => {
    let out = String(value || '').trim();
    if (!out) return '';
    // Normalize common LLM formatting artifacts before parse attempts.
    out = out
      .replace(/\uFEFF/g, '')
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/,\s*([}\]])/g, '$1');
    return out.trim();
  };

  pushAttempt(raw);
  pushAttempt(stripMarkdownFence(raw));

  const fenced = stripMarkdownFence(raw);
  const first = fenced.indexOf('{');
  const last = fenced.lastIndexOf('}');
  if (first >= 0 && last > first) {
    pushAttempt(fenced.slice(first, last + 1));
  }

  const normalizedAttempts = attempts.map(normalizeLooseJson);
  for (const candidate of normalizedAttempts) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch (_) {}
  }

  return null;
}

function createAbortError(message = 'Step 4 grading was cancelled by user.') {
  const err = new Error(String(message || 'Step 4 grading was cancelled by user.'));
  err.name = 'AbortError';
  err.code = 'RUN_CANCELLED';
  return err;
}

function isAbortLikeError(error) {
  const code = String(error?.code || '').toUpperCase();
  const name = String(error?.name || '').toLowerCase();
  const msg = String(error?.message || '').toLowerCase();
  return (
    code === 'RUN_CANCELLED' ||
    code === 'ABORT_ERR' ||
    name === 'aborterror' ||
    msg.includes('aborted') ||
    msg.includes('cancelled')
  );
}

function throwIfAborted(signal, message = 'Step 4 grading was cancelled by user.') {
  if (signal?.aborted) {
    throw createAbortError(message);
  }
}

function sleepMs(ms, abortSignal = null) {
  const delay = Number(ms) > 0 ? Number(ms) : 0;
  return new Promise((resolve, reject) => {
    if (!abortSignal) {
      setTimeout(resolve, delay);
      return;
    }
    if (abortSignal.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = setTimeout(() => {
      abortSignal.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    function onAbort() {
      clearTimeout(timer);
      abortSignal.removeEventListener('abort', onAbort);
      reject(createAbortError());
    }
    abortSignal.addEventListener('abort', onAbort, { once: true });
  });
}

function normalizeOptionalModelId(value) {
  const token = String(value || '').trim().replace(/^models\//i, '');
  return token || null;
}

function normalizeOptionalProviderId(value) {
  const token = String(value || '').trim().toLowerCase();
  return token || null;
}

function normalizeOptionalApiProviderId(value) {
  const token = String(value || '').trim();
  return token || null;
}

function parseDelimitedList(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => String(v || '').trim())
      .filter(Boolean);
  }
  if (raw === undefined || raw === null) return [];
  return String(raw || '')
    .split(/[,\n;|]+/g)
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseStep4FallbackRoutes(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((row) => row && typeof row === 'object');
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.filter((row) => row && typeof row === 'object') : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function normalizeRouteCandidate(route = {}, fallbackIndex = 0, defaults = {}) {
  const modelId = normalizeOptionalModelId(route?.modelId || route?.model || route?.id || defaults.modelId);
  const provider = normalizeOptionalProviderId(route?.providerId || route?.provider || defaults.providerId);
  const apiProvider = normalizeOptionalApiProviderId(route?.apiProviderId || route?.apiProvider || route?.providerRecordId || defaults.apiProviderId);
  if (!modelId && !provider && !apiProvider) return null;
  return {
    modelId,
    providerId: provider,
    apiProviderId: apiProvider,
    routeType: fallbackIndex === 0 ? 'primary' : 'fallback',
    routeLabel: fallbackIndex === 0 ? 'primary' : `fallback_${fallbackIndex}`
  };
}

function buildStep4RoutePlan({ fixedModelId, providerId, apiProviderId, options = {} }) {
  const primary = normalizeRouteCandidate({
    modelId: fixedModelId,
    providerId,
    apiProviderId
  }, 0, {});
  const routes = [];
  if (primary) routes.push(primary);

  const fallbackRoutesRaw = []
    .concat(parseStep4FallbackRoutes(options?.step4FallbackRoutes))
    .concat(parseStep4FallbackRoutes(options?.fallbackRoutes));
  const explicitFallbackModels = []
    .concat(parseDelimitedList(options?.step4FallbackModelIds))
    .concat(parseDelimitedList(options?.fallbackModelIds))
    .concat(parseDelimitedList(options?.step4FallbackModelId))
    .concat(parseDelimitedList(options?.fallbackModelId))
    .concat(parseDelimitedList(process.env.IELTS_STEP4_FALLBACK_MODELS))
    .concat(parseDelimitedList(process.env.STEP4_AI_FALLBACK_MODELS));
  const fallbackProviderId = normalizeOptionalProviderId(
    options?.step4FallbackProviderId ||
    options?.fallbackProviderId ||
    process.env.IELTS_STEP4_FALLBACK_PROVIDER_ID ||
    process.env.STEP4_AI_FALLBACK_PROVIDER_ID
  );
  const fallbackApiProviderId = normalizeOptionalApiProviderId(
    options?.step4FallbackApiProviderId ||
    options?.fallbackApiProviderId ||
    process.env.IELTS_STEP4_FALLBACK_API_PROVIDER_ID ||
    process.env.STEP4_AI_FALLBACK_API_PROVIDER_ID
  );
  const defaults = {
    providerId: fallbackProviderId || normalizeOptionalProviderId(providerId),
    apiProviderId: fallbackApiProviderId || normalizeOptionalApiProviderId(apiProviderId)
  };

  const appendedFallbackRoutes = fallbackRoutesRaw.slice();
  explicitFallbackModels.forEach((modelId) => {
    appendedFallbackRoutes.push({
      modelId,
      providerId: defaults.providerId,
      apiProviderId: defaults.apiProviderId
    });
  });

  if (appendedFallbackRoutes.length === 0 && (fallbackProviderId || fallbackApiProviderId)) {
    appendedFallbackRoutes.push({
      modelId: null,
      providerId: fallbackProviderId,
      apiProviderId: fallbackApiProviderId
    });
  }

  const dedupe = new Set();
  appendedFallbackRoutes.forEach((route, idx) => {
    const normalized = normalizeRouteCandidate(route, idx + 1, defaults);
    if (!normalized) return;
    const key = [
      normalized.modelId || '',
      normalized.providerId || '',
      normalized.apiProviderId || ''
    ].join('::');
    if (dedupe.has(key)) return;
    dedupe.add(key);
    const primaryKey = primary ? [
      primary.modelId || '',
      primary.providerId || '',
      primary.apiProviderId || ''
    ].join('::') : '';
    if (primaryKey && key === primaryKey) return;
    routes.push(normalized);
  });

  if (!routes.length) {
    routes.push({
      modelId: normalizeOptionalModelId(fixedModelId),
      providerId: normalizeOptionalProviderId(providerId),
      apiProviderId: normalizeOptionalApiProviderId(apiProviderId),
      routeType: 'primary',
      routeLabel: 'primary'
    });
  }
  return routes;
}

function toBoundedInt(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const intVal = Math.floor(n);
  return Math.max(min, Math.min(max, intVal));
}

function toBoundedNumber(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function resolveStep4RetryPolicy(options = {}) {
  const retryLimit = toBoundedInt(
    options?.step4RetryLimit ?? options?.aiRetryLimit ?? process.env.IELTS_STEP4_RETRY_LIMIT,
    2,
    0,
    6
  );
  const backoffBaseMs = toBoundedInt(
    options?.step4RetryBackoffMs ?? options?.aiRetryBackoffMs ?? process.env.IELTS_STEP4_RETRY_BACKOFF_MS,
    1200,
    150,
    20000
  );
  const backoffMultiplier = toBoundedNumber(
    options?.step4RetryBackoffMultiplier ?? options?.aiRetryBackoffMultiplier ?? process.env.IELTS_STEP4_RETRY_BACKOFF_MULTIPLIER,
    2,
    1,
    4
  );
  const backoffMaxMs = toBoundedInt(
    options?.step4RetryBackoffMaxMs ?? options?.aiRetryBackoffMaxMs ?? process.env.IELTS_STEP4_RETRY_BACKOFF_MAX_MS,
    8000,
    backoffBaseMs,
    60000
  );
  return {
    retryLimit,
    backoffBaseMs,
    backoffMultiplier,
    backoffMaxMs
  };
}

function buildBackoffDelayMs(retryAttempt, retryPolicy) {
  const exponent = Math.max(0, Number(retryAttempt || 0) - 1);
  const raw = Number(retryPolicy.backoffBaseMs || 0) * Math.pow(Number(retryPolicy.backoffMultiplier || 1), exponent);
  const bounded = Math.min(Number(retryPolicy.backoffMaxMs || raw || 0), raw);
  return Math.max(0, Math.floor(bounded));
}

function toSafeErrorSummary(error) {
  const text = String(error?.message || error || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Unknown runtime error';
  return text.slice(0, 220);
}

function classifyStep4Failure(error) {
  const msg = String(error?.message || error || '').trim();
  const lower = msg.toLowerCase();

  if (!lower) {
    return { failureClass: 'unknown_runtime_error', recoverable: false };
  }
  if (lower.includes('deterministic_rule_null')) {
    return { failureClass: 'deterministic_rule_null', recoverable: false };
  }
  if (lower.includes('no_rule')) {
    return { failureClass: 'no_rule', recoverable: false };
  }
  if (
    lower.includes('429') ||
    lower.includes('too many requests') ||
    lower.includes('quota exceeded') ||
    lower.includes('rate limit') ||
    lower.includes('resource_exhausted')
  ) {
    return { failureClass: 'quota_exceeded', recoverable: true };
  }
  if (
    lower.includes('run_cancelled') ||
    lower.includes('cancelled by user') ||
    lower.includes('request aborted by caller') ||
    lower.includes('aborted')
  ) {
    return { failureClass: 'aborted', recoverable: false };
  }
  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('deadline exceeded') ||
    lower.includes('etimedout') ||
    lower.includes('aborted')
  ) {
    return { failureClass: 'timeout', recoverable: true };
  }
  if (
    /\b(500|502|503|504)\b/.test(lower) ||
    lower.includes('service unavailable') ||
    lower.includes('bad gateway') ||
    lower.includes('gateway timeout') ||
    lower.includes('overloaded') ||
    lower.includes('temporarily unavailable') ||
    lower.includes('internal server error')
  ) {
    return { failureClass: 'transient_provider_error', recoverable: true };
  }
  if (
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('eai_again') ||
    lower.includes('socket hang up') ||
    lower.includes('network error') ||
    lower.includes('connection reset') ||
    lower.includes('fetch failed')
  ) {
    return { failureClass: 'transport_error', recoverable: true };
  }
  if (
    lower.includes('json parse error') ||
    lower.includes('unexpected token') ||
    lower.includes('unterminated') ||
    lower.includes('invalid json')
  ) {
    return { failureClass: 'parsing_error', recoverable: true };
  }
  if (
    lower.includes('schema') ||
    lower.includes('validation failed') ||
    lower.includes('invalid generationconfig') ||
    lower.includes('response schema')
  ) {
    return { failureClass: 'schema_error', recoverable: false };
  }
  if (
    lower.includes('unsupported') ||
    lower.includes('invalid response type')
  ) {
    return { failureClass: 'unsupported_response', recoverable: false };
  }
  return { failureClass: 'unknown_runtime_error', recoverable: false };
}

function getAllowedOptions(typeInfo) {
  if (!typeInfo) return [];
  if (typeInfo.kind === 'boolean' || typeInfo.kind === 'boolean_count') return ['Yes', 'No'];
  if (Array.isArray(typeInfo.options) && typeInfo.options.length) return typeInfo.options;
  return [];
}

function isValueAllowedForType(value, typeInfo) {
  const allowed = getAllowedOptions(typeInfo);
  if (!allowed.length) return true;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return allowed.some((token) => String(token ?? '').trim().toLowerCase() === normalized);
}

function normalizeScoreValue(value) {
  return normalizeScoringAnswerToken(value);
}

function evaluateRowPassResult(rowLike) {
  return evaluateAnswerContractPassResult(rowLike, {
    getQuestionPolarity
  });
}

function isPassingValue(valueOrRow, polarity, scoredAnswers, notScoredAnswers) {
  if (valueOrRow && typeof valueOrRow === 'object') {
    return evaluateRowPassResult(valueOrRow).pass;
  }
  return evaluateRowPassResult({
    value: valueOrRow,
    polarity,
    scoredAnswers,
    notScoredAnswers
  }).pass;
}

function chooseLegacyAggregateValue(semanticOutcome, polarity) {
  const p = String(polarity || 'FEATURE_CHECK').toUpperCase();
  if (semanticOutcome === 'pass') {
    return p === 'FAULT_CHECK' ? 'No' : 'Yes';
  }
  return p === 'FAULT_CHECK' ? 'Yes' : 'No';
}

function chooseAggregateValueFromContract({ semanticOutcome, scoredAnswers, notScoredAnswers, polarity }) {
  if (semanticOutcome === 'error') {
    return {
      aggregateValue: 'Error',
      aggregateValueSource: 'legacy_fallback',
      aggregateSemanticOutcome: 'error'
    };
  }

  if (semanticOutcome === 'pass' && Array.isArray(scoredAnswers) && scoredAnswers.length > 0) {
    return {
      aggregateValue: toPromptAnswerLabel(scoredAnswers[0]) || String(scoredAnswers[0]),
      aggregateValueSource: 'scoredAnswers',
      aggregateSemanticOutcome: 'pass'
    };
  }

  if (semanticOutcome === 'fail' && Array.isArray(notScoredAnswers) && notScoredAnswers.length > 0) {
    return {
      aggregateValue: toPromptAnswerLabel(notScoredAnswers[0]) || String(notScoredAnswers[0]),
      aggregateValueSource: 'notScoredAnswers',
      aggregateSemanticOutcome: 'fail'
    };
  }

  return {
    aggregateValue: chooseLegacyAggregateValue(semanticOutcome, polarity),
    aggregateValueSource: 'legacy_fallback',
    aggregateSemanticOutcome: semanticOutcome
  };
}

function aggregateInstanceResults(results) {
  const byBase = new Map();
  for (const row of (results || [])) {
    const key = `${row.criterion}::${row.band}::${row.baseKey || row.question_key || ''}`;
    if (!byBase.has(key)) byBase.set(key, []);
    byBase.get(key).push(row);
  }

  const aggregated = [];
  const aggregationTrace = { TR: [], CC: [], LR: [], GRA: [] };

  for (const groupRows of byBase.values()) {
    const first = groupRows[0];
    const criterion = first.criterion;

    if (groupRows.length === 1 || first.scope !== 'paragraph') {
      aggregated.push({ ...first });
      continue;
    }

    const evaluations = groupRows.map((row) => ({ row, passResult: evaluateRowPassResult(row) }));
    const evaluatedRows = evaluations.filter((entry) => entry.passResult.evaluated === true);
    const passCount = evaluatedRows.filter((entry) => entry.passResult.pass === true).length;
    const totalEvaluated = evaluatedRows.length;
    const passRatio = totalEvaluated > 0 ? passCount / totalEvaluated : null;
    const semanticOutcome = totalEvaluated === 0 ? 'error' : (passRatio >= 0.5 ? 'pass' : 'fail');
    const aggregateChoice = chooseAggregateValueFromContract({
      semanticOutcome,
      scoredAnswers: normalizeScoringAnswerList(first.scoredAnswers),
      notScoredAnswers: normalizeScoringAnswerList(first.notScoredAnswers),
      polarity: first.polarity || getQuestionPolarity(first)
    });

    const evidenceSentenceIndices = Array.from(
      new Set(
        groupRows.flatMap((r) => Array.isArray(r.evidenceSentenceIndices) ? r.evidenceSentenceIndices : [])
      )
    ).filter((n) => Number.isInteger(n)).sort((a, b) => a - b);

    aggregated.push({
      ...first,
      question_key: first.baseKey || first.question_key,
      instanceKey: first.baseKey || first.instanceKey || first.question_key,
      scope: 'essay',
      value: aggregateChoice.aggregateValue,
      evidenceSentenceIndices,
      source: 'aggregate',
      aggregateValueSource: aggregateChoice.aggregateValueSource,
      aggregateSemanticOutcome: aggregateChoice.aggregateSemanticOutcome
    });

    if (!aggregationTrace[criterion]) aggregationTrace[criterion] = [];
    aggregationTrace[criterion].push({
      baseKey: first.baseKey || first.question_key,
      scope: 'paragraph',
      mode: 'majority_pass',
      instanceCount: groupRows.length,
      evaluatedCount: totalEvaluated,
      passCount,
      passRatio: Number.isFinite(passRatio) ? Number(passRatio.toFixed(4)) : null,
      aggregatedValue: aggregateChoice.aggregateValue,
      aggregateValueSource: aggregateChoice.aggregateValueSource,
      aggregateSemanticOutcome: aggregateChoice.aggregateSemanticOutcome,
      instanceKeys: groupRows.map((r) => r.instanceKey || r.question_key),
      paragraphIndices: groupRows.map((r) => r.paragraphIndex).filter((n) => Number.isInteger(n))
    });
  }

  return { aggregated, aggregationTrace };
}

function normalizeBandGate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i < 1 || i > 9) return null;
  return i;
}

function getSortedBandGates(rows) {
  const out = [];
  const seen = new Set();
  for (const row of (rows || [])) {
    const band = normalizeBandGate(row?.band);
    if (!Number.isInteger(band)) continue;
    if (seen.has(band)) continue;
    seen.add(band);
    out.push(band);
  }
  out.sort((a, b) => a - b);
  return out;
}

function normalizeCriterionForCounters(raw) {
  const token = String(raw || '').trim().toUpperCase();
  if (['TR', 'CC', 'LR', 'GRA'].includes(token)) return token;
  return 'General';
}

function buildCriterionCounter() {
  return { TR: 0, CC: 0, LR: 0, GRA: 0, General: 0 };
}

function incrementCriterionCounter(counter, criterion, amount = 1) {
  const key = normalizeCriterionForCounters(criterion);
  if (!Object.prototype.hasOwnProperty.call(counter, key)) counter[key] = 0;
  counter[key] += amount;
}

function isAiSource(source) {
  return String(source || '').toLowerCase().startsWith('ai');
}

function normalizeFailureClass(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function mapFallbackReasonToFailureClass(fallbackReason) {
  const token = String(fallbackReason || '').trim().toLowerCase();
  if (token === 'no_rule') return 'no_rule';
  if (token === 'rule_returned_null') return 'deterministic_rule_null';
  if (token === 'rule_error') return 'deterministic_rule_error';
  if (token === 'rule_invalid_value') return 'deterministic_rule_invalid_value';
  if (token === 'rule_low_confidence') return 'deterministic_rule_low_confidence';
  return null;
}

function buildFailureClassCounter() {
  return {};
}

function incrementFailureClassCounter(counter, failureClass, amount = 1) {
  const key = normalizeFailureClass(failureClass) || 'unknown';
  if (!Object.prototype.hasOwnProperty.call(counter, key)) counter[key] = 0;
  counter[key] += amount;
}

function incrementTokenCounter(counter, token, amount = 1) {
  const key = normalizeFailureClass(token) || 'none';
  if (!Object.prototype.hasOwnProperty.call(counter, key)) counter[key] = 0;
  counter[key] += amount;
}

function isLowBandRow(row) {
  const band = normalizeBandGate(row?.band);
  return Number.isInteger(band) && band <= 3;
}

function isWeakTriggerRow(row) {
  const val = normalizeScoreValue(row?.value);
  if (!val || val === 'error' || val === 'n/a') return false;
  return !isPassingValue(row);
}

function buildStep4Telemetry({ assessmentInstances = [], results = [], aggregatedResults = [] }) {
  const totalAssessmentInstances = Array.isArray(assessmentInstances) ? assessmentInstances.length : 0;
  const sourceCounts = {
    deterministic: 0,
    ai: 0,
    aggregate: 0
  };

  sourceCounts.deterministic = results.filter((r) => String(r?.source || '').toLowerCase() === 'deterministic').length;
  sourceCounts.ai = results.filter((r) => isAiSource(r?.source)).length;
  sourceCounts.aggregate = aggregatedResults.filter((r) => String(r?.source || '').toLowerCase() === 'aggregate').length;

  const paragraphRows = results.filter((r) => String(r?.scope || '').toLowerCase() === 'paragraph');
  const paragraphBySource = {
    deterministic: paragraphRows.filter((r) => String(r?.source || '').toLowerCase() === 'deterministic').length,
    ai: paragraphRows.filter((r) => isAiSource(r?.source)).length
  };

  const lowBandRows = results.filter((r) => isLowBandRow(r));
  const lowBandRowsByCriterion = buildCriterionCounter();
  for (const row of lowBandRows) {
    incrementCriterionCounter(lowBandRowsByCriterion, row?.criterion, 1);
  }

  const lowBandFallbackNoRule = lowBandRows.filter((r) => isAiSource(r?.source) && String(r?.fallbackReason || '') === 'no_rule').length;
  const lowBandFallbackRuleReturnedNull = lowBandRows.filter((r) => isAiSource(r?.source) && String(r?.fallbackReason || '') === 'rule_returned_null').length;
  const lowBandFallbackRuleError = lowBandRows.filter((r) => isAiSource(r?.source) && String(r?.fallbackReason || '') === 'rule_error').length;
  const lowBandFallbackRuleInvalidValue = lowBandRows.filter((r) => isAiSource(r?.source) && String(r?.fallbackReason || '') === 'rule_invalid_value').length;
  const lowBandFallbackRuleLowConfidence = lowBandRows.filter((r) => isAiSource(r?.source) && String(r?.fallbackReason || '') === 'rule_low_confidence').length;
  const lowBandErrorRows = lowBandRows.filter((r) => normalizeScoreValue(r?.value) === 'error').length;
  const aiRows = results.filter((r) => isAiSource(r?.source));
  const aiErrorRows = aiRows.filter((r) => String(r?.source || '').toLowerCase() === 'ai_error');
  const aiRecoveredRows = aiRows.filter((r) => String(r?.source || '').toLowerCase() !== 'ai_error');
  const aiCoverageFallbackReasonCounts = {};
  const aiCoverageFallbackByBaseKey = {};
  const aiCoverageFallbackByCriterion = {};
  const aiCoverageFallbackByScope = {};
  aiRows.forEach((row) => {
    const reasonToken = normalizeFailureClass(row?.fallbackReason) || 'none';
    incrementTokenCounter(aiCoverageFallbackReasonCounts, reasonToken, 1);

    const baseKey = String(row?.baseKey || row?.question_key || row?.instanceKey || '').trim() || '(unknown)';
    if (!aiCoverageFallbackByBaseKey[baseKey]) aiCoverageFallbackByBaseKey[baseKey] = {};
    incrementTokenCounter(aiCoverageFallbackByBaseKey[baseKey], reasonToken, 1);

    const criterionKey = normalizeCriterionForCounters(row?.criterion);
    if (!aiCoverageFallbackByCriterion[criterionKey]) aiCoverageFallbackByCriterion[criterionKey] = {};
    incrementTokenCounter(aiCoverageFallbackByCriterion[criterionKey], reasonToken, 1);

    const scopeKey = String(row?.scope || '').trim().toLowerCase() === 'paragraph' ? 'paragraph' : 'essay';
    if (!aiCoverageFallbackByScope[scopeKey]) aiCoverageFallbackByScope[scopeKey] = {};
    incrementTokenCounter(aiCoverageFallbackByScope[scopeKey], reasonToken, 1);
  });
  const runtimeFailureClassCounts = buildFailureClassCounter();
  const lowBandRuntimeFailureClassCounts = buildFailureClassCounter();
  aiErrorRows.forEach((row) => {
    const token = normalizeFailureClass(row?.failureClass) || 'unknown_runtime_error';
    incrementFailureClassCounter(runtimeFailureClassCounts, token, 1);
    if (isLowBandRow(row)) incrementFailureClassCounter(lowBandRuntimeFailureClassCounts, token, 1);
  });

  const lowBandCoverageFailureClassCounts = buildFailureClassCounter();
  lowBandRows.forEach((row) => {
    const token = mapFallbackReasonToFailureClass(row?.fallbackReason);
    if (!token) return;
    incrementFailureClassCounter(lowBandCoverageFailureClassCounts, token, 1);
  });

  const aiRecoverableErrorRows = aiErrorRows.filter((r) => r?.recoverableFailure === true);
  const aiNonRecoverableErrorRows = aiErrorRows.filter((r) => r?.recoverableFailure === false);
  const retryAttempts = aiRows.reduce((sum, row) => sum + Number(row?.retryCount || 0), 0);
  const fallbackUsedRows = aiRows.filter((r) => r?.fallbackUsed === true).length;
  const rescuedByRetryRows = aiRecoveredRows.filter((r) => r?.rescuedByRetry === true).length;
  const rescuedByFallbackRows = aiRecoveredRows.filter((r) => r?.rescuedByFallback === true).length;
  const paragraphAiRows = paragraphRows.filter((r) => isAiSource(r?.source));
  const paragraphAiDeterministicRows = paragraphAiRows.filter((r) => String(r?.source || '').toLowerCase() !== 'ai_error' && (r?.fallbackReason === null || r?.fallbackReason === undefined)).length;
  const paragraphAiErrorRows = paragraphAiRows.filter((r) => String(r?.source || '').toLowerCase() === 'ai_error').length;
  const paragraphAiRowsResolvedByRetry = paragraphAiRows.filter((r) => r?.rescuedByRetry === true).length;
  const paragraphAiRowsResolvedByFallback = paragraphAiRows.filter((r) => r?.rescuedByFallback === true).length;
  const fallbackReasonSummaryRows = Object.entries(aiCoverageFallbackReasonCounts)
    .sort((a, b) => {
      if ((b?.[1] || 0) !== (a?.[1] || 0)) return (b?.[1] || 0) - (a?.[1] || 0);
      return String(a?.[0] || '').localeCompare(String(b?.[0] || ''));
    })
    .map(([reason, count]) => {
      const c = Number(count || 0);
      return {
        reason,
        count: c,
        pctOfAiRows: aiRows.length > 0 ? roundMetric((c / aiRows.length) * 100, 2) : 0,
        pctOfTotalRows: totalAssessmentInstances > 0 ? roundMetric((c / totalAssessmentInstances) * 100, 2) : 0
      };
    });

  const deterministicRuleTraceByBaseKey = {};
  results.forEach((row) => {
    const trace = row?.deterministicRuleTrace;
    if (!trace || typeof trace !== 'object') return;
    const baseKey = String(row?.baseKey || trace?.baseKey || '').trim();
    if (!baseKey) return;
    if (!deterministicRuleTraceByBaseKey[baseKey]) {
      deterministicRuleTraceByBaseKey[baseKey] = {
        rows: 0,
        bySource: {},
        lastTrace: null
      };
    }
    const entry = deterministicRuleTraceByBaseKey[baseKey];
    entry.rows += 1;
    const sourceKey = String(row?.source || 'unknown').trim().toLowerCase() || 'unknown';
    entry.bySource[sourceKey] = Number(entry.bySource[sourceKey] || 0) + 1;
    entry.lastTrace = trace;
  });

  return {
    sourceCounts,
    paragraph: {
      totalRows: paragraphRows.length,
      deterministicRows: paragraphBySource.deterministic,
      aiRows: paragraphBySource.ai,
      aiDeterministicRows: paragraphAiDeterministicRows,
      aiErrorRows: paragraphAiErrorRows,
      aiRowsResolvedByRetry: paragraphAiRowsResolvedByRetry,
      aiRowsResolvedByFallback: paragraphAiRowsResolvedByFallback
    },
    lowBand: {
      totalRows: lowBandRows.length,
      rowsByCriterion: lowBandRowsByCriterion,
      aiFallbackNoRule: lowBandFallbackNoRule,
      aiFallbackRuleReturnedNull: lowBandFallbackRuleReturnedNull,
      aiFallbackRuleError: lowBandFallbackRuleError,
      aiFallbackRuleInvalidValue: lowBandFallbackRuleInvalidValue,
      aiFallbackRuleLowConfidence: lowBandFallbackRuleLowConfidence,
      errorRows: lowBandErrorRows,
      coverageFailureClassCounts: lowBandCoverageFailureClassCounts,
      runtimeFailureClassCounts: lowBandRuntimeFailureClassCounts
    },
    aiReliability: {
      totalAiRows: aiRows.length,
      aiErrorRows: aiErrorRows.length,
      recoverableFailureRows: aiRecoverableErrorRows.length,
      nonRecoverableFailureRows: aiNonRecoverableErrorRows.length,
      retryAttempts,
      fallbackUsedRows,
      rescuedByRetryRows,
      rescuedByFallbackRows,
      stillUnevaluableRows: aiErrorRows.length,
      runtimeFailureClassCounts
    },
    aiCoverage: {
      fallbackReasonCounts: aiCoverageFallbackReasonCounts,
      fallbackReasonByBaseKey: aiCoverageFallbackByBaseKey,
      fallbackReasonByCriterion: aiCoverageFallbackByCriterion,
      fallbackReasonByScope: aiCoverageFallbackByScope
    },
    deterministicRuleTraceByBaseKey,
    reporting: {
      routingSummary: {
        totalAssessmentInstances,
        deterministicRows: sourceCounts.deterministic,
        aiRoutedRows: aiRows.length,
        aggregateRows: sourceCounts.aggregate,
        aiRouteRatePct: totalAssessmentInstances > 0
          ? roundMetric((aiRows.length / totalAssessmentInstances) * 100, 2)
          : 0,
        deterministicRatePct: totalAssessmentInstances > 0
          ? roundMetric((sourceCounts.deterministic / totalAssessmentInstances) * 100, 2)
          : 0,
        aiErrorRatePct: aiRows.length > 0
          ? roundMetric((aiErrorRows.length / aiRows.length) * 100, 2)
          : 0,
        fallbackReasonRows: fallbackReasonSummaryRows
      }
    },
    totalAssessmentInstances
  };
}

function buildLowBandCoverageSummary({ results = [], aggregationTrace = {} }) {
  const lowBandRows = results.filter((r) => isLowBandRow(r));
  const triggeredRows = lowBandRows.filter((r) => isWeakTriggerRow(r));

  const uniqueAiOnly = new Map();
  for (const row of lowBandRows) {
    if (!isAiSource(row?.source)) continue;
    const key = `${normalizeCriterionForCounters(row?.criterion)}::${normalizeBandGate(row?.band) || ''}::${String(row?.baseKey || row?.question_key || row?.instanceKey || '')}`;
    if (uniqueAiOnly.has(key)) continue;
    uniqueAiOnly.set(key, {
      criterion: normalizeCriterionForCounters(row?.criterion),
      band: normalizeBandGate(row?.band),
      baseKey: row?.baseKey || row?.question_key || row?.instanceKey || '',
      fallbackReason: row?.fallbackReason || null
    });
  }

  const criteriaWithoutLowBandEvidence = ['TR', 'CC', 'LR', 'GRA'].filter((criterion) => {
    const rowsForCriterion = lowBandRows.filter((r) => normalizeCriterionForCounters(r?.criterion) === criterion);
    if (!rowsForCriterion.length) return true;
    const hasEvidence = rowsForCriterion.some((r) => Array.isArray(r?.evidenceSentenceIndices) && r.evidenceSentenceIndices.some(Number.isInteger));
    return !hasEvidence;
  });

  const paragraphContributions = [];
  for (const criterion of Object.keys(aggregationTrace || {})) {
    const rows = Array.isArray(aggregationTrace?.[criterion]) ? aggregationTrace[criterion] : [];
    rows.forEach((entry) => {
      paragraphContributions.push({
        criterion: normalizeCriterionForCounters(criterion),
        baseKey: entry?.baseKey || '',
        instanceCount: Number(entry?.instanceCount || 0),
        evaluatedCount: Number(entry?.evaluatedCount || 0),
        passCount: Number(entry?.passCount || 0),
        passRatio: Number.isFinite(Number(entry?.passRatio)) ? Number(entry.passRatio) : null,
        aggregatedValue: String(entry?.aggregatedValue || 'N/A'),
        paragraphIndices: Array.isArray(entry?.paragraphIndices) ? entry.paragraphIndices.filter(Number.isInteger) : []
      });
    });
  }

  return {
    totalLowBandRows: lowBandRows.length,
    triggeredItems: triggeredRows.map((row) => ({
      criterion: normalizeCriterionForCounters(row?.criterion),
      band: normalizeBandGate(row?.band),
      baseKey: row?.baseKey || row?.question_key || '',
      instanceKey: row?.instanceKey || row?.question_key || '',
      scope: row?.scope || 'essay',
      source: row?.source || '',
      value: row?.value,
      polarity: row?.polarity || ''
    })),
    aiOnlyItems: Array.from(uniqueAiOnly.values()),
    criteriaWithoutLowBandEvidence,
    paragraphContributions
  };
}

function validateBatchJson(parsed, batch) {
  const missing = [];
  const invalid = [];

  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: false,
      missing: batch.map(q => q.question_key),
      invalid: []
    };
  }

  for (const q of batch) {
    const id = q.question_key;
    const allowed = getAllowedOptions(q.typeInfo);
    const entry = parsed[id];

    if (!entry || typeof entry !== 'object') {
      missing.push(id);
      continue;
    }

    const val = String(entry.value ?? '').trim();
    if (allowed.length) {
      const ok = allowed.some(a => a.toLowerCase() === val.toLowerCase());
      if (!ok) invalid.push({ id, got: entry.value, allowed });
    }

    if (!Array.isArray(entry.evidence)) invalid.push({ id, got: 'evidence_not_array', allowed });
    else if (!entry.evidence.every(n => Number.isInteger(n))) invalid.push({ id, got: 'evidence_not_ints', allowed });

    // Evidence sufficiency checks for stability
    const polarity = getQuestionPolarity(q);
    const vLower = String(entry.value ?? '').trim().toLowerCase();
    const evLen = Array.isArray(entry.evidence) ? entry.evidence.length : 0;
    const yesLike = ['yes','true','1'].includes(vLower);
    if (yesLike) {
      if (polarity === 'FEATURE_CHECK' && evLen < 1) {
        invalid.push({ id, got: 'yes_missing_evidence', allowed });
      }
      if (polarity === 'FAULT_CHECK' && evLen < 2) {
        invalid.push({ id, got: 'fault_yes_needs_more_evidence', allowed });
      }
    }
  }

  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}

function buildRepairPrompt({ missing, invalid, batch, priorJson }) {
  const ids = new Set([...missing, ...invalid.map(x => x.id)]);
  const repairBatch = batch.filter(q => ids.has(q.question_key));

  const questionsText = repairBatch.map((q) => {
    const allowed = getAllowedOptions(q.typeInfo);
    const scoredAnswers = formatScoringAnswerListForPrompt(q.scoredAnswers);
    const notScoredAnswers = formatScoringAnswerListForPrompt(q.notScoredAnswers);
    const polarity = (getQuestionPolarity(q) === 'FAULT_CHECK')
      ? 'FAULT_CHECK (Yes means the problem is clearly present and severe)'
      : 'FEATURE_CHECK (Yes means the feature is clearly present)';
    return `ID: ${q.question_key}
Allowed values: ${allowed.length ? allowed.join(' / ') : 'Yes / No'}
Scored answers: ${scoredAnswers}
Not scored answers: ${notScoredAnswers}
Legacy polarity (fallback only): ${polarity}
Question: ${q.atomic_question}
Band Criteria: "${q.rubric_anchor}"`;
  }).join('\n\n----------------\n\n');

  const invalidText = invalid.length
    ? invalid.map(x => `- ${x.id}: got="${x.got}" allowed=[${(x.allowed || []).join(', ')}]`).join('\n')
    : '(none)';

  return `You returned JSON that is missing some IDs or has invalid values.

You MUST return ONLY raw JSON (no markdown, no backticks, no commentary).
Return ONLY corrected entries for the IDs listed (do not include any other keys).

Invalid entries:
${invalidText}

Missing IDs:
${missing.length ? missing.join(', ') : '(none)'}

Output format (exact):
{
  "TR6-1": { "value": "Yes", "evidence": [3, 9] },
  "CC5-7": { "value": "No", "evidence": [] }
}

QUESTIONS:
${questionsText}

PRIOR JSON (reference only):
${JSON.stringify(priorJson || {}, null, 2)}`;
}

function getFewShotExamples(criterion) {
  if (criterion === 'TR') {
    return `
Q: "Is the response tangential?" (Band 4 Check)
- Scenario A: Essay discusses "fashion history" instead of "influence on lives".
- Answer: "Yes".
- Scenario B: Essay stays on topic but misses one minor sub-point.
- Answer: "No".`;
  }
  if (criterion === 'CC') {
    return `
Q: "Is paragraphing absent?" (Band 5 Check)
- Scenario A: Essay is one giant block of text.
- Answer: "Yes".
- Scenario B: Essay has clear visual breaks between Intro, Body, Conclusion.
- Answer: "No".`;
  }
  if (criterion === 'LR') {
    return `
Q: "Is vocabulary limited?" (Band 5 Check)
- Scenario A: Essay uses "good", "bad", "thing" repeatedly.
- Answer: "Yes".
- Scenario B: Essay uses "beneficial", "detrimental", "aspect".
- Answer: "No".`;
  }
  if (criterion === 'GRA') {
    return `
Q: "Are grammatical errors frequent?" (Band 6 Check)
- Scenario A: Every sentence has a verb tense error.
- Answer: "Yes".
- Scenario B: Complex sentences used, but 2-3 minor comma faults.
- Answer: "No".`;
  }
  return "";
}

// ----------------------------------------------------------------
// MAIN SERVICE
// ----------------------------------------------------------------

const step3ScoringService = {

  runStep3Scoring: async ({ essayObj, step2Features, extraction, microAssessments, taskPrompt, options = {} }) => {
    const abortSignal = options?.abortSignal || null;
    throwIfAborted(abortSignal);
    const runMode = normalizeRunMode(options.mode);
    const normalizedStep2Features = withTaskEchoSignals(step2Features, essayObj, taskPrompt);
    const normalizedBank = (microAssessments || [])
      .map(normalizeAssessmentDefinition)
      .filter((q) => q.is_active !== false && q.baseKey);

    const modeFilteredBank = normalizedBank.filter((q) => {
      if (runMode !== 'operationalized_only') return true;
      return q.operationalizedOnlyEligible === true;
    });

    const assessmentInstances = buildAssessmentInstances(modeFilteredBank, normalizedStep2Features);
    const {
      normalizedExtraction,
      calibration: step3LanguageCalibration
    } = normalizeStep3ExtractionEvidence(extraction || {});
    console.log(`[Step 4] Starting scoring for ${assessmentInstances.length} instantiated items (mode=${runMode})...`);

    const ctx = {
      essay: essayObj,
      step1: { stats: essayObj.stats }, 
      step2: normalizedStep2Features,
      step25: normalizedExtraction,
      taskPrompt: taskPrompt || "Unknown Task",
      results: {} 
    };

    const results = [];
    const aiQueue = [];

    // 1. Deterministic Rules
    for (const q of assessmentInstances) {
      throwIfAborted(abortSignal);
      if (!q.is_active) continue;

      const typeInfo = q.typeInfo || parseAnswerType(q.answer_type);
      let calculatedValue = null;
      let itemCtx = null;
      const canUseDeterministicRule = Boolean(scoringRules[q.baseKey]);
      let fallbackReason = canUseDeterministicRule ? 'rule_returned_null' : 'no_rule';
      let deterministicRuleTrace = null;

      if (canUseDeterministicRule) {
        itemCtx = buildItemRuntimeContext(ctx, q);
        try {
          const val = scoringRules[q.baseKey](itemCtx);
          if (val !== null && val !== undefined) {
            calculatedValue = val;
            fallbackReason = null;
          }
        } catch (err) {
          fallbackReason = 'rule_error';
          console.warn(`[Step 3] Rule error for ${q.baseKey} (${q.instanceKey || q.baseKey}):`, err.message);
        }
      }

      deterministicRuleTrace = buildDeterministicRuleTrace({
        question: q,
        itemCtx,
        canUseDeterministicRule,
        fallbackReason,
        calculatedValue
      });

      if (calculatedValue === null) {
        aiQueue.push({ ...q, typeInfo, fallbackReason, deterministicRuleTrace });
      } else {
        const normVal = normalizeValue(calculatedValue, typeInfo);
        if (!isValueAllowedForType(normVal, typeInfo)) {
          aiQueue.push({
            ...q,
            typeInfo,
            fallbackReason: 'rule_invalid_value',
            ruleInvalidValue: String(calculatedValue ?? ''),
            deterministicRuleTrace
          });
          continue;
        }
        const confidenceGate = evaluateDeterministicRuleConfidence(q, itemCtx);
        if (confidenceGate) {
          aiQueue.push({
            ...q,
            typeInfo,
            fallbackReason: 'rule_low_confidence',
            ruleLowConfidence: confidenceGate,
            deterministicRuleTrace
          });
          continue;
        }
        const resolvedPolarity = getQuestionPolarity(q);
        results.push({
          question_key: q.instanceKey || q.baseKey,
          baseKey: q.baseKey,
          instanceKey: q.instanceKey || q.baseKey,
          scope: q.scope || 'essay',
          paragraphIndex: Number.isInteger(q.paragraphIndex) ? q.paragraphIndex : null,
          paragraphNumber: Number.isInteger(q.paragraphNumber) ? q.paragraphNumber : null,
          band: q.band,
          criterion: q.criterion,
          atomic_question: q.atomic_question,
          rubric_anchor: q.rubric_anchor,
          weight: normalizeQuestionWeight(q.weight),
          expectedEvidenceType: q.expectedEvidenceType || 'sentence_indices',
          signalClassification: q.signalClassification || 'hybrid',
          feedbackRole: q.feedbackRole || 'general',
          value: normVal,
          source: 'deterministic',
          confidence: 1.0,
          evidenceSentenceIndices: [],
          polarity: resolvedPolarity,
          scoredAnswers: normalizeScoringAnswerList(q.scoredAnswers),
          notScoredAnswers: normalizeScoringAnswerList(q.notScoredAnswers),
          hasExplicitScoringContract: q.hasExplicitScoringContract === true,
          fallbackReason: null,
          deterministicRuleTrace
        });
        ctx.results[q.instanceKey || q.baseKey] = normVal; 
      }
    }

    // 2. AI Processing
    let allAiPrompts = [];
    let usedModels = new Set();
    let aiRequestTrace = [];
    let aiUsageSummary = null;
    let aiRetryPolicy = null;
    let aiRoutePlan = [];

    if (aiQueue.length > 0) {
      throwIfAborted(abortSignal);
      console.log(`[Step 4] Sending ${aiQueue.length} items to AI...`);
      const aiResponse = await processAiQueue(aiQueue, ctx, taskPrompt, normalizedExtraction, options);

      results.push(...aiResponse.results);
      allAiPrompts = aiResponse.prompts;
      if (Array.isArray(aiResponse.modelsUsed) && aiResponse.modelsUsed.length) {
        aiResponse.modelsUsed.forEach((modelName) => {
          const token = String(modelName || '').trim();
          if (token) usedModels.add(token);
        });
      } else if (aiResponse.modelUsed) {
        String(aiResponse.modelUsed || '')
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
          .forEach((token) => usedModels.add(token));
      }
      aiRequestTrace = Array.isArray(aiResponse.requestTrace) ? aiResponse.requestTrace : [];
      aiUsageSummary = aiResponse.usageSummary || null;
      aiRetryPolicy = aiResponse.retryPolicy || null;
      aiRoutePlan = Array.isArray(aiResponse.routePlan) ? aiResponse.routePlan : [];
    }

    const { aggregated: aggregatedResults, aggregationTrace } = aggregateInstanceResults(results);

    // 3. Calculate Scores
    const scores = calculateBandScores(aggregatedResults);

    // 4. Sort
    const sortedResults = results.sort((a, b) => {
      const critOrder = { 'TR': 1, 'CC': 2, 'LR': 3, 'GRA': 4 };
      if (critOrder[a.criterion] !== critOrder[b.criterion]) {
        return critOrder[a.criterion] - critOrder[b.criterion];
      }
      if ((a.band || 0) !== (b.band || 0)) return (a.band || 0) - (b.band || 0);
      return String(a.instanceKey || a.question_key || '').localeCompare(String(b.instanceKey || b.question_key || ''));
    });

    const telemetry = buildStep4Telemetry({
      assessmentInstances,
      results: sortedResults,
      aggregatedResults
    });
    const lowBandCoverage = buildLowBandCoverageSummary({
      results: sortedResults,
      aggregationTrace
    });
    const deterministicCount = Number(telemetry?.sourceCounts?.deterministic || 0);
    const aiCount = Number(telemetry?.sourceCounts?.ai || 0);
    const aggregateCount = Number(telemetry?.sourceCounts?.aggregate || 0);

    return {
      overallBand: scores.overall,
      scores: scores.criteria,
      results: sortedResults,
      aggregatedResults: aggregatedResults,
      meta: {
        runMode,
        totalQuestions: assessmentInstances.length,
        totalBaseItems: modeFilteredBank.length,
        skippedNonOperationalized:
          runMode === 'operationalized_only'
            ? Math.max(0, normalizedBank.length - modeFilteredBank.length)
            : 0,
        deterministicCount: deterministicCount,
        aiCount: aiCount,
        aggregateCount: aggregateCount,
        paragraphRowsCount: Number(telemetry?.paragraph?.totalRows || 0),
        aggregationTrace,
        gateTrace: scores.gateTrace || {},
        scoreTrace: scores.gateTrace || {},
        telemetry,
        deterministicRuleTraceByBaseKey: telemetry?.deterministicRuleTraceByBaseKey || {},
        lowBandCoverage,
        step3LanguageEvidence: {
          lexicalControl: normalizedExtraction?.lexicalControl || null,
          grammarControl: normalizedExtraction?.grammarControl || null,
          lexicalQuality: normalizedExtraction?.lexicalQuality || null,
          errorProfiles: normalizedExtraction?.errorProfiles || null,
          calibration: step3LanguageCalibration || {
            applied: false,
            adjustmentCount: 0,
            adjustments: []
          }
        },
        step3LanguageCalibration: step3LanguageCalibration || {
          applied: false,
          adjustmentCount: 0,
          adjustments: []
        },
        aiPrompts: allAiPrompts,
        modelUsed: Array.from(usedModels).join(', '),
        aiUsageSummary,
        aiRequestTrace,
        aiRetryPolicy,
        aiRoutePlan
      }
    };
  },

  buildStep4PromptPreview: async ({ essayObj, step2Features, extraction, microAssessments, taskPrompt, options = {} }) => {
    const runMode = normalizeRunMode(options.mode);
    const normalizedStep2Features = withTaskEchoSignals(step2Features, essayObj, taskPrompt);
    const normalizedBank = (microAssessments || [])
      .map(normalizeAssessmentDefinition)
      .filter((q) => q.is_active !== false && q.baseKey);
    const modeFilteredBank = normalizedBank.filter((q) => {
      if (runMode !== 'operationalized_only') return true;
      return q.operationalizedOnlyEligible === true;
    });
    const assessmentInstances = buildAssessmentInstances(modeFilteredBank, normalizedStep2Features);
    const { normalizedExtraction } = normalizeStep3ExtractionEvidence(extraction || {});
    const ctx = {
      essay: essayObj,
      step1: { stats: essayObj?.stats || {} },
      step2: normalizedStep2Features,
      step25: normalizedExtraction,
      taskPrompt: taskPrompt || "Unknown Task",
      results: {}
    };

    const aiQueue = [];
    for (const q of assessmentInstances) {
      if (!q.is_active) continue;
      const typeInfo = q.typeInfo || parseAnswerType(q.answer_type);
      const canUseDeterministicRule = Boolean(scoringRules[q.baseKey]);
      let calculatedValue = null;
      let itemCtx = null;
      if (canUseDeterministicRule) {
        itemCtx = buildItemRuntimeContext(ctx, q);
        try {
          const val = scoringRules[q.baseKey](itemCtx);
          if (val !== null && val !== undefined) calculatedValue = val;
        } catch (err) {
          console.warn(`[Step 4 Preview] Rule error for ${q.baseKey} (${q.instanceKey || q.baseKey}):`, err.message);
        }
      }
      if (calculatedValue === null) {
        aiQueue.push({ ...q, typeInfo });
      } else {
        const normVal = normalizeValue(calculatedValue, typeInfo);
        if (!isValueAllowedForType(normVal, typeInfo)) {
          aiQueue.push({
            ...q,
            typeInfo,
            fallbackReason: 'rule_invalid_value',
            ruleInvalidValue: String(calculatedValue ?? '')
          });
          continue;
        }
        const confidenceGate = evaluateDeterministicRuleConfidence(q, itemCtx);
        if (confidenceGate) {
          aiQueue.push({
            ...q,
            typeInfo,
            fallbackReason: 'rule_low_confidence',
            ruleLowConfidence: confidenceGate
          });
          continue;
        }
        ctx.results[q.instanceKey || q.baseKey] = normVal;
      }
    }

    const response = await processAiQueue(aiQueue, ctx, taskPrompt, normalizedExtraction, {
      ...options,
      previewOnly: true,
      disableCache: true
    });

    return {
      runMode,
      totalQuestions: assessmentInstances.length,
      aiQuestionCount: aiQueue.length,
      prompts: Array.isArray(response?.prompts) ? response.prompts : []
    };
  }
};

// ----------------------------------------------------------------
// INTERNAL: AI Batch Processing
// ----------------------------------------------------------------

async function processAiQueue(queue, ctx, taskPrompt, extractionData, options) {
  const abortSignal = options?.abortSignal || null;
  throwIfAborted(abortSignal);
  const MAX_BATCH_SIZE = options.batchSize || 5;
  const processed = [];
  const collectedPrompts = [];
  const requestTrace = [];
  const usageSummary = {
    callCount: 0,
    promptTokenCount: 0,
    candidatesTokenCount: 0,
    totalTokenCount: 0
  };
  const previewOnly = options?.previewOnly === true;
  const disableCache = options?.disableCache === true ||
    String(options?.disableCache || '').trim().toLowerCase() === 'true';
  const stabilityProfile = normalizeStabilityProfile(options?.stabilityProfile);
  const profilePromptBlock = buildStep4ProfilePromptBlock(stabilityProfile);
  const promptSource = String(options?.promptSource || '').trim().toLowerCase();
  const promptTemplateContent = String(options?.promptTemplateContent || '').trim();
  const customPrompt = String(options?.customPrompt || '').trim();
  const cacheEnabled = !disableCache;
  const configuredAiTimeoutMsRaw = Number(
    options?.aiTimeoutMs
    ?? options?.step4TimeoutMs
    ?? process.env.IELTS_STEP4_TIMEOUT_MS
    ?? process.env.STEP4_AI_TIMEOUT_MS
  );
  const configuredAiTimeoutMs = Number.isFinite(configuredAiTimeoutMsRaw) && configuredAiTimeoutMsRaw > 0
    ? configuredAiTimeoutMsRaw
    : null;
  const retryPolicy = resolveStep4RetryPolicy(options);

  const sentenceBlock = buildSentenceBlock(ctx.essay);
  const analysisContext = buildAnalysisContext(ctx.step2, ctx.step1);

  const targetModel = options.modelId || null;
  const requestingUser = options.requestingUser || null;
  const providerId = options.providerId || null;
  const apiProviderId = options.apiProviderId || null;
  // Use a fixed model id for this entire Step 4 run (stability + stable cache keys)
  const fixedModelId = targetModel
    || process.env.GEMINI_MODEL_ID
    || (aiService.getActiveModelId && aiService.getActiveModelId())
    || (await aiService.discoverBestModel({
      requestingUser,
      providerId,
      apiProviderId
    }));
  const isGeminiStep4Target =
    String(providerId || '').trim().toLowerCase().includes('gemini')
    || String(providerId || '').trim().toLowerCase().includes('vertex')
    || String(fixedModelId || '').trim().toLowerCase().includes('gemini');
  const aiTimeoutMs = configuredAiTimeoutMs || (isGeminiStep4Target ? 60000 : 45000);
  const routePlan = buildStep4RoutePlan({
    fixedModelId,
    providerId,
    apiProviderId,
    options
  });

  const stance = extractionData?.position?.stance || "Unknown";
  const languageEvidenceContext = buildStep4LanguageEvidenceContext(extractionData || {});

  // 1) Deterministic ordering: criterion -> band -> question_key
  const orderedQueue = (queue || []).slice().sort((a, b) => {
    const ca = CRIT_ORDER[a.criterion] || 99;
    const cb = CRIT_ORDER[b.criterion] || 99;
    if (ca !== cb) return ca - cb;

    const ba = Number(a.band || 0);
    const bb = Number(b.band || 0);
    if (ba !== bb) return ba - bb;

    return String(a.question_key || '').localeCompare(String(b.question_key || ''));
  });

  // 2) Group deterministically by criterion
  const criteriaGroups = { TR: [], CC: [], LR: [], GRA: [], General: [] };
  orderedQueue.forEach(q => {
    const crit = q.criterion || 'General';
    if (criteriaGroups[crit]) criteriaGroups[crit].push(q);
    else criteriaGroups.General.push(q);
  });

  const criterionOrder = ['TR', 'CC', 'LR', 'GRA', 'General'];

  // 3) Sub-chunk into stable batches
  const finalBatches = [];
  for (const crit of criterionOrder) {
    const qs = criteriaGroups[crit] || [];
    for (let i = 0; i < qs.length; i += MAX_BATCH_SIZE) {
      finalBatches.push({ criterion: crit, items: qs.slice(i, i + MAX_BATCH_SIZE) });
    }
  }
  const totalBatchCount = finalBatches.length;

  const capturedModels = new Set();
  if (fixedModelId) capturedModels.add(fixedModelId);
  const addUsage = (usage) => {
    if (!usage || typeof usage !== 'object') return;
    usageSummary.callCount += 1;
    usageSummary.promptTokenCount += Number(usage.promptTokenCount || 0);
    usageSummary.candidatesTokenCount += Number(usage.candidatesTokenCount || 0);
    usageSummary.totalTokenCount += Number(usage.totalTokenCount || 0);
  };

  const processBatch = async (batchObj, idx) => {
    throwIfAborted(abortSignal);
    const batch = batchObj.items;
    const criterion = batchObj.criterion;
    const batchStartMs = Date.now();
    const batchLabel = `${idx + 1}/${totalBatchCount}`;
    console.log(`[Step 4] Batch ${batchLabel} started (criterion=${criterion}, items=${batch.length})`);

    const questionsText = batch.map((q) => {
      const allowed = getAllowedOptions(q.typeInfo);
      const scoredAnswers = formatScoringAnswerListForPrompt(q.scoredAnswers);
      const notScoredAnswers = formatScoringAnswerListForPrompt(q.notScoredAnswers);
      const polarity = (getQuestionPolarity(q) === 'FAULT_CHECK')
        ? 'FAULT_CHECK (Yes means the problem is clearly present and severe)'
        : 'FEATURE_CHECK (Yes means the feature is clearly present)';
      const scopeNote = q.scope === 'paragraph'
        ? `Scope: paragraph P${q.paragraphNumber} (${q.paragraphRoleConstraint || 'any'})`
        : 'Scope: essay';

      return `ID: ${q.question_key}
${scopeNote}
Allowed values: ${allowed.length ? allowed.join(' / ') : 'Yes / No'}
Scored answers: ${scoredAnswers}
Not scored answers: ${notScoredAnswers}
Legacy polarity (fallback only): ${polarity}
Question: ${q.atomic_question}
Band Criteria: "${q.rubric_anchor}"`;
    }).join('\n\n----------------\n\n');

    const fewShotExamples = getFewShotExamples(criterion);

    const builtInPrompt = `You are a Senior IELTS Examiner.

You MUST return ONLY raw JSON (no markdown, no backticks, no commentary).

ESSAY TASK: "${taskPrompt}"
${criterion === "TR" ? `STANCE: ${stance}\n` : ""}SENTENCE INDEXING:
Each essay line is labeled "P{paragraphIndex} S{sentenceIndex}: ...".
- sentenceIndex is the GLOBAL sentence index (0..N-1).
- In "evidence", return ONLY these global sentenceIndex numbers.

CALCULATED METRICS:
${analysisContext}

LANGUAGE EVIDENCE SNAPSHOT (Step 3):
${languageEvidenceContext}

ESSAY CONTENT:
${sentenceBlock}

----------------
SCORING LOGIC (Examples for ${criterion}):
${fewShotExamples}

${profilePromptBlock}

INSTRUCTIONS:
1. Score the script exactly as written, using Text AND Metrics; do not assume missing quality.
2. FEATURE_CHECK: answer "Yes" only when the feature is clearly present with direct evidence; otherwise "No".
3. FAULT_CHECK: answer "Yes" only when the fault is clearly present with direct evidence; otherwise "No".
4. Do not over-credit visible stance statements, paragraph breaks, or connector words when task coverage, idea development, or logical progression are weak.
5. Repetition and weak referencing/substitution should count against cohesion and clarity when relevant.
6. Always use ONLY the allowed values for each ID.

QUESTIONS:
${questionsText}

OUTPUT FORMAT (exactly):
{
  "TR6-1": { "value": "Yes", "evidence": [3, 9] },
  "CC5-7": { "value": "No", "evidence": [] }
}`;
    const templateBase = customPrompt || promptTemplateContent;
    const shouldUseTemplate = promptSource === 'template' && Boolean(templateBase);
    const outputFormatJson = `{
  "TR6-1": { "value": "Yes", "evidence": [3, 9] },
  "CC5-7": { "value": "No", "evidence": [] }
}`;
    const renderedFromTemplate = shouldUseTemplate
      ? renderTemplateContent(templateBase, {
        task_prompt: taskPrompt || "Unknown Task",
        stance: criterion === "TR" ? stance : "",
        analysis_context: analysisContext,
        language_evidence_summary: languageEvidenceContext,
        lexical_control_json: safeJsonStringify(extractionData?.lexicalControl || null),
        grammar_control_json: safeJsonStringify(extractionData?.grammarControl || null),
        lexical_quality_json: safeJsonStringify(extractionData?.lexicalQuality || null),
        error_profiles_json: safeJsonStringify(extractionData?.errorProfiles || null),
        sentence_block: sentenceBlock,
        criterion,
        few_shot_examples: fewShotExamples,
        profile_prompt_block: profilePromptBlock,
        questions_text: questionsText,
        output_format_json: outputFormatJson
      }).trim()
      : '';
    const systemPrompt = renderedFromTemplate || builtInPrompt;

    if (previewOnly) {
      throwIfAborted(abortSignal);
      return { results: [], prompt: systemPrompt };
    }

    const genConfig = {
      temperature: 0,
      topP: 1,
      topK: 1,
      candidateCount: 1,
      responseMimeType: "application/json"
    };
    const buildBatchRows = ({
      source,
      confidence,
      payloadByQuestion = {},
      defaultValue = "N/A",
      runtime = {}
    } = {}) => {
      return batch.map((q) => {
        const payload = payloadByQuestion?.[q.question_key] || {};
        const fallbackReason = q.fallbackReason || null;
        return {
          question_key: q.question_key,
          baseKey: q.baseKey,
          instanceKey: q.instanceKey || q.question_key,
          scope: q.scope || 'essay',
          paragraphIndex: Number.isInteger(q.paragraphIndex) ? q.paragraphIndex : null,
          paragraphNumber: Number.isInteger(q.paragraphNumber) ? q.paragraphNumber : null,
          band: q.band,
          criterion: q.criterion,
          atomic_question: q.atomic_question,
          rubric_anchor: q.rubric_anchor,
          weight: normalizeQuestionWeight(q.weight),
          expectedEvidenceType: q.expectedEvidenceType || 'sentence_indices',
          signalClassification: q.signalClassification || 'hybrid',
          feedbackRole: q.feedbackRole || 'general',
          value: payload.value !== undefined && payload.value !== null
            ? normalizeValue(payload.value, q.typeInfo)
            : defaultValue,
          evidenceSentenceIndices: Array.isArray(payload?.evidence)
            ? payload.evidence.filter((n) => Number.isInteger(n))
            : [],
          polarity: getQuestionPolarity(q),
          scoredAnswers: normalizeScoringAnswerList(q.scoredAnswers),
          notScoredAnswers: normalizeScoringAnswerList(q.notScoredAnswers),
          hasExplicitScoringContract: q.hasExplicitScoringContract === true,
          source,
          confidence,
          fallbackReason,
          deterministicRuleInvalidValue: fallbackReason === 'rule_invalid_value'
            ? String(q?.ruleInvalidValue || '')
            : null,
          deterministicRuleLowConfidence: fallbackReason === 'rule_low_confidence'
            ? String(q?.ruleLowConfidence?.code || 'rule_low_confidence')
            : null,
          deterministicRuleLowConfidenceMeta: fallbackReason === 'rule_low_confidence'
            && q?.ruleLowConfidence
            && typeof q.ruleLowConfidence === 'object'
            ? (q.ruleLowConfidence.detail || null)
            : null,
          failureClass: source === 'ai_error'
            ? normalizeFailureClass(runtime?.failureClass) || 'unknown_runtime_error'
            : (mapFallbackReasonToFailureClass(fallbackReason) || null),
          recoverableFailure: source === 'ai_error'
            ? runtime?.recoverableFailure === true
            : null,
          errorSummary: source === 'ai_error' ? String(runtime?.errorSummary || '') : null,
          modelRequested: runtime?.modelRequested || null,
          modelUsed: runtime?.modelUsed || null,
          providerUsed: runtime?.providerUsed || null,
          apiProviderUsed: runtime?.apiProviderUsed || null,
          retryCount: Number(runtime?.retryCount || 0),
          fallbackUsed: runtime?.fallbackUsed === true,
          routingFallbackReason: runtime?.routingFallbackReason || null,
          rescuedByRetry: source !== 'ai_error' && runtime?.rescuedByRetry === true,
          rescuedByFallback: source !== 'ai_error' && runtime?.rescuedByFallback === true,
          deterministicRuleTrace: q?.deterministicRuleTrace || null
        };
      });
    };

    let totalAttemptCount = 0;
    let routeSwitchReason = null;
    let lastFailure = null;

    for (let routeIndex = 0; routeIndex < routePlan.length; routeIndex += 1) {
      throwIfAborted(abortSignal);
      const route = routePlan[routeIndex] || {};
      const routeModelId = normalizeOptionalModelId(route.modelId || fixedModelId);
      const routeProviderId = normalizeOptionalProviderId(route.providerId || providerId);
      const routeApiProviderId = normalizeOptionalApiProviderId(route.apiProviderId || apiProviderId);
      const routeKey = [
        routeModelId || '',
        routeProviderId || '',
        routeApiProviderId || '',
        JSON.stringify(genConfig),
        systemPrompt
      ].join('\n');
      const cacheKey = sha256(routeKey);
      const fallbackUsed = routeIndex > 0;

      if (cacheEnabled && _step4PromptCache.has(cacheKey)) {
        const cached = _step4PromptCache.get(cacheKey) || {};
        const runtimeMeta = {
          modelRequested: routeModelId || fixedModelId || null,
          modelUsed: routeModelId || fixedModelId || null,
          providerUsed: routeProviderId || null,
          apiProviderUsed: routeApiProviderId || null,
          retryCount: Math.max(0, totalAttemptCount - 1),
          fallbackUsed,
          routingFallbackReason: routeSwitchReason || null,
          rescuedByRetry: totalAttemptCount > 1,
          rescuedByFallback: fallbackUsed
        };
        const elapsedMs = Date.now() - batchStartMs;
        console.log(
          `[Step 4] Batch ${batchLabel} completed (cache) in ${elapsedMs}ms (attempts=${totalAttemptCount}, route=${route.routeLabel || 'primary'})`
        );
        return {
          results: buildBatchRows({
            source: 'ai_cache',
            confidence: 0.95,
            payloadByQuestion: cached,
            runtime: runtimeMeta
          }),
          prompt: systemPrompt
        };
      }

      const maxAttemptsForRoute = 1 + Number(retryPolicy?.retryLimit || 0);
      for (let attempt = 1; attempt <= maxAttemptsForRoute; attempt += 1) {
        throwIfAborted(abortSignal);
        totalAttemptCount += 1;
        const retryCount = Math.max(0, totalAttemptCount - 1);
        const requestLabelPrefix = `ielts.step4.batch.${idx}.${route.routeLabel || 'route'}.attempt${attempt}`;
        console.log(
          `[Step 4] Batch ${batchLabel} attempt ${attempt}/${maxAttemptsForRoute} (${route.routeLabel || 'primary'}) sending AI request...`
        );

        try {
          const { text, modelUsed, usage, requestMeta } = await aiService.sendMessage(
            [{ role: 'user', content: systemPrompt }],
            routeModelId,
            {
              ...genConfig,
              timeoutMs: aiTimeoutMs,
              requestLabel: `${requestLabelPrefix}.primary`,
              requestingUser,
              providerId: routeProviderId,
              apiProviderId: routeApiProviderId,
              abortSignal
            }
          );
          addUsage(usage);

          const effectiveModelUsed = normalizeOptionalModelId(modelUsed || requestMeta?.modelUsed || routeModelId || fixedModelId);
          if (effectiveModelUsed) capturedModels.add(effectiveModelUsed);

          if (requestMeta) {
            requestTrace.push({
              ...requestMeta,
              phase: 'primary',
              status: 'success',
              batchIndex: idx,
              criterion,
              routeLabel: route.routeLabel || (fallbackUsed ? 'fallback' : 'primary'),
              routeType: route.routeType || (fallbackUsed ? 'fallback' : 'primary'),
              attempt,
              totalAttempt: totalAttemptCount,
              retryCount,
              fallbackUsed,
              routingFallbackReason: routeSwitchReason || null,
              modelRequested: routeModelId || null,
              providerRequested: routeProviderId || null,
              apiProviderRequested: routeApiProviderId || null
            });
          }

          let jsonResponse = safeJsonParse(text);
          if (!jsonResponse) {
            throw new Error("JSON Parse Error");
          }

          let v = validateBatchJson(jsonResponse, batch);
          if (!v.ok) {
            const repairPrompt = buildRepairPrompt({
              missing: v.missing,
              invalid: v.invalid,
              batch,
              priorJson: jsonResponse
            });

            const repair = await aiService.sendMessage(
              [{ role: 'user', content: repairPrompt }],
              routeModelId,
              {
                ...genConfig,
                timeoutMs: aiTimeoutMs,
                requestLabel: `${requestLabelPrefix}.repair`,
                requestingUser,
                providerId: routeProviderId,
                apiProviderId: routeApiProviderId,
                abortSignal
              }
            );
            addUsage(repair?.usage);
            const repairModelUsed = normalizeOptionalModelId(repair?.modelUsed || repair?.requestMeta?.modelUsed || routeModelId || fixedModelId);
            if (repairModelUsed) capturedModels.add(repairModelUsed);

            if (repair?.requestMeta) {
              requestTrace.push({
                ...repair.requestMeta,
                phase: 'repair',
                status: 'success',
                batchIndex: idx,
                criterion,
                routeLabel: route.routeLabel || (fallbackUsed ? 'fallback' : 'primary'),
                routeType: route.routeType || (fallbackUsed ? 'fallback' : 'primary'),
                attempt,
                totalAttempt: totalAttemptCount,
                retryCount,
                fallbackUsed,
                routingFallbackReason: routeSwitchReason || null,
                modelRequested: routeModelId || null,
                providerRequested: routeProviderId || null,
                apiProviderRequested: routeApiProviderId || null
              });
            }

            const repaired = safeJsonParse(repair.text);
            if (repaired && typeof repaired === 'object') {
              jsonResponse = { ...(jsonResponse || {}), ...repaired };
            }

            v = validateBatchJson(jsonResponse, batch);
            if (!v.ok) {
              for (const q of batch) {
                const id = q.question_key;
                if (!jsonResponse[id] || typeof jsonResponse[id] !== 'object') {
                  jsonResponse[id] = { value: 'No', evidence: [] };
                }
                const allowed = getAllowedOptions(q.typeInfo);
                const val = String(jsonResponse[id].value ?? '').trim();
                if (allowed.length && !allowed.some((a) => a.toLowerCase() === val.toLowerCase())) {
                  const noOpt = allowed.find((a) => a.toLowerCase() === 'no');
                  jsonResponse[id].value = noOpt || allowed[0];
                }
                if (!Array.isArray(jsonResponse[id].evidence)) jsonResponse[id].evidence = [];
                jsonResponse[id].evidence = jsonResponse[id].evidence.filter((n) => Number.isInteger(n));
              }
            }
          }

          if (cacheEnabled) {
            _step4PromptCache.set(cacheKey, jsonResponse);
          }

          const runtimeMeta = {
            modelRequested: routeModelId || fixedModelId || null,
            modelUsed: effectiveModelUsed || routeModelId || fixedModelId || null,
            providerUsed: normalizeOptionalProviderId(requestMeta?.providerId || routeProviderId || null),
            apiProviderUsed: routeApiProviderId || null,
            retryCount,
            fallbackUsed,
            routingFallbackReason: routeSwitchReason || null,
            rescuedByRetry: retryCount > 0,
            rescuedByFallback: fallbackUsed
          };
          const elapsedMs = Date.now() - batchStartMs;
          console.log(
            `[Step 4] Batch ${batchLabel} completed (ai) in ${elapsedMs}ms (attempts=${totalAttemptCount}, route=${route.routeLabel || 'primary'})`
          );

          return {
            results: buildBatchRows({
              source: 'ai',
              confidence: 0.9,
              payloadByQuestion: jsonResponse,
              runtime: runtimeMeta
            }),
            prompt: systemPrompt
          };
        } catch (error) {
          if (isAbortLikeError(error)) {
            throw createAbortError('Step 4 grading was cancelled by user.');
          }
          const classification = classifyStep4Failure(error);
          const failureClass = classification.failureClass || 'unknown_runtime_error';
          if (failureClass === 'aborted') {
            throw createAbortError('Step 4 grading was cancelled by user.');
          }
          const recoverable = classification.recoverable === true;
          const errorSummary = toSafeErrorSummary(error);
          lastFailure = {
            failureClass,
            recoverable,
            errorSummary,
            modelRequested: routeModelId || fixedModelId || null,
            modelUsed: routeModelId || fixedModelId || null,
            providerUsed: routeProviderId || null,
            apiProviderUsed: routeApiProviderId || null,
            retryCount: Math.max(0, totalAttemptCount - 1),
            fallbackUsed,
            routingFallbackReason: routeSwitchReason || null
          };

          requestTrace.push({
            phase: 'primary',
            status: 'failed',
            batchIndex: idx,
            criterion,
            routeLabel: route.routeLabel || (fallbackUsed ? 'fallback' : 'primary'),
            routeType: route.routeType || (fallbackUsed ? 'fallback' : 'primary'),
            attempt,
            totalAttempt: totalAttemptCount,
            retryCount: lastFailure.retryCount,
            fallbackUsed,
            routingFallbackReason: routeSwitchReason || null,
            modelRequested: routeModelId || null,
            providerRequested: routeProviderId || null,
            apiProviderRequested: routeApiProviderId || null,
            failureClass,
            recoverable,
            errorSummary
          });

          console.warn(`[Step 4] Batch ${batchLabel} failed (${failureClass}) on ${route.routeLabel || 'primary'} attempt ${attempt}: ${errorSummary}`);
          const canRetrySameRoute = recoverable && attempt < maxAttemptsForRoute;
          if (canRetrySameRoute) {
            const delayMs = buildBackoffDelayMs(attempt, retryPolicy);
            if (delayMs > 0) await sleepMs(delayMs, abortSignal);
            continue;
          }
          break;
        }
      }

      const hasNextRoute = routeIndex < routePlan.length - 1;
      if (lastFailure?.recoverable === true && hasNextRoute) {
        routeSwitchReason = lastFailure.failureClass || 'unknown_runtime_error';
        continue;
      }
      break;
    }

    const runtimeMeta = {
      failureClass: lastFailure?.failureClass || 'unknown_runtime_error',
      recoverableFailure: lastFailure?.recoverable === true,
      errorSummary: lastFailure?.errorSummary || 'Unknown runtime error',
      modelRequested: lastFailure?.modelRequested || normalizeOptionalModelId(fixedModelId),
      modelUsed: lastFailure?.modelUsed || normalizeOptionalModelId(fixedModelId),
      providerUsed: lastFailure?.providerUsed || normalizeOptionalProviderId(providerId),
      apiProviderUsed: lastFailure?.apiProviderUsed || normalizeOptionalApiProviderId(apiProviderId),
      retryCount: Number(lastFailure?.retryCount || Math.max(0, totalAttemptCount - 1)),
      fallbackUsed: lastFailure?.fallbackUsed === true,
      routingFallbackReason: routeSwitchReason || null
    };
    const elapsedMs = Date.now() - batchStartMs;
    console.log(
      `[Step 4] Batch ${batchLabel} completed (ai_error) in ${elapsedMs}ms (attempts=${totalAttemptCount}, failure=${runtimeMeta.failureClass})`
    );

    return {
      results: buildBatchRows({
        source: 'ai_error',
        confidence: 0.0,
        payloadByQuestion: {},
        defaultValue: "Error",
        runtime: runtimeMeta
      }),
      prompt: systemPrompt + `\nError: ${runtimeMeta.errorSummary}`
    };
  };

  const CONCURRENCY = Math.max(1, Math.min(10, parseInt(options.concurrency || 3, 10) || 3));

  for (let i = 0; i < finalBatches.length; i += CONCURRENCY) {
    throwIfAborted(abortSignal);
    const chunk = finalBatches.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map((b, idx) => processBatch(b, i + idx)));
    chunkResults.forEach(r => {
      processed.push(...r.results);
      collectedPrompts.push(r.prompt);
    });
    if (i + CONCURRENCY < finalBatches.length) await sleepMs(1500, abortSignal);
  }

  return {
    results: processed,
    prompts: collectedPrompts,
    modelUsed: Array.from(capturedModels).filter(Boolean).join(', '),
    modelsUsed: Array.from(capturedModels).filter(Boolean),
    requestTrace,
    retryPolicy,
    routePlan,
    usageSummary: usageSummary.callCount > 0 ? usageSummary : null
  };
}

// ----------------------------------------------------------------
// BAND CALCULATION (explicit answer contract first, polarity fallback)
// ----------------------------------------------------------------

function calculateBandScores(results) {
  const finalScores = { overall: 0, criteria: {}, gateTrace: {} };
  const criteria = ['TR', 'CC', 'LR', 'GRA'];

  criteria.forEach(crit => {
    const critResults = results.filter(r => r.criterion === crit);
    const trace = {
      criterion: crit,
      availableBandGates: [],
      evaluatedGates: [],
      fallbackApplied: null,
      resultingCriterionScore: 0
    };

    if (!critResults.length) {
      finalScores.criteria[crit] = 0;
      finalScores.gateTrace[crit] = trace;
      return;
    }

    const bandGates = getSortedBandGates(critResults);
    if (!bandGates.length) {
      finalScores.criteria[crit] = 0;
      finalScores.gateTrace[crit] = trace;
      return;
    }
    trace.availableBandGates = bandGates.slice();

    // Sparse-band-safe progression:
    // Evaluate only real gates available in the current criterion rows.
    // Missing intermediate bands are NOT auto-credited as passed.
    let currentBand = bandGates[0];
    trace.evaluatedGates.push({
      band: bandGates[0],
      totalWeight: null,
      passedWeight: null,
      passRatio: null,
      status: 'baseline',
      resultingBandAfterGate: currentBand
    });

    for (let gateIdx = 1; gateIdx < bandGates.length; gateIdx++) {
      const b = bandGates[gateIdx];
      const bandQuestions = critResults.filter((q) => normalizeBandGate(q?.band) === b);
      if (!bandQuestions.length) continue;

      let totalWeight = 0;
      let passedWeight = 0;
      let evaluatedWeight = 0;
      let excludedUnevaluableWeight = 0;
      const rowChecks = [];

      bandQuestions.forEach(q => {
        const w = normalizeQuestionWeight(q.weight);
        const passResult = evaluateRowPassResult(q);
        const pass = passResult.pass;
        const evaluated = passResult.evaluated;
        const polarity = String(q.polarity || getQuestionPolarity(q)).toUpperCase();
        if (evaluated) {
          totalWeight += w;
          evaluatedWeight += w;
          if (pass) passedWeight += w;
        } else {
          excludedUnevaluableWeight += w;
        }

        rowChecks.push({
          baseKey: q.baseKey || q.question_key || q.instanceKey || '',
          instanceKey: q.instanceKey || q.question_key || q.baseKey || '',
          value: q.value,
          normalizedValue: passResult.normalizedValue || null,
          polarity,
          pass,
          evaluated,
          weight: w,
          source: q.source || null,
          scope: q.scope || 'essay',
          scoringMode: passResult.scoringMode,
          passRule: passResult.passRule,
          scoredAnswers: normalizeScoringAnswerList(q.scoredAnswers),
          notScoredAnswers: normalizeScoringAnswerList(q.notScoredAnswers),
          deterministicRuleTrace: q?.deterministicRuleTrace || null
        });
      });

      if (totalWeight === 0) {
        trace.evaluatedGates.push({
          band: b,
          totalWeight: roundMetric(totalWeight),
          passedWeight: roundMetric(passedWeight),
          evaluatedWeight: roundMetric(evaluatedWeight),
          excludedUnevaluableWeight: roundMetric(excludedUnevaluableWeight),
          passRatio: null,
          status: 'not_evaluable',
          resultingBandAfterGate: currentBand,
          rowChecks
        });
        continue;
      }
      const ratio = passedWeight / totalWeight;

      if (ratio >= 0.50) {
        currentBand = b;
        trace.evaluatedGates.push({
          band: b,
          totalWeight: roundMetric(totalWeight),
          passedWeight: roundMetric(passedWeight),
          evaluatedWeight: roundMetric(evaluatedWeight),
          excludedUnevaluableWeight: roundMetric(excludedUnevaluableWeight),
          passRatio: roundMetric(ratio),
          status: 'passed',
          resultingBandAfterGate: currentBand,
          rowChecks
        });
      } else {
        const fallback = ratio >= 0.35
          ? { type: 'minus_0_5', fromBand: b, resultingBand: b - 0.5 }
          : { type: 'minus_1_0', fromBand: b, resultingBand: b - 1 };
        currentBand = fallback.resultingBand;
        trace.fallbackApplied = fallback;
        trace.evaluatedGates.push({
          band: b,
          totalWeight: roundMetric(totalWeight),
          passedWeight: roundMetric(passedWeight),
          evaluatedWeight: roundMetric(evaluatedWeight),
          excludedUnevaluableWeight: roundMetric(excludedUnevaluableWeight),
          passRatio: roundMetric(ratio),
          status: ratio >= 0.35 ? 'partial' : 'failed',
          resultingBandAfterGate: currentBand,
          fallbackApplied: fallback,
          rowChecks
        });
        break;
      }
    }

    const criterionScore = Math.max(1, Math.min(9, currentBand));
    finalScores.criteria[crit] = criterionScore;
    trace.resultingCriterionScore = criterionScore;
    finalScores.gateTrace[crit] = trace;
  });

  const avg = Object.values(finalScores.criteria).reduce((a, b) => a + b, 0) / 4;
  finalScores.overall = Math.round(avg * 2) / 2;
  return finalScores;
}

module.exports = step3ScoringService;
