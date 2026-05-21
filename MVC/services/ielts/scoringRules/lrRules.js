'use strict';

const {
  RULE_PATCH_GROUP_META,
  RULE_PATCH_GROUPS,
  RULE_PATCH_GROUP_NAME_BY_KEY,
  DISABLED_RULE_PATCH_GROUPS,
  LEXICAL_RANGE_RANK,
  LEXICAL_PRECISION_RANK,
  normalizeRulePatchGroupToken,
  parseRulePatchGroupSet,
  parseBooleanToggle,
  getRulePatchGroupEnvOverride,
  isRulePatchGroupEnabled,
  applyRulePatchGroupGuards,
  ensureRuleDiagnosticsContainer,
  setRuleDiagnostic,
  subquestionCoverage,
  totalSubquestionIdeaCount,
  stanceProfile,
  paragraphProfile,
  currentParagraphProfile,
  getCurrentParagraphRole,
  getCurrentParagraphSentenceCount,
  currentParagraphSupportSignals,
  lexicalControlProfile,
  grammarControlProfile,
  lexicalErrorBand,
  lexicalRangeAtLeast,
  lexicalPrecisionAtLeast,
  lexicalClarityPreserved,
  lexicalSurfaceErrorsMinorOrSome,
  lexicalInstabilitySignalsMidBand,
  lexicalShowsControlledBand6Profile,
  lexicalShowsControlledBand7Profile,
  grammarWeakControlCount,
  grammarMixedOrWeakControlCount,
  grammarClarityStable,
  grammarRangeLimited,
  grammarComplexAttempted,
  languageCalibrationRescueProfile,
  coverageSignalDropoutRescueProfile,
  singlePartCoverageThinBoundaryRescueProfile,
  tr7CompactSingleBodyBoundaryRescueProfile,
  lr6CompactSingleBodyBoundaryRescueProfile,
  gra7LongHighContentBoundaryRescueProfile,
  repetitionHeuristic,
  toFiniteNumber,
  countWordsSimple,
  normalizeTaskEchoSeverity,
  taskEchoProfile,
  taskResponseLengthProfile,
  taskCoverageProfile,
  bodySupportProfile,
  developedBodyRowCount,
  trLowBandPositionRecoveryProfile,
  highBandSinglePromptEligibility,
  tr8SinglePromptRecoveryProfile,
  tr8MultiPartCeilingProfile,
  hasStrongDiscourseCounterSignals,
  highContentLanguageBoundaryRescueEligible,
  singlePartHighContentBoundaryRescueProfile,
  tr6SinglePartBoundaryRescueProfile,
  tr6SinglePartHighContentClosureRescueProfile,
  tr6SinglePartNoStanceDirectRescueProfile,
  tr6SinglePartNoStanceSupportRescueProfile,
  tr6SinglePartNoStanceClosureLiftEligible,
  tr6SinglePartLanguageBackedNoStanceRescueProfile,
  lexicalBoundaryDeescalationEligible,
  grammarBoundaryDeescalationEligible,
  lexicalSeverityBoundaryUncertain,
  grammarSeverityBoundaryUncertain,
  graBand5SentenceWeakBoundaryRecoveryEligible,
  paragraphTopicCoverageProfile,
  cohesionQualityProfile,
  collapsedParagraphSegmentationLikely,
  ccMidBandBlockerProfile,
  ccHigherBandSupportRecoveryProfile,
  ccThinConclusionRecoveryProfile,
  ccMidBandThinConclusionRecoveryProfile,
  ccBand6HighContentBoundaryRecoveryProfile,
  ccBand7ThinConclusionBoundaryRecoveryProfile,
  highBandLanguageControlStrong,
  tr8HighBandBoundaryRecoveryProfile,
  tr8MultiPartHighContentBoundaryRecoveryProfile,
  tr4CompactSinglePartBoundaryReliefProfile,
  graBand3CompactBoundaryRecoveryProfile,
  graBand3CompactMajorBoundaryRecoveryProfile,
  lrBand3CompactMajorBoundaryRecoveryProfile,
  ccBand7ThinConclusionHighBandRecoveryProfile,
  ccBand7SparseLinkingHighReferenceRecoveryProfile,
  ccBand7HighReferenceBoundaryRecoveryProfile,
  ccBand5OverlinkRecoveryProfile,
  conclusionSupportIsBand9Safe,
  paragraphingShowsBand9Control,
  paragraphingOnlySupportsBand8,
  repetitionOrMechanicalLinkingBlocksBand9,
  cohesionAttractsNoAttention,
  lexicalShowsBand9Control,
  lexicalBand9Blocked,
  grammarShowsBand9Control
} = require('./shared');

