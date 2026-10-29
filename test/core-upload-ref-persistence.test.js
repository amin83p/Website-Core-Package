const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const coreUploadRefService = require('../MVC/services/coreUploadRefService');

const ORIGINAL_UPLOAD_MODE = process.env.UPLOAD_MODE;

test.afterEach(() => {
  if (ORIGINAL_UPLOAD_MODE === undefined) delete process.env.UPLOAD_MODE;
  else process.env.UPLOAD_MODE = ORIGINAL_UPLOAD_MODE;
});

test('coreUploadRefService normalizePersistedUploadRef accepts /uploads/ paths', () => {
  const ref = '/uploads/GLOBAL/logo/test.png';
  assert.equal(coreUploadRefService.normalizePersistedUploadRef(ref), ref);
});

test('coreUploadRefService rejects bare disk paths in railway_proxy mode', () => {
  process.env.UPLOAD_MODE = 'railway_proxy';
  assert.throws(
    () => coreUploadRefService.normalizePersistedUploadRef('C:\\staging\\file.bin'),
    /must be an \/uploads\/ URL/
  );
});

const CONTROLLER_REF_SOURCES = [
  'MVC/controllers/newsController.js',
  'MVC/controllers/chatController.js',
  'MVC/controllers/contactController.js',
  'MVC/controllers/symbolController.js',
  'MVC/controllers/taskController.js'
];

const LEGACY_PERSIST_PATTERN = /getStoredFileUrl\s*\([^)]+\)\s*\|\|\s*uploadMiddleware\.getStoredFilePath/;

test('core controllers persist uploads via coreUploadRefService', () => {
  for (const rel of CONTROLLER_REF_SOURCES) {
    const source = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    assert.match(
      source,
      /coreUploadRefService/,
      `${rel} should import/use coreUploadRefService for stored refs`
    );
    assert.doesNotMatch(
      source,
      LEGACY_PERSIST_PATTERN,
      `${rel} must not prefer getStoredFileUrl || getStoredFilePath for persistence`
    );
  }
});
