'use strict';

// MVC/services/ielts/scoringRules.js

/**
 * LOGIC REGISTRY (Version 3.2 - Answer-Type Aligned)
 * Deterministic rules to reduce AI variability and ensure outputs match each item's answer_type.
 *
 * If we cannot be confident deterministically, return null to fall back to Step 4 AI.
 */

const RULE_PATCH_GROUP_META = Object.freeze({
  phase1_language_floor_boundary: {
    status: 'temporary',
    introducedByBatch: '6E-B2/6E-C/6F/6I',
    keys: Object.freeze(['LR4-3', 'LR4-4', 'LR4-5', 'LR5-2', 'LR5-3', 'LR5-4', 'GRA4-3', 'GRA4-4', 'GRA5-1', 'GRA5-4', 'GRA5-5', 'GRA5-6']),
    note: 'Boundary de-harshing for high-content but severe-language profiles.'
  },
  phase4_tr6_rescue_boundary: {
    status: 'temporary',
    introducedByBatch: '8A-8H/10A',
    keys: Object.freeze(['TR6-3', 'TR6-5']),
    note: 'Single-part TR6 rescue boundary paths for no-stance/high-content cases.'
  },
  phase5_cc_gra_boundary: {
    status: 'temporary',
    introducedByBatch: '10C/10D/10E',
    keys: Object.freeze(['CC5-2', 'CC5-4', 'CC5-6', 'GRA4-2']),
    note: 'Mid-band CC/GRA boundary stabilization.'
  },
  phase5_cc6_lr6_boundary: {
    status: 'temporary',
    introducedByBatch: '10F/10J',
    keys: Object.freeze(['CC6-2', 'LR6-2']),
    note: 'High-content boundary recovery in CC6/LR6 paths.'
  },
  phase6_cc7_thin_conclusion: {
    status: 'temporary',
    introducedByBatch: '10G',
    keys: Object.freeze(['CC7-4']),
    note: 'CC7 thin-conclusion high-reference boundary control.'
  },
  phase6_lr_gra_boundary_ceiling: {
    status: 'temporary',
    introducedByBatch: '10I',
    keys: Object.freeze(['LR7-1', 'LR7-2', 'GRA8-1']),
    note: 'Band-6/7 boundary control to avoid high-band over-credit on mixed lexical/grammar profiles.'
  },
  phase6_tr_gra7_boundary_relief: {
    status: 'temporary',
    introducedByBatch: '10J',
    keys: Object.freeze(['TR7-1', 'GRA7-2']),
    note: 'Single-part boundary relief for under-credited TR7/GRA7 profiles without low-band relaxation.'
  },
  phase8_tr4_gra3_compact_boundary_relief: {
    status: 'temporary',
    introducedByBatch: '11A/11C',
    keys: Object.freeze(['TR4-1', 'GRA3-1']),
    note: 'Compact single-part boundary relief for recoverable Band-4.5 style profiles.'
  },
  phase8_lr3_compact_major_boundary_relief: {
    status: 'temporary',
    introducedByBatch: '11D',
    keys: Object.freeze(['LR3-2']),
    note: 'Compact single-part lexical severe-floor relief for recoverable major-clarity boundary profile.'
  },
  phase8_tr5_partial_coverage_relief: {
    status: 'temporary',
    introducedByBatch: '11E',
    keys: Object.freeze(['TR5-1']),
    note: 'Deterministic TR5-1 No path for clearly covered/developed boundary profiles to reduce AI fallback variance.'
  },
  phase9_tr8_cc7_boundary_recovery: {
    status: 'temporary',
    introducedByBatch: '11O/11P/11Q',
    keys: Object.freeze(['TR8-1', 'TR8-2', 'CC7-1', 'CC7-2']),
    note: 'High-band boundary recovery controls for TR8 and CC7 targeted tuning.'
  }
});

const RULE_PATCH_GROUPS = Object.freeze(
  Object.fromEntries(
    Object.entries(RULE_PATCH_GROUP_META).map(([groupName, meta]) => [groupName, Array.isArray(meta?.keys) ? meta.keys.slice() : []])
  )
);

const RULE_PATCH_GROUP_NAME_BY_KEY = (() => {
  const out = {};
  for (const [groupName, keys] of Object.entries(RULE_PATCH_GROUPS)) {
    (keys || []).forEach((key) => {
      if (!key || out[key]) return;
      out[key] = groupName;
    });
  }
  return Object.freeze(out);
})();

function normalizeRulePatchGroupToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseRulePatchGroupSet(raw) {
  const out = new Set();
  if (!raw) return out;
  const values = Array.isArray(raw)
    ? raw
    : String(raw).split(/[,\n;|]+/g);
  values.forEach((value) => {
    const token = normalizeRulePatchGroupToken(value);
    if (token) out.add(token);
  });
  return out;
}

const DISABLED_RULE_PATCH_GROUPS = parseRulePatchGroupSet(process.env.IELTS_RULE_PATCH_DISABLED_GROUPS);

function parseBooleanToggle(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!token) return null;
  if (['1', 'true', 'yes', 'on', 'enable', 'enabled'].includes(token)) return true;
  if (['0', 'false', 'no', 'off', 'disable', 'disabled'].includes(token)) return false;
  return null;
}

function getRulePatchGroupEnvOverride(groupName) {
  const envKey = `IELTS_RULE_PATCH_${String(groupName || '').trim().toUpperCase()}`;
  return parseBooleanToggle(process.env[envKey]);
}

function isRulePatchGroupEnabled(groupName) {
  const normalized = normalizeRulePatchGroupToken(groupName);
  if (!normalized) return true;
  const envOverride = getRulePatchGroupEnvOverride(normalized);
  if (envOverride === true) return true;
  if (envOverride === false) return false;
  return !DISABLED_RULE_PATCH_GROUPS.has(normalized);
}

function applyRulePatchGroupGuards(ruleMap) {
  if (!ruleMap || typeof ruleMap !== 'object') return ruleMap;
  for (const [groupName, keys] of Object.entries(RULE_PATCH_GROUPS)) {
    if (!Array.isArray(keys) || !keys.length) continue;
    keys.forEach((key) => {
      const originalRule = ruleMap[key];
      if (typeof originalRule !== 'function') return;
      if (originalRule.__patchGroupWrapped === true) return;
      const wrappedRule = function wrappedRuleWithPatchGroupGuard(ctx) {
        if (!isRulePatchGroupEnabled(groupName)) return null;
        return originalRule(ctx);
      };
      wrappedRule.__patchGroupWrapped = true;
      wrappedRule.__patchGroupName = groupName;
      wrappedRule.__originalRule = originalRule;
      ruleMap[key] = wrappedRule;
    });
  }
  return ruleMap;
}

function ensureRuleDiagnosticsContainer(ctx) {
  if (!ctx || typeof ctx !== 'object') return null;
  if (!ctx.__ruleDiagnostics || typeof ctx.__ruleDiagnostics !== 'object') {
    ctx.__ruleDiagnostics = {};
  }
  return ctx.__ruleDiagnostics;
}

function setRuleDiagnostic(ctx, baseKey, payload = {}) {
  const container = ensureRuleDiagnosticsContainer(ctx);
  if (!container) return;
  const key = String(baseKey || '').trim().toUpperCase();
  if (!key) return;
  const helperProfiles = (payload?.helperProfiles && typeof payload.helperProfiles === 'object')
    ? payload.helperProfiles
    : null;
  const decisionSignals = (payload?.decisionSignals && typeof payload.decisionSignals === 'object')
    ? payload.decisionSignals
    : null;
  container[key] = {
    version: 'v1',
    helperProfiles,
    decisionSignals
  };
}

function subquestionCoverage(ctx) {
  const coverage = ctx?.step25?.answersBySubquestion || {};
  const keys = Object.keys(coverage);
  const lens = keys.map(k => Array.isArray(coverage[k]) ? coverage[k].length : 0);
  return {
    keys,
    lens,
    allPresent: keys.length > 0 && lens.every(n => n > 0)
  };
}

function totalSubquestionIdeaCount(ctx) {
  const cov = subquestionCoverage(ctx);
  if (!cov.keys.length) return null;
  return cov.lens.reduce((sum, n) => sum + Number(n || 0), 0);
}

function stanceProfile(ctx) {
  const pos = ctx?.step25?.position || {};
  const stance = String(pos.stance || "").trim().toLowerCase();
  const stanceSentenceIndex = pos.stanceSentenceIndex;
  const contradictions = Array.isArray(pos.contradictionSentenceIndices) ? pos.contradictionSentenceIndices : [];
  const hasStanceSentence = Number.isInteger(stanceSentenceIndex);
  const isExplicitStance = (stance === "agree" || stance === "disagree" || stance === "partial" || stance === "mixed");
  const hasPosition = hasStanceSentence && isExplicitStance;
  const isInconsistent = hasPosition && contradictions.length > 0;
  return {
    stance,
    stanceSentenceIndex,
    contradictions,
    hasStanceSentence,
    isExplicitStance,
    hasPosition,
    isInconsistent,
    isClear: hasPosition && !isInconsistent
  };
}

function paragraphProfile(ctx) {
  const s = ctx?.step2?.structure || {};
  const roles = Array.isArray(s.paragraphRoles) ? s.paragraphRoles : [];
  const counts = Array.isArray(s.paragraphSentenceCounts) ? s.paragraphSentenceCounts : [];
  const virtualCounts = Array.isArray(s.paragraphVirtualSentenceCounts) ? s.paragraphVirtualSentenceCounts : [];
  const paragraphCount = Number(s.paragraphCount || roles.length || 0);
  const bodyCount = roles.filter(r => r === "body").length;
  const hasIntro = !!s.hasIntro || roles.includes("intro");
  const hasConclusion = !!s.hasConclusion || roles.includes("conclusion");
  const minSent = counts.length ? Math.min(...counts) : 0;
  const bodySentenceCounts = roles
    .map((role, index) => (role === "body" ? toFiniteNumber(counts[index], 0) : null))
    .filter((value) => value !== null);
  const minBodySent = bodySentenceCounts.length ? Math.min(...bodySentenceCounts) : 0;
  const virtualSentenceTotal = virtualCounts.reduce((sum, value) => sum + toFiniteNumber(value, 0), 0);
  const virtualRecoveryApplied = Boolean(s.virtualRecoveryApplied) || virtualSentenceTotal > 0;
  return {
    paragraphCount,
    roles,
    counts,
    virtualCounts,
    bodyCount,
    bodySentenceCounts,
    minBodySent,
    hasIntro,
    hasConclusion,
    minSent,
    virtualSentenceTotal,
    virtualRecoveryApplied
  };
}

function currentParagraphProfile(ctx) {
  const cp = ctx?.currentParagraph || ctx?.paragraph || null;
  if (!cp || !Number.isInteger(cp.paragraphIndex)) return null;

  const paragraphIndex = cp.paragraphIndex;
  const paragraphNumber = Number.isInteger(cp.paragraphNumber) ? cp.paragraphNumber : paragraphIndex + 1;
  const role = cp.role || null;
  const feature = cp.feature || cp.features || null;
  const text = typeof cp.text === "string"
    ? cp.text
    : (typeof cp.paragraphText === "string" ? cp.paragraphText : "");
  const sentences = Array.isArray(cp.sentences) ? cp.sentences : [];

  const topicSentenceRows = Array.isArray(ctx?.step25?.topicSentenceByParagraph)
    ? ctx.step25.topicSentenceByParagraph
    : [];
  const topicSentence = cp.topicSentence || topicSentenceRows.find((row) => Number(row?.paragraphIndex) === paragraphIndex) || null;

  const bodySupportRows = Array.isArray(ctx?.step25?.bodySupport) ? ctx.step25.bodySupport : [];
  const bodySupport = cp.bodySupport || bodySupportRows.find((row) => Number(row?.paragraphIndex) === paragraphIndex) || null;

  return {
    paragraphIndex,
    paragraphNumber,
    role,
    feature,
    text,
    sentences,
    sentenceCount: Number.isInteger(feature?.sentenceCount) ? feature.sentenceCount : sentences.length,
    topicSentence,
    bodySupport
  };
}

function getCurrentParagraphRole(ctx) {
  const current = currentParagraphProfile(ctx);
  return current?.role || null;
}

function getCurrentParagraphSentenceCount(ctx) {
  const current = currentParagraphProfile(ctx);
  if (!current) return null;
  return Number.isInteger(current.sentenceCount) ? current.sentenceCount : null;
}

function currentParagraphSupportSignals(ctx) {
  const current = currentParagraphProfile(ctx);
  if (!current) return null;

  const feature = current.feature || {};
  const bodySupport = current.bodySupport || {};
  const evidenceCount = Array.isArray(bodySupport?.evidenceSentenceIndices)
    ? bodySupport.evidenceSentenceIndices.length
    : 0;
  const paragraphWordCount = toFiniteNumber(
    feature?.paragraphWordCount,
    countWordsSimple(current.text || current.paragraphText || "")
  );
  const sentenceCount = Number.isInteger(feature?.sentenceCount)
    ? feature.sentenceCount
    : (Array.isArray(current.sentences) ? current.sentences.length : 0);
  const virtualSentenceCount = toFiniteNumber(feature?.virtualSentenceCount, 0);
  const hasTopicSentence = Number.isInteger(current?.topicSentence?.topicSentenceIndex);
  const hasExplanation = Boolean(bodySupport?.hasExplanation);
  const hasExample = Boolean(bodySupport?.hasExample);
  const supportSignalCount = [hasExplanation, hasExample, evidenceCount >= 2].filter(Boolean).length;
  const hasAnySupportSignal = supportSignalCount >= 1 || evidenceCount >= 1;
  const hasSupportProgression = hasExplanation || (hasExample && evidenceCount >= 1) || evidenceCount >= 2;
  const runOnLikely = virtualSentenceCount >= 1 || (sentenceCount <= 1 && paragraphWordCount >= 60);
  const veryThin = paragraphWordCount < 45 && sentenceCount <= 1 && virtualSentenceCount === 0;
  const thin = paragraphWordCount < 55 && sentenceCount <= 1 && !runOnLikely;

  return {
    current,
    role: current.role,
    sentenceCount,
    virtualSentenceCount,
    paragraphWordCount,
    evidenceCount,
    hasTopicSentence,
    hasExplanation,
    hasExample,
    supportSignalCount,
    hasAnySupportSignal,
    hasSupportProgression,
    runOnLikely,
    veryThin,
    thin
  };
}

