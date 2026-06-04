const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const MODELS_DIR = path.join(ROOT_DIR, 'packages/ielts/MVC/models/ielts');

const EXPECTED_MODELS = [
  'aiTokenUsageModel.js',
  'apiProviderModel.js',
  'assessmentSessionModel.js',
  'microAssessmentModel.js',
  'promptModel.js',
  'scoringSessionModel.js',
  'task2SampleModel.js'
];

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('IELTS package pass6 owns package model files', () => {
  EXPECTED_MODELS.forEach((name) => {
    const packagePath = path.join(MODELS_DIR, name);
    assert.equal(fs.existsSync(packagePath), true, `${name} should exist in package models`);
    const source = read(packagePath);
    assert.match(source, /ieltsCoreModuleResolver/, `${name} should use the package resolver`);
    assert.match(source, /resolveCoreRoot\(\)/, `${name} should resolve app-level runtime data through core root`);
    assert.doesNotMatch(source, /\.\.\/\.\.\/\.\.\/data\/ielts/);
    assert.doesNotMatch(source, /path\.join\(__dirname,\s*['"][^'"]*data\/ielts/);
  });
});

test('IELTS package pass6 package models can be required', () => {
  EXPECTED_MODELS.forEach((name) => {
    const model = require(path.join(MODELS_DIR, name));
    assert.equal(typeof model, 'object', `${name} should export model API`);
  });
});

test('IELTS package pass6 keeps runtime data outside package source', () => {
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'data/ielts')), true);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'packages/ielts/data')), false);
});
