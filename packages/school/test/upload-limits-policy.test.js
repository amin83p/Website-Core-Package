'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../MVC/services/school/uploadLimitsPolicyService');

test('validatePolicyInput rejects unknown section keys', () => {
  assert.throws(
    () => service.validatePolicyInput({ sections: { unknownSection: { maxFileSizeMb: 10 } } }),
    /Unknown upload limit section key/
  );
});

test('validatePolicyInput clamps book PDF max size to catalog bounds', () => {
  const policy = service.validatePolicyInput({ bookPdfMaxFileSizeMb: '250' });
  assert.equal(policy.sections.bookPdf.maxFileSizeMb, 250);

  assert.throws(
    () => service.validatePolicyInput({ bookPdfMaxFileSizeMb: '999' }),
    /between 1 and 500 MB/
  );
});

test('validatePolicyInput clears org override when book PDF max is blank', () => {
  const policy = service.validatePolicyInput({ bookPdfMaxFileSizeMb: '' });
  assert.equal(policy.sections.bookPdf.maxFileSizeMb, null);
});

test('effectiveMaxFileSizeMb uses catalog default when org value is unset', () => {
  const previous = process.env.SCHOOL_BOOK_PDF_MAX_UPLOAD_MB;
  delete process.env.SCHOOL_BOOK_PDF_MAX_UPLOAD_MB;
  try {
    assert.equal(service.effectiveMaxFileSizeMb('bookPdf', { maxFileSizeMb: null }), 200);
  } finally {
    if (previous === undefined) delete process.env.SCHOOL_BOOK_PDF_MAX_UPLOAD_MB;
    else process.env.SCHOOL_BOOK_PDF_MAX_UPLOAD_MB = previous;
  }
});

test('effectiveMaxFileSizeMb prefers env deploy default over catalog default', () => {
  const previous = process.env.SCHOOL_BOOK_PDF_MAX_UPLOAD_MB;
  process.env.SCHOOL_BOOK_PDF_MAX_UPLOAD_MB = '128';
  try {
    assert.equal(service.effectiveMaxFileSizeMb('bookPdf', {}), 128);
  } finally {
    if (previous === undefined) delete process.env.SCHOOL_BOOK_PDF_MAX_UPLOAD_MB;
    else process.env.SCHOOL_BOOK_PDF_MAX_UPLOAD_MB = previous;
  }
});

test('effectiveMaxFileSizeMb uses stored org override when set', () => {
  assert.equal(service.effectiveMaxFileSizeMb('bookPdf', { maxFileSizeMb: 300 }), 300);
});

test('resolvePolicy enriches sections for settings display', () => {
  const resolved = service.resolvePolicy({ sections: { bookPdf: { maxFileSizeMb: 180 } } });
  assert.equal(resolved.sections.bookPdf.maxFileSizeMb, 180);
  assert.equal(resolved.sections.bookPdf.effectiveMaxFileSizeMb, 180);
  assert.equal(resolved.sections.bookPdf.title, 'Library — book PDF');
});
