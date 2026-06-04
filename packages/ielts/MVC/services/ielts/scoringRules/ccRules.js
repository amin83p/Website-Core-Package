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

const ccRules = {
  "CC4-1": (ctx) => {
    const para = paragraphProfile(ctx);
    const topicCoverage = paragraphTopicCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const cohesion = cohesionQualityProfile(ctx);
    const segmentationLikelyCollapsed = collapsedParagraphSegmentationLikely(ctx);
    const sectionedResponse = para.paragraphCount >= 4 && para.hasIntro && para.hasConclusion && para.bodyCount >= 2;
    const hasBodyEvidence = support.rows.some((row) => (
      row.hasExplanation || row.hasExample || row.evidenceCount >= 2
    ));
    const hasTopicSignal = topicCoverage.bodyTopicCount >= 1;
    const hasCohesionSignal = cohesion.strongProgression || cohesion.balancedCohesion || (
      cohesion.distinctExBasic >= 3 &&
      cohesion.maxConnectorRepeat <= 3 &&
      !cohesion.lowCohesionGuidance &&
      !cohesion.weakReferencing
    );

    if (para.paragraphCount <= 1) return segmentationLikelyCollapsed ? "No" : "Yes";
    if (para.paragraphCount === 2 && (!para.hasConclusion || para.minSent <= 1)) {
      if (segmentationLikelyCollapsed && (hasBodyEvidence || hasTopicSignal || hasCohesionSignal)) return "No";
      return "Yes";
    }
    if (
      (cohesion.weakParagraphLogic && cohesion.weakTopicCoverage) ||
      (topicCoverage.bodyParagraphCount >= 2 && topicCoverage.bodyTopicCoverageRatio < 0.34 && support.strongCount === 0)
    ) {
      return "Yes";
    }
    if (
      sectionedResponse &&
      topicCoverage.bodyParagraphCount >= 2 &&
      topicCoverage.bodyTopicCoverageRatio >= 0.5 &&
      !cohesion.weakParagraphLogic
    ) {
      return "No";
    }
    if (cohesion.strongProgression || cohesion.balancedCohesion) return "No";
    return null;
  },

  "CC4-3": (ctx) => {
    const cohesion = cohesionQualityProfile(ctx);
    const thinConclusionRecovery = ccThinConclusionRecoveryProfile(ctx);
    if (thinConclusionRecovery.eligible && !cohesion.mechanicalCohesion && !cohesion.weakReferencing) return "No";
    const severeInaccuracy =
      (cohesion.maxConnectorRepeat >= 5 && cohesion.distinctExBasic <= 2 && cohesion.densityExBasic >= 2.8) ||
      (cohesion.weakReferencing && cohesion.repetition.topCount >= 7 && cohesion.repetition.ratio >= 0.024) ||
      (cohesion.lowCohesionGuidance && cohesion.weakParagraphLogic && !thinConclusionRecovery.eligible) ||
      (cohesion.mechanicalCohesion && cohesion.referencingDensity < 1.3);
    if (severeInaccuracy) return "Yes";

    const stableControl =
      cohesion.balancedCohesion &&
      cohesion.maxConnectorRepeat <= 3 &&
      cohesion.distinctExBasic >= 3 &&
      cohesion.referencingDensity >= 1.2 &&
      !cohesion.lowCohesionGuidance &&
      !cohesion.weakReferencing;
    if (stableControl) return "No";

    if (cohesion.heavyRepetition && cohesion.referencingDensity < 1.1) return "Yes";
    if (
      !cohesion.mechanicalCohesion &&
      cohesion.distinctExBasic >= 4 &&
      cohesion.maxConnectorRepeat <= 3 &&
      cohesion.referencingDensity >= 1.3
    ) {
      return "No";
    }

    if (thinConclusionRecovery.eligible) return "No";
    return (cohesion.mechanicalCohesion || cohesion.lowCohesionGuidance) ? "Yes" : "No";
  },

  "CC4-5": (ctx) => {
    const p = paragraphProfile(ctx);
    const segmentationLikelyCollapsed = collapsedParagraphSegmentationLikely(ctx);
    if (p.paragraphCount <= 1) return segmentationLikelyCollapsed ? "ok" : "absent";
    if (p.paragraphCount === 2) return segmentationLikelyCollapsed ? "ok" : "confusing";
    return "ok";
  },

  "CC4-2": (ctx) => {
    const cohesion = cohesionQualityProfile(ctx);
    const thinConclusionRecovery = ccThinConclusionRecoveryProfile(ctx);
    if (thinConclusionRecovery.eligible && !cohesion.mechanicalCohesion) return "No";
    if ((cohesion.weakParagraphLogic && cohesion.weakTopicCoverage) || (cohesion.lowCohesionGuidance && cohesion.weakParagraphLogic)) {
      if (thinConclusionRecovery.eligible) return "No";
      return "Yes";
    }
    if (cohesion.strongProgression && cohesion.balancedCohesion) return "No";
    return thinConclusionRecovery.eligible ? "No" : null;
  },

  "CC4-4": (ctx) => {
    const cohesion = cohesionQualityProfile(ctx);
    const recovery = ccHigherBandSupportRecoveryProfile(ctx);
    const thinConclusionRecovery = ccThinConclusionRecoveryProfile(ctx);
    if (cohesion.mechanicalCohesion) return "Yes";
    if (
      cohesion.heavyRepetition &&
      !thinConclusionRecovery.eligible &&
      (cohesion.weakReferencing || cohesion.maxConnectorRepeat >= 4 || cohesion.referencingDensity < 1.3)
    ) {
      return "Yes";
    }
    if (
      cohesion.weakParagraphLogic &&
      !thinConclusionRecovery.eligible &&
      !recovery.oneThinConclusionRecoverable &&
      (cohesion.lowCohesionGuidance || cohesion.maxConnectorRepeat >= 4 || cohesion.weakReferencing)
    ) {
      return "Yes";
    }
    if (cohesion.maxConnectorRepeat >= 4 && cohesion.densityExBasic >= 3.2 && cohesion.distinctExBasic <= 4) return "Yes";
    if (!cohesion.heavyRepetition && cohesion.maxConnectorRepeat <= 2 && cohesion.repetition.topCount <= 4) return "No";
    if (
      recovery.strongBodyRecovery &&
      cohesion.distinctExBasic >= 5 &&
      cohesion.maxConnectorRepeat <= 4 &&
      !cohesion.weakReferencing
    ) {
      return "No";
    }
    if (
      cohesion.distinctExBasic >= 4 &&
      cohesion.referencingDensity >= 1.2 &&
      cohesion.maxConnectorRepeat <= 4 &&
      !cohesion.weakReferencing
    ) {
      return "No";
    }
    if (thinConclusionRecovery.eligible) return "No";
    return (cohesion.lowCohesionGuidance || cohesion.weakReferencing) ? "Yes" : "No";
  },

  "CC1-1": (ctx) => {
    const para = paragraphProfile(ctx);
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWordCount = lengthProfile.effectiveWordCount;
    const sentenceCount = toFiniteNumber(ctx?.step1?.stats?.sentenceCount, 0);
    const rawText = String(ctx?.essay?.normalizedText || ctx?.essay?.rawText || "").trim();
    const letterTokens = (rawText.match(/[A-Za-z]+/g) || []).length;

    const communicationCollapsed =
      effectiveWordCount > 0 &&
      effectiveWordCount <= 15 &&
      sentenceCount <= 1 &&
      letterTokens <= 20;
    const noTaskSignal =
      coverage.totalIdeas === 0 &&
      coverage.addressedPartCount === 0 &&
      support.totalBodyRows === 0;
    const almostNoCoherentStructure =
      para.paragraphCount <= 1 &&
      sentenceCount <= 1 &&
      effectiveWordCount <= 25;

    if (communicationCollapsed) return "Yes";
    if (noTaskSignal && almostNoCoherentStructure) return "Yes";

    if (effectiveWordCount >= 30) return "No";
    if (sentenceCount >= 2) return "No";
    if (coverage.totalIdeas >= 1) return "No";
    if (support.totalBodyRows >= 1) return "No";
    return "No";
  },

  "CC2-1A": (ctx) => {
    const p = paragraphProfile(ctx);
    const topicCoverage = paragraphTopicCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const segmentationLikelyCollapsed = collapsedParagraphSegmentationLikely(ctx);
    const hasSectionSkeleton = p.paragraphCount >= 4 && p.hasIntro && p.hasConclusion && p.bodyCount >= 2;
    const hasBodyEvidence = support.rows.some((row) => (
      row.hasExplanation || row.hasExample || row.evidenceCount > 0
    ));

    if (p.paragraphCount <= 1) return segmentationLikelyCollapsed ? "No" : "Yes";
    if (p.paragraphCount === 2 && (!p.hasConclusion || p.minSent <= 1)) {
      if (segmentationLikelyCollapsed && (hasBodyEvidence || topicCoverage.bodyTopicCount >= 1)) return "No";
      return "Yes";
    }
    if (
      hasSectionSkeleton &&
      (
        hasBodyEvidence ||
        topicCoverage.bodyParagraphCount === 0 ||
        topicCoverage.bodyTopicCount >= 1
      )
    ) {
      return "No";
    }
    if (p.paragraphCount >= 4 && p.hasIntro && p.hasConclusion && p.bodyCount >= 2 && p.minSent >= 2) return "No";
    return null;
  },

  "CC2-1B": (ctx) => {
    const role = getCurrentParagraphRole(ctx);
    if (role && role !== "body") return null;
    const sentenceCount = getCurrentParagraphSentenceCount(ctx);
    if (!Number.isInteger(sentenceCount)) return null;
    if (sentenceCount <= 1) {
      const p = paragraphProfile(ctx);
      const topicCoverage = paragraphTopicCoverageProfile(ctx);
      const current = currentParagraphProfile(ctx);
      const support = current?.bodySupport || {};
      const evidenceCount = Array.isArray(support?.evidenceSentenceIndices) ? support.evidenceSentenceIndices.length : 0;
      const paragraphWordCount = toFiniteNumber(current?.feature?.paragraphWordCount, countWordsSimple(current?.text || ""));
      const virtualSentenceCount = toFiniteNumber(current?.feature?.virtualSentenceCount, 0);
      const runOnLikely = paragraphWordCount >= 55 || virtualSentenceCount >= 1;
      const hasBodySignal = Number.isInteger(current?.topicSentence?.topicSentenceIndex)
        || Boolean(support?.hasExplanation)
        || Boolean(support?.hasExample)
        || evidenceCount > 0;
      const hasSectionSkeleton = p.paragraphCount >= 4 && p.hasIntro && p.hasConclusion && p.bodyCount >= 2;
      if (!hasSectionSkeleton) return "Yes";
      if (!hasBodySignal && !runOnLikely && topicCoverage.bodyTopicCoverageRatio < 0.34) return "Yes";
      if (!hasBodySignal && runOnLikely && topicCoverage.bodyTopicCoverageRatio < 0.2) return "Yes";
      return null;
    }
    if (sentenceCount >= 4) return "No";
    return null;
  },

  "CC3-1A": (ctx) => {
    const p = paragraphProfile(ctx);
    const support = bodySupportProfile(ctx);
    const topicCoverage = paragraphTopicCoverageProfile(ctx);
    const cohesion = cohesionQualityProfile(ctx);
    const segmentationLikelyCollapsed = collapsedParagraphSegmentationLikely(ctx);
    const hasSectionSkeleton = p.paragraphCount >= 4 && p.hasIntro && p.hasConclusion && p.bodyCount >= 2;
    if (p.paragraphCount <= 1) return segmentationLikelyCollapsed ? "No" : "Yes";
    if (p.paragraphCount === 2 && (!p.hasConclusion || p.minSent <= 1)) {
      return segmentationLikelyCollapsed ? "No" : "Yes";
    }

    const topics = Array.isArray(ctx?.step25?.topicSentenceByParagraph) ? ctx.step25.topicSentenceByParagraph : [];
    if (topics.length > 0) {
      const topicCount = topics.filter((row) => Number.isInteger(row?.topicSentenceIndex)).length;
      if (p.bodyCount >= 1 && topicCount === 0 && !hasSectionSkeleton) return "Yes";
      if (p.bodyCount >= 2 && topicCount >= 2 && p.hasIntro && p.hasConclusion && p.minSent >= 2) return "No";
    }
    if (
      hasSectionSkeleton &&
      p.minSent <= 1 &&
      !cohesion.runOnStructureLikely &&
      support.totalBodyRows <= 1 &&
      (topicCoverage.bodyTopicCoverageRatio < 0.34 || cohesion.weakTopicCoverage) &&
      (cohesion.repetition.topCount >= 7 || cohesion.referencingDensity >= 4.5)
    ) {
      return "Yes";
    }
    if (
      hasSectionSkeleton &&
      p.minSent <= 1 &&
      cohesion.runOnStructureLikely &&
      support.totalBodyRows >= 2 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      (topicCoverage.bodyTopicCount >= 1 || !cohesion.lowCohesionGuidance) &&
      !cohesion.mechanicalCohesion
    ) {
      return "No";
    }

    if (p.paragraphCount >= 4 && p.hasIntro && p.hasConclusion && p.bodyCount >= 2 && p.minSent >= 2) return "No";
    return null;
  },

  "CC3-1B": (ctx) => {
    const signals = currentParagraphSupportSignals(ctx);
    if (!signals) return "Yes";
    if (signals.role && signals.role !== "body") return null;

    const noTopicAndNoSupport = !signals.hasTopicSentence && !signals.hasSupportProgression;
    const topicWithoutProgress = signals.hasTopicSentence && !signals.hasSupportProgression && signals.evidenceCount <= 1;
    const severelyThinBody = signals.veryThin && !signals.hasAnySupportSignal;

    if (severelyThinBody) return "Yes";
    if (noTopicAndNoSupport) return "Yes";
    if (topicWithoutProgress && !signals.runOnLikely) return "Yes";
    if (!signals.hasTopicSentence && signals.evidenceCount <= 1 && !signals.hasExplanation && !signals.hasExample) return "Yes";

    if (signals.hasTopicSentence && signals.hasSupportProgression) return "No";
    if (signals.hasAnySupportSignal && (signals.sentenceCount >= 2 || signals.runOnLikely || signals.paragraphWordCount >= 55)) return "No";

    return signals.hasAnySupportSignal ? "No" : "Yes";
  },

  "CC3-2": (ctx) => {
    const para = paragraphProfile(ctx);
    const cohesion = cohesionQualityProfile(ctx);
    const topicCoverage = paragraphTopicCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const segmentationLikelyCollapsed = collapsedParagraphSegmentationLikely(ctx);

    const sectionedStructure =
      para.paragraphCount >= 3 &&
      para.bodyCount >= 1 &&
      (para.hasIntro || para.hasConclusion);
    const hasBodySignal =
      support.totalBodyRows >= 1 ||
      topicCoverage.bodyTopicCount >= 1 ||
      topicCoverage.bodyTopicCoverageRatio >= 0.34;
    const clearDiscourseSignal =
      cohesion.strongProgression ||
      cohesion.balancedCohesion ||
      (
        cohesion.distinctExBasic >= 2 &&
        cohesion.maxConnectorRepeat <= 4 &&
        !cohesion.weakParagraphLogic
      );
    const clearCoherentStructure = (sectionedStructure || segmentationLikelyCollapsed) && hasBodySignal && clearDiscourseSignal;

    const clearWeakCohesion =
      para.paragraphCount <= 1 &&
      !segmentationLikelyCollapsed &&
      !hasBodySignal &&
      (cohesion.weakParagraphLogic || cohesion.weakTopicCoverage || cohesion.lowCohesionGuidance);

    if (clearCoherentStructure) return "No";
    if (clearWeakCohesion) return "Yes";
    return null;
  },

  "CC5-1": (ctx) => {
    const para = paragraphProfile(ctx);
    const cohesion = cohesionQualityProfile(ctx);
    const topicCoverage = paragraphTopicCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const segmentationLikelyCollapsed = collapsedParagraphSegmentationLikely(ctx);

    const sectionedStructure =
      para.paragraphCount >= 3 &&
      para.bodyCount >= 1 &&
      (para.hasIntro || para.hasConclusion);
    const hasBodySignal =
      support.totalBodyRows >= 1 ||
      topicCoverage.bodyTopicCount >= 1 ||
      topicCoverage.bodyTopicCoverageRatio >= 0.34;
    const clearDiscourseSignal =
      cohesion.strongProgression ||
      cohesion.balancedCohesion ||
      (
        cohesion.distinctExBasic >= 2 &&
        cohesion.maxConnectorRepeat <= 4 &&
        !cohesion.weakParagraphLogic
      );

    if ((sectionedStructure && hasBodySignal) || clearDiscourseSignal || segmentationLikelyCollapsed) return "Yes";

    const chaoticSingleBlock =
      para.paragraphCount <= 1 &&
      !segmentationLikelyCollapsed &&
      !hasBodySignal &&
      (cohesion.weakParagraphLogic || cohesion.weakTopicCoverage || cohesion.lowCohesionGuidance);
    if (chaoticSingleBlock) return "No";
    if (para.paragraphCount <= 1 && support.totalBodyRows === 0 && topicCoverage.bodyTopicCount === 0) return "No";
    return "Yes";
  },

  "CC5-2": (ctx) => {
    const cohesion = cohesionQualityProfile(ctx);
    const para = paragraphProfile(ctx);
    const topicCoverage = paragraphTopicCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const structure = (ctx?.step2?.structure && typeof ctx.step2.structure === "object")
      ? ctx.step2.structure
      : {};
    const roles = Array.isArray(structure?.paragraphRoles) ? structure.paragraphRoles : [];
    const counts = Array.isArray(para.counts) ? para.counts : [];
    const thinParagraphIndices = counts
      .map((count, index) => (toFiniteNumber(count, 0) <= 1 ? index : null))
      .filter((index) => Number.isInteger(index));
    const oneThinConclusionOnly = thinParagraphIndices.length === 1
      && String(roles[thinParagraphIndices[0]] || "").toLowerCase() === "conclusion";
    const oneThinBodyOnly = thinParagraphIndices.length === 1
      && String(roles[thinParagraphIndices[0]] || "").toLowerCase() === "body";
    const developedRows = developedBodyRowCount(support);
    const recovery = ccHigherBandSupportRecoveryProfile(ctx);
    const ccMidRecovery = ccMidBandThinConclusionRecoveryProfile(ctx);
    const ccOverlinkRecovery = ccBand5OverlinkRecoveryProfile(ctx);

    if (ccMidRecovery.eligible) return "No";
    if (cohesion.weakParagraphLogic || cohesion.weakTopicCoverage) {
      const runOnBodyBoundaryRecovery =
        oneThinBodyOnly &&
        !oneThinConclusionOnly &&
        para.paragraphCount >= 5 &&
        para.hasIntro &&
        para.hasConclusion &&
        para.bodyCount >= 3 &&
        support.totalBodyRows >= 3 &&
        developedRows >= 2 &&
        support.effectiveUnderdevelopedCount <= 1 &&
        topicCoverage.bodyParagraphCount >= 3 &&
        topicCoverage.bodyTopicCoverageRatio >= 0.67 &&
        cohesion.repetition.topCount >= 9 &&
        cohesion.referencingDensity >= 4.5 &&
        cohesion.distinctExBasic >= 4 &&
        cohesion.maxConnectorRepeat <= 2 &&
        !cohesion.lowCohesionGuidance &&
        !cohesion.mechanicalCohesion;
      if (runOnBodyBoundaryRecovery) return "No";
      const recoverableWeakness = (
        cohesion.weakParagraphLogic
        && recovery.oneThinConclusionRecoverable
        && !cohesion.lowCohesionGuidance
      ) || (
        cohesion.weakTopicCoverage
        && recovery.topicCoverageLikelyUnderDetected
      );
      if (!recoverableWeakness) return "Yes";
    }
    if (
      cohesion.repetition.topCount >= 8 &&
      cohesion.repetition.ratio >= 0.028 &&
      (cohesion.maxConnectorRepeat >= 3 || cohesion.referencingDensity >= 4.5)
    ) {
      if (ccOverlinkRecovery.eligible) return "No";
      return "Yes";
    }
    if (cohesion.mechanicalCohesion && cohesion.maxConnectorRepeat >= 4) return "Yes";
    if (
      para.paragraphCount >= 4 &&
      para.hasIntro &&
      para.hasConclusion &&
      support.totalBodyRows >= 2 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      topicCoverage.bodyParagraphCount >= 2 &&
      topicCoverage.bodyTopicCoverageRatio >= 0.5 &&
      cohesion.maxConnectorRepeat <= 4 &&
      cohesion.repetition.ratio < 0.035 &&
      !cohesion.mechanicalCohesion
    ) {
      return "No";
    }
    if (cohesion.lowCohesionGuidance && cohesion.referencingDensity < 1.1) return "Yes";

    if (cohesion.strongProgression && cohesion.balancedCohesion) return "No";
    if (
      recovery.strongBodyRecovery &&
      (recovery.oneThinConclusionRecoverable || recovery.topicCoverageLikelyUnderDetected) &&
      cohesion.distinctExBasic >= 4 &&
      cohesion.maxConnectorRepeat <= 4
    ) {
      return "No";
    }
    if (
      para.paragraphCount >= 4 &&
      para.bodyCount >= 2 &&
      para.hasIntro &&
      para.hasConclusion &&
      para.minSent >= 2 &&
      topicCoverage.bodyParagraphCount >= 2 &&
      topicCoverage.bodyTopicCoverageRatio >= 0.67 &&
      support.totalBodyRows >= 2 &&
      support.effectiveUnderdevelopedCount <= Math.max(1, support.totalBodyRows - 1) &&
      cohesion.referencingDensity >= 1.2 &&
      cohesion.maxConnectorRepeat <= 3
    ) {
      return "No";
    }
    if (cohesion.strongProgression && cohesion.repetition.ratio < 0.028 && cohesion.maxConnectorRepeat <= 3) return "No";
    if (ccOverlinkRecovery.eligible) return "No";

    return cohesion.strongProgression ? "No" : "Yes";
  },

  "CC5-3": (ctx) => {
    const cohesion = cohesionQualityProfile(ctx);
    if (
      cohesion.lowCohesionGuidance ||
      (cohesion.densityExBasic < 1.0 && cohesion.distinctExBasic < 2 && cohesion.referencingDensity < 1.2)
    ) {
      return "Yes";
    }
    if (
      cohesion.balancedCohesion &&
      cohesion.densityExBasic >= 1.2 &&
      cohesion.distinctExBasic >= 3 &&
      cohesion.referencingDensity >= 1.2
    ) {
      return "No";
    }
    if (cohesion.strongProgression && cohesion.maxConnectorRepeat <= 3) return "No";
    if (
      cohesion.weakParagraphLogic &&
      (cohesion.weakTopicCoverage || cohesion.referencingDensity < 1.1) &&
      cohesion.distinctExBasic <= 2
    ) {
      return "Yes";
    }
    if (
      cohesion.distinctExBasic >= 3 &&
      cohesion.referencingDensity >= 1.25 &&
      cohesion.maxConnectorRepeat <= 4 &&
      cohesion.densityExBasic >= 1.1
    ) {
      return "No";
    }
    return (cohesion.lowCohesionGuidance || cohesion.distinctExBasic <= 1) ? "Yes" : "No";
  },

  "CC5-4": (ctx) => {
    const cohesion = cohesionQualityProfile(ctx);
    const blockers = ccMidBandBlockerProfile(ctx);
    const recovery = ccHigherBandSupportRecoveryProfile(ctx);
    const ccMidRecovery = ccMidBandThinConclusionRecoveryProfile(ctx);
    const ccOverlinkRecovery = ccBand5OverlinkRecoveryProfile(ctx);
    const para = paragraphProfile(ctx);
    const support = bodySupportProfile(ctx);
    const topicCoverage = paragraphTopicCoverageProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const structure = (ctx?.step2?.structure && typeof ctx.step2.structure === "object")
      ? ctx.step2.structure
      : {};
    const developedRows = developedBodyRowCount(support);
    if (ccMidRecovery.eligible) return "No";
    if (blockers.cc56Blocker) {
      const lowGuidanceHighReferenceBoundaryRecovery =
        para.paragraphCount >= 5 &&
        para.hasIntro &&
        para.hasConclusion &&
        para.bodyCount >= 3 &&
        support.totalBodyRows >= 3 &&
        developedRows >= 3 &&
        support.effectiveUnderdevelopedCount <= 1 &&
        topicCoverage.bodyParagraphCount >= 3 &&
        topicCoverage.bodyTopicCoverageRatio >= 0.67 &&
        lengthProfile.effectiveWordCount >= 290 &&
        cohesion.lowCohesionGuidance &&
        cohesion.distinctExBasic <= 1 &&
        cohesion.maxConnectorRepeat <= 2 &&
        cohesion.referencingDensity >= 4.8 &&
        !cohesion.mechanicalCohesion &&
        !cohesion.weakReferencing &&
        !Boolean(structure?.misplacedConclusionSignpost);
      const blockerRecoverable = recovery.strongBodyRecovery
        && cohesion.distinctExBasic >= 4
        && cohesion.referencingDensity >= 1.2
        && !cohesion.mechanicalCohesion
        && !cohesion.weakReferencing
        && ccOverlinkRecovery.eligible;
      if (lowGuidanceHighReferenceBoundaryRecovery) return "No";
      if (blockerRecoverable) return "No";
      return "Yes";
    }
    if (
      (cohesion.maxConnectorRepeat >= 5 && cohesion.distinctExBasic <= 2 && cohesion.densityExBasic >= 3.6) ||
      (cohesion.maxConnectorRepeat >= 4 && cohesion.distinctExBasic <= 3 && cohesion.densityExBasic >= 3.0) ||
      (cohesion.lowCohesionGuidance && cohesion.weakTopicCoverage && cohesion.referencingDensity < 1.1)
    ) {
      if (ccOverlinkRecovery.eligible) return "No";
      return "Yes";
    }
    if (
      cohesion.balancedCohesion &&
      cohesion.maxConnectorRepeat <= 3 &&
      cohesion.distinctExBasic >= 3 &&
      cohesion.referencingDensity >= 1.4
    ) {
      return "No";
    }
    if (
      !cohesion.mechanicalCohesion &&
      !cohesion.heavyRepetition &&
      cohesion.maxConnectorRepeat <= 3 &&
      cohesion.distinctExBasic >= 4 &&
      cohesion.referencingDensity >= 1.3 &&
      !cohesion.weakParagraphLogic
    ) {
      return "No";
    }
    if (cohesion.strongProgression && !cohesion.mechanicalCohesion && !cohesion.heavyRepetition) return "No";
    if (
      recovery.strongBodyRecovery &&
      (recovery.oneThinConclusionRecoverable || recovery.topicCoverageLikelyUnderDetected) &&
      cohesion.distinctExBasic >= 7 &&
      cohesion.maxConnectorRepeat <= 4 &&
      !cohesion.heavyRepetition &&
      !cohesion.mechanicalCohesion
    ) {
      return "No";
    }
    if (cohesion.maxConnectorRepeat >= 4 && cohesion.densityExBasic >= 2.8) {
      if (
        recovery.strongBodyRecovery &&
        cohesion.distinctExBasic >= 7 &&
        !cohesion.heavyRepetition &&
        !cohesion.mechanicalCohesion
      ) {
        return "No";
      }
      if (ccOverlinkRecovery.eligible) return "No";
      return "Yes";
    }
    if (cohesion.distinctExBasic >= 4 && cohesion.referencingDensity >= 1.3 && !cohesion.mechanicalCohesion) return "No";
    return null;
  },

  "CC5-5": (ctx) => {
    const cohesion = cohesionQualityProfile(ctx);
    const recovery = ccHigherBandSupportRecoveryProfile(ctx);
    const ccMidRecovery = ccMidBandThinConclusionRecoveryProfile(ctx);
    const ccOverlinkRecovery = ccBand5OverlinkRecoveryProfile(ctx);
    if (ccMidRecovery.eligible) return "No";
    if (
      cohesion.mechanicalCohesion ||
      (cohesion.maxConnectorRepeat >= 5 && cohesion.distinctExBasic <= 2) ||
      (cohesion.densityExBasic >= 3.6 && cohesion.maxConnectorRepeat >= 4 && cohesion.distinctExBasic <= 3)
    ) {
      if (ccOverlinkRecovery.eligible) return "No";
      return "Yes";
    }
    if (
      cohesion.balancedCohesion &&
      cohesion.maxConnectorRepeat <= 3 &&
      cohesion.distinctExBasic >= 3 &&
      cohesion.densityExBasic <= 3.2
    ) {
      return "No";
    }
    if (!cohesion.heavyRepetition && cohesion.maxConnectorRepeat <= 2 && cohesion.distinctExBasic >= 3) return "No";
    if (cohesion.weakReferencing && cohesion.maxConnectorRepeat >= 4 && cohesion.densityExBasic >= 3.0) return "Yes";
    if (
      cohesion.lowCohesionGuidance &&
      recovery.strongBodyRecovery &&
      cohesion.referencingDensity >= 1.3 &&
      cohesion.maxConnectorRepeat <= 4 &&
      !cohesion.mechanicalCohesion &&
      !cohesion.heavyRepetition
    ) {
      return "No";
    }
    if (cohesion.distinctExBasic >= 4 && cohesion.maxConnectorRepeat <= 3 && cohesion.referencingDensity >= 1.3) return "No";
    if (cohesion.maxConnectorRepeat >= 4 && cohesion.densityExBasic >= 3.0) {
      if (
        recovery.strongBodyRecovery &&
        (recovery.oneThinConclusionRecoverable || recovery.topicCoverageLikelyUnderDetected) &&
        cohesion.distinctExBasic >= 7 &&
        !cohesion.heavyRepetition &&
        !cohesion.mechanicalCohesion
      ) {
        return "No";
      }
      if (ccOverlinkRecovery.eligible) return "No";
      return "Yes";
    }
    return "No";
  },

  "CC5-6": (ctx) => {
    const cohesion = cohesionQualityProfile(ctx);
    const blockers = ccMidBandBlockerProfile(ctx);
    if (blockers.cc56Blocker) {
      const para = paragraphProfile(ctx);
      const support = bodySupportProfile(ctx);
      const topicCoverage = paragraphTopicCoverageProfile(ctx);
      const structure = (ctx?.step2?.structure && typeof ctx.step2.structure === "object")
        ? ctx.step2.structure
        : {};
      const roles = Array.isArray(structure?.paragraphRoles) ? structure.paragraphRoles : [];
      const counts = Array.isArray(para.counts) ? para.counts : [];
      const thinParagraphIndices = counts
        .map((count, index) => (toFiniteNumber(count, 0) <= 1 ? index : null))
        .filter((index) => Number.isInteger(index));
      const oneThinConclusionOnly = thinParagraphIndices.length === 1
        && String(roles[thinParagraphIndices[0]] || "").toLowerCase() === "conclusion";
      const oneThinBodyOnly = thinParagraphIndices.length === 1
        && String(roles[thinParagraphIndices[0]] || "").toLowerCase() === "body";
      const developedRows = developedBodyRowCount(support);

      const runOnBodyBoundaryRecovery =
        oneThinBodyOnly &&
        !oneThinConclusionOnly &&
        para.paragraphCount >= 5 &&
        para.hasIntro &&
        para.hasConclusion &&
        para.bodyCount >= 3 &&
        support.totalBodyRows >= 3 &&
        developedRows >= 2 &&
        support.effectiveUnderdevelopedCount <= 1 &&
        topicCoverage.bodyParagraphCount >= 3 &&
        topicCoverage.bodyTopicCoverageRatio >= 0.67 &&
        cohesion.repetition.topCount >= 9 &&
        cohesion.referencingDensity >= 4.5 &&
        cohesion.distinctExBasic >= 4 &&
        cohesion.maxConnectorRepeat <= 2 &&
        !cohesion.lowCohesionGuidance &&
        !cohesion.mechanicalCohesion;
      if (runOnBodyBoundaryRecovery) return "No";
      return "Yes";
    }
    if (
      (cohesion.repetition.topCount >= 7 && cohesion.repetition.ratio >= 0.025 && cohesion.referencingDensity < 1.3) ||
      (cohesion.weakReferencing && cohesion.repetition.topCount >= 6)
    ) {
      return "Yes";
    }
    if (
      cohesion.repetition.topCount <= 4 &&
      cohesion.referencingDensity >= 1.6 &&
      !cohesion.weakReferencing
    ) {
      return "No";
    }
    if (
      cohesion.referencingDensity >= 1.4 &&
      cohesion.repetition.topCount <= 5 &&
      cohesion.repetition.ratio < 0.022
    ) {
      return "No";
    }
    if (
      cohesion.referencingDensity < 1.35 &&
      cohesion.repetition.topCount >= 5 &&
      cohesion.repetition.ratio >= 0.022
    ) {
      return "Yes";
    }
    if (
      cohesion.referencingDensity >= 1.45 &&
      cohesion.repetition.topCount <= 6 &&
      cohesion.repetition.ratio < 0.026
    ) {
      return "No";
    }
    return cohesion.weakReferencing ? "Yes" : "No";
  },

  "CC5-7": (ctx) => {
    const p = paragraphProfile(ctx);
    const segmentationLikelyCollapsed = collapsedParagraphSegmentationLikely(ctx);
    if (p.paragraphCount <= 1) return segmentationLikelyCollapsed ? "No" : "Yes";
    return "No";
  },

  "CC5-8": (ctx) => {
    const p = paragraphProfile(ctx);
    const support = bodySupportProfile(ctx);
    const topicCoverage = paragraphTopicCoverageProfile(ctx);
    const structure = (ctx?.step2?.structure && typeof ctx.step2.structure === "object")
      ? ctx.step2.structure
      : {};
    const segmentationLikelyCollapsed = collapsedParagraphSegmentationLikely(ctx);
    const ccMidRecovery = ccMidBandThinConclusionRecoveryProfile(ctx);
    if (ccMidRecovery.eligible) return "No";
    if (p.paragraphCount <= 1) return segmentationLikelyCollapsed ? "No" : "Yes";
    if (p.paragraphCount === 2) return segmentationLikelyCollapsed ? "No" : "Yes";
    if (
      p.paragraphCount === 3 &&
      p.hasIntro &&
      p.hasConclusion &&
      p.bodyCount >= 1 &&
      support.totalBodyRows >= 1 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      topicCoverage.bodyParagraphCount >= 1 &&
      topicCoverage.bodyTopicCoverageRatio >= 0.5 &&
      !Boolean(structure?.misplacedConclusionSignpost)
    ) {
      return "No";
    }
    if (p.minSent > 0 && p.minSent <= 1) {
      const roles = Array.isArray(structure?.paragraphRoles) ? structure.paragraphRoles : [];
      const counts = Array.isArray(p.counts) ? p.counts : [];
      const thinParagraphIndices = counts
        .map((count, index) => (toFiniteNumber(count, 0) <= 1 ? index : null))
        .filter((index) => Number.isInteger(index));
      const oneThinConclusionOnly = thinParagraphIndices.length === 1
        && String(roles[thinParagraphIndices[0]] || "").toLowerCase() === "conclusion";
      const developedRows = developedBodyRowCount(support);
      const strongBodySupport = support.totalBodyRows >= 2
        && developedRows >= 2
        && support.effectiveUnderdevelopedCount <= 1;
      const topicCoverageRecovered = topicCoverage.bodyParagraphCount >= 2
        ? (topicCoverage.bodyTopicCoverageRatio >= 0.5 || developedRows >= 2)
        : true;
      if (
        oneThinConclusionOnly &&
        p.paragraphCount >= 4 &&
        p.hasIntro &&
        p.hasConclusion &&
        p.bodyCount >= 2 &&
        strongBodySupport &&
        topicCoverageRecovered &&
        !Boolean(structure?.misplacedConclusionSignpost)
      ) {
        return "No";
      }
      return "Yes";
    }
    if (p.paragraphCount >= 4 && p.hasIntro && p.hasConclusion && p.bodyCount >= 2) return "No";
    return null;
  },

  "CC6-1": (ctx) => {
    const cohesion = cohesionQualityProfile(ctx);
    const support = bodySupportProfile(ctx);
    const developedRows = developedBodyRowCount(support);
    const para = paragraphProfile(ctx);
    const topicCoverage = paragraphTopicCoverageProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const boundaryRecovery = ccBand6HighContentBoundaryRecoveryProfile(ctx);
    const structure = (ctx?.step2?.structure && typeof ctx.step2.structure === "object")
      ? ctx.step2.structure
      : {};
    const roles = Array.isArray(structure?.paragraphRoles) ? structure.paragraphRoles : [];
    const counts = Array.isArray(para.counts) ? para.counts : [];
    const thinParagraphIndices = counts
      .map((count, index) => (toFiniteNumber(count, 0) <= 1 ? index : null))
      .filter((index) => Number.isInteger(index));
    const oneThinConclusionOnly = thinParagraphIndices.length === 1
      && String(roles[thinParagraphIndices[0]] || "").toLowerCase() === "conclusion";
    const thinConclusionHighControlBoundary =
      para.paragraphCount >= 4 &&
      para.bodyCount >= 2 &&
      para.hasConclusion &&
      oneThinConclusionOnly &&
      support.totalBodyRows >= 2 &&
      developedRows >= 2 &&
      support.strongCount >= 1 &&
      support.effectiveUnderdevelopedCount === 0 &&
      lengthProfile.effectiveWordCount >= 245 &&
      cohesion.referencingDensity >= 4.5 &&
      cohesion.distinctExBasic >= 3 &&
      cohesion.maxConnectorRepeat <= 3 &&
      cohesion.repetition.topCount <= 6 &&
      cohesion.repetition.ratio < 0.026 &&
      !cohesion.mechanicalCohesion &&
      !cohesion.lowCohesionGuidance &&
      highBandLanguageControlStrong(ctx);
    if (boundaryRecovery.eligible) return "Yes";
    if (thinConclusionHighControlBoundary) return "Yes";
    if (cohesion.weakParagraphLogic || cohesion.weakTopicCoverage) return "No";
    if (
      support.totalBodyRows >= 2 &&
      support.strongCount < 2 &&
      support.effectiveUnderdevelopedCount >= 1 &&
      cohesion.repetition.topCount >= 7 &&
      cohesion.repetition.ratio >= 0.03
    ) {
      return "No";
    }
    if (
      cohesion.repetition.topCount >= 7 &&
      cohesion.repetition.ratio >= 0.03 &&
      (cohesion.referencingDensity >= 7 || cohesion.maxConnectorRepeat >= 3)
    ) {
      return "No";
    }
    if (
      cohesion.repetition.topCount >= 7 &&
      cohesion.repetition.ratio >= 0.028 &&
      (cohesion.maxConnectorRepeat >= 3 || cohesion.referencingDensity >= 4.5)
    ) {
      return "No";
    }
    if (cohesion.mechanicalCohesion || cohesion.lowCohesionGuidance) return "No";

    if (cohesion.strongProgression && cohesion.balancedCohesion) return "Yes";
    if (cohesion.balancedCohesion && !cohesion.heavyRepetition && cohesion.referencingDensity >= 1.2) return "Yes";
    if (
      para.paragraphCount >= 4 &&
      para.bodyCount >= 2 &&
      para.hasConclusion &&
      para.minSent >= 2 &&
      topicCoverage.bodyParagraphCount >= 2 &&
      topicCoverage.bodyTopicCoverageRatio >= 0.67 &&
      support.totalBodyRows >= 2 &&
      support.effectiveUnderdevelopedCount <= Math.max(1, support.totalBodyRows - 1) &&
      cohesion.maxConnectorRepeat <= 3 &&
      cohesion.repetition.topCount <= 6 &&
      cohesion.repetition.ratio < 0.028
    ) {
      return "Yes";
    }
    if (cohesion.strongProgression && cohesion.referencingDensity >= 1.3 && cohesion.repetition.ratio < 0.028) return "Yes";

    return cohesion.strongProgression ? "Yes" : "No";
  },

  "CC6-2": (ctx) => {
    const cohesion = cohesionQualityProfile(ctx);
    const blockers = ccMidBandBlockerProfile(ctx);
    const boundaryRecovery = ccBand6HighContentBoundaryRecoveryProfile(ctx);
    if (boundaryRecovery.eligible) return "Yes";
    const severeRepetitionOverload =
      cohesion.repetition.topCount >= 7 &&
      cohesion.repetition.ratio >= 0.03 &&
      (
        cohesion.maxConnectorRepeat >= 5 ||
        (cohesion.densityExBasic >= 4.0 && cohesion.distinctExBasic >= 5) ||
        (
          cohesion.referencingDensity >= 9 &&
          cohesion.maxConnectorRepeat >= 4 &&
          cohesion.densityExBasic >= 4.0
        )
      );
    if (blockers.cc6Blocker) return "No";
    if (
      cohesion.mechanicalCohesion ||
      cohesion.lowCohesionGuidance ||
      cohesion.weakReferencing ||
      (cohesion.weakParagraphLogic && cohesion.weakTopicCoverage)
    ) {
      return "No";
    }
    if (severeRepetitionOverload) {
      return "No";
    }
    if (
      cohesion.strongProgression &&
      cohesion.balancedCohesion &&
      cohesion.maxConnectorRepeat <= 3 &&
      cohesion.distinctExBasic >= 3 &&
      cohesion.referencingDensity >= 1.2
    ) {
      return "Yes";
    }
    if (
      cohesion.distinctExBasic >= 3 &&
      cohesion.referencingDensity >= 1.2 &&
      cohesion.maxConnectorRepeat <= 4 &&
      cohesion.densityExBasic >= 1.1 &&
      !cohesion.lowCohesionGuidance
    ) {
      return "Yes";
    }
    return (cohesion.lowCohesionGuidance || cohesion.mechanicalCohesion || cohesion.weakReferencing) ? "No" : "Yes";
  },

  "CC6-3": (ctx) => {
    const cohesion = cohesionQualityProfile(ctx);
    const blockers = ccMidBandBlockerProfile(ctx);
    const boundaryRecovery = ccBand6HighContentBoundaryRecoveryProfile(ctx);
    if (boundaryRecovery.eligible) return "No";
    const severeRepetitionOverload =
      cohesion.repetition.topCount >= 7 &&
      cohesion.repetition.ratio >= 0.03 &&
      (
        cohesion.maxConnectorRepeat >= 5 ||
        (cohesion.densityExBasic >= 4.0 && cohesion.distinctExBasic >= 5) ||
        (
          cohesion.referencingDensity >= 9 &&
          cohesion.maxConnectorRepeat >= 4 &&
          cohesion.densityExBasic >= 4.0
        )
      );
    if (blockers.cc6Blocker) return "Yes";
    if (cohesion.mechanicalCohesion || (cohesion.lowCohesionGuidance && cohesion.heavyRepetition) || cohesion.weakReferencing) {
      return "Yes";
    }
    if (severeRepetitionOverload) {
      return "Yes";
    }
    if (cohesion.balancedCohesion && cohesion.maxConnectorRepeat <= 3) return "No";
    if (
      cohesion.maxConnectorRepeat >= 4 &&
      cohesion.densityExBasic >= 3.0 &&
      (
        cohesion.distinctExBasic <= 3 ||
        cohesion.repetition.ratio >= 0.035 ||
        (cohesion.repetition.topCount >= 8 && cohesion.densityExBasic >= 4.0)
      )
    ) {
      return "Yes";
    }
    if (cohesion.weakParagraphLogic && cohesion.referencingDensity < 1.25 && cohesion.distinctExBasic <= 2) return "Yes";
    if (
      cohesion.strongProgression &&
      cohesion.distinctExBasic >= 3 &&
      cohesion.maxConnectorRepeat <= 3 &&
      cohesion.referencingDensity >= 1.25 &&
      !cohesion.mechanicalCohesion &&
      !cohesion.heavyRepetition
    ) {
      return "No";
    }
    return (cohesion.mechanicalCohesion || cohesion.weakReferencing || cohesion.lowCohesionGuidance) ? "Yes" : "No";
  },

  "CC6-4": (ctx) => {
    const cohesion = cohesionQualityProfile(ctx);
    const blockers = ccMidBandBlockerProfile(ctx);
    if (blockers.cc6Blocker) return "Yes";
    const topCount = cohesion.repetition.topCount;
    const topRatio = cohesion.repetition.ratio;

    if (
      cohesion.referencingDensity >= 4.5 &&
      topCount >= 9 &&
      topRatio >= 0.03 &&
      cohesion.distinctExBasic >= 4 &&
      cohesion.maxConnectorRepeat <= 3
    ) {
      return "Yes";
    }
    if (cohesion.weakReferencing) return "Yes";
    if (cohesion.referencingDensity < 1.35 && topCount >= 6) return "Yes";
    if (cohesion.referencingDensity < 1.25 && topRatio >= 0.024 && topCount >= 5) return "Yes";
    if (cohesion.weakParagraphLogic && cohesion.referencingDensity < 1.4) return "Yes";
    if ((cohesion.lowCohesionGuidance || cohesion.mechanicalCohesion) && cohesion.referencingDensity < 1.35 && topCount >= 5) {
      return "Yes";
    }
    if (
      cohesion.referencingDensity >= 1.55 &&
      cohesion.densityExBasic < 2.0 &&
      cohesion.distinctExBasic <= 4 &&
      topCount >= 5 &&
      topCount <= 6 &&
      topRatio >= 0.016 &&
      topRatio < 0.024 &&
      cohesion.maxConnectorRepeat <= 2
    ) {
      return "Yes";
    }

    if (cohesion.referencingDensity >= 1.55 && !cohesion.weakReferencing && topCount <= 5 && topRatio < 0.024) return "No";
    if (cohesion.referencingDensity >= 1.4 && topCount <= 6 && !cohesion.heavyRepetition) return "No";

    return cohesion.referencingDensity < 1.4 ? "Yes" : "No";
  },

  "CC6-5": (ctx) => {
    const p = paragraphProfile(ctx);
    const topicCoverage = paragraphTopicCoverageProfile(ctx);
    const boundaryRecovery = ccBand6HighContentBoundaryRecoveryProfile(ctx);
    if (p.paragraphCount <= 1) return "Yes";
    if (!p.hasIntro || !p.hasConclusion) return "Yes";
    if (p.bodyCount < 2) return "Yes";
    if (boundaryRecovery.eligible) return "No";
    if (p.minSent <= 1) return "Yes";
    if (topicCoverage.bodyParagraphCount >= 2 && topicCoverage.bodyTopicCoverageRatio < 0.5) return "Yes";
    if (topicCoverage.bodyParagraphCount >= 2 && topicCoverage.bodyTopicCoverageRatio >= 0.67 && p.paragraphCount >= 4) return "No";
    return "No";
  },

  "CC7-1": (ctx) => {
    const cohesion = cohesionQualityProfile(ctx);
    const para = paragraphProfile(ctx);
    const topicCoverage = paragraphTopicCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const developedRows = developedBodyRowCount(support);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const taskEcho = lengthProfile.taskEcho;
    const boundaryRecovery = ccBand7ThinConclusionBoundaryRecoveryProfile(ctx);
    const thinHighBandRecovery = ccBand7ThinConclusionHighBandRecoveryProfile(ctx);
    const sparseRecovery = ccBand7SparseLinkingHighReferenceRecoveryProfile(ctx);
    const highReferenceBoundaryRecovery = ccBand7HighReferenceBoundaryRecoveryProfile(ctx);
    const highReferenceRepetitionBoundaryRecovery =
      para.paragraphCount >= 5 &&
      para.bodyCount >= 3 &&
      para.hasIntro &&
      para.hasConclusion &&
      para.minSent >= 2 &&
      support.totalBodyRows >= 3 &&
      developedRows >= 3 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      topicCoverage.bodyParagraphCount >= 3 &&
      topicCoverage.bodyTopicCoverageRatio >= 0.67 &&
      lengthProfile.effectiveWordCount >= 300 &&
      taskEcho.severity === "none" &&
      taskEcho.reusedPromptSentenceLikeCount === 0 &&
      taskEcho.reusedPromptPhraseCount <= 1 &&
      cohesion.referencingDensity >= 6.5 &&
      cohesion.distinctExBasic >= 8 &&
      cohesion.densityExBasic >= 2.4 &&
      cohesion.densityExBasic <= 3.35 &&
      cohesion.maxConnectorRepeat <= 2 &&
      cohesion.repetition.topCount <= 8 &&
      cohesion.repetition.ratio < 0.033 &&
      !cohesion.mechanicalCohesion &&
      !cohesion.lowCohesionGuidance &&
      !cohesion.weakReferencing &&
      !cohesion.weakParagraphLogic &&
      !cohesion.weakTopicCoverage;
    const lowDensityHighControlBoundaryRecovery =
      para.paragraphCount >= 4 &&
      para.bodyCount >= 2 &&
      para.hasIntro &&
      para.hasConclusion &&
      para.minSent >= 2 &&
      support.totalBodyRows >= 2 &&
      support.hardUnderdevelopedCount === 0 &&
      support.effectiveUnderdevelopedCount === 0 &&
      support.strongCount >= 1 &&
      topicCoverage.bodyParagraphCount >= 2 &&
      topicCoverage.bodyTopicCoverageRatio >= 0.67 &&
      lengthProfile.effectiveWordCount >= 245 &&
      taskEcho.severity === "none" &&
      taskEcho.reusedPromptSentenceLikeCount === 0 &&
      taskEcho.reusedPromptPhraseCount <= 1 &&
      cohesion.densityExBasic >= 1.5 &&
      cohesion.densityExBasic < 1.6 &&
      cohesion.distinctExBasic >= 3 &&
      cohesion.maxConnectorRepeat <= 2 &&
      cohesion.referencingDensity >= 1.8 &&
      !cohesion.heavyRepetition &&
      !cohesion.mechanicalCohesion &&
      !cohesion.lowCohesionGuidance &&
      !cohesion.weakReferencing &&
      !cohesion.weakParagraphLogic &&
      !cohesion.weakTopicCoverage &&
      highBandLanguageControlStrong(ctx);

    if (para.virtualRecoveryApplied && cohesion.runOnRecoveredBodyCount >= 1) return "No";
    if (boundaryRecovery.eligible) return "Yes";
    if (thinHighBandRecovery.eligible) return "Yes";
    if (sparseRecovery.eligible) return "Yes";
    if (highReferenceBoundaryRecovery.eligible) return "Yes";
    if (highReferenceRepetitionBoundaryRecovery) return "Yes";
    if (lowDensityHighControlBoundaryRecovery) return "Yes";
    if (cohesion.repetition.topCount >= 8 && cohesion.repetition.ratio >= 0.024) return "No";
    if (cohesion.densityExBasic < 1.6 && cohesion.distinctExBasic <= 5) return "No";

    const clearProgressionThroughout = para.paragraphCount >= 4
      && para.bodyCount >= 2
      && para.hasIntro
      && para.hasConclusion
      && para.minSent >= 2
      && topicCoverage.bodyParagraphCount >= 2
      && topicCoverage.bodyTopicCoverageRatio >= 0.67
      && cohesion.strongProgression
      && cohesion.referencingDensity >= 1.3
      && cohesion.maxConnectorRepeat <= 3
      && !cohesion.heavyRepetition
      && !cohesion.mechanicalCohesion
      && !cohesion.weakParagraphLogic
      && !cohesion.weakTopicCoverage;

    if (clearProgressionThroughout) return "Yes";
    if (cohesion.weakParagraphLogic || cohesion.weakTopicCoverage) return "No";
    if (cohesion.mechanicalCohesion || cohesion.lowCohesionGuidance) return "No";
    if (cohesion.heavyRepetition && cohesion.referencingDensity < 1.4) return "No";
    if (para.paragraphCount < 3 || para.bodyCount < 2 || !para.hasConclusion) return "No";

    const mostlyClearProgression = para.paragraphCount >= 4
      && para.bodyCount >= 2
      && para.minSent >= 2
      && topicCoverage.bodyParagraphCount >= 2
      && topicCoverage.bodyTopicCoverageRatio >= 0.67
      && cohesion.balancedCohesion
      && !cohesion.weakParagraphLogic
      && !cohesion.weakTopicCoverage;
    if (mostlyClearProgression) return "Yes";

    return "No";
  },

  "CC7-2": (ctx) => {
    const cohesion = cohesionQualityProfile(ctx);
    const thinHighBandRecovery = ccBand7ThinConclusionHighBandRecoveryProfile(ctx);
    const sparseRecovery = ccBand7SparseLinkingHighReferenceRecoveryProfile(ctx);
    const highReferenceBoundaryRecovery = ccBand7HighReferenceBoundaryRecoveryProfile(ctx);
    const conclusionSignpostFoundInLast = Boolean(ctx?.step2?.structure?.conclusionSignpostFoundInLast);

    if (cohesion.runOnRecoveredBodyCount >= 1) return "No";
    if (highReferenceBoundaryRecovery.eligible) return "Yes";
    if (
      cohesion.referencingDensity >= 7 &&
      cohesion.distinctExBasic <= 5 &&
      !conclusionSignpostFoundInLast &&
      !thinHighBandRecovery.eligible &&
      !sparseRecovery.eligible
    ) {
      return "No";
    }
    if (
      !conclusionSignpostFoundInLast &&
      cohesion.maxConnectorRepeat >= 3 &&
      cohesion.densityExBasic >= 2.6 &&
      cohesion.distinctExBasic <= 5 &&
      cohesion.referencingDensity >= 1.3 &&
      cohesion.referencingDensity <= 6.5 &&
      !thinHighBandRecovery.eligible &&
      !sparseRecovery.eligible
    ) {
      return "No";
    }
    if (thinHighBandRecovery.eligible) return "Yes";
    if (sparseRecovery.eligible) return "Yes";
    if (cohesion.repetition.topCount >= 8 && cohesion.repetition.ratio >= 0.024) return "No";
    if (cohesion.densityExBasic < 1.6 && cohesion.distinctExBasic <= 5) return "No";

    if (cohesion.mechanicalCohesion || cohesion.lowCohesionGuidance || cohesion.weakReferencing) return "No";
    if (cohesion.heavyRepetition && cohesion.maxConnectorRepeat >= 4) return "No";
    if (cohesion.weakParagraphLogic || cohesion.weakTopicCoverage) return "No";

    const appropriateRange = cohesion.distinctExBasic >= 3
      && cohesion.densityExBasic >= 1.2
      && cohesion.densityExBasic <= 3.6
      && cohesion.maxConnectorRepeat <= 3
      && cohesion.referencingDensity >= 1.3
      && !cohesion.weakParagraphLogic
      && !cohesion.weakTopicCoverage;

    if (appropriateRange || cohesion.balancedCohesion) return "Yes";
    if (cohesion.distinctExBasic <= 2 || cohesion.referencingDensity < 1.15) return "No";

    return "No";
  },

  "CC7-3": (ctx) => {
    const cohesion = cohesionQualityProfile(ctx);

    const severeImbalance = cohesion.mechanicalCohesion
      || cohesion.lowCohesionGuidance
      || cohesion.weakReferencing
      || (cohesion.heavyRepetition && cohesion.maxConnectorRepeat >= 4);
    if (severeImbalance) return "No";

    const balancedUse = cohesion.balancedCohesion
      && cohesion.maxConnectorRepeat <= 3
      && cohesion.referencingDensity >= 1.4;
    if (balancedUse) return "No";

    const minorImbalance = (
      cohesion.maxConnectorRepeat === 4
      || (cohesion.densityExBasic >= 3.2 && cohesion.distinctExBasic >= 3)
      || (cohesion.densityExBasic < 1.2 && cohesion.distinctExBasic >= 2)
      || (cohesion.referencingDensity >= 1.2 && cohesion.referencingDensity < 1.4)
    );

    if (minorImbalance && !cohesion.weakParagraphLogic && !cohesion.weakTopicCoverage) return "Yes";
    if (cohesion.weakParagraphLogic || cohesion.weakTopicCoverage) return "No";

    return "No";
  },

  "CC7-4": (ctx) => {
    const p = paragraphProfile(ctx);
    const cohesion = cohesionQualityProfile(ctx);
    const conclusionSignpostFoundInLast = Boolean(ctx?.step2?.structure?.conclusionSignpostFoundInLast);
    const boundaryRecovery = ccBand7ThinConclusionBoundaryRecoveryProfile(ctx);
    const thinHighBandRecovery = ccBand7ThinConclusionHighBandRecoveryProfile(ctx);
    const sparseRecovery = ccBand7SparseLinkingHighReferenceRecoveryProfile(ctx);
    if (p.paragraphCount < 3) return "No";
    if (p.minSent > 0 && p.minSent <= 1) {
      if (boundaryRecovery.eligible || thinHighBandRecovery.eligible) return "Yes";
      return "No";
    }
    if (
      cohesion.referencingDensity >= 7 &&
      cohesion.distinctExBasic <= 5 &&
      !conclusionSignpostFoundInLast &&
      !sparseRecovery.eligible
    ) {
      return "No";
    }
    if (thinHighBandRecovery.eligible) return "Yes";
    if (sparseRecovery.eligible) return "Yes";
    if (boundaryRecovery.eligible) return "Yes";

    const topics = Array.isArray(ctx?.step25?.topicSentenceByParagraph) ? ctx.step25.topicSentenceByParagraph : null;
    if (topics && topics.length) {
      const withTopic = topics.filter(t => t && Number.isInteger(t.topicSentenceIndex)).length;
      return (withTopic >= Math.max(1, p.paragraphCount - 1)) ? "Yes" : "No";
    }
    return null;
  },

  "CC8-1": (ctx) => {
    const cohesion = cohesionQualityProfile(ctx);
    const para = paragraphProfile(ctx);
    if (para.virtualRecoveryApplied || cohesion.runOnRecoveredBodyCount >= 1) return "No";
    if (cohesion.repetition.topCount >= 8 && cohesion.repetition.ratio >= 0.024) return "No";
    if (cohesion.densityExBasic < 1.8 || cohesion.distinctExBasic < 4) return "No";
    if (cohesion.weakParagraphLogic || cohesion.weakTopicCoverage) return "No";
    if (cohesion.mechanicalCohesion || cohesion.lowCohesionGuidance) return "No";
    if (
      cohesion.heavyRepetition &&
      (cohesion.maxConnectorRepeat >= 3 || cohesion.referencingDensity >= 4.5 || cohesion.weakReferencing)
    ) {
      return "No";
    }
    if (
      cohesion.strongProgression &&
      cohesion.distinctExBasic >= 3 &&
      cohesion.referencingDensity >= 1.3 &&
      cohesion.maxConnectorRepeat <= 3 &&
      !cohesion.heavyRepetition
    ) {
      return "Yes";
    }
    if (
      cohesion.balancedCohesion &&
      cohesion.strongProgression &&
      cohesion.distinctExBasic >= 4 &&
      cohesion.referencingDensity >= 1.35 &&
      cohesion.maxConnectorRepeat <= 3 &&
      cohesion.repetition.ratio < 0.028
    ) {
      return "Yes";
    }
    return "No";
  },

  "CC8-2": (ctx) => {
    const cohesion = cohesionQualityProfile(ctx);
    if (cohesion.mechanicalCohesion || cohesion.lowCohesionGuidance) return "No";
    if (cohesion.heavyRepetition && cohesion.weakReferencing) return "No";
    if (cohesion.weakReferencing && cohesion.repetition.topCount >= 6) return "No";
    if (
      cohesion.balancedCohesion &&
      !cohesion.weakParagraphLogic &&
      !cohesion.weakTopicCoverage &&
      cohesion.maxConnectorRepeat <= 3
    ) {
      return "Yes";
    }
    return null;
  },

  "CC8-3": (ctx) => {
    const p = paragraphProfile(ctx);
    if (p.paragraphCount >= 4 && p.hasIntro && p.hasConclusion && p.bodyCount >= 2 && p.minSent >= 2) return "Yes";
    if (p.paragraphCount <= 2) return "No";
    return null;
  },

  "CC9-1": (ctx) => {
    const cohesion = cohesionQualityProfile(ctx);
    const rawCohesion = ctx?.step2?.cohesion || {};
    const totalConnectorsExcludingBasic = toFiniteNumber(
      rawCohesion?.totalConnectorsExcludingBasic ?? rawCohesion?.totalConnectors,
      0
    );
    if (repetitionOrMechanicalLinkingBlocksBand9(ctx)) return "No";
    if (!paragraphingShowsBand9Control(ctx)) return "No";
    if (!conclusionSupportIsBand9Safe(ctx)) return "No";
    if (paragraphingOnlySupportsBand8(ctx)) return "No";
    if (totalConnectorsExcludingBasic < 8) return "No";
    if (cohesionAttractsNoAttention(ctx)) return "Yes";
    if (cohesion.distinctExBasic < 5 || cohesion.referencingDensity < 1.7) return "No";
    if (!cohesion.balancedCohesion || !cohesion.strongProgression) return "No";
    return null;
  },

  "CC9-2": (ctx) => {
    const cohesion = cohesionQualityProfile(ctx);
    const rawCohesion = ctx?.step2?.cohesion || {};
    const totalConnectorsExcludingBasic = toFiniteNumber(
      rawCohesion?.totalConnectorsExcludingBasic ?? rawCohesion?.totalConnectors,
      0
    );
    if (!paragraphingShowsBand9Control(ctx)) return "No";
    if (!conclusionSupportIsBand9Safe(ctx)) return "No";
    if (cohesion.heavyRepetition || cohesion.mechanicalCohesion || cohesion.weakReferencing) return "No";
    if (paragraphingOnlySupportsBand8(ctx)) return "No";
    if (!cohesion.balancedCohesion) return "No";
    if (totalConnectorsExcludingBasic < 8) return "No";
    if (
      cohesion.strongProgression &&
      cohesion.referencingDensity >= 1.7 &&
      cohesion.maxConnectorRepeat <= 2 &&
      cohesion.distinctExBasic >= 5
    ) {
      return "Yes";
    }
    return null;
  }
};

module.exports = ccRules;
