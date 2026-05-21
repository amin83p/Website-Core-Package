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

const trRules = {
  "TR4-1": (ctx) => {
    const lengthProfile = taskResponseLengthProfile(ctx);
    const wc = lengthProfile.rawWordCount;
    const effectiveWc = lengthProfile.effectiveWordCount;
    const taskEcho = lengthProfile.taskEcho;
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const compactBoundaryRelief = tr4CompactSinglePartBoundaryReliefProfile(ctx);
    const repeatedRestatement = taskEcho.reusedPromptSentenceLikeCount >= 2 || taskEcho.reusedPromptPhraseCount >= 4;

    if (compactBoundaryRelief.eligible) return "No";

    if (wc > 0 && wc < 170) return "Yes";
    if (
      (taskEcho.severity === "severe" || repeatedRestatement) &&
      effectiveWc > 0 &&
      effectiveWc < 200 &&
      (coverage.missingPartCount >= 1 || support.underdevelopedCount >= 1)
    ) {
      return "Yes";
    }
    if (
      taskEcho.severity === "severe" &&
      effectiveWc > 0 &&
      effectiveWc < 170 &&
      (coverage.missingPartCount >= 1 || support.severelyThinCount >= 1 || support.underdevelopedCount >= 1)
    ) {
      return "Yes";
    }
    if (coverage.totalParts > 0 && coverage.addressedPartCount === 0) return "Yes";
    if (effectiveWc < 230 && (coverage.missingPartCount >= 1 || support.severelyThinCount >= 1)) return "Yes";

    if (
      effectiveWc >= 260 &&
      coverage.totalParts > 0 &&
      coverage.missingPartCount === 0 &&
      support.totalBodyRows >= 2 &&
      support.underdevelopedCount === 0
    ) {
      return "No";
    }
    if (
      coverage.totalParts > 0 &&
      coverage.missingPartCount === 0 &&
      effectiveWc >= 170 &&
      support.severelyThinCount === 0
    ) {
      return "No";
    }
    return null;
  },

  "TR1-1": (ctx) => {
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const taskEcho = lengthProfile.taskEcho;
    const effectiveWordCount = lengthProfile.effectiveWordCount;

    const severeAddressingFailure = coverage.totalParts > 0 && coverage.addressedPartCount === 0;
    const noSupportSignals = support.totalBodyRows === 0 || (
      support.strongCount === 0 &&
      support.effectiveUnderdevelopedCount >= Math.max(1, support.totalBodyRows)
    );
    const almostNoMeaningfulContent = effectiveWordCount > 0 && effectiveWordCount <= 40;
    const severePromptReuseWithVeryLowEffectiveContent =
      taskEcho.severity === "severe" &&
      effectiveWordCount > 0 &&
      effectiveWordCount <= 55 &&
      coverage.totalIdeas <= 1;

    if (severeAddressingFailure && (coverage.totalIdeas === 0 || noSupportSignals)) return "Yes";
    if (almostNoMeaningfulContent && coverage.totalIdeas === 0 && noSupportSignals) return "Yes";
    if (severePromptReuseWithVeryLowEffectiveContent && noSupportSignals) return "Yes";

    if (coverage.addressedPartCount >= 1) return "No";
    if (coverage.totalIdeas >= 2) return "No";
    if (support.totalBodyRows >= 1 && support.severelyThinCount === 0) return "No";
    if (effectiveWordCount >= 85) return "No";
    return "No";
  },

  "TR2-1": (ctx) => {
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWordCount = lengthProfile.effectiveWordCount;
    const taskEcho = lengthProfile.taskEcho;
    const repeatedRestatement = taskEcho.reusedPromptSentenceLikeCount >= 2 || taskEcho.reusedPromptPhraseCount >= 4;

    const severeAddressingFailure = coverage.totalParts > 0 && coverage.addressedPartCount === 0;
    const severeCoverageGap = coverage.totalParts > 1 && coverage.missingPartCount >= Math.max(1, coverage.totalParts - 1);
    const sparseIdeas = coverage.totalIdeas <= Math.max(2, coverage.totalParts);
    const weakDevelopment = support.totalBodyRows === 0
      || support.effectiveUnderdevelopedCount >= Math.max(1, support.totalBodyRows - 1);
    const severePromptReuse = taskEcho.severity === "severe" || repeatedRestatement;

    if (severeAddressingFailure) return "Yes";
    if (effectiveWordCount > 0 && effectiveWordCount < 130 && (sparseIdeas || weakDevelopment)) return "Yes";
    if (severeCoverageGap && effectiveWordCount < 175 && weakDevelopment) return "Yes";
    if (severePromptReuse && effectiveWordCount < 155 && (sparseIdeas || weakDevelopment)) return "Yes";

    if (
      coverage.totalParts > 0 &&
      coverage.addressedPartCount >= Math.max(1, coverage.totalParts - 1) &&
      coverage.totalIdeas >= Math.max(3, coverage.totalParts) &&
      support.totalBodyRows >= 1 &&
      support.severelyThinCount === 0 &&
      effectiveWordCount >= 165
    ) {
      return "No";
    }
    if (coverage.totalParts <= 1 && coverage.totalIdeas >= 3 && support.totalBodyRows >= 1 && effectiveWordCount >= 150) {
      return "No";
    }
    return "No";
  },

  "TR3-1": (ctx) => {
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWordCount = lengthProfile.effectiveWordCount;
    const taskEcho = lengthProfile.taskEcho;
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const coverageDropoutRescue = coverageSignalDropoutRescueProfile(ctx);
    const repeatedRestatement = taskEcho.reusedPromptSentenceLikeCount >= 2 || taskEcho.reusedPromptPhraseCount >= 4;

    if (coverageDropoutRescue.eligible) return "No";

    const severeAddressingFailure = coverage.totalParts > 0 && coverage.addressedPartCount === 0;
    const severeCoverageGap = coverage.totalParts > 1 && coverage.missingPartCount >= Math.max(1, coverage.totalParts - 1);
    const verySparseIdeas = coverage.totalIdeas <= Math.max(2, coverage.totalParts);
    const weakDevelopment = support.totalBodyRows === 0
      || support.effectiveUnderdevelopedCount >= Math.max(1, support.totalBodyRows - 1);
    const severePromptReuse = taskEcho.severity === "severe" || repeatedRestatement;

    if (severeAddressingFailure) return "Yes";
    if (effectiveWordCount > 0 && effectiveWordCount < 150 && (severeCoverageGap || verySparseIdeas || weakDevelopment)) return "Yes";
    if (severePromptReuse && effectiveWordCount < 170 && (verySparseIdeas || weakDevelopment)) return "Yes";

    const multiPartAdequate = coverage.totalParts > 1
      && coverage.missingPartCount === 0
      && coverage.totalIdeas >= Math.max(4, coverage.totalParts + 1);
    const singlePartAdequate = coverage.totalParts <= 1 && coverage.totalIdeas >= 3;
    const developedSupport = support.totalBodyRows >= 1
      && (
        support.strongCount >= 1
        || support.effectiveUnderdevelopedCount <= Math.max(1, support.totalBodyRows - 1)
      );

    if (effectiveWordCount >= 190 && developedSupport && (multiPartAdequate || singlePartAdequate) && taskEcho.severity !== "severe") return "No";
    if (
      coverage.totalParts > 0 &&
      coverage.addressedPartCount >= Math.max(1, coverage.totalParts - 1) &&
      coverage.totalIdeas >= Math.max(3, coverage.totalParts) &&
      support.totalBodyRows >= 1 &&
      support.severelyThinCount === 0 &&
      effectiveWordCount >= 170
    ) {
      return "No";
    }

    return "No";
  },

  "TR3-2": (ctx) => {
    const p = stanceProfile(ctx);
    const recovery = trLowBandPositionRecoveryProfile(ctx);
    const coverageDropoutRescue = coverageSignalDropoutRescueProfile(ctx);
    if (coverageDropoutRescue.eligible) return "No";
    if (!p.hasPosition && !recovery.derivedPositionLikely) return "Yes";
    return "No";
  },

  "TR2-2": (ctx) => {
    const p = stanceProfile(ctx);
    const recovery = trLowBandPositionRecoveryProfile(ctx);
    const coverageDropoutRescue = coverageSignalDropoutRescueProfile(ctx);
    if (coverageDropoutRescue.eligible) return "No";
    if (!p.hasPosition && !recovery.derivedPositionLikely) return "Yes";
    return "No";
  },

  "TR2-3A": (ctx) => {
    const totalIdeas = totalSubquestionIdeaCount(ctx);
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const coverageDropoutRescue = coverageSignalDropoutRescueProfile(ctx);
    if (coverageDropoutRescue.eligible) return "No";
    if (totalIdeas === null) return null;

    const developedRowCount = support.rows.filter(
      (row) => row.hasExplanation || row.hasExample || row.evidenceCount >= 2
    ).length;
    const sparseIdeas = totalIdeas <= 2;
    const sparseSinglePrompt = coverage.totalParts <= 1
      && totalIdeas <= 3
      && (lengthProfile.effectiveWordCount < 220 || developedRowCount <= 1);
    const sparseAcrossParts = coverage.totalParts >= 2
      && (coverage.addressedPartCount < coverage.totalParts
        || coverage.thinPartCount >= Math.max(1, coverage.totalParts - 1))
      && totalIdeas <= coverage.totalParts + 1;

    if (sparseIdeas || sparseSinglePrompt || sparseAcrossParts) return "Yes";

    const robustAcrossParts = coverage.totalParts >= 2
      && coverage.missingPartCount === 0
      && coverage.thinPartCount === 0
      && totalIdeas >= coverage.totalParts + 2
      && developedRowCount >= Math.min(2, Math.max(1, support.totalBodyRows));
    if (robustAcrossParts) return "No";

    if (
      coverage.totalParts <= 1
      && totalIdeas >= 4
      && developedRowCount >= 2
      && lengthProfile.effectiveWordCount >= 235
    ) {
      return "No";
    }

    if (support.effectiveUnderdevelopedCount >= 1 && totalIdeas <= 3) return "Yes";
    if (lengthProfile.effectiveWordCount < 210 && totalIdeas <= 3) return "Yes";

    if (totalIdeas >= 4 && developedRowCount >= 1) return "No";
    return "No";
  },

  "TR2-3B": (ctx) => {
    const signals = currentParagraphSupportSignals(ctx);
    if (!signals) return null;
    if (signals.role && signals.role !== "body") return null;

    const noRealSupport = !signals.hasExplanation && !signals.hasExample && signals.evidenceCount === 0;
    const topicOnlyClaim = signals.hasTopicSentence
      && !signals.hasExplanation
      && !signals.hasExample
      && signals.evidenceCount <= 1;
    const skeletalParagraph = signals.paragraphWordCount < 70 && signals.sentenceCount <= 2 && !signals.runOnLikely;
    const exampleOnlyThinWithoutExplanation = !signals.hasExplanation
      && signals.hasExample
      && signals.evidenceCount <= 2
      && signals.paragraphWordCount < 50
      && signals.sentenceCount <= 2
      && !signals.runOnLikely;

    const clearUnderdevelopment =
      (signals.veryThin && !signals.hasSupportProgression)
      || (noRealSupport && (signals.thin || skeletalParagraph))
      || (topicOnlyClaim && skeletalParagraph);

    const developedWithSupport = signals.hasExplanation
      && (signals.hasExample || signals.evidenceCount >= 2)
      && (signals.sentenceCount >= 2 || signals.paragraphWordCount >= 60 || signals.runOnLikely);

    const stableSupportProgression = signals.hasSupportProgression
      && signals.evidenceCount >= 1
      && (signals.sentenceCount >= 2 || signals.runOnLikely)
      && signals.paragraphWordCount >= 55;

    if (clearUnderdevelopment) return "Yes";
    if (exampleOnlyThinWithoutExplanation) return "Yes";
    if (developedWithSupport || stableSupportProgression) return "No";
    if (signals.thin && !signals.hasAnySupportSignal) return "Yes";
    return null;
  },

  "TR3-3A": (ctx) => {
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const stance = stanceProfile(ctx);
    const coverageDropoutRescue = coverageSignalDropoutRescueProfile(ctx);
    if (coverageDropoutRescue.eligible) return "No";
    const effectiveWordCount = lengthProfile.effectiveWordCount;
    const developedRowCount = support.rows.filter(
      (row) => row.hasExplanation || row.hasExample || row.evidenceCount >= 2
    ).length;
    const severeUnderdevelopment = support.effectiveUnderdevelopedCount >= Math.max(1, support.totalBodyRows - 1);
    const missingCoverage = coverage.totalParts > 0 && coverage.addressedPartCount < coverage.totalParts;

    const sparseIdeas = coverage.totalParts > 0
      ? coverage.totalIdeas <= Math.max(2, coverage.totalParts)
      : support.strongCount === 0 && support.totalBodyRows <= 1;
    const sparseDevelopment = support.totalBodyRows >= 2
      ? developedRowCount <= 1
      : support.effectiveUnderdevelopedCount >= 1;
    const thinWithSparseSupport = effectiveWordCount > 0
      && effectiveWordCount < 235
      && support.effectiveUnderdevelopedCount >= Math.max(1, support.totalBodyRows - 1);
    const singlePromptUnderdeveloped = coverage.totalParts <= 1
      && effectiveWordCount < 245
      && (developedRowCount <= 1 || support.effectiveUnderdevelopedCount >= 1);
    const unclearPositionWithThinSupport = !stance.hasPosition
      && effectiveWordCount < 245
      && support.strongCount <= 1;

    if (sparseIdeas) return "Yes";
    if (support.totalBodyRows >= 2 && sparseDevelopment) return "Yes";
    if (thinWithSparseSupport) return "Yes";
    if (missingCoverage || severeUnderdevelopment || singlePromptUnderdeveloped || unclearPositionWithThinSupport) return "Yes";

    if (
      coverage.totalIdeas >= 4 &&
      support.totalBodyRows >= 2 &&
      developedRowCount >= 2 &&
      support.effectiveUnderdevelopedCount === 0 &&
      effectiveWordCount >= 245 &&
      stance.hasPosition
    ) {
      return "No";
    }

    if (
      coverage.totalIdeas >= Math.max(3, coverage.totalParts + 1) &&
      support.strongCount >= Math.min(2, support.totalBodyRows) &&
      support.effectiveUnderdevelopedCount === 0 &&
      effectiveWordCount >= 235
    ) {
      return "No";
    }

    if (coverage.totalIdeas <= Math.max(3, coverage.totalParts + 1) && support.effectiveUnderdevelopedCount >= 1) return "Yes";

    return "No";
  },

  "TR3-3B": (ctx) => {
    const signals = currentParagraphSupportSignals(ctx);
    if (!signals) return "Yes";
    if (signals.role && signals.role !== "body") return null;

    const topicOnlyClaim = signals.hasTopicSentence
      && !signals.hasExplanation
      && !signals.hasExample
      && signals.evidenceCount <= 1;
    const noRealSupport = !signals.hasExplanation && !signals.hasExample && signals.evidenceCount === 0;

    if (signals.veryThin && !signals.hasSupportProgression) return "Yes";
    if (noRealSupport && (signals.thin || signals.sentenceCount <= 1)) return "Yes";
    if (topicOnlyClaim && !signals.runOnLikely) return "Yes";
    if (!signals.hasExplanation && signals.evidenceCount <= 1 && signals.paragraphWordCount < 65 && !signals.runOnLikely) return "Yes";

    if (signals.hasExplanation && (signals.hasExample || signals.evidenceCount >= 2)) return "No";
    if (signals.hasExplanation && signals.evidenceCount >= 2 && (signals.sentenceCount >= 2 || signals.paragraphWordCount >= 60)) return "No";
    if (signals.hasExample && signals.evidenceCount >= 1 && signals.paragraphWordCount >= 55) return "No";
    if (
      signals.hasSupportProgression
      && (signals.evidenceCount >= 1 || signals.hasExample)
      && (signals.sentenceCount >= 2 || signals.runOnLikely)
    ) {
      return "No";
    }

    return (signals.thin || noRealSupport) ? "Yes" : "No";
  },

  "TR3-3C": (ctx) => {
    const signals = currentParagraphSupportSignals(ctx);
    if (!signals) return null;
    if (signals.role && signals.role !== "body") return null;

    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const stance = stanceProfile(ctx);

    const severeCoverageGap = coverage.totalParts > 1
      && (
        coverage.missingPartCount >= 1
        || (coverage.maxIdeas - coverage.minIdeas) >= 2
      );
    const sparseTaskCoverage = coverage.totalParts > 0
      ? coverage.totalIdeas <= Math.max(3, coverage.totalParts + 1)
      : coverage.totalIdeas <= 2;
    const paragraphWeaklyLinked = !signals.hasTopicSentence
      && !signals.hasExplanation
      && signals.evidenceCount <= 1
      && (signals.thin || signals.paragraphWordCount < 75);
    const stanceWeakLinkage = !stance.hasPosition || stance.isInconsistent;
    const broaderWeakDevelopment = support.totalBodyRows >= 1
      && support.effectiveUnderdevelopedCount >= Math.max(1, support.totalBodyRows - 1);

    if (
      severeCoverageGap
      && paragraphWeaklyLinked
      && (stanceWeakLinkage || broaderWeakDevelopment || sparseTaskCoverage)
    ) {
      return "Yes";
    }

    const balancedCoverage = coverage.totalParts > 0
      && coverage.missingPartCount === 0
      && coverage.thinPartCount === 0
      && (coverage.maxIdeas - coverage.minIdeas) <= 1;
    const paragraphClearlyLinked = signals.hasTopicSentence
      && (signals.hasExplanation || signals.hasExample || signals.evidenceCount >= 2)
      && (signals.sentenceCount >= 2 || signals.runOnLikely);

    if (balancedCoverage && paragraphClearlyLinked && stance.hasPosition && !stance.isInconsistent) return "No";
    if (coverage.totalParts > 0 && coverage.missingPartCount === 0 && paragraphClearlyLinked && support.strongCount >= 1) return "No";

    return null;
  },

  "TR4-2": (ctx) => {
    const p = stanceProfile(ctx);
    if (!p.hasStanceSentence) return "none";
    if (!p.isExplicitStance) return "unclear";
    if (p.isInconsistent) return "unclear";
    return "clear";
  },

  "TR4-3": (ctx) => {
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const stance = stanceProfile(ctx);
    const effectiveWordCount = lengthProfile.effectiveWordCount;

    const sparseIdeaSignal = coverage.totalIdeas <= Math.max(3, coverage.totalParts + 1);
    const weakDevelopmentPattern = support.totalBodyRows >= 1
      && support.effectiveUnderdevelopedCount >= Math.max(1, support.totalBodyRows - 1);
    const severeThinPattern = support.severelyThinCount >= 1
      || support.hardUnderdevelopedCount >= Math.max(1, Math.ceil(support.totalBodyRows / 2));
    const unstablePosition = !stance.hasPosition || stance.isInconsistent;

    if (
      sparseIdeaSignal &&
      weakDevelopmentPattern &&
      (
        coverage.missingPartCount >= 1 ||
        severeThinPattern ||
        unstablePosition ||
        effectiveWordCount < 220
      )
    ) {
      return "Yes";
    }

    if (
      coverage.totalParts === 1 &&
      support.totalBodyRows >= 1 &&
      support.strongCount === 0 &&
      support.effectiveUnderdevelopedCount >= 1 &&
      effectiveWordCount < 200
    ) {
      return "Yes";
    }

    const clearIdeaSet = coverage.missingPartCount === 0
      && coverage.totalIdeas >= Math.max(4, coverage.totalParts + 1);
    const developedBody = support.totalBodyRows >= 2
      && support.strongCount >= 1
      && support.effectiveUnderdevelopedCount <= 1;

    if (clearIdeaSet && developedBody && effectiveWordCount >= 220 && stance.hasPosition && !stance.isInconsistent) return "No";
    if (support.strongCount >= 2 && support.effectiveUnderdevelopedCount === 0 && coverage.totalIdeas >= Math.max(4, coverage.totalParts)) return "No";

    return "No";
  },

  "TR5-1": (ctx) => {
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWc = lengthProfile.effectiveWordCount;
    const taskEcho = lengthProfile.taskEcho;
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const stance = stanceProfile(ctx);
    const repeatedRestatement = taskEcho.reusedPromptSentenceLikeCount >= 2 || taskEcho.reusedPromptPhraseCount >= 4;
    const explanationRowCount = support.rows.filter((row) => row.hasExplanation).length;
    const conservativeCoveredDevelopedNoPath =
      coverage.missingPartCount === 0 &&
      coverage.thinPartCount === 0 &&
      coverage.totalIdeas >= Math.max(5, coverage.totalParts + 3) &&
      support.totalBodyRows >= 2 &&
      explanationRowCount >= 2 &&
      support.severelyThinCount === 0 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      effectiveWc >= 220 &&
      taskEcho.severity === "none" &&
      taskEcho.reusedPromptSentenceLikeCount === 0 &&
      taskEcho.reusedPromptPhraseCount <= 1 &&
      stance.hasPosition &&
      !stance.isInconsistent;
    if (!coverage.totalParts) return null;
    if (conservativeCoveredDevelopedNoPath) return "No";
    if (coverage.missingPartCount > 0) return "Yes";
    if (
      coverage.thinPartCount >= Math.max(1, Math.ceil(coverage.totalParts / 2)) &&
      (effectiveWc < 260 || (taskEcho.severity !== "none" && effectiveWc < 275))
    ) {
      return "Yes";
    }
    if (
      taskEcho.severity === "severe" &&
      effectiveWc < 220 &&
      support.effectiveUnderdevelopedCount >= 1
    ) {
      return "Yes";
    }
    if (
      (taskEcho.severity === "moderate" || repeatedRestatement) &&
      effectiveWc < 235 &&
      (coverage.thinPartCount >= 1 || support.effectiveUnderdevelopedCount >= 1)
    ) {
      return "Yes";
    }
    if (
      coverage.missingPartCount === 0 &&
      coverage.thinPartCount === 0 &&
      support.totalBodyRows >= 2 &&
      support.underdevelopedCount === 0 &&
      effectiveWc >= 230
    ) {
      return "No";
    }
    return null;
  },

  "TR5-2": (ctx) => {
    const para = paragraphProfile(ctx);
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWordCount = lengthProfile.effectiveWordCount;
    const segmentationLikelyCollapsed = collapsedParagraphSegmentationLikely(ctx);

    const paragraphCounts = Array.isArray(para?.counts) ? para.counts : [];
    const oneSentenceParagraphCount = paragraphCounts.filter((count) => toFiniteNumber(count, 0) <= 1).length;
    const lacksEssayBody = para.bodyCount === 0 && support.totalBodyRows === 0 && effectiveWordCount >= 150;
    const singleBlockNonEssay = para.paragraphCount <= 1
      && effectiveWordCount >= 180
      && !segmentationLikelyCollapsed
      && support.totalBodyRows === 0;
    const highlyFragmentedNonEssay = para.paragraphCount >= 4
      && oneSentenceParagraphCount >= Math.ceil(para.paragraphCount / 2)
      && support.totalBodyRows <= 1
      && coverage.totalIdeas <= Math.max(3, coverage.totalParts + 1);

    if (lacksEssayBody || singleBlockNonEssay || highlyFragmentedNonEssay) return "Yes";

    if (segmentationLikelyCollapsed) return "No";
    if (para.hasIntro && para.hasConclusion && para.bodyCount >= 1 && support.totalBodyRows >= 1) return "No";
    if (coverage.totalParts > 0 && coverage.addressedPartCount >= 1 && support.totalBodyRows >= 1) return "No";
    if (para.paragraphCount >= 3 && para.bodyCount >= 1) return "No";

    return "No";
  },

  "TR5-3": (ctx) => {
    const p = stanceProfile(ctx);
    return p.hasStanceSentence ? "yes" : "none";
  },

  "TR5-4": (ctx) => {
    const p = stanceProfile(ctx);
    if (!p.hasStanceSentence) return "Yes";
    if (!p.isExplicitStance) return "Yes";
    if (p.contradictions.length > 0) return "Yes";
    return "No";
  },

  "TR5-5": (ctx) => {
    const para = paragraphProfile(ctx);
    const structure = ctx?.step2?.structure || {};
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWordCount = lengthProfile.effectiveWordCount;
    const segmentationLikelyCollapsed = collapsedParagraphSegmentationLikely(ctx);
    const hasConclusionSignal = Object.prototype.hasOwnProperty.call(structure, 'conclusionSignpostFoundInLast');
    const conclusionSignpostFoundInLast = Boolean(structure?.conclusionSignpostFoundInLast);
    const misplacedConclusionSignpost = Boolean(structure?.misplacedConclusionSignpost);

    if (para.hasConclusion) return "No";

    if (hasConclusionSignal && conclusionSignpostFoundInLast && !misplacedConclusionSignpost) {
      return "No";
    }

    if (segmentationLikelyCollapsed && effectiveWordCount >= 220) {
      return "No";
    }

    if (!para.hasConclusion && para.paragraphCount >= 3 && !segmentationLikelyCollapsed) {
      return "Yes";
    }

    if (!para.hasConclusion && effectiveWordCount < 180) {
      return "Yes";
    }

    return null;
  },

  "TR5-6": (ctx) => {
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWordCount = lengthProfile.effectiveWordCount;

    const veryLimitedIdeas = coverage.totalIdeas > 0 && coverage.totalIdeas <= Math.max(2, coverage.totalParts);
    const strongIdeaBreadth = coverage.totalIdeas >= Math.max(4, coverage.totalParts + 1);
    const narrowDevelopment = support.totalBodyRows > 0 && support.strongCount === 0 && support.effectiveUnderdevelopedCount >= 1;
    const robustDevelopment = support.totalBodyRows >= 2 && support.strongCount >= 2 && support.effectiveUnderdevelopedCount === 0;

    if (veryLimitedIdeas) return "Yes";
    if (narrowDevelopment && effectiveWordCount < 250) return "Yes";
    if (strongIdeaBreadth && robustDevelopment && effectiveWordCount >= 240) return "No";
    if (coverage.totalParts > 0 && coverage.missingPartCount === 0 && support.strongCount >= 1 && effectiveWordCount >= 230) return "No";
    return null;
  },

  "TR6-1": (ctx) => {
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWc = lengthProfile.effectiveWordCount;
    const taskEcho = lengthProfile.taskEcho;
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const tr6SinglePartBoundary = tr6SinglePartBoundaryRescueProfile(ctx);
    const tr6SinglePartHighContentClosure = tr6SinglePartHighContentClosureRescueProfile(ctx);
    const tr6SinglePartNoStanceDirectRescue = tr6SinglePartNoStanceDirectRescueProfile(ctx);
    const tr6SinglePartNoStanceSupportRescue = tr6SinglePartNoStanceSupportRescueProfile(ctx);
    const tr6SinglePartNoStanceClosureLift = tr6SinglePartNoStanceClosureLiftEligible(ctx);
    const tr6SinglePartLanguageBackedNoStanceRescue = tr6SinglePartLanguageBackedNoStanceRescueProfile(ctx);
    const singlePrompt = highBandSinglePromptEligibility(ctx);
    const repeatedRestatement = taskEcho.reusedPromptSentenceLikeCount >= 2 || taskEcho.reusedPromptPhraseCount >= 4;
    if (!coverage.totalParts) return null;
    if (singlePrompt.isSinglePart) {
      if (tr6SinglePartNoStanceClosureLift) return "Yes";
      if (tr6SinglePartNoStanceSupportRescue.eligible) return "Yes";
      if (tr6SinglePartNoStanceDirectRescue.eligible) return "Yes";
      if (tr6SinglePartHighContentClosure.eligible) return "Yes";
      if (tr6SinglePartLanguageBackedNoStanceRescue.eligible) return "Yes";
      if (tr6SinglePartBoundary.eligible) return "Yes";
      if (coverage.missingPartCount > 0) return "No";
      if (singlePrompt.tr6Eligible) return "Yes";
      if (
        effectiveWc < 225 ||
        singlePrompt.weakSupport ||
        singlePrompt.majorUnderdevelopment ||
        (singlePrompt.severePromptReuse && effectiveWc < 245)
      ) {
        return "No";
      }
      return null;
    }
    if (coverage.missingPartCount > 0) return "No";
    if (effectiveWc < 210 && coverage.thinPartCount > 0) return "No";
    if (
      (taskEcho.severity === "severe" || repeatedRestatement) &&
      effectiveWc < 235 &&
      (coverage.thinPartCount > 0 || support.underdevelopedCount > 0)
    ) {
      return "No";
    }
    if (
      coverage.missingPartCount === 0 &&
      (
        (effectiveWc >= 245 && coverage.robustPartCount >= Math.max(1, coverage.totalParts - 1)) ||
        (coverage.robustPartCount === coverage.totalParts && support.underdevelopedCount === 0)
      )
    ) {
      return "Yes";
    }
    return null;
  },

  "TR6-2": (ctx) => {
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWc = lengthProfile.effectiveWordCount;
    const taskEcho = lengthProfile.taskEcho;
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const repeatedRestatement = taskEcho.reusedPromptSentenceLikeCount >= 2 || taskEcho.reusedPromptPhraseCount >= 4;
    if (coverage.totalParts === 1) return "No";
    if (coverage.totalParts < 2) return null;
    if (coverage.missingPartCount > 0) return "Yes";
    if ((coverage.maxIdeas - coverage.minIdeas) >= 2) return "Yes";
    if (coverage.thinPartCount >= 1 && effectiveWc < 250) return "Yes";
    if (taskEcho.severity === "severe" && coverage.thinPartCount >= 1 && effectiveWc < 265) return "Yes";
    if ((taskEcho.severity === "moderate" || repeatedRestatement) && coverage.thinPartCount >= 1 && effectiveWc < 255) return "Yes";
    const clearlyBalancedCoverage = coverage.missingPartCount === 0
      && coverage.thinPartCount === 0
      && (coverage.maxIdeas - coverage.minIdeas) <= 1
      && coverage.totalIdeas >= Math.max(4, coverage.totalParts + 2);
    const developedAcrossParts = support.totalBodyRows >= 2
      && support.strongCount >= Math.max(1, Math.min(2, support.totalBodyRows))
      && support.effectiveUnderdevelopedCount <= 1;
    if (clearlyBalancedCoverage && developedAcrossParts && effectiveWc >= 240 && taskEcho.severity !== "severe") return "No";
    if (coverage.robustPartCount === coverage.totalParts && support.underdevelopedCount === 0) return "No";
    return null;
  },

  "TR6-3": (ctx) => {
    const p = stanceProfile(ctx);
    const cov = subquestionCoverage(ctx);
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const para = paragraphProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const repetition = repetitionHeuristic(ctx);
    const lexicalControl = lexicalControlProfile(ctx);
    const tr6SinglePartBoundary = tr6SinglePartBoundaryRescueProfile(ctx);
    const tr6SinglePartHighContentClosure = tr6SinglePartHighContentClosureRescueProfile(ctx);
    const tr6SinglePartNoStanceDirectRescue = tr6SinglePartNoStanceDirectRescueProfile(ctx);
    const tr6SinglePartNoStanceSupportRescue = tr6SinglePartNoStanceSupportRescueProfile(ctx);
    const tr6SinglePartNoStanceClosureLift = tr6SinglePartNoStanceClosureLiftEligible(ctx);
    const finalParagraphSentenceCount = Array.isArray(para?.counts) && para.counts.length
      ? toFiniteNumber(para.counts[para.counts.length - 1], 0)
      : 0;
    const lexicalBoundarySafe = !lexicalControl || (
      ['none', 'minor'].includes(lexicalControl.clarityImpactFromLexis) &&
      ['none', 'minor'].includes(lexicalControl.spellingImpact) &&
      ['none', 'minor'].includes(lexicalControl.wordFormationImpact) &&
      lexicalControl.repetitionImpact !== 'strong' &&
      lexicalControl.awkwardExpressionCountBand !== 'many'
    );
    const directSinglePartRelevanceRescue =
      coverage.totalParts === 1 &&
      coverage.missingPartCount === 0 &&
      coverage.totalIdeas >= 5 &&
      !p.hasStanceSentence &&
      support.totalBodyRows >= 2 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      lengthProfile.effectiveWordCount >= 250 &&
      lengthProfile.taskEcho.severity === 'none' &&
      para.hasConclusion &&
      finalParagraphSentenceCount >= 2 &&
      repetition.topCount <= 10 &&
      repetition.ratio < 0.04 &&
      lexicalBoundarySafe;
    const derivedSinglePartRelevance =
      tr6SinglePartNoStanceClosureLift ||
      tr6SinglePartNoStanceSupportRescue.eligible ||
      tr6SinglePartNoStanceDirectRescue.eligible ||
      tr6SinglePartBoundary.eligible ||
      tr6SinglePartHighContentClosure.eligible ||
      directSinglePartRelevanceRescue;

    if (!p.hasStanceSentence || !p.isExplicitStance) {
      if (derivedSinglePartRelevance) return "relevant";
      return "none";
    }

    // very conservative "irrelevant"
    if (cov.keys.length && cov.lens.every(n => n === 0)) return "irrelevant";
    return "relevant";
  },

  "TR6-4": (ctx) => {
    const p = stanceProfile(ctx);
    const para = paragraphProfile(ctx);
    const tr6SinglePartBoundary = tr6SinglePartBoundaryRescueProfile(ctx);
    const tr6SinglePartHighContentClosure = tr6SinglePartHighContentClosureRescueProfile(ctx);
    const tr6SinglePartNoStanceDirectRescue = tr6SinglePartNoStanceDirectRescueProfile(ctx);
    const tr6SinglePartNoStanceClosureLift = tr6SinglePartNoStanceClosureLiftEligible(ctx);
    const tr6SinglePartLanguageBackedNoStanceRescue = tr6SinglePartLanguageBackedNoStanceRescueProfile(ctx);
    const structure = ctx?.step2?.structure || {};
    const hasConclusionSignal = Object.prototype.hasOwnProperty.call(structure, 'conclusionSignpostFoundInLast');
    const conclusionSignpostFoundInLast = Boolean(structure?.conclusionSignpostFoundInLast);
    const misplacedConclusionSignpost = Boolean(structure?.misplacedConclusionSignpost);
    if (!p.hasStanceSentence) {
      if (tr6SinglePartNoStanceClosureLift) return "No";
      if (tr6SinglePartNoStanceDirectRescue.eligible) return "No";
      if (tr6SinglePartHighContentClosure.eligible) return "No";
      if (tr6SinglePartLanguageBackedNoStanceRescue.eligible) return "No";
      const strongSinglePartClosureRescue =
        tr6SinglePartBoundary.eligible &&
        hasConclusionSignal &&
        conclusionSignpostFoundInLast &&
        !misplacedConclusionSignpost &&
        para.hasConclusion;
      if (strongSinglePartClosureRescue) return "No";
      return "Yes";
    }

    if (!p.isExplicitStance || p.isInconsistent) return "Yes";

    const paragraphCounts = Array.isArray(para?.counts) ? para.counts : [];
    const totalParagraphs = paragraphCounts.length;
    const finalParagraphStart = totalParagraphs > 1
      ? paragraphCounts.slice(0, -1).reduce((sum, count) => sum + toFiniteNumber(count, 0), 0)
      : 0;
    const finalParagraphSentenceCount = totalParagraphs > 0
      ? toFiniteNumber(paragraphCounts[totalParagraphs - 1], 0)
      : 0;
    const stanceInFinalParagraph = totalParagraphs > 0
      && p.stanceSentenceIndex >= finalParagraphStart
      && p.stanceSentenceIndex < (finalParagraphStart + Math.max(1, finalParagraphSentenceCount));

    const conclusionLikelyWeak =
      (para.hasConclusion && hasConclusionSignal && !conclusionSignpostFoundInLast)
      || (!para.hasConclusion && para.paragraphCount >= 3);

    if (conclusionLikelyWeak && !stanceInFinalParagraph) return "Yes";
    if (misplacedConclusionSignpost && !stanceInFinalParagraph) return "Yes";

    if (stanceInFinalParagraph) return "No";
    if (hasConclusionSignal && conclusionSignpostFoundInLast && !misplacedConclusionSignpost) return "No";
    if (para.hasConclusion && p.isClear) return "No";

    return null;
  },

  "TR6-5": (ctx) => {
    const p = stanceProfile(ctx);
    const para = paragraphProfile(ctx);
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const tr6SinglePartHighContentClosure = tr6SinglePartHighContentClosureRescueProfile(ctx);
    const tr6SinglePartNoStanceDirectRescue = tr6SinglePartNoStanceDirectRescueProfile(ctx);
    const tr6SinglePartNoStanceClosureLift = tr6SinglePartNoStanceClosureLiftEligible(ctx);
    const taskEcho = lengthProfile.taskEcho;
    const repetition = repetitionHeuristic(ctx);
    const structure = ctx?.step2?.structure || {};
    const hasConclusionSignal = Object.prototype.hasOwnProperty.call(structure, 'conclusionSignpostFoundInLast');
    const conclusionSignpostFoundInLast = Boolean(structure?.conclusionSignpostFoundInLast);
    const misplacedConclusionSignpost = Boolean(structure?.misplacedConclusionSignpost);

    const paragraphCounts = Array.isArray(para?.counts) ? para.counts : [];
    const totalParagraphs = paragraphCounts.length;
    const finalParagraphStart = totalParagraphs > 1
      ? paragraphCounts.slice(0, -1).reduce((sum, count) => sum + toFiniteNumber(count, 0), 0)
      : 0;
    const finalParagraphSentenceCount = totalParagraphs > 0
      ? toFiniteNumber(paragraphCounts[totalParagraphs - 1], 0)
      : 0;
    const stanceInFinalParagraph = totalParagraphs > 0
      && p.hasStanceSentence
      && p.stanceSentenceIndex >= finalParagraphStart
      && p.stanceSentenceIndex < (finalParagraphStart + Math.max(1, finalParagraphSentenceCount));

    const hasConclusionContext = para.hasConclusion || (hasConclusionSignal && conclusionSignpostFoundInLast);
    if (!hasConclusionContext) return "No";
    if (tr6SinglePartNoStanceClosureLift) return "No";
    if (tr6SinglePartNoStanceDirectRescue.eligible) return "No";
    if (tr6SinglePartHighContentClosure.eligible) return "No";

    const singlePartCoverageEvident =
      coverage.totalParts === 1 &&
      coverage.missingPartCount === 0 &&
      (
        coverage.totalIdeas >= 4 ||
        (support.totalBodyRows >= 2 && lengthProfile.effectiveWordCount >= 250)
      );
    const strongSinglePartClosureBoundaryRescue =
      singlePartCoverageEvident &&
      support.totalBodyRows >= 2 &&
      support.strongCount >= 1 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      lengthProfile.effectiveWordCount >= 240 &&
      para.hasConclusion &&
      hasConclusionSignal &&
      conclusionSignpostFoundInLast &&
      !misplacedConclusionSignpost &&
      finalParagraphSentenceCount >= 2 &&
      repetition.topCount <= 9 &&
      repetition.ratio < 0.04;

    if (strongSinglePartClosureBoundaryRescue) return "No";

    const strongPromptRestatement = taskEcho.severity === "severe"
      || taskEcho.reusedPromptSentenceLikeCount >= 2
      || taskEcho.reusedPromptPhraseCount >= 4;
    const moderatePromptRestatement = taskEcho.severity === "moderate"
      || taskEcho.reusedPromptSentenceLikeCount >= 1
      || taskEcho.reusedPromptPhraseCount >= 2;
    const highLexicalRepetition = repetition.topCount >= 7 && repetition.ratio >= 0.028;
    const thinEnding = finalParagraphSentenceCount > 0 && finalParagraphSentenceCount <= 1;
    const weakClosureSignal = !stanceInFinalParagraph
      || p.isInconsistent
      || (hasConclusionSignal && !conclusionSignpostFoundInLast)
      || misplacedConclusionSignpost;

    if (thinEnding && strongPromptRestatement && weakClosureSignal) return "Yes";
    if (highLexicalRepetition && strongPromptRestatement && weakClosureSignal && support.strongCount <= 1) return "Yes";
    if (thinEnding && moderatePromptRestatement && !stanceInFinalParagraph && support.effectiveUnderdevelopedCount >= 1) return "Yes";

    const controlledEnding = finalParagraphSentenceCount >= 2
      || (para.paragraphCount <= 2 && lengthProfile.effectiveWordCount >= 220);
    const lowPromptReuse = taskEcho.severity === "none"
      || (
        taskEcho.severity === "mild"
        && taskEcho.reusedPromptPhraseCount <= 2
        && taskEcho.reusedPromptSentenceLikeCount === 0
      );
    const closurePositionClear = stanceInFinalParagraph
      || (p.isClear && para.hasConclusion)
      || (hasConclusionSignal && conclusionSignpostFoundInLast && !misplacedConclusionSignpost);

    if (controlledEnding && lowPromptReuse && closurePositionClear && repetition.topCount <= 7) return "No";
    if (taskEcho.severity === "none" && repetition.ratio < 0.03 && !misplacedConclusionSignpost) return "No";

    return "No";
  },

  "TR4-4": (ctx) => {
    const repetition = repetitionHeuristic(ctx);
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWordCount = lengthProfile.effectiveWordCount;

    const highSurfaceRepetition = repetition.topCount >= 8 && repetition.ratio >= 0.03;
    const intenseRepetition = repetition.topCount >= 10 && repetition.ratio >= 0.034;
    const narrowIdeaSet = coverage.totalIdeas > 0 && coverage.totalIdeas <= Math.max(5, coverage.totalParts + 2);
    const weakDevelopment = support.totalBodyRows > 0
      && support.strongCount === 0
      && support.effectiveUnderdevelopedCount >= 1;

    if (intenseRepetition) return "Yes";
    if (highSurfaceRepetition && (narrowIdeaSet || weakDevelopment || effectiveWordCount < 240)) return "Yes";
    if (repetition.topCount >= 7 && repetition.ratio >= 0.034 && weakDevelopment && narrowIdeaSet) return "Yes";

    const broadCoverage = coverage.totalIdeas >= Math.max(6, coverage.totalParts + 3);
    const developedSupport = support.totalBodyRows >= 1
      && support.strongCount >= 1
      && support.effectiveUnderdevelopedCount <= Math.max(1, support.totalBodyRows - 1);
    if (broadCoverage && developedSupport && repetition.ratio < 0.032) return "No";
    if (repetition.topCount <= 6 || repetition.ratio < 0.026) return "No";

    return (repetition.topCount >= 8 && repetition.ratio >= 0.03) ? "Yes" : "No";
  },

  "TR4-5": (ctx) => {
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const stance = stanceProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWordCount = lengthProfile.effectiveWordCount;

    if (!coverage.totalParts) return null;

    const strongCoverageImbalance = coverage.totalParts > 1
      && (
        coverage.missingPartCount >= 1
        || (coverage.maxIdeas - coverage.minIdeas) >= 2
      );
    const thinAcrossMostParts = coverage.totalParts > 1
      && coverage.thinPartCount >= Math.max(1, coverage.totalParts - 1);
    const weakDevelopmentPattern = support.totalBodyRows >= 1
      && (
        support.strongCount === 0
        || support.effectiveUnderdevelopedCount >= Math.max(1, support.totalBodyRows - 1)
      );
    const sparseIdeas = coverage.totalIdeas <= Math.max(3, coverage.totalParts + 1);
    const unstablePosition = !stance.hasPosition || stance.isInconsistent;

    if (
      (strongCoverageImbalance || thinAcrossMostParts)
      && weakDevelopmentPattern
      && (sparseIdeas || unstablePosition || effectiveWordCount < 240)
    ) {
      return "Yes";
    }

    const singlePartWeakDrift = coverage.totalParts === 1
      && coverage.totalIdeas >= 5
      && support.totalBodyRows >= 2
      && support.strongCount === 0
      && support.effectiveUnderdevelopedCount >= 1
      && effectiveWordCount < 220;
    if (singlePartWeakDrift) return "Yes";

    const balancedCoverage = coverage.missingPartCount === 0
      && coverage.thinPartCount === 0
      && (coverage.maxIdeas - coverage.minIdeas) <= 1;
    const sustainedDevelopment = support.totalBodyRows >= 2
      && support.strongCount >= 1
      && support.effectiveUnderdevelopedCount <= 1;

    if (balancedCoverage && sustainedDevelopment && effectiveWordCount >= 230 && stance.hasPosition && !stance.isInconsistent) return "No";
    if (coverage.missingPartCount === 0 && support.strongCount >= 2 && support.effectiveUnderdevelopedCount === 0 && coverage.totalIdeas >= Math.max(4, coverage.totalParts + 1)) return "No";
    if (support.totalBodyRows === 0 && effectiveWordCount >= 170) return "Yes";
    if (
      coverage.totalParts === 1 &&
      support.totalBodyRows >= 1 &&
      support.effectiveUnderdevelopedCount >= 1 &&
      coverage.totalIdeas <= 4
    ) {
      return "Yes";
    }
    if (
      support.totalBodyRows >= 1 &&
      support.effectiveUnderdevelopedCount >= 1 &&
      coverage.totalIdeas <= Math.max(4, coverage.totalParts + 2) &&
      effectiveWordCount < 255
    ) {
      return "Yes";
    }
    if (
      coverage.missingPartCount === 0 &&
      support.totalBodyRows >= 1 &&
      support.strongCount >= 1 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      coverage.totalIdeas >= Math.max(3, coverage.totalParts + 1)
    ) {
      return "No";
    }

    return (support.effectiveUnderdevelopedCount >= Math.max(1, support.totalBodyRows) && coverage.totalIdeas <= Math.max(3, coverage.totalParts + 1)) ? "Yes" : "No";
  },

  "TR4-6": (ctx) => {
    const support = bodySupportProfile(ctx);
    if (!support.totalBodyRows) return null;
    if (support.severelyThinCount >= 1) return "Yes";
    if (support.hardUnderdevelopedCount >= Math.max(1, Math.ceil(support.totalBodyRows / 2))) return "Yes";
    if (
      support.effectiveUnderdevelopedCount >= Math.max(1, Math.ceil(support.totalBodyRows / 2)) &&
      support.recoveredRunOnCount === 0
    ) {
      return "Yes";
    }
    if (support.totalBodyRows >= 2 && support.effectiveUnderdevelopedCount === 0 && support.strongCount >= 2) return "No";
    if (
      support.totalBodyRows >= 2 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      (support.strongCount >= 1 || support.recoveredRunOnCount >= 1)
    ) {
      return "No";
    }
    if (support.totalBodyRows >= 1 && support.effectiveUnderdevelopedCount === 0) return "No";
    return support.effectiveUnderdevelopedCount >= 1 ? "Yes" : "No";
  },

  "TR5-7": (ctx) => {
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWc = lengthProfile.effectiveWordCount;
    const taskEcho = lengthProfile.taskEcho;
    const support = bodySupportProfile(ctx);
    const repeatedRestatement = taskEcho.reusedPromptSentenceLikeCount >= 2 || taskEcho.reusedPromptPhraseCount >= 4;
    if (!support.totalBodyRows) return null;
    if (support.hardUnderdevelopedCount >= 1 && (effectiveWc < 260 || support.strongCount < 2)) return "Yes";
    if (
      support.effectiveUnderdevelopedCount >= 1 &&
      support.hardUnderdevelopedCount === 0 &&
      support.recoveredRunOnCount === 0 &&
      (effectiveWc < 250 || support.strongCount < 2)
    ) {
      return "Yes";
    }
    if (taskEcho.severity === "severe" && support.effectiveUnderdevelopedCount >= 1 && effectiveWc < 245) return "Yes";
    if ((taskEcho.severity === "moderate" || repeatedRestatement) && support.effectiveUnderdevelopedCount >= 1 && effectiveWc < 238) return "Yes";
    if (support.totalBodyRows >= 2 && support.effectiveUnderdevelopedCount === 0 && support.strongCount >= 2 && effectiveWc >= 250) return "No";
    if (
      support.recoveredRunOnCount >= 1 &&
      support.hardUnderdevelopedCount === 0 &&
      support.strongCount >= 1
    ) {
      return "No";
    }
    if (
      support.totalBodyRows >= 2 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      support.strongCount >= 1 &&
      effectiveWc >= 235
    ) {
      return "No";
    }
    if (
      support.totalBodyRows >= 1 &&
      support.effectiveUnderdevelopedCount >= 1 &&
      (support.strongCount === 0 || effectiveWc < 255)
    ) {
      return "Yes";
    }
    return support.effectiveUnderdevelopedCount >= 1 ? "Yes" : "No";
  },

  "TR5-8": (ctx) => {
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const taskEcho = lengthProfile.taskEcho;
    const repetition = repetitionHeuristic(ctx);
    const effectiveWordCount = lengthProfile.effectiveWordCount;

    const severePromptEcho = taskEcho.severity === "severe"
      || taskEcho.reusedPromptSentenceLikeCount >= 2
      || taskEcho.reusedPromptPhraseCount >= 4;
    const missingOrThinCoverage = coverage.totalParts > 0
      && (coverage.missingPartCount >= 1 || coverage.thinPartCount >= Math.max(1, coverage.totalParts - 1));
    const stronglyOffBalance = coverage.totalParts > 1
      && coverage.maxIdeas >= 4
      && coverage.minIdeas === 0;
    const weakDevelopment = support.totalBodyRows >= 1
      && support.effectiveUnderdevelopedCount >= Math.max(1, support.totalBodyRows - 1);

    if (
      severePromptEcho &&
      effectiveWordCount >= 230 &&
      (missingOrThinCoverage || stronglyOffBalance || weakDevelopment)
    ) {
      return "Yes";
    }

    if (
      hasStrongDiscourseCounterSignals(ctx) &&
      !severePromptEcho &&
      coverage.missingPartCount === 0 &&
      support.strongCount >= 1 &&
      repetition.ratio < 0.035
    ) {
      return "No";
    }

    if (
      coverage.missingPartCount === 0 &&
      support.totalBodyRows >= 2 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      !severePromptEcho &&
      repetition.topCount <= 9
    ) {
      return "No";
    }

    return null;
  },

  "TR6-6": (ctx) => {
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWc = lengthProfile.effectiveWordCount;

    if (!coverage.totalParts) return null;

    const severeCoverageGap = coverage.totalParts > 1
      && (coverage.missingPartCount >= 1 || (coverage.maxIdeas - coverage.minIdeas) >= 2);
    const weakSupport = support.totalBodyRows === 0
      || support.effectiveUnderdevelopedCount >= Math.max(1, support.totalBodyRows - 1);
    const sparseIdeas = coverage.totalIdeas <= Math.max(3, coverage.totalParts + 1);

    if (severeCoverageGap && weakSupport) return "No";
    if (weakSupport && sparseIdeas && effectiveWc < 250) return "No";
    if (support.totalBodyRows === 0 && effectiveWc >= 180) return "No";
    if (coverage.totalParts > 1 && coverage.thinPartCount >= Math.max(1, coverage.totalParts - 1) && weakSupport) return "No";

    if (
      coverage.missingPartCount === 0 &&
      coverage.totalIdeas >= Math.max(4, coverage.totalParts + 1) &&
      support.totalBodyRows >= 2 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      support.strongCount >= 1
    ) {
      return "Yes";
    }
    if (
      coverage.totalParts === 1 &&
      coverage.totalIdeas >= 3 &&
      support.totalBodyRows >= 1 &&
      support.effectiveUnderdevelopedCount <= 1
    ) {
      return "Yes";
    }

    return weakSupport ? "No" : "Yes";
  },

  "TR6-7": (ctx) => {
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWc = lengthProfile.effectiveWordCount;
    const support = bodySupportProfile(ctx);
    const coverage = taskCoverageProfile(ctx);
    if (!support.totalBodyRows) {
      if (coverage.thinPartCount >= 1 && effectiveWc < 240) return "Yes";
      return "No";
    }
    if (support.hardUnderdevelopedCount >= 1) return "Yes";
    if (
      support.effectiveUnderdevelopedCount >= 1 &&
      support.recoveredRunOnCount === 0 &&
      (coverage.thinPartCount >= 1 || effectiveWc < 240)
    ) {
      return "Yes";
    }
    if (
      support.effectiveUnderdevelopedCount >= 1 &&
      support.strongCount === 0 &&
      effectiveWc < 255
    ) {
      return "Yes";
    }
    if (support.totalBodyRows >= 2 && support.effectiveUnderdevelopedCount === 0 && support.strongCount >= 2 && effectiveWc >= 245) return "No";
    if (
      support.totalBodyRows >= 2 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      (support.strongCount >= 1 || support.recoveredRunOnCount >= 1) &&
      effectiveWc >= 230 &&
      coverage.missingPartCount === 0
    ) {
      return "No";
    }
    if (support.totalBodyRows >= 1 && support.effectiveUnderdevelopedCount === 0) return "No";
    return support.effectiveUnderdevelopedCount >= 1 ? "Yes" : "No";
  },

  "TR7-1": (ctx) => {
    const coverage = taskCoverageProfile(ctx);
    const stance = stanceProfile(ctx);
    const support = bodySupportProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const taskEcho = lengthProfile.taskEcho;
    const repetition = repetitionHeuristic(ctx);
    const developedRows = developedBodyRowCount(support);
    const singlePrompt = highBandSinglePromptEligibility(ctx);
    const thinBoundaryRescue = singlePartCoverageThinBoundaryRescueProfile(ctx);
    const compactSingleBodyBoundaryRescue = tr7CompactSingleBodyBoundaryRescueProfile(ctx);
    const coverageSignalThinRecovery =
      singlePrompt.isSinglePart &&
      stance.isClear &&
      coverage.missingPartCount === 0 &&
      coverage.totalIdeas <= 1 &&
      support.totalBodyRows >= 3 &&
      developedRows >= 3 &&
      support.hardUnderdevelopedCount <= 1 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      lengthProfile.effectiveWordCount >= 300 &&
      taskEcho.severity !== "severe" &&
      taskEcho.reusedPromptSentenceLikeCount <= 1 &&
      taskEcho.reusedPromptPhraseCount <= 3;
    const twoIdeaHighContentBoundaryRecovery =
      singlePrompt.isSinglePart &&
      stance.isClear &&
      coverage.missingPartCount === 0 &&
      coverage.totalIdeas === 2 &&
      support.totalBodyRows >= 3 &&
      developedRows >= 3 &&
      support.strongCount >= 2 &&
      support.hardUnderdevelopedCount <= 1 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      lengthProfile.effectiveWordCount >= 335 &&
      taskEcho.severity === "none" &&
      taskEcho.reusedPromptSentenceLikeCount === 0 &&
      taskEcho.reusedPromptPhraseCount <= 2 &&
      repetition.topCount <= 11 &&
      repetition.ratio < 0.032;
    setRuleDiagnostic(ctx, 'TR7-1', {
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
        tr7CompactSingleBodyBoundaryRescue: {
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
        isSinglePart: singlePrompt.isSinglePart,
        tr7Eligible: singlePrompt.tr7Eligible,
        compactSingleBodyBoundaryEligible: compactSingleBodyBoundaryRescue.eligible,
        coverageSignalThinRecovery,
        twoIdeaHighContentBoundaryRecovery,
        stanceClear: stance.isClear,
        missingPartCount: coverage.missingPartCount
      }
    });
    if (!coverage.totalParts) return null;
    if (singlePrompt.isSinglePart) {
      if (!stance.isClear) return "No";
      if (coverage.missingPartCount > 0) return "No";
      return (singlePrompt.tr7Eligible || thinBoundaryRescue.eligible || compactSingleBodyBoundaryRescue.eligible || coverageSignalThinRecovery || twoIdeaHighContentBoundaryRecovery) ? "Yes" : "No";
    }
    return coverage.missingPartCount === 0 ? "Yes" : "No";
  },

  "TR7-2": (ctx) => {
    const p = stanceProfile(ctx);
    return p.isClear ? "Yes" : "No";
  },

  "TR7-3": (ctx) => {
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const stance = stanceProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWc = lengthProfile.effectiveWordCount;
    const taskEcho = lengthProfile.taskEcho;
    const developedRows = developedBodyRowCount(support);
    const coverageSignalThinRecovery =
      coverage.totalParts === 1 &&
      stance.isClear &&
      coverage.missingPartCount === 0 &&
      coverage.totalIdeas <= 1 &&
      support.totalBodyRows >= 3 &&
      developedRows >= 3 &&
      support.strongCount >= 2 &&
      support.hardUnderdevelopedCount <= 1 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      effectiveWc >= 300 &&
      taskEcho.severity !== "severe" &&
      taskEcho.reusedPromptSentenceLikeCount <= 1 &&
      taskEcho.reusedPromptPhraseCount <= 3;

    if (!support.totalBodyRows) return "No";
    if (coverageSignalThinRecovery) return "Yes";

    const strongDevelopment =
      support.strongCount >= Math.max(1, Math.min(2, support.totalBodyRows)) &&
      support.effectiveUnderdevelopedCount === 0;
    const balancedCoverage = coverage.totalParts > 0
      ? coverage.missingPartCount === 0 && coverage.thinPartCount <= 1
      : support.totalBodyRows >= 2;

    if (
      strongDevelopment &&
      balancedCoverage &&
      effectiveWc >= 245 &&
      taskEcho.severity !== "severe" &&
      taskEcho.reusedPromptSentenceLikeCount < 2
    ) {
      return "Yes";
    }
    if (support.strongCount === 0 || support.hardUnderdevelopedCount >= 1 || coverage.missingPartCount > 0) return "No";
    if (effectiveWc < 235 && support.strongCount < 2) return "No";
    return (support.effectiveUnderdevelopedCount <= 1 && coverage.thinPartCount === 0 && effectiveWc >= 240) ? "Yes" : "No";
  },

  "TR7-4": (ctx) => {
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWc = lengthProfile.effectiveWordCount;
    const taskEcho = lengthProfile.taskEcho;

    if (coverage.missingPartCount > 0) return "Yes";
    if (support.hardUnderdevelopedCount >= 1) return "Yes";
    if (support.effectiveUnderdevelopedCount >= 1 && effectiveWc < 255) return "Yes";
    if (coverage.totalParts >= 2 && (coverage.maxIdeas - coverage.minIdeas) >= 2 && effectiveWc < 265) return "Yes";
    if (taskEcho.severity === "severe" && effectiveWc < 260) return "Yes";
    if (support.strongCount >= 2 && support.effectiveUnderdevelopedCount === 0 && coverage.thinPartCount === 0 && effectiveWc >= 250) return "No";
    return (support.strongCount >= 1 && coverage.missingPartCount === 0) ? "No" : "Yes";
  },

  "TR7-5": (ctx) => {
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWc = lengthProfile.effectiveWordCount;

    if (support.totalBodyRows < 2 && effectiveWc < 240) return "Yes";
    if (support.hardUnderdevelopedCount >= 1) return "Yes";
    if (support.effectiveUnderdevelopedCount >= Math.max(1, Math.ceil(support.totalBodyRows / 2))) return "Yes";
    if (coverage.totalParts >= 2 && (coverage.maxIdeas - coverage.minIdeas) >= 2 && coverage.thinPartCount >= 1) return "Yes";
    if (support.strongCount >= 2 && support.effectiveUnderdevelopedCount === 0 && coverage.thinPartCount === 0 && effectiveWc >= 245) return "No";
    return (support.strongCount >= 1 && coverage.missingPartCount === 0) ? "No" : "Yes";
  },

  "TR8-1": (ctx) => {
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const stance = stanceProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const taskEcho = lengthProfile.taskEcho;
    const repetition = repetitionHeuristic(ctx);
    const lexicalControl = lexicalControlProfile(ctx);
    const singlePrompt = highBandSinglePromptEligibility(ctx);
    const tr8Recovery = tr8SinglePromptRecoveryProfile(ctx);
    const tr8Multi = tr8MultiPartCeilingProfile(ctx);
    const tr8BoundaryRecovery = tr8HighBandBoundaryRecoveryProfile(ctx);
    const cleanEchoBoundary =
      taskEcho.severity === "none" &&
      taskEcho.reusedPromptSentenceLikeCount === 0 &&
      taskEcho.reusedPromptPhraseCount <= 1;
    const moderateEchoBoundary =
      taskEcho.severity === "moderate" &&
      taskEcho.reusedPromptSentenceLikeCount === 0 &&
      taskEcho.reusedPromptPhraseCount <= 1 &&
      toFiniteNumber(taskEcho.effectiveContentRatio, 0) >= 0.94 &&
      toFiniteNumber(taskEcho.copiedWordEstimate, 0) <= 22;
    const boundaryEchoEligible = cleanEchoBoundary || moderateEchoBoundary;
    const singlePartHighContentBoundaryRecovery =
      singlePrompt.isSinglePart &&
      coverage.missingPartCount === 0 &&
      coverage.thinPartCount === 0 &&
      coverage.totalIdeas >= 4 &&
      support.totalBodyRows >= 2 &&
      support.effectiveUnderdevelopedCount === 0 &&
      support.hardUnderdevelopedCount === 0 &&
      support.strongCount >= Math.max(1, support.totalBodyRows - 1) &&
      lengthProfile.effectiveWordCount >= 260 &&
      cleanEchoBoundary &&
      (stance.hasPosition || coverage.totalIdeas >= 6) &&
      highBandLanguageControlStrong(ctx);
    const singlePartPartialStanceHighControlBoundaryRecovery =
      singlePrompt.isSinglePart &&
      stance.stance === "partial" &&
      stance.hasPosition &&
      !stance.isInconsistent &&
      coverage.missingPartCount === 0 &&
      coverage.thinPartCount === 0 &&
      coverage.totalIdeas >= 8 &&
      support.totalBodyRows >= 2 &&
      support.hardUnderdevelopedCount === 0 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      support.strongCount >= 1 &&
      lengthProfile.effectiveWordCount >= 245 &&
      cleanEchoBoundary &&
      highBandLanguageControlStrong(ctx);
    const singlePartModerateEchoBoundaryRecovery =
      singlePrompt.isSinglePart &&
      stance.isClear &&
      coverage.missingPartCount === 0 &&
      coverage.thinPartCount === 0 &&
      coverage.totalIdeas >= 6 &&
      support.totalBodyRows >= 2 &&
      support.hardUnderdevelopedCount === 0 &&
      support.effectiveUnderdevelopedCount === 0 &&
      support.strongCount >= Math.max(1, support.totalBodyRows - 1) &&
      lengthProfile.effectiveWordCount >= 255 &&
      moderateEchoBoundary &&
      highBandLanguageControlStrong(ctx);
    const singlePartCompactHighControlBoundaryRecovery =
      singlePrompt.isSinglePart &&
      stance.isClear &&
      !stance.isInconsistent &&
      coverage.missingPartCount === 0 &&
      coverage.thinPartCount === 0 &&
      coverage.totalIdeas >= 4 &&
      support.totalBodyRows >= 2 &&
      support.hardUnderdevelopedCount === 0 &&
      support.effectiveUnderdevelopedCount === 0 &&
      support.strongCount >= 1 &&
      lengthProfile.effectiveWordCount >= 250 &&
      cleanEchoBoundary &&
      repetition.topCount <= 10 &&
      repetition.ratio < 0.03 &&
      highBandLanguageControlStrong(ctx);
    const multiPartHighContentNoStanceBoundaryRecovery =
      coverage.totalParts >= 2 &&
      coverage.missingPartCount === 0 &&
      coverage.thinPartCount === 0 &&
      (coverage.maxIdeas - coverage.minIdeas) <= 1 &&
      coverage.totalIdeas >= Math.max(10, coverage.totalParts * 4) &&
      support.totalBodyRows >= 2 &&
      support.effectiveUnderdevelopedCount === 0 &&
      support.hardUnderdevelopedCount === 0 &&
      support.strongCount >= Math.max(1, support.totalBodyRows - 1) &&
      lengthProfile.effectiveWordCount >= 295 &&
      boundaryEchoEligible &&
      (
        !tr8Multi.heavyRepetitionLoop ||
        (
          repetition.topCount <= 12 &&
          repetition.ratio < 0.04 &&
          lexicalControl &&
          ['none', 'mild'].includes(lexicalControl.repetitionImpact)
        )
      ) &&
      !stance.isInconsistent &&
      highBandLanguageControlStrong(ctx);
    if (!coverage.totalParts) return null;
    if (tr8BoundaryRecovery.eligible) return "Yes";
    if (singlePartHighContentBoundaryRecovery) return "Yes";
    if (singlePartPartialStanceHighControlBoundaryRecovery) return "Yes";
    if (singlePartModerateEchoBoundaryRecovery) return "Yes";
    if (singlePartCompactHighControlBoundaryRecovery) return "Yes";
    if (multiPartHighContentNoStanceBoundaryRecovery) return "Yes";
    if (singlePrompt.isSinglePart) {
      if (!stance.isClear) return "No";
      if (coverage.missingPartCount > 0) return "No";
      return (singlePrompt.tr8Eligible || tr8Recovery.eligibleBase) ? "Yes" : "No";
    }
    if (tr8Multi.shouldBlockBand8) return "No";
    if (support.effectiveUnderdevelopedCount >= 1) return "No";
    if (support.totalBodyRows >= 2 && support.strongCount < support.totalBodyRows) return "No";
    if (taskEcho.severity !== "none") return "No";
    if (taskEcho.reusedPromptSentenceLikeCount > 0 || taskEcho.reusedPromptPhraseCount > 1) return "No";
    if (coverage.missingPartCount > 0 || coverage.thinPartCount > 0) return "No";
    if (!tr8Multi.clearPosition) return "No";
    if (tr8Multi.heavyRepetitionLoop || tr8Multi.unevenCoverage) return "No";
    if (tr8Multi.effectiveWordCount < 285) return "No";
    const balancedCoverage = (coverage.maxIdeas - coverage.minIdeas) <= 1;
    const enoughCoverageDepth = coverage.totalIdeas >= Math.max(7, coverage.totalParts * 3);
    return (balancedCoverage && enoughCoverageDepth && coverage.lens.every((n) => n >= 3)) ? "Yes" : "No";
  },

  "TR8-2": (ctx) => {
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWc = lengthProfile.effectiveWordCount;
    const taskEcho = lengthProfile.taskEcho;
    const tr8Recovery = tr8SinglePromptRecoveryProfile(ctx);
    const tr8Multi = tr8MultiPartCeilingProfile(ctx);
    const tr8BoundaryRecovery = tr8HighBandBoundaryRecoveryProfile(ctx);
    const tr8MultiBoundaryRecovery = tr8MultiPartHighContentBoundaryRecoveryProfile(ctx);
    const repetition = repetitionHeuristic(ctx);
    const stance = stanceProfile(ctx);
    const cleanEchoBoundary =
      taskEcho.severity === "none" &&
      taskEcho.reusedPromptSentenceLikeCount === 0 &&
      taskEcho.reusedPromptPhraseCount <= 1;
    const moderateEchoBoundary =
      taskEcho.severity === "moderate" &&
      taskEcho.reusedPromptSentenceLikeCount === 0 &&
      taskEcho.reusedPromptPhraseCount <= 1 &&
      toFiniteNumber(taskEcho.effectiveContentRatio, 0) >= 0.94 &&
      toFiniteNumber(taskEcho.copiedWordEstimate, 0) <= 22;
    const boundaryEchoEligible = cleanEchoBoundary || moderateEchoBoundary;
    const compactBalancedNoStanceBoundaryRecovery =
      coverage.totalParts >= 2 &&
      coverage.missingPartCount === 0 &&
      coverage.thinPartCount === 0 &&
      (coverage.maxIdeas - coverage.minIdeas) <= 1 &&
      coverage.totalIdeas >= Math.max(10, coverage.totalParts * 4) &&
      support.totalBodyRows >= 2 &&
      support.hardUnderdevelopedCount === 0 &&
      support.effectiveUnderdevelopedCount === 0 &&
      support.strongCount >= Math.max(1, support.totalBodyRows - 1) &&
      effectiveWc >= (moderateEchoBoundary ? 290 : 275) &&
      boundaryEchoEligible &&
      repetition.topCount <= 12 &&
      repetition.ratio < 0.04 &&
      !tr8Multi.clearPosition &&
      !stance.isInconsistent &&
      highBandLanguageControlStrong(ctx);
    const singlePartPartialStanceDepthBoundaryRecovery =
      coverage.totalParts === 1 &&
      stance.stance === "partial" &&
      stance.hasPosition &&
      !stance.isInconsistent &&
      coverage.missingPartCount === 0 &&
      coverage.thinPartCount === 0 &&
      coverage.totalIdeas >= 8 &&
      support.totalBodyRows >= 2 &&
      support.hardUnderdevelopedCount === 0 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      support.strongCount >= 1 &&
      effectiveWc >= 245 &&
      cleanEchoBoundary &&
      repetition.topCount <= 10 &&
      repetition.ratio < 0.035 &&
      highBandLanguageControlStrong(ctx);
    const singlePartModerateEchoBoundaryRecovery =
      coverage.totalParts === 1 &&
      stance.isClear &&
      coverage.missingPartCount === 0 &&
      coverage.thinPartCount === 0 &&
      coverage.totalIdeas >= 6 &&
      support.totalBodyRows >= 2 &&
      support.hardUnderdevelopedCount === 0 &&
      support.effectiveUnderdevelopedCount === 0 &&
      support.strongCount >= Math.max(1, support.totalBodyRows - 1) &&
      effectiveWc >= 255 &&
      moderateEchoBoundary &&
      highBandLanguageControlStrong(ctx);
    const singlePartCompactHighControlBoundaryRecovery =
      coverage.totalParts === 1 &&
      stance.isClear &&
      !stance.isInconsistent &&
      coverage.missingPartCount === 0 &&
      coverage.thinPartCount === 0 &&
      coverage.totalIdeas >= 4 &&
      support.totalBodyRows >= 2 &&
      support.hardUnderdevelopedCount === 0 &&
      support.effectiveUnderdevelopedCount === 0 &&
      support.strongCount >= 1 &&
      effectiveWc >= 250 &&
      cleanEchoBoundary &&
      repetition.topCount <= 10 &&
      repetition.ratio < 0.03 &&
      highBandLanguageControlStrong(ctx);

    if (!support.totalBodyRows) return "No";
    if (tr8BoundaryRecovery.eligible) return "Yes";
    if (tr8MultiBoundaryRecovery.eligible) return "Yes";
    if (singlePartPartialStanceDepthBoundaryRecovery) return "Yes";
    if (singlePartModerateEchoBoundaryRecovery) return "Yes";
    if (singlePartCompactHighControlBoundaryRecovery) return "Yes";
    if (compactBalancedNoStanceBoundaryRecovery) return "Yes";
    if (tr8Multi.shouldBlockBand8) return "No";
    if (
      coverage.totalParts >= 2 &&
      support.recoveredRunOnCount >= 1 &&
      repetition.topCount >= 8 &&
      repetition.ratio >= 0.024
    ) {
      return "No";
    }
    if (
      coverage.totalParts === 1 &&
      support.totalBodyRows < 3 &&
      coverage.totalIdeas < 5
    ) {
      return "No";
    }

    const veryStrongCoverage =
      coverage.missingPartCount === 0 &&
      coverage.thinPartCount === 0 &&
      coverage.totalIdeas >= Math.max(6, coverage.totalParts * 2);
    const veryStrongDevelopment =
      support.totalBodyRows >= 2 &&
      support.strongCount >= support.totalBodyRows &&
      support.effectiveUnderdevelopedCount === 0;
    const cleanPromptProfile =
      taskEcho.severity === "none" &&
      taskEcho.reusedPromptSentenceLikeCount === 0 &&
      taskEcho.reusedPromptPhraseCount <= 1;
    const balancedCoverage = (coverage.maxIdeas - coverage.minIdeas) <= 1;
    const enoughCoverageDepth = coverage.totalIdeas >= Math.max(7, coverage.totalParts * 3);
    const consistentCoverageDepth = coverage.lens.every((n) => n >= 3);

    if (tr8Recovery.eligibleBase) return "Yes";
    if (
      veryStrongCoverage &&
      veryStrongDevelopment &&
      cleanPromptProfile &&
      balancedCoverage &&
      enoughCoverageDepth &&
      consistentCoverageDepth &&
      effectiveWc >= 285
    ) {
      return "Yes";
    }
    if (support.strongCount < 2 || support.effectiveUnderdevelopedCount >= 1) return "No";
    if (coverage.missingPartCount > 0 || coverage.thinPartCount >= 1) return "No";
    if (effectiveWc < 265 || taskEcho.severity === "severe") return "No";
    return "No";
  },

  "TR8-3": (ctx) => {
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWc = lengthProfile.effectiveWordCount;
    const taskEcho = lengthProfile.taskEcho;
    const tr8Recovery = tr8SinglePromptRecoveryProfile(ctx);
    const tr8Multi = tr8MultiPartCeilingProfile(ctx);
    const repetition = repetitionHeuristic(ctx);

    if (tr8Multi.shouldBlockBand8) return "No";
    if (
      coverage.totalParts >= 2 &&
      support.recoveredRunOnCount >= 1 &&
      repetition.topCount >= 8 &&
      repetition.ratio >= 0.024
    ) {
      return "No";
    }
    if (
      coverage.totalParts === 1 &&
      support.totalBodyRows < 3 &&
      coverage.totalIdeas < 5
    ) {
      return "No";
    }
    if (tr8Recovery.extendedSupport) return "Yes";
    if (coverage.missingPartCount > 0) return "No";
    if (coverage.thinPartCount > 0) return "No";
    if (coverage.totalParts >= 2 && (coverage.maxIdeas - coverage.minIdeas) > 1) return "No";
    if (coverage.totalParts >= 2 && coverage.totalIdeas < Math.max(7, coverage.totalParts * 3)) return "No";
    if (support.hardUnderdevelopedCount >= 1 || support.effectiveUnderdevelopedCount >= 1) return "No";
    if (support.totalBodyRows < 2 || support.strongCount < support.totalBodyRows) return "No";
    if (taskEcho.severity !== "none") return "No";
    if (effectiveWc < 285) return "No";
    if (taskEcho.reusedPromptSentenceLikeCount > 0 || taskEcho.reusedPromptPhraseCount > 1) return "No";
    return "Yes";
  },

  "TR9-1": (ctx) => {
    const coverage = taskCoverageProfile(ctx);
    const stance = stanceProfile(ctx);
    const singlePrompt = highBandSinglePromptEligibility(ctx);
    if (!coverage.totalParts) return null;
    if (singlePrompt.isSinglePart) {
      if (!stance.isClear || stance.isInconsistent) return "No";
      if (coverage.missingPartCount > 0) return "No";
      return singlePrompt.tr9Eligible ? "Yes" : "No";
    }
    return coverage.lens.every((n) => n >= 3) ? "Yes" : "No";
  },

  "TR9-2": (ctx) => {
    const p = stanceProfile(ctx);
    const coverage = taskCoverageProfile(ctx);
    const supportProfile = bodySupportProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const taskEcho = lengthProfile.taskEcho;
    const repetition = repetitionHeuristic(ctx);
    if (!p.isClear) return "No";
    const supports = Array.isArray(ctx?.step25?.bodySupport) ? ctx.step25.bodySupport : [];
    const strongBodies = supports.filter(x => x && x.hasExplanation && x.hasExample).length;
    const compactSinglePartLowBreadthOverlift =
      coverage.totalParts === 1 &&
      coverage.missingPartCount === 0 &&
      coverage.totalIdeas <= 4 &&
      supportProfile.totalBodyRows >= 2 &&
      supportProfile.effectiveUnderdevelopedCount === 0 &&
      strongBodies >= 2;
    const compactSinglePartRepetitionBoundaryOverlift =
      coverage.totalParts === 1 &&
      supportProfile.totalBodyRows <= 2 &&
      supportProfile.effectiveUnderdevelopedCount === 0 &&
      strongBodies >= 2 &&
      repetition.topCount >= 8 &&
      repetition.ratio >= 0.025;
    const explanationLedFullDevelopmentBoundary =
      coverage.totalParts >= 1 &&
      coverage.missingPartCount === 0 &&
      coverage.thinPartCount === 0 &&
      coverage.totalIdeas >= Math.max(5, coverage.totalParts * 2) &&
      supportProfile.totalBodyRows >= 2 &&
      supportProfile.effectiveUnderdevelopedCount === 0 &&
      supportProfile.hardUnderdevelopedCount === 0 &&
      supportProfile.severelyThinCount === 0 &&
      supportProfile.rows.every((row) => row.hasExplanation && row.evidenceCount >= 2) &&
      taskEcho.severity === "none" &&
      taskEcho.reusedPromptSentenceLikeCount === 0 &&
      taskEcho.reusedPromptPhraseCount <= 1 &&
      lengthProfile.effectiveWordCount >= 250;
    if (compactSinglePartLowBreadthOverlift) return "No";
    if (compactSinglePartRepetitionBoundaryOverlift) return "No";
    if (explanationLedFullDevelopmentBoundary) return "Yes";
    if (strongBodies >= 2) return "Yes";
    return null;
  },

  "TR9-3": (ctx) => {
    const coverage = taskCoverageProfile(ctx);
    const support = bodySupportProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const stance = stanceProfile(ctx);
    const taskEcho = lengthProfile.taskEcho;
    const effectiveWordCount = lengthProfile.effectiveWordCount;

    const strongFullBodySupport =
      support.totalBodyRows >= 2 &&
      support.strongCount >= support.totalBodyRows &&
      support.effectiveUnderdevelopedCount === 0 &&
      support.severelyThinCount === 0;
    const balancedCoverage =
      coverage.totalParts === 0 ||
      (
        coverage.missingPartCount === 0 &&
        coverage.thinPartCount === 0 &&
        coverage.totalIdeas >= Math.max(4, coverage.totalParts * 2)
      );
    const cleanTaskEcho =
      taskEcho.severity === "none" &&
      taskEcho.reusedPromptSentenceLikeCount === 0 &&
      taskEcho.reusedPromptPhraseCount <= 1;

    if (
      strongFullBodySupport &&
      balancedCoverage &&
      cleanTaskEcho &&
      stance.isClear &&
      effectiveWordCount >= 285
    ) {
      return "Yes";
    }

    if (support.totalBodyRows < 2) return "No";
    if (support.strongCount < support.totalBodyRows || support.effectiveUnderdevelopedCount > 0) return "No";
    if (!balancedCoverage) return "No";
    if (!cleanTaskEcho) return "No";
    if (!stance.isClear) return "No";
    if (effectiveWordCount < 270) return "No";
    return "No";
  },

  "TR9-4": (ctx) => {
    const support = bodySupportProfile(ctx);
    const coverage = taskCoverageProfile(ctx);
    const stance = stanceProfile(ctx);
    const lengthProfile = taskResponseLengthProfile(ctx);
    const effectiveWordCount = lengthProfile.effectiveWordCount;
    const taskEcho = lengthProfile.taskEcho;

    if (!stance.isClear || stance.isInconsistent) return "No";
    if (coverage.totalParts > 0 && coverage.missingPartCount > 0) return "No";
    if (support.totalBodyRows < 2) return "No";
    if (support.strongCount < 2) return "No";
    if (support.effectiveUnderdevelopedCount > 0) return "No";
    if (effectiveWordCount < 280) return "No";
    if (taskEcho.severity !== "none" || taskEcho.reusedPromptSentenceLikeCount > 0) return "No";
    if (coverage.totalParts === 1 && coverage.totalIdeas < 5) return "No";
    if (coverage.totalIdeas < Math.max(4, coverage.totalParts * 2)) return "No";
    return "Yes";
  }
};

module.exports = trRules;
