const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { requireCoreModule } = require('../MVC/services/school/schoolCoreContracts');
const schoolFileService = require('../MVC/services/school/schoolFileService');
const uploadStorage = requireCoreModule('MVC/services/uploadStorageService');
const uploadPathUtils = requireCoreModule('MVC/utils/uploadPathUtils');

const ORIGINAL_UPLOAD_MODE = process.env.UPLOAD_MODE;

test.afterEach(() => {
  if (ORIGINAL_UPLOAD_MODE === undefined) delete process.env.UPLOAD_MODE;
  else process.env.UPLOAD_MODE = ORIGINAL_UPLOAD_MODE;
});

test('resolveMulterStoredRef returns canonical upload URL from storedRef', () => {
  delete process.env.UPLOAD_MODE;
  const ref = schoolFileService.resolveMulterStoredRef({
    storedRef: '/uploads/GLOBAL/reports/sample.pdf',
    path: 'C:\\temp\\stale.pdf'
  });
  assert.equal(ref, '/uploads/GLOBAL/reports/sample.pdf');
});

test('buildAttachmentFromMulterFile sets url and path to the same canonical ref', () => {
  delete process.env.UPLOAD_MODE;
  const row = schoolFileService.buildAttachmentFromMulterFile({
    storedRef: '/uploads/ORG_1/students/doc.pdf',
    originalname: 'doc.pdf',
    filename: 'doc_1.pdf',
    size: 42
  }, { comment: 'test' });
  assert.equal(row.url, '/uploads/ORG_1/students/doc.pdf');
  assert.equal(row.path, row.url);
  assert.equal(row.comment, 'test');
});

test('resolveMulterStoredRef throws in railway_proxy when ref is not an upload URL', () => {
  process.env.UPLOAD_MODE = 'railway_proxy';
  process.env.RAILWAY_GATEWAY_BASE_URL = process.env.RAILWAY_GATEWAY_BASE_URL || 'https://example.test/';
  process.env.FILE_GATEWAY_SHARED_KEY = process.env.FILE_GATEWAY_SHARED_KEY || 'test-key';
  assert.throws(
    () => schoolFileService.resolveMulterStoredRef({ path: 'C:\\only-local.bin' }),
    /must be stored as an \/uploads\/ URL/
  );
});

test('normalizeStoredUploadRef converts disk path under upload root to /uploads URL', () => {
  delete process.env.UPLOAD_MODE;
  const reportViewService = require('../MVC/services/school/reportViewService');
  const diskPath = path.join(uploadPathUtils.getUploadRootAbsolute(), 'ORG_900000', 'reports', 'sample.docx');
  const normalized = reportViewService.normalizeStoredUploadRef(diskPath, '');
  assert.match(normalized, /^\/uploads\/ORG_900000\/reports\/sample\.docx$/i);
});

test('buildBookFileAssetFromMulter returns enriched-ready asset shape', () => {
  delete process.env.UPLOAD_MODE;
  const asset = schoolFileService.buildBookFileAssetFromMulter({
    storedRef: '/uploads/GLOBAL/school/books/BK_1/cover.jpg',
    filename: 'cover_1.jpg',
    originalname: 'cover.jpg'
  });
  assert.equal(asset.url, '/uploads/GLOBAL/school/books/BK_1/cover.jpg');
  assert.ok(asset.uploadedAt);
});

test('allowLocalUploadFallback is false when UPLOAD_MODE is railway_proxy', () => {
  process.env.UPLOAD_MODE = 'railway_proxy';
  const uploadStoragePolicy = requireCoreModule('MVC/services/uploadStoragePolicyService');
  assert.equal(uploadStoragePolicy.allowLocalUploadFallback(), false);
  assert.equal(uploadStoragePolicy.isRailwayGatewayBackend(), true);
});

test('readUploadedFileAsUtf8 rejects multer disk paths in railway_proxy mode', async () => {
  process.env.UPLOAD_MODE = 'railway_proxy';
  process.env.RAILWAY_GATEWAY_BASE_URL = process.env.RAILWAY_GATEWAY_BASE_URL || 'https://example.test/';
  process.env.FILE_GATEWAY_SHARED_KEY = process.env.FILE_GATEWAY_SHARED_KEY || 'test-key';
  await assert.rejects(
    () => uploadStorage.readUploadedFileAsUtf8({ path: 'C:\\temp\\import.csv' }),
    /must be stored as an \/uploads\/ URL/
  );
});
