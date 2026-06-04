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

const scoringRules = {
  // ========================= TR =========================

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

  // ========================= TR (Low Band 1-3 Conservative) =========================

  // "Is the answer completely unrelated to the task?"
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

  // "Does the response barely address the task?"
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

  // "Does the response fail to address the task adequately?"
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

  // "Is there no clear position expressed?"
  // Reserve this for genuinely absent/indeterminate stance.
  // Contradiction belongs in higher weak-band "unclear/inconsistent" handling.
  "TR3-2": (ctx) => {
    const p = stanceProfile(ctx);
    const recovery = trLowBandPositionRecoveryProfile(ctx);
    const coverageDropoutRescue = coverageSignalDropoutRescueProfile(ctx);
    if (coverageDropoutRescue.eligible) return "No";
    if (!p.hasPosition && !recovery.derivedPositionLikely) return "Yes";
    return "No";
  },

  // "Is no position expressed?"
  // Stricter than TR3-2: contradictory stance still counts as a position being present.
  "TR2-2": (ctx) => {
    const p = stanceProfile(ctx);
    const recovery = trLowBandPositionRecoveryProfile(ctx);
    const coverageDropoutRescue = coverageSignalDropoutRescueProfile(ctx);
    if (coverageDropoutRescue.eligible) return "No";
    if (!p.hasPosition && !recovery.derivedPositionLikely) return "Yes";
    return "No";
  },

  // "Are there only one or two ideas across the whole response?"
  // Conservative proxy based on extracted sub-question support density.
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

  // "Does this body paragraph show no real development?"
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

  // "Are there only a few relevant ideas across the response?"
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

  // "Is this body paragraph largely undeveloped?"
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

  // "Is this body paragraph largely irrelevant to the task or stated position?"
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

  // (none/unclear/clear)
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

  // (none/yes)
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

  // (none/irrelevant/relevant)
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
  },

  // ========================= CC =========================

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

  // (absent/confusing/ok)
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

  // "Does the script fail to communicate any message?"
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

  // "Is there very little overall control of organisational features across the response?"
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

  // Paragraph-local organization signal (body paragraphs only).
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

  // "Is there no clear overall progression across the response?"
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
    // Keep CC3-2 on AI fallback for low-band stability:
    // paragraph-level cohesion range remains too interpretive for a safe deterministic lock.
    return null;
  },

  // "Is there some organisation (ideas grouped, not totally random)?"
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
    if (repetitionOrMechanicalLinkingBlocksBand9(ctx)) return "No";
    if (!paragraphingShowsBand9Control(ctx)) return "No";
    if (!conclusionSupportIsBand9Safe(ctx)) return "No";
    if (paragraphingOnlySupportsBand8(ctx)) return "No";
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
  },

  // ========================= LR =========================

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
    const lexicalControl = lexicalControlProfile(ctx);
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
    const lexicalControl = lexicalControlProfile(ctx);
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
  },

  // ========================= GRA =========================

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

  // (rarely/sometimes/often)
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
    const grammarControl = grammarControlProfile(ctx);
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

applyRulePatchGroupGuards(scoringRules);

const scoringRuleHelpers = {
  currentParagraphProfile,
  getCurrentParagraphRole,
  getCurrentParagraphSentenceCount,
  isRulePatchGroupEnabled,
  patchGroupMeta: RULE_PATCH_GROUP_META,
  patchGroupByRuleKey: RULE_PATCH_GROUP_NAME_BY_KEY
};

module.exports = { scoringRules, scoringRuleHelpers };
