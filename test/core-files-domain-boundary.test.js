const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TARGET_FILES = [
  'MVC/controllers/pte/studentController.js',
  'MVC/controllers/pte/questionBankController.js',
  'MVC/controllers/pte/practiceController.js',
  'MVC/controllers/pte/mockExamController.js',
  'MVC/services/pte/pteAttemptLedgerService.js',
  'MVC/controllers/newsController.js',
  'MVC/controllers/chatController.js',
  'MVC/controllers/emailManagementController.js',
  'MVC/controllers/systemSettingsController.js'
];

const FORBIDDEN_PATTERNS = [
  /require\(['"]\.\.\/\.\.\/utils\/pathResolver['"]\)/,
  /require\(['"]\.\.\/utils\/pathResolver['"]\)/,
  /gatewayListDirectory/,
  /gatewayDeleteByUploadUrl/,
  /gatewayUploadFile/
];

test('domain-facing modules consume coreFilesService instead of low-level file infra', () => {
  TARGET_FILES.forEach((relativePath) => {
    const fullPath = path.join(process.cwd(), relativePath);
    const content = fs.readFileSync(fullPath, 'utf8');

    FORBIDDEN_PATTERNS.forEach((pattern) => {
      assert.equal(
        pattern.test(content),
        false,
        `${relativePath} still contains forbidden dependency: ${pattern}`
      );
    });

    assert.equal(
      /coreFilesService/.test(content),
      true,
      `${relativePath} should reference coreFilesService`
    );
  });
});

test('core file service does not import package-specific upload utilities', () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'MVC/services/coreFilesService.js'), 'utf8');

  assert.equal(
    /pteUploadPathUtils/.test(content),
    false,
    'coreFilesService should resolve package upload categories through the upload category resolver registry.'
  );
});