function lexicalControlProfile(ctx) {
  const lexicalControl = ctx?.step25?.lexicalControl;
  return lexicalControl && typeof lexicalControl === "object" ? lexicalControl : null;
}

function grammarControlProfile(ctx) {
  const grammarControl = ctx?.step25?.grammarControl;
  return grammarControl && typeof grammarControl === "object" ? grammarControl : null;
}

function lexicalErrorBand(lexicalControl) {
  if (!lexicalControl) return null;

  const spellingImpact = lexicalControl.spellingImpact;
  const wordFormationImpact = lexicalControl.wordFormationImpact;
  const clarityImpact = lexicalControl.clarityImpactFromLexis;
  const repetitionImpact = lexicalControl.repetitionImpact;
  const awkwardBand = lexicalControl.awkwardExpressionCountBand;

  if (
    spellingImpact === 'frequent' ||
    wordFormationImpact === 'frequent' ||
    clarityImpact === 'major' ||
    repetitionImpact === 'strong' ||
    awkwardBand === 'many'
  ) {
    return 'frequent';
  }

  if (
    spellingImpact === 'some' ||
    wordFormationImpact === 'some' ||
    clarityImpact === 'some' ||
    repetitionImpact === 'noticeable' ||
    awkwardBand === 'some'
  ) {
    return 'occasional';
  }

  if (
    spellingImpact === 'minor' ||
    wordFormationImpact === 'minor' ||
    clarityImpact === 'minor' ||
    repetitionImpact === 'mild' ||
    awkwardBand === 'few'
  ) {
    return 'rare';
  }

  if (
    spellingImpact === 'none' &&
    wordFormationImpact === 'none' &&
    (clarityImpact === 'none' || clarityImpact === 'minor') &&
    (repetitionImpact === 'none' || repetitionImpact === 'mild') &&
    (awkwardBand === 'none' || awkwardBand === 'few')
  ) {
    return 'none';
  }

  return null;
}

const LEXICAL_RANGE_RANK = {
  limited: 1,
  adequate: 2,
  sufficient: 3,
  wide: 4
};

const LEXICAL_PRECISION_RANK = {
  low: 1,
  mixed: 2,
  good: 3,
  high: 4
};

function lexicalRangeAtLeast(lexicalControl, expected) {
  if (!lexicalControl) return false;
  const currentRank = LEXICAL_RANGE_RANK[lexicalControl.rangeBand] || 0;
  const expectedRank = LEXICAL_RANGE_RANK[String(expected || '').trim().toLowerCase()] || 0;
  return currentRank >= expectedRank && expectedRank > 0;
}

function lexicalPrecisionAtLeast(lexicalControl, expected) {
  if (!lexicalControl) return false;
  const currentRank = LEXICAL_PRECISION_RANK[lexicalControl.precisionBand] || 0;
  const expectedRank = LEXICAL_PRECISION_RANK[String(expected || '').trim().toLowerCase()] || 0;
  return currentRank >= expectedRank && expectedRank > 0;
}

function lexicalClarityPreserved(lexicalControl) {
  if (!lexicalControl) return false;
  return lexicalControl.clarityImpactFromLexis === 'none' || lexicalControl.clarityImpactFromLexis === 'minor';
}

function lexicalSurfaceErrorsMinorOrSome(lexicalControl) {
  if (!lexicalControl) return false;
  const spellingOk = ['none', 'minor', 'some'].includes(lexicalControl.spellingImpact);
  const wordFormOk = ['none', 'minor', 'some'].includes(lexicalControl.wordFormationImpact);
  const repetitionOk = ['none', 'mild', 'noticeable'].includes(lexicalControl.repetitionImpact);
  const awkwardOk = ['none', 'few', 'some'].includes(lexicalControl.awkwardExpressionCountBand);
  return spellingOk && wordFormOk && repetitionOk && awkwardOk;
}

function lexicalInstabilitySignalsMidBand(lexicalControl) {
  if (!lexicalControl) return false;
  if (lexicalControl.rangeBand === 'limited') return true;
  if (lexicalControl.precisionBand === 'low') return true;
  if (lexicalControl.clarityImpactFromLexis === 'major') return true;
  if (lexicalControl.awkwardExpressionCountBand === 'many') return true;
  if (lexicalControl.spellingImpact === 'frequent' || lexicalControl.wordFormationImpact === 'frequent') return true;
  if (lexicalControl.collocationControl === 'weak' && ['mixed', 'low'].includes(lexicalControl.precisionBand)) return true;
  if (lexicalControl.clarityImpactFromLexis === 'some' && lexicalControl.precisionBand === 'mixed') return true;
  return false;
}

function lexicalShowsControlledBand6Profile(lexicalControl) {
  if (!lexicalControl) return false;
  if (!lexicalRangeAtLeast(lexicalControl, 'adequate')) return false;
  if (!lexicalPrecisionAtLeast(lexicalControl, 'mixed')) return false;
  const hasStrongMarker =
    lexicalRangeAtLeast(lexicalControl, 'sufficient') ||
    lexicalPrecisionAtLeast(lexicalControl, 'good') ||
    lexicalControl.collocationControl === 'good';
  if (!hasStrongMarker) return false;
  if (lexicalControl.clarityImpactFromLexis === 'major') return false;
  if (lexicalControl.rangeBand === 'adequate' && lexicalControl.precisionBand === 'low') return false;
  if (
    lexicalControl.rangeBand === 'adequate' &&
    lexicalControl.precisionBand === 'mixed' &&
    lexicalControl.collocationControl === 'mixed'
  ) {
    return false;
  }
  if (
    lexicalControl.clarityImpactFromLexis === 'some' &&
    !lexicalPrecisionAtLeast(lexicalControl, 'good') &&
    lexicalControl.collocationControl !== 'good'
  ) {
    return false;
  }
  if (!lexicalSurfaceErrorsMinorOrSome(lexicalControl)) return false;
  return true;
}

function lexicalShowsControlledBand7Profile(lexicalControl) {
  if (!lexicalControl) return false;
  if (!lexicalRangeAtLeast(lexicalControl, 'sufficient')) return false;
  if (!lexicalPrecisionAtLeast(lexicalControl, 'good')) return false;
  if (!lexicalClarityPreserved(lexicalControl)) return false;
  if (!['mixed', 'good'].includes(lexicalControl.collocationControl)) return false;
  if (lexicalControl.awkwardExpressionCountBand === 'many') return false;
  if (lexicalControl.spellingImpact === 'frequent' || lexicalControl.wordFormationImpact === 'frequent') return false;
  return true;
}

function grammarWeakControlCount(grammarControl) {
  if (!grammarControl) return 0;
  const checks = [
    grammarControl.subjectVerbAgreement,
    grammarControl.articleControl,
    grammarControl.prepositionControl,
    grammarControl.punctuationControl,
    grammarControl.sentenceBoundaryControl
  ];
  return checks.filter((v) => v === 'weak').length;
}

function grammarMixedOrWeakControlCount(grammarControl) {
  if (!grammarControl) return 0;
  const checks = [
    grammarControl.subjectVerbAgreement,
    grammarControl.articleControl,
    grammarControl.prepositionControl,
    grammarControl.punctuationControl,
    grammarControl.sentenceBoundaryControl
  ];
  return checks.filter((v) => v === 'mixed' || v === 'weak').length;
}

function grammarClarityStable(grammarControl) {
  if (!grammarControl) return false;
  return grammarControl.clarityImpactFromGrammar === 'none' || grammarControl.clarityImpactFromGrammar === 'minor';
}

function grammarRangeLimited(grammarControl) {
  if (!grammarControl) return false;
  if (grammarControl.structureRange === 'simple_only') return true;
  if (grammarControl.structureRange === 'mixed' && grammarControl.complexSentenceControl === 'weak') return true;
  return false;
}

function grammarComplexAttempted(grammarControl) {
  if (!grammarControl) return false;
  if (grammarControl.structureRange === 'mixed' || grammarControl.structureRange === 'varied' || grammarControl.structureRange === 'wide') {
    return true;
  }
  return grammarControl.complexSentenceControl === 'mixed' || grammarControl.complexSentenceControl === 'good';
}

function languageCalibrationRescueProfile(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const para = paragraphProfile(ctx);
  const repetition = repetitionHeuristic(ctx);

  const hasSectionSkeleton = para.paragraphCount >= 4 && para.hasIntro && para.hasConclusion && para.bodyCount >= 2;
  const developedBodySupport = support.totalBodyRows >= 2
    && support.strongCount >= 2
    && support.effectiveUnderdevelopedCount === 0;
  const adequateCoverage = coverage.totalParts > 0
    ? coverage.missingPartCount === 0 && coverage.totalIdeas >= Math.max(3, coverage.totalParts + 1)
    : coverage.totalIdeas >= 3;
  const sufficientEffectiveLength = lengthProfile.effectiveWordCount >= 260;
  const noSeverePromptEcho = lengthProfile.taskEcho.severity !== 'severe';
  const controlledRepetition = repetition.ratio < 0.035 && repetition.topCount <= 10;

  const highContentStrength = hasSectionSkeleton
    && developedBodySupport
    && adequateCoverage
    && sufficientEffectiveLength
    && noSeverePromptEcho;
  const conservativeRescueEligible = highContentStrength && controlledRepetition;

  return {
    hasSectionSkeleton,
    developedBodySupport,
    adequateCoverage,
    sufficientEffectiveLength,
    noSeverePromptEcho,
    controlledRepetition,
    highContentStrength,
    conservativeRescueEligible
  };
}

function coverageSignalDropoutRescueProfile(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const para = paragraphProfile(ctx);
  const taskEcho = lengthProfile.taskEcho;
  const repetition = repetitionHeuristic(ctx);

  const coverageLooksMissing =
    coverage.totalParts >= 1 &&
    coverage.addressedPartCount === 0 &&
    coverage.totalIdeas === 0;

  const rows = Array.isArray(support?.rows) ? support.rows : [];
  const roles = Array.isArray(para?.roles) ? para.roles : [];
  const bodyRows = rows.filter((row) => {
    const idx = Number(row?.paragraphIndex);
    const role = Number.isInteger(idx) ? String(roles[idx] || '').toLowerCase() : '';
    if (!role) return true;
    return role === 'body';
  });
  const explanationDenseBodyRows = bodyRows.filter((row) => (
    Boolean(row?.hasExplanation) && toFiniteNumber(row?.evidenceCount, 0) >= 2
  )).length;
  const severeThinBodyRows = bodyRows.filter((row) => (
    !Boolean(row?.hasExplanation) &&
    !Boolean(row?.hasExample) &&
    toFiniteNumber(row?.evidenceCount, 0) === 0
  )).length;

  const hasSectionSkeleton = para.paragraphCount >= 4 && para.hasIntro && para.hasConclusion && para.bodyCount >= 2;
  const strongBodySupport = bodyRows.length >= 2 && explanationDenseBodyRows >= 2 && severeThinBodyRows === 0;
  const noPromptEcho = taskEcho.severity === 'none'
    && taskEcho.reusedPromptPhraseCount === 0
    && taskEcho.reusedPromptSentenceLikeCount === 0;
  const controlledRepetition = repetition.topCount <= 10 && repetition.ratio < 0.04;

  const eligible =
    coverageLooksMissing &&
    hasSectionSkeleton &&
    strongBodySupport &&
    lengthProfile.effectiveWordCount >= 260 &&
    noPromptEcho &&
    controlledRepetition;

  return {
    coverageLooksMissing,
    hasSectionSkeleton,
    strongBodySupport,
    explanationDenseBodyRows,
    severeThinBodyRows,
    noPromptEcho,
    controlledRepetition,
    eligible
  };
}

function singlePartCoverageThinBoundaryRescueProfile(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const para = paragraphProfile(ctx);
  const taskEcho = lengthProfile.taskEcho;
  const repetition = repetitionHeuristic(ctx);
  const developedRows = developedBodyRowCount(support);
  const rows = Array.isArray(support?.rows) ? support.rows : [];
  const roles = Array.isArray(para?.roles) ? para.roles : [];
  const bodyRows = rows.filter((row) => {
    const idx = Number(row?.paragraphIndex);
    const role = Number.isInteger(idx) ? String(roles[idx] || '').toLowerCase() : '';
    if (!role) return true;
    return role === 'body';
  });
  const severeThinBodyRows = bodyRows.filter((row) => Boolean(row?.severelyThin)).length;

  const eligible =
    coverage.totalParts === 1 &&
    coverage.missingPartCount === 0 &&
    coverage.totalIdeas <= 1 &&
    para.paragraphCount >= 5 &&
    para.bodyCount >= 4 &&
    para.hasConclusion &&
    support.totalBodyRows >= 4 &&
    developedRows >= 2 &&
    severeThinBodyRows <= Math.max(3, support.totalBodyRows - 2) &&
    lengthProfile.effectiveWordCount >= 300 &&
    taskEcho.severity === 'none' &&
    repetition.topCount <= 12 &&
    repetition.ratio < 0.04;

  return {
    coverage,
    support,
    lengthProfile,
    para,
    taskEcho,
    repetition,
    developedRows,
    severeThinBodyRows,
    eligible
  };
}

