'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const wordOfDayService = require('../MVC/services/school/wordOfDayService');

const repoRoot = path.join(__dirname, '..', '..', '..');

const OWNER_ACCESS = {
  canViewEntries: false,
  adminFlags: {}
};

const READ_ALL_ACCESS = {
  canViewEntries: true,
  adminFlags: { readAll: true }
};

test('formatDuplicateSummary limits details when contributor cannot view other entries', () => {
  const row = {
    id: 'WOD-100',
    word: 'Ephemeral',
    status: 'approved',
    meaning: 'Secret meaning',
    authorName: 'Someone else',
    examples: ['Hidden example']
  };
  const summary = wordOfDayService.formatDuplicateSummary(row, {
    access: OWNER_ACCESS,
    actorId: 'USER-A',
    currentYear: '2026'
  });
  assert.equal(summary.limited, true);
  assert.equal(summary.canOpen, false);
  assert.ok(summary.notice);
  assert.equal(summary.meaning, undefined);
  assert.equal(summary.detailUrl, undefined);
});

test('word form uses shared message modal, not duplicate bootstrap modal', () => {
  const formView = fs.readFileSync(
    path.join(repoRoot, 'packages', 'school', 'MVC', 'views', 'school', 'wordOfDay', 'form.ejs'),
    'utf8'
  );
  const formJs = fs.readFileSync(
    path.join(repoRoot, 'packages', 'school', 'public', 'scripts', 'wordOfDayForm.js'),
    'utf8'
  );
  assert.doesNotMatch(formView, /wodDuplicateModal/);
  assert.match(formView, /schoolMessageUi\.js/);
  assert.match(formJs, /showMessageModal/);
  assert.match(formJs, /SchoolMessageUi/);
});

test('formatDuplicateSummary includes open link for reviewers with read-all', () => {
  const row = {
    id: 'WOD-200',
    word: 'Ephemeral',
    status: 'approved',
    meaning: 'Visible',
    authorName: 'Someone else',
    examples: []
  };
  const summary = wordOfDayService.formatDuplicateSummary(row, {
    access: READ_ALL_ACCESS,
    actorId: 'REVIEWER-1',
    currentYear: '2026'
  });
  assert.equal(summary.limited, false);
  assert.equal(summary.canOpen, true);
  assert.match(summary.detailUrl, /openEntry=WOD-200/);
  assert.equal(summary.meaning, 'Visible');
});

test('layout loads schoolMessageUi when includeModal for shared message modal', () => {
  const layout = fs.readFileSync(path.join(repoRoot, 'MVC', 'views', 'layouts', 'layout.ejs'), 'utf8');
  assert.match(layout, /includeModal[\s\S]*schoolMessageUi\.js/);
});

test('word of day review and schedule clients avoid native alert or confirm', () => {
  const reviewModal = fs.readFileSync(
    path.join(repoRoot, 'packages', 'school', 'public', 'scripts', 'wordOfDayReviewModal.js'),
    'utf8'
  );
  const scheduleModal = fs.readFileSync(
    path.join(repoRoot, 'packages', 'school', 'public', 'scripts', 'wordOfDayDisplayScheduleModal.js'),
    'utf8'
  );
  assert.doesNotMatch(reviewModal, /global\.alert/);
  assert.doesNotMatch(reviewModal, /global\.confirm/);
  assert.doesNotMatch(scheduleModal, /global\.alert/);
  assert.doesNotMatch(scheduleModal, /global\.confirm/);
  assert.doesNotMatch(scheduleModal, /global\.prompt/);
  assert.match(scheduleModal, /data-wod-schedule-exclude/);
  assert.doesNotMatch(scheduleModal, /data-wod-schedule-clear/);
});