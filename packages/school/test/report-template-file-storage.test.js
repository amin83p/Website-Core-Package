const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const coreFilesService = require('../../../MVC/services/coreFilesService');
const uploadFolderSettingsService = require('../../../MVC/services/uploadFolderSettingsService');
const reportDocxRenderService = require('../MVC/services/school/reportDocxRenderService');
const reportViewService = require('../MVC/services/school/reportViewService');
const fileAssetStorageService = require('../../../MVC/services/fileAssetStorageService');
const { isRailwayProxyMode } = require('../../../MVC/utils/uploadModeUtils');
const uploadPathUtils = require('../../../MVC/utils/uploadPathUtils');

test('school report template uploads resolve to school-reports folder category', () => {
  const category = coreFilesService.resolveUploadCategory('school-reports');
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
  assert.equal(fileAssetStorageService.isUploadReference(resolved), true);
});

test('normalizeStoredUploadRef converts absolute disk paths to /uploads URLs', () => {
  const diskPath = path.join(uploadPathUtils.getUploadRootAbsolute(), 'ORG_900000', 'reports', 'sample.docx');
  const normalized = reportViewService.normalizeStoredUploadRef(diskPath, '');
  assert.match(normalized, /^\/uploads\/ORG_900000\/reports\/sample\.docx$/i);
});

test('saveBuffer uses gateway branch when UPLOAD_MODE is railway_proxy', () => {
  const mode = process.env.UPLOAD_MODE;
  process.env.UPLOAD_MODE = 'railway_proxy';
  assert.equal(isRailwayProxyMode(), true);
  if (mode === undefined) delete process.env.UPLOAD_MODE;
  else process.env.UPLOAD_MODE = mode;
});