function tr7CompactSingleBodyBoundaryRescueProfile(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const para = paragraphProfile(ctx);
  const stance = stanceProfile(ctx);
  const repetition = repetitionHeuristic(ctx);
  const developedRows = developedBodyRowCount(support);
  const taskEcho = lengthProfile.taskEcho;

  const eligible =
    coverage.totalParts === 1 &&
    coverage.missingPartCount === 0 &&
    coverage.totalIdeas >= 8 &&
    para.paragraphCount === 3 &&
    para.bodyCount === 1 &&
    para.hasIntro &&
    para.hasConclusion &&
    support.totalBodyRows === 1 &&
    developedRows >= 1 &&
    support.effectiveUnderdevelopedCount === 0 &&
    support.severelyThinCount === 0 &&
    lengthProfile.effectiveWordCount >= 205 &&
    taskEcho.severity !== 'severe' &&
    taskEcho.reusedPromptSentenceLikeCount <= 1 &&
    taskEcho.reusedPromptPhraseCount <= 2 &&
    repetition.topCount <= 9 &&
    repetition.ratio < 0.035 &&
    stance.isClear;

  return {
    coverage,
    support,
    lengthProfile,
    para,
    stance,
    repetition,
    developedRows,
    taskEcho,
    eligible
  };
}

function lr6CompactSingleBodyBoundaryRescueProfile(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const para = paragraphProfile(ctx);
  const stance = stanceProfile(ctx);
  const repetition = repetitionHeuristic(ctx);
  const developedRows = developedBodyRowCount(support);
  const taskEcho = lengthProfile.taskEcho;

  const eligible =
    coverage.totalParts === 1 &&
    coverage.missingPartCount === 0 &&
    coverage.totalIdeas >= 8 &&
    para.paragraphCount === 3 &&
    para.bodyCount === 1 &&
    para.hasIntro &&
    para.hasConclusion &&
    support.totalBodyRows === 1 &&
    developedRows >= 1 &&
    support.effectiveUnderdevelopedCount === 0 &&
    support.severelyThinCount === 0 &&
    lengthProfile.effectiveWordCount >= 200 &&
    taskEcho.severity !== 'severe' &&
    taskEcho.reusedPromptSentenceLikeCount <= 1 &&
    taskEcho.reusedPromptPhraseCount <= 2 &&
    repetition.topCount <= 9 &&
    repetition.ratio < 0.035 &&
    stance.isClear;

  return {
    coverage,
    support,
    lengthProfile,
    para,
    stance,
    repetition,
    developedRows,
    taskEcho,
    eligible
  };
}

function gra7LongHighContentBoundaryRescueProfile(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const para = paragraphProfile(ctx);
  const stance = stanceProfile(ctx);
  const taskEcho = lengthProfile.taskEcho;
  const repetition = repetitionHeuristic(ctx);
  const developedRows = developedBodyRowCount(support);

  const eligible =
    coverage.totalParts === 1 &&
    coverage.missingPartCount === 0 &&
    coverage.totalIdeas >= 2 &&
    para.paragraphCount >= 4 &&
    para.bodyCount >= 2 &&
    para.hasIntro &&
    para.hasConclusion &&
    support.totalBodyRows >= 2 &&
    developedRows >= 2 &&
    support.effectiveUnderdevelopedCount <= 1 &&
    support.severelyThinCount === 0 &&
    lengthProfile.effectiveWordCount >= 320 &&
    taskEcho.severity !== 'severe' &&
    repetition.topCount <= 10 &&
    repetition.ratio < 0.03 &&
    stance.isClear;

  return {
    coverage,
    support,
    lengthProfile,
    para,
    stance,
    taskEcho,
    repetition,
    developedRows,
    eligible
  };
}

function repetitionHeuristic(ctx) {
  const wc = Number(ctx?.step1?.stats?.wordCount || 0);
  const top = Array.isArray(ctx?.step2?.lexical?.topRepeatedWords) ? ctx.step2.lexical.topRepeatedWords : [];
  const stop = new Set([
    "the","a","an","and","or","but","if","then","else","so","because","as","since","of","to","in","on","at","for",
    "with","by","from","into","about","over","under","between","through","during","before","after",
    "is","are","was","were","be","been","being","do","does","did","have","has","had",
    "i","you","he","she","it","we","they","me","him","her","us","them","my","your","his","their","our",
    "this","that","these","those","there","here",
    "not","many","some","people","thing","things"
  ]);
  const content = top.filter(x => x && x.word && !stop.has(String(x.word).toLowerCase()));
  const topCount = content.length ? Number(content[0].count || 0) : 0;
  const topWord = content.length ? String(content[0].word || "").trim().toLowerCase() : "";
  const ratio = wc > 0 ? (topCount / wc) : 0;
  return { wc, topCount, topWord, ratio };
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function countWordsSimple(text) {
  const tokens = String(text ?? "").match(/[A-Za-z0-9]+/g);
  return Array.isArray(tokens) ? tokens.length : 0;
}

function normalizeTaskEchoSeverity(value) {
  const token = String(value || "").trim().toLowerCase();
  if (token === "severe" || token === "moderate" || token === "mild") return token;
  return "none";
}

function taskEchoProfile(ctx) {
  const rawWordCount = toFiniteNumber(ctx?.step1?.stats?.wordCount, 0);
  const taskEcho = (ctx?.step2?.taskEcho && typeof ctx.step2.taskEcho === "object")
    ? ctx.step2.taskEcho
    : {};

  const wordOverlapRatio = Math.max(0, Math.min(1, toFiniteNumber(taskEcho.wordOverlapRatio, 0)));
  const reusedPromptPhraseCount = Math.max(0, Math.round(toFiniteNumber(taskEcho.reusedPromptPhraseCount, 0)));
  const reusedPromptSentenceLikeCount = Math.max(0, Math.round(toFiniteNumber(taskEcho.reusedPromptSentenceLikeCount, 0)));
  const copiedWordEstimate = Math.max(0, Math.round(toFiniteNumber(taskEcho.copiedWordEstimate, 0)));
  const anchorReuseCount = Math.max(0, Math.round(toFiniteNumber(taskEcho.anchorReuseCount, 0)));
  const matchedUnitCount = Array.isArray(taskEcho.matchedUnitDiagnostics)
    ? taskEcho.matchedUnitDiagnostics.length
    : 0;

  let effectiveContentWordCount = toFiniteNumber(taskEcho.effectiveContentWordCount, rawWordCount);
  if (rawWordCount > 0) {
    effectiveContentWordCount = Math.min(rawWordCount, Math.max(0, effectiveContentWordCount));
  } else {
    effectiveContentWordCount = Math.max(0, effectiveContentWordCount);
  }

  let effectiveContentRatio = toFiniteNumber(
    taskEcho.effectiveContentRatio,
    rawWordCount > 0 ? (effectiveContentWordCount / rawWordCount) : 0
  );
  effectiveContentRatio = Math.max(0, Math.min(1, effectiveContentRatio));

  let severity = normalizeTaskEchoSeverity(taskEcho.severity);
  if (severity === "none") {
    if (
      reusedPromptSentenceLikeCount >= 2 ||
      (reusedPromptPhraseCount >= 3 && copiedWordEstimate >= 32) ||
      copiedWordEstimate >= 48 ||
      (anchorReuseCount >= 5 && wordOverlapRatio >= 0.34 && copiedWordEstimate >= 30)
    ) {
      severity = "severe";
    } else if (
      reusedPromptSentenceLikeCount >= 1 ||
      reusedPromptPhraseCount >= 2 ||
      copiedWordEstimate >= 22 ||
      (wordOverlapRatio >= 0.24 && anchorReuseCount >= 4)
    ) {
      severity = "moderate";
    } else if (
      reusedPromptPhraseCount >= 1 ||
      copiedWordEstimate >= 12 ||
      (wordOverlapRatio >= 0.22 && anchorReuseCount >= 2)
    ) {
      severity = "mild";
    }
  }

  return {
    wordOverlapRatio,
    reusedPromptPhraseCount,
    reusedPromptSentenceLikeCount,
    copiedWordEstimate,
    anchorReuseCount,
    matchedUnitCount,
    effectiveContentWordCount,
    effectiveContentRatio,
    severity
  };
}

function taskResponseLengthProfile(ctx) {
  const rawWordCount = toFiniteNumber(ctx?.step1?.stats?.wordCount, 0);
  const taskEcho = taskEchoProfile(ctx);
  const effectiveWordCount = rawWordCount > 0
    ? Math.min(rawWordCount, Math.max(0, taskEcho.effectiveContentWordCount))
    : Math.max(0, taskEcho.effectiveContentWordCount);

  return {
    rawWordCount,
    effectiveWordCount,
    taskEcho
  };
}

function taskCoverageProfile(ctx) {
  const cov = subquestionCoverage(ctx);
  const totalParts = cov.keys.length;
  const addressedPartCount = cov.lens.filter((n) => n > 0).length;
  const missingPartCount = cov.lens.filter((n) => n === 0).length;
  const thinPartCount = cov.lens.filter((n) => n <= 1).length;
  const robustPartCount = cov.lens.filter((n) => n >= 2).length;
  const maxIdeas = cov.lens.length ? Math.max(...cov.lens) : 0;
  const minIdeas = cov.lens.length ? Math.min(...cov.lens) : 0;
  const totalIdeas = cov.lens.reduce((sum, n) => sum + Number(n || 0), 0);
  return {
    ...cov,
    totalParts,
    addressedPartCount,
    missingPartCount,
    thinPartCount,
    robustPartCount,
    maxIdeas,
    minIdeas,
    totalIdeas
  };
}

function bodySupportProfile(ctx) {
  const rows = Array.isArray(ctx?.step25?.bodySupport) ? ctx.step25.bodySupport : [];
  const paragraphFeatures = Array.isArray(ctx?.step2?.perParagraphFeatures) ? ctx.step2.perParagraphFeatures : [];
  const essayParagraphs = Array.isArray(ctx?.essay?.paragraphs) ? ctx.essay.paragraphs : [];
  const normalizedRows = rows.map((row) => {
    const paragraphIndex = Number(row?.paragraphIndex);
    const paragraphFeature = paragraphFeatures.find((entry) => Number(entry?.paragraphIndex) === paragraphIndex) || null;
    const paragraphText = Number.isInteger(paragraphIndex) ? String(essayParagraphs?.[paragraphIndex]?.text || "") : "";
    const paragraphWordCount = paragraphFeature?.paragraphWordCount
      ? toFiniteNumber(paragraphFeature.paragraphWordCount, 0)
      : countWordsSimple(paragraphText);
    const paragraphSentenceCount = Number.isInteger(paragraphFeature?.sentenceCount)
      ? paragraphFeature.sentenceCount
      : 0;
    const paragraphVirtualSentenceCount = toFiniteNumber(paragraphFeature?.virtualSentenceCount, 0);

    const evidenceCount = Array.isArray(row?.evidenceSentenceIndices) ? row.evidenceSentenceIndices.length : 0;
    const hasExplanation = Boolean(row?.hasExplanation);
    const hasExample = Boolean(row?.hasExample);
    const stronglyDeveloped = hasExplanation && hasExample && evidenceCount >= 2;
    const underDeveloped = !hasExplanation || (!hasExample && evidenceCount < 2);
    const recoveredRunOn = paragraphVirtualSentenceCount >= 1 && paragraphSentenceCount >= 2;
    const longSingleUnit = paragraphSentenceCount <= 1 && paragraphWordCount >= 55;
    const softUnderDeveloped = underDeveloped && recoveredRunOn && hasExplanation && evidenceCount >= 1 && !hasExample;
    const hardUnderDeveloped = underDeveloped && !softUnderDeveloped;
    const severelyThin = !hasExplanation && !hasExample && evidenceCount === 0;
    return {
      ...row,
      paragraphIndex,
      paragraphWordCount,
      paragraphSentenceCount,
      paragraphVirtualSentenceCount,
      evidenceCount,
      hasExplanation,
      hasExample,
      stronglyDeveloped,
      recoveredRunOn,
      longSingleUnit,
      underDeveloped,
      softUnderDeveloped,
      hardUnderDeveloped,
      severelyThin
    };
  });

  const totalBodyRows = normalizedRows.length;
  const strongCount = normalizedRows.filter((r) => r.stronglyDeveloped).length;
  const underdevelopedCount = normalizedRows.filter((r) => r.underDeveloped).length;
  const hardUnderdevelopedCount = normalizedRows.filter((r) => r.hardUnderDeveloped).length;
  const softUnderdevelopedCount = normalizedRows.filter((r) => r.softUnderDeveloped).length;
  const effectiveUnderdevelopedCount = hardUnderdevelopedCount + Math.ceil(softUnderdevelopedCount / 2);
  const severelyThinCount = normalizedRows.filter((r) => r.severelyThin).length;
  const recoveredRunOnCount = normalizedRows.filter((r) => r.recoveredRunOn).length;
  const longSingleUnitCount = normalizedRows.filter((r) => r.longSingleUnit).length;

  return {
    rows: normalizedRows,
    totalBodyRows,
    strongCount,
    underdevelopedCount,
    hardUnderdevelopedCount,
    softUnderdevelopedCount,
    effectiveUnderdevelopedCount,
    severelyThinCount,
    recoveredRunOnCount,
    longSingleUnitCount
  };
}

function developedBodyRowCount(supportProfile) {
  const rows = Array.isArray(supportProfile?.rows) ? supportProfile.rows : [];
  return rows.filter((row) => (
    row.hasExplanation || row.hasExample || row.evidenceCount >= 2
  )).length;
}

function trLowBandPositionRecoveryProfile(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);

  const developedRowCount = developedBodyRowCount(support);
  const adequateCoverage = coverage.totalParts > 0
    ? coverage.addressedPartCount === coverage.totalParts
      && coverage.totalIdeas >= Math.max(3, coverage.totalParts + 1)
    : coverage.totalIdeas >= 3;
  const sustainedSupport = support.totalBodyRows >= 2
    ? developedRowCount >= 2 && support.effectiveUnderdevelopedCount <= 1
    : developedRowCount >= 1;
  const enoughEffectiveLength = lengthProfile.effectiveWordCount >= 210;

  return {
    coverage,
    support,
    lengthProfile,
    developedRowCount,
    adequateCoverage,
    sustainedSupport,
    enoughEffectiveLength,
    derivedPositionLikely: adequateCoverage && sustainedSupport && enoughEffectiveLength
  };
}

