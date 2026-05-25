const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const settingService = require('../MVC/services/settingService');
const adminAuthorityService = require('../MVC/services/adminAuthorityService');
const uploadCategoryResolverService = require('../MVC/services/uploadCategoryResolverService');
const coreFilesService = require('../MVC/services/coreFilesService');

const TEST_UPLOAD_ROOT = path.join(process.cwd(), 'tmp', 'core-files-service-test-uploads');
const ORIGINAL_GET_VALUE = settingService.getValue;
const ORIGINAL_UPLOAD_MODE = process.env.UPLOAD_MODE;
const ORIGINAL_IS_ADMIN_FOR_REQUEST = adminAuthorityService.isAdminForRequest;
const ORIGINAL_IS_SUPER_ADMIN = adminAuthorityService.isSuperAdmin;

const TEST_USER = {
  id: 'USER_TEST',
  activeOrgId: '42'
};

async function resetFixture() {
  await fsp.rm(TEST_UPLOAD_ROOT, { recursive: true, force: true });
  await fsp.mkdir(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'source'), { recursive: true });
  await fsp.mkdir(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'target'), { recursive: true });
  await fsp.writeFile(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'source', 'a.txt'), 'A');
}

test.beforeEach(async () => {
  uploadCategoryResolverService.resetUploadCategoryResolvers();
  process.env.UPLOAD_MODE = 'local';
  settingService.getValue = (section, key) => {
    if (section === 'app' && key === 'uploadsPath') return TEST_UPLOAD_ROOT;
    if (section === 'app' && key === 'defaultPageSize') return '30';
    return ORIGINAL_GET_VALUE.call(settingService, section, key);
  };
  adminAuthorityService.isAdminForRequest = () => true;
  adminAuthorityService.isSuperAdmin = () => false;
  await resetFixture();
});

test.afterEach(async () => {
  settingService.getValue = ORIGINAL_GET_VALUE;
  adminAuthorityService.isAdminForRequest = ORIGINAL_IS_ADMIN_FOR_REQUEST;
  adminAuthorityService.isSuperAdmin = ORIGINAL_IS_SUPER_ADMIN;
  if (ORIGINAL_UPLOAD_MODE === undefined) delete process.env.UPLOAD_MODE;
  else process.env.UPLOAD_MODE = ORIGINAL_UPLOAD_MODE;
  uploadCategoryResolverService.resetUploadCategoryResolvers();
  await fsp.rm(TEST_UPLOAD_ROOT, { recursive: true, force: true });
});

test('resolveUploadCategory maps legacy upload categories via core folder config', () => {
  const category = coreFilesService.resolveUploadCategory('tasks', true, {
    body: { taskId: 'Task 1' }
  });
  assert.match(category, /^tasks\//i);
  assert.match(category, /Task_1|Task_1/i);
});

test('resolveUploadCategory delegates package categories through registered resolvers', () => {
  uploadCategoryResolverService.registerUploadCategoryResolver('package-demo', ({ req = {}, isDynamic = false } = {}) => (
    `package-demo/${req.body?.itemId || 'missing'}/${isDynamic ? 'dynamic' : 'static'}`
  ));

  const category = coreFilesService.resolveUploadCategory('package-demo', true, {
    body: { itemId: 'ITEM_42' }
  });

  assert.equal(category, 'package-demo/ITEM_42/dynamic');
});

test('resolveContextFromPath rejects traversal attempts', () => {
  assert.throws(
    () => coreFilesService.resolveContextFromPath(TEST_USER, 'GLOBAL/../outside'),
    /(Invalid|Security|Access Denied)/i
  );
});

test('transferSingleItem copies a file in local mode', async () => {
  const sourceContext = coreFilesService.resolveContextFromPath(TEST_USER, 'GLOBAL/source/a.txt');
  const destinationContext = coreFilesService.resolveContextFromPath(TEST_USER, 'GLOBAL/target');
  const result = await coreFilesService.transferSingleItem({
    operation: 'copy',
    sourceContext,
    destinationContext
  });
  assert.equal(result.finalName, 'a.txt');
  await assert.doesNotReject(fsp.access(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'target', 'a.txt')));
  await assert.doesNotReject(fsp.access(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'source', 'a.txt')));
});

test('uploadFilesToContext stores uploaded temp files and deleteFilePaths removes them', async () => {
  const tempDir = path.join(process.cwd(), 'tmp', 'core-files-service-upload-temp');
  await fsp.mkdir(tempDir, { recursive: true });
  const tempFile = path.join(tempDir, `temp-${Date.now()}.txt`);
  await fsp.writeFile(tempFile, 'hello core files');
  const stats = await fsp.stat(tempFile);

  const context = coreFilesService.resolveContextFromPath(TEST_USER, 'GLOBAL/target');
  const payload = await coreFilesService.uploadFilesToContext({
    context,
    files: [{
      path: tempFile,
      originalname: 'hello.txt',
      mimetype: 'text/plain',
      size: stats.size
    }],
    relativePaths: ['hello.txt']
  });

  assert.equal(payload.status, 'success');
  assert.equal(payload.uploadedCount, 1);
  assert.equal(payload.files.length, 1);
  const uploadedUrl = payload.files[0].url;
  assert.match(uploadedUrl, /^\/uploads\/GLOBAL\/target\/hello/i);

  const uploadedDiskPath = coreFilesService.fromUploadsUrlToDiskPath(uploadedUrl);
  assert.ok(uploadedDiskPath);
  assert.equal(fs.existsSync(uploadedDiskPath), true);

  await coreFilesService.deleteFilePaths([uploadedUrl]);
  assert.equal(fs.existsSync(uploadedDiskPath), false);
});
