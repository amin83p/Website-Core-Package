// MVC/services/ielts/aiExtractionService.js
const crypto = require("crypto");
const { ExtractionSchema, EXTRACTION_SCHEMA_VERSION } = require("./extractionSchema");
const aiService = require("./aiService");
const { SchemaType } = require("@google/generative-ai");
const {
  buildStep3LanguageCalibrationGuide,
  applyLanguageEvidenceCalibrationGuards
} = require("./languageEvidenceCalibration");

// In-process cache: cacheKey -> { extraction, meta, executedPrompt }
const _extractionCache = new Map();

function normalizeStabilityProfile(value) {
  return String(value || "").trim().toLowerCase() === "strict" ? "strict" : "standard";
}

function buildExtractionProfileBlock(stabilityProfile) {
  const profile = normalizeStabilityProfile(stabilityProfile);
  if (profile === "strict") {
    return `
STABILITY PROFILE: STRICT
- Use explicit textual grounding only; avoid inferential leaps.
- Prefer precision over recall: include sentence indices only when directly supported by wording.
- If stance is implicit or mixed, prefer stance="unclear" with stanceSentenceIndex=null.
- For answersBySubquestion/bodySupport, do not include borderline indices.
- Keep outputs minimal and reproducible across repeated runs.
`.trim();
  }

  return `
STABILITY PROFILE: STANDARD
- Use direct textual grounding and reasonable examiner inference.
- Balance precision and recall for evidence coverage.
- If evidence is likely relevant, include it conservatively.
`.trim();
}

const LEGACY_LEXICAL_RANGE = ["basic", "adequate", "wide"];
const LEGACY_LEXICAL_PRECISION = ["low", "mixed", "high"];
const LEGACY_UNCOMMON_SKILL = ["none", "some", "skilful"];
const LEGACY_ERROR_PROFILE = ["rare", "occasional", "frequent"];

const LEXICAL_CONTROL_ENUMS = {
  rangeBand: ["limited", "adequate", "sufficient", "wide"],
  precisionBand: ["low", "mixed", "good", "high"],
  collocationControl: ["weak", "mixed", "good"],
  awkwardExpressionCountBand: ["none", "few", "some", "many"],
  spellingImpact: ["none", "minor", "some", "frequent"],
  wordFormationImpact: ["none", "minor", "some", "frequent"],
  repetitionImpact: ["none", "mild", "noticeable", "strong"],
  clarityImpactFromLexis: ["none", "minor", "some", "major"]
};

const GRAMMAR_CONTROL_ENUMS = {
  structureRange: ["simple_only", "mixed", "varied", "wide"],
  complexSentenceControl: ["weak", "mixed", "good"],
  errorFrequency: ["rare", "occasional", "noticeable", "frequent"],
  subjectVerbAgreement: ["strong", "mixed", "weak"],
  articleControl: ["strong", "mixed", "weak"],
  prepositionControl: ["strong", "mixed", "weak"],
  punctuationControl: ["strong", "mixed", "weak"],
  sentenceBoundaryControl: ["strong", "mixed", "weak"],
  clarityImpactFromGrammar: ["none", "minor", "some", "major"],
  errorFreeSentenceShareBand: ["very_low", "low", "moderate", "high"]
};

function pickEnumValue(value, allowed, fallback = null) {
  const token = String(value ?? "").trim().toLowerCase();
  if (!token) return fallback;
  return allowed.includes(token) ? token : fallback;
}

function normalizeLegacyLexicalQuality(raw) {
  if (!raw || typeof raw !== "object") return null;
  const range = pickEnumValue(raw.range, LEGACY_LEXICAL_RANGE, null);
  const precision = pickEnumValue(raw.precision, LEGACY_LEXICAL_PRECISION, null);
  const uncommonSkill = pickEnumValue(raw.uncommonSkill, LEGACY_UNCOMMON_SKILL, null);
  if (!range && !precision && !uncommonSkill) return null;
  return {
    range: range || "adequate",
    precision: precision || "mixed",
    uncommonSkill: uncommonSkill || "some"
  };
}

function normalizeLegacyErrorProfiles(raw) {
  if (!raw || typeof raw !== "object") return null;
  const grammar = pickEnumValue(raw.grammar, LEGACY_ERROR_PROFILE, null);
  const lexical = pickEnumValue(raw.lexical, LEGACY_ERROR_PROFILE, null);
  const punctuation = pickEnumValue(raw.punctuation, LEGACY_ERROR_PROFILE, null);
  if (!grammar && !lexical && !punctuation) return null;
  return {
    grammar: grammar || "occasional",
    lexical: lexical || "occasional",
    punctuation: punctuation || "occasional"
  };
}

function normalizeLexicalControl(raw) {
  if (!raw || typeof raw !== "object") return null;
  const hasAnySignal = Object.keys(LEXICAL_CONTROL_ENUMS).some((key) => String(raw[key] ?? "").trim() !== "");
  if (!hasAnySignal) return null;
  return {
    rangeBand: pickEnumValue(raw.rangeBand, LEXICAL_CONTROL_ENUMS.rangeBand, "adequate"),
    precisionBand: pickEnumValue(raw.precisionBand, LEXICAL_CONTROL_ENUMS.precisionBand, "mixed"),
    collocationControl: pickEnumValue(raw.collocationControl, LEXICAL_CONTROL_ENUMS.collocationControl, "mixed"),
    awkwardExpressionCountBand: pickEnumValue(raw.awkwardExpressionCountBand, LEXICAL_CONTROL_ENUMS.awkwardExpressionCountBand, "some"),
    spellingImpact: pickEnumValue(raw.spellingImpact, LEXICAL_CONTROL_ENUMS.spellingImpact, "minor"),
    wordFormationImpact: pickEnumValue(raw.wordFormationImpact, LEXICAL_CONTROL_ENUMS.wordFormationImpact, "minor"),
    repetitionImpact: pickEnumValue(raw.repetitionImpact, LEXICAL_CONTROL_ENUMS.repetitionImpact, "mild"),
    clarityImpactFromLexis: pickEnumValue(raw.clarityImpactFromLexis, LEXICAL_CONTROL_ENUMS.clarityImpactFromLexis, "minor")
  };
}

