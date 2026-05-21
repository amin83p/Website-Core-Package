const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

const systemSettingsController = require('../MVC/controllers/systemSettingsController');
const settingService = require('../MVC/services/settingService');

const TEST_UPLOAD_ROOT = path.join(process.cwd(), 'tmp', 'public-page-media-test-uploads');
const ACTIVE_ORG_ID = '42';
const ACTIVE_ORG_SCOPE = `ORG_${ACTIVE_ORG_ID}`;
const ORIGINAL_GET_VALUE = settingService.getValue;
const ORIGINAL_UPLOAD_MODE = process.env.UPLOAD_MODE;

function createReq(overrides = {}) {
  return {
    query: {},
    body: {},
    files: [],
    headers: { accept: 'application/json' },
    user: { id: 'USER_TEST', activeOrgId: ACTIVE_ORG_SCOPE },
    ...overrides
  };
}

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

async function resetTestUploads() {
  await fs.rm(TEST_UPLOAD_ROOT, { recursive: true, force: true });
  await fs.mkdir(path.join(TEST_UPLOAD_ROOT, ACTIVE_ORG_SCOPE, 'misc', 'public-pages', 'gallery'), { recursive: true });
  await fs.mkdir(path.join(TEST_UPLOAD_ROOT, ACTIVE_ORG_SCOPE, 'misc', 'public-pages-staging'), { recursive: true });
  await fs.writeFile(path.join(TEST_UPLOAD_ROOT, ACTIVE_ORG_SCOPE, 'misc', 'public-pages', 'hero image.png'), 'image');
  await fs.mkdir(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'misc', 'public-pages', 'gallery'), { recursive: true });
  await fs.mkdir(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'misc', 'public-pages-staging'), { recursive: true });
  await fs.writeFile(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'misc', 'public-pages', 'hero-global.png'), 'image');
}

test.beforeEach(async () => {
  process.env.UPLOAD_MODE = 'local';
  settingService.getValue = (section, key) => {
    if (section === 'app' && key === 'uploadsPath') return TEST_UPLOAD_ROOT;
    if (section === 'app' && key === 'defaultPageSize') return '25';
    if (section === 'app' && key === 'uploadFolders') return {};
    return ORIGINAL_GET_VALUE.call(settingService, section, key);
  };
  await resetTestUploads();
});

test.afterEach(async () => {
  settingService.getValue = ORIGINAL_GET_VALUE;
  if (ORIGINAL_UPLOAD_MODE === undefined) delete process.env.UPLOAD_MODE;
  else process.env.UPLOAD_MODE = ORIGINAL_UPLOAD_MODE;
  await fs.rm(TEST_UPLOAD_ROOT, { recursive: true, force: true });
});

test('public page media library returns active-org public-pages files and folders', async () => {
  const req = createReq();
  const res = createRes();

  await systemSettingsController.listPublicPageMediaLibrary(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.status, 'success');
  assert.equal(res.payload?.currentFolder, 'misc/public-pages');
  assert.equal(res.payload?.defaultFolder, 'misc/public-pages');
  assert.equal(res.payload?.scopeFolder, ACTIVE_ORG_SCOPE);
  assert.equal(res.payload?.defaults?.pageSize, 25);
  assert.ok(res.payload?.folders?.some((folder) => folder.name === 'gallery' && folder.path === 'misc/public-pages/gallery'));

  const heroRow = res.payload?.results?.find((row) => row.filename === 'hero image.png');
  assert.ok(heroRow, 'expected hero image row');
  assert.equal(heroRow.path, `/uploads/${ACTIVE_ORG_SCOPE}/misc/public-pages/hero image.png`);
  assert.equal(heroRow.url, `/uploads/${ACTIVE_ORG_SCOPE}/misc/public-pages/hero%20image.png`);
  assert.equal(heroRow.source, 'public_page_library');
});

test('public page media library can browse the active-org upload root explicitly', async () => {
  const req = createReq({ query: { folder: '' } });
  const res = createRes();

  await systemSettingsController.listPublicPageMediaLibrary(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.status, 'success');
  assert.equal(res.payload?.currentFolder, '');
  assert.equal(res.payload?.defaultFolder, 'misc/public-pages');
  assert.ok(res.payload?.folders?.some((folder) => folder.name === 'misc' && folder.path === 'misc'));
});

