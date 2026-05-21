const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

const fileController = require('../MVC/controllers/fileController');
const settingService = require('../MVC/services/settingService');
const adminAuthorityService = require('../MVC/services/adminAuthorityService');

const TEST_UPLOAD_ROOT = path.join(process.cwd(), 'tmp', 'file-manager-bulk-transfer-test-uploads');
const ORIGINAL_GET_VALUE = settingService.getValue;
const ORIGINAL_UPLOAD_MODE = process.env.UPLOAD_MODE;
const ORIGINAL_IS_ADMIN_FOR_REQUEST = adminAuthorityService.isAdminForRequest;
const ORIGINAL_IS_SUPER_ADMIN = adminAuthorityService.isSuperAdmin;

function createReq(overrides = {}) {
  return {
    query: {},
    body: {},
    headers: {
      'x-ajax-request': 'true',
      accept: 'application/json'
    },
    user: {
      id: 'USER_TEST',
      activeOrgId: '42'
    },
    ...overrides
  };
}

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    redirectPath: '',
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    redirect(pathValue) {
      this.redirectPath = String(pathValue || '');
      return this;
    },
    render(view, payload) {
      this.renderView = view;
      this.payload = payload;
      return this;
    }
  };
}

async function resetUploadsFixture() {
  await fs.rm(TEST_UPLOAD_ROOT, { recursive: true, force: true });
  await fs.mkdir(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'source', 'folder1'), { recursive: true });
  await fs.mkdir(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'target'), { recursive: true });
  await fs.mkdir(path.join(TEST_UPLOAD_ROOT, 'ORG_42', 'orgdocs'), { recursive: true });
  await fs.writeFile(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'source', 'a.txt'), 'A');
  await fs.writeFile(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'source', 'b.txt'), 'B');
  await fs.writeFile(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'source', 'folder1', 'nested.txt'), 'nested');
  await fs.writeFile(path.join(TEST_UPLOAD_ROOT, 'ORG_42', 'orgdocs', 'orgfile.txt'), 'org');
}

test.beforeEach(async () => {
  process.env.UPLOAD_MODE = 'local';
  settingService.getValue = (section, key) => {
    if (section === 'app' && key === 'uploadsPath') return TEST_UPLOAD_ROOT;
    if (section === 'app' && key === 'defaultPageSize') return '30';
    return ORIGINAL_GET_VALUE.call(settingService, section, key);
  };
  adminAuthorityService.isAdminForRequest = () => true;
  adminAuthorityService.isSuperAdmin = () => false;
  await resetUploadsFixture();
});

test.afterEach(async () => {
  settingService.getValue = ORIGINAL_GET_VALUE;
  adminAuthorityService.isAdminForRequest = ORIGINAL_IS_ADMIN_FOR_REQUEST;
  adminAuthorityService.isSuperAdmin = ORIGINAL_IS_SUPER_ADMIN;
  if (ORIGINAL_UPLOAD_MODE === undefined) delete process.env.UPLOAD_MODE;
  else process.env.UPLOAD_MODE = ORIGINAL_UPLOAD_MODE;
  await fs.rm(TEST_UPLOAD_ROOT, { recursive: true, force: true });
});

test('bulk copy returns success summary and itemized results', async () => {
  const req = createReq({
    body: {
      destinationPath: 'GLOBAL/target',
      sourcePathsJson: JSON.stringify(['GLOBAL/source/a.txt', 'GLOBAL/source/b.txt'])
    }
  });
  const res = createRes();

  await fileController.copyItem(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.status, 'success');
  assert.deepEqual(res.payload?.summary, {
    requested: 2,
    succeeded: 2,
    failed: 0,
    operation: 'copy'
  });
  assert.equal(Array.isArray(res.payload?.results), true);
  assert.equal(res.payload.results.length, 2);
  assert.ok(res.payload.results.every((row) => row.status === 'success'));
  await assert.doesNotReject(fs.access(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'target', 'a.txt')));
  await assert.doesNotReject(fs.access(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'target', 'b.txt')));
});

test('mixed-validity batch copy continues and returns partial summary', async () => {
  const req = createReq({
    body: {
      destinationPath: 'GLOBAL/target',
      sourcePathsJson: JSON.stringify(['GLOBAL/source/a.txt', 'GLOBAL/missing.txt', 'GLOBAL/../secret.txt'])
    }
  });
  const res = createRes();

  await fileController.copyItem(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.status, 'partial');
  assert.deepEqual(res.payload?.summary, {
    requested: 3,
    succeeded: 1,
    failed: 2,
    operation: 'copy'
  });
  assert.equal(Array.isArray(res.payload?.results), true);
  assert.ok(res.payload.results.some((row) => row.status === 'error'));
  await assert.doesNotReject(fs.access(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'target', 'a.txt')));
});

test('legacy single sourcePath copy contract still works', async () => {
  const req = createReq({
    body: {
      sourcePath: 'GLOBAL/source/b.txt',
      destinationPath: 'GLOBAL/target'
    }
  });
  const res = createRes();

  await fileController.copyItem(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.status, 'success');
  assert.equal(res.payload?.summary, undefined);
  assert.equal(res.payload?.finalName, 'b.txt');
  await assert.doesNotReject(fs.access(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'target', 'b.txt')));
});

test('bulk move handles files and folders sequentially', async () => {
  const req = createReq({
    body: {
      destinationPath: 'GLOBAL/target',
      sourcePathsJson: JSON.stringify(['GLOBAL/source/a.txt', 'GLOBAL/source/folder1'])
    }
  });
  const res = createRes();

  await fileController.moveItem(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.status, 'success');
  assert.deepEqual(res.payload?.summary, {
    requested: 2,
    succeeded: 2,
    failed: 0,
    operation: 'move'
  });
  await assert.rejects(fs.access(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'source', 'a.txt')));
  await assert.rejects(fs.access(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'source', 'folder1')));
  await assert.doesNotReject(fs.access(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'target', 'a.txt')));
  await assert.doesNotReject(fs.access(path.join(TEST_UPLOAD_ROOT, 'GLOBAL', 'target', 'folder1', 'nested.txt')));
});

test('folder-library returns drive and folder navigation payload', async () => {
  const req = createReq({
    query: { path: 'GLOBAL/source' }
  });
  const res = createRes();

  await fileController.listFolderLibrary(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.status, 'success');
  assert.equal(res.payload?.currentPath, 'GLOBAL/source');
  assert.equal(res.payload?.parentPath, 'GLOBAL');
  assert.equal(Array.isArray(res.payload?.drives), true);
  assert.ok(res.payload.drives.some((drive) => drive.id === 'GLOBAL'));
  assert.ok(res.payload.drives.some((drive) => drive.id === 'ORG_42'));
  assert.ok(Array.isArray(res.payload?.folders));
  assert.ok(res.payload.folders.some((folder) => folder.path === 'GLOBAL/source/folder1'));
});

test('folder-library rejects traversal paths safely', async () => {
  const req = createReq({
    query: { path: 'GLOBAL/../outside' }
  });
  const res = createRes();

  await fileController.listFolderLibrary(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload?.status, 'error');
  assert.match(String(res.payload?.message || ''), /(Security|Invalid|Access Denied)/i);
});
