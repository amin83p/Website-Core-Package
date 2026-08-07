'use strict';

const SCHOOL_SETTINGS_GROUPS = Object.freeze([
  Object.freeze({
    key: 'conduct-rating-scale',
    title: 'Conduct Rating Scale',
    description: 'Configure the qualitative labels and percentage ranges used by class conduct ratings.',
    icon: 'bi-emoji-smile',
    order: 10
  }),
  Object.freeze({
    key: 'attendance-matrix',
    title: 'Attendance Matrix Thresholds',
    description: 'Configure late and early-leave cutoffs for each scheduled session duration.',
    icon: 'bi-clock-history',
    order: 20
  }),
  Object.freeze({
    key: 'autosave',
    title: 'Autosave',
    description: 'Configure default autosave intervals and per-section defaults for school pages.',
    icon: 'bi-arrow-repeat',
    order: 30
  })
]);

function listSchoolSettingsGroups() {
  return SCHOOL_SETTINGS_GROUPS
    .map((row) => ({ ...row }))
    .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
}

module.exports = {
  SCHOOL_SETTINGS_GROUPS,
  listSchoolSettingsGroups
};
