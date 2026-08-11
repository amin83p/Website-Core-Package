const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const bookModel = require('../MVC/models/school/bookModel');
const bookController = require('../MVC/controllers/school/bookController');
const accessConstants = require('../config/accessConstants');
const { requireCoreModule } = require('../MVC/services/school/schoolCoreContracts');
const uploadCategoryResolverService = requireCoreModule('MVC/services/uploadCategoryResolverService');
const coreFilesService = requireCoreModule('MVC/services/coreFilesService');
const { registerSchoolUploadCategoryResolvers } = require('../MVC/services/school/schoolUploadCategoryRegistration');

const BOOK_LIST_VIEW = path.join(ROOT, 'packages/school/MVC/views/school/book/bookList.ejs');
const BOOK_FORM_VIEW = path.join(ROOT, 'packages/school/MVC/views/school/book/bookForm.ejs');
const BOOK_ROUTES = path.join(ROOT, 'packages/school/MVC/routes/bookRoutes.js');
const BOOK_CONTROLLER = path.join(ROOT, 'packages/school/MVC/controllers/school/bookController.js');
const MONGO_INDEX_MANAGER = path.join(ROOT, 'MVC/infrastructure/mongo/mongoIndexManager.js');

test('access constants declare SCHOOL_BOOKS', () => {
  assert.equal(accessConstants.SCHOOL_SECTIONS.SCHOOL_BOOKS, 'SCHOOL_BOOKS');
  assert.equal(accessConstants.SECTIONS.SCHOOL_BOOKS, 'SCHOOL_BOOKS');
});

test('book routes register list and CRUD handlers', () => {
  const source = fs.readFileSync(BOOK_ROUTES, 'utf8');
  assert.match(source, /SECTIONS\.SCHOOL_BOOKS/);
  assert.match(source, /ctrl\.listBooks/);
  assert.match(source, /ctrl\.saveBook/);
  assert.match(source, /ctrl\.deleteBook/);
});

test('book controller exports list and form handlers', () => {
  assert.equal(typeof bookController.listBooks, 'function');
  assert.equal(typeof bookController.showCreateForm, 'function');
  assert.equal(typeof bookController.showEditForm, 'function');
  assert.equal(typeof bookController.saveBook, 'function');
  assert.equal(typeof bookController.uploadCoverPhoto, 'function');
  assert.equal(typeof bookController.uploadDigitalPdf, 'function');
  assert.equal(typeof bookController.getBookTemplate, 'function');
  assert.equal(typeof bookController.deleteBook, 'function');
});

test('book list view includes table conventions', () => {
  const source = fs.readFileSync(BOOK_LIST_VIEW, 'utf8');
  assert.match(source, /id="first-table"/);
  assert.match(source, /tableName/);
  assert.match(source, /school\/library\/books/);
  assert.match(source, /No books found/);
});

test('book form view includes TOC editor and AJAX save', () => {
  const source = fs.readFileSync(BOOK_FORM_VIEW, 'utf8');
  assert.match(source, /nav nav-tabs/);
  assert.match(source, /tab-general/);
  assert.match(source, /tab-media/);
  assert.match(source, /tab-toc/);
  assert.match(source, /hid_tableOfContents/);
  assert.match(source, /hid_coverPhoto/);
  assert.match(source, /hid_digitalPdf/);
  assert.match(source, /pdfBookPageOne/);
  assert.match(source, /api\/upload-cover/);
  assert.match(source, /api\/upload-pdf/);
  assert.match(source, /btnAddTocRow/);
  assert.match(source, /js-toc-level/);
  assert.match(source, /js-add-toc-child/);
  assert.match(source, /X-AJAX-Request/);
  assert.match(source, /Table of contents/);
  assert.match(source, /Cover & PDF/);
  assert.match(source, /result\.warning/);
  assert.match(source, /Book Saved/);
});

test('book controller parses cover photo payload before repository save', () => {
  const coverUrl = '/uploads/ORG_42/school/books/book_unsaved/cover/cover_123.png';
  const payload = bookController._test.buildPayload({
    title: 'Railway Cover Book',
    coverPhoto: JSON.stringify({
      fileName: 'cover_123.png',
      originalName: 'cover.png',
      path: coverUrl,
      url: coverUrl
    }),
    tableOfContents: '[]'
  }, '42', 'USER_TEST');

  assert.equal(payload.title, 'Railway Cover Book');
  assert.equal(typeof payload.coverPhoto, 'object');
  assert.equal(payload.coverPhoto.url, coverUrl);
  assert.equal(payload.coverPhoto.path, coverUrl);
  assert.equal(payload.audit.createUser, 'USER_TEST');
});

