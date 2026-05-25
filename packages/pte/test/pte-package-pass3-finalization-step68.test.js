const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const manifest = require('../../../packages/pte/package.manifest.json');
const pteAccessConstants = require('../../../packages/pte/config/accessConstants');
const packageQuotaDefinitionService = require('../../../MVC/services/packageQuotaDefinitionService');
const policyService = require('../../../MVC/services/activityQuota/consumptionDefinitionPolicyService');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('PTE package owns the section constants used by package routes', () => {
  const pteSectionNames = manifest.sections
    .map((row) => String(row?.name || '').trim())
    .filter(Boolean);

  pteSectionNames.forEach((sectionName) => {
    assert.equal(pteAccessConstants.PTE_SECTIONS[sectionName], sectionName);
    assert.equal(pteAccessConstants.SECTIONS[sectionName], sectionName);
  });

  assert.equal(pteAccessConstants.SECTIONS.ACTIVITY_QUOTA_CREDIT_CHECK, 'ACTIVITY_QUOTA_CREDIT_CHECK');
  assert.equal(pteAccessConstants.OPERATIONS.AI_SCORING, 'AI_SCORING');
});

test('PTE route dependency boundary uses package access constants', () => {
  const routeDeps = read('packages/pte/MVC/services/pte/pteRouteCoreDependencies.js');
  assert.match(routeDeps, /require\('\.\.\/\.\.\/\.\.\/config\/accessConstants'\)/);
  assert.doesNotMatch(routeDeps, /\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/config\/accessConstants/);

  const controllerPairs = [
    ['MVC/controllers/pte/practiceControllerDependencies.js', 'packages/pte/MVC/controllers/practiceControllerDependencies.js'],
    ['MVC/controllers/pte/feedbackControllerCoreDependencies.js', 'packages/pte/MVC/controllers/feedbackControllerCoreDependencies.js'],
    ['MVC/controllers/pte/infoControllerDependencies.js', 'packages/pte/MVC/controllers/infoControllerDependencies.js'],
    ['MVC/controllers/pte/userDashboardControllerCoreDependencies.js', 'packages/pte/MVC/controllers/userDashboardControllerCoreDependencies.js']
  ];

  controllerPairs.forEach(([rootPath, packagePath]) => {
    const rootSource = read(rootPath);
    assert.match(rootSource, /packages\/pte\/MVC\/controllers\//);

    const packageSource = read(packagePath);
    assert.match(packageSource, /config\/accessConstants/);
  });
});

test('PTE activity quota middleware keys come from package quota declarations', () => {
  const quotaKeys = packageQuotaDefinitionService.buildEnabledQuotaKeys({
    packageRoot: path.join(ROOT_DIR, 'packages')
  });

  assert.ok(quotaKeys.includes('PTE_PRACTICE_BY_SKILLS::AI_SCORING'));
  assert.deepEqual(
    policyService.MIDDLEWARE_ENABLED_KEYS.filter((key) => key.startsWith('PTE_')).sort(),
    quotaKeys.filter((key) => key.startsWith('PTE_')).sort()
  );

  const policySource = read('MVC/services/activityQuota/consumptionDefinitionPolicyService.js');
  assert.doesNotMatch(policySource, /SECTIONS\.PTE_/);
  assert.doesNotMatch(policySource, /PTE_PRACTICE_BY_SKILLS::AI_SCORING/);
});
