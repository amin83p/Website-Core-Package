'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/school/package.manifest.json'), 'utf8'));
const {
  WORD_OF_DAY_STATUSES,
  sanitizeWordOfDayInput,
  sanitizeExamples,
  sanitizeWordTypes,
  normalizeWordKey,
  primaryWordTypeLabel
} = require('../MVC/models/school/wordOfDayModel');
const { pickDailyEntry } = require('../MVC/services/school/wordOfDayDisplayService');
const { validatePolicyInput } = require('../MVC/services/school/wordOfDayPolicyService');
const { SECTION_ID, SECTION_NAME } = require('../scripts/maintenance/seedSchoolWordOfDaySection');

test('manifest declares SCHOOL_WORD_OF_DAY section', () => {
  const section = (manifest.sections || []).find((row) => row.name === 'SCHOOL_WORD_OF_DAY');
  assert.ok(section);
  assert.equal(section.id, SECTION_ID);
  assert.equal(section.homeURL, '/school/word-of-day');
});

test('seed metadata matches manifest section id', () => {
  assert.equal(SECTION_NAME, 'SCHOOL_WORD_OF_DAY');
  assert.equal(SECTION_ID, '445588');
});

test('model sanitizes examples and statuses', () => {
  assert.deepEqual(sanitizeExamples([' one ', '', 'two']), ['one', 'two']);
  const row = sanitizeWordOfDayInput({
    orgId: '900000',
    word: 'Ephemeral',
    wordType: 'adjective',
    difficulty: 'hard',
    meaning: 'Lasting for a very short time.',
    examples: ['The ephemeral bloom faded by noon.']
  });
  assert.equal(row.status, 'saved');
  assert.ok(WORD_OF_DAY_STATUSES.includes(row.status));
  assert.deepEqual(row.wordTypes, ['adjective']);
});

test('model supports multiple word types and normalized duplicate keys', () => {
  assert.deepEqual(sanitizeWordTypes(['verb', 'noun', 'verb']), ['verb', 'noun']);
  assert.equal(primaryWordTypeLabel(['noun', 'verb']), 'Noun, Verb');
  assert.equal(normalizeWordKey('  Hello   World '), 'hello world');
  const row = sanitizeWordOfDayInput({
    orgId: '900000',
    word: 'Run',
    wordTypes: ['verb', 'noun'],
    difficulty: 'easy',
    meaning: 'To move quickly.'
  });
  assert.deepEqual(row.wordTypes, ['verb', 'noun']);
  assert.equal(row.wordType, 'verb');
});

test('display picker is deterministic per org and date', () => {
  const pool = [
    { id: 'a', display: { displayCount: 0 } },
    { id: 'b', display: { displayCount: 0 } },
    { id: 'c', display: { displayCount: 5 } }
  ];
  const first = pickDailyEntry(pool, '900000', '2026-03-01');
  const second = pickDailyEntry(pool, '900000', '2026-03-01');
  assert.equal(first?.id, second?.id);
  assert.ok(['a', 'b'].includes(first?.id));
});

test('policy validation requires org when public home is enabled', () => {
  assert.throws(
    () => validatePolicyInput({ publicHomeEnabled: true, publicSourceOrgId: '' }),
    /source organization/i
  );
});

test('package manifest seeders are non-decreasing by version', () => {
  const packageManifestService = require('../../../MVC/services/packageManifestService');
  assert.doesNotThrow(() => packageManifestService.validatePackageManifest(manifest, { knownIds: [] }));
  const versions = (manifest.seeders || []).map((row) => row.version);
  assert.equal(versions.join(','), '0.1.1,0.1.2,0.1.4');
});

test('word of day manifest section binds seven operations', () => {
  const section = (manifest.sections || []).find((row) => row.name === 'SCHOOL_WORD_OF_DAY');
  assert.equal(section.minimumAccessRequirement, 7);
  assert.equal((section.operations || []).length, 7);
});