const lrRules = {
  "LR1-1": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    const coverage = taskCoverageProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWordCount = lengthProfile.effectiveWordCount;
    const sentenceCount = toFiniteNumber(ctx?.step1?.stats?.sentenceCount, 0);

    const veryShortIsolatedForm = effectiveWordCount > 0 && effectiveWordCount <= 12 && sentenceCount <= 1;
    const sparseAndUnaddressed =
      effectiveWordCount > 0 &&
      effectiveWordCount <= 20 &&
      sentenceCount <= 1 &&
      coverage.totalIdeas === 0 &&
      coverage.addressedPartCount === 0;

    if (veryShortIsolatedForm || sparseAndUnaddressed) return "Yes";
    if (lexicalControl) {
      const catastrophic =
        lexicalControl.rangeBand === 'limited' &&
        lexicalControl.precisionBand === 'low' &&
        lexicalControl.clarityImpactFromLexis === 'major' &&
        (lexicalControl.spellingImpact === 'frequent' || lexicalControl.wordFormationImpact === 'frequent');
      if (catastrophic && effectiveWordCount <= 30) return "Yes";
    }

    if (effectiveWordCount >= 25 && sentenceCount >= 2) return "No";
    if (coverage.totalIdeas >= 1 || coverage.addressedPartCount >= 1) return "No";
    return "No";
  },

  "LR2-1": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      const extremelyLimitedCore =
        lexicalControl.rangeBand === 'limited' &&
        lexicalControl.precisionBand === 'low' &&
        lexicalControl.collocationControl === 'weak';
      const severeFormControlLoss =
        lexicalControl.spellingImpact === 'frequent' ||
        lexicalControl.wordFormationImpact === 'frequent';
      const severeClarityLoss =
        lexicalControl.clarityImpactFromLexis === 'major' ||
        lexicalControl.repetitionImpact === 'strong' ||
        lexicalControl.awkwardExpressionCountBand === 'many';

      if (extremelyLimitedCore && severeFormControlLoss && severeClarityLoss) return "Yes";
      if (
        lexicalRangeAtLeast(lexicalControl, 'adequate') &&
        lexicalPrecisionAtLeast(lexicalControl, 'mixed') &&
        lexicalControl.clarityImpactFromLexis !== 'major' &&
        lexicalControl.spellingImpact !== 'frequent' &&
        lexicalControl.wordFormationImpact !== 'frequent'
      ) {
        return "No";
      }
      if (extremelyLimitedCore && (severeFormControlLoss || severeClarityLoss)) return "Yes";
      return "No";
    }

    const lexicalQuality = ctx?.step25?.lexicalQuality || {};
    const lexicalProfile = String(ctx?.step25?.errorProfiles?.lexical || '').trim().toLowerCase();
    if (
      String(lexicalQuality?.range || '').trim().toLowerCase() === 'basic' &&
      String(lexicalQuality?.precision || '').trim().toLowerCase() === 'low' &&
      lexicalProfile === 'frequent'
    ) {
      return "Yes";
    }
    return "No";
  },

  "LR3-1": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      const rescue = languageCalibrationRescueProfile(ctx);
      const coverageDropoutRescue = coverageSignalDropoutRescueProfile(ctx);
      const veryLimitedCore = lexicalControl.rangeBand === 'limited'
        && lexicalControl.precisionBand === 'low'
        && lexicalControl.collocationControl === 'weak';
      const severeSurfaceControlLoss = lexicalControl.spellingImpact === 'frequent'
        || lexicalControl.wordFormationImpact === 'frequent';
      const severeClarityLoss = lexicalControl.clarityImpactFromLexis === 'major';
      const manyAwkwardForms = lexicalControl.awkwardExpressionCountBand === 'many';
      const catastrophicLexicalFailure = severeClarityLoss
        && severeSurfaceControlLoss
        && lexicalControl.repetitionImpact === 'strong';

      if (
        (rescue.conservativeRescueEligible || coverageDropoutRescue.eligible) &&
        veryLimitedCore &&
        (!catastrophicLexicalFailure || coverageDropoutRescue.eligible)
      ) {
        return "No";
      }

      if (veryLimitedCore && (severeSurfaceControlLoss || severeClarityLoss || manyAwkwardForms)) return "Yes";
      if (severeClarityLoss && (severeSurfaceControlLoss || veryLimitedCore)) return "Yes";
      if (veryLimitedCore) return "Yes";

      if (
        lexicalRangeAtLeast(lexicalControl, 'adequate') &&
        lexicalPrecisionAtLeast(lexicalControl, 'mixed') &&
        lexicalControl.clarityImpactFromLexis !== 'major' &&
        lexicalControl.spellingImpact !== 'frequent' &&
        lexicalControl.wordFormationImpact !== 'frequent'
      ) {
        return "No";
      }

      return "No";
    }

    const range = String(ctx?.step25?.lexicalQuality?.range || '').trim().toLowerCase();
    const precision = String(ctx?.step25?.lexicalQuality?.precision || '').trim().toLowerCase();
    const lexicalProfile = String(ctx?.step25?.errorProfiles?.lexical || '').trim().toLowerCase();

    if (range === 'basic' && (precision === 'low' || lexicalProfile === 'frequent')) return "Yes";
    if (lexicalProfile === 'frequent') return "Yes";
    if (range === 'adequate' || range === 'wide' || lexicalProfile === 'rare') return "No";

    return null;
  },

  "LR3-2": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      const rescue = languageCalibrationRescueProfile(ctx);
      const coverageDropoutRescue = coverageSignalDropoutRescueProfile(ctx);
      const compactMajorBoundaryRecovery = lrBand3CompactMajorBoundaryRecoveryProfile(ctx, lexicalControl);
      const severeDistortion = lexicalControl.clarityImpactFromLexis === 'major'
        || (
          (lexicalControl.spellingImpact === 'frequent' || lexicalControl.wordFormationImpact === 'frequent')
          && lexicalControl.precisionBand === 'low'
        );
      const catastrophicLexicalFailure = lexicalControl.repetitionImpact === 'strong'
        && lexicalControl.awkwardExpressionCountBand === 'many';
      if (severeDistortion) {
        if (coverageDropoutRescue.eligible) return "some";
        if (compactMajorBoundaryRecovery.eligible) return "some";
        if (rescue.conservativeRescueEligible && !catastrophicLexicalFailure) return "some";
        return "severe";
      }

      const someDistortion = ['some', 'major'].includes(lexicalControl.clarityImpactFromLexis)
        || ['some', 'frequent'].includes(lexicalControl.spellingImpact)
        || ['some', 'frequent'].includes(lexicalControl.wordFormationImpact)
        || lexicalControl.precisionBand === 'low'
        || lexicalControl.collocationControl === 'weak'
        || lexicalControl.awkwardExpressionCountBand === 'some'
        || lexicalControl.awkwardExpressionCountBand === 'many';
      if (someDistortion) return "some";

      if (
        ['none', 'minor'].includes(lexicalControl.spellingImpact) &&
        ['none', 'minor'].includes(lexicalControl.wordFormationImpact) &&
        ['none', 'minor'].includes(lexicalControl.clarityImpactFromLexis) &&
        lexicalControl.precisionBand !== 'low' &&
        lexicalControl.collocationControl !== 'weak'
      ) {
        return "none";
      }

      return "some";
    }

    const lexicalProfile = String(ctx?.step25?.errorProfiles?.lexical || '').trim().toLowerCase();
    if (lexicalProfile === 'frequent') return "severe";
    if (lexicalProfile === 'occasional') return "some";
    if (lexicalProfile === 'rare') return "none";

    return null;
  },

  "LR4-1": (ctx) => {
    if (ctx.step1?.stats?.wordCount > 250) return "No";
    return null;
  },

  "LR4-2": (ctx) => {
    const r = repetitionHeuristic(ctx);
    if (r.topCount >= 10 && r.ratio >= 0.03) {
      const singlePartBoundary = singlePartHighContentBoundaryRescueProfile(ctx);
      const lexicalControl = lexicalControlProfile(ctx);
      const limitedBoundaryLexis = Boolean(
        lexicalControl &&
        lexicalControl.rangeBand === 'limited' &&
        lexicalControl.precisionBand === 'low' &&
        lexicalControl.collocationControl === 'weak' &&
        lexicalControl.clarityImpactFromLexis === 'some'
      );
      if (
        singlePartBoundary.eligible &&
        limitedBoundaryLexis &&
        r.topWord &&
        r.topWord.length >= 4 &&
        r.topCount <= 12 &&
        r.ratio <= 0.05
      ) {
        return "No";
      }
      return "Yes";
    }
    return "No";
  },

  "LR4-3": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      const lowPrecision = lexicalControl.precisionBand === 'low';
      const weakCollocation = lexicalControl.collocationControl === 'weak';
      const clarityMajor = lexicalControl.clarityImpactFromLexis === 'major';
      const claritySome = lexicalControl.clarityImpactFromLexis === 'some';
      const surfaceFrequent =
        lexicalControl.spellingImpact === 'frequent' ||
        lexicalControl.wordFormationImpact === 'frequent';
      const contentRescueEligible =
        highContentLanguageBoundaryRescueEligible(ctx) &&
        lexicalControl.rangeBand === 'adequate' &&
        lexicalControl.awkwardExpressionCountBand === 'many' &&
        lexicalControl.repetitionImpact !== 'strong' &&
        lowPrecision &&
        weakCollocation &&
        surfaceFrequent;

      if (clarityMajor) {
        if (contentRescueEligible) return "No";
        return "Yes";
      }
      if (lowPrecision && weakCollocation && surfaceFrequent && claritySome) return "Yes";
      if (
        lexicalPrecisionAtLeast(lexicalControl, 'good') &&
        lexicalClarityPreserved(lexicalControl) &&
        ['mixed', 'good'].includes(lexicalControl.collocationControl)
      ) {
        return "No";
      }
      if (
        lexicalControl.precisionBand === 'mixed' &&
        lexicalControl.clarityImpactFromLexis === 'minor' &&
        ['mixed', 'good'].includes(lexicalControl.collocationControl)
      ) {
        return "No";
      }
      if (lowPrecision && !clarityMajor && !surfaceFrequent) return "No";
      return "No";
    }
    const precision = ctx.step25?.lexicalQuality?.precision;
    if (precision === 'low') return "Yes";
    if (precision === 'high') return "No";
    return null;
  },

  "LR4-4": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      const clarityImpact = lexicalControl.clarityImpactFromLexis;
      const spellingImpact = lexicalControl.spellingImpact;
      const wordFormationImpact = lexicalControl.wordFormationImpact;
      const lowPrecision = lexicalControl.precisionBand === 'low';
      const awkwardMany = lexicalControl.awkwardExpressionCountBand === 'many';
      const frequentSurfaceErrors = spellingImpact === 'frequent' || wordFormationImpact === 'frequent';
      const dualFrequentSurfaceErrors = spellingImpact === 'frequent' && wordFormationImpact === 'frequent';
      const contentRescueEligible =
        highContentLanguageBoundaryRescueEligible(ctx) &&
        lexicalControl.rangeBand === 'adequate' &&
        lexicalControl.awkwardExpressionCountBand === 'many' &&
        lexicalControl.repetitionImpact !== 'strong' &&
        lowPrecision &&
        frequentSurfaceErrors &&
        clarityImpact === 'major';

      if (
        clarityImpact === 'major' ||
        dualFrequentSurfaceErrors
      ) {
        if (contentRescueEligible) return "No";
        return "Yes";
      }
      if (
        frequentSurfaceErrors &&
        (clarityImpact === 'some' || lowPrecision || awkwardMany)
      ) {
        return "Yes";
      }
      if (
        ['none', 'minor'].includes(spellingImpact) &&
        ['none', 'minor'].includes(wordFormationImpact) &&
        ['none', 'minor'].includes(clarityImpact)
      ) {
        return "No";
      }
      return "No";
    }
    const lexicalProfile = String(ctx?.step25?.errorProfiles?.lexical || '').trim().toLowerCase();
    if (lexicalProfile === 'frequent' || lexicalProfile === 'occasional') return "Yes";
    if (lexicalProfile === 'rare') return "No";
    return null;
  },

  "LR4-5": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      const singlePartBoundary = singlePartHighContentBoundaryRescueProfile(ctx);
      const contentRescueEligible =
        highContentLanguageBoundaryRescueEligible(ctx) &&
        lexicalControl.rangeBand === 'adequate' &&
        lexicalControl.precisionBand === 'low' &&
        lexicalControl.collocationControl === 'weak' &&
        lexicalControl.awkwardExpressionCountBand === 'many' &&
        lexicalControl.clarityImpactFromLexis === 'major' &&
        lexicalControl.spellingImpact === 'frequent' &&
        lexicalControl.wordFormationImpact === 'frequent' &&
        lexicalControl.repetitionImpact !== 'strong';
      const singlePartSevereBoundaryRescue =
        singlePartBoundary.eligible &&
        lexicalControl.rangeBand === 'limited' &&
        lexicalControl.precisionBand === 'low' &&
        lexicalControl.collocationControl === 'weak' &&
        lexicalControl.awkwardExpressionCountBand === 'many' &&
        lexicalControl.spellingImpact === 'frequent' &&
        (lexicalControl.wordFormationImpact === 'some' || lexicalControl.wordFormationImpact === 'frequent') &&
        lexicalControl.repetitionImpact === 'strong' &&
        lexicalControl.clarityImpactFromLexis === 'some';
      const severeSignals = [
        lexicalControl.clarityImpactFromLexis === 'major',
        lexicalControl.spellingImpact === 'frequent',
        lexicalControl.wordFormationImpact === 'frequent',
        lexicalControl.repetitionImpact === 'strong',
        lexicalControl.awkwardExpressionCountBand === 'many' && (
          lexicalControl.precisionBand === 'low' || lexicalControl.collocationControl === 'weak'
        )
      ].filter(Boolean).length;
      const moderateSignals = [
        lexicalControl.clarityImpactFromLexis === 'some',
        lexicalControl.spellingImpact === 'some',
        lexicalControl.wordFormationImpact === 'some',
        lexicalControl.repetitionImpact === 'noticeable',
        lexicalControl.awkwardExpressionCountBand === 'some' || lexicalControl.awkwardExpressionCountBand === 'many',
        lexicalControl.precisionBand === 'low',
        lexicalControl.collocationControl === 'weak'
      ].filter(Boolean).length;

      if (contentRescueEligible) return "some";
      if (singlePartSevereBoundaryRescue) return "some";
      if (
        severeSignals >= 2 ||
        (lexicalControl.clarityImpactFromLexis === 'major' && severeSignals >= 1)
      ) {
        return "strain";
      }
      if (moderateSignals >= 1) {
        return "some";
      }
      if (
        ['none', 'minor'].includes(lexicalControl.clarityImpactFromLexis) &&
        ['none', 'minor'].includes(lexicalControl.spellingImpact) &&
        ['none', 'minor'].includes(lexicalControl.wordFormationImpact) &&
        ['none', 'few'].includes(lexicalControl.awkwardExpressionCountBand) &&
        ['none', 'mild'].includes(lexicalControl.repetitionImpact)
      ) {
        return "none";
      }
    }
    const lexicalProfile = String(ctx?.step25?.errorProfiles?.lexical || '').trim().toLowerCase();
    if (lexicalProfile === 'frequent') return "strain";
    if (lexicalProfile === 'occasional') return "some";
    if (lexicalProfile === 'rare') return "none";
    return null;
  },

  "LR5-1": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      if (
        lexicalControl.rangeBand === 'limited' &&
        lexicalSeverityBoundaryUncertain(lexicalControl) &&
        lexicalBoundaryDeescalationEligible(ctx, lexicalControl)
      ) {
        return "No";
      }
      if (lexicalControl.rangeBand === 'limited') return "Yes";
      if (lexicalRangeAtLeast(lexicalControl, 'adequate')) return "No";
    }
    const range = ctx.step25?.lexicalQuality?.range;
    if (range === 'adequate' || range === 'wide') return "No";
    return null;
  },

  "LR5-2": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      const severeHighContentBoundaryRescue =
        highContentLanguageBoundaryRescueEligible(ctx) &&
        lexicalControl.rangeBand === 'adequate' &&
        lexicalControl.precisionBand === 'low' &&
        lexicalControl.collocationControl === 'weak' &&
        lexicalControl.awkwardExpressionCountBand === 'many' &&
        lexicalControl.spellingImpact === 'frequent' &&
        lexicalControl.wordFormationImpact === 'frequent' &&
        lexicalControl.clarityImpactFromLexis === 'major' &&
        lexicalControl.repetitionImpact !== 'strong';
      if (severeHighContentBoundaryRescue) return "No";

      const contentBoundaryRescue =
        highContentLanguageBoundaryRescueEligible(ctx) &&
        lexicalControl.rangeBand === 'adequate' &&
        lexicalControl.precisionBand === 'low' &&
        lexicalControl.collocationControl === 'weak' &&
        lexicalControl.clarityImpactFromLexis === 'some' &&
        lexicalControl.awkwardExpressionCountBand === 'many' &&
        ['minor', 'some'].includes(lexicalControl.spellingImpact) &&
        ['minor', 'some'].includes(lexicalControl.wordFormationImpact) &&
        lexicalControl.repetitionImpact !== 'strong';
      if (contentBoundaryRescue) return "No";

      if (lexicalControl.rangeBand === 'limited') {
        const limitedButRecoverable = lexicalBoundaryDeescalationEligible(ctx, lexicalControl) || (
          hasStrongDiscourseCounterSignals(ctx) &&
          lexicalControl.precisionBand !== 'low' &&
          lexicalControl.collocationControl !== 'weak' &&
          lexicalControl.clarityImpactFromLexis !== 'major' &&
          lexicalControl.spellingImpact !== 'frequent' &&
          lexicalControl.wordFormationImpact !== 'frequent' &&
          lexicalControl.awkwardExpressionCountBand !== 'many' &&
          lexicalControl.repetitionImpact !== 'strong'
        );
        if (limitedButRecoverable) {
          return "No";
        }
        if (
          lexicalSeverityBoundaryUncertain(lexicalControl) &&
          lexicalBoundaryDeescalationEligible(ctx, lexicalControl)
        ) {
          return "No";
        }
        if (lexicalControl.clarityImpactFromLexis === 'major') return "Yes";
        if (lexicalControl.precisionBand === 'low' || lexicalControl.collocationControl === 'weak') return "Yes";
        if (
          ['some', 'frequent'].includes(lexicalControl.spellingImpact) ||
          ['some', 'frequent'].includes(lexicalControl.wordFormationImpact) ||
          lexicalControl.awkwardExpressionCountBand === 'many' ||
          lexicalControl.repetitionImpact === 'strong'
        ) {
          return "Yes";
        }
        return "Yes";
      }
      if (lexicalRangeAtLeast(lexicalControl, 'sufficient')) return "No";
      if (
        lexicalControl.rangeBand === 'adequate' &&
        lexicalPrecisionAtLeast(lexicalControl, 'mixed') &&
        ['mixed', 'good'].includes(lexicalControl.collocationControl) &&
        lexicalClarityPreserved(lexicalControl) &&
        lexicalControl.awkwardExpressionCountBand !== 'many'
      ) {
        return "No";
      }
      if (
        lexicalControl.rangeBand === 'adequate' &&
        lexicalPrecisionAtLeast(lexicalControl, 'good') &&
        lexicalClarityPreserved(lexicalControl)
      ) {
        return "No";
      }
      if (
        lexicalControl.rangeBand === 'adequate' &&
        lexicalControl.precisionBand === 'low' &&
        !lexicalClarityPreserved(lexicalControl)
      ) {
        return "Yes";
      }
      return "No";
    }
    const range = ctx.step25?.lexicalQuality?.range;
    const precision = ctx.step25?.lexicalQuality?.precision;
    if (range === 'basic') return "Yes";
    if (range === 'wide') return "No";
    if (range === 'adequate' && (precision === 'high' || precision === 'mixed')) return "No";
    if (precision === 'low') return "Yes";
    return "No";
  },

  "LR5-3": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      const severeHighContentBoundaryRescue =
        highContentLanguageBoundaryRescueEligible(ctx) &&
        lexicalControl.rangeBand === 'adequate' &&
        lexicalControl.precisionBand === 'low' &&
        lexicalControl.collocationControl === 'weak' &&
        lexicalControl.awkwardExpressionCountBand === 'many' &&
        lexicalControl.spellingImpact === 'frequent' &&
        lexicalControl.wordFormationImpact === 'frequent' &&
        lexicalControl.clarityImpactFromLexis === 'major' &&
        lexicalControl.repetitionImpact !== 'strong';
      if (severeHighContentBoundaryRescue) return "No";

      const contentBoundaryRescue =
        highContentLanguageBoundaryRescueEligible(ctx) &&
        lexicalControl.rangeBand === 'adequate' &&
        lexicalControl.precisionBand === 'low' &&
        lexicalControl.collocationControl === 'weak' &&
        lexicalControl.clarityImpactFromLexis === 'some' &&
        lexicalControl.awkwardExpressionCountBand === 'many' &&
        lexicalControl.repetitionImpact !== 'strong' &&
        (
          (
            lexicalControl.spellingImpact === 'some' &&
            ['none', 'minor'].includes(lexicalControl.wordFormationImpact)
          ) ||
          (
            lexicalControl.wordFormationImpact === 'some' &&
            ['none', 'minor'].includes(lexicalControl.spellingImpact)
          )
        );
      if (contentBoundaryRescue) return "No";

      if (
        lexicalSeverityBoundaryUncertain(lexicalControl) &&
        lexicalBoundaryDeescalationEligible(ctx, lexicalControl)
      ) {
        return "No";
      }
      if (lexicalControl.spellingImpact === 'frequent' || lexicalControl.wordFormationImpact === 'frequent') return "Yes";
      const hasSomeSurfaceError =
        lexicalControl.spellingImpact === 'some' ||
        lexicalControl.wordFormationImpact === 'some';
      if (
        hasSomeSurfaceError &&
        lexicalBoundaryDeescalationEligible(ctx, lexicalControl) &&
        lexicalClarityPreserved(lexicalControl) &&
        ['none', 'few'].includes(lexicalControl.awkwardExpressionCountBand) &&
        lexicalControl.repetitionImpact !== 'strong'
      ) {
        return "No";
      }
      if (
        ['none', 'minor'].includes(lexicalControl.spellingImpact) &&
        ['none', 'minor'].includes(lexicalControl.wordFormationImpact) &&
        lexicalClarityPreserved(lexicalControl) &&
        ['none', 'few'].includes(lexicalControl.awkwardExpressionCountBand)
      ) {
        return "No";
      }
      if (
        ['some', 'frequent'].includes(lexicalControl.spellingImpact) ||
        ['some', 'frequent'].includes(lexicalControl.wordFormationImpact)
      ) {
        if (
          lexicalControl.spellingImpact === 'some' &&
          lexicalControl.wordFormationImpact === 'some' &&
          lexicalClarityPreserved(lexicalControl) &&
          lexicalControl.awkwardExpressionCountBand !== 'many' &&
          lexicalControl.repetitionImpact !== 'strong'
        ) {
          return "No";
        }
        return "Yes";
      }
    }
    const lexicalProfile = ctx.step25?.errorProfiles?.lexical;
    if (lexicalProfile === 'frequent' || lexicalProfile === 'occasional') return "Yes";
    if (lexicalProfile === 'rare') return "No";
    return null;
  },

  "LR5-4": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      const severeHighContentBoundaryRescue =
        highContentLanguageBoundaryRescueEligible(ctx) &&
        lexicalControl.rangeBand === 'adequate' &&
        lexicalControl.precisionBand === 'low' &&
        lexicalControl.collocationControl === 'weak' &&
        lexicalControl.awkwardExpressionCountBand === 'many' &&
        lexicalControl.spellingImpact === 'frequent' &&
        lexicalControl.wordFormationImpact === 'frequent' &&
        lexicalControl.clarityImpactFromLexis === 'major' &&
        lexicalControl.repetitionImpact !== 'strong';
      if (severeHighContentBoundaryRescue) return "none";

      if (
        lexicalSeverityBoundaryUncertain(lexicalControl) &&
        lexicalBoundaryDeescalationEligible(ctx, lexicalControl)
      ) {
        return "none";
      }
      if (lexicalControl.clarityImpactFromLexis === 'major') return "some";
      if (
        lexicalControl.spellingImpact === 'frequent' ||
        lexicalControl.wordFormationImpact === 'frequent' ||
        lexicalControl.awkwardExpressionCountBand === 'many'
      ) {
        return "some";
      }
      if (
        lexicalControl.clarityImpactFromLexis === 'some' &&
        (
          lexicalControl.spellingImpact === 'some' ||
          lexicalControl.wordFormationImpact === 'some' ||
          lexicalControl.awkwardExpressionCountBand === 'some' ||
          lexicalControl.repetitionImpact === 'strong'
        )
      ) {
        return "some";
      }
      if (
        ['some', 'frequent'].includes(lexicalControl.spellingImpact) ||
        ['some', 'frequent'].includes(lexicalControl.wordFormationImpact)
      ) {
        if (
          lexicalControl.spellingImpact === 'some' &&
          lexicalControl.wordFormationImpact === 'some' &&
          lexicalClarityPreserved(lexicalControl) &&
          lexicalControl.awkwardExpressionCountBand !== 'many' &&
          lexicalControl.repetitionImpact !== 'strong'
        ) {
          return "none";
        }
        return "some";
      }
      if (
        lexicalControl.clarityImpactFromLexis === 'some' &&
        lexicalBoundaryDeescalationEligible(ctx, lexicalControl) &&
        lexicalControl.awkwardExpressionCountBand !== 'many'
      ) {
        return "none";
      }
      if (
        ['none', 'minor'].includes(lexicalControl.spellingImpact) &&
        ['none', 'minor'].includes(lexicalControl.wordFormationImpact) &&
        lexicalClarityPreserved(lexicalControl) &&
        ['none', 'few'].includes(lexicalControl.awkwardExpressionCountBand)
      ) {
        return "none";
      }
    }
    const lexicalProfile = ctx.step25?.errorProfiles?.lexical;
    if (lexicalProfile === 'frequent' || lexicalProfile === 'occasional') return "some";
    if (lexicalProfile === 'rare') return "none";
    return null;
  },

  "LR6-1": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      const coverage = taskCoverageProfile(ctx);
      const support = bodySupportProfile(ctx);
      const topicCoverage = paragraphTopicCoverageProfile(ctx);
      const stance = stanceProfile(ctx);
      const para = paragraphProfile(ctx);
      const lengthProfile = taskResponseLengthProfile(ctx);
      const repetition = repetitionHeuristic(ctx);
      const developedRows = developedBodyRowCount(support);
      const singlePartCoverageSignalBoundaryRecovery =
        lexicalControl.rangeBand === 'adequate' &&
        lexicalControl.precisionBand === 'mixed' &&
        lexicalControl.collocationControl === 'mixed' &&
        lexicalControl.awkwardExpressionCountBand !== 'many' &&
        lexicalControl.repetitionImpact !== 'strong' &&
        lexicalControl.spellingImpact !== 'frequent' &&
        lexicalControl.wordFormationImpact !== 'frequent' &&
        lexicalControl.clarityImpactFromLexis !== 'major' &&
        coverage.totalParts === 1 &&
        coverage.missingPartCount === 0 &&
        coverage.totalIdeas <= 1 &&
        stance.hasPosition &&
        !stance.isInconsistent &&
        para.paragraphCount >= 5 &&
        para.bodyCount >= 3 &&
        support.totalBodyRows >= 3 &&
        developedRows >= 3 &&
        support.hardUnderdevelopedCount <= 1 &&
        support.effectiveUnderdevelopedCount <= 1 &&
        topicCoverage.bodyParagraphCount >= 3 &&
        topicCoverage.bodyTopicCoverageRatio >= 0.67 &&
        lengthProfile.effectiveWordCount >= 300 &&
        lengthProfile.taskEcho.severity === 'none' &&
        repetition.topCount <= 10 &&
        repetition.ratio < 0.04;
      const highContentAdequateMixedBoundary =
        lexicalControl.rangeBand === 'adequate' &&
        lexicalControl.precisionBand === 'mixed' &&
        lexicalControl.collocationControl === 'mixed' &&
        lexicalControl.awkwardExpressionCountBand !== 'many' &&
        lexicalControl.repetitionImpact !== 'strong' &&
        lexicalControl.spellingImpact !== 'frequent' &&
        lexicalControl.wordFormationImpact !== 'frequent' &&
        lexicalControl.clarityImpactFromLexis !== 'major' &&
        para.paragraphCount >= 4 &&
        para.bodyCount >= 2 &&
        support.totalBodyRows >= 2 &&
        developedRows >= 2 &&
        support.effectiveUnderdevelopedCount <= 1 &&
        topicCoverage.bodyParagraphCount >= 2 &&
        topicCoverage.bodyTopicCoverageRatio >= 0.67 &&
        coverage.totalIdeas >= Math.max(3, coverage.totalParts + 1) &&
        lengthProfile.effectiveWordCount >= 275 &&
        lengthProfile.taskEcho.severity !== 'severe' &&
        repetition.topCount <= 12 &&
        repetition.ratio < 0.045;
      if (singlePartCoverageSignalBoundaryRecovery) return "Yes";
      if (highContentAdequateMixedBoundary) return "Yes";
      if (lexicalInstabilitySignalsMidBand(lexicalControl)) return "No";
      if (lexicalShowsControlledBand6Profile(lexicalControl)) return "Yes";
      if (lexicalRangeAtLeast(lexicalControl, 'sufficient') && lexicalPrecisionAtLeast(lexicalControl, 'good')) return "Yes";
      if (
        lexicalControl.rangeBand === 'adequate' &&
        lexicalControl.precisionBand === 'mixed' &&
        lexicalControl.collocationControl === 'mixed'
      ) {
        return "No";
      }
    }
    const range = ctx.step25?.lexicalQuality?.range;
    const precision = ctx.step25?.lexicalQuality?.precision;
    const uncommonSkill = ctx.step25?.lexicalQuality?.uncommonSkill;
    if (range === 'wide') return "Yes";
    if (range === 'adequate') {
      if (precision === 'high' || uncommonSkill === 'some' || uncommonSkill === 'skilful') return "Yes";
      return "No";
    }
    if (range === 'basic') return "No";
    return null;
  },

  "LR6-2": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      const coverage = taskCoverageProfile(ctx);
      const support = bodySupportProfile(ctx);
      const lengthProfile = taskResponseLengthProfile(ctx);
      const repetition = repetitionHeuristic(ctx);
      const thinBoundaryRescue = singlePartCoverageThinBoundaryRescueProfile(ctx);
      const compactSingleBodyBoundaryRescue = lr6CompactSingleBodyBoundaryRescueProfile(ctx);
      const thinBoundaryMildEchoLexicalRescue =
        coverage.totalParts === 1 &&
        coverage.missingPartCount === 0 &&
        coverage.totalIdeas <= 1 &&
        support.totalBodyRows >= 4 &&
        thinBoundaryRescue.developedRows >= 2 &&
        thinBoundaryRescue.severeThinBodyRows >= 2 &&
        lengthProfile.effectiveWordCount >= 320 &&
        ['none', 'mild'].includes(lengthProfile.taskEcho.severity) &&
        repetition.topCount <= 9 &&
        repetition.ratio < 0.03;
      const controlledSinglePartBoundary =
        coverage.totalParts === 1 &&
        coverage.missingPartCount === 0 &&
        coverage.totalIdeas >= 5 &&
        support.totalBodyRows >= 2 &&
        support.effectiveUnderdevelopedCount <= 1 &&
        lengthProfile.effectiveWordCount >= 250 &&
        lengthProfile.taskEcho.severity === 'none' &&
        repetition.topCount <= 10 &&
        repetition.ratio < 0.04;
      const controlledSinglePartBoundaryRelaxed =
        coverage.totalParts === 1 &&
        coverage.missingPartCount === 0 &&
        coverage.totalIdeas >= 6 &&
        support.totalBodyRows >= 2 &&
        support.effectiveUnderdevelopedCount === 0 &&
        lengthProfile.effectiveWordCount >= 260 &&
        lengthProfile.taskEcho.severity === 'none' &&
        repetition.topCount <= 12 &&
        repetition.ratio < 0.05;
      const twoIdeaSinglePartWeakCollocationBoundaryRescue =
        highContentLanguageBoundaryRescueEligible(ctx) &&
        coverage.totalParts === 1 &&
        coverage.missingPartCount === 0 &&
        coverage.totalIdeas === 2 &&
        support.totalBodyRows >= 3 &&
        support.strongCount >= 1 &&
        support.effectiveUnderdevelopedCount <= 1 &&
        lengthProfile.effectiveWordCount >= 335 &&
        lengthProfile.taskEcho.severity === 'none' &&
        repetition.topCount <= 11 &&
        repetition.ratio < 0.032 &&
        lexicalControl.rangeBand === 'adequate' &&
        lexicalControl.precisionBand === 'mixed' &&
        lexicalControl.collocationControl === 'weak' &&
        lexicalControl.awkwardExpressionCountBand === 'some' &&
        lexicalControl.spellingImpact === 'some' &&
        ['none', 'minor'].includes(lexicalControl.wordFormationImpact) &&
        lexicalControl.repetitionImpact === 'mild' &&
        lexicalControl.clarityImpactFromLexis === 'some';
      const rangeUsable = lexicalRangeAtLeast(lexicalControl, 'adequate');
      const precisionUsable = lexicalPrecisionAtLeast(lexicalControl, 'mixed');
      const collocationUsable = ['mixed', 'good'].includes(lexicalControl.collocationControl);
      const hasStrongMarker =
        lexicalRangeAtLeast(lexicalControl, 'sufficient') ||
        lexicalPrecisionAtLeast(lexicalControl, 'good') ||
        lexicalControl.collocationControl === 'good';
      setRuleDiagnostic(ctx, 'LR6-2', {
        helperProfiles: {
          singlePartCoverageThinBoundaryRescue: {
            eligible: thinBoundaryRescue.eligible,
            totalParts: thinBoundaryRescue?.coverage?.totalParts ?? null,
            totalIdeas: thinBoundaryRescue?.coverage?.totalIdeas ?? null,
            totalBodyRows: thinBoundaryRescue?.support?.totalBodyRows ?? null,
            developedRows: thinBoundaryRescue?.developedRows ?? null,
            severeThinBodyRows: thinBoundaryRescue?.severeThinBodyRows ?? null,
            effectiveWordCount: thinBoundaryRescue?.lengthProfile?.effectiveWordCount ?? null,
            taskEchoSeverity: thinBoundaryRescue?.taskEcho?.severity ?? null,
            repetitionTopCount: thinBoundaryRescue?.repetition?.topCount ?? null,
            repetitionRatio: thinBoundaryRescue?.repetition?.ratio ?? null
          },
          lr6CompactSingleBodyBoundaryRescue: {
            eligible: compactSingleBodyBoundaryRescue.eligible,
            totalParts: compactSingleBodyBoundaryRescue?.coverage?.totalParts ?? null,
            totalIdeas: compactSingleBodyBoundaryRescue?.coverage?.totalIdeas ?? null,
            paragraphCount: compactSingleBodyBoundaryRescue?.para?.paragraphCount ?? null,
            bodyCount: compactSingleBodyBoundaryRescue?.para?.bodyCount ?? null,
            totalBodyRows: compactSingleBodyBoundaryRescue?.support?.totalBodyRows ?? null,
            developedRows: compactSingleBodyBoundaryRescue?.developedRows ?? null,
            effectiveUnderdevelopedCount: compactSingleBodyBoundaryRescue?.support?.effectiveUnderdevelopedCount ?? null,
            severeThinBodyRows: compactSingleBodyBoundaryRescue?.support?.severelyThinCount ?? null,
            effectiveWordCount: compactSingleBodyBoundaryRescue?.lengthProfile?.effectiveWordCount ?? null,
            taskEchoSeverity: compactSingleBodyBoundaryRescue?.taskEcho?.severity ?? null,
            repetitionTopCount: compactSingleBodyBoundaryRescue?.repetition?.topCount ?? null,
            repetitionRatio: compactSingleBodyBoundaryRescue?.repetition?.ratio ?? null,
            stanceClear: compactSingleBodyBoundaryRescue?.stance?.isClear ?? null
          }
        },
        decisionSignals: {
          rangeBand: lexicalControl.rangeBand,
          precisionBand: lexicalControl.precisionBand,
          collocationControl: lexicalControl.collocationControl,
          hasStrongMarker,
          compactSingleBodyBoundaryRescue: compactSingleBodyBoundaryRescue.eligible,
          controlledSinglePartBoundary,
          controlledSinglePartBoundaryRelaxed,
          twoIdeaSinglePartWeakCollocationBoundaryRescue,
          thinBoundaryMildEchoLexicalRescue
        }
      });
      if (rangeUsable && precisionUsable && collocationUsable && hasStrongMarker) return "Yes";
      if (
        (controlledSinglePartBoundary || controlledSinglePartBoundaryRelaxed) &&
        lexicalControl.rangeBand === 'adequate' &&
        lexicalControl.precisionBand === 'mixed' &&
        lexicalControl.collocationControl === 'mixed' &&
        ['none', 'minor'].includes(lexicalControl.spellingImpact) &&
        ['none', 'minor'].includes(lexicalControl.wordFormationImpact) &&
        ['none', 'minor'].includes(lexicalControl.clarityImpactFromLexis) &&
        ['none', 'mild'].includes(lexicalControl.repetitionImpact) &&
        ['few', 'some'].includes(lexicalControl.awkwardExpressionCountBand)
      ) {
        return "Yes";
      }
      if (
        compactSingleBodyBoundaryRescue.eligible &&
        lexicalControl.rangeBand === 'adequate' &&
        lexicalControl.precisionBand === 'mixed' &&
        lexicalControl.collocationControl === 'mixed' &&
        ['none', 'minor'].includes(lexicalControl.spellingImpact) &&
        ['none', 'minor'].includes(lexicalControl.wordFormationImpact) &&
        ['none', 'minor'].includes(lexicalControl.clarityImpactFromLexis) &&
        ['none', 'mild'].includes(lexicalControl.repetitionImpact) &&
        ['few', 'some'].includes(lexicalControl.awkwardExpressionCountBand)
      ) {
        return "Yes";
      }
      if (
        (thinBoundaryRescue.eligible || thinBoundaryMildEchoLexicalRescue) &&
        lexicalControl.rangeBand === 'adequate' &&
        lexicalControl.precisionBand === 'mixed' &&
        lexicalControl.collocationControl === 'mixed' &&
        ['none', 'minor'].includes(lexicalControl.spellingImpact) &&
        ['none', 'minor'].includes(lexicalControl.wordFormationImpact) &&
        ['none', 'minor'].includes(lexicalControl.clarityImpactFromLexis) &&
        ['none', 'mild'].includes(lexicalControl.repetitionImpact) &&
        ['few', 'some'].includes(lexicalControl.awkwardExpressionCountBand)
      ) {
        return "Yes";
      }
      if (twoIdeaSinglePartWeakCollocationBoundaryRescue) return "Yes";
      if (
        lexicalControl.rangeBand === 'adequate' &&
        lexicalControl.precisionBand === 'mixed' &&
        lexicalControl.collocationControl === 'mixed'
      ) {
        return "No";
      }
      if (
        lexicalControl.rangeBand === 'limited' ||
        (lexicalControl.collocationControl === 'weak' && !lexicalPrecisionAtLeast(lexicalControl, 'good'))
      ) {
        return "No";
      }
    }
    const uncommonSkill = ctx.step25?.lexicalQuality?.uncommonSkill;
    const precision = ctx.step25?.lexicalQuality?.precision;
    if (uncommonSkill === 'skilful') return "Yes";
    if (uncommonSkill === 'some') {
      if (precision === 'high') return "Yes";
      if (precision === 'low') return "No";
    }
    if (uncommonSkill === 'none') return "No";
    return null;
  },

  "LR6-3": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      const band = lexicalErrorBand(lexicalControl);
      if (band === 'frequent' || band === 'occasional') return "Yes";
      if (band === 'none') return "No";
      if (band === 'rare') {
        const nearPerfectLexis =
          lexicalControl.rangeBand === 'wide' &&
          lexicalControl.precisionBand === 'high' &&
          lexicalControl.collocationControl === 'good' &&
          lexicalControl.awkwardExpressionCountBand === 'none' &&
          lexicalControl.spellingImpact === 'none' &&
          lexicalControl.wordFormationImpact === 'none' &&
          lexicalControl.clarityImpactFromLexis === 'none';
        if (nearPerfectLexis) return "No";
        return "Yes";
      }
    }
    const precision = ctx.step25?.lexicalQuality?.precision;
    if (precision === 'low' || precision === 'mixed') return "Yes";
    if (precision === 'high') return "No";
    return null;
  },

  "LR6-4": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      if (
        lexicalControl.clarityImpactFromLexis === 'major' ||
        lexicalControl.spellingImpact === 'frequent' ||
        lexicalControl.wordFormationImpact === 'frequent'
      ) {
        return "impeding";
      }

      if (
        lexicalControl.spellingImpact === 'none' &&
        lexicalControl.wordFormationImpact === 'none' &&
        lexicalControl.clarityImpactFromLexis === 'none'
      ) {
        return "none";
      }

      if (
        ['none', 'minor', 'some'].includes(lexicalControl.spellingImpact) &&
        ['none', 'minor', 'some'].includes(lexicalControl.wordFormationImpact) &&
        ['none', 'minor', 'some'].includes(lexicalControl.clarityImpactFromLexis)
      ) {
        return "some_non_impeding";
      }
    }

    const lexicalProfile = ctx.step25?.errorProfiles?.lexical;
    if (lexicalProfile === 'frequent') return "impeding";
    if (lexicalProfile === 'occasional') return "some_non_impeding";
    if (lexicalProfile === 'rare') return "none";
    return null;
  },

  "LR7-1": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      const rangeStrong = lexicalRangeAtLeast(lexicalControl, 'sufficient');
      const precisionStrong = lexicalPrecisionAtLeast(lexicalControl, 'good');
      const clarityStable = lexicalClarityPreserved(lexicalControl);
      const collocationGood = lexicalControl.collocationControl === 'good';
      const collocationMixed = lexicalControl.collocationControl === 'mixed';
      const collocationUsable = collocationGood || collocationMixed;
      const awkwardControlled = ['none', 'few'].includes(lexicalControl.awkwardExpressionCountBand);
      const repetitionControlled = ['none', 'mild'].includes(lexicalControl.repetitionImpact);
      const mixedBand7Safe =
        lexicalControl.rangeBand === 'wide' &&
        lexicalControl.clarityImpactFromLexis === 'none' &&
        awkwardControlled &&
        repetitionControlled;
      if (lexicalControl.awkwardExpressionCountBand === 'many') return "No";
      if (
        rangeStrong &&
        precisionStrong &&
        clarityStable &&
        collocationGood &&
        awkwardControlled &&
        repetitionControlled
      ) {
        return "Yes";
      }
      if (rangeStrong && precisionStrong && collocationMixed) {
        return mixedBand7Safe ? "Yes" : "No";
      }
      if (rangeStrong && precisionStrong && clarityStable && collocationUsable) {
        return "No";
      }
      if (lexicalInstabilitySignalsMidBand(lexicalControl)) return "No";
      if (lexicalControl.rangeBand === 'limited' || lexicalControl.clarityImpactFromLexis === 'major') return "No";
    }
    const range = ctx.step25?.lexicalQuality?.range;
    if (range === 'wide') return "Yes";
    return null;
  },

  "LR7-2": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      const rangeStrong = lexicalRangeAtLeast(lexicalControl, 'sufficient');
      const collocationGood = lexicalControl.collocationControl === 'good';
      const collocationMixed = lexicalControl.collocationControl === 'mixed';
      const precisionUsable = lexicalPrecisionAtLeast(lexicalControl, 'good');
      const clarityStable = ['none', 'minor'].includes(lexicalControl.clarityImpactFromLexis);
      if (rangeStrong && precisionUsable && collocationGood && clarityStable) return "Yes";
      if (rangeStrong && precisionUsable && collocationMixed) {
        const mixedBand7Safe =
          lexicalControl.rangeBand === 'wide' &&
          lexicalControl.clarityImpactFromLexis === 'none' &&
          ['none', 'few'].includes(lexicalControl.awkwardExpressionCountBand) &&
          ['none', 'mild'].includes(lexicalControl.repetitionImpact);
        return mixedBand7Safe ? "Yes" : "No";
      }
      if (
        lexicalControl.rangeBand === 'limited' ||
        (lexicalControl.collocationControl === 'weak' &&
          (lexicalControl.precisionBand === 'low' ||
            lexicalControl.clarityImpactFromLexis === 'some' ||
            lexicalControl.clarityImpactFromLexis === 'major' ||
            ['some', 'many'].includes(lexicalControl.awkwardExpressionCountBand)))
      ) {
        return "No";
      }
    }
    const uncommonSkill = ctx.step25?.lexicalQuality?.uncommonSkill;
    if (uncommonSkill === 'skilful') return "Yes";
    if (uncommonSkill === 'none') return "No";
    return null;
  },

  "LR7-3": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      const band = lexicalErrorBand(lexicalControl);
      if (band === 'none') return "none";
      if (band === 'rare') return "rare";
      if (band === 'occasional') return "occasional";
      if (band === 'frequent') return "frequent";
    }

    const lexicalProfile = ctx.step25?.errorProfiles?.lexical;
    if (lexicalProfile === 'rare') return "rare";
    if (lexicalProfile === 'occasional') return "occasional";
    if (lexicalProfile === 'frequent') return "frequent";
    return null;
  },

  "LR8-1": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      const highControl =
        lexicalControl.rangeBand === 'wide' &&
        (lexicalControl.precisionBand === 'high' || lexicalControl.precisionBand === 'good') &&
        lexicalControl.collocationControl === 'good' &&
        (lexicalControl.clarityImpactFromLexis === 'none' || lexicalControl.clarityImpactFromLexis === 'minor') &&
        (lexicalControl.awkwardExpressionCountBand === 'none' || lexicalControl.awkwardExpressionCountBand === 'few') &&
        (lexicalControl.repetitionImpact === 'none' || lexicalControl.repetitionImpact === 'mild');
      if (highControl) return "Yes";
      const hasCompleteBand8Signals =
        lexicalControl.rangeBand &&
        lexicalControl.precisionBand &&
        lexicalControl.collocationControl &&
        lexicalControl.clarityImpactFromLexis &&
        lexicalControl.awkwardExpressionCountBand &&
        lexicalControl.repetitionImpact;
      if (!hasCompleteBand8Signals) return null;
      return "No";
    }

    const lexicalQuality = ctx.step25?.lexicalQuality;
    if (lexicalQuality?.range === 'wide' && lexicalQuality?.precision === 'high') return "Yes";
    if (lexicalQuality?.range === 'basic') return "No";
    return null;
  },

  "LR8-2": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      const skilledUsage =
        lexicalControl.rangeBand === 'wide' &&
        (lexicalControl.precisionBand === 'high' || lexicalControl.precisionBand === 'good') &&
        lexicalControl.collocationControl === 'good' &&
        ['none', 'minor'].includes(lexicalControl.spellingImpact) &&
        ['none', 'minor'].includes(lexicalControl.wordFormationImpact) &&
        ['none', 'minor'].includes(lexicalControl.clarityImpactFromLexis);
      if (skilledUsage) return "Yes";
      const hasCompleteBand8Signals =
        lexicalControl.rangeBand &&
        lexicalControl.precisionBand &&
        lexicalControl.collocationControl &&
        lexicalControl.spellingImpact &&
        lexicalControl.wordFormationImpact &&
        lexicalControl.clarityImpactFromLexis;
      if (!hasCompleteBand8Signals) return null;
      return "No";
    }

    const uncommonSkill = ctx.step25?.lexicalQuality?.uncommonSkill;
    if (uncommonSkill === 'skilful') return "Yes";
    if (uncommonSkill === 'none') return "No";
    return null;
  },

  "LR8-3": (ctx) => {
    const lexicalControl = lexicalControlProfile(ctx);
    if (lexicalControl) {
      const band = lexicalErrorBand(lexicalControl);
      if (band === 'none') return "none";
      if (band === 'rare') return "rare";
      if (band === 'occasional') return "occasional";
      if (band === 'frequent') return "frequent";
    }

    const lexicalProfile = ctx.step25?.errorProfiles?.lexical;
    if (lexicalProfile === 'rare') return "rare";
    if (lexicalProfile === 'occasional') return "occasional";
    if (lexicalProfile === 'frequent') return "frequent";
    return null;
  },

  "LR9-1": (ctx) => {
    const para = paragraphProfile(ctx);
    const lexicalControl = lexicalControlProfile(ctx);
    if (para.minSent <= 1 || para.paragraphCount < 4 || para.bodyCount < 2) return "No";
    if (lexicalControl) {
      if (lexicalBand9Blocked(lexicalControl)) return "No";
      if (
        lexicalShowsBand9Control(lexicalControl) &&
        lexicalControl.clarityImpactFromLexis === 'none' &&
        lexicalControl.repetitionImpact !== 'noticeable'
      ) {
        return "Yes";
      }
      if (
        lexicalControl.rangeBand === 'wide' &&
        lexicalPrecisionAtLeast(lexicalControl, 'good') &&
        lexicalControl.collocationControl === 'good'
      ) {
        return "No";
      }
    }

    const lexicalQuality = ctx.step25?.lexicalQuality;
    if (lexicalQuality?.range === 'wide' && lexicalQuality?.precision === 'high' && lexicalQuality?.uncommonSkill === 'skilful') {
      return "Yes";
    }
    if (lexicalQuality?.range === 'basic' || lexicalQuality?.precision === 'low') return "No";
    return null;
  },

  "LR9-2": (ctx) => {
    const para = paragraphProfile(ctx);
    const lexicalControl = lexicalControlProfile(ctx);
    if (para.minSent <= 1 || para.paragraphCount < 4 || para.bodyCount < 2) return "occasional";
    if (lexicalControl) {
      if (
        lexicalControl.clarityImpactFromLexis === 'major' ||
        lexicalControl.spellingImpact === 'frequent' ||
        lexicalControl.wordFormationImpact === 'frequent' ||
        lexicalControl.awkwardExpressionCountBand === 'many' ||
        lexicalControl.repetitionImpact === 'strong'
      ) {
        return "frequent";
      }

      if (lexicalBand9Blocked(lexicalControl)) return "occasional";

      if (lexicalShowsBand9Control(lexicalControl)) {
        const flawless =
          lexicalControl.spellingImpact === 'none' &&
          lexicalControl.wordFormationImpact === 'none' &&
          lexicalControl.awkwardExpressionCountBand === 'none' &&
          lexicalControl.repetitionImpact === 'none' &&
          lexicalControl.clarityImpactFromLexis === 'none';
        return flawless ? "none" : "rare_slips";
      }

      if (
        lexicalClarityPreserved(lexicalControl) &&
        ['none', 'minor'].includes(lexicalControl.spellingImpact) &&
        ['none', 'minor'].includes(lexicalControl.wordFormationImpact)
      ) {
        return "occasional";
      }
    }

    const lexicalProfile = ctx.step25?.errorProfiles?.lexical;
    if (lexicalProfile === 'frequent') return "frequent";
    if (lexicalProfile === 'occasional') return "occasional";
    if (lexicalProfile === 'rare') return "rare_slips";
    return null;
  }
};

module.exports = lrRules;
