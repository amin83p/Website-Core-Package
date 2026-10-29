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
    if (!fs.existsSync(fullPath)) return;
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

const SCHOOL_FORBIDDEN_PATTERNS = [
  /MVC\/services\/fileAssetStorageService/,
  /MVC\/services\/fileGatewayClientService/,
  /MVC\/utils\/uploadModeUtils/,
  /MVC\/utils\/pathResolver/
];

const SCHOOL_ALLOWLIST = new Set([
  'packages/school/test/report-template-file-storage.test.js'
]);

function listSchoolJsFiles(dir, acc = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listSchoolJsFiles(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  });
  return acc;
}

test('school package does not import low-level upload infra', () => {
  const schoolRoot = path.join(process.cwd(), 'packages', 'school');
  const files = listSchoolJsFiles(schoolRoot);
  files.forEach((fullPath) => {
    const relative = path.relative(process.cwd(), fullPath).split(path.sep).join('/');
    if (SCHOOL_ALLOWLIST.has(relative)) return;
    const content = fs.readFileSync(fullPath, 'utf8');
    SCHOOL_FORBIDDEN_PATTERNS.forEach((pattern) => {
      assert.equal(
        pattern.test(content),
        false,
        `${relative} must use uploadStorageService only for storage: matched ${pattern}`
      );
    });
    if (/MVC\/services\/coreFilesService/.test(content)) {
      assert.fail(`${relative} must not import coreFilesService; use uploadStorageService instead.`);
    }
  });
});

const BENCHPATH_FORBIDDEN_PATTERNS = SCHOOL_FORBIDDEN_PATTERNS;

function listPackageJsFiles(packageName, acc = []) {
  const root = path.join(process.cwd(), 'packages', packageName);
  if (!fs.existsSync(root)) return acc;
  listSchoolJsFiles(root, acc);
  return acc;
}

test('benchpath package does not import low-level upload infra', () => {
  const files = listPackageJsFiles('benchpath');
  files.forEach((fullPath) => {
    const relative = path.relative(process.cwd(), fullPath).split(path.sep).join('/');
    const content = fs.readFileSync(fullPath, 'utf8');
    BENCHPATH_FORBIDDEN_PATTERNS.forEach((pattern) => {
      assert.equal(
        pattern.test(content),
        false,
        `${relative} must use uploadStorageService only for storage: matched ${pattern}`
      );
    });
    if (/MVC\/services\/fileAssetStorageService/.test(content)) {
      assert.fail(`${relative} must use uploadStorageService instead of fileAssetStorageService.`);
    }
  });
});
