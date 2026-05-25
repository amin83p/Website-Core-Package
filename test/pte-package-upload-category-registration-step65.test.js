const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const coreFilesService = require('../MVC/services/coreFilesService');
const uploadCategoryResolverService = require('../MVC/services/uploadCategoryResolverService');
const uploadFolderSettingsService = require('../MVC/services/uploadFolderSettingsService');
const manifest = require('../packages/pte/package.manifest.json');

const registrationPath = path.join(
  ROOT_DIR,
  'packages/pte/MVC/services/pte/pteUploadCategoryRegistration.js'
);
const pteMainRoutePath = path.join(ROOT_DIR, 'packages/pte/MVC/routes/pteMainRoute.js');

test.beforeEach(() => {
  uploadCategoryResolverService.resetUploadCategoryResolvers();
  uploadFolderSettingsService.registerUploadFolderDefinitions(manifest.uploadFolders || []);
});

test.afterEach(() => {
  uploadCategoryResolverService.resetUploadCategoryResolvers();
});

test('PTE route entrypoint registers package upload category resolvers', () => {
  const source = fs.readFileSync(pteMainRoutePath, 'utf8');

  assert.ok(
    source.includes("require('../services/pte/pteUploadCategoryRegistration')"),
    'PTE route entrypoint should import the upload category registration module.'
  );
  assert.ok(
    source.includes('registerPteUploadCategoryResolvers()'),
    'PTE route entrypoint should register upload category resolvers when loaded.'
  );
});

test('PTE upload category registration resolves legacy upload middleware categories', () => {
  const { registerPteUploadCategoryResolvers } = require(registrationPath);
  registerPteUploadCategoryResolvers();

  assert.equal(uploadCategoryResolverService.hasUploadCategoryResolver('pte-question-bank'), true);
  assert.equal(uploadCategoryResolverService.hasUploadCategoryResolver('pte-students'), true);
  assert.equal(uploadCategoryResolverService.hasUploadCategoryResolver('pte-attempts'), true);

  assert.equal(
    coreFilesService.resolveUploadCategory('pte-question-bank'),
    'PTE/Question_Bank'
  );
  assert.equal(
    coreFilesService.resolveUploadCategory('pte-students', true, {
      body: { studentId: 'STU 1' }
    }),
    'PTE/Students/STU_1'
  );
  assert.equal(
    coreFilesService.resolveUploadCategory('pte-attempts', true, {
      user: { id: 'USER 1' },
      pteStorageContext: {
        bucket: 'mock_exams',
        testName: 'Mock A',
        sessionId: 'SESSION 1',
        itemId: 'ITEM 1'
      }
    }),
    'PTE/Mock_Exams/USER_1/Mock_A/SESSION_1/ITEM_1'
  );
});