function highBandSinglePromptEligibility(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const stance = stanceProfile(ctx);
  const taskEcho = lengthProfile.taskEcho;
  const effectiveWordCount = lengthProfile.effectiveWordCount;

  const isSinglePart = coverage.totalParts === 1;
  const severePromptReuse = taskEcho.severity === "severe"
    || taskEcho.reusedPromptSentenceLikeCount >= 2
    || taskEcho.reusedPromptPhraseCount >= 4;
  const moderatePromptReuse = severePromptReuse || taskEcho.severity === "moderate";
  const weakSupport = support.totalBodyRows < 1 || support.strongCount < 1;
  const majorUnderdevelopment = support.hardUnderdevelopedCount >= 1 || support.effectiveUnderdevelopedCount >= 2;
  const fullBodyControl = support.totalBodyRows >= 2
    && support.strongCount >= 2
    && support.effectiveUnderdevelopedCount === 0;

  const tr6Eligible = isSinglePart
    && coverage.missingPartCount === 0
    && effectiveWordCount >= 225
    && !weakSupport
    && support.effectiveUnderdevelopedCount <= 1
    && !(severePromptReuse && effectiveWordCount < 245);

  const tr7Eligible = tr6Eligible
    && stance.isClear
    && effectiveWordCount >= 245
    && support.totalBodyRows >= 2
    && support.hardUnderdevelopedCount === 0
    && support.effectiveUnderdevelopedCount === 0;

  const tr8Eligible = tr7Eligible
    && effectiveWordCount >= 265
    && fullBodyControl
    && !moderatePromptReuse;

  const tr9Eligible = tr8Eligible
    && effectiveWordCount >= 290
    && support.strongCount >= support.totalBodyRows
    && coverage.totalIdeas >= 3
    && taskEcho.severity === "none"
    && taskEcho.reusedPromptPhraseCount <= 1
    && taskEcho.reusedPromptSentenceLikeCount === 0;

  return {
    isSinglePart,
    effectiveWordCount,
    severePromptReuse,
    moderatePromptReuse,
    weakSupport,
    majorUnderdevelopment,
    tr6Eligible,
    tr7Eligible,
    tr8Eligible,
    tr9Eligible
  };
}

function tr8SinglePromptRecoveryProfile(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const stance = stanceProfile(ctx);
  const para = paragraphProfile(ctx);
  const taskEcho = lengthProfile.taskEcho;
  const effectiveWordCount = lengthProfile.effectiveWordCount;
  const developedRows = developedBodyRowCount(support);
  const robustRows = support.rows.filter((row) => (
    row.hasExplanation && row.evidenceCount >= 2
  )).length;

  const eligibleBase =
    coverage.totalParts === 1 &&
    stance.isClear &&
    coverage.missingPartCount === 0 &&
    coverage.totalIdeas >= 2 &&
    effectiveWordCount >= 275 &&
    support.totalBodyRows >= 2 &&
    developedRows >= 2 &&
    support.effectiveUnderdevelopedCount <= 1 &&
    support.hardUnderdevelopedCount === 0 &&
    para.paragraphCount >= 4 &&
    para.bodyCount >= 2 &&
    para.hasConclusion &&
    taskEcho.severity === "none" &&
    taskEcho.reusedPromptSentenceLikeCount === 0 &&
    taskEcho.reusedPromptPhraseCount <= 1;

  const extendedSupport = eligibleBase && (
    developedRows >= 3 ||
    (support.totalBodyRows >= 2 && robustRows >= 2)
  );

  return {
    eligibleBase,
    extendedSupport,
    developedRows,
    robustRows
  };
}

function tr8MultiPartCeilingProfile(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const stance = stanceProfile(ctx);
  const repetition = repetitionHeuristic(ctx);

  const isMultiPart = coverage.totalParts >= 2;
  const unevenCoverage = isMultiPart && (coverage.maxIdeas - coverage.minIdeas) >= 2;
  const heavyRepetitionLoop = repetition.topCount >= 8 && repetition.ratio >= 0.028;
  const supportNotFullyRobust = support.totalBodyRows >= 2
    ? (support.strongCount < support.totalBodyRows || support.effectiveUnderdevelopedCount >= 1)
    : (support.strongCount < 2);

  return {
    isMultiPart,
    heavyRepetitionLoop,
    unevenCoverage,
    supportNotFullyRobust,
    clearPosition: stance.isClear,
    effectiveWordCount: lengthProfile.effectiveWordCount,
    shouldBlockBand8:
      isMultiPart &&
      (
        heavyRepetitionLoop ||
        unevenCoverage ||
        supportNotFullyRobust ||
        !stance.isClear ||
        lengthProfile.effectiveWordCount < 275
      )
  };
}

function hasStrongDiscourseCounterSignals(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const stance = stanceProfile(ctx);
  const effectiveWordCount = lengthProfile.effectiveWordCount;

  if (effectiveWordCount < 230) return false;
  if (!stance.hasPosition || stance.isInconsistent) return false;
  if (!coverage.totalParts || coverage.missingPartCount > 0) return false;
  if (coverage.thinPartCount > Math.max(1, Math.floor(coverage.totalParts / 2))) return false;
  if (support.totalBodyRows < 1) return false;
  if (support.strongCount < 1) return false;
  if (support.effectiveUnderdevelopedCount > Math.max(1, support.totalBodyRows - 1)) return false;
  return true;
}

function highContentLanguageBoundaryRescueEligible(ctx) {
  if (hasStrongDiscourseCounterSignals(ctx)) return true;

  const rescue = languageCalibrationRescueProfile(ctx);
  if (!rescue.conservativeRescueEligible) return false;

  const coverage = taskCoverageProfile(ctx);
  const stance = stanceProfile(ctx);
  if (stance.isInconsistent) return false;
  if (coverage.totalParts > 1 && !stance.hasPosition) return false;
  return true;
}

function singlePartHighContentBoundaryRescueProfile(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const stance = stanceProfile(ctx);

  const singlePartTask = coverage.totalParts === 1;
  const robustSinglePartCoverage = coverage.totalIdeas >= 8;
  const strongSinglePartSupport =
    support.totalBodyRows >= 1 &&
    support.strongCount >= 1 &&
    support.effectiveUnderdevelopedCount === 0;
  const sufficientLength = lengthProfile.effectiveWordCount >= 230;
  const stablePosition = stance.isClear || (singlePartTask && !stance.isInconsistent);

  return {
    singlePartTask,
    robustSinglePartCoverage,
    strongSinglePartSupport,
    sufficientLength,
    stablePosition,
    eligible:
      singlePartTask &&
      robustSinglePartCoverage &&
      strongSinglePartSupport &&
      sufficientLength &&
      stablePosition
  };
}

function tr6SinglePartBoundaryRescueProfile(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const taskEcho = lengthProfile.taskEcho;

  const eligible =
    coverage.totalParts === 1 &&
    coverage.missingPartCount === 0 &&
    coverage.totalIdeas >= 4 &&
    support.totalBodyRows >= 2 &&
    support.strongCount >= 1 &&
    support.effectiveUnderdevelopedCount <= 1 &&
    support.severelyThinCount === 0 &&
    lengthProfile.effectiveWordCount >= 235 &&
    taskEcho.severity !== "severe";

  return {
    coverage,
    support,
    lengthProfile,
    taskEcho,
    eligible
  };
}

function tr6SinglePartHighContentClosureRescueProfile(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const taskEcho = lengthProfile.taskEcho;
  const repetition = repetitionHeuristic(ctx);
  const para = paragraphProfile(ctx);
  const structure = ctx?.step2?.structure || {};
  const rows = Array.isArray(support?.rows) ? support.rows : [];
  const hasConclusionSignal = Object.prototype.hasOwnProperty.call(structure, 'conclusionSignpostFoundInLast');
  const conclusionSignpostFoundInLast = Boolean(structure?.conclusionSignpostFoundInLast);
  const misplacedConclusionSignpost = Boolean(structure?.misplacedConclusionSignpost);
  const explanationDenseRows = rows.filter((row) => (
    Boolean(row?.hasExplanation) && toFiniteNumber(row?.evidenceCount, 0) >= 2
  )).length;
  const severeWeakRows = rows.filter((row) => (
    !Boolean(row?.hasExplanation) && !Boolean(row?.hasExample) && toFiniteNumber(row?.evidenceCount, 0) === 0
  )).length;
  const strongSupportOrExplanationDense =
    (
      support.strongCount >= 1 &&
      support.effectiveUnderdevelopedCount <= 1
    ) || (
      explanationDenseRows >= 2 &&
      severeWeakRows === 0
    );

  const paragraphCounts = Array.isArray(para?.counts) ? para.counts : [];
  const totalParagraphs = paragraphCounts.length;
  const finalParagraphSentenceCount = totalParagraphs > 0
    ? toFiniteNumber(paragraphCounts[totalParagraphs - 1], 0)
    : 0;

  const eligible =
    coverage.totalParts === 1 &&
    coverage.missingPartCount === 0 &&
    coverage.totalIdeas >= 5 &&
    support.totalBodyRows >= 2 &&
    strongSupportOrExplanationDense &&
    support.severelyThinCount === 0 &&
    lengthProfile.effectiveWordCount >= 255 &&
    para.hasConclusion &&
    hasConclusionSignal &&
    conclusionSignpostFoundInLast &&
    !misplacedConclusionSignpost &&
    finalParagraphSentenceCount >= 2 &&
    taskEcho.severity === "none" &&
    repetition.topCount <= 10 &&
    repetition.ratio < 0.04;

  return {
    coverage,
    support,
    lengthProfile,
    taskEcho,
    repetition,
    para,
    explanationDenseRows,
    severeWeakRows,
    strongSupportOrExplanationDense,
    finalParagraphSentenceCount,
    hasConclusionSignal,
    conclusionSignpostFoundInLast,
    misplacedConclusionSignpost,
    eligible
  };
}

