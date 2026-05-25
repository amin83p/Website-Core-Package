const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const serviceDir = path.join(ROOT_DIR, 'packages/pte/MVC/services/pte');

const authorizedDeepImportServices = new Set([
  'pteAnswerShortQuestionScoringService.js',
  'pteAttemptLedgerService.js',
  'pteCoreDependencies.js',
  'pteCoreDependenciesCoreAdapter.js',
  'pteDescribeImageScoringService.js',
  'pteMockExamDataService.js',
  'ptePublicPackageDataService.js',
  'ptePublicPageSettingsDataService.js',
  'pteQuestionScoringProfileService.js',
  'pteRouteCoreDependencies.js',
  'pteScoringArtifactReader.js',
  'pteScoringDefaultsDataService.js',
  'pteStudentDataService.js',
  'pteTeacherDataService.js',
  'pteTestDataService.js'
]);

const shimPattern = /^\s*module\.exports\s*=\s*require\(['"]\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/MVC\/services\/pte\/[^'"]+['"]\)\s*;?\s*$/;
const deepImportPatterns = [
  '../../../../../MVC/',
  '../../../../MVC/',
  '../../../../config/'
];

test('PTE package service files should avoid unauthorized deep core imports', () => {
  const files = fs.readdirSync(serviceDir).filter((name) => name.endsWith('.js')).sort();

  files.forEach((fileName) => {
    const fullPath = path.join(serviceDir, fileName);
    const source = fs.readFileSync(fullPath, 'utf8');

    const hasDeepImport = deepImportPatterns.some((token) => source.includes(token));
    if (!hasDeepImport) return;

    if (authorizedDeepImportServices.has(fileName)) return;

    const isDomainShim = shimPattern.test(source.trim());
    assert.equal(
      isDomainShim,
      true,
      `${fileName} contains deep core imports. Replace with package-local adapter/dependencies or use an expected service shim pattern.`
    );
  });
});
