const test = require('node:test');
const assert = require('node:assert/strict');

const uploadModeUtils = require('../MVC/utils/uploadModeUtils');

const ORIGINAL_UPLOAD_MODE = process.env.UPLOAD_MODE;
const ORIGINAL_GATEWAY_BASE = process.env.RAILWAY_GATEWAY_BASE_URL;

test.afterEach(() => {
  if (ORIGINAL_UPLOAD_MODE === undefined) delete process.env.UPLOAD_MODE;
  else process.env.UPLOAD_MODE = ORIGINAL_UPLOAD_MODE;
  if (ORIGINAL_GATEWAY_BASE === undefined) delete process.env.RAILWAY_GATEWAY_BASE_URL;
  else process.env.RAILWAY_GATEWAY_BASE_URL = ORIGINAL_GATEWAY_BASE;
});

test('shouldPersistUploadsViaRemoteGateway is false in local upload mode', () => {
  delete process.env.UPLOAD_MODE;
  delete process.env.RAILWAY_GATEWAY_BASE_URL;
  assert.equal(uploadModeUtils.getUploadMode(), 'local');
  assert.equal(uploadModeUtils.shouldPersistUploadsViaRemoteGateway(), false);
});

test('shouldPersistUploadsViaRemoteGateway is true in railway_proxy even without gateway base URL', () => {
  process.env.UPLOAD_MODE = 'railway_proxy';
  delete process.env.RAILWAY_GATEWAY_BASE_URL;
  assert.equal(uploadModeUtils.shouldPersistUploadsViaRemoteGateway(), true);
});

test('shouldPersistUploadsViaRemoteGateway is true when railway_proxy and gateway base URL are set', () => {
  process.env.UPLOAD_MODE = 'railway_proxy';
  process.env.RAILWAY_GATEWAY_BASE_URL = 'https://equportal.app/';
  assert.equal(uploadModeUtils.shouldPersistUploadsViaRemoteGateway(), true);
});