test('public page media library can browse storage ancestors', async () => {
  const req = createReq({ query: { folder: 'misc' } });
  const res = createRes();

  await systemSettingsController.listPublicPageMediaLibrary(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.status, 'success');
  assert.equal(res.payload?.currentFolder, 'misc');
  assert.equal(res.payload?.parentFolder, '');
  assert.ok(res.payload?.folders?.some((folder) => folder.name === 'public-pages' && folder.path === 'misc/public-pages'));
});

test('public page media library accepts full storage paths', async () => {
  const req = createReq({ query: { folder: 'misc/public-pages/gallery' } });
  const res = createRes();

  await systemSettingsController.listPublicPageMediaLibrary(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.status, 'success');
  assert.equal(res.payload?.currentFolder, 'misc/public-pages/gallery');
  assert.equal(res.payload?.parentFolder, 'misc/public-pages');
});

test('public page media library rejects traversal outside the public-pages folder', async () => {
  const req = createReq({ query: { folder: '../secret' } });
  const res = createRes();

  await systemSettingsController.listPublicPageMediaLibrary(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload?.status, 'error');
  assert.match(String(res.payload?.message || ''), /Invalid media folder path/i);
});

test('public page media upload rows return usable uploads URLs', async () => {
  const filePath = path.join(TEST_UPLOAD_ROOT, ACTIVE_ORG_SCOPE, 'misc', 'public-pages-staging', 'Card_1.png');
  await fs.writeFile(filePath, 'image');
  const req = createReq({
    files: [
      {
        originalname: 'Card.png',
        filename: 'Card_1.png',
        path: filePath,
        mimetype: 'image/png',
        size: 5
      }
    ]
  });
  const res = createRes();

  await systemSettingsController.uploadPublicPageMedia(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.status, 'success');
  assert.equal(res.payload?.results?.length, 1);
  assert.equal(res.payload.results[0].path, `/uploads/${ACTIVE_ORG_SCOPE}/misc/public-pages/Card.png`);
  assert.equal(res.payload.results[0].url, `/uploads/${ACTIVE_ORG_SCOPE}/misc/public-pages/Card.png`);
  assert.equal(res.payload.results[0].source, 'public_page_upload');
  await assert.rejects(fs.access(filePath));
  await assert.doesNotReject(fs.access(path.join(TEST_UPLOAD_ROOT, ACTIVE_ORG_SCOPE, 'misc', 'public-pages', 'Card.png')));
});

test('public page media upload stores files in the requested current folder', async () => {
  const filePath = path.join(TEST_UPLOAD_ROOT, ACTIVE_ORG_SCOPE, 'misc', 'public-pages-staging', 'Gallery_Card.png');
  await fs.writeFile(filePath, 'image');
  const req = createReq({
    body: { folder: 'misc/public-pages/gallery' },
    files: [
      {
        originalname: 'Gallery Card.png',
        filename: 'Gallery_Card.png',
        path: filePath,
        mimetype: 'image/png',
        size: 5
      }
    ]
  });
  const res = createRes();

  await systemSettingsController.uploadPublicPageMedia(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.status, 'success');
  assert.equal(res.payload?.results?.length, 1);
  assert.equal(res.payload.results[0].path, `/uploads/${ACTIVE_ORG_SCOPE}/misc/public-pages/gallery/Gallery Card.png`);
  assert.equal(res.payload.results[0].url, `/uploads/${ACTIVE_ORG_SCOPE}/misc/public-pages/gallery/Gallery%20Card.png`);
  await assert.rejects(fs.access(filePath));
  await assert.doesNotReject(fs.access(path.join(TEST_UPLOAD_ROOT, ACTIVE_ORG_SCOPE, 'misc', 'public-pages', 'gallery', 'Gallery Card.png')));
});

test('public page media library uses GLOBAL scope when active org is SYSTEM', async () => {
  const req = createReq({ user: { id: 'USER_TEST', activeOrgId: 'SYSTEM' } });
  const res = createRes();

  await systemSettingsController.listPublicPageMediaLibrary(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.status, 'success');
  assert.equal(res.payload?.scopeFolder, 'GLOBAL');
  const heroRow = res.payload?.results?.find((row) => row.filename === 'hero-global.png');
  assert.ok(heroRow, 'expected global hero row');
  assert.equal(heroRow.path, '/uploads/GLOBAL/misc/public-pages/hero-global.png');
});
