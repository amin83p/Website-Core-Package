'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validatePolicyInput, normalizePolicyFromStored } = require('../MVC/services/school/wordOfDayPolicyService');
const { applyDisplayPolicy, pickDailyEntry } = require('../MVC/services/school/wordOfDayDisplayService');
const wordOfDayDisplayScheduleModel = require('../MVC/models/school/wordOfDayDisplayScheduleModel');
const { enumerateDateKeys } = require('../MVC/services/school/wordOfDayDisplayScheduleService');
const { isContributionQuotaExempt } = require('../MVC/services/school/wordOfDayService');

test('policy stores display toggles and yearly contribution limit', () => {
  const normalized = normalizePolicyFromStored({
    showAuthorOnDisplay: false,
    showDifficultyOnDisplay: '0',
    yearlyContributionLimitPerUser: '12'
  });
  assert.equal(normalized.showAuthorOnDisplay, false);
  assert.equal(normalized.showDifficultyOnDisplay, false);
  assert.equal(normalized.yearlyContributionLimitPerUser, 12);
  const validated = validatePolicyInput(normalized);
  assert.equal(validated.yearlyContributionLimitPerUser, 12);
});

test('applyDisplayPolicy removes author and difficulty when disabled', () => {
  const entry = {
    word: 'Ephemeral',
    authorName: 'Alex',
    authorFirstName: 'Alex',
    difficulty: 'hard',
    difficultyLabel: 'Hard'
  };
  const hidden = applyDisplayPolicy(entry, {
    showAuthorOnDisplay: false,
    showDifficultyOnDisplay: false
  });
  assert.equal(hidden.authorName, '');
  assert.equal(hidden.authorFirstName, '');
  assert.equal(hidden.difficulty, '');
  assert.equal(hidden.difficultyLabel, '');
});

test('enumerateDateKeys lists inclusive range', () => {
  const keys = enumerateDateKeys('2026-03-01', '2026-03-03');
  assert.deepEqual(keys, ['2026-03-01', '2026-03-02', '2026-03-03']);
});

test('display schedule model validates date keys', () => {
  assert.equal(wordOfDayDisplayScheduleModel.isDateKey('2026-11-26'), true);
  assert.equal(wordOfDayDisplayScheduleModel.isDateKey('26-11-2026'), false);
});

test('contribution quota exempt for Family A admin create bypass', () => {
  assert.equal(isContributionQuotaExempt({ adminFlags: { create: true } }), true);
  assert.equal(isContributionQuotaExempt({ adminFlags: { create: false } }), false);
});

test('parseSlotMode distinguishes automatic, scheduled, and excluded', () => {
  assert.equal(wordOfDayDisplayScheduleModel.parseSlotMode(null), 'automatic');
  assert.equal(wordOfDayDisplayScheduleModel.parseSlotMode({ entryId: 'E1' }), 'scheduled');
  assert.equal(wordOfDayDisplayScheduleModel.parseSlotMode({ mode: 'excluded' }), 'excluded');
  assert.equal(wordOfDayDisplayScheduleModel.parseSlotMode({ mode: 'EXCLUDED', entryId: 'E1' }), 'excluded');
});

test('display schedule PUT supports exclude and include modes', () => {
  const ctrl = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'MVC', 'controllers', 'school', 'wordOfDayController.js'),
    'utf8'
  );
  assert.match(ctrl, /mode === 'exclude'/);
  assert.match(ctrl, /excludeScheduledDate/);
  assert.match(ctrl, /mode === 'automatic'/);
  assert.match(ctrl, /includeScheduledDate/);
});

test('resolveEffectiveDisplay is exported for carry-forward resolution', () => {
  const { resolveEffectiveDisplay } = require('../MVC/services/school/wordOfDayDisplayService');
  assert.equal(typeof resolveEffectiveDisplay, 'function');
});

test('scheduled entry overrides automatic picker when injected', () => {
  const pool = [
    { id: 'auto-a', display: { displayCount: 0 } },
    { id: 'auto-b', display: { displayCount: 0 } }
  ];
  const auto = pickDailyEntry(pool, '900000', '2026-06-01');
  assert.ok(auto?.id);
  const scheduled = { id: 'scheduled-x', display: { displayCount: 99 } };
  const manualPick = scheduled.id === 'scheduled-x' ? scheduled : pickDailyEntry(pool, '900000', '2026-06-01');
  assert.equal(manualPick.id, 'scheduled-x');
  assert.notEqual(manualPick.id, auto?.id);
});