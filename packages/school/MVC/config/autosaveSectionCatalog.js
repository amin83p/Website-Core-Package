'use strict';

const AUTOSAVE_SECTIONS = Object.freeze([
  Object.freeze({
    key: 'manage-session',
    title: 'Manage Session',
    description: 'Class session attendance, notes, conduct, and instructional content.',
    order: 10
  })
]);

function listAutosaveSections() {
  return AUTOSAVE_SECTIONS
    .map((row) => ({ ...row }))
    .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
}

function getAutosaveSection(key) {
  const token = String(key || '').trim();
  return listAutosaveSections().find((row) => row.key === token) || null;
}

function listAutosaveSectionKeys() {
  return listAutosaveSections().map((row) => row.key);
}

module.exports = {
  AUTOSAVE_SECTIONS,
  listAutosaveSections,
  getAutosaveSection,
  listAutosaveSectionKeys
};