function normalizeGrammarControl(raw) {
  if (!raw || typeof raw !== "object") return null;
  const hasAnySignal = Object.keys(GRAMMAR_CONTROL_ENUMS).some((key) => String(raw[key] ?? "").trim() !== "");
  if (!hasAnySignal) return null;
  return {
    structureRange: pickEnumValue(raw.structureRange, GRAMMAR_CONTROL_ENUMS.structureRange, "mixed"),
    complexSentenceControl: pickEnumValue(raw.complexSentenceControl, GRAMMAR_CONTROL_ENUMS.complexSentenceControl, "mixed"),
    errorFrequency: pickEnumValue(raw.errorFrequency, GRAMMAR_CONTROL_ENUMS.errorFrequency, "occasional"),
    subjectVerbAgreement: pickEnumValue(raw.subjectVerbAgreement, GRAMMAR_CONTROL_ENUMS.subjectVerbAgreement, "mixed"),
    articleControl: pickEnumValue(raw.articleControl, GRAMMAR_CONTROL_ENUMS.articleControl, "mixed"),
    prepositionControl: pickEnumValue(raw.prepositionControl, GRAMMAR_CONTROL_ENUMS.prepositionControl, "mixed"),
    punctuationControl: pickEnumValue(raw.punctuationControl, GRAMMAR_CONTROL_ENUMS.punctuationControl, "mixed"),
    sentenceBoundaryControl: pickEnumValue(raw.sentenceBoundaryControl, GRAMMAR_CONTROL_ENUMS.sentenceBoundaryControl, "mixed"),
    clarityImpactFromGrammar: pickEnumValue(raw.clarityImpactFromGrammar, GRAMMAR_CONTROL_ENUMS.clarityImpactFromGrammar, "minor"),
    errorFreeSentenceShareBand: pickEnumValue(raw.errorFreeSentenceShareBand, GRAMMAR_CONTROL_ENUMS.errorFreeSentenceShareBand, "moderate")
  };
}

function mapLexicalQualityFromLexicalControl(lexicalControl) {
  if (!lexicalControl) return null;
  const rangeMap = {
    limited: "basic",
    adequate: "adequate",
    sufficient: "adequate",
    wide: "wide"
  };
  const precisionMap = {
    low: "low",
    mixed: "mixed",
    good: "high",
    high: "high"
  };
  const uncommonMap = {
    weak: "none",
    mixed: "some",
    good: "skilful"
  };
  return {
    range: rangeMap[lexicalControl.rangeBand] || "adequate",
    precision: precisionMap[lexicalControl.precisionBand] || "mixed",
    uncommonSkill: uncommonMap[lexicalControl.collocationControl] || "some"
  };
}

function mapErrorProfilesFromRichSignals({ grammarControl, lexicalControl }) {
  const grammarMap = {
    rare: "rare",
    occasional: "occasional",
    noticeable: "occasional",
    frequent: "frequent"
  };
  const punctuationMap = {
    strong: "rare",
    mixed: "occasional",
    weak: "frequent"
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
    ? "frequent"
    : lexicalImpactScore >= 2
      ? "occasional"
      : "rare";

  return {
    grammar: grammarMap[grammarControl?.errorFrequency] || "occasional",
    lexical: lexicalProfile,
    punctuation: punctuationMap[grammarControl?.punctuationControl] || "occasional"
  };
}

function mapLexicalControlFromLegacy(lexicalQuality, errorProfiles) {
  if (!lexicalQuality && !errorProfiles) return null;
  const rangeMap = {
    basic: "limited",
    adequate: "adequate",
    wide: "wide"
  };
  const precisionMap = {
    low: "low",
    mixed: "mixed",
    high: "high"
  };
  const collocationMap = {
    none: "weak",
    some: "mixed",
    skilful: "good"
  };
  const lexicalImpactMap = {
    rare: "minor",
    occasional: "some",
    frequent: "frequent"
  };
  const legacyLexical = normalizeLegacyLexicalQuality(lexicalQuality) || {
    range: "adequate",
    precision: "mixed",
    uncommonSkill: "some"
  };
  const legacyErrors = normalizeLegacyErrorProfiles(errorProfiles) || {
    grammar: "occasional",
    lexical: "occasional",
    punctuation: "occasional"
  };
  return {
    rangeBand: rangeMap[legacyLexical.range] || "adequate",
    precisionBand: precisionMap[legacyLexical.precision] || "mixed",
    collocationControl: collocationMap[legacyLexical.uncommonSkill] || "mixed",
    awkwardExpressionCountBand: legacyLexical.precision === "low" ? "many" : (legacyLexical.precision === "high" ? "few" : "some"),
    spellingImpact: lexicalImpactMap[legacyErrors.lexical] || "some",
    wordFormationImpact: lexicalImpactMap[legacyErrors.lexical] || "some",
    repetitionImpact: legacyLexical.range === "basic" ? "strong" : (legacyLexical.range === "wide" ? "none" : "mild"),
    clarityImpactFromLexis:
      legacyErrors.lexical === "frequent" || legacyLexical.precision === "low"
        ? "some"
        : (legacyErrors.lexical === "rare" && legacyLexical.precision === "high" ? "none" : "minor")
  };
}

function mapGrammarControlFromLegacy(errorProfiles) {
  const legacyErrors = normalizeLegacyErrorProfiles(errorProfiles);
  if (!legacyErrors) return null;
  const grammar = legacyErrors.grammar;
  const punctuation = legacyErrors.punctuation;
  const controlMap = {
    rare: "strong",
    occasional: "mixed",
    frequent: "weak"
  };
  const structureRangeMap = {
    rare: "varied",
    occasional: "mixed",
    frequent: "simple_only"
  };
  const complexMap = {
    rare: "good",
    occasional: "mixed",
    frequent: "weak"
  };
  const clarityMap = {
    rare: "none",
    occasional: "minor",
    frequent: "some"
  };
  const errorFreeShareMap = {
    rare: "high",
    occasional: "moderate",
    frequent: "low"
  };
  return {
    structureRange: structureRangeMap[grammar] || "mixed",
    complexSentenceControl: complexMap[grammar] || "mixed",
    errorFrequency: grammar || "occasional",
    subjectVerbAgreement: controlMap[grammar] || "mixed",
    articleControl: controlMap[grammar] || "mixed",
    prepositionControl: controlMap[grammar] || "mixed",
    punctuationControl: controlMap[punctuation] || "mixed",
    sentenceBoundaryControl: controlMap[punctuation] || "mixed",
    clarityImpactFromGrammar: clarityMap[grammar] || "minor",
    errorFreeSentenceShareBand: errorFreeShareMap[grammar] || "moderate"
  };
}

function harmonizeLanguageSignals(parsed = {}) {
  const legacyLexicalQuality = normalizeLegacyLexicalQuality(parsed?.lexicalQuality);
  const legacyErrorProfiles = normalizeLegacyErrorProfiles(parsed?.errorProfiles);
  const richLexicalInput = normalizeLexicalControl(parsed?.lexicalControl);
  const richGrammarInput = normalizeGrammarControl(parsed?.grammarControl);
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
    ? (mapErrorProfilesFromRichSignals({ grammarControl, lexicalControl }) || legacyErrorProfiles)
    : (legacyErrorProfiles || mapErrorProfilesFromRichSignals({ grammarControl, lexicalControl }));

  if (!lexicalControl) lexicalControl = mapLexicalControlFromLegacy(lexicalQuality, errorProfiles);
  if (!grammarControl) grammarControl = mapGrammarControlFromLegacy(errorProfiles);

  return {
    lexicalQuality: lexicalQuality || undefined,
    errorProfiles: errorProfiles || undefined,
    lexicalControl: lexicalControl || undefined,
    grammarControl: grammarControl || undefined,
    calibration
  };
}

// ---------------------------
// 1) Task 2 prompt parser
// ---------------------------
function prepareTask2Prompt(promptText) {
  const text = String(promptText ?? "").replace(/\r\n?/g, "\n").trim();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const questions = lines.filter((l) => l.endsWith("?"));
  const subquestion_keys = questions.length
    ? questions.map((q, i) => {
        const slug = q
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "");
        return `q${i + 1}_${slug}`;
      })
    : ["q1_task_response"];

  return {
    task: "IELTS_Writing_Task_2",
    prompt_verbatim: text,
    subquestion_keys
  };
}

