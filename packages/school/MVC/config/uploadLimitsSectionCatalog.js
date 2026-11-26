'use strict';

const UPLOAD_LIMIT_SECTIONS = Object.freeze([
  Object.freeze({
    key: 'wordOfDayPhoto',
    title: 'Word of Day — photo',
    description: 'Illustration image for a Word of Day entry.',
    notes: 'Applies to photo uploads on the Word of Day form (2 MB hard cap in controller).',
    defaultMaxMb: 2,
    minMb: 1,
    adminMaxMb: 2,
    order: 5
  }),
  Object.freeze({
    key: 'wordOfDayAudio',
    title: 'Word of Day — audio',
    description: 'Pronunciation audio clip for a Word of Day entry.',
    notes: 'Applies to audio uploads on the Word of Day form (3 MB hard cap in controller).',
    defaultMaxMb: 3,
    minMb: 1,
    adminMaxMb: 3,
    order: 6
  }),
  Object.freeze({
    key: 'bookPdf',
    title: 'Library — book PDF',
    description: 'Digital PDF attached to books in the school library catalog.',
    notes: 'Used when staff upload a book PDF on the book form. Can exceed the general app upload limit.',
    defaultMaxMb: 200,
    minMb: 1,
    adminMaxMb: 500,
    order: 10
  })
]);

function listUploadLimitSections() {
  return UPLOAD_LIMIT_SECTIONS
    .map((row) => ({ ...row }))
    .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
}

function getUploadLimitSection(key) {
  const token = String(key || '').trim();
  return listUploadLimitSections().find((row) => row.key === token) || null;
}

function listUploadLimitSectionKeys() {
  return listUploadLimitSections().map((row) => row.key);
}

module.exports = {
  UPLOAD_LIMIT_SECTIONS,
  listUploadLimitSections,
  getUploadLimitSection,
  listUploadLimitSectionKeys
};