test('bookModel normalizes legacy string cover photo metadata on read', () => {
  const coverUrl = '/uploads/ORG_42/school/books/BK001/cover/cover_123.png';
  const normalized = bookModel.normalizeStoredBook({
    id: 'BK001',
    orgId: '42',
    title: 'Legacy Cover Book',
    authors: [],
    tableOfContents: '[]',
    coverPhoto: JSON.stringify({
      fileName: 'cover_123.png',
      path: coverUrl,
      url: coverUrl
    })
  });

  assert.equal(normalized.coverPhoto.url, coverUrl);
  assert.equal(normalized.coverPhoto.fileName, 'cover_123.png');
});

test('book cover uploads resolve to the configured School book cover folder', () => {
  uploadCategoryResolverService.resetUploadCategoryResolvers();
  registerSchoolUploadCategoryResolvers();

  const category = coreFilesService.resolveUploadCategory('school-books', true, {
    body: { bookId: 'BK 123' }
  });

  assert.equal(category, 'school/books/BK_123/cover');
});

test('bookModel normalizes authors from comma-separated text', () => {
  const authors = bookModel.normalizeAuthors('Jane Doe, John Smith');
  assert.deepEqual(authors, ['Jane Doe', 'John Smith']);
});

test('bookModel normalizes ISBN by removing spaces and hyphens', () => {
  assert.equal(bookModel.normalizeIsbn('978-0-123456-78-9'), '9780123456789');
});

test('bookModel validates TOC page bounds against total pages', () => {
  assert.throws(() => {
    bookModel.normalizeTableOfContents([
      { label: 'Chapter 1', startPage: 50, endPage: 60 }
    ], 40);
  }, /exceeds total pages/);
});

test('bookModel validates TOC end page is not before start page', () => {
  assert.throws(() => {
    bookModel.normalizeTableOfContents([
      { label: 'Chapter 1', startPage: 20, endPage: 10 }
    ], 100);
  }, /end page must be greater than or equal to start page/);
});

test('bookModel detects duplicate ISBN for warning without rejecting it', () => {
  const payload = {
    orgId: 'ORG_TEST',
    title: 'Sample Book',
    isbn: '9780123456789',
    authors: 'Author One'
  };
  const sanitized = bookModel.sanitizeInput(payload);
  assert.equal(sanitized.isbn, '9780123456789');
  const duplicates = bookModel.assertUniqueIsbn([
    { id: 'BK-1', orgId: 'ORG_TEST', isbn: '9780123456789' }
  ], sanitized);
  assert.equal(duplicates.length, 1);
  assert.doesNotThrow(() => bookModel.assertUniqueIsbn([
    { id: 'BK-1', orgId: 'ORG_OTHER', isbn: '9780123456789' }
  ], sanitized));
});