// ---------------------------
// 2) Prompt builder
// ---------------------------
function buildExtractionPrompt({ taskDefinition, essayObj, paragraphRoles, stabilityProfile = "standard" }) {
  const maxSentIdx = Math.max(0, (essayObj?.sentences?.length ?? 1) - 1);
  const roles = (paragraphRoles || []).map((r, i) => `P${i}=${r}`).join(", ");
  const profileBlock = buildExtractionProfileBlock(stabilityProfile);
  const calibrationGuide = buildStep3LanguageCalibrationGuide();

  const sentencesBlock = (essayObj.sentences ?? [])
    .map((s) => `P${s.paragraphIndex} S${s.index}: ${s.text}`)
    .join("\n");

  const keysTemplate = (taskDefinition.subquestion_keys ?? [])
    .map((k) => `    "${k}": []`)
    .join(",\n");

  const topicTemplate = (paragraphRoles || [])
    .map((_, idx) => `    { "paragraphIndex": ${idx}, "topicSentenceIndex": null }`)
    .join(",\n");

  return `
You are an IELTS Writing Task 2 examiner assistant.

Goal: EXTRACT evidence ONLY (sentence indices). Do NOT score bands and do NOT rewrite the essay.

TASK DEFINITION:
${JSON.stringify(taskDefinition, null, 2)}

ESSAY CONTEXT (Paragraph Roles):
${roles}

ESSAY SENTENCES:
${sentencesBlock}

STANCE DECISION RULES (use ONLY the essay text):
- "agree": the writer clearly supports one side AND does not present a balanced two-sided position as their main stance.
- "disagree": the writer clearly rejects one side / supports the opposite.
- "partial": the writer explicitly supports a balanced position, concession, or "both sides" as their stance (not just giving an example).
- "unclear": no clear position is stated.

IMPORTANT:
- stanceSentenceIndex MUST point to the ONE sentence that most clearly expresses the stance. If none, set null and stance="unclear".
- contradictionSentenceIndices should include ONLY sentences that contradict the main stance (if any). Otherwise [].

${profileBlock}

LR / GRA STRUCTURED LABELS (REQUIRED):
- lexicalControl.rangeBand: limited | adequate | sufficient | wide
- lexicalControl.precisionBand: low | mixed | good | high
- lexicalControl.collocationControl: weak | mixed | good
- lexicalControl.awkwardExpressionCountBand: none | few | some | many
- lexicalControl.spellingImpact: none | minor | some | frequent
- lexicalControl.wordFormationImpact: none | minor | some | frequent
- lexicalControl.repetitionImpact: none | mild | noticeable | strong
- lexicalControl.clarityImpactFromLexis: none | minor | some | major
- grammarControl.structureRange: simple_only | mixed | varied | wide
- grammarControl.complexSentenceControl: weak | mixed | good
- grammarControl.errorFrequency: rare | occasional | noticeable | frequent
- grammarControl.subjectVerbAgreement: strong | mixed | weak
- grammarControl.articleControl: strong | mixed | weak
- grammarControl.prepositionControl: strong | mixed | weak
- grammarControl.punctuationControl: strong | mixed | weak
- grammarControl.sentenceBoundaryControl: strong | mixed | weak
- grammarControl.clarityImpactFromGrammar: none | minor | some | major
- grammarControl.errorFreeSentenceShareBand: very_low | low | moderate | high

${calibrationGuide}

REQUIRED JSON (EXAMPLE SHAPE):
{
  "position": {
    "stance": "unclear",
    "stanceSentenceIndex": null,
    "contradictionSentenceIndices": []
  },
  "answersBySubquestion": {
${keysTemplate}
  },
  "bodySupport": [],
  "topicSentenceByParagraph": [
${topicTemplate}
  ],
  "lexicalQuality": {
    "range": "basic",
    "precision": "low",
    "uncommonSkill": "none"
  },
  "errorProfiles": {
    "grammar": "frequent",
    "lexical": "frequent",
    "punctuation": "frequent"
  },
  "lexicalControl": {
    "rangeBand": "limited",
    "precisionBand": "low",
    "collocationControl": "weak",
    "awkwardExpressionCountBand": "many",
    "spellingImpact": "frequent",
    "wordFormationImpact": "frequent",
    "repetitionImpact": "strong",
    "clarityImpactFromLexis": "major"
  },
  "grammarControl": {
    "structureRange": "simple_only",
    "complexSentenceControl": "weak",
    "errorFrequency": "frequent",
    "subjectVerbAgreement": "weak",
    "articleControl": "weak",
    "prepositionControl": "weak",
    "punctuationControl": "weak",
    "sentenceBoundaryControl": "weak",
    "clarityImpactFromGrammar": "major",
    "errorFreeSentenceShareBand": "very_low"
  }
}

Rules:
1) Return JSON only (no markdown, no backticks, no commentary).
2) stance MUST be one of: "agree", "disagree", "partial", "unclear".
3) stanceSentenceIndex MUST be [0..${maxSentIdx}] or null.
4) All sentence indices MUST be [0..${maxSentIdx}].
5) lexicalControl and grammarControl MUST use only the label sets above.
6) Be conservative: if you are unsure, choose "unclear" and use null/[] indices.
`.trim();
}

