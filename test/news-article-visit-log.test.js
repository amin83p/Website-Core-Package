const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildArticleVisitLogPage,
  formatVisitRoleLabel
} = require('../MVC/controllers/newsController');

test('buildArticleVisitLogPage keeps one row per visit for the same user', () => {
  const analytics = [
    { userId: 'U1', timestamp: '2026-01-01T10:00:00.000Z', userRole: 'user' },
    { userId: 'U1', timestamp: '2026-01-02T10:00:00.000Z', userRole: 'user' }
  ];
  const { rows, pagination } = buildArticleVisitLogPage(analytics, { limit: 10, page: 1 });
  assert.equal(pagination.totalItems, 2);
  assert.equal(rows.length, 2);
});

test('buildArticleVisitLogPage sorts visits newest first', () => {
  const analytics = [
    { userId: 'U1', timestamp: '2026-01-01T10:00:00.000Z' },
    { userId: 'U2', timestamp: '2026-01-03T10:00:00.000Z' },
    { userId: 'U3', timestamp: '2026-01-02T10:00:00.000Z' }
  ];
  const { rows } = buildArticleVisitLogPage(analytics, { limit: 10, page: 1 });
  assert.equal(rows[0].viewedAt, '2026-01-03T10:00:00.000Z');
  assert.equal(rows[1].viewedAt, '2026-01-02T10:00:00.000Z');
  assert.equal(rows[2].viewedAt, '2026-01-01T10:00:00.000Z');
});

test('buildArticleVisitLogPage paginates with limit and page', () => {
  const analytics = [
    { userId: null, timestamp: '2026-01-01T10:00:00.000Z', userRole: 'guest' },
    { userId: null, timestamp: '2026-01-02T10:00:00.000Z', userRole: 'guest' },
    { userId: null, timestamp: '2026-01-03T10:00:00.000Z', userRole: 'guest' },
    { userId: null, timestamp: '2026-01-04T10:00:00.000Z', userRole: 'guest' },
    { userId: null, timestamp: '2026-01-05T10:00:00.000Z', userRole: 'guest' }
  ];
  const page1 = buildArticleVisitLogPage(analytics, { limit: 2, page: 1 });
  assert.equal(page1.rows.length, 2);
  assert.equal(page1.pagination.totalPages, 3);
  assert.equal(page1.rows[0].viewedAt, '2026-01-05T10:00:00.000Z');

  const page2 = buildArticleVisitLogPage(analytics, { limit: 2, page: 2 });
  assert.equal(page2.pagination.currentPage, 2);
  assert.equal(page2.rows.length, 2);
  assert.equal(page2.rows[0].viewedAt, '2026-01-03T10:00:00.000Z');
});

test('buildArticleVisitLogPage labels guest visits', () => {
  const { rows } = buildArticleVisitLogPage(
    [{ userId: null, timestamp: '2026-01-01T10:00:00.000Z', userRole: 'guest' }],
    { limit: 5, page: 1 }
  );
  assert.equal(rows[0].userName, 'Guest');
  assert.equal(rows[0].isGuest, true);
});

test('formatVisitRoleLabel humanizes role tokens', () => {
  assert.equal(formatVisitRoleLabel('guest'), 'Guest');
  assert.equal(formatVisitRoleLabel('school_teacher'), 'School Teacher');
});
