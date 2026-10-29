const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const uploadStorage = require('../MVC/services/uploadStorageService');
const uploadPathUtils = require('../MVC/utils/uploadPathUtils');

const ORIGINAL_UPLOAD_MODE = process.env.UPLOAD_MODE;

test.afterEach(() => {
  if (ORIGINAL_UPLOAD_MODE === undefined) delete process.env.UPLOAD_MODE;
  else process.env.UPLOAD_MODE = ORIGINAL_UPLOAD_MODE;
});

test('readUploadedFileAsUtf8 reads local staging file in local mode', async () => {
  delete process.env.UPLOAD_MODE;
  const root = uploadPathUtils.getUploadRootAbsolute();
  const relativeDir = path.join('GLOBAL', 'imports', `test_${Date.now()}`);
  const fullDir = path.join(root, relativeDir);
  fs.mkdirSync(fullDir, { recursive: true });
  const fullPath = path.join(fullDir, 'sample.csv');
  fs.writeFileSync(fullPath, 'name,email\nJane,jane@test.com\n', 'utf8');

  try {
    const content = await uploadStorage.readUploadedFileAsUtf8({ path: fullPath });
    assert.match(content, /Jane/);
  } finally {
    fs.rmSync(fullDir, { recursive: true, force: true });
  }
});

test('readUploadedFileAsUtf8 throws when file reference is missing', async () => {
  delete process.env.UPLOAD_MODE;
  await assert.rejects(
    () => uploadStorage.readUploadedFileAsUtf8({}),
    /missing/i
  );
});

test('getStoredFilePath prefers storedRef from multer file object', () => {
  const ref = '/uploads/GLOBAL/imports/file.csv';
  assert.equal(
    uploadStorage.getStoredFilePath({
      path: 'C:\\temp\\stale.bin',
      storedRef: ref
    }),
    ref
  );
});