function buildStep3PromptTemplateContext({ taskDefinition, essayObj, paragraphRoles, stabilityProfile = "standard" }) {
  const maxSentIdx = Math.max(0, (essayObj?.sentences?.length ?? 1) - 1);
  const profileBlock = buildExtractionProfileBlock(stabilityProfile);
  const calibrationGuide = buildStep3LanguageCalibrationGuide();
  const sentencesBlock = (essayObj?.sentences ?? [])
    .map((s) => `P${s.paragraphIndex} S${s.index}: ${s.text}`)
    .join("\n");
  const keysTemplate = (taskDefinition?.subquestion_keys ?? [])
    .map((k) => `    "${k}": []`)
    .join(",\n");
  const topicTemplate = (paragraphRoles || [])
    .map((_, idx) => `    { "paragraphIndex": ${idx}, "topicSentenceIndex": null }`)
    .join(",\n");
  const roleMap = (paragraphRoles || []).map((r, i) => `P${i}=${r}`).join(", ");
  const essayText = String(
    essayObj?.normalizedText ||
    essayObj?.text ||
    (Array.isArray(essayObj?.sentences) ? essayObj.sentences.map((s) => String(s?.text || "")).join(" ") : "")
  ).trim();
  const taskPrompt = String(taskDefinition?.prompt_verbatim || "").trim();

  return {
    task_definition_json: JSON.stringify(taskDefinition || {}, null, 2),
    paragraph_roles_map: roleMap,
    essay_sentences_block: sentencesBlock,
    sentence_block: sentencesBlock,
    profile_prompt_block: profileBlock,
    subquestion_keys_template: keysTemplate,
    topic_sentence_template: topicTemplate,
    max_sentence_index: String(maxSentIdx),
    essay_text: essayText,
    task_prompt: taskPrompt,
    question: taskPrompt,
    criteria: "",
    lr_gra_label_guide: [
      'lexicalControl.rangeBand: limited|adequate|sufficient|wide',
      'lexicalControl.precisionBand: low|mixed|good|high',
      'lexicalControl.collocationControl: weak|mixed|good',
      'lexicalControl.awkwardExpressionCountBand: none|few|some|many',
      'lexicalControl.spellingImpact: none|minor|some|frequent',
      'lexicalControl.wordFormationImpact: none|minor|some|frequent',
      'lexicalControl.repetitionImpact: none|mild|noticeable|strong',
      'lexicalControl.clarityImpactFromLexis: none|minor|some|major',
      'grammarControl.structureRange: simple_only|mixed|varied|wide',
      'grammarControl.complexSentenceControl: weak|mixed|good',
      'grammarControl.errorFrequency: rare|occasional|noticeable|frequent',
      'grammarControl.subjectVerbAgreement: strong|mixed|weak',
      'grammarControl.articleControl: strong|mixed|weak',
      'grammarControl.prepositionControl: strong|mixed|weak',
      'grammarControl.punctuationControl: strong|mixed|weak',
      'grammarControl.sentenceBoundaryControl: strong|mixed|weak',
      'grammarControl.clarityImpactFromGrammar: none|minor|some|major',
      'grammarControl.errorFreeSentenceShareBand: very_low|low|moderate|high'
    ].join('\n'),
    lr_gra_calibration_guide: calibrationGuide
  };
}

