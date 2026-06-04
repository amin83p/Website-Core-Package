// MVC/services/ielts/extractionSchema.js
const { z } = require("zod");

/**
 * IMPORTANT:
 * Keep this schema aligned with aiExtractionService.js
 * (buildExtractionPrompt + generateGeminiSchema).
 */
const EXTRACTION_SCHEMA_VERSION = "ielts-extraction-evidence-v1.2";

const LexicalControlSchema = z.object({
  rangeBand: z.enum(["limited", "adequate", "sufficient", "wide"]),
  precisionBand: z.enum(["low", "mixed", "good", "high"]),
  collocationControl: z.enum(["weak", "mixed", "good"]),
  awkwardExpressionCountBand: z.enum(["none", "few", "some", "many"]),
  spellingImpact: z.enum(["none", "minor", "some", "frequent"]),
  wordFormationImpact: z.enum(["none", "minor", "some", "frequent"]),
  repetitionImpact: z.enum(["none", "mild", "noticeable", "strong"]),
  clarityImpactFromLexis: z.enum(["none", "minor", "some", "major"])
});

const GrammarControlSchema = z.object({
  structureRange: z.enum(["simple_only", "mixed", "varied", "wide"]),
  complexSentenceControl: z.enum(["weak", "mixed", "good"]),
  errorFrequency: z.enum(["rare", "occasional", "noticeable", "frequent"]),
  subjectVerbAgreement: z.enum(["strong", "mixed", "weak"]),
  articleControl: z.enum(["strong", "mixed", "weak"]),
  prepositionControl: z.enum(["strong", "mixed", "weak"]),
  punctuationControl: z.enum(["strong", "mixed", "weak"]),
  sentenceBoundaryControl: z.enum(["strong", "mixed", "weak"]),
  clarityImpactFromGrammar: z.enum(["none", "minor", "some", "major"]),
  errorFreeSentenceShareBand: z.enum(["very_low", "low", "moderate", "high"])
});

const ExtractionSchema = z.object({
  position: z.object({
    stance: z.enum(["agree", "disagree", "partial", "unclear"]),
    stanceSentenceIndex: z.number().int().nonnegative().nullable().default(null),
    contradictionSentenceIndices: z.array(z.number().int().nonnegative()).default([])
  }),

  answersBySubquestion: z.record(z.string(), z.array(z.number().int().nonnegative())).default({}),

  bodySupport: z.array(
    z.object({
      paragraphIndex: z.number().int().nonnegative(),
      hasExplanation: z.boolean(),
      hasExample: z.boolean(),
      evidenceSentenceIndices: z.array(z.number().int().nonnegative())
    })
  ).default([]),

  topicSentenceByParagraph: z.array(
    z.object({
      paragraphIndex: z.number().int().nonnegative(),
      topicSentenceIndex: z.number().int().nonnegative().nullable()
    })
  ).default([]),

  // Add these to match aiExtractionService.js (optional for backward compatibility with older saved sessions)
  lexicalQuality: z
    .object({
      range: z.enum(["basic", "adequate", "wide"]),
      precision: z.enum(["low", "mixed", "high"]),
      uncommonSkill: z.enum(["none", "some", "skilful"])
    })
    .optional(),

  errorProfiles: z
    .object({
      grammar: z.enum(["rare", "occasional", "frequent"]),
      lexical: z.enum(["rare", "occasional", "frequent"]),
      punctuation: z.enum(["rare", "occasional", "frequent"])
    })
    .optional(),

  // Richer LR/GRA extraction signals (optional for legacy-session compatibility)
  lexicalControl: LexicalControlSchema.optional(),
  grammarControl: GrammarControlSchema.optional()
});

module.exports = { ExtractionSchema, EXTRACTION_SCHEMA_VERSION };
