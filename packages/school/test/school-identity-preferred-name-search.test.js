const test = require('node:test');
const assert = require('node:assert/strict');

const {
  personMatchesQuery,
  rowMatchesQuery,
  formatPersonName
} = require('../MVC/services/school/schoolIdentityLookupService');

const personWithPreferred = {
  id: 'PER_MARGARET',
  preferredName: 'Mar',
  firstName: 'Margaret',
  lastName: 'Smith',
  name: { preferred: 'Mar', first: 'Margaret', last: 'Smith' },
  organizations: [{ orgId: 'ORG_1', roles: ['school_teacher'], memberStatus: 'active' }]
};

test('formatPersonName still prefers preferred name for display', () => {
  assert.equal(formatPersonName(personWithPreferred, 'PER_MARGARET'), 'Mar');
});

test('personMatchesQuery matches preferred, first, and last names', () => {
  assert.equal(personMatchesQuery(personWithPreferred, 'mar', 'ORG_1'), true);
  assert.equal(personMatchesQuery(personWithPreferred, 'margaret', 'ORG_1'), true);
  assert.equal(personMatchesQuery(personWithPreferred, 'smith', 'ORG_1'), true);
  assert.equal(personMatchesQuery(personWithPreferred, 'zzz', 'ORG_1'), false);
});

test('rowMatchesQuery matches preferred, first, and last names on user rows', () => {
  const row = {
    id: 'USR_1',
    userId: 'USR_1',
    personId: 'PER_MARGARET',
    displayName: 'Mar',
    name: 'Mar',
    preferredName: 'Mar',
    firstName: 'Margaret',
    lastName: 'Smith',
    username: 'mar.smith',
    email: 'mar.smith@example.test',
    roles: ['school_teacher']
  };

  assert.equal(rowMatchesQuery(row, 'mar'), true);
  assert.equal(rowMatchesQuery(row, 'margaret'), true);
  assert.equal(rowMatchesQuery(row, 'smith'), true);
  assert.equal(rowMatchesQuery(row, 'zzz'), false);
});
