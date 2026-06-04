const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageBuilderModule = require('../MVC/services/systemSettingsPackageBuilderService');

const ROOT_DIR = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8'));
}

function isUploadRef(value = '') {
  return /^\/uploads\//i.test(String(value || '').trim());
}

test('IELTS package pass10 manifest symbol upload refs are GLOBAL scoped', () => {
  const manifest = readJson('packages/ielts/package.manifest.json');
  const uploadSymbols = (manifest.symbols || []).filter((row) => isUploadRef(row.value));

  assert.ok(uploadSymbols.length >= 1, 'IELTS manifest should include at least one symbol upload artifact');
  uploadSymbols.forEach((row) => {
    assert.match(String(row.value || ''), /^\/uploads\/GLOBAL\/symbols\//);
    const relativeFile = String(row.value || '').replace(/^\/uploads\//, 'uploads/');
    assert.equal(fs.existsSync(path.join(ROOT_DIR, relativeFile)), true, `${row.name} symbol asset should exist`);
  });
});

test('IELTS package pass10 package builder preflight detects GLOBAL symbol artifacts only', async () => {
  const manifest = readJson('packages/ielts/package.manifest.json');
  const service = packageBuilderModule.createService({
    dataService: {
      async fetchData(entityType) {
        if (entityType === 'symbols') return manifest.symbols || [];
        return [];
      },
      async getDataById(entityType, id) {
        if (entityType === 'organizations' && id === 'ORG_900000') return { id, name: 'Origin Org' };
        return null;
      }
    },
    packageDataOwnershipService: {
      async listOwnershipByPackage() {
        return [];
      }
    }
  });

  const report = await service.preflightBuild({
    packageId: 'ielts',
    originOrgId: 'ORG_900000',
    selectedDataEntities: [],
    selectedFileRefs: []
  }, {
    backendMode: 'json',
    packageRootDir: path.join(ROOT_DIR, 'packages')
  });

  const symbolRefs = report.filePlan.detectedFromSymbols || [];
  assert.ok(symbolRefs.length >= 1, 'preflight should detect IELTS symbol upload refs');
  symbolRefs.forEach((ref) => {
    assert.match(ref, /^\/uploads\/GLOBAL\/symbols\//);
    assert.doesNotMatch(ref, /^\/uploads\/ORG_/);
  });
  assert.ok(Number(report.filePlan.requiredSymbolAssetCount || 0) >= symbolRefs.length);
});
