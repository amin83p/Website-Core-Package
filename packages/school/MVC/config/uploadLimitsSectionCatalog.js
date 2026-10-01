'use strict';

const UPLOAD_LIMIT_SECTIONS = Object.freeze([
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
