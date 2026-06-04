const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageManifestService = require('../MVC/services/packageManifestService');

const ROOT_DIR = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'packages/ielts/package.manifest.json');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8'));
}

test('IELTS package pass9 manifest validates with seeded declaration catalogs', () => {
  const manifest = packageManifestService.validatePackageManifest(
    JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')),
    { knownIds: [] }
  );

  assert.equal(manifest.id, 'ielts');
  assert.equal(manifest.sections.length, 16);
  assert.equal(manifest.symbols.length, 14);
  assert.equal(manifest.dataEntities.length, 6);
});

test('IELTS package pass9 sections match root IELTS section catalog', () => {
  const manifest = readJson('packages/ielts/package.manifest.json');
  const rootSections = readJson('data/sections.json')
    .filter((row) => String(row?.category || '').toUpperCase() === 'IELTS' || String(row?.name || '').startsWith('IELTS'))
    .map((row) => String(row.name || '').trim())
    .filter(Boolean)
    .sort();

  assert.deepEqual((manifest.sections || []).map((row) => row.name).sort(), rootSections);
  assert.ok((manifest.sections || []).some((row) => row.name === 'IELTS'));
  assert.ok((manifest.sections || []).some((row) => row.name === 'IELTS_SCORING_PIPELINES'));
});

test('IELTS package pass9 symbols match root IELTS symbol catalog', () => {
  const manifest = readJson('packages/ielts/package.manifest.json');
  const rootSymbols = readJson('data/symbols.json')
    .filter((row) => {
      const tags = Array.isArray(row?.tags) ? row.tags : [];
      return String(row?.name || '').startsWith('IELTS') || tags.includes('IELTS');
    })
    .map((row) => String(row.name || '').trim())
    .filter(Boolean)
    .sort();

  assert.deepEqual((manifest.symbols || []).map((row) => row.name).sort(), rootSymbols);
  assert.ok((manifest.symbols || []).some((row) => row.name === 'IELTS'));
});

test('IELTS package pass9 data entities describe runtime data without package-local payload', () => {
  const manifest = readJson('packages/ielts/package.manifest.json');
  const entityTypes = (manifest.dataEntities || []).map((row) => row.entityType).sort();

  assert.deepEqual(entityTypes, [
    'aiTokenUsages',
    'apiProviders',
    'microAssessments',
    'prompts',
    'scoringHistory',
    'task2Samples'
  ].sort());
  (manifest.dataEntities || []).forEach((row) => {
    assert.match(String(row.source || ''), /^data\/ielts\//);
    assert.match(String(row.storageTarget || ''), /^data\/ielts\//);
    assert.doesNotMatch(String(row.source || ''), /^packages\/ielts\/data/);
  });
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'packages/ielts/data')), false);
});