test('book save returns duplicate ISBN warnings without blocking catalog variants', () => {
  const controller = fs.readFileSync(BOOK_CONTROLLER, 'utf8');
  const indexes = fs.readFileSync(MONGO_INDEX_MANAGER, 'utf8');
  assert.match(controller, /buildDuplicateIsbnWarning/);
  assert.match(controller, /DUPLICATE_ISBN_ALLOWED/);
  assert.match(controller, /warning:\s*duplicateIsbnWarning/);
  assert.match(indexes, /idx_school_books_org_isbn',\s*sparse:\s*true/);
  assert.doesNotMatch(indexes, /idx_school_books_org_isbn',\s*unique:\s*true/);
  assert.match(indexes, /schoolBooks:\s*'idx_school_books_org_isbn'/);
});

test('bookModel sorts TOC entries by sortOrder then startPage', () => {
  const toc = bookModel.normalizeTableOfContents([
    { label: 'Second', startPage: 20, sortOrder: 2 },
    { label: 'First', startPage: 1, sortOrder: 1 }
  ], 100);
  assert.equal(toc[0].label, 'First');
  assert.equal(toc[1].label, 'Second');
});

test('bookModel stores multilevel TOC with parent links', () => {
  const toc = bookModel.normalizeTableOfContents([
    { label: 'Chapter 1', startPage: 1, level: 1 },
    { label: 'Section 1.1', startPage: 5, level: 2 },
    { label: 'Section 1.2', startPage: 12, level: 2 },
    { label: 'Chapter 2', startPage: 20, level: 1 }
  ], 100);
  assert.equal(toc.length, 4);
  assert.equal(toc[0].level, 1);
  assert.equal(toc[0].parentId, null);
  assert.equal(toc[1].level, 2);
  assert.equal(toc[1].parentId, toc[0].id);
  assert.equal(toc[2].parentId, toc[0].id);
  assert.equal(toc[3].level, 1);
  assert.equal(toc[3].parentId, null);
});

test('bookModel rejects TOC level skips', () => {
  assert.throws(() => {
    bookModel.normalizeTableOfContents([
      { label: 'Chapter 1', startPage: 1, level: 1 },
      { label: 'Too deep', startPage: 5, level: 3 }
    ], 100);
  }, /must follow a parent heading|cannot skip more than one level/);
});

test('section seed script declares SCHOOL_BOOKS metadata', () => {
  const seedPath = path.join(ROOT, 'scripts/seed-school-books-section.js');
  const source = fs.readFileSync(seedPath, 'utf8');
  assert.match(source, /SECTION_ID = '445585'/);
  assert.match(source, /SYM_SCHOOL_BOOKS_001/);
  assert.match(source, /SCHOOL_LIBRARY/);
  assert.match(source, /445584/);
});

test('bookModel sanitizes cover photo metadata', () => {
  const cover = bookModel.sanitizeCoverPhoto({
    fileName: 'cover_123.jpg',
    originalName: 'My Cover.jpg',
    path: '/uploads/ORG/school/books/BK-1/cover/cover_123.jpg',
    url: '/uploads/ORG/school/books/BK-1/cover/cover_123.jpg'
  });
  assert.equal(cover.fileName, 'cover_123.jpg');
  assert.equal(cover.originalName, 'My Cover.jpg');
  assert.ok(cover.url);
});

test('book routes register cover photo upload endpoint', () => {
  const source = fs.readFileSync(BOOK_ROUTES, 'utf8');
  assert.match(source, /api\/upload-cover/);
  assert.match(source, /uploadCoverPhoto/);
});

test('book routes register digital PDF upload endpoint', () => {
  const source = fs.readFileSync(BOOK_ROUTES, 'utf8');
  assert.match(source, /api\/upload-pdf/);
  assert.match(source, /uploadDigitalPdf/);
});

test('book routes register copy template endpoint', () => {
  const source = fs.readFileSync(BOOK_ROUTES, 'utf8');
  assert.match(source, /api\/template/);
  assert.match(source, /getBookTemplate/);
});

test('book list view includes copy to new book action', () => {
  const source = fs.readFileSync(BOOK_LIST_VIEW, 'utf8');
  assert.match(source, /copyFrom=/);
  assert.match(source, /Copy to new book/);
});

test('book form view includes copy from book control', () => {
  const source = fs.readFileSync(BOOK_FORM_VIEW, 'utf8');
  assert.match(source, /btnCopyFromBook/);
  assert.match(source, /api\/template/);
  assert.match(source, /Copy From Book/);
});

test('bookModel maps book pages to PDF pages using page-one offset', () => {
  assert.equal(bookModel.mapBookPageToPdfPage(1, 15), 15);
  assert.equal(bookModel.mapBookPageToPdfPage(10, 15), 24);
});

test('bookModel requires pdf page one when digital PDF is present', () => {
  assert.throws(() => {
    bookModel.sanitizeInput({
      orgId: 'ORG_TEST',
      title: 'Sample Book',
      digitalPdf: JSON.stringify({
        fileName: 'book.pdf',
        url: '/uploads/ORG/school/books/BK-1/pdf/book.pdf'
      })
    });
  }, /PDF page for book page 1 is required/);
});

test('bookModel stores digital PDF with page-one mapping', () => {
  const sanitized = bookModel.sanitizeInput({
    orgId: 'ORG_TEST',
    title: 'Sample Book',
    digitalPdf: JSON.stringify({
      fileName: 'book.pdf',
      originalName: 'Textbook.pdf',
      url: '/uploads/ORG/school/books/BK-1/pdf/book.pdf'
    }),
    pdfBookPageOne: 12
  });
  assert.equal(sanitized.pdfBookPageOne, 12);
  assert.equal(sanitized.digitalPdf.fileName, 'book.pdf');
});
