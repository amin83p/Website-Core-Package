const CASE_CATEGORY_LABELS = Object.freeze({
  learning: 'Learning',
  technology: 'Technology',
  engagement: 'Engagement',
  behavior: 'Behavior',
  support: 'Additional Support',
  resources: 'Resources',
  lesson_delivery: 'Lesson Delivery',
  other: 'Other'
});

const CASE_CATEGORY_DETAIL_PRESETS = Object.freeze({
  learning: Object.freeze([
    'Struggled with today\'s material',
    'Needed concept re-explained',
    'Could not complete practice work',
    'Required one-on-one help',
    'Missing prerequisite skills'
  ]),
  technology: Object.freeze([
    'Device would not connect',
    'Software or login issue',
    'Audio/video problem',
    'Internet connectivity issue',
    'Could not access assignment platform'
  ]),
  engagement: Object.freeze([
    'Low participation today',
    'Off-task during instruction',
    'Reluctant to start work',
    'Frequent distractions',
    'Needed repeated redirection'
  ]),
  behavior: Object.freeze([
    'Disrespectful to teacher',
    'Disruptive to class',
    'Conflict with another student',
    'Did not follow classroom rules',
    'Needed behavior intervention'
  ]),
  support: Object.freeze([
    'Needs counseling follow-up',
    'Needs learning support referral',
    'Needs family contact',
    'Needs attendance follow-up',
    'Needs accommodations review'
  ]),
  resources: Object.freeze([
    'Missing required materials',
    'Did not bring supplies',
    'Needs printed materials',
    'Needs equipment/supplies',
    'Workspace not adequate'
  ]),
  lesson_delivery: Object.freeze([
    'Lesson pace too fast',
    'Lesson pace too slow',
    'Instructions unclear',
    'Activity not accessible',
    'Needed lesson adjustment'
  ]),
  other: Object.freeze([])
});

function normalizeCategory(value) {
  const token = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(CASE_CATEGORY_LABELS, token) ? token : 'other';
}

function getCategoryLabel(category) {
  return CASE_CATEGORY_LABELS[normalizeCategory(category)] || CASE_CATEGORY_LABELS.other;
}

function getPresetsForCategory(category) {
  const key = normalizeCategory(category);
  const rows = CASE_CATEGORY_DETAIL_PRESETS[key];
  return Array.isArray(rows) ? rows.map((row) => String(row)) : [];
}

function isPresetDetail(category, details) {
  const text = String(details || '').trim();
  if (!text) return false;
  return getPresetsForCategory(category).includes(text);
}

function deriveCaseSummary(category, details, maxLength = 260) {
  const detailText = String(details || '').trim();
  if (!detailText) return '';
  const label = getCategoryLabel(category);
  const summary = `${label}: ${detailText}`;
  return summary.length > maxLength ? summary.slice(0, maxLength) : summary;
}

function getPresetConfig() {
  return {
    labels: { ...CASE_CATEGORY_LABELS },
    presets: Object.fromEntries(
      Object.entries(CASE_CATEGORY_DETAIL_PRESETS).map(([key, rows]) => [key, [...rows]])
    )
  };
}

module.exports = {
  CASE_CATEGORY_LABELS,
  CASE_CATEGORY_DETAIL_PRESETS,
  normalizeCategory,
  getCategoryLabel,
  getPresetsForCategory,
  isPresetDetail,
  deriveCaseSummary,
  getPresetConfig
};