function renderStep3PromptTemplate(templateContent, context = {}) {
  return String(templateContent || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = context[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

function buildExtractionPromptFromTemplate({ templateContent, taskDefinition, essayObj, paragraphRoles, stabilityProfile = "standard" }) {
  const context = buildStep3PromptTemplateContext({
    taskDefinition,
    essayObj,
    paragraphRoles,
    stabilityProfile
  });
  return renderStep3PromptTemplate(templateContent, context).trim();
}

// ---------------------------
// 3) Gemini response schema
// ---------------------------
function generateGeminiSchema(subquestionKeys) {
  const subQProperties = {};
  for (const key of subquestionKeys) {
    subQProperties[key] = {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.INTEGER }
    };
  }

  return {
    type: SchemaType.OBJECT,
    properties: {
      position: {
        type: SchemaType.OBJECT,
        properties: {
          stance: { type: SchemaType.STRING, enum: ["agree", "disagree", "partial", "unclear"] },
          stanceSentenceIndex: { type: SchemaType.INTEGER, nullable: true },
          contradictionSentenceIndices: { type: SchemaType.ARRAY, items: { type: SchemaType.INTEGER } }
        },
        required: ["stance", "stanceSentenceIndex", "contradictionSentenceIndices"]
      },
      answersBySubquestion: {
        type: SchemaType.OBJECT,
        properties: subQProperties,
        required: subquestionKeys
      },
      bodySupport: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            paragraphIndex: { type: SchemaType.INTEGER },
            hasExplanation: { type: SchemaType.BOOLEAN },
            hasExample: { type: SchemaType.BOOLEAN },
            evidenceSentenceIndices: { type: SchemaType.ARRAY, items: { type: SchemaType.INTEGER } }
          },
          required: ["paragraphIndex", "hasExplanation", "hasExample", "evidenceSentenceIndices"]
        }
      },
      topicSentenceByParagraph: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            paragraphIndex: { type: SchemaType.INTEGER },
            topicSentenceIndex: { type: SchemaType.INTEGER, nullable: true }
          },
          required: ["paragraphIndex", "topicSentenceIndex"]
        }
      },
      lexicalQuality: {
        type: SchemaType.OBJECT,
        properties: {
          range: { type: SchemaType.STRING, enum: ["basic", "adequate", "wide"] },
          precision: { type: SchemaType.STRING, enum: ["low", "mixed", "high"] },
          uncommonSkill: { type: SchemaType.STRING, enum: ["none", "some", "skilful"] }
        },
        required: ["range", "precision", "uncommonSkill"]
      },
      errorProfiles: {
        type: SchemaType.OBJECT,
        properties: {
          grammar: { type: SchemaType.STRING, enum: ["rare", "occasional", "frequent"] },
          lexical: { type: SchemaType.STRING, enum: ["rare", "occasional", "frequent"] },
          punctuation: { type: SchemaType.STRING, enum: ["rare", "occasional", "frequent"] }
        },
        required: ["grammar", "lexical", "punctuation"]
      },
      lexicalControl: {
        type: SchemaType.OBJECT,
        properties: {
          rangeBand: { type: SchemaType.STRING, enum: ["limited", "adequate", "sufficient", "wide"] },
          precisionBand: { type: SchemaType.STRING, enum: ["low", "mixed", "good", "high"] },
          collocationControl: { type: SchemaType.STRING, enum: ["weak", "mixed", "good"] },
          awkwardExpressionCountBand: { type: SchemaType.STRING, enum: ["none", "few", "some", "many"] },
          spellingImpact: { type: SchemaType.STRING, enum: ["none", "minor", "some", "frequent"] },
          wordFormationImpact: { type: SchemaType.STRING, enum: ["none", "minor", "some", "frequent"] },
          repetitionImpact: { type: SchemaType.STRING, enum: ["none", "mild", "noticeable", "strong"] },
          clarityImpactFromLexis: { type: SchemaType.STRING, enum: ["none", "minor", "some", "major"] }
        },
        required: [
          "rangeBand",
          "precisionBand",
          "collocationControl",
          "awkwardExpressionCountBand",
          "spellingImpact",
          "wordFormationImpact",
          "repetitionImpact",
          "clarityImpactFromLexis"
        ]
      },
      grammarControl: {
        type: SchemaType.OBJECT,
        properties: {
          structureRange: { type: SchemaType.STRING, enum: ["simple_only", "mixed", "varied", "wide"] },
          complexSentenceControl: { type: SchemaType.STRING, enum: ["weak", "mixed", "good"] },
          errorFrequency: { type: SchemaType.STRING, enum: ["rare", "occasional", "noticeable", "frequent"] },
          subjectVerbAgreement: { type: SchemaType.STRING, enum: ["strong", "mixed", "weak"] },
          articleControl: { type: SchemaType.STRING, enum: ["strong", "mixed", "weak"] },
          prepositionControl: { type: SchemaType.STRING, enum: ["strong", "mixed", "weak"] },
          punctuationControl: { type: SchemaType.STRING, enum: ["strong", "mixed", "weak"] },
          sentenceBoundaryControl: { type: SchemaType.STRING, enum: ["strong", "mixed", "weak"] },
          clarityImpactFromGrammar: { type: SchemaType.STRING, enum: ["none", "minor", "some", "major"] },
          errorFreeSentenceShareBand: { type: SchemaType.STRING, enum: ["very_low", "low", "moderate", "high"] }
        },
        required: [
          "structureRange",
          "complexSentenceControl",
          "errorFrequency",
          "subjectVerbAgreement",
          "articleControl",
          "prepositionControl",
          "punctuationControl",
          "sentenceBoundaryControl",
          "clarityImpactFromGrammar",
          "errorFreeSentenceShareBand"
        ]
      }
    },
    required: [
      "position",
      "answersBySubquestion",
      "bodySupport",
      "topicSentenceByParagraph",
      "lexicalQuality",
      "errorProfiles",
      "lexicalControl",
      "grammarControl"
    ]
  };
}

// ---------------------------
// 4) Parser & Validation
// ---------------------------
function getJsonParseErrorPosition(error) {
  const msg = String(error?.message || "");
  const match = msg.match(/position\s+(\d+)/i);
  if (!match) return null;
  const pos = Number(match[1]);
  return Number.isInteger(pos) && pos >= 0 ? pos : null;
}

function extractJsonParseContext(text, position, radius = 70) {
  const source = String(text ?? "");
  if (!source) return "";
  if (!Number.isInteger(position) || position < 0 || position >= source.length) {
    return source.slice(0, Math.min(140, source.length)).replace(/\s+/g, " ");
  }
  const start = Math.max(0, position - radius);
  const end = Math.min(source.length, position + radius);
  return source.slice(start, end).replace(/\s+/g, " ");
}

function normalizeJsonCandidateText(text) {
  return String(text ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\u00A0/g, " ")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function removeTrailingCommas(text) {
  return String(text ?? "").replace(/,\s*([}\]])/g, "$1");
}

