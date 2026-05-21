// MVC/services/ielts/answerContractUtils.js

const DEFAULT_FEATURE_PASS_VALUES = new Set([
  'yes', 'true', 'clear', 'adequate', 'wide', 'logical', 'well_managed',
  'sufficient', 'skilful', 'relevant', 'high', 'ok'
]);

const DEFAULT_FAULT_PASS_VALUES = new Set([
  'no', 'false', 'none', 'rare', 'rarely', 'never', 'few', 'minimal', 'minor', 'ok'
]);

function normalizeScoringAnswerToken(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function normalizeScoringAnswerList(raw) {
  let values = [];
  if (Array.isArray(raw)) {
    values = raw;
  } else if (typeof raw === 'string') {
    values = raw
      .split(/[,;\n|]+/g)
      .map((v) => v.trim())
      .filter(Boolean);
  } else if (raw !== undefined && raw !== null) {
    values = [raw];
  }

  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeScoringAnswerToken(value);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function resolvePolarity(row, getQuestionPolarity) {
  const explicitPolarity = String(row?.polarity || '').trim().toUpperCase();
  if (explicitPolarity) return explicitPolarity;
  if (typeof getQuestionPolarity === 'function') {
    try {
      const inferred = String(getQuestionPolarity(row) || '').trim().toUpperCase();
      if (inferred) return inferred;
    } catch (_) {
      // Preserve safety: fallback to FEATURE_CHECK below.
    }
  }
  return 'FEATURE_CHECK';
}

function evaluateRowPassResult(rowLike, options = {}) {
  const row = rowLike && typeof rowLike === 'object' ? rowLike : {};
  const value = normalizeScoringAnswerToken(row?.value);
  if (!value || value === 'error' || value === 'n/a' || value === 'na') {
    return {
      evaluated: false,
      pass: false,
      normalizedValue: value || null,
      scoringMode: 'not_evaluable',
      passRule: 'empty_or_error'
    };
  }

  const scoredAnswers = normalizeScoringAnswerList(row?.scoredAnswers);
  const notScoredAnswers = normalizeScoringAnswerList(row?.notScoredAnswers);
  const hasExplicitContract = scoredAnswers.length > 0 || notScoredAnswers.length > 0;

  if (hasExplicitContract) {
    if (scoredAnswers.length > 0 && scoredAnswers.includes(value)) {
      return {
        evaluated: true,
        pass: true,
        normalizedValue: value,
        scoringMode: 'explicit_answer_contract',
        passRule: 'scored_answers',
        scoredAnswers,
        notScoredAnswers
      };
    }
    if (notScoredAnswers.length > 0 && notScoredAnswers.includes(value)) {
      return {
        evaluated: true,
        pass: false,
        normalizedValue: value,
        scoringMode: 'explicit_answer_contract',
        passRule: 'not_scored_answers',
        scoredAnswers,
        notScoredAnswers
      };
    }

    if (scoredAnswers.length > 0 && notScoredAnswers.length === 0) {
      return {
        evaluated: true,
        pass: false,
        normalizedValue: value,
        scoringMode: 'explicit_answer_contract',
        passRule: 'default_fail_not_in_scored_answers',
        scoredAnswers,
        notScoredAnswers
      };
    }
    if (scoredAnswers.length === 0 && notScoredAnswers.length > 0) {
      return {
        evaluated: true,
        pass: true,
        normalizedValue: value,
        scoringMode: 'explicit_answer_contract',
        passRule: 'default_pass_not_in_not_scored_answers',
        scoredAnswers,
        notScoredAnswers
      };
    }

    return {
      evaluated: true,
      pass: false,
      normalizedValue: value,
      scoringMode: 'explicit_answer_contract',
      passRule: 'default_fail_unmapped_value',
      scoredAnswers,
      notScoredAnswers
    };
  }

  const featurePassValues = options.featurePassValues instanceof Set
    ? options.featurePassValues
    : DEFAULT_FEATURE_PASS_VALUES;
  const faultPassValues = options.faultPassValues instanceof Set
    ? options.faultPassValues
    : DEFAULT_FAULT_PASS_VALUES;
  const polarity = resolvePolarity(row, options.getQuestionPolarity);

  if (polarity === 'FAULT_CHECK') {
    const pass = faultPassValues.has(value) ||
      value.includes('rare') ||
      value.includes('few') ||
      value.includes('minor');
    return {
      evaluated: true,
      pass,
      normalizedValue: value,
      scoringMode: 'legacy_polarity',
      passRule: pass ? 'fault_pass_set' : 'fault_fail_set',
      polarity
    };
  }

  const pass = featurePassValues.has(value) || value === 'yes';
  return {
    evaluated: true,
    pass,
    normalizedValue: value,
    scoringMode: 'legacy_polarity',
    passRule: pass ? 'feature_pass_set' : 'feature_fail_set',
    polarity
  };
}

module.exports = {
  DEFAULT_FEATURE_PASS_VALUES,
  DEFAULT_FAULT_PASS_VALUES,
  normalizeScoringAnswerToken,
  normalizeScoringAnswerList,
  evaluateRowPassResult
};
