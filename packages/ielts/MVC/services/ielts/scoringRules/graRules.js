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

const graRules = {
  "GRA1-1": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    const sentenceCount = toFiniteNumber(ctx?.step1?.stats?.sentenceCount, 0);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWordCount = lengthProfile.effectiveWordCount;

    if (grammarControl) {
      const cannotFormSentences =
        grammarControl.structureRange === 'simple_only' &&
        grammarControl.errorFrequency === 'frequent' &&
        grammarControl.errorFreeSentenceShareBand === 'very_low' &&
        grammarControl.clarityImpactFromGrammar === 'major' &&
        grammarControl.sentenceBoundaryControl === 'weak';
      if (cannotFormSentences && sentenceCount <= 2 && effectiveWordCount <= 90) return "Yes";
      if (
        grammarControl.structureRange !== 'simple_only' &&
        grammarControl.clarityImpactFromGrammar !== 'major' &&
        grammarControl.errorFrequency !== 'frequent'
      ) {
        return "No";
      }
      if (
        grammarControl.structureRange === 'simple_only' &&
        grammarControl.errorFrequency === 'frequent' &&
        grammarControl.errorFreeSentenceShareBand === 'very_low' &&
        grammarControl.sentenceBoundaryControl === 'weak'
      ) {
        return "Yes";
      }
      return "No";
    }

    const grammarProfile = String(ctx?.step25?.errorProfiles?.grammar || '').trim().toLowerCase();
    const punctuationProfile = String(ctx?.step25?.errorProfiles?.punctuation || '').trim().toLowerCase();
    if (grammarProfile === 'frequent' && punctuationProfile === 'frequent' && sentenceCount <= 2 && effectiveWordCount <= 90) return "Yes";
    return "No";
  },

  "GRA2-1": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      const weakCount = grammarWeakControlCount(grammarControl);
      const coverage = taskCoverageProfile(ctx);
      const support = bodySupportProfile(ctx);
      const stance = stanceProfile(ctx);
      const lengthProfile = taskResponseLengthProfile(ctx);
      const taskEcho = lengthProfile.taskEcho || {};
      const effectiveContentRatio = toFiniteNumber(taskEcho.effectiveContentRatio, 1);
      const almostFormulaicOnly =
        grammarControl.structureRange === 'simple_only' &&
        grammarControl.errorFrequency === 'frequent' &&
        ['very_low', 'low'].includes(grammarControl.errorFreeSentenceShareBand) &&
        weakCount >= 3 &&
        (grammarControl.sentenceBoundaryControl === 'weak' || grammarControl.clarityImpactFromGrammar === 'major');
      const singlePartRecoverableBoundary =
        almostFormulaicOnly &&
        coverage.totalParts === 1 &&
        coverage.missingPartCount === 0 &&
        coverage.totalIdeas >= 4 &&
        support.totalBodyRows >= 4 &&
        support.strongCount >= 1 &&
        support.severelyThinCount === 0 &&
        lengthProfile.effectiveWordCount >= 175 &&
        stance.hasPosition &&
        !stance.isInconsistent &&
        taskEcho.severity !== 'severe' &&
        effectiveContentRatio >= 0.82;
      if (singlePartRecoverableBoundary) return "No";
      if (almostFormulaicOnly) return "Yes";
      if (
        grammarControl.structureRange !== 'simple_only' &&
        grammarControl.errorFrequency !== 'frequent' &&
        grammarControl.clarityImpactFromGrammar !== 'major'
      ) {
        return "No";
      }
      return "No";
    }

    const grammarProfile = String(ctx?.step25?.errorProfiles?.grammar || '').trim().toLowerCase();
    const punctuationProfile = String(ctx?.step25?.errorProfiles?.punctuation || '').trim().toLowerCase();
    if (grammarProfile === 'frequent' && punctuationProfile === 'frequent') return "Yes";
    return "No";
  },

  "GRA3-1": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      const para = paragraphProfile(ctx);
      const rescue = languageCalibrationRescueProfile(ctx);
      const coverageDropoutRescue = coverageSignalDropoutRescueProfile(ctx);
      const compactBoundaryRecovery = graBand3CompactBoundaryRecoveryProfile(ctx, grammarControl);
      const compactMajorBoundaryRecovery = graBand3CompactMajorBoundaryRecoveryProfile(ctx, grammarControl);
      const coverage = taskCoverageProfile(ctx);
      const support = bodySupportProfile(ctx);
      const lengthProfile = taskResponseLengthProfile(ctx);
      const stance = stanceProfile(ctx);
      const weakCount = grammarWeakControlCount(grammarControl);
      const maxBodySent = para.bodySentenceCounts.length ? Math.max(...para.bodySentenceCounts) : 0;
      const severeBoundaryBreakdown =
        grammarControl.sentenceBoundaryControl === "weak" &&
        grammarControl.punctuationControl === "weak";
      const veryLowAccuracy = grammarControl.errorFreeSentenceShareBand === "very_low";
      const lowOrVeryLowAccuracy =
        grammarControl.errorFreeSentenceShareBand === "very_low" ||
        grammarControl.errorFreeSentenceShareBand === "low";
      const discourseSevereFloorRescue =
        hasStrongDiscourseCounterSignals(ctx) &&
        grammarControl.structureRange !== "simple_only" &&
        grammarControl.errorFrequency === "frequent" &&
        grammarControl.errorFreeSentenceShareBand === "very_low" &&
        grammarControl.clarityImpactFromGrammar === "some";
      const compactSinglePartBoundaryRescue =
        grammarControl.errorFrequency === "frequent" &&
        veryLowAccuracy &&
        grammarControl.clarityImpactFromGrammar === "some" &&
        grammarControl.structureRange !== "simple_only" &&
        weakCount === 3 &&
        coverage.totalParts === 1 &&
        coverage.missingPartCount === 0 &&
        coverage.totalIdeas >= 2 &&
        support.totalBodyRows >= 2 &&
        support.severelyThinCount === 0 &&
        support.effectiveUnderdevelopedCount <= 1 &&
        lengthProfile.effectiveWordCount >= 170 &&
        stance.hasPosition &&
        !stance.isInconsistent;
      const severeEchoAllowedForLongFormBoundary =
        lengthProfile.taskEcho.severity !== "severe" ||
        toFiniteNumber(lengthProfile.taskEcho.effectiveContentRatio, 0) >= 0.85;
      const singleBodyLongFormBoundaryRescue =
        grammarControl.errorFrequency === "frequent" &&
        veryLowAccuracy &&
        grammarControl.clarityImpactFromGrammar === "some" &&
        grammarControl.structureRange !== "simple_only" &&
        weakCount >= 3 &&
        coverage.totalParts === 1 &&
        coverage.missingPartCount === 0 &&
        coverage.totalIdeas >= 6 &&
        para.paragraphCount === 3 &&
        para.bodyCount === 1 &&
        para.hasIntro &&
        para.hasConclusion &&
        maxBodySent >= 7 &&
        support.totalBodyRows === 1 &&
        support.strongCount >= 1 &&
        support.severelyThinCount === 0 &&
        lengthProfile.effectiveWordCount >= 230 &&
        severeEchoAllowedForLongFormBoundary &&
        stance.hasPosition;
      const boundaryRecoveryEligible =
        lengthProfile.effectiveWordCount >= 245 &&
        support.totalBodyRows >= 2 &&
        support.strongCount >= 1 &&
        support.effectiveUnderdevelopedCount <= Math.max(1, support.totalBodyRows - 1) &&
        (
          coverage.totalParts === 0 ||
          (
            coverage.missingPartCount === 0 &&
            coverage.thinPartCount <= Math.max(1, Math.floor(coverage.totalParts / 2))
          )
        );
      const rescueEligibleForSevereFloor = rescue.conservativeRescueEligible
        || boundaryRecoveryEligible
        || discourseSevereFloorRescue
        || compactBoundaryRecovery.eligible
        || compactMajorBoundaryRecovery.eligible
        || compactSinglePartBoundaryRescue
        || singleBodyLongFormBoundaryRescue
        || coverageDropoutRescue.eligible
        ? grammarControl.structureRange !== "simple_only"
        : false;

      if (grammarControl.clarityImpactFromGrammar === "major") return rescueEligibleForSevereFloor ? "some" : "distort";
      if (
        grammarControl.errorFrequency === "frequent" &&
        veryLowAccuracy &&
        weakCount >= 3 &&
        severeBoundaryBreakdown
      ) {
        return rescueEligibleForSevereFloor ? "some" : "distort";
      }
      if (
        grammarControl.errorFrequency === "frequent" &&
        veryLowAccuracy &&
        weakCount >= 4
      ) {
        return rescueEligibleForSevereFloor ? "some" : "distort";
      }

      if (
        grammarControl.errorFrequency === "frequent" ||
        grammarControl.errorFrequency === "noticeable" ||
        grammarControl.clarityImpactFromGrammar === "some" ||
        grammarControl.punctuationControl === "weak" ||
        grammarControl.sentenceBoundaryControl === "weak" ||
        weakCount >= 2 ||
        lowOrVeryLowAccuracy
      ) {
        return "some";
      }

      if (
        grammarControl.errorFrequency === "rare" &&
        grammarControl.errorFreeSentenceShareBand === "high" &&
        weakCount === 0 &&
        (grammarControl.clarityImpactFromGrammar === "none" || grammarControl.clarityImpactFromGrammar === "minor")
      ) {
        return "none";
      }

      if (
        grammarControl.errorFrequency === "occasional" &&
        (grammarControl.clarityImpactFromGrammar === "none" || grammarControl.clarityImpactFromGrammar === "minor") &&
        weakCount <= 1
      ) {
        return "none";
      }

      return "some";
    }

    const grammarProfile = String(ctx?.step25?.errorProfiles?.grammar || "").trim().toLowerCase();
    const punctuationProfile = String(ctx?.step25?.errorProfiles?.punctuation || "").trim().toLowerCase();
    if (grammarProfile === "frequent" && punctuationProfile === "frequent") return "distort";
    if (grammarProfile === "frequent" || punctuationProfile === "frequent") return "some";
    if (grammarProfile === "occasional" || punctuationProfile === "occasional") return "some";
    if (grammarProfile === "rare" && punctuationProfile === "rare") return "none";
    return "some";
  },

  "GRA4-4": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      const contentRescueEligible =
        highContentLanguageBoundaryRescueEligible(ctx) &&
        grammarControl.structureRange !== "simple_only" &&
        grammarControl.complexSentenceControl === "weak" &&
        grammarControl.errorFrequency === "frequent" &&
        grammarControl.errorFreeSentenceShareBand === "very_low" &&
        (grammarControl.clarityImpactFromGrammar === "some" || grammarControl.clarityImpactFromGrammar === "major") &&
        (grammarControl.punctuationControl === "weak" || grammarControl.sentenceBoundaryControl === "weak");
      if (
        grammarSeverityBoundaryUncertain(grammarControl) &&
        grammarBoundaryDeescalationEligible(ctx, grammarControl)
      ) {
        return "No";
      }
      if (contentRescueEligible) return "No";
      if (grammarControl.punctuationControl === "weak") return "Yes";
      if (grammarControl.sentenceBoundaryControl === "weak" && grammarControl.errorFrequency !== "rare") return "Yes";
      if (
        grammarControl.errorFrequency === "frequent" &&
        (grammarControl.punctuationControl === "mixed" || grammarControl.sentenceBoundaryControl === "weak")
      ) {
        return "Yes";
      }

      if (
        grammarControl.punctuationControl === "strong" &&
        grammarControl.sentenceBoundaryControl !== "weak" &&
        grammarControl.errorFrequency !== "frequent"
      ) {
        return "No";
      }
      if (grammarControl.punctuationControl === "mixed" && ["rare", "occasional"].includes(grammarControl.errorFrequency)) {
        return "No";
      }
      return grammarControl.errorFrequency === "frequent" ? "Yes" : "No";
    }

    const punctuationProfile = String(ctx?.step25?.errorProfiles?.punctuation || "").trim().toLowerCase();
    const grammarProfile = String(ctx?.step25?.errorProfiles?.grammar || "").trim().toLowerCase();
    if (punctuationProfile === "frequent") return "Yes";
    if (punctuationProfile === "occasional") return grammarProfile === "frequent" ? "Yes" : "No";
    if (punctuationProfile === "rare") return "No";
    if (grammarProfile === "frequent") return "Yes";
    return "No";
  },

  "GRA4-1": (ctx) => {
    if (ctx.step1?.stats?.sentenceCount > 12) return "No";
    return null;
  },

  "GRA4-2": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      if (grammarRangeLimited(grammarControl) && grammarControl.complexSentenceControl === 'weak') return "Yes";
      if (grammarRangeLimited(grammarControl) && ['very_low', 'low'].includes(grammarControl.errorFreeSentenceShareBand)) return "Yes";
      if (['varied', 'wide'].includes(grammarControl.structureRange) && grammarControl.complexSentenceControl === 'good') return "No";
      if (grammarControl.structureRange === 'mixed' && grammarControl.complexSentenceControl === 'mixed') {
        const weakCount = grammarWeakControlCount(grammarControl);
        const mixedOrWeakCount = grammarMixedOrWeakControlCount(grammarControl);
        const recoverableMixedBoundary =
          grammarControl.errorFrequency === 'noticeable' &&
          (grammarControl.clarityImpactFromGrammar === 'none' || grammarControl.clarityImpactFromGrammar === 'minor') &&
          grammarControl.errorFreeSentenceShareBand !== 'very_low' &&
          mixedOrWeakCount <= 4;
        const balancedMixedLowAccuracyBoundary =
          grammarControl.errorFrequency === 'noticeable' &&
          grammarClarityStable(grammarControl) &&
          grammarControl.errorFreeSentenceShareBand === 'low' &&
          mixedOrWeakCount === 5 &&
          weakCount === 0;
        if (recoverableMixedBoundary || balancedMixedLowAccuracyBoundary) return "Yes";
        return "No";
      }
      return grammarRangeLimited(grammarControl) ? "Yes" : "No";
    }
    const grammarProfile = String(ctx?.step25?.errorProfiles?.grammar || '').trim().toLowerCase();
    if (grammarProfile === 'frequent') return "Yes";
    if (grammarProfile === 'rare') return "No";
    return null;
  },

  "GRA4-3": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      const rescue = languageCalibrationRescueProfile(ctx);
      const weakCount = grammarWeakControlCount(grammarControl);
      const mixedOrWeakCount = grammarMixedOrWeakControlCount(grammarControl);
      const lowAccuracy = grammarControl.errorFreeSentenceShareBand === 'very_low' || grammarControl.errorFreeSentenceShareBand === 'low';
      const controlledBoundary = grammarControl.punctuationControl !== 'weak' && grammarControl.sentenceBoundaryControl !== 'weak';
      const manageableNoticeableProfile = grammarControl.errorFrequency === 'noticeable'
        && (grammarControl.clarityImpactFromGrammar === 'minor' || grammarControl.clarityImpactFromGrammar === 'none')
        && controlledBoundary
        && grammarControl.complexSentenceControl !== 'weak'
        && grammarControl.structureRange !== 'simple_only'
        && weakCount <= 1
        && grammarControl.errorFreeSentenceShareBand !== 'very_low';
      const boundaryWeaknessFocused =
        grammarControl.subjectVerbAgreement !== 'weak' &&
        grammarControl.articleControl !== 'weak' &&
        grammarControl.prepositionControl !== 'weak' &&
        grammarControl.punctuationControl === 'weak' &&
        grammarControl.sentenceBoundaryControl === 'weak' &&
        weakCount <= 2 &&
        mixedOrWeakCount <= 5;
      const weakSentenceBoundaryRecoverable =
        highContentLanguageBoundaryRescueEligible(ctx) &&
        grammarControl.structureRange === 'mixed' &&
        (
          (
            grammarControl.complexSentenceControl === 'mixed' &&
            grammarControl.errorFrequency === 'noticeable' &&
            (grammarControl.clarityImpactFromGrammar === 'minor' || grammarControl.clarityImpactFromGrammar === 'none') &&
            grammarControl.errorFreeSentenceShareBand === 'low' &&
            grammarControl.sentenceBoundaryControl === 'weak' &&
            grammarControl.punctuationControl === 'mixed' &&
            weakCount <= 1 &&
            mixedOrWeakCount <= 5
          ) ||
          (
            grammarControl.complexSentenceControl === 'weak' &&
            grammarControl.errorFrequency === 'frequent' &&
            grammarControl.clarityImpactFromGrammar === 'some' &&
            grammarControl.errorFreeSentenceShareBand === 'low' &&
            boundaryWeaknessFocused
          )
        );
      const contentRescueEligible =
        highContentLanguageBoundaryRescueEligible(ctx) &&
        grammarControl.structureRange !== 'simple_only' &&
        grammarControl.complexSentenceControl === 'weak' &&
        grammarControl.errorFrequency === 'frequent' &&
        grammarControl.errorFreeSentenceShareBand === 'very_low' &&
        (grammarControl.clarityImpactFromGrammar === 'some' || grammarControl.clarityImpactFromGrammar === 'major') &&
        mixedOrWeakCount >= 3;
      if (
        grammarSeverityBoundaryUncertain(grammarControl) &&
        grammarBoundaryDeescalationEligible(ctx, grammarControl)
      ) {
        return "No";
      }
      if (contentRescueEligible) return "No";
      if (weakSentenceBoundaryRecoverable) return "No";
      if (
        manageableNoticeableProfile &&
        (
          rescue.conservativeRescueEligible ||
          grammarControl.errorFreeSentenceShareBand === 'moderate' ||
          grammarControl.errorFreeSentenceShareBand === 'high'
        )
      ) {
        return "No";
      }
      if (grammarControl.errorFrequency === 'frequent') return "Yes";
      if (
        grammarControl.errorFrequency === 'noticeable' &&
        (grammarControl.clarityImpactFromGrammar === 'some' || grammarControl.clarityImpactFromGrammar === 'major' || lowAccuracy || mixedOrWeakCount >= 3)
      ) {
        return "Yes";
      }
      if (
        (grammarControl.errorFrequency === 'rare' || grammarControl.errorFrequency === 'occasional') &&
        grammarClarityStable(grammarControl) &&
        weakCount <= 1 &&
        !lowAccuracy
      ) {
        return "No";
      }
      if (lowAccuracy && mixedOrWeakCount >= 3) return "Yes";
      return grammarControl.errorFrequency === 'noticeable' ? "Yes" : "No";
    }
    const grammarProfile = String(ctx?.step25?.errorProfiles?.grammar || '').trim().toLowerCase();
    const punctuationProfile = String(ctx?.step25?.errorProfiles?.punctuation || '').trim().toLowerCase();
    if (grammarProfile === 'frequent' || punctuationProfile === 'frequent') return "Yes";
    if (grammarProfile === 'rare' && punctuationProfile === 'rare') return "No";
    return null;
  },

  "GRA4-5": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      const rescue = languageCalibrationRescueProfile(ctx);
      const complexAttempted = grammarComplexAttempted(grammarControl);
      const weakCount = grammarWeakControlCount(grammarControl);
      const mixedOrWeakCount = grammarMixedOrWeakControlCount(grammarControl);
      const controlledBoundary = grammarControl.punctuationControl !== 'weak' && grammarControl.sentenceBoundaryControl !== 'weak';
      const manageableNoticeableProfile = grammarControl.errorFrequency === 'noticeable'
        && (grammarControl.clarityImpactFromGrammar === 'minor' || grammarControl.clarityImpactFromGrammar === 'none')
        && controlledBoundary
        && grammarControl.structureRange !== 'simple_only'
        && grammarControl.complexSentenceControl !== 'weak'
        && weakCount <= 1
        && grammarControl.errorFreeSentenceShareBand !== 'very_low';
      const moderateOrBetterAccuracy =
        grammarControl.errorFreeSentenceShareBand === 'moderate' ||
        grammarControl.errorFreeSentenceShareBand === 'high';
      if (
        grammarSeverityBoundaryUncertain(grammarControl) &&
        grammarBoundaryDeescalationEligible(ctx, grammarControl)
      ) {
        return "No";
      }
      if (
        complexAttempted &&
        manageableNoticeableProfile &&
        (rescue.conservativeRescueEligible || moderateOrBetterAccuracy || mixedOrWeakCount <= 3)
      ) {
        return "No";
      }
      if (
        complexAttempted &&
        (grammarControl.errorFrequency === 'frequent' || grammarControl.errorFrequency === 'noticeable') &&
        (grammarControl.clarityImpactFromGrammar === 'some' || grammarControl.clarityImpactFromGrammar === 'major' || grammarControl.errorFreeSentenceShareBand !== 'high')
      ) {
        return "Yes";
      }
      if (grammarControl.errorFrequency === 'rare' || grammarControl.errorFrequency === 'occasional') return "No";
      if (!complexAttempted) return "No";
      return grammarControl.errorFrequency === 'frequent' ? "Yes" : "No";
    }
    const grammarProfile = String(ctx?.step25?.errorProfiles?.grammar || '').trim().toLowerCase();
    if (grammarProfile === 'frequent') return "Yes";
    if (grammarProfile === 'rare') return "No";
    return null;
  },

  "GRA5-1": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      const coverage = taskCoverageProfile(ctx);
      const support = bodySupportProfile(ctx);
      const lengthProfile = taskResponseLengthProfile(ctx);
      const stance = stanceProfile(ctx);
      const repetition = repetitionHeuristic(ctx);

      const twoIdeaSinglePartSentenceWeakBoundaryRescue =
        highContentLanguageBoundaryRescueEligible(ctx) &&
        coverage.totalParts === 1 &&
        coverage.totalIdeas === 2 &&
        support.totalBodyRows >= 3 &&
        support.strongCount >= 1 &&
        support.effectiveUnderdevelopedCount <= 1 &&
        lengthProfile.effectiveWordCount >= 335 &&
        stance.isClear &&
        !stance.isInconsistent &&
        repetition.topCount <= 11 &&
        repetition.ratio < 0.032 &&
        grammarControl.structureRange === 'mixed' &&
        grammarControl.complexSentenceControl === 'weak' &&
        grammarControl.errorFrequency === 'frequent' &&
        grammarControl.errorFreeSentenceShareBand === 'low' &&
        grammarControl.clarityImpactFromGrammar === 'some' &&
        grammarControl.punctuationControl === 'weak' &&
        grammarControl.sentenceBoundaryControl === 'weak' &&
        grammarControl.subjectVerbAgreement !== 'weak' &&
        grammarControl.articleControl !== 'weak' &&
        grammarControl.prepositionControl !== 'weak';

      if (twoIdeaSinglePartSentenceWeakBoundaryRescue) return "No";

      const severeHighContentBoundaryRescue =
        highContentLanguageBoundaryRescueEligible(ctx) &&
        grammarControl.structureRange === 'mixed' &&
        grammarControl.complexSentenceControl === 'weak' &&
        grammarControl.errorFrequency === 'frequent' &&
        grammarControl.errorFreeSentenceShareBand === 'very_low' &&
        (grammarControl.clarityImpactFromGrammar === 'some' || grammarControl.clarityImpactFromGrammar === 'major') &&
        grammarControl.punctuationControl === 'weak' &&
        grammarControl.sentenceBoundaryControl === 'weak';
      if (severeHighContentBoundaryRescue) return "No";
      if (graBand5SentenceWeakBoundaryRecoveryEligible(ctx, grammarControl)) return "No";

      if (grammarRangeLimited(grammarControl)) return "Yes";
      if (['varied', 'wide'].includes(grammarControl.structureRange)) return "No";
      if (grammarControl.structureRange === 'mixed' && grammarControl.complexSentenceControl === 'good') return "No";
      return grammarControl.complexSentenceControl === 'weak' ? "Yes" : "No";
    }
    return null;
  },

  "GRA5-2": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      if (grammarComplexAttempted(grammarControl)) return "Yes";
      if (grammarControl.structureRange === 'simple_only' && grammarControl.complexSentenceControl === 'weak') return "No";
      return grammarControl.complexSentenceControl === 'mixed' ? "Yes" : "No";
    }
    return null;
  },

  "GRA5-3": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      const mixedOrWeakCount = grammarMixedOrWeakControlCount(grammarControl);
      const complexAttempted = grammarComplexAttempted(grammarControl);
      const strongControl =
        grammarControl.complexSentenceControl === 'good' &&
        (grammarControl.errorFrequency === 'rare' || grammarControl.errorFrequency === 'occasional') &&
        grammarClarityStable(grammarControl) &&
        mixedOrWeakCount <= 2;
      if (!complexAttempted) return "No";
      if (
        grammarControl.complexSentenceControl === 'weak' &&
        (grammarControl.errorFrequency === 'noticeable' || grammarControl.errorFrequency === 'frequent')
      ) {
        return "Yes";
      }
      if (grammarControl.clarityImpactFromGrammar === 'major' && grammarControl.errorFrequency !== 'rare') return "Yes";
      if (strongControl) return "No";
      return grammarControl.errorFrequency === 'frequent' ? "Yes" : "No";
    }
    return null;
  },

  "GRA5-6": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      const coverage = taskCoverageProfile(ctx);
      const support = bodySupportProfile(ctx);
      const lengthProfile = taskResponseLengthProfile(ctx);
      const stance = stanceProfile(ctx);
      const repetition = repetitionHeuristic(ctx);

      const twoIdeaSinglePartSentenceWeakBoundaryRescue =
        highContentLanguageBoundaryRescueEligible(ctx) &&
        coverage.totalParts === 1 &&
        coverage.totalIdeas === 2 &&
        support.totalBodyRows >= 3 &&
        support.strongCount >= 1 &&
        support.effectiveUnderdevelopedCount <= 1 &&
        lengthProfile.effectiveWordCount >= 335 &&
        stance.isClear &&
        !stance.isInconsistent &&
        repetition.topCount <= 11 &&
        repetition.ratio < 0.032 &&
        grammarControl.structureRange === 'mixed' &&
        grammarControl.complexSentenceControl === 'weak' &&
        grammarControl.errorFrequency === 'frequent' &&
        grammarControl.errorFreeSentenceShareBand === 'low' &&
        grammarControl.clarityImpactFromGrammar === 'some' &&
        grammarControl.punctuationControl === 'weak' &&
        grammarControl.sentenceBoundaryControl === 'weak' &&
        grammarControl.subjectVerbAgreement !== 'weak' &&
        grammarControl.articleControl !== 'weak' &&
        grammarControl.prepositionControl !== 'weak';
      if (twoIdeaSinglePartSentenceWeakBoundaryRescue) return "none";

      const severeHighContentBoundaryRescue =
        highContentLanguageBoundaryRescueEligible(ctx) &&
        grammarControl.structureRange === 'mixed' &&
        grammarControl.complexSentenceControl === 'weak' &&
        grammarControl.errorFrequency === 'frequent' &&
        grammarControl.errorFreeSentenceShareBand === 'very_low' &&
        (grammarControl.clarityImpactFromGrammar === 'some' || grammarControl.clarityImpactFromGrammar === 'major') &&
        grammarControl.punctuationControl === 'weak' &&
        grammarControl.sentenceBoundaryControl === 'weak';
      if (severeHighContentBoundaryRescue) return "none";

      const weakCount = grammarWeakControlCount(grammarControl);
      const clarityStrained = grammarControl.clarityImpactFromGrammar === 'some' || grammarControl.clarityImpactFromGrammar === 'major';
      if (
        grammarControl.errorFrequency === 'frequent' ||
        clarityStrained ||
        (grammarControl.errorFrequency === 'noticeable' && (grammarControl.punctuationControl === 'weak' || grammarControl.sentenceBoundaryControl === 'weak'))
      ) {
        return "some";
      }
      if (
        (grammarControl.errorFrequency === 'rare' || grammarControl.errorFrequency === 'occasional') &&
        grammarClarityStable(grammarControl) &&
        weakCount <= 2
      ) {
        return "none";
      }
      return grammarControl.errorFrequency === 'noticeable' ? "some" : "none";
    }

    const grammarProfile = String(ctx?.step25?.errorProfiles?.grammar || '').trim().toLowerCase();
    const punctuationProfile = String(ctx?.step25?.errorProfiles?.punctuation || '').trim().toLowerCase();
    if (grammarProfile === 'frequent' || punctuationProfile === 'frequent') return "some";
    if (grammarProfile === 'rare' && punctuationProfile === 'rare') return "none";
    return null;
  },

  "GRA5-4": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      const severeHighContentBoundaryRescue =
        highContentLanguageBoundaryRescueEligible(ctx) &&
        grammarControl.structureRange === 'mixed' &&
        grammarControl.complexSentenceControl === 'weak' &&
        grammarControl.errorFrequency === 'frequent' &&
        grammarControl.errorFreeSentenceShareBand === 'very_low' &&
        (grammarControl.clarityImpactFromGrammar === 'some' || grammarControl.clarityImpactFromGrammar === 'major') &&
        grammarControl.punctuationControl === 'weak' &&
        grammarControl.sentenceBoundaryControl === 'weak';
      if (severeHighContentBoundaryRescue) return "No";
      if (graBand5SentenceWeakBoundaryRecoveryEligible(ctx, grammarControl)) return "No";

      const contentBoundaryRescue =
        highContentLanguageBoundaryRescueEligible(ctx) &&
        grammarControl.errorFrequency === 'frequent' &&
        grammarControl.clarityImpactFromGrammar === 'some' &&
        grammarControl.structureRange === 'mixed' &&
        grammarControl.complexSentenceControl === 'weak' &&
        grammarControl.errorFreeSentenceShareBand === 'very_low' &&
        grammarControl.punctuationControl === 'weak' &&
        grammarControl.sentenceBoundaryControl === 'weak';
      if (contentBoundaryRescue) return "No";

      if (grammarControl.errorFrequency === 'frequent') return "Yes";
      if (grammarControl.errorFrequency === 'rare' || grammarControl.errorFrequency === 'occasional') return "No";
      if (grammarControl.errorFrequency === 'noticeable') {
        if (grammarControl.clarityImpactFromGrammar === 'some' || grammarControl.clarityImpactFromGrammar === 'major') return "Yes";
        if (grammarControl.clarityImpactFromGrammar === 'none' || grammarControl.clarityImpactFromGrammar === 'minor') return "No";
      }
    }
    const profile = ctx.step25?.errorProfiles?.grammar;
    if (profile === 'rare' || profile === 'occasional') return "No";
    if (profile === 'frequent') return "Yes";
    return null;
  },

  "GRA5-5": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      const severeHighContentBoundaryRescue =
        highContentLanguageBoundaryRescueEligible(ctx) &&
        grammarControl.structureRange === 'mixed' &&
        grammarControl.complexSentenceControl === 'weak' &&
        grammarControl.errorFrequency === 'frequent' &&
        grammarControl.errorFreeSentenceShareBand === 'very_low' &&
        (grammarControl.clarityImpactFromGrammar === 'some' || grammarControl.clarityImpactFromGrammar === 'major') &&
        grammarControl.punctuationControl === 'weak' &&
        grammarControl.sentenceBoundaryControl === 'weak';
      if (severeHighContentBoundaryRescue) return "No";
      if (graBand5SentenceWeakBoundaryRecoveryEligible(ctx, grammarControl)) return "No";

      const frequentOrNoticeable = grammarControl.errorFrequency === 'frequent' || grammarControl.errorFrequency === 'noticeable';
      const clarityStrained = grammarControl.clarityImpactFromGrammar === 'some' || grammarControl.clarityImpactFromGrammar === 'major';
      if (grammarControl.punctuationControl === 'weak' && (frequentOrNoticeable || clarityStrained)) return "Yes";
      if (grammarControl.punctuationControl === 'mixed' && grammarControl.errorFrequency === 'frequent') return "Yes";

      const clarityStable = grammarControl.clarityImpactFromGrammar === 'none' || grammarControl.clarityImpactFromGrammar === 'minor';
      if (
        (grammarControl.punctuationControl === 'strong' || grammarControl.punctuationControl === 'mixed') &&
        (grammarControl.errorFrequency === 'rare' || grammarControl.errorFrequency === 'occasional') &&
        clarityStable
      ) {
        return "No";
      }
      if (
        grammarControl.punctuationControl === 'weak' &&
        grammarControl.errorFrequency === 'rare' &&
        grammarControl.clarityImpactFromGrammar !== 'major'
      ) {
        return "No";
      }
    }

    const punctuationProfile = String(ctx?.step25?.errorProfiles?.punctuation || '').trim().toLowerCase();
    const grammarProfile = String(ctx?.step25?.errorProfiles?.grammar || '').trim().toLowerCase();
    if (punctuationProfile === 'frequent') return "Yes";
    if (punctuationProfile === 'occasional') return grammarProfile === 'frequent' ? "Yes" : "No";
    if (punctuationProfile === 'rare') return "No";
    if (grammarProfile === 'frequent') return "Yes";
    return null;
  },

  "GRA6-1": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      if (grammarControl.structureRange === 'simple_only' && grammarControl.complexSentenceControl === 'weak') return "No";
      if (
        ['mixed', 'varied', 'wide'].includes(grammarControl.structureRange) &&
        ['mixed', 'good'].includes(grammarControl.complexSentenceControl)
      ) {
        return "Yes";
      }
    }
    return null;
  },

  "GRA6-2": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      if (['occasional', 'noticeable', 'frequent'].includes(grammarControl.errorFrequency)) return "Yes";
      if (grammarControl.errorFrequency === 'rare') {
        if (
          grammarControl.errorFreeSentenceShareBand === 'high' &&
          grammarControl.clarityImpactFromGrammar === 'none' &&
          grammarWeakControlCount(grammarControl) === 0
        ) {
          return "No";
        }
        return "Yes";
      }
    }
    const profile = ctx.step25?.errorProfiles?.grammar;
    if (profile === 'occasional' || profile === 'frequent') return "Yes";
    if (profile === 'rare') return "No";
    return null;
  },

  "GRA6-3": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      const weakCount = grammarWeakControlCount(grammarControl);
      const mixedOrWeakCount = grammarMixedOrWeakControlCount(grammarControl);
      const stableClarity = grammarClarityStable(grammarControl);
      if (grammarControl.errorFrequency === 'frequent' || grammarControl.clarityImpactFromGrammar === 'major') return "often";
      if (grammarControl.errorFrequency === 'occasional') {
        if (
          stableClarity &&
          mixedOrWeakCount <= 2 &&
          (grammarControl.errorFreeSentenceShareBand === 'high' || (
            grammarControl.errorFreeSentenceShareBand === 'moderate' &&
            grammarControl.complexSentenceControl === 'good' &&
            weakCount <= 1
          ))
        ) {
          return "rarely";
        }
        return "sometimes";
      }
      if (grammarControl.errorFrequency === 'rare') {
        if (stableClarity && mixedOrWeakCount <= 2 && weakCount <= 1) return "rarely";
        return "sometimes";
      }
      if (
        grammarControl.errorFrequency === 'noticeable' ||
        grammarControl.clarityImpactFromGrammar === 'some' ||
        grammarControl.punctuationControl === 'weak' ||
        grammarControl.sentenceBoundaryControl === 'weak'
      ) {
        return "sometimes";
      }
    }
    const g = ctx.step25?.errorProfiles?.grammar;
    const p = ctx.step25?.errorProfiles?.punctuation;

    if (g === 'rare' && p === 'rare') return "rarely";
    if (g === 'frequent' || p === 'frequent') return "often";
    if (g || p) return "sometimes";
    return null;
  },

  "GRA7-1": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      const structureStrong = grammarControl.structureRange === 'varied' || grammarControl.structureRange === 'wide';
      const stableClarity = grammarControl.clarityImpactFromGrammar === 'none' || grammarControl.clarityImpactFromGrammar === 'minor';
      const weakCount = grammarWeakControlCount(grammarControl);
      const mixedOrWeakCount = grammarMixedOrWeakControlCount(grammarControl);
      const highAccuracy = grammarControl.errorFreeSentenceShareBand === 'high';
      const moderateButRareAndStable =
        grammarControl.errorFreeSentenceShareBand === 'moderate' &&
        grammarControl.errorFrequency === 'rare' &&
        mixedOrWeakCount <= 1;
      if (
        structureStrong &&
        grammarControl.complexSentenceControl === 'good' &&
        (grammarControl.errorFrequency === 'rare' || grammarControl.errorFrequency === 'occasional') &&
        stableClarity &&
        weakCount === 0 &&
        mixedOrWeakCount <= 2 &&
        (highAccuracy || moderateButRareAndStable)
      ) {
        return "Yes";
      }
      if (
        grammarControl.errorFrequency === 'occasional' &&
        grammarControl.errorFreeSentenceShareBand === 'moderate' &&
        mixedOrWeakCount >= 2
      ) {
        return "No";
      }
      if (
        (grammarControl.structureRange === 'simple_only' || grammarControl.structureRange === 'mixed') &&
        (grammarControl.complexSentenceControl === 'weak' || grammarControl.errorFrequency === 'frequent' || grammarControl.errorFrequency === 'noticeable')
      ) {
        return "No";
      }
      if (grammarControl.clarityImpactFromGrammar === 'some' || grammarControl.clarityImpactFromGrammar === 'major') return "No";
      if (grammarControl.errorFreeSentenceShareBand === 'low' || grammarControl.errorFreeSentenceShareBand === 'very_low') return "No";
      if (mixedOrWeakCount >= 4) return "No";
    }
    return null;
  },

  "GRA7-2": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      const weakCount = grammarWeakControlCount(grammarControl);
      const mixedOrWeakCount = grammarMixedOrWeakControlCount(grammarControl);
      const stableClarity = grammarControl.clarityImpactFromGrammar === 'none' || grammarControl.clarityImpactFromGrammar === 'minor';
      const thinBoundaryRescue = singlePartCoverageThinBoundaryRescueProfile(ctx);
      const longHighContentBoundaryRescue = gra7LongHighContentBoundaryRescueProfile(ctx);
      setRuleDiagnostic(ctx, 'GRA7-2', {
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
          gra7LongHighContentBoundaryRescue: {
            eligible: longHighContentBoundaryRescue.eligible,
            totalParts: longHighContentBoundaryRescue?.coverage?.totalParts ?? null,
            totalIdeas: longHighContentBoundaryRescue?.coverage?.totalIdeas ?? null,
            totalBodyRows: longHighContentBoundaryRescue?.support?.totalBodyRows ?? null,
            developedRows: longHighContentBoundaryRescue?.developedRows ?? null,
            effectiveUnderdevelopedCount: longHighContentBoundaryRescue?.support?.effectiveUnderdevelopedCount ?? null,
            severeThinBodyRows: longHighContentBoundaryRescue?.support?.severelyThinCount ?? null,
            effectiveWordCount: longHighContentBoundaryRescue?.lengthProfile?.effectiveWordCount ?? null,
            taskEchoSeverity: longHighContentBoundaryRescue?.taskEcho?.severity ?? null,
            repetitionTopCount: longHighContentBoundaryRescue?.repetition?.topCount ?? null,
            repetitionRatio: longHighContentBoundaryRescue?.repetition?.ratio ?? null,
            stanceClear: longHighContentBoundaryRescue?.stance?.isClear ?? null
          }
        },
        decisionSignals: {
          errorFrequency: grammarControl.errorFrequency,
          errorFreeSentenceShareBand: grammarControl.errorFreeSentenceShareBand,
          structureRange: grammarControl.structureRange,
          complexSentenceControl: grammarControl.complexSentenceControl,
          weakCount,
          mixedOrWeakCount,
          stableClarity,
          longHighContentBoundaryEligible: longHighContentBoundaryRescue.eligible
        }
      });
      if (grammarControl.errorFrequency === 'frequent' || grammarControl.clarityImpactFromGrammar === 'major') return "No";
      if (
        grammarControl.errorFreeSentenceShareBand === 'high' &&
        (grammarControl.errorFrequency === 'rare' || grammarControl.errorFrequency === 'occasional') &&
        weakCount <= 1 &&
        mixedOrWeakCount <= 2 &&
        stableClarity
      ) {
        return "Yes";
      }
      if (grammarControl.errorFreeSentenceShareBand === 'very_low') return "No";
      if (grammarControl.errorFreeSentenceShareBand === 'low') {
        if (
          longHighContentBoundaryRescue.eligible &&
          grammarControl.errorFrequency === 'noticeable' &&
          stableClarity &&
          ['varied', 'wide'].includes(grammarControl.structureRange) &&
          ['mixed', 'good'].includes(grammarControl.complexSentenceControl) &&
          weakCount <= 1 &&
          mixedOrWeakCount <= 3
        ) {
          return "Yes";
        }
        return "No";
      }
      if (grammarControl.errorFreeSentenceShareBand === 'moderate') {
        if (
          thinBoundaryRescue.eligible &&
          grammarControl.errorFrequency === 'occasional' &&
          weakCount === 0 &&
          mixedOrWeakCount <= 3 &&
          stableClarity &&
          ['mixed', 'varied', 'wide'].includes(grammarControl.structureRange) &&
          grammarControl.complexSentenceControl !== 'weak'
        ) {
          return "Yes";
        }
        if (
          grammarControl.errorFrequency === 'rare' &&
          weakCount <= 1 &&
          mixedOrWeakCount <= 2 &&
          stableClarity
        ) {
          return "Yes";
        }
        if (
          grammarControl.errorFrequency === 'occasional' &&
          (weakCount >= 2 || mixedOrWeakCount >= 3 || !stableClarity)
        ) {
          return "No";
        }
        if (grammarControl.errorFrequency === 'noticeable') return "No";
      }
    }
    const profile = ctx.step25?.errorProfiles?.grammar;
    if (profile === 'rare') return "Yes";
    if (profile === 'frequent') return "No";
    return null;
  },

  "GRA7-3": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      const weakCount = grammarWeakControlCount(grammarControl);
      const mixedOrWeakCount = grammarMixedOrWeakControlCount(grammarControl);
      const stableClarity = grammarControl.clarityImpactFromGrammar === 'none' || grammarControl.clarityImpactFromGrammar === 'minor';
      const highAccuracy = grammarControl.errorFreeSentenceShareBand === 'high';
      const moderateButRareAndStable =
        grammarControl.errorFreeSentenceShareBand === 'moderate' &&
        grammarControl.errorFrequency === 'rare' &&
        mixedOrWeakCount <= 1;
      if (
        stableClarity &&
        (grammarControl.errorFrequency === 'rare' || grammarControl.errorFrequency === 'occasional') &&
        weakCount === 0 &&
        mixedOrWeakCount <= 2 &&
        (highAccuracy || moderateButRareAndStable)
      ) {
        return "Yes";
      }
      if (
        grammarControl.errorFrequency === 'occasional' &&
        grammarControl.errorFreeSentenceShareBand === 'moderate' &&
        mixedOrWeakCount >= 2
      ) {
        return "No";
      }
      if (
        grammarControl.clarityImpactFromGrammar === 'major' ||
        grammarControl.errorFrequency === 'frequent' ||
        weakCount >= 3 ||
        mixedOrWeakCount >= 4
      ) {
        return "No";
      }
      if (grammarControl.errorFreeSentenceShareBand === 'low' || grammarControl.errorFreeSentenceShareBand === 'very_low') return "No";
      if (grammarControl.errorFrequency === 'occasional' && mixedOrWeakCount >= 3) return "No";
      if (grammarControl.clarityImpactFromGrammar === 'some' && (grammarControl.errorFrequency === 'noticeable' || weakCount >= 2)) {
        return "No";
      }
    }
    return null;
  },

  "GRA7-4": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      const weakCount = grammarWeakControlCount(grammarControl);
      const mixedOrWeakCount = grammarMixedOrWeakControlCount(grammarControl);
      if (
        grammarControl.errorFrequency === 'occasional' &&
        grammarControl.errorFreeSentenceShareBand === 'moderate' &&
        grammarControl.structureRange === 'varied' &&
        mixedOrWeakCount >= 3 &&
        grammarControl.clarityImpactFromGrammar === 'minor'
      ) {
        return "frequent";
      }
      if (
        grammarControl.errorFrequency === 'frequent' ||
        grammarControl.clarityImpactFromGrammar === 'major' ||
        weakCount >= 4 ||
        mixedOrWeakCount >= 5
      ) {
        return "frequent";
      }

      if (
        grammarControl.errorFrequency === 'noticeable' ||
        grammarControl.clarityImpactFromGrammar === 'some' ||
        weakCount >= 2 ||
        mixedOrWeakCount >= 3
      ) {
        return "occasional";
      }

      if (
        grammarControl.errorFrequency === 'rare' &&
        grammarControl.errorFreeSentenceShareBand === 'high' &&
        weakCount === 0 &&
        mixedOrWeakCount <= 1 &&
        grammarControl.clarityImpactFromGrammar === 'none'
      ) {
        return "none";
      }

      if ((grammarControl.errorFrequency === 'rare' || grammarControl.errorFrequency === 'occasional') && mixedOrWeakCount >= 3) {
        return "occasional";
      }
      if (grammarControl.errorFrequency === 'rare' || grammarControl.errorFrequency === 'occasional') {
        return "few";
      }
    }
    return null;
  },

  "GRA8-1": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      const weakCount = grammarWeakControlCount(grammarControl);
      const mixedOrWeakCount = grammarMixedOrWeakControlCount(grammarControl);
      const stableClarity = grammarControl.clarityImpactFromGrammar === 'none' || grammarControl.clarityImpactFromGrammar === 'minor';
      const highStructureRange = grammarControl.structureRange === 'wide' || grammarControl.structureRange === 'varied';
      const highShare = grammarControl.errorFreeSentenceShareBand === 'high';
      const moderateShare = grammarControl.errorFreeSentenceShareBand === 'moderate';
      if (
        highStructureRange &&
        grammarControl.complexSentenceControl === 'good' &&
        stableClarity &&
        ['rare', 'occasional'].includes(grammarControl.errorFrequency) &&
        (highShare || moderateShare) &&
        weakCount === 0 &&
        mixedOrWeakCount <= (highShare ? 1 : 0)
      ) {
        return "Yes";
      }
      if (
        grammarControl.structureRange === 'varied' &&
        grammarControl.complexSentenceControl === 'good' &&
        stableClarity &&
        grammarControl.errorFrequency === 'occasional' &&
        moderateShare &&
        mixedOrWeakCount >= 2
      ) {
        return "No";
      }
      if (
        grammarControl.errorFrequency === 'noticeable' ||
        grammarControl.errorFreeSentenceShareBand === 'low' ||
        grammarControl.errorFreeSentenceShareBand === 'very_low' ||
        mixedOrWeakCount >= 3
      ) {
        return "No";
      }
      if (
        grammarControl.structureRange === 'simple_only' ||
        grammarControl.complexSentenceControl === 'weak' ||
        grammarControl.clarityImpactFromGrammar === 'major'
      ) {
        return "No";
      }
    }
    return null;
  },

  "GRA8-2": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      const weakCount = grammarWeakControlCount(grammarControl);
      if (grammarControl.errorFrequency === 'frequent' || grammarControl.clarityImpactFromGrammar === 'major') return "No";

      if (
        grammarControl.errorFreeSentenceShareBand === 'high' &&
        (grammarControl.errorFrequency === 'rare' || grammarControl.errorFrequency === 'occasional') &&
        (grammarControl.clarityImpactFromGrammar === 'none' || grammarControl.clarityImpactFromGrammar === 'minor') &&
        weakCount <= 1
      ) {
        return "Yes";
      }

      if (grammarControl.errorFreeSentenceShareBand === 'low' || grammarControl.errorFreeSentenceShareBand === 'very_low') {
        return "No";
      }
    }
    return null;
  },

  "GRA8-3": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      const weakCount = grammarWeakControlCount(grammarControl);
      if (
        grammarControl.errorFrequency === 'frequent' ||
        grammarControl.clarityImpactFromGrammar === 'major' ||
        weakCount >= 4
      ) {
        return "frequent";
      }

      if (
        grammarControl.errorFrequency === 'noticeable' ||
        grammarControl.clarityImpactFromGrammar === 'some' ||
        weakCount >= 2
      ) {
        return "occasional";
      }

      if (
        grammarControl.errorFrequency === 'rare' &&
        grammarControl.errorFreeSentenceShareBand === 'high' &&
        weakCount === 0 &&
        grammarControl.clarityImpactFromGrammar === 'none'
      ) {
        return "none";
      }

      if (grammarControl.errorFrequency === 'rare' || grammarControl.errorFrequency === 'occasional') {
        return "very_occasional";
      }
    }
    return null;
  },

  "GRA9-1": (ctx) => {
    const para = paragraphProfile(ctx);
    const grammarControl = grammarControlProfile(ctx);
    if (para.minSent <= 1 || para.paragraphCount < 4 || para.bodyCount < 2) return "No";
    if (grammarControl) {
      const weakCount = grammarWeakControlCount(grammarControl);
      if (grammarShowsBand9Control(grammarControl) && grammarControl.clarityImpactFromGrammar === 'none') {
        return "Yes";
      }
      if (
        grammarControl.structureRange !== 'wide' ||
        grammarControl.complexSentenceControl !== 'good' ||
        grammarControl.errorFrequency !== 'rare' ||
        grammarControl.errorFreeSentenceShareBand !== 'high' ||
        weakCount >= 1 ||
        ['some', 'major'].includes(grammarControl.clarityImpactFromGrammar)
      ) {
        return "No";
      }
    }

    const grammarProfile = ctx.step25?.errorProfiles?.grammar;
    const punctuationProfile = ctx.step25?.errorProfiles?.punctuation;
    if (grammarProfile === 'rare' && punctuationProfile === 'rare') return "Yes";
    if (grammarProfile === 'frequent' || punctuationProfile === 'frequent') return "No";
    return null;
  },

  "GRA9-2": (ctx) => {
    const grammarControl = grammarControlProfile(ctx);
    if (grammarControl) {
      const weakCount = grammarWeakControlCount(grammarControl);
      if (
        grammarControl.errorFrequency === 'frequent' ||
        grammarControl.clarityImpactFromGrammar === 'major' ||
        weakCount >= 3
      ) {
        return "frequent";
      }
      if (
        grammarControl.errorFrequency === 'noticeable' ||
        grammarControl.clarityImpactFromGrammar === 'some' ||
        weakCount >= 2
      ) {
        return "occasional";
      }

      if (
        grammarControl.errorFrequency === 'occasional' ||
        grammarControl.errorFreeSentenceShareBand === 'moderate' ||
        grammarControl.clarityImpactFromGrammar === 'minor' ||
        weakCount === 1
      ) {
        return "very_occasional";
      }

      if (grammarControl.errorFrequency === 'rare' && grammarControl.errorFreeSentenceShareBand === 'high' && weakCount === 0) {
        const flawless =
          grammarControl.clarityImpactFromGrammar === 'none' &&
          grammarControl.subjectVerbAgreement === 'strong' &&
          grammarControl.articleControl === 'strong' &&
          grammarControl.prepositionControl === 'strong' &&
          grammarControl.punctuationControl === 'strong' &&
          grammarControl.sentenceBoundaryControl === 'strong';
        return flawless ? "none" : "rare_slips";
      }
    }

    const grammarProfile = ctx.step25?.errorProfiles?.grammar;
    const punctuationProfile = ctx.step25?.errorProfiles?.punctuation;
    if (grammarProfile === 'frequent' || punctuationProfile === 'frequent') return "frequent";
    if (grammarProfile === 'occasional' || punctuationProfile === 'occasional') return "occasional";
    if (grammarProfile === 'rare' && punctuationProfile === 'rare') return "rare_slips";
    return null;
  }
};

module.exports = graRules;