function appendMissingClosers(text) {
  const source = String(text ?? "");
  const stack = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }
    if (ch === "}" || ch === "]") {
      const last = stack[stack.length - 1];
      const closesLast = (ch === "}" && last === "{") || (ch === "]" && last === "[");
      if (closesLast) stack.pop();
    }
  }

  if (!stack.length) return source;
  const closers = stack.reverse().map((open) => (open === "{" ? "}" : "]")).join("");
  return `${source}${closers}`;
}

function findPrevNonWhitespaceIndex(text, fromIndex) {
  for (let i = fromIndex; i >= 0; i -= 1) {
    if (!/\s/.test(text[i])) return i;
  }
  return -1;
}

function findNextNonWhitespaceIndex(text, fromIndex) {
  for (let i = fromIndex; i < text.length; i += 1) {
    if (!/\s/.test(text[i])) return i;
  }
  return -1;
}

function isLikelyJsonValueEnd(ch) {
  return /["\]}\d]|[a-zA-Z]/.test(String(ch || ""));
}

function isLikelyJsonValueStart(ch) {
  return /["[{\-0-9tfn]/i.test(String(ch || ""));
}

function buildCommaInsertionRepairs(text, errorPosition) {
  const source = String(text ?? "");
  if (!source || !Number.isInteger(errorPosition)) return [];

  const repairs = [];
  const seen = new Set();
  const insertionSeeds = [errorPosition, errorPosition - 1, errorPosition + 1];

  for (const seed of insertionSeeds) {
    if (!Number.isInteger(seed) || seed < 0 || seed >= source.length) continue;
    const prevIdx = findPrevNonWhitespaceIndex(source, seed - 1);
    const nextIdx = findNextNonWhitespaceIndex(source, seed);
    if (prevIdx < 0 || nextIdx < 0) continue;

    const prev = source[prevIdx];
    const next = source[nextIdx];
    if (prev === "," || next === "," || prev === "[" || prev === "{" || next === "]" || next === "}") {
      continue;
    }
    if (!isLikelyJsonValueEnd(prev) || !isLikelyJsonValueStart(next)) continue;

    const repaired = `${source.slice(0, nextIdx)},${source.slice(nextIdx)}`;
    if (seen.has(repaired)) continue;
    seen.add(repaired);
    repairs.push({
      label: `insert_missing_comma_at_${nextIdx}`,
      text: repaired
    });
  }

  return repairs;
}

function extractJsonCandidates(rawText) {
  const source = String(rawText ?? "");
  const out = [];
  const seen = new Set();
  const push = (label, value) => {
    const text = String(value ?? "").trim();
    if (!text) return;
    if (seen.has(text)) return;
    seen.add(text);
    out.push({ label, text });
  };

  const fencedRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let match;
  while ((match = fencedRegex.exec(source)) !== null) {
    push("markdown_fence", match[1]);
  }

  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    push("brace_slice", source.slice(start, end + 1));
  }

  push("raw_text", source);
  return out;
}

function safeJsonParse(text) {
  const candidates = extractJsonCandidates(text);
  if (!candidates.length) {
    const err = new Error(`No JSON object found in response: ${String(text ?? "").substring(0, 80)}...`);
    err.code = "STEP3_JSON_PARSE_ERROR";
    throw err;
  }

  let lastError = null;
  let lastDiagnostics = null;

  for (const candidate of candidates) {
    const normalized = normalizeJsonCandidateText(candidate.text);
    const attemptSet = [];
    const seenAttempts = new Set();
    const addAttempt = (repairStrategy, attemptText) => {
      const value = String(attemptText ?? "");
      if (!value || seenAttempts.has(value)) return;
      seenAttempts.add(value);
      attemptSet.push({ repairStrategy, text: value });
    };

    addAttempt("none", candidate.text);
    addAttempt("normalize_unicode", normalized);
    addAttempt("remove_trailing_commas", removeTrailingCommas(normalized));
    addAttempt("append_missing_closers", appendMissingClosers(normalized));
    addAttempt(
      "remove_trailing_commas_and_append_missing_closers",
      appendMissingClosers(removeTrailingCommas(normalized))
    );

    for (const attempt of attemptSet) {
      try {
        const value = JSON.parse(attempt.text);
        return {
          value,
          parseDiagnostics: {
            source: candidate.label,
            repairStrategy: attempt.repairStrategy,
            repaired: attempt.repairStrategy !== "none",
            candidateLength: attempt.text.length
          }
        };
      } catch (error) {
        lastError = error;
        const position = getJsonParseErrorPosition(error);
        lastDiagnostics = {
          source: candidate.label,
          repairStrategy: attempt.repairStrategy,
          parseError: String(error?.message || "JSON parse error"),
          errorPosition: position,
          errorContext: extractJsonParseContext(attempt.text, position)
        };

        const commaRepairs = buildCommaInsertionRepairs(attempt.text, position);
        for (const commaRepair of commaRepairs) {
          try {
            const value = JSON.parse(commaRepair.text);
            return {
              value,
              parseDiagnostics: {
                source: candidate.label,
                repairStrategy: `${attempt.repairStrategy}+${commaRepair.label}`,
                repaired: true,
                candidateLength: commaRepair.text.length
              }
            };
          } catch (commaError) {
            lastError = commaError;
            const commaPos = getJsonParseErrorPosition(commaError);
            lastDiagnostics = {
              source: candidate.label,
              repairStrategy: `${attempt.repairStrategy}+${commaRepair.label}`,
              parseError: String(commaError?.message || "JSON parse error"),
              errorPosition: commaPos,
              errorContext: extractJsonParseContext(commaRepair.text, commaPos)
            };
          }
        }
      }
    }
  }

  const details = lastDiagnostics
    ? ` source=${lastDiagnostics.source}; strategy=${lastDiagnostics.repairStrategy}; position=${lastDiagnostics.errorPosition ?? "unknown"}; context="${lastDiagnostics.errorContext || ""}"`
    : "";
  const err = new Error(`Failed to parse Step 3 extraction JSON. ${String(lastError?.message || "Unknown parse error")}.${details}`);
  err.code = "STEP3_JSON_PARSE_ERROR";
  if (lastDiagnostics) err.parseDiagnostics = lastDiagnostics;
  throw err;
}

function validateExtractionLogic(parsed, essayObj, paragraphRoles, expectedKeys) {
  if (!parsed.position) throw new Error("Missing 'position' object");
  if (!parsed.answersBySubquestion) throw new Error("Missing 'answersBySubquestion'");

  // Optional extra checks for stance consistency
  if (parsed.position.stance === "unclear") {
    if (parsed.position.stanceSentenceIndex !== null) {
      throw new Error("stanceSentenceIndex must be null when stance is 'unclear'");
    }
  }

  // Step 3 must stay extraction-only: reject direct scoring/band payload leakage.
  assertNoBandScoringFields(parsed);
}

function assertNoBandScoringFields(obj, parentPath = "") {
  if (!obj || typeof obj !== "object") return;

  const forbiddenKeyRegex = /^(overall_?band(?:_?score)?|criterion_?band|band(?:_?score)?|overall_?score|overall_?rating|score|scores|rating|ratings|criterion_?scores?)$/i;
  for (const [k, v] of Object.entries(obj)) {
    const path = parentPath ? `${parentPath}.${k}` : k;
    if (forbiddenKeyRegex.test(String(k || "").trim())) {
      throw new Error(`Step 3 extraction must be evidence-only. Forbidden scoring field found: '${path}'`);
    }
    if (v && typeof v === "object") {
      assertNoBandScoringFields(v, path);
    }
  }
}

function sanitizeSentenceIndexList(list, maxSentIdx) {
  const out = [];
  const seen = new Set();
  for (const v of (Array.isArray(list) ? list : [])) {
    const n = Number(v);
    if (!Number.isInteger(n)) continue;
    if (n < 0 || n > maxSentIdx) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  out.sort((a, b) => a - b);
  return out;
}

function sanitizeTopicSentenceIndex(value, maxSentIdx) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  if (n < 0 || n > maxSentIdx) return null;
  return n;
}

function sanitizeEvidenceExtraction(parsed, essayObj, paragraphRoles, expectedKeys) {
  const maxSentIdx = Math.max(0, (essayObj?.sentences?.length ?? 1) - 1);
  const paragraphCount = paragraphRoles?.length ?? essayObj?.paragraphs?.length ?? 0;

  const stanceSentenceIndex = sanitizeTopicSentenceIndex(parsed?.position?.stanceSentenceIndex, maxSentIdx);
  const contradictionSentenceIndices = sanitizeSentenceIndexList(
    parsed?.position?.contradictionSentenceIndices,
    maxSentIdx
  );

  const answersBySubquestion = {};
  for (const key of (Array.isArray(expectedKeys) ? expectedKeys : [])) {
    answersBySubquestion[key] = sanitizeSentenceIndexList(parsed?.answersBySubquestion?.[key], maxSentIdx);
  }

  const bodySupport = (Array.isArray(parsed?.bodySupport) ? parsed.bodySupport : [])
    .map((item) => {
      const paragraphIndex = Number(item?.paragraphIndex);
      if (!Number.isInteger(paragraphIndex)) return null;
      if (paragraphIndex < 0 || paragraphIndex >= paragraphCount) return null;
      return {
        paragraphIndex,
        hasExplanation: Boolean(item?.hasExplanation),
        hasExample: Boolean(item?.hasExample),
        evidenceSentenceIndices: sanitizeSentenceIndexList(item?.evidenceSentenceIndices, maxSentIdx)
      };
    })
    .filter(Boolean);

  const topicMap = new Map();
  for (const row of (Array.isArray(parsed?.topicSentenceByParagraph) ? parsed.topicSentenceByParagraph : [])) {
    const paragraphIndex = Number(row?.paragraphIndex);
    if (!Number.isInteger(paragraphIndex)) continue;
    if (paragraphIndex < 0 || paragraphIndex >= paragraphCount) continue;
    topicMap.set(paragraphIndex, sanitizeTopicSentenceIndex(row?.topicSentenceIndex, maxSentIdx));
  }
  const topicSentenceByParagraph = [];
  for (let paragraphIndex = 0; paragraphIndex < paragraphCount; paragraphIndex++) {
    topicSentenceByParagraph.push({
      paragraphIndex,
      topicSentenceIndex: topicMap.has(paragraphIndex) ? topicMap.get(paragraphIndex) : null
    });
  }

  const extraction = {
    position: {
      stance: parsed?.position?.stance || "unclear",
      stanceSentenceIndex,
      contradictionSentenceIndices
    },
    answersBySubquestion,
    bodySupport,
    topicSentenceByParagraph
  };

  // Keep backward compatibility while exposing richer LR/GRA evidence.
  const languageSignals = harmonizeLanguageSignals(parsed || {});
  if (languageSignals.lexicalQuality) extraction.lexicalQuality = languageSignals.lexicalQuality;
  if (languageSignals.errorProfiles) extraction.errorProfiles = languageSignals.errorProfiles;
  if (languageSignals.lexicalControl) extraction.lexicalControl = languageSignals.lexicalControl;
  if (languageSignals.grammarControl) extraction.grammarControl = languageSignals.grammarControl;

  return {
    extraction,
    languageCalibration: languageSignals.calibration || {
      applied: false,
      adjustmentCount: 0,
      adjustments: []
    }
  };
}

function sha256(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
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

const wait = (ms, abortSignal = null) => new Promise((resolve, reject) => {
  const delay = Number(ms) > 0 ? Number(ms) : 0;
  if (!abortSignal) {
    setTimeout(resolve, delay);
    return;
  }
  if (abortSignal.aborted) {
    const err = new Error('Step 3 extraction was cancelled.');
    err.name = 'AbortError';
    err.code = 'RUN_CANCELLED';
    reject(err);
    return;
  }
  const timer = setTimeout(() => {
    abortSignal.removeEventListener('abort', onAbort);
    resolve();
  }, delay);
  function onAbort() {
    clearTimeout(timer);
    abortSignal.removeEventListener('abort', onAbort);
    const err = new Error('Step 3 extraction was cancelled.');
    err.name = 'AbortError';
    err.code = 'RUN_CANCELLED';
    reject(err);
  }
  abortSignal.addEventListener('abort', onAbort, { once: true });
});

// ---------------------------
// MAIN EXECUTION
// ---------------------------
async function runAiExtraction({
  essayObj,
  samplePrompt,
  paragraphRoles,
  customPrompt = null,
  model = null,
  maxOutputTokens = 8192,
  retries = 3,
  disableCache = false,
  stabilityProfile = "standard",
  aiTimeoutMs = 75000,
  requestingUser = null,
  providerId = null,
  apiProviderId = null,
  abortSignal = null
}) {
  const shouldUseCache = !(
    disableCache === true ||
    String(disableCache || "").trim().toLowerCase() === "true"
  );
  const taskDefinition = prepareTask2Prompt(samplePrompt);
  const subkeys = taskDefinition.subquestion_keys;

  const normalizedProfile = normalizeStabilityProfile(stabilityProfile);
  const prompt = String(customPrompt || "").trim()
    ? String(customPrompt || "").trim()
    : buildExtractionPrompt({ taskDefinition, essayObj, paragraphRoles, stabilityProfile: normalizedProfile });
  const promptHash = sha256(prompt);

  // IMPORTANT: Use a fixed model id for stability (and stable cache keys).
  const modelToUse = model || (await aiService.discoverBestModel({
    requestingUser,
    providerId,
    apiProviderId
  }));

  // Strict Schema for Google AI
  const responseSchema = generateGeminiSchema(subkeys);

  const generationConfig = {
    maxOutputTokens,
    temperature: 0,
    topP: 1,
    topK: 1,
    candidateCount: 1,
    responseMimeType: "application/json",
    responseSchema
  };

  // Cache key depends on model + prompt + max tokens (prompt includes essay + roles + task definition)
  const cacheKey = sha256(`${modelToUse}|${maxOutputTokens}|${promptHash}`);

  if (shouldUseCache && _extractionCache.has(cacheKey)) {
    const cached = _extractionCache.get(cacheKey);
    return {
      cacheKey,
      extraction: cached.extraction,
      meta: {
        ...cached.meta,
        fromCache: true
      },
      executedPrompt: cached.executedPrompt,
      fromCache: true
    };
  }

  let lastErr = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    if (abortSignal?.aborted) {
      const err = new Error('Step 3 extraction was cancelled.');
      err.name = 'AbortError';
      err.code = 'RUN_CANCELLED';
      throw err;
    }
    try {
      const t0 = Date.now();
      const result = await aiService.sendMessage(
        [{ role: "user", content: prompt }],
        modelToUse,
        {
          ...generationConfig,
          timeoutMs: aiTimeoutMs,
          requestLabel: "ielts.step3.extraction",
          requestingUser,
          providerId,
          apiProviderId,
          abortSignal
        }
      );
      console.log("[Step3 Extraction] AI call ms:", Date.now() - t0, "model:", result.modelUsed);

      const rawText = result.text;
      const modelUsed = result.modelUsed;
      const usage = result.usage || null;
      const requestMeta = result.requestMeta || null;

      const {
        value: obj,
        parseDiagnostics
      } = safeJsonParse(rawText);
      const parsed = ExtractionSchema.parse(obj);
      validateExtractionLogic(parsed, essayObj, paragraphRoles, subkeys);
      const {
        extraction: sanitizedExtraction,
        languageCalibration
      } = sanitizeEvidenceExtraction(parsed, essayObj, paragraphRoles, subkeys);

      const payload = {
        extraction: sanitizedExtraction,
        meta: {
          subquestion_keys: subkeys,
          modelUsed,
          promptHash,
          schemaVersion: EXTRACTION_SCHEMA_VERSION,
          fromCache: false,
          usage,
          requestMeta,
          parseDiagnostics: parseDiagnostics || null,
          languageCalibration: languageCalibration || {
            applied: false,
            adjustmentCount: 0,
            adjustments: []
          }
        },
        executedPrompt: prompt
      };

      if (shouldUseCache) {
        _extractionCache.set(cacheKey, payload);
      }

      return {
        cacheKey,
        extraction: sanitizedExtraction,
        meta: payload.meta,
        executedPrompt: prompt,
        fromCache: false
      };
    } catch (e) {
      if (isAbortLikeError(e)) {
        throw e;
      }
      lastErr = e;
      const msg = String(e.message || "");
      const isRateLimit = msg.includes("429") || msg.includes("Resource exhausted");
      const parseDiagnostics = e?.parseDiagnostics && typeof e.parseDiagnostics === "object"
        ? e.parseDiagnostics
        : null;

      console.warn(`[AI Step 3] Attempt ${attempt} failed: ${msg}`);
      if (parseDiagnostics) {
        console.warn(
          `[AI Step 3] Parse diagnostics (attempt ${attempt}):`,
          `source=${parseDiagnostics.source || "unknown"};`,
          `strategy=${parseDiagnostics.repairStrategy || "none"};`,
          `position=${parseDiagnostics.errorPosition ?? "unknown"};`,
          `context=${parseDiagnostics.errorContext || ""}`
        );
      }

      if (attempt < retries) {
        // Wait longer for rate limits, shorter for others (no random jitter to keep behavior repeatable)
        const delay = isRateLimit ? 6500 : Math.pow(2, attempt) * 750;
        await wait(delay, abortSignal);
        continue;
      }
      break;
    }
  }

  throw new Error(
    `AI Extraction failed after ${retries} attempts. Last error: ${lastErr?.message}`
  );
}

module.exports = {
  runAiExtraction,
  prepareTask2Prompt,
  buildExtractionPrompt,
  buildExtractionPromptFromTemplate,
  buildStep3PromptTemplateContext,
  renderStep3PromptTemplate
};