function tr6SinglePartNoStanceDirectRescueProfile(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const stance = stanceProfile(ctx);
  const para = paragraphProfile(ctx);
  const repetition = repetitionHeuristic(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const taskEcho = lengthProfile.taskEcho;
  const structure = ctx?.step2?.structure || {};
  const hasConclusionSignal = Object.prototype.hasOwnProperty.call(structure, 'conclusionSignpostFoundInLast');
  const conclusionSignpostFoundInLast = Boolean(structure?.conclusionSignpostFoundInLast);
  const misplacedConclusionSignpost = Boolean(structure?.misplacedConclusionSignpost);

  const paragraphCounts = Array.isArray(para?.counts) ? para.counts : [];
  const totalParagraphs = paragraphCounts.length;
  const finalParagraphSentenceCount = totalParagraphs > 0
    ? toFiniteNumber(paragraphCounts[totalParagraphs - 1], 0)
    : 0;

  const bodySupportRows = Array.isArray(ctx?.step25?.bodySupport) ? ctx.step25.bodySupport : [];
  const explanationEvidenceRows = bodySupportRows.filter((row) => (
    Boolean(row?.hasExplanation) &&
    Array.isArray(row?.evidenceSentenceIndices) &&
    row.evidenceSentenceIndices.length >= 2
  )).length;
  const severeThinRows = bodySupportRows.filter((row) => (
    !Boolean(row?.hasExplanation) &&
    !Boolean(row?.hasExample) &&
    (!Array.isArray(row?.evidenceSentenceIndices) || row.evidenceSentenceIndices.length === 0)
  )).length;

  const noExplicitStance = !stance.hasStanceSentence || !stance.isExplicitStance;
  const eligible =
    coverage.totalParts === 1 &&
    coverage.missingPartCount === 0 &&
    coverage.totalIdeas >= 5 &&
    noExplicitStance &&
    bodySupportRows.length >= 2 &&
    explanationEvidenceRows >= 2 &&
    severeThinRows === 0 &&
    lengthProfile.effectiveWordCount >= 250 &&
    para.hasConclusion &&
    hasConclusionSignal &&
    conclusionSignpostFoundInLast &&
    !misplacedConclusionSignpost &&
    finalParagraphSentenceCount >= 2 &&
    taskEcho.severity === 'none' &&
    repetition.topCount <= 10 &&
    repetition.ratio < 0.04;

  return {
    coverage,
    stance,
    bodySupportRows,
    explanationEvidenceRows,
    severeThinRows,
    lengthProfile,
    repetition,
    para,
    hasConclusionSignal,
    conclusionSignpostFoundInLast,
    misplacedConclusionSignpost,
    finalParagraphSentenceCount,
    eligible
  };
}

function tr6SinglePartNoStanceSupportRescueProfile(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const stance = stanceProfile(ctx);
  const para = paragraphProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const taskEcho = lengthProfile.taskEcho;
  const repetition = repetitionHeuristic(ctx);
  const structure = ctx?.step2?.structure || {};

  const hasConclusionSignal = Boolean(structure?.conclusionSignpostFoundInLast);
  const misplacedConclusionSignpost = Boolean(structure?.misplacedConclusionSignpost);
  const paragraphCounts = Array.isArray(para?.counts) ? para.counts : [];
  const finalParagraphSentenceCount = paragraphCounts.length > 0
    ? toFiniteNumber(paragraphCounts[paragraphCounts.length - 1], 0)
    : 0;

  const noExplicitStance = !stance.hasStanceSentence || !stance.isExplicitStance;
  const rows = Array.isArray(support?.rows) ? support.rows : [];
  const explanationLedRows = rows.filter((row) => (
    Boolean(row?.hasExplanation) &&
    (toFiniteNumber(row?.evidenceCount, 0) >= 1 || Boolean(row?.hasExample))
  )).length;
  const severeThinRows = rows.filter((row) => Boolean(row?.severelyThin)).length;

  const eligible =
    coverage.totalParts === 1 &&
    coverage.missingPartCount === 0 &&
    coverage.totalIdeas >= 5 &&
    noExplicitStance &&
    support.totalBodyRows >= 2 &&
    explanationLedRows >= 2 &&
    severeThinRows === 0 &&
    support.effectiveUnderdevelopedCount <= 1 &&
    lengthProfile.effectiveWordCount >= 250 &&
    para.hasConclusion &&
    hasConclusionSignal &&
    !misplacedConclusionSignpost &&
    finalParagraphSentenceCount >= 2 &&
    taskEcho.severity === 'none' &&
    repetition.topCount <= 10 &&
    repetition.ratio < 0.04;

  return {
    coverage,
    support,
    stance,
    para,
    lengthProfile,
    repetition,
    explanationLedRows,
    severeThinRows,
    finalParagraphSentenceCount,
    hasConclusionSignal,
    misplacedConclusionSignpost,
    noExplicitStance,
    eligible
  };
}

function tr6SinglePartNoStanceClosureLiftEligible(ctx) {
  const answers = (ctx?.step25?.answersBySubquestion && typeof ctx.step25.answersBySubquestion === 'object')
    ? ctx.step25.answersBySubquestion
    : {};
  const coverageKeys = Object.keys(answers);
  const totalParts = coverageKeys.length;
  const missingPartCount = coverageKeys.filter((key) => !Array.isArray(answers[key]) || answers[key].length === 0).length;
  const totalIdeas = coverageKeys.reduce((sum, key) => {
    const arr = Array.isArray(answers[key]) ? answers[key] : [];
    return sum + arr.length;
  }, 0);

  const position = ctx?.step25?.position || {};
  const stance = String(position?.stance || '').trim().toLowerCase();
  const stanceSentenceIndex = position?.stanceSentenceIndex;
  const hasStanceSentence = Number.isInteger(stanceSentenceIndex);
  const isExplicitStance = ['agree', 'disagree', 'partial', 'mixed'].includes(stance);
  const noExplicitStance = !hasStanceSentence || !isExplicitStance;

  const structure = ctx?.step2?.structure || {};
  const paragraphRoles = Array.isArray(structure?.paragraphRoles) ? structure.paragraphRoles : [];
  const paragraphSentenceCounts = Array.isArray(structure?.paragraphSentenceCounts) ? structure.paragraphSentenceCounts : [];
  const finalParagraphSentenceCount = paragraphSentenceCounts.length
    ? toFiniteNumber(paragraphSentenceCounts[paragraphSentenceCounts.length - 1], 0)
    : 0;
  const hasConclusion = Boolean(structure?.hasConclusion) || paragraphRoles.includes('conclusion');
  const validConclusionSignal = Boolean(structure?.conclusionSignpostFoundInLast) && !Boolean(structure?.misplacedConclusionSignpost);

  const lengthProfile = taskResponseLengthProfile(ctx);
  const taskEcho = lengthProfile.taskEcho;
  const repetition = repetitionHeuristic(ctx);

  return (
    totalParts === 1 &&
    missingPartCount === 0 &&
    totalIdeas >= 5 &&
    noExplicitStance &&
    lengthProfile.effectiveWordCount >= 250 &&
    hasConclusion &&
    validConclusionSignal &&
    finalParagraphSentenceCount >= 2 &&
    taskEcho.severity === 'none' &&
    repetition.topCount <= 10 &&
    repetition.ratio < 0.04
  );
}

function tr6SinglePartLanguageBackedNoStanceRescueProfile(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const stance = stanceProfile(ctx);
  const para = paragraphProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const repetition = repetitionHeuristic(ctx);
  const lexicalControl = lexicalControlProfile(ctx);
  const grammarControl = grammarControlProfile(ctx);
  const structure = ctx?.step2?.structure || {};

  const hasConclusionSignal = Object.prototype.hasOwnProperty.call(structure, 'conclusionSignpostFoundInLast');
  const conclusionSignpostFoundInLast = Boolean(structure?.conclusionSignpostFoundInLast);
  const misplacedConclusionSignpost = Boolean(structure?.misplacedConclusionSignpost);
  const paragraphCounts = Array.isArray(para?.counts) ? para.counts : [];
  const finalParagraphSentenceCount = paragraphCounts.length > 0
    ? toFiniteNumber(paragraphCounts[paragraphCounts.length - 1], 0)
    : 0;

  const noExplicitStance = !stance.hasStanceSentence || !stance.isExplicitStance;
  const languageStrongEnough = Boolean(lexicalControl && grammarControl)
    && lexicalShowsControlledBand7Profile(lexicalControl)
    && grammarClarityStable(grammarControl)
    && ['varied', 'wide'].includes(grammarControl.structureRange)
    && grammarControl.complexSentenceControl === 'good'
    && ['rare', 'occasional'].includes(grammarControl.errorFrequency)
    && ['moderate', 'high'].includes(grammarControl.errorFreeSentenceShareBand)
    && grammarMixedOrWeakControlCount(grammarControl) <= 3;
  const discourseStableEnough =
    coverage.totalParts === 1 &&
    coverage.missingPartCount === 0 &&
    coverage.totalIdeas >= 4 &&
    lengthProfile.effectiveWordCount >= 280 &&
    lengthProfile.taskEcho.severity === 'none' &&
    repetition.topCount <= 10 &&
    repetition.ratio < 0.04;
  const structureStableEnough =
    para.hasConclusion &&
    para.paragraphCount >= 4 &&
    para.bodyCount >= 2 &&
    !misplacedConclusionSignpost &&
    (
      !hasConclusionSignal ||
      conclusionSignpostFoundInLast ||
      finalParagraphSentenceCount >= 2
    );
  const supportNotCollapsed =
    support.totalBodyRows >= 1 &&
    support.effectiveUnderdevelopedCount <= 1 &&
    support.severelyThinCount === 0;

  return {
    noExplicitStance,
    languageStrongEnough,
    discourseStableEnough,
    structureStableEnough,
    supportNotCollapsed,
    eligible:
      noExplicitStance &&
      languageStrongEnough &&
      discourseStableEnough &&
      structureStableEnough &&
      supportNotCollapsed
  };
}

function lexicalBoundaryDeescalationEligible(ctx, lexicalControl) {
  if (!lexicalControl) return false;
  if (!hasStrongDiscourseCounterSignals(ctx)) return false;

  if (
    lexicalControl.clarityImpactFromLexis === 'major' ||
    lexicalControl.spellingImpact === 'frequent' ||
    lexicalControl.wordFormationImpact === 'frequent' ||
    lexicalControl.repetitionImpact === 'strong' ||
    lexicalControl.awkwardExpressionCountBand === 'many'
  ) {
    return false;
  }

  const severeCoreWeakness =
    lexicalControl.rangeBand === 'limited' &&
    lexicalControl.precisionBand === 'low' &&
    lexicalControl.collocationControl === 'weak';
  if (severeCoreWeakness) return false;

  const positiveAnchors = [
    lexicalRangeAtLeast(lexicalControl, 'adequate'),
    lexicalPrecisionAtLeast(lexicalControl, 'mixed'),
    lexicalControl.collocationControl === 'mixed' || lexicalControl.collocationControl === 'good',
    lexicalClarityPreserved(lexicalControl),
    lexicalControl.awkwardExpressionCountBand === 'none' || lexicalControl.awkwardExpressionCountBand === 'few',
    lexicalControl.repetitionImpact === 'none' || lexicalControl.repetitionImpact === 'mild'
  ].filter(Boolean).length;

  const stabilitySignals = [
    lexicalControl.spellingImpact === 'none' || lexicalControl.spellingImpact === 'minor',
    lexicalControl.wordFormationImpact === 'none' || lexicalControl.wordFormationImpact === 'minor',
    lexicalControl.clarityImpactFromLexis === 'none' || lexicalControl.clarityImpactFromLexis === 'minor'
  ].filter(Boolean).length;

  return positiveAnchors >= 3 && stabilitySignals >= 2;
}

function grammarBoundaryDeescalationEligible(ctx, grammarControl) {
  if (!grammarControl) return false;
  if (!hasStrongDiscourseCounterSignals(ctx)) return false;

  if (grammarControl.clarityImpactFromGrammar === 'major') return false;
  if (grammarControl.errorFreeSentenceShareBand === 'very_low') return false;
  if (grammarControl.structureRange === 'simple_only' && grammarControl.complexSentenceControl === 'weak') return false;

  const weakCount = grammarWeakControlCount(grammarControl);
  const mixedOrWeakCount = grammarMixedOrWeakControlCount(grammarControl);
  const stableClarity = grammarControl.clarityImpactFromGrammar === 'none' || grammarControl.clarityImpactFromGrammar === 'minor';

  if (grammarControl.errorFrequency === 'frequent') {
    return stableClarity
      && weakCount <= 1
      && mixedOrWeakCount <= 2
      && (grammarControl.errorFreeSentenceShareBand === 'moderate' || grammarControl.errorFreeSentenceShareBand === 'high');
  }

  if (grammarControl.errorFrequency === 'noticeable') {
    return stableClarity
      && weakCount <= 2
      && mixedOrWeakCount <= 3
      && grammarControl.errorFreeSentenceShareBand !== 'low';
  }

  if (grammarControl.errorFrequency === 'occasional') {
    return stableClarity && weakCount <= 2 && mixedOrWeakCount <= 3;
  }

  return grammarControl.errorFrequency === 'rare';
}

function lexicalSeverityBoundaryUncertain(lexicalControl) {
  if (!lexicalControl) return false;

  const catastrophic =
    lexicalControl.clarityImpactFromLexis === 'major' ||
    lexicalControl.spellingImpact === 'frequent' ||
    lexicalControl.wordFormationImpact === 'frequent' ||
    lexicalControl.repetitionImpact === 'strong';
  if (catastrophic) return false;

  const structuralWeakness =
    lexicalControl.rangeBand === 'limited' ||
    lexicalControl.precisionBand === 'low' ||
    lexicalControl.collocationControl === 'weak' ||
    lexicalControl.clarityImpactFromLexis === 'some';
  if (!structuralWeakness) return false;

  const boundarySignals = [
    lexicalControl.rangeBand === 'limited',
    lexicalControl.precisionBand === 'low',
    lexicalControl.collocationControl === 'weak',
    lexicalControl.clarityImpactFromLexis === 'some',
    lexicalControl.spellingImpact === 'some',
    lexicalControl.wordFormationImpact === 'some',
    lexicalControl.awkwardExpressionCountBand === 'some' || lexicalControl.awkwardExpressionCountBand === 'many',
    lexicalControl.repetitionImpact === 'noticeable'
  ].filter(Boolean).length;

  return boundarySignals >= 3 && boundarySignals <= 8;
}

function grammarSeverityBoundaryUncertain(grammarControl) {
  if (!grammarControl) return false;

  const weakCount = grammarWeakControlCount(grammarControl);
  const mixedOrWeakCount = grammarMixedOrWeakControlCount(grammarControl);
  const veryLowAccuracy = grammarControl.errorFreeSentenceShareBand === 'very_low';

  if (grammarControl.clarityImpactFromGrammar === 'major') return false;
  if (veryLowAccuracy) return false;
  if (
    grammarControl.errorFrequency === 'frequent' &&
    weakCount >= 4 &&
    grammarControl.clarityImpactFromGrammar === 'some'
  ) {
    return true;
  }

  if (grammarControl.errorFrequency === 'noticeable') return true;
  if (
    grammarControl.errorFrequency === 'frequent' &&
    grammarControl.clarityImpactFromGrammar !== 'major' &&
    weakCount <= 3
  ) {
    return true;
  }
  if (
    grammarControl.errorFrequency === 'occasional' &&
    grammarControl.clarityImpactFromGrammar === 'some' &&
    mixedOrWeakCount >= 3
  ) {
    return true;
  }

  return false;
}

function graBand5SentenceWeakBoundaryRecoveryEligible(ctx, grammarControl) {
  if (!grammarControl) return false;
  if (!highContentLanguageBoundaryRescueEligible(ctx)) return false;

  const support = bodySupportProfile(ctx);
  const coverage = taskCoverageProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const developedRows = developedBodyRowCount(support);

  const discourseStable =
    support.totalBodyRows >= 2 &&
    developedRows >= 2 &&
    support.effectiveUnderdevelopedCount <= 1 &&
    coverage.totalIdeas >= Math.max(3, coverage.totalParts + 1) &&
    lengthProfile.effectiveWordCount >= 275;

  return discourseStable &&
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
}

function paragraphTopicCoverageProfile(ctx) {
  const roles = Array.isArray(ctx?.step2?.structure?.paragraphRoles) ? ctx.step2.structure.paragraphRoles : [];
  const topicRows = Array.isArray(ctx?.step25?.topicSentenceByParagraph) ? ctx.step25.topicSentenceByParagraph : [];

  const bodyParagraphIndices = roles
    .map((role, index) => (role === 'body' ? index : null))
    .filter((index) => Number.isInteger(index));
  const bodyParagraphCount = bodyParagraphIndices.length;
  const bodyTopicCount = bodyParagraphIndices.reduce((sum, paragraphIndex) => {
    const row = topicRows.find((entry) => Number(entry?.paragraphIndex) === paragraphIndex);
    return sum + (Number.isInteger(row?.topicSentenceIndex) ? 1 : 0);
  }, 0);
  const bodyTopicCoverageRatio = bodyParagraphCount > 0 ? (bodyTopicCount / bodyParagraphCount) : 0;

  return {
    bodyParagraphCount,
    bodyTopicCount,
    bodyTopicCoverageRatio
  };
}

function cohesionQualityProfile(ctx) {
  const cohesion = ctx?.step2?.cohesion || {};
  const lexical = ctx?.step2?.lexical || {};
  const para = paragraphProfile(ctx);
  const repetition = repetitionHeuristic(ctx);
  const topicCoverage = paragraphTopicCoverageProfile(ctx);
  const perParagraphFeatures = Array.isArray(ctx?.step2?.perParagraphFeatures)
    ? ctx.step2.perParagraphFeatures
    : [];

  const densityExBasic = toFiniteNumber(cohesion?.densityPer100ExcludingBasic || cohesion?.densityPer100, 0);
  const distinctExBasic = toFiniteNumber(cohesion?.distinctConnectorsExcludingBasic || cohesion?.distinctConnectors, 0);
  const usageMap = (cohesion?.usageMapExcludingBasic && typeof cohesion.usageMapExcludingBasic === 'object')
    ? cohesion.usageMapExcludingBasic
    : (cohesion?.usageMap && typeof cohesion.usageMap === 'object' ? cohesion.usageMap : {});
  const maxConnectorRepeat = Object.values(usageMap || {}).reduce((max, raw) => {
    const count = toFiniteNumber(raw, 0);
    return count > max ? count : max;
  }, 0);
  const referencingDensity = toFiniteNumber(lexical?.referencingDensity, 0);
  const runOnRecoveredBodyCount = perParagraphFeatures.filter((row) => (
    String(row?.role || "").toLowerCase() === "body" &&
    toFiniteNumber(row?.virtualSentenceCount, 0) >= 1 &&
    toFiniteNumber(row?.sentenceCount, 0) >= 2
  )).length;
  const longSingleBodyCount = perParagraphFeatures.filter((row) => (
    String(row?.role || "").toLowerCase() === "body" &&
    toFiniteNumber(row?.sentenceCount, 0) <= 1 &&
    toFiniteNumber(row?.paragraphWordCount, 0) >= 55
  )).length;

  const sectionedSkeleton = para.paragraphCount >= 4 && para.hasIntro && para.hasConclusion && para.bodyCount >= 2;
  const runOnStructureLikely = runOnRecoveredBodyCount >= 1 || longSingleBodyCount >= 1;
  const weakParagraphLogic = para.bodyCount < 2
    || !para.hasConclusion
    || (para.minSent <= 1 && !(sectionedSkeleton && runOnStructureLikely));
  const weakTopicCoverage = topicCoverage.bodyParagraphCount >= 2 && topicCoverage.bodyTopicCoverageRatio < 0.5;
  const heavyRepetition = repetition.topCount >= 8 && repetition.ratio >= 0.028;
  const weakReferencing = referencingDensity < 1.2 && repetition.topCount >= 6;
  const mechanicalCohesion = densityExBasic >= 3.4 && distinctExBasic <= 3 && maxConnectorRepeat >= 4;
  const lowCohesionGuidance = densityExBasic < 1.1 && distinctExBasic < 2;
  const strongStructure = sectionedSkeleton && para.minSent >= 2;
  const strongProgression = strongStructure && topicCoverage.bodyTopicCoverageRatio >= 0.67;
  const balancedCohesion = densityExBasic >= 1.2
    && distinctExBasic >= 3
    && maxConnectorRepeat <= 3
    && referencingDensity >= 1.4
    && !heavyRepetition
    && !mechanicalCohesion;

  return {
    densityExBasic,
    distinctExBasic,
    maxConnectorRepeat,
    referencingDensity,
    repetition,
    weakParagraphLogic,
    weakTopicCoverage,
    heavyRepetition,
    weakReferencing,
    mechanicalCohesion,
    lowCohesionGuidance,
    sectionedSkeleton,
    runOnRecoveredBodyCount,
    longSingleBodyCount,
    runOnStructureLikely,
    runOnSectionedSkeleton: sectionedSkeleton && para.minSent <= 1,
    strongProgression,
    balancedCohesion
  };
}

function collapsedParagraphSegmentationLikely(ctx) {
  const para = paragraphProfile(ctx);
  if (para.paragraphCount > 2) return false;

  const lengthProfile = taskResponseLengthProfile(ctx);
  const support = bodySupportProfile(ctx);
  const topicCoverage = paragraphTopicCoverageProfile(ctx);
  const cohesion = cohesionQualityProfile(ctx);
  const stance = stanceProfile(ctx);

  const totalSentences = para.counts.reduce((sum, count) => sum + toFiniteNumber(count, 0), 0);
  const substantialSingleBlock = para.paragraphCount === 1
    && (
      lengthProfile.effectiveWordCount >= 220
      || totalSentences >= 10
      || para.virtualRecoveryApplied
    );
  const substantialTwoBlock = para.paragraphCount === 2
    && (
      lengthProfile.effectiveWordCount >= 220
      || totalSentences >= 10
      || (toFiniteNumber(para.counts[0], 0) >= 4 && toFiniteNumber(para.counts[1], 0) >= 4)
    );
  if (!substantialSingleBlock && !substantialTwoBlock) return false;

  const developedSupport = support.totalBodyRows >= 1
    && support.strongCount >= 1
    && support.effectiveUnderdevelopedCount <= Math.max(1, support.totalBodyRows - 1);
  const topicOrPositionPresent = topicCoverage.bodyTopicCount >= 1 || stance.hasPosition;
  const cohesionNotCollapsed = cohesion.strongProgression
    || cohesion.balancedCohesion
    || (
      cohesion.densityExBasic >= 1.3
      && cohesion.distinctExBasic >= 3
      && !cohesion.lowCohesionGuidance
      && !cohesion.weakReferencing
    );

  return developedSupport && topicOrPositionPresent && cohesionNotCollapsed;
}

function ccMidBandBlockerProfile(ctx) {
  const cohesion = cohesionQualityProfile(ctx);
  const para = paragraphProfile(ctx);
  const structure = (ctx?.step2?.structure && typeof ctx.step2.structure === "object")
    ? ctx.step2.structure
    : {};

  const weakProgressionContext = cohesion.weakParagraphLogic || cohesion.weakTopicCoverage;
  const weakConclusionSignal =
    Boolean(structure?.misplacedConclusionSignpost) ||
    (
      para.hasConclusion &&
      para.minSent > 0 &&
      para.minSent <= 1 &&
      !Boolean(structure?.conclusionSignpostFoundInLast)
    );
  const highRepetitionPattern = cohesion.repetition.topCount >= 7 && cohesion.repetition.ratio >= 0.028;
  const overloadedCohesionPattern =
    cohesion.densityExBasic >= 3.4 &&
    cohesion.distinctExBasic >= 5 &&
    cohesion.maxConnectorRepeat <= 3;
  const highReferencingWithRepetition =
    cohesion.referencingDensity >= 5.0 &&
    cohesion.repetition.topCount >= 6;

  const cc56Blocker = weakProgressionContext && weakConclusionSignal && highRepetitionPattern;
  const cc6Blocker = weakProgressionContext && (
    (weakConclusionSignal && highRepetitionPattern) ||
    (highReferencingWithRepetition && overloadedCohesionPattern)
  );

  return {
    cc56Blocker,
    cc6Blocker,
    weakProgressionContext,
    weakConclusionSignal,
    highRepetitionPattern,
    overloadedCohesionPattern,
    highReferencingWithRepetition
  };
}

function ccHigherBandSupportRecoveryProfile(ctx) {
  const para = paragraphProfile(ctx);
  const cohesion = cohesionQualityProfile(ctx);
  const support = bodySupportProfile(ctx);
  const topicCoverage = paragraphTopicCoverageProfile(ctx);
  const structure = (ctx?.step2?.structure && typeof ctx.step2.structure === "object")
    ? ctx.step2.structure
    : {};
  const roles = Array.isArray(structure?.paragraphRoles) ? structure.paragraphRoles : [];
  const sentenceCounts = Array.isArray(para.counts) ? para.counts : [];
  const thinParagraphIndices = sentenceCounts
    .map((count, index) => (toFiniteNumber(count, 0) <= 1 ? index : null))
    .filter((index) => Number.isInteger(index));
  const oneThinConclusionOnly = thinParagraphIndices.length === 1
    && String(roles[thinParagraphIndices[0]] || "").toLowerCase() === "conclusion";

  const hasSectionSkeleton = para.paragraphCount >= 4 && para.hasIntro && para.hasConclusion && para.bodyCount >= 2;
  const strongBodySupport = support.totalBodyRows >= 2
    && support.strongCount >= 2
    && support.effectiveUnderdevelopedCount === 0;
  const strongCohesionBase = !cohesion.heavyRepetition
    && !cohesion.mechanicalCohesion
    && !cohesion.lowCohesionGuidance
    && cohesion.distinctExBasic >= 4
    && cohesion.maxConnectorRepeat <= 4;

  const strongBodyRecovery = hasSectionSkeleton && strongBodySupport && strongCohesionBase;
  const oneThinConclusionRecoverable = strongBodyRecovery
    && oneThinConclusionOnly
    && !Boolean(structure?.misplacedConclusionSignpost)
    && (Boolean(structure?.conclusionSignpostFoundInLast) || toFiniteNumber(sentenceCounts[sentenceCounts.length - 1], 0) <= 1);
  const topicCoverageLikelyUnderDetected = strongBodyRecovery
    && topicCoverage.bodyParagraphCount >= 2
    && topicCoverage.bodyTopicCoverageRatio < 0.5;

  return {
    strongBodyRecovery,
    oneThinConclusionRecoverable,
    topicCoverageLikelyUnderDetected
  };
}

function ccThinConclusionRecoveryProfile(ctx) {
  const para = paragraphProfile(ctx);
  const support = bodySupportProfile(ctx);
  const topicCoverage = paragraphTopicCoverageProfile(ctx);
  const cohesion = cohesionQualityProfile(ctx);
  const structure = (ctx?.step2?.structure && typeof ctx.step2.structure === "object")
    ? ctx.step2.structure
    : {};

  const thinConclusionOnly =
    para.paragraphCount >= 4 &&
    para.hasConclusion &&
    para.bodyCount >= 2 &&
    para.minSent <= 1 &&
    !Boolean(structure?.misplacedConclusionSignpost);
  const developedBodyRows = developedBodyRowCount(support);
  const strongBodySupport =
    support.totalBodyRows >= 2 &&
    developedBodyRows >= 2 &&
    support.effectiveUnderdevelopedCount <= 1;
  const strongTopicCoverage =
    topicCoverage.bodyParagraphCount >= 2 &&
    topicCoverage.bodyTopicCoverageRatio >= 0.67;
  const lowConnectorButRecovered =
    cohesion.lowCohesionGuidance &&
    cohesion.distinctExBasic <= 1 &&
    cohesion.referencingDensity >= 4.0 &&
    !cohesion.weakReferencing;

  return {
    thinConclusionOnly,
    strongBodySupport,
    strongTopicCoverage,
    lowConnectorButRecovered,
    eligible: thinConclusionOnly && strongBodySupport && strongTopicCoverage && lowConnectorButRecovered
  };
}

function ccMidBandThinConclusionRecoveryProfile(ctx) {
  const para = paragraphProfile(ctx);
  const support = bodySupportProfile(ctx);
  const cohesion = cohesionQualityProfile(ctx);
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
  const developedRows = developedBodyRowCount(support);
  const sustainedSupport = support.totalBodyRows >= 2 &&
    developedRows >= 2 &&
    support.effectiveUnderdevelopedCount <= 1;
  const topicCoverageStrong = topicCoverage.bodyParagraphCount >= 2 &&
    topicCoverage.bodyTopicCoverageRatio >= 0.67;
  const connectorVariancePresent = cohesion.distinctExBasic >= 4;
  const notMechanicallyOverloaded = !cohesion.mechanicalCohesion && !cohesion.heavyRepetition;
  const highReferenceCohesion = cohesion.referencingDensity >= 3.5 && !cohesion.weakReferencing;

  return {
    oneThinConclusionOnly,
    developedRows,
    sustainedSupport,
    topicCoverageStrong,
    connectorVariancePresent,
    notMechanicallyOverloaded,
    highReferenceCohesion,
    eligible:
      oneThinConclusionOnly &&
      para.paragraphCount >= 4 &&
      para.hasIntro &&
      para.hasConclusion &&
      para.bodyCount >= 2 &&
      sustainedSupport &&
      topicCoverageStrong &&
      connectorVariancePresent &&
      highReferenceCohesion &&
      notMechanicallyOverloaded &&
      !Boolean(structure?.misplacedConclusionSignpost)
  };
}

function ccBand6HighContentBoundaryRecoveryProfile(ctx) {
  const para = paragraphProfile(ctx);
  const support = bodySupportProfile(ctx);
  const topicCoverage = paragraphTopicCoverageProfile(ctx);
  const cohesion = cohesionQualityProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
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
  const developedRows = developedBodyRowCount(support);

  const strongStructure =
    para.paragraphCount >= 5 &&
    para.hasIntro &&
    para.hasConclusion &&
    para.bodyCount >= 3;
  const strongSupport =
    support.totalBodyRows >= 3 &&
    developedRows >= 3 &&
    support.effectiveUnderdevelopedCount <= 1;
  const strongTopicCoverage =
    topicCoverage.bodyParagraphCount >= 3 &&
    topicCoverage.bodyTopicCoverageRatio >= 0.67;
  const stableHighReferencing =
    cohesion.referencingDensity >= 4.8 &&
    !cohesion.weakReferencing &&
    !cohesion.mechanicalCohesion;
  const repetitionManaged =
    cohesion.repetition.topCount <= 11 &&
    cohesion.repetition.ratio < 0.04 &&
    cohesion.maxConnectorRepeat <= 2;
  const lowGuidanceBoundary =
    cohesion.lowCohesionGuidance &&
    cohesion.distinctExBasic <= 1 &&
    repetitionManaged;
  const connectorManagedBoundary =
    cohesion.distinctExBasic >= 3 &&
    cohesion.maxConnectorRepeat <= 2 &&
    cohesion.repetition.ratio < 0.04;
  const runOnThinBodyBoundary =
    para.minSent <= 1 &&
    !oneThinConclusionOnly &&
    support.effectiveUnderdevelopedCount === 0 &&
    repetitionManaged;
  const noHardStructureFault = !Boolean(structure?.misplacedConclusionSignpost);
  const sufficientLength = lengthProfile.effectiveWordCount >= 285;

  return {
    oneThinConclusionOnly,
    runOnThinBodyBoundary,
    lowGuidanceBoundary,
    connectorManagedBoundary,
    eligible:
      strongStructure &&
      strongSupport &&
      strongTopicCoverage &&
      stableHighReferencing &&
      repetitionManaged &&
      noHardStructureFault &&
      sufficientLength &&
      (oneThinConclusionOnly || runOnThinBodyBoundary || para.minSent >= 2) &&
      (lowGuidanceBoundary || connectorManagedBoundary)
  };
}

function ccBand7ThinConclusionBoundaryRecoveryProfile(ctx) {
  const para = paragraphProfile(ctx);
  const support = bodySupportProfile(ctx);
  const topicCoverage = paragraphTopicCoverageProfile(ctx);
  const cohesion = cohesionQualityProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
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
  const developedRows = developedBodyRowCount(support);

  return {
    oneThinConclusionOnly,
    eligible:
      para.paragraphCount >= 5 &&
      para.hasIntro &&
      para.hasConclusion &&
      para.bodyCount >= 3 &&
      oneThinConclusionOnly &&
      Boolean(structure?.conclusionSignpostFoundInLast) &&
      !Boolean(structure?.misplacedConclusionSignpost) &&
      support.totalBodyRows >= 3 &&
      developedRows >= 3 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      topicCoverage.bodyParagraphCount >= 3 &&
      topicCoverage.bodyTopicCoverageRatio >= 0.67 &&
      lengthProfile.effectiveWordCount >= 275 &&
      cohesion.referencingDensity >= 4.5 &&
      cohesion.distinctExBasic >= 4 &&
      cohesion.maxConnectorRepeat <= 4 &&
      cohesion.repetition.topCount <= 10 &&
      cohesion.repetition.ratio < 0.032 &&
      (!cohesion.weakParagraphLogic || oneThinConclusionOnly) &&
      !cohesion.weakTopicCoverage &&
      !cohesion.mechanicalCohesion &&
      !cohesion.lowCohesionGuidance &&
      !cohesion.weakReferencing
  };
}

function highBandLanguageControlStrong(ctx) {
  const lexicalControl = lexicalControlProfile(ctx);
  const grammarControl = grammarControlProfile(ctx);
  if (!lexicalControl || !grammarControl) return false;

  const lexicalStrong =
    lexicalControl.rangeBand === "wide" &&
    (lexicalControl.precisionBand === "good" || lexicalControl.precisionBand === "high") &&
    lexicalControl.collocationControl === "good" &&
    (lexicalControl.clarityImpactFromLexis === "none" || lexicalControl.clarityImpactFromLexis === "minor") &&
    (lexicalControl.spellingImpact === "none" || lexicalControl.spellingImpact === "minor") &&
    (lexicalControl.wordFormationImpact === "none" || lexicalControl.wordFormationImpact === "minor") &&
    (lexicalControl.repetitionImpact === "none" || lexicalControl.repetitionImpact === "mild");

  const grammarStrong =
    (grammarControl.structureRange === "varied" || grammarControl.structureRange === "wide") &&
    grammarControl.complexSentenceControl === "good" &&
    (grammarControl.errorFrequency === "rare" || grammarControl.errorFrequency === "occasional") &&
    (grammarControl.clarityImpactFromGrammar === "none" || grammarControl.clarityImpactFromGrammar === "minor") &&
    (grammarControl.errorFreeSentenceShareBand === "moderate" || grammarControl.errorFreeSentenceShareBand === "high");

  return lexicalStrong && grammarStrong;
}

function tr8HighBandBoundaryRecoveryProfile(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const stance = stanceProfile(ctx);
  const para = paragraphProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const taskEcho = lengthProfile.taskEcho;
  const repetition = repetitionHeuristic(ctx);
  const developedRows = developedBodyRowCount(support);

  return {
    eligible:
      coverage.totalParts === 1 &&
      coverage.missingPartCount === 0 &&
      coverage.totalIdeas >= 2 &&
      coverage.thinPartCount === 0 &&
      stance.hasPosition &&
      !stance.isInconsistent &&
      para.paragraphCount >= 4 &&
      para.bodyCount >= 2 &&
      para.hasIntro &&
      para.hasConclusion &&
      support.totalBodyRows >= 2 &&
      developedRows >= 2 &&
      support.hardUnderdevelopedCount === 0 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      support.strongCount >= Math.max(1, support.totalBodyRows - 1) &&
      lengthProfile.effectiveWordCount >= 260 &&
      taskEcho.severity === "none" &&
      taskEcho.reusedPromptSentenceLikeCount === 0 &&
      taskEcho.reusedPromptPhraseCount <= 1 &&
      !(
        repetition.topCount >= 8 &&
        repetition.ratio >= 0.028
      ) &&
      highBandLanguageControlStrong(ctx)
  };
}

function tr8MultiPartHighContentBoundaryRecoveryProfile(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const stance = stanceProfile(ctx);
  const para = paragraphProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const taskEcho = lengthProfile.taskEcho;
  const repetition = repetitionHeuristic(ctx);
  const developedRows = developedBodyRowCount(support);
  const robustEvidenceRows = support.rows.filter((row) => (
    row.hasExplanation && row.evidenceCount >= 2
  )).length;

  const balancedCoverage = (coverage.maxIdeas - coverage.minIdeas) <= 1;
  const highContentCoverage =
    coverage.totalParts >= 2 &&
    coverage.missingPartCount === 0 &&
    coverage.thinPartCount === 0 &&
    balancedCoverage &&
    coverage.totalIdeas >= Math.max(10, coverage.totalParts * 4);
  const highContentDevelopment =
    support.totalBodyRows >= 2 &&
    developedRows >= support.totalBodyRows &&
    robustEvidenceRows >= support.totalBodyRows &&
    support.hardUnderdevelopedCount === 0 &&
    support.effectiveUnderdevelopedCount === 0 &&
    support.strongCount >= Math.max(1, support.totalBodyRows - 1);
  const structureStable =
    para.paragraphCount >= 4 &&
    para.bodyCount >= 2 &&
    para.hasIntro &&
    para.hasConclusion;
  const promptClean =
    taskEcho.severity === "none" &&
    taskEcho.reusedPromptSentenceLikeCount === 0 &&
    taskEcho.reusedPromptPhraseCount <= 1;
  const discourseClean = !(
    repetition.topCount >= 13 &&
    repetition.ratio >= 0.04
  );
  const stanceRecoverable =
    !stance.isInconsistent &&
    (
      stance.hasPosition ||
      coverage.totalIdeas >= Math.max(12, coverage.totalParts * 5)
    );

  return {
    eligible:
      highContentCoverage &&
      highContentDevelopment &&
      structureStable &&
      promptClean &&
      discourseClean &&
      lengthProfile.effectiveWordCount >= 285 &&
      stanceRecoverable &&
      highBandLanguageControlStrong(ctx)
  };
}

function tr4CompactSinglePartBoundaryReliefProfile(ctx) {
  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const para = paragraphProfile(ctx);
  const stance = stanceProfile(ctx);

  const eligible =
    coverage.totalParts === 1 &&
    coverage.missingPartCount === 0 &&
    coverage.totalIdeas >= 2 &&
    lengthProfile.effectiveWordCount >= 180 &&
    lengthProfile.taskEcho.severity !== 'severe' &&
    para.paragraphCount >= 4 &&
    para.bodyCount >= 2 &&
    support.totalBodyRows >= 2 &&
    support.severelyThinCount === 0 &&
    support.effectiveUnderdevelopedCount <= 1 &&
    stance.hasPosition &&
    !stance.isInconsistent;

  return {
    coverage,
    support,
    lengthProfile,
    para,
    stance,
    eligible
  };
}

function graBand3CompactBoundaryRecoveryProfile(ctx, grammarControl) {
  if (!grammarControl) {
    return { eligible: false };
  }
  const weakCount = grammarWeakControlCount(grammarControl);
  const trBoundary = tr4CompactSinglePartBoundaryReliefProfile(ctx);
  const boundaryGrammarShape =
    grammarControl.errorFrequency === 'frequent' &&
    grammarControl.errorFreeSentenceShareBand === 'very_low' &&
    grammarControl.clarityImpactFromGrammar === 'some' &&
    grammarControl.structureRange !== 'simple_only' &&
    weakCount <= 3 &&
    (grammarControl.sentenceBoundaryControl === 'weak' || grammarControl.punctuationControl === 'weak');

  return {
    eligible: trBoundary.eligible && boundaryGrammarShape,
    weakCount,
    boundaryGrammarShape,
    trBoundary
  };
}

function graBand3CompactMajorBoundaryRecoveryProfile(ctx, grammarControl) {
  if (!grammarControl) {
    return { eligible: false };
  }

  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const para = paragraphProfile(ctx);
  const stance = stanceProfile(ctx);
  const weakCount = grammarWeakControlCount(grammarControl);
  const explanationRowCount = support.rows.filter((row) => row.hasExplanation).length;

  const compactBoundaryShape =
    coverage.totalParts === 1 &&
    coverage.missingPartCount === 0 &&
    coverage.totalIdeas >= 6 &&
    para.paragraphCount === 4 &&
    para.bodyCount === 2 &&
    para.hasIntro &&
    para.hasConclusion &&
    support.totalBodyRows === 2 &&
    explanationRowCount === 2 &&
    support.severelyThinCount === 0 &&
    support.effectiveUnderdevelopedCount <= 1 &&
    lengthProfile.effectiveWordCount >= 210 &&
    lengthProfile.effectiveWordCount <= 260 &&
    lengthProfile.taskEcho.severity !== 'severe' &&
    stance.hasPosition &&
    !stance.isInconsistent;

  const compactMajorGrammarShape =
    grammarControl.errorFrequency === 'frequent' &&
    grammarControl.errorFreeSentenceShareBand === 'very_low' &&
    grammarControl.clarityImpactFromGrammar === 'major' &&
    grammarControl.structureRange === 'mixed' &&
    weakCount >= 4 &&
    grammarControl.sentenceBoundaryControl === 'weak' &&
    grammarControl.punctuationControl === 'weak';

  return {
    eligible: compactBoundaryShape && compactMajorGrammarShape,
    weakCount,
    explanationRowCount,
    compactBoundaryShape,
    compactMajorGrammarShape
  };
}

function lrBand3CompactMajorBoundaryRecoveryProfile(ctx, lexicalControl) {
  if (!lexicalControl) {
    return { eligible: false };
  }

  const coverage = taskCoverageProfile(ctx);
  const support = bodySupportProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
  const para = paragraphProfile(ctx);
  const stance = stanceProfile(ctx);
  const explanationRowCount = support.rows.filter((row) => row.hasExplanation).length;

  const compactBoundaryShape =
    coverage.totalParts === 1 &&
    coverage.missingPartCount === 0 &&
    coverage.totalIdeas >= 6 &&
    para.paragraphCount === 4 &&
    para.bodyCount === 2 &&
    para.hasIntro &&
    para.hasConclusion &&
    support.totalBodyRows === 2 &&
    explanationRowCount === 2 &&
    support.severelyThinCount === 0 &&
    support.effectiveUnderdevelopedCount <= 1 &&
    lengthProfile.effectiveWordCount >= 210 &&
    lengthProfile.effectiveWordCount <= 260 &&
    lengthProfile.taskEcho.severity !== 'severe' &&
    stance.hasPosition &&
    !stance.isInconsistent;

  const compactMajorLexicalShape =
    lexicalControl.rangeBand === 'limited' &&
    lexicalControl.precisionBand === 'low' &&
    lexicalControl.collocationControl === 'weak' &&
    lexicalControl.clarityImpactFromLexis === 'major' &&
    lexicalControl.awkwardExpressionCountBand === 'many' &&
    lexicalControl.spellingImpact === 'frequent' &&
    lexicalControl.wordFormationImpact === 'frequent' &&
    lexicalControl.repetitionImpact !== 'strong';

  return {
    eligible: compactBoundaryShape && compactMajorLexicalShape,
    explanationRowCount,
    compactBoundaryShape,
    compactMajorLexicalShape
  };
}

function ccBand7ThinConclusionHighBandRecoveryProfile(ctx) {
  const para = paragraphProfile(ctx);
  const support = bodySupportProfile(ctx);
  const topicCoverage = paragraphTopicCoverageProfile(ctx);
  const cohesion = cohesionQualityProfile(ctx);
  const lengthProfile = taskResponseLengthProfile(ctx);
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
  const developedRows = developedBodyRowCount(support);

  return {
    oneThinConclusionOnly,
    eligible:
      para.paragraphCount >= 4 &&
      para.hasIntro &&
      para.hasConclusion &&
      para.bodyCount >= 2 &&
      oneThinConclusionOnly &&
      !Boolean(structure?.misplacedConclusionSignpost) &&
      support.totalBodyRows >= 2 &&
      developedRows >= 2 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      topicCoverage.bodyParagraphCount >= 2 &&
      topicCoverage.bodyTopicCoverageRatio >= 0.67 &&
      lengthProfile.effectiveWordCount >= 255 &&
      cohesion.referencingDensity >= 4.0 &&
      cohesion.distinctExBasic >= 4 &&
      cohesion.densityExBasic >= 1.2 &&
      cohesion.maxConnectorRepeat <= 2 &&
      !cohesion.heavyRepetition &&
      !cohesion.mechanicalCohesion &&
      !cohesion.lowCohesionGuidance &&
      !cohesion.weakReferencing &&
      (!cohesion.weakParagraphLogic || oneThinConclusionOnly) &&
      !cohesion.weakTopicCoverage &&
      highBandLanguageControlStrong(ctx)
  };
}

function ccBand7SparseLinkingHighReferenceRecoveryProfile(ctx) {
  const para = paragraphProfile(ctx);
  const support = bodySupportProfile(ctx);
  const topicCoverage = paragraphTopicCoverageProfile(ctx);
  const cohesion = cohesionQualityProfile(ctx);
  const structure = (ctx?.step2?.structure && typeof ctx.step2.structure === "object")
    ? ctx.step2.structure
    : {};
  const developedRows = developedBodyRowCount(support);

  return {
    eligible:
      para.paragraphCount >= 4 &&
      para.bodyCount >= 2 &&
      para.hasIntro &&
      para.hasConclusion &&
      para.minSent >= 2 &&
      !Boolean(structure?.misplacedConclusionSignpost) &&
      support.totalBodyRows >= 2 &&
      developedRows >= 2 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      topicCoverage.bodyParagraphCount >= 2 &&
      topicCoverage.bodyTopicCoverageRatio >= 0.67 &&
      cohesion.referencingDensity >= 6.5 &&
      cohesion.distinctExBasic >= 2 &&
      cohesion.distinctExBasic <= 3 &&
      cohesion.densityExBasic >= 0.55 &&
      cohesion.densityExBasic <= 1.15 &&
      cohesion.maxConnectorRepeat <= 2 &&
      !cohesion.heavyRepetition &&
      !cohesion.mechanicalCohesion &&
      !cohesion.lowCohesionGuidance &&
      !cohesion.weakReferencing &&
      !cohesion.weakParagraphLogic &&
      !cohesion.weakTopicCoverage &&
      highBandLanguageControlStrong(ctx)
  };
}

function ccBand7HighReferenceBoundaryRecoveryProfile(ctx) {
  const para = paragraphProfile(ctx);
  const support = bodySupportProfile(ctx);
  const topicCoverage = paragraphTopicCoverageProfile(ctx);
  const cohesion = cohesionQualityProfile(ctx);
  const structure = (ctx?.step2?.structure && typeof ctx.step2.structure === "object")
    ? ctx.step2.structure
    : {};
  const developedRows = developedBodyRowCount(support);

  return {
    eligible:
      para.paragraphCount >= 4 &&
      para.bodyCount >= 2 &&
      para.hasIntro &&
      para.hasConclusion &&
      para.minSent >= 2 &&
      !Boolean(structure?.misplacedConclusionSignpost) &&
      support.totalBodyRows >= 2 &&
      developedRows >= 2 &&
      support.effectiveUnderdevelopedCount <= 1 &&
      topicCoverage.bodyParagraphCount >= 2 &&
      topicCoverage.bodyTopicCoverageRatio >= 0.67 &&
      cohesion.referencingDensity >= 6.0 &&
      cohesion.distinctExBasic >= 4 &&
      cohesion.distinctExBasic <= 6 &&
      cohesion.densityExBasic >= 1.35 &&
      cohesion.densityExBasic <= 3.35 &&
      cohesion.maxConnectorRepeat <= 3 &&
      cohesion.repetition.topCount <= 12 &&
      cohesion.repetition.ratio < 0.04 &&
      !cohesion.mechanicalCohesion &&
      !cohesion.lowCohesionGuidance &&
      !cohesion.weakReferencing &&
      !cohesion.weakParagraphLogic &&
      !cohesion.weakTopicCoverage &&
      highBandLanguageControlStrong(ctx)
  };
}

function ccBand5OverlinkRecoveryProfile(ctx) {
  const para = paragraphProfile(ctx);
  const cohesion = cohesionQualityProfile(ctx);
  const support = bodySupportProfile(ctx);
  const topicCoverage = paragraphTopicCoverageProfile(ctx);
  const developedRows = developedBodyRowCount(support);

  const moderateOverlinkPattern =
    cohesion.maxConnectorRepeat === 4 &&
    cohesion.distinctExBasic >= 4 &&
    cohesion.densityExBasic >= 3.0;
  const strongStructure =
    para.paragraphCount >= 4 &&
    para.bodyCount >= 2 &&
    para.hasIntro &&
    para.hasConclusion &&
    para.minSent >= 2;
  const strongSupport =
    support.totalBodyRows >= 2 &&
    developedRows >= 2 &&
    support.effectiveUnderdevelopedCount <= 1;
  const strongTopicCoverage =
    topicCoverage.bodyParagraphCount >= 2 &&
    topicCoverage.bodyTopicCoverageRatio >= 0.67;
  const extremeRepetition =
    cohesion.repetition.topCount >= 11 &&
    cohesion.repetition.ratio >= 0.04;

  return {
    moderateOverlinkPattern,
    strongStructure,
    strongSupport,
    strongTopicCoverage,
    extremeRepetition,
    eligible:
      moderateOverlinkPattern &&
      strongStructure &&
      strongSupport &&
      strongTopicCoverage &&
      !cohesion.weakParagraphLogic &&
      !cohesion.weakTopicCoverage &&
      !cohesion.weakReferencing &&
      !cohesion.mechanicalCohesion &&
      !extremeRepetition
  };
}

function conclusionSupportIsBand9Safe(ctx) {
  const para = paragraphProfile(ctx);
  const structure = ctx?.step2?.structure || {};
  const hasConclusionSignal = Object.prototype.hasOwnProperty.call(structure, 'conclusionSignpostFoundInLast');
  const misplacedConclusionSignpost = Boolean(structure?.misplacedConclusionSignpost);
  if (!para.hasConclusion || para.bodyCount < 2 || para.paragraphCount < 4) return false;
  if (para.minSent <= 1) return false;
  if (misplacedConclusionSignpost) return false;

  if (hasConclusionSignal) {
    const foundInLast = Boolean(structure?.conclusionSignpostFoundInLast);
    if (!foundInLast) {
      const lastParagraphSentenceCount = Number(para.counts?.[para.counts.length - 1] || 0);
      if (lastParagraphSentenceCount <= 1) return false;
    }
  }
  return true;
}

function paragraphingShowsBand9Control(ctx) {
  const para = paragraphProfile(ctx);
  const topicCoverage = paragraphTopicCoverageProfile(ctx);
  const cohesion = cohesionQualityProfile(ctx);
  const structure = ctx?.step2?.structure || {};
  if (para.paragraphCount < 4 || para.bodyCount < 2 || !para.hasIntro || !para.hasConclusion) return false;
  if (para.minSent <= 1) return false;
  if (topicCoverage.bodyParagraphCount >= 2 && topicCoverage.bodyTopicCoverageRatio < 0.9) return false;
  if (Boolean(structure?.misplacedConclusionSignpost)) return false;
  if (cohesion.runOnRecoveredBodyCount > 0 || cohesion.longSingleBodyCount > 0) return false;
  return true;
}

function paragraphingOnlySupportsBand8(ctx) {
  const para = paragraphProfile(ctx);
  const topicCoverage = paragraphTopicCoverageProfile(ctx);
  const cohesion = cohesionQualityProfile(ctx);
  const structure = ctx?.step2?.structure || {};
  if (para.paragraphCount < 3 || para.bodyCount < 2 || !para.hasConclusion) return false;
  if (para.minSent <= 1 || Boolean(structure?.misplacedConclusionSignpost)) return true;
  if (cohesion.runOnRecoveredBodyCount > 0 || cohesion.longSingleBodyCount > 0) return true;
  if (topicCoverage.bodyParagraphCount >= 2 && topicCoverage.bodyTopicCoverageRatio < 0.9) return true;
  return false;
}

function repetitionOrMechanicalLinkingBlocksBand9(ctx) {
  const cohesion = cohesionQualityProfile(ctx);
  return (
    cohesion.heavyRepetition ||
    (cohesion.repetition.topCount >= 10 && cohesion.repetition.ratio >= 0.022 && cohesion.referencingDensity < 5.0) ||
    cohesion.mechanicalCohesion ||
    cohesion.lowCohesionGuidance ||
    cohesion.weakReferencing ||
    cohesion.maxConnectorRepeat >= 4
  );
}

function cohesionAttractsNoAttention(ctx) {
  const cohesion = cohesionQualityProfile(ctx);
  if (cohesion.weakParagraphLogic || cohesion.weakTopicCoverage) return false;
  if (repetitionOrMechanicalLinkingBlocksBand9(ctx)) return false;
  if (cohesion.repetition.topCount >= 10 && cohesion.repetition.ratio >= 0.022) return false;
  if (cohesion.repetition.topCount >= 8 && cohesion.repetition.ratio >= 0.024) return false;
  if (!cohesion.strongProgression) return false;
  if (cohesion.distinctExBasic < 5) return false;
  if (cohesion.maxConnectorRepeat > 2) return false;
  if (cohesion.referencingDensity < 1.7) return false;
  if (cohesion.densityExBasic < 1.4 || cohesion.densityExBasic > 4.2) return false;
  return true;
}

function lexicalShowsBand9Control(lexicalControl) {
  if (!lexicalControl) return false;
  return (
    lexicalControl.rangeBand === 'wide' &&
    lexicalControl.precisionBand === 'high' &&
    lexicalControl.collocationControl === 'good' &&
    ['none', 'minor'].includes(lexicalControl.spellingImpact) &&
    ['none', 'minor'].includes(lexicalControl.wordFormationImpact) &&
    ['none', 'mild'].includes(lexicalControl.repetitionImpact) &&
    ['none', 'few'].includes(lexicalControl.awkwardExpressionCountBand) &&
    ['none', 'minor'].includes(lexicalControl.clarityImpactFromLexis)
  );
}

function lexicalBand9Blocked(lexicalControl) {
  if (!lexicalControl) return false;
  return (
    lexicalControl.rangeBand !== 'wide' ||
    ['low', 'mixed'].includes(lexicalControl.precisionBand) ||
    lexicalControl.collocationControl === 'weak' ||
    ['some', 'major'].includes(lexicalControl.clarityImpactFromLexis) ||
    ['some', 'many'].includes(lexicalControl.awkwardExpressionCountBand) ||
    ['noticeable', 'strong'].includes(lexicalControl.repetitionImpact) ||
    ['some', 'frequent'].includes(lexicalControl.spellingImpact) ||
    ['some', 'frequent'].includes(lexicalControl.wordFormationImpact)
  );
}

function grammarShowsBand9Control(grammarControl) {
  if (!grammarControl) return false;
  return (
    grammarControl.structureRange === 'wide' &&
    grammarControl.complexSentenceControl === 'good' &&
    grammarControl.errorFrequency === 'rare' &&
    grammarControl.errorFreeSentenceShareBand === 'high' &&
    (grammarControl.clarityImpactFromGrammar === 'none' || grammarControl.clarityImpactFromGrammar === 'minor') &&
    grammarWeakControlCount(grammarControl) === 0
  );
}

module.exports = {
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
};
