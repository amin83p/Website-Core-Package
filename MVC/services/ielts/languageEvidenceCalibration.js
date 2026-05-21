function isOneOf(value, allowed) {
  return allowed.includes(String(value || '').trim().toLowerCase());
}

function cloneObject(value) {
  return value && typeof value === 'object' ? { ...value } : value;
}

function buildStep3LanguageCalibrationGuide() {
  return `
HIGH-BAND LR/GRA CALIBRATION ANCHORS (IMPORTANT):
- Keep extraction evidence-only; do NOT assign IELTS band scores.
- Do not collapse strong scripts into mid labels just because minor errors exist.
- "wide" lexical range is valid when vocabulary is broad/flexible even with a few awkward phrases.
- Reserve lexical range="adequate" for scripts with genuinely limited flexibility.
- "good"/"high" lexical precision is still valid when most choices are effective and only a small number are awkward.
- Reserve grammar errorFrequency="frequent" for errors recurring across much of the script, not just several visible mistakes.
- If errors recur but meaning is generally easy to follow, prefer clarityImpactFromLexis/Grammar = none or minor.
- Use clarityImpactFromLexis/Grammar = some only when understanding is strained in multiple places.
- Use clarityImpactFromLexis/Grammar = major only when language problems repeatedly block understanding.
- errorFreeSentenceShareBand="low" should be avoided when many sentences remain accurate despite recurring minor issues.
- Distinguish carefully:
  a) strong higher-band language with recurring minor errors (clarity preserved)
  b) genuine mid-band control with repeated clarity interference.

Calibration examples (instructional):
- If vocabulary is wide/flexible and mostly precise, with a few awkward expressions and minor slips, do NOT default to adequate/mixed/some-clarity-impact labels.
- If structure is varied and complex forms are handled well, with recurring minor errors that do not reduce clarity, avoid frequent+some/major clarity combinations by default.
- If language is mostly mixed/simple and errors repeatedly strain understanding, choose lower-control labels.
`.trim();
}

