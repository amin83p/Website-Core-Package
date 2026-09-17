const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseSearchFieldTokens,
  recordMatchesMultiFieldSearch
} = require('../MVC/utils/multiFieldSearch');
const { rowMatchesQuery } = require('../packages/school/MVC/services/school/programRegistrationViewService');

test('parseSearchFieldTokens splits comma-separated search fields', () => {
  assert.deepEqual(parseSearchFieldTokens('id, studentName, programLabel'), ['id', 'studentName', 'programLabel']);
  assert.deepEqual(parseSearchFieldTokens('all'), []);
  assert.deepEqual(parseSearchFieldTokens(''), []);
});

test('recordMatchesMultiFieldSearch matches any listed field', () => {
  const row = { id: 'REG-1', studentName: 'Jane Doe', programLabel: 'ESL' };
  const searchFields = 'id,studentName,programLabel';
  assert.equal(recordMatchesMultiFieldSearch(row, { q: 'jane', searchFields }, {
    readFieldValues: (record, token) => [record[token]]
  }), true);
  assert.equal(recordMatchesMultiFieldSearch(row, { q: 'esl', searchFields }, {
    readFieldValues: (record, token) => [record[token]]
  }), true);
  assert.equal(recordMatchesMultiFieldSearch(row, { q: 'zzz', searchFields }, {
    readFieldValues: (record, token) => [record[token]]
  }), false);
});

test('rowMatchesQuery matches program registration rows across multi-field searchFields', () => {
  const row = {
    id: 'REG-9',
    studentId: 'STU-1',
    studentName: 'Aisling Murphy',
    programId: 'PRG-1',
    programLabel: 'Foundations',
    feeCategorySnapshot: 'Domestic',
    note: '',
    status: 'active',
    verificationStatus: 'verified',
    registrationDate: '2026-01-01'
  };
  const searchFields = 'studentName,programLabel,status';
  assert.equal(rowMatchesQuery(row, 'murphy', 'contains', searchFields), true);
  assert.equal(rowMatchesQuery(row, 'foundations', 'contains', searchFields), true);
  assert.equal(rowMatchesQuery(row, 'REG-9', 'contains', 'id,studentName'), true);
});
