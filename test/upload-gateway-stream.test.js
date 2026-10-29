const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPublicGatewayUploadUrlFromRequest,
  shouldRedirectRemoteUploadRead
} = require('../MVC/services/uploadGatewayStreamService');

const ORIGINAL_GATEWAY_BASE = process.env.RAILWAY_GATEWAY_BASE_URL;
const ORIGINAL_READ_MODE = process.env.UPLOAD_REMOTE_READ_MODE;

test.afterEach(() => {
  if (ORIGINAL_GATEWAY_BASE === undefined) delete process.env.RAILWAY_GATEWAY_BASE_URL;
  else process.env.RAILWAY_GATEWAY_BASE_URL = ORIGINAL_GATEWAY_BASE;
  if (ORIGINAL_READ_MODE === undefined) delete process.env.UPLOAD_REMOTE_READ_MODE;
  else process.env.UPLOAD_REMOTE_READ_MODE = ORIGINAL_READ_MODE;
});

test('buildPublicGatewayUploadUrlFromRequest maps /uploads paths to gateway host', () => {
  process.env.RAILWAY_GATEWAY_BASE_URL = 'https://equportal.app/';
  const url = buildPublicGatewayUploadUrlFromRequest({
    originalUrl: '/uploads/ORG_900000/school/books/BK1/cover/cover%20photo.jpg'
  });
  assert.equal(
    url,
    'https://equportal.app/uploads/ORG_900000/school/books/BK1/cover/cover%20photo.jpg'
  );
});

test('shouldRedirectRemoteUploadRead defaults to redirect unless proxy mode is set', () => {
  delete process.env.UPLOAD_REMOTE_READ_MODE;
  assert.equal(shouldRedirectRemoteUploadRead(), true);
  process.env.UPLOAD_REMOTE_READ_MODE = 'proxy';
  assert.equal(shouldRedirectRemoteUploadRead(), false);
});
