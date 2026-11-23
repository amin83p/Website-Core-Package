const test = require('node:test');
const assert = require('node:assert/strict');

const sessionRosterContactService = require('../MVC/services/school/sessionRosterContactService');

test('buildAttendanceRosterEmailMap uses person email and roster name', () => {
  const personById = new Map([
    ['P1', { id: 'P1', contact: { email: 'alice@school.org' }, name: { first: 'Alice', last: 'One' } }],
    ['P2', { id: 'P2', contact: { emails: [{ email: 'bob@school.org' }] } }]
  ]);
  const roster = [
    { personId: 'P1', name: 'Alice Display' },
    { personId: 'P2', name: 'Bob Display' },
    { personId: 'P1', name: 'Duplicate skip' }
  ];
  const map = sessionRosterContactService.buildAttendanceRosterEmailMap(roster, personById);
  assert.equal(map.P1.name, 'Alice Display');
  assert.equal(map.P1.email, 'alice@school.org');
  assert.equal(map.P2.email, 'bob@school.org');
  assert.equal(Object.keys(map).length, 2);
});

test('buildAttendanceRosterEmailMap tolerates missing person', () => {
  const map = sessionRosterContactService.buildAttendanceRosterEmailMap(
    [{ personId: 'P9', name: 'No Person' }],
    new Map()
  );
  assert.deepEqual(map.P9, { name: 'No Person', email: '' });
});

test('formatEmailsForClipboard dedupes and preserves order', () => {
  const text = sessionRosterContactService.formatEmailsForClipboard([
    { email: 'a@x.com' },
    { email: ' invalid ' },
    { email: 'b@x.com' },
    { email: 'a@x.com' },
    { email: 'A@X.COM' }
  ]);
  assert.equal(text, 'a@x.com, b@x.com');
});

test('isPlausibleEmail rejects malformed values', () => {
  assert.equal(sessionRosterContactService.isPlausibleEmail(''), false);
  assert.equal(sessionRosterContactService.isPlausibleEmail('no-at'), false);
  assert.equal(sessionRosterContactService.isPlausibleEmail('user@domain.org'), true);
});