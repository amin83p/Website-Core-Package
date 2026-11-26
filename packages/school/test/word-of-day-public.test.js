'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const wordOfDayReactionModel = require('../MVC/models/school/wordOfDayReactionModel');
const wordOfDayReactionService = require('../MVC/services/school/wordOfDayReactionService');
const wordOfDayDisplayService = require('../MVC/services/school/wordOfDayDisplayService');
const wordOfDayUiConstants = require('../MVC/services/school/wordOfDayUiConstants');

test('reaction dedupe keys separate user and ip voters', () => {
  const userKey = wordOfDayReactionModel.buildDedupeKey({
    entryId: 'E1',
    voterUserId: 'U1'
  });
  const ipKey = wordOfDayReactionModel.buildDedupeKey({
    entryId: 'E1',
    ipAddress: '127.0.0.1'
  });
  assert.notEqual(userKey, ipKey);
  assert.match(userKey, /^user::E1::/);
  assert.match(ipKey, /^ip::E1::/);
});

test('reaction vote normalization accepts like and dislike only', () => {
  assert.equal(wordOfDayReactionModel.normalizeVote('like'), 'like');
  assert.equal(wordOfDayReactionModel.normalizeVote('DISLIKE'), 'dislike');
  assert.equal(wordOfDayReactionModel.normalizeVote('meh'), null);
});

test('listForEntry filters by entry id', () => {
  const entries = [
    { entryId: 'a', vote: 'like' },
    { entryId: 'b', vote: 'dislike' },
    { entryId: 'a', vote: 'dislike' }
  ];
  const scoped = wordOfDayReactionModel.listForEntry('a', entries);
  assert.equal(scoped.length, 2);
});

test('redactForPublicDetail exposes meaning and media without workflow', () => {
  const row = {
    id: 'w1',
    status: 'approved',
    word: 'serendipity',
    wordTypes: ['noun'],
    pronunciation: '/ˌsɛrənˈdɪpəti/',
    difficulty: 'hard',
    authorName: 'Ada Lovelace',
    meaning: 'A happy accident.',
    examples: ['Finding the book was pure serendipity.'],
    photo: { url: '/uploads/x.jpg', fileName: 'x.jpg', mimeType: 'image/jpeg' },
    workflow: { submittedAt: '2026-01-01T00:00:00.000Z' },
    authorUserId: 'secret-user'
  };
  const detail = wordOfDayDisplayService.redactForPublicDetail(row);
  assert.ok(detail);
  assert.equal(detail.meaning, 'A happy accident.');
  assert.equal(detail.examples.length, 1);
  assert.equal(detail.workflow, undefined);
  assert.equal(detail.authorUserId, undefined);
  assert.equal(detail.authorFirstName, 'Ada');
});

test('redactForPublicDetail rejects non-approved rows', () => {
  const row = { id: 'w2', status: 'submitted', word: 'test' };
  assert.equal(wordOfDayDisplayService.redactForPublicDetail(row), null);
});

test('resolveDailyDisplay returns orgId and rejects invalid date', async () => {
  const result = await wordOfDayDisplayService.resolveDailyDisplay({
    orgId: 'ORG1',
    dateKey: 'not-a-date',
    recordAnalytics: false
  });
  assert.equal(result.orgId, 'ORG1');
  assert.equal(result.entry, null);
});

test('dislike comment sanitization trims, caps length, and ignores non-dislike votes', () => {
  assert.equal(wordOfDayReactionModel.sanitizeDislikeComment('  hello  ', { vote: 'dislike' }), 'hello');
  assert.equal(wordOfDayReactionModel.sanitizeDislikeComment('', { vote: 'dislike' }), null);
  assert.equal(wordOfDayReactionModel.sanitizeDislikeComment('x', { vote: 'like' }), null);
  const long = 'a'.repeat(wordOfDayReactionModel.DISLIKE_COMMENT_MAX + 50);
  assert.equal(
    wordOfDayReactionModel.sanitizeDislikeComment(long, { vote: 'dislike' }).length,
    wordOfDayReactionModel.DISLIKE_COMMENT_MAX
  );
});

test('buildPublicFeedbackFromReactions aggregates stats and named comments only', () => {
  const scoped = [
    {
      id: 'r1',
      vote: 'like',
      voterDisplayName: 'Ada',
      voterUserId: 'U1',
      updatedAt: '2026-01-02T00:00:00.000Z'
    },
    {
      id: 'r2',
      vote: 'dislike',
      voterDisplayName: 'Guest voter',
      dislikeComment: 'Too hard for grade 3',
      updatedAt: '2026-01-03T00:00:00.000Z',
      createdAt: '2026-01-03T00:00:00.000Z'
    },
    {
      id: 'r3',
      vote: 'dislike',
      voterDisplayName: 'Bob',
      dislikeComment: '',
      updatedAt: '2026-01-04T00:00:00.000Z'
    }
  ];
  const block = wordOfDayReactionService.buildPublicFeedbackFromReactions(scoped);
  assert.equal(block.stats.likes, 1);
  assert.equal(block.stats.dislikes, 2);
  assert.equal(block.dislikeComments.length, 1);
  assert.equal(block.dislikeComments[0].text, 'Too hard for grade 3');
  assert.equal(block.dislikeComments[0].voterName, 'Guest voter');
});

test('redactForPublicDetail omits internal publicFeedback if present on row', () => {
  const row = {
    id: 'w3',
    status: 'approved',
    word: 'test',
    wordTypes: ['noun'],
    meaning: 'A trial.',
    publicFeedback: {
      stats: { likes: 9, dislikes: 1 },
      dislikeComments: [{ text: 'secret', voterName: 'Staff only' }]
    }
  };
  const detail = wordOfDayDisplayService.redactForPublicDetail(row);
  assert.ok(detail);
  assert.equal(detail.publicFeedback, undefined);
});

test('ui constants provide icons for word types and difficulty', () => {
  assert.match(wordOfDayUiConstants.wordTypeIcon('noun'), /^bi-/);
  assert.match(wordOfDayUiConstants.difficultyIcon('easy'), /^bi-/);
});