const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const uploadStoragePolicy = require('../MVC/services/uploadStoragePolicyService');
const uploadStorageService = require('../MVC/services/uploadStorageService');
const { shouldServePublicUploadsFromRemoteOnly } = require('../MVC/utils/uploadPublicRoutePolicy');

const ORIGINAL_UPLOAD_MODE = process.env.UPLOAD_MODE;
const ORIGINAL_GATEWAY_BASE = process.env.RAILWAY_GATEWAY_BASE_URL;
const ORIGINAL_SHARED_KEY = process.env.FILE_GATEWAY_SHARED_KEY;

test.afterEach(() => {
  if (ORIGINAL_UPLOAD_MODE === undefined) delete process.env.UPLOAD_MODE;
  else process.env.UPLOAD_MODE = ORIGINAL_UPLOAD_MODE;
  if (ORIGINAL_GATEWAY_BASE === undefined) delete process.env.RAILWAY_GATEWAY_BASE_URL;
  else process.env.RAILWAY_GATEWAY_BASE_URL = ORIGINAL_GATEWAY_BASE;
  if (ORIGINAL_SHARED_KEY === undefined) delete process.env.FILE_GATEWAY_SHARED_KEY;
  else process.env.FILE_GATEWAY_SHARED_KEY = ORIGINAL_SHARED_KEY;
});

test('getStorageBackend maps railway_proxy to railway_gateway', () => {
  process.env.UPLOAD_MODE = 'railway_proxy';
  assert.equal(uploadStoragePolicy.getStorageBackend(), 'railway_gateway');
  delete process.env.UPLOAD_MODE;
  assert.equal(uploadStoragePolicy.getStorageBackend(), 'local');
});

test('assertRailwayGatewayReady throws when URL or shared key missing', () => {
  process.env.UPLOAD_MODE = 'railway_proxy';
  delete process.env.RAILWAY_GATEWAY_BASE_URL;
  delete process.env.FILE_GATEWAY_SHARED_KEY;
  assert.throws(() => uploadStoragePolicy.assertRailwayGatewayReady(), /RAILWAY_GATEWAY_BASE_URL/);

  process.env.RAILWAY_GATEWAY_BASE_URL = 'https://example.test/';
  assert.throws(() => uploadStoragePolicy.assertRailwayGatewayReady(), /FILE_GATEWAY_SHARED_KEY/);
});

test('normalizeReference rejects bare disk paths in railway_proxy mode', () => {
  process.env.UPLOAD_MODE = 'railway_proxy';
  process.env.RAILWAY_GATEWAY_BASE_URL = 'https://example.test/';
  process.env.FILE_GATEWAY_SHARED_KEY = 'test-key';
  assert.throws(
    () => uploadStorageService.normalizeReference('C:\\temp\\not-uploads.docx'),
    /must be an \/uploads\/ URL/
  );
});

test('allowLocalUploadFallback is false in railway_proxy mode', () => {
  process.env.UPLOAD_MODE = 'railway_proxy';
  assert.equal(uploadStoragePolicy.allowLocalUploadFallback(), false);
  assert.equal(uploadStoragePolicy.preferRemoteUploadReads(), true);
  delete process.env.UPLOAD_MODE;
  assert.equal(uploadStoragePolicy.allowLocalUploadFallback(), true);
  assert.equal(uploadStoragePolicy.preferRemoteUploadReads(), false);
});

test('preferRemoteUploadReads is true for s3 mode', () => {
  process.env.UPLOAD_MODE = 's3';
  assert.equal(uploadStoragePolicy.getStorageBackend(), 's3');
  assert.equal(uploadStoragePolicy.preferRemoteUploadReads(), true);
  assert.equal(uploadStoragePolicy.allowLocalUploadFallback(), false);
  assert.throws(() => uploadStoragePolicy.assertS3BackendReady(), /not configured yet/);
});

test('app.js serves public uploads from remote before local disk lookup', () => {
  const appSource = fs.readFileSync(path.join(process.cwd(), 'app.js'), 'utf8');
  const remoteIdx = appSource.indexOf('shouldServePublicUploadsFromRemoteOnly');
  const localIdx = appSource.indexOf('resolveExistingUploadDiskPath');
  assert.ok(remoteIdx > 0, 'app.js should use uploadPublicRoutePolicy');
  assert.ok(localIdx > remoteIdx, 'local disk resolve must come after remote-only branch');
});

test('MVC controllers do not resolve upload paths on disk directly', () => {
  const controllersDir = path.join(process.cwd(), 'MVC', 'controllers');
  const forbidden = /resolveExistingUploadDiskPath|readLocalUploadIfPresent/;
  const stack = [controllersDir];
  while (stack.length) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.js')) {
        const rel = path.relative(process.cwd(), full).split(path.sep).join('/');
        if (rel.includes('internal/fileGatewayController')) return;
        const content = fs.readFileSync(full, 'utf8');
        assert.equal(
          forbidden.test(content),
          false,
          `${rel} must not call low-level local upload disk helpers`
        );
      }
    });
  }
});

test('readLocalUploadIfPresent is only defined in fileGatewayClientService', () => {
  const gatewayPath = path.join(process.cwd(), 'MVC', 'services', 'fileGatewayClientService.js');
  const gatewaySource = fs.readFileSync(gatewayPath, 'utf8');
  assert.match(gatewaySource, /async function readLocalUploadIfPresent/);
  const servicesDir = path.join(process.cwd(), 'MVC', 'services');
  fs.readdirSync(servicesDir).forEach((name) => {
    if (!name.endsWith('.js') || name === 'fileGatewayClientService.js') return;
    const content = fs.readFileSync(path.join(servicesDir, name), 'utf8');
    assert.equal(
      content.includes('readLocalUploadIfPresent('),
      false,
      `MVC/services/${name} must not call readLocalUploadIfPresent`
    );
  });
});

test('shouldServePublicUploadsFromRemoteOnly tracks railway_proxy', () => {
  process.env.UPLOAD_MODE = 'railway_proxy';
  assert.equal(shouldServePublicUploadsFromRemoteOnly(), true);
  delete process.env.UPLOAD_MODE;
  assert.equal(shouldServePublicUploadsFromRemoteOnly(), false);
});

test('fileAssetStorage readBuffer rejects non-upload refs in railway_proxy mode', async () => {
  process.env.UPLOAD_MODE = 'railway_proxy';
  process.env.RAILWAY_GATEWAY_BASE_URL = 'https://example.test/';
  process.env.FILE_GATEWAY_SHARED_KEY = 'test-key';
  const fileAssetStorage = require('../MVC/services/fileAssetStorageService');
  await assert.rejects(
    () => fileAssetStorage.readBuffer('C:\\temp\\secret.docx'),
    /must be an \/uploads\/ URL/
  );
});

test('coreFilesService getStoredFileUrl does not mint URL from multer path in railway_proxy', () => {
  process.env.UPLOAD_MODE = 'railway_proxy';
  const coreFilesService = require('../MVC/services/coreFilesService');
  const url = coreFilesService.getStoredFileUrl({
    path: path.join(process.cwd(), 'uploads', 'GLOBAL', 'x.png')
  });
  assert.equal(url, '');
});
