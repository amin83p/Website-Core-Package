const DEFAULT_LEVELS = Object.freeze([
  Object.freeze({ code: 'S', label: 'Superior', emoji: '⭐', minPercent: 85, maxPercent: 100, defaultPercent: 92.5 }),
  Object.freeze({ code: 'Sat', label: 'Satisfactory', emoji: '👍', minPercent: 60, maxPercent: 84, defaultPercent: 72 }),
  Object.freeze({ code: 'NI', label: 'Needs Improvement', emoji: '😐', minPercent: 50, maxPercent: 59, defaultPercent: 54.5 }),
  Object.freeze({ code: 'U', label: 'Unsatisfactory', emoji: '😞', minPercent: 0, maxPercent: 49, defaultPercent: 24.5 })
]);

const DEFAULT_POLICY = Object.freeze({
  levels: DEFAULT_LEVELS
});

function cloneLevel(row) {
  if (!row || typeof row !== 'object') return null;
  const code = String(row.code || '').trim();
  if (!code) return null;
  const minPercent = Number(row.minPercent);
  const maxPercent = Number(row.maxPercent);
  const defaultPercent = Number(row.defaultPercent);
  if (!Number.isFinite(minPercent) || !Number.isFinite(maxPercent) || !Number.isFinite(defaultPercent)) return null;
  return {
    code,
    label: String(row.label || code).trim() || code,
    emoji: String(row.emoji || '').trim() || '•',
    minPercent: Math.round(minPercent * 10) / 10,
    maxPercent: Math.round(maxPercent * 10) / 10,
    defaultPercent: Math.round(defaultPercent * 10) / 10
  };
}

function normalizePercent(value, fallback = 100) {
  const fallbackNumber = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumber) ? fallbackNumber : 100;
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(safeFallback * 10) / 10));
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

function normalizeLevels(inputLevels) {
  const rows = Array.isArray(inputLevels) ? inputLevels : [];
  const normalized = rows.map(cloneLevel).filter(Boolean);
  if (!normalized.length) return DEFAULT_LEVELS.map((row) => ({ ...row }));
  return normalized;
}

function validatePolicyLevels(levels) {
  const rows = normalizeLevels(levels);
  const errors = [];
  if (!rows.length) {
    errors.push('At least one rating level is required.');
    return { valid: false, errors, levels: rows };
  }

  const sorted = [...rows].sort((a, b) => b.minPercent - a.minPercent);
  const codes = new Set();
  sorted.forEach((row, index) => {
    if (codes.has(row.code)) errors.push(`Duplicate level code "${row.code}".`);
    codes.add(row.code);
    if (row.minPercent < 0 || row.maxPercent > 100) {
      errors.push(`Level "${row.code}" must stay within 0–100%.`);
    }
    if (row.minPercent > row.maxPercent) {
      errors.push(`Level "${row.code}" min cannot exceed max.`);
    }
    if (row.defaultPercent < row.minPercent || row.defaultPercent > row.maxPercent) {
      errors.push(`Level "${row.code}" default must fall within its min/max range.`);
    }
    if (index === sorted.length - 1 && row.minPercent !== 0) {
      errors.push('Lowest level must start at 0%.');
    }
    if (index === 0 && row.maxPercent !== 100) {
      errors.push('Highest level must end at 100%.');
    }
    if (index > 0) {
      const prev = sorted[index - 1];
      if (row.maxPercent >= prev.minPercent) {
        errors.push(`Level "${row.code}" overlaps with "${prev.code}".`);
      }
      const gap = Number((prev.minPercent - row.maxPercent).toFixed(1));
      if (gap < 0.5 || gap > 1.5) {
        errors.push(`Gap between "${row.code}" and "${prev.code}" ranges.`);
      }
    }
  });

  return { valid: errors.length === 0, errors, levels: sorted };
}

function resolvePolicy(orgPolicy = {}) {
  const levels = normalizeLevels(orgPolicy?.levels);
  const validation = validatePolicyLevels(levels);
  if (!validation.valid) {
    return { levels: DEFAULT_LEVELS.map((row) => ({ ...row })) };
  }
  return { levels: validation.levels.map((row) => ({ ...row })) };
}

function percentToLevel(percent, policy = DEFAULT_POLICY) {
  const resolved = resolvePolicy(policy);
  const value = normalizePercent(percent);
  const match = resolved.levels.find((row) => value >= row.minPercent && value <= row.maxPercent);
  return match ? { ...match } : { ...resolved.levels[0] };
}

function levelByCode(code, policy = DEFAULT_POLICY) {
  const resolved = resolvePolicy(policy);
  const key = String(code || '').trim();
  const match = resolved.levels.find((row) => row.code === key);
  return match ? { ...match } : null;
}

function levelDefaultPercent(code, policy = DEFAULT_POLICY) {
  const level = levelByCode(code, policy);
  return level ? level.defaultPercent : normalizePercent(100);
}

function normalizePolicyFromForm(input = {}) {
  let levelsInput = input.levels;
  if (typeof levelsInput === 'string') {
    try {
      levelsInput = JSON.parse(levelsInput);
    } catch (_) {
      levelsInput = [];
    }
  }
  const validation = validatePolicyLevels(normalizeLevels(levelsInput));
  if (!validation.valid) {
    const err = new Error(validation.errors.join(' '));
    err.validationErrors = validation.errors;
    throw err;
  }
  return { levels: validation.levels.map((row) => ({ ...row })) };
}

function normalizePolicyFromStored(input = {}) {
  const levels = normalizeLevels(input?.levels);
  const validation = validatePolicyLevels(levels);
  if (!validation.valid) {
    return { levels: DEFAULT_LEVELS.map((row) => ({ ...row })) };
  }
  return { levels: validation.levels.map((row) => ({ ...row })) };
}

module.exports = {
  DEFAULT_LEVELS,
  DEFAULT_POLICY,
  normalizePercent,
  normalizeLevels,
  validatePolicyLevels,
  resolvePolicy,
  percentToLevel,
  levelByCode,
  levelDefaultPercent,
  normalizePolicyFromForm,
  normalizePolicyFromStored
};
