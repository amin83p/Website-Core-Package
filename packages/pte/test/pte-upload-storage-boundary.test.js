const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const SCORING_MODULES = [
  'MVC/services/pte/pteScoringArtifactReader.js',
  'MVC/services/pte/pteAnswerShortQuestionScoringService.js',
  'MVC/services/pte/pteDescribeImageScoringService.js',
  'MVC/services/pte/pteMockExamDataService.js'
];

test('PTE student media library lists via uploadStorageService', () => {
  const source = fs.readFileSync(path.join(ROOT, 'MVC/controllers/studentController.js'), 'utf8');
  assert.match(source, /uploadStorage\.listDirectory\(/);
  assert.doesNotMatch(source, /listDirectoryByScope\(/);
});

test('PTE question bank media library lists via uploadStorageService', () => {
  const source = fs.readFileSync(path.join(ROOT, 'MVC/controllers/questionBankController.js'), 'utf8');
  assert.match(source, /uploadStorage\.listDirectory\(/);
  assert.doesNotMatch(source, /listDirectoryByScope\(/);
});

test('PTE attempt ledger cleanup uses uploadStorageService in remote mode', () => {
  const source = fs.readFileSync(path.join(ROOT, 'MVC/services/pte/pteAttemptLedgerService.js'), 'utf8');
  assert.match(source, /uploadStorageService\.deleteByReference/);
  assert.match(source, /uploadStorageService\.deleteRelativePath/);
  assert.match(source, /uploadStorageService\.isRemoteUploadBackend/);
});

test('PTE scoring modules use pteUploadStorageHelper for remote reads', () => {
  for (const rel of SCORING_MODULES) {
    const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(
      source,
      /pteUploadStorageHelper/,
      `${rel} should use pteUploadStorageHelper for remote upload reads`
    );
  }
});

test('pteUploadStorageHelper is the shared PTE upload IO module', () => {
  const source = fs.readFileSync(path.join(ROOT, 'MVC/services/pte/pteUploadStorageHelper.js'), 'utf8');
  assert.match(source, /uploadStorageService\.readBuffer/);
  assert.match(source, /uploadStorageService\.listDirectory/);
});
