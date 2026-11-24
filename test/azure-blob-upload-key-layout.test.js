const test = require('node:test');
const assert = require('node:assert/strict');

const azureBlob = require('../MVC/services/azureBlobUploadClientService');
const { installUploadModeTestIsolation, setAppUploadStubs } = require('./helpers/uploadModeTestIsolation');

installUploadModeTestIsolation(test);

test('normalizeScopeKey maps GLOBAL and org ids', () => {
  assert.equal(azureBlob.normalizeScopeKey('GLOBAL'), 'GLOBAL');
  assert.equal(azureBlob.normalizeScopeKey('ORG_42'), '42');
  assert.equal(azureBlob.normalizeScopeKey('42'), '42');
});

test('scopeFolder builds GLOBAL and ORG_* folder tokens', () => {
  assert.equal(azureBlob.scopeFolder('GLOBAL'), 'GLOBAL');
  assert.equal(azureBlob.scopeFolder('ORG_7'), 'ORG_7');
  assert.equal(azureBlob.scopeFolder('7'), 'ORG_7');
});

test('uploadsUrlForParts builds canonical /uploads paths', () => {
  assert.equal(
    azureBlob.uploadsUrlForParts('GLOBAL', 'reports', 'sample.docx'),
    '/uploads/GLOBAL/reports/sample.docx'
  );
  assert.equal(
    azureBlob.uploadsUrlForParts('42', 'students', 'id.pdf'),
    '/uploads/ORG_42/students/id.pdf'
  );
});

test('parseUploadUrl extracts scope, dir, and file name', () => {
  const parsed = azureBlob.parseUploadUrl('/uploads/ORG_900000/reports/sample.docx');
  assert.ok(parsed);
  assert.equal(parsed.scopeKey, '900000');
  assert.equal(parsed.relativeDir, 'reports');
  assert.equal(parsed.fileName, 'sample.docx');
  assert.equal(parsed.uploadUrl, '/uploads/ORG_900000/reports/sample.docx');
});

test('buildBlobKey mirrors upload layout without prefix', () => {
  setAppUploadStubs({ azureBlobPrefix: '' });
  const key = azureBlob.buildBlobKey('GLOBAL', 'misc/logos', 'logo.png');
  assert.equal(key, 'GLOBAL/misc/logos/logo.png');
});

test('buildBlobKey includes configurable prefix', () => {
  setAppUploadStubs({ azureBlobPrefix: 'prod' });
  const key = azureBlob.buildBlobKey('42', 'reports', 'r.docx');
  assert.equal(key, 'prod/ORG_42/reports/r.docx');
});

test('buildBlobKeyFromUploadUrl round-trips standard refs', () => {
  setAppUploadStubs({ azureBlobPrefix: 'staging' });
  const url = '/uploads/GLOBAL/imports/file.csv';
  const key = azureBlob.buildBlobKeyFromUploadUrl(url);
  assert.equal(key, 'staging/GLOBAL/imports/file.csv');
});

test('parseUploadUrl rejects non-upload paths', () => {
  assert.equal(azureBlob.parseUploadUrl('C:\\temp\\x.bin'), null);
  assert.equal(azureBlob.parseUploadUrl('/not-uploads/x'), null);
});