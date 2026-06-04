const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageBuilderService = require('../MVC/services/systemSettingsPackageBuilderService');

const ROOT_DIR = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8'));
}

test('BenchPath package pass6 builder supports live manifest generation', async () => {
  const manifest = readJson('packages/benchpath/package.manifest.json');
  const sectionRows = readJson('data/sections.json');
  const symbolRows = readJson('data/symbols.json');
  const service = packageBuilderService.createService({
    dataService: {
      async fetchData(entityType) {
        if (entityType === 'sections') return sectionRows;
        if (entityType === 'symbols') return symbolRows;
        return [];
      }
    }
  });

  const result = await service.generateLivePackageManifest({
    packageId: 'benchpath',
    packageName: 'BenchPath',
    manifest
  }, { backendMode: 'json' });

  assert.equal(result.manifest.id, 'benchpath');
  assert.equal(result.manifest.sections.length, 15);
  assert.equal(result.manifest.symbols.length, 15);
  assert.equal(result.summary.generatedCounts.sections, 15);
  assert.equal(result.summary.generatedCounts.symbols, 15);
});

test('BenchPath package pass6 builder UI exposes live manifest mode', () => {
  const serviceSource = fs.readFileSync(path.join(ROOT_DIR, 'MVC/services/systemSettingsPackageBuilderService.js'), 'utf8');
  const viewSource = fs.readFileSync(path.join(ROOT_DIR, 'MVC/views/systemSettings/packageBuilderSettings.ejs'), 'utf8');

  assert.match(serviceSource, /'benchpath'/);
  assert.match(serviceSource, /BenchPath packages only/);
  assert.match(viewSource, /\['school', 'pte', 'ielts', 'benchpath'\]/);
});