function applyLanguageEvidenceCalibrationGuards({ lexicalControl, grammarControl } = {}) {
  const calibratedLexical = cloneObject(lexicalControl);
  const calibratedGrammar = cloneObject(grammarControl);
  const adjustments = [];

  const applyChange = ({ domain, field, to, reason }) => {
    const target = domain === 'lexicalControl' ? calibratedLexical : calibratedGrammar;
    if (!target || typeof target !== 'object') return;
    const from = target[field];
    if (String(from) === String(to)) return;
    target[field] = to;
    adjustments.push({
      domain,
      field,
      from: from ?? null,
      to,
      reason
    });
  };

  if (calibratedLexical && typeof calibratedLexical === 'object') {
    const strongHighLexicalProfile =
      isOneOf(calibratedLexical.rangeBand, ['sufficient', 'wide']) &&
      isOneOf(calibratedLexical.precisionBand, ['good', 'high']) &&
      isOneOf(calibratedLexical.awkwardExpressionCountBand, ['none', 'few']) &&
      isOneOf(calibratedLexical.spellingImpact, ['none', 'minor']) &&
      isOneOf(calibratedLexical.wordFormationImpact, ['none', 'minor']) &&
      isOneOf(calibratedLexical.repetitionImpact, ['none', 'mild']);

    if (strongHighLexicalProfile && isOneOf(calibratedLexical.clarityImpactFromLexis, ['some', 'major'])) {
      applyChange({
        domain: 'lexicalControl',
        field: 'clarityImpactFromLexis',
        to: 'minor',
        reason: 'strong_profile_with_minor_surface_issues_should_preserve_lexical_clarity'
      });
    }

    const majorLexicalClarityWithoutSevereSignals =
      isOneOf(calibratedLexical.clarityImpactFromLexis, ['major']) &&
      !isOneOf(calibratedLexical.spellingImpact, ['frequent']) &&
      !isOneOf(calibratedLexical.wordFormationImpact, ['frequent']) &&
      !isOneOf(calibratedLexical.awkwardExpressionCountBand, ['many']) &&
      !isOneOf(calibratedLexical.repetitionImpact, ['strong']) &&
      !isOneOf(calibratedLexical.precisionBand, ['low']);

    if (majorLexicalClarityWithoutSevereSignals) {
      applyChange({
        domain: 'lexicalControl',
        field: 'clarityImpactFromLexis',
        to: 'some',
        reason: 'major_lexical_clarity_requires_stronger_disruption_signals'
      });
    }
  }

  if (calibratedGrammar && typeof calibratedGrammar === 'object') {
    const strongGrammarControlProfile =
      isOneOf(calibratedGrammar.structureRange, ['varied', 'wide']) &&
      isOneOf(calibratedGrammar.complexSentenceControl, ['good']) &&
      isOneOf(calibratedGrammar.clarityImpactFromGrammar, ['none', 'minor', 'some']);

    if (strongGrammarControlProfile && isOneOf(calibratedGrammar.errorFreeSentenceShareBand, ['low', 'very_low'])) {
      applyChange({
        domain: 'grammarControl',
        field: 'errorFreeSentenceShareBand',
        to: 'moderate',
        reason: 'strong_grammar_profile_should_not_pair_with_very_low_or_low_error_free_share'
      });
    }

    if (
      isOneOf(calibratedGrammar.errorFrequency, ['frequent']) &&
      isOneOf(calibratedGrammar.errorFreeSentenceShareBand, ['moderate', 'high'])
    ) {
      applyChange({
        domain: 'grammarControl',
        field: 'errorFrequency',
        to: isOneOf(calibratedGrammar.errorFreeSentenceShareBand, ['high']) ? 'occasional' : 'noticeable',
        reason: 'frequent_errors_conflict_with_moderate_or_high_error_free_sentence_share'
      });
    }

    if (
      isOneOf(calibratedGrammar.structureRange, ['varied', 'wide']) &&
      isOneOf(calibratedGrammar.complexSentenceControl, ['good']) &&
      isOneOf(calibratedGrammar.errorFreeSentenceShareBand, ['moderate', 'high']) &&
      isOneOf(calibratedGrammar.clarityImpactFromGrammar, ['some', 'major'])
    ) {
      applyChange({
        domain: 'grammarControl',
        field: 'clarityImpactFromGrammar',
        to: 'minor',
        reason: 'strong_structure_with_preserved_error_free_share_should_not_imply_major_clarity_strain'
      });
    }

    if (
      isOneOf(calibratedGrammar.errorFrequency, ['rare']) &&
      isOneOf(calibratedGrammar.clarityImpactFromGrammar, ['some', 'major'])
    ) {
      applyChange({
        domain: 'grammarControl',
        field: 'clarityImpactFromGrammar',
        to: 'minor',
        reason: 'rare_errors_should_not_map_to_some_or_major_grammar_clarity_impact'
      });
    }

    if (
      isOneOf(calibratedGrammar.errorFrequency, ['occasional']) &&
      isOneOf(calibratedGrammar.clarityImpactFromGrammar, ['major'])
    ) {
      applyChange({
        domain: 'grammarControl',
        field: 'clarityImpactFromGrammar',
        to: 'minor',
        reason: 'occasional_errors_should_not_default_to_major_grammar_clarity_impact'
      });
    }

    if (
      isOneOf(calibratedGrammar.errorFrequency, ['frequent']) &&
      isOneOf(calibratedGrammar.clarityImpactFromGrammar, ['none'])
    ) {
      applyChange({
        domain: 'grammarControl',
        field: 'clarityImpactFromGrammar',
        to: 'minor',
        reason: 'frequent_errors_require_at_least_minor_grammar_clarity_impact'
      });
    }
  }

  return {
    lexicalControl: calibratedLexical,
    grammarControl: calibratedGrammar,
    applied: adjustments.length > 0,
    adjustmentCount: adjustments.length,
    adjustments
  };
}

module.exports = {
  buildStep3LanguageCalibrationGuide,
  applyLanguageEvidenceCalibrationGuards
};
