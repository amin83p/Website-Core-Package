const test = require('node:test');
const assert = require('node:assert/strict');

const classAttendanceRosterOrderService = require('../MVC/services/school/classAttendanceRosterOrderService');

test('sortByAttendancePersonOrder supports custom resolvePersonId', () => {
  const rows = [
    { studentId: 'STU_B', studentName: 'Bravo' },
    { studentId: 'STU_A', studentName: 'Alpha' }
  ];
  const studentToPerson = new Map([
    ['STU_A', 'PERSON_A'],
    ['STU_B', 'PERSON_B']
  ]);
  const sorted = classAttendanceRosterOrderService.sortByAttendancePersonOrder(
    rows,
    ['PERSON_B', 'PERSON_A'],
    {
      resolvePersonId: (row) => studentToPerson.get(row.studentId) || row.studentId,
      nameKey: 'studentName'
    }
  );
  assert.deepEqual(sorted.map((row) => row.studentId), ['STU_B', 'STU_A']);
});

test('sortRosterRowsByPersonOrder respects saved ids and alpha tie-break', () => {
  const rows = [
    { personId: 'P_B', name: 'Bravo' },
    { personId: 'P_A', name: 'Alpha' },
    { personId: 'P_C', name: 'Charlie' }
  ];
  const sorted = classAttendanceRosterOrderService.sortRosterRowsByPersonOrder(rows, ['P_C', 'P_B']);
  assert.deepEqual(sorted.map((row) => row.personId), ['P_C', 'P_B', 'P_A']);
});

test('sortRosterRowsByPersonOrder appends unknown ids alphabetically', () => {
  const rows = [
    { personId: 'P_Z', name: 'Zulu' },
    { personId: 'P_M', name: 'Mike' }
  ];
  const sorted = classAttendanceRosterOrderService.sortRosterRowsByPersonOrder(rows, ['P_M']);
  assert.deepEqual(sorted.map((row) => row.personId), ['P_M', 'P_Z']);
});

test('buildEditorRows keeps saved sequence then appends new enrollments', () => {
  const eligibleRows = [
    { personId: 'P_2', name: 'B' },
    { personId: 'P_3', name: 'C' },
    { personId: 'P_1', name: 'A' }
  ];
  const editorRows = classAttendanceRosterOrderService.buildEditorRows({
    savedOrder: ['P_3', 'P_2'],
    eligibleRows
  });
  assert.deepEqual(editorRows.map((row) => row.personId), ['P_3', 'P_2', 'P_1']);
});

test('normalizeOrderForSave drops duplicates and ineligible ids', () => {
  const eligible = new Set(['P_1', 'P_2']);
  const normalized = classAttendanceRosterOrderService.normalizeOrderForSave({
    order: ['P_2', 'P_9', 'P_2', 'P_1', 'P_1'],
    eligiblePersonIdSet: eligible
  });
  assert.deepEqual(normalized, ['P_2', 'P_1']);
});

test('normalizeAttendanceRosterPersonOrder dedupes and trims', () => {
  const normalized = classAttendanceRosterOrderService.normalizeAttendanceRosterPersonOrder(['P_1', ' P_1 ', 'P_2', '']);
  assert.deepEqual(normalized, ['P_1', 'P_2']);
});

test('buildEarliestClassEnrollmentStartByPersonId picks earliest start per person', () => {
  const studentToPersonMap = new Map([
    ['STU_A', 'PERSON_A'],
    ['STU_B', 'PERSON_B']
  ]);
  const map = classAttendanceRosterOrderService.buildEarliestClassEnrollmentStartByPersonId({
    classId: 'CLS_1',
    studentToPersonMap,
    periodRows: [
      { classId: 'CLS_1', studentId: 'STU_A', startDate: '2026-02-01' },
      { classId: 'CLS_1', studentId: 'STU_A', startDate: '2026-01-15' },
      { classId: 'CLS_1', studentId: 'STU_B', startDate: '2026-03-01' },
      { classId: 'CLS_2', studentId: 'STU_A', startDate: '2025-01-01' }
    ]
  });
  assert.equal(map.get('PERSON_A'), '2026-01-15');
  assert.equal(map.get('PERSON_B'), '2026-03-01');
});

test('buildSoonestClassEnrollmentEndByPersonId picks soonest end among active periods', () => {
  const studentToPersonMap = new Map([
    ['STU_A', 'PERSON_A'],
    ['STU_B', 'PERSON_B']
  ]);
  const map = classAttendanceRosterOrderService.buildSoonestClassEnrollmentEndByPersonId({
    classId: 'CLS_1',
    studentToPersonMap,
    orgToday: '2026-06-01',
    periodRows: [
      { classId: 'CLS_1', studentId: 'STU_A', startDate: '2026-01-01', endDate: '2026-12-31' },
      { classId: 'CLS_1', studentId: 'STU_A', startDate: '2026-05-01', endDate: '2026-08-01' },
      { classId: 'CLS_1', studentId: 'STU_B', startDate: '2026-01-01', endDate: '2026-04-01' },
      { classId: 'CLS_1', studentId: 'STU_B', startDate: '2026-06-01', endDate: '' },
      { classId: 'CLS_2', studentId: 'STU_A', startDate: '2025-01-01', endDate: '2025-06-01' }
    ]
  });
  assert.equal(map.get('PERSON_A'), '2026-08-01');
  assert.equal(map.get('PERSON_B'), classAttendanceRosterOrderService.OPEN_END_SORT_SENTINEL);
});

test('buildSoonestClassEnrollmentEndByPersonId ignores periods not overlapping orgToday', () => {
  const studentToPersonMap = new Map([['STU_A', 'PERSON_A']]);
  const map = classAttendanceRosterOrderService.buildSoonestClassEnrollmentEndByPersonId({
    classId: 'CLS_1',
    studentToPersonMap,
    orgToday: '2026-03-01',
    periodRows: [
      { classId: 'CLS_1', studentId: 'STU_A', startDate: '2026-04-01', endDate: '2026-06-01' }
    ]
  });
  assert.equal(map.get('PERSON_A'), undefined);
});

test('normalizeAttendanceRosterNicknames trims and caps entries', () => {
  const normalized = classAttendanceRosterOrderService.normalizeAttendanceRosterNicknames({
    ' P_1 ': '  Nick  ',
    P_2: '',
    bad: 'x'.repeat(80),
    '': 'ignored'
  });
  assert.equal(normalized.P_1, 'Nick');
  assert.equal(normalized.P_2, undefined);
  assert.equal(normalized.bad.length, 60);
});

test('normalizeNicknamesForSave keeps only eligible person ids', () => {
  const eligible = new Set(['P_1', 'P_2']);
  const saved = classAttendanceRosterOrderService.normalizeNicknamesForSave({
    nicknames: { P_1: 'Alpha', P_9: 'Ghost' },
    eligiblePersonIdSet: eligible
  });
  assert.deepEqual(saved, { P_1: 'Alpha' });
});

test('formatRosterNameWithNickname wraps nickname in parentheses', () => {
  assert.equal(
    classAttendanceRosterOrderService.formatRosterNameWithNickname({
      legalName: 'Jane Doe',
      nickname: 'JJ'
    }),
    'Jane Doe (JJ)'
  );
  assert.equal(
    classAttendanceRosterOrderService.formatRosterNameWithNickname({
      legalName: 'Jane Doe',
      nickname: ''
    }),
    'Jane Doe'
  );
});
