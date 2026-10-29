const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const uploadStorageService = require('../../../MVC/services/uploadStorageService');
const uploadFolderSettingsService = require('../../../MVC/services/uploadFolderSettingsService');
const reportDocxRenderService = require('../MVC/services/school/reportDocxRenderService');
const reportViewService = require('../MVC/services/school/reportViewService');
const uploadPathUtils = require('../../../MVC/utils/uploadPathUtils');

test('school report template uploads resolve to school-reports folder category', () => {
  const category = uploadStorageService.resolveUploadCategory('school-reports');
  assert.equal(category, 'school-reports');
});

test('legacy school.reportTemplates setting resolves to reports folder', () => {
  const category = uploadFolderSettingsService.resolveUploadFolder('school.reportTemplates');
  assert.equal(category, 'reports');
});

test('resolveTemplateFilePath keeps /uploads refs for gateway-backed storage', () => {
  const uploadRef = '/uploads/ORG_900000/reports/sample.docx';
  const resolved = reportDocxRenderService.resolveTemplateFilePath({ path: uploadRef });
  assert.equal(resolved, uploadRef);
  assert.equal(uploadStorageService.isUploadReference(resolved), true);
});

test('normalizeStoredUploadRef converts absolute disk paths to /uploads URLs', () => {
  const diskPath = path.join(uploadPathUtils.getUploadRootAbsolute(), 'ORG_900000', 'reports', 'sample.docx');
  const normalized = reportViewService.normalizeStoredUploadRef(diskPath, '');
  assert.match(normalized, /^\/uploads\/ORG_900000\/reports\/sample\.docx$/i);
});

test('upload storage reports railway gateway backend when UPLOAD_MODE is railway_proxy', () => {
  const mode = process.env.UPLOAD_MODE;
  process.env.UPLOAD_MODE = 'railway_proxy';
  assert.equal(uploadStorageService.isRailwayGatewayBackend(), true);
  if (mode === undefined) delete process.env.UPLOAD_MODE;
  else process.env.UPLOAD_MODE = mode;
});
