'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');
const weeklyReportsHubService = require('../MVC/services/school/weeklyReportsHubService');

const weeklyReportsHubServiceSource = fs.readFileSync(
  path.join(__dirname, '..', 'MVC', 'services', 'school', 'weeklyReportsHubService.js'),
  'utf8'
);

test('resolvePrimaryInstructor uses first instructor on class', () => {
  const result = weeklyReportsHubService.resolvePrimaryInstructor({
    instructors: [{ personId: 'PERSON/T1', name: 'Ada Lovelace' }]
  });
  assert.equal(result.teacherName, 'Ada Lovelace');
  assert.equal(result.teacherPersonId, 'PERSON/T1');
});

test('resolvePrimaryInstructor falls back to Unassigned', () => {
  const result = weeklyReportsHubService.resolvePrimaryInstructor({ instructors: [] });
  assert.equal(result.teacherName, 'Unassigned');
  assert.equal(result.teacherPersonId, '');
});

test('sumSessionScheduledHours prefers durationHours then start/end', () => {
  const total = weeklyReportsHubService.sumSessionScheduledHours([
    { durationHours: 1.5 },
    { startTime: '09:00', endTime: '10:30' },
    { startTime: 'bad', endTime: 'values' }
  ]);
  assert.equal(total, 3);
});

test('classMatchesProgram and classMatchesTeacher filter classes', () => {
  const classRow = {
    deliveryDepartmentId: 'DEPT/1',
    allowedProgramTerms: [{ programId: 'PROG/1' }],
    instructors: [{ personId: 'PERSON/T1', name: 'Teacher One' }]
  };
  assert.equal(weeklyReportsHubService.classMatchesProgram(classRow, 'PROG/1'), true);
  assert.equal(weeklyReportsHubService.classMatchesProgram(classRow, 'PROG/2'), false);
  assert.equal(weeklyReportsHubService.classMatchesTeacher(classRow, 'PERSON/T1'), true);
  assert.equal(weeklyReportsHubService.classMatchesTeacher(classRow, 'PERSON/T2'), false);
});

test('buildClassBoardRow includes teacher and scheduled hours', () => {
  const row = weeklyReportsHubService.buildClassBoardRow(
    {
      id: 'CLASS/1',
      title: 'Morning ESL',
      instructors: [{ personId: 'PERSON/T2', name: 'Jamie Lee' }]
    },
    {
      sessionCount: 4,
      avgStudentsPerSession: 8,
      absenceCount: 1,
      lateCount: 0,
      earlyLeaveCount: 0
    },
    2,
    6.5
  );
  assert.equal(row.className, 'Morning ESL');
  assert.equal(row.teacherName, 'Jamie Lee');
  assert.equal(row.teacherPersonId, 'PERSON/T2');
  assert.equal(row.scheduledHours, 6.5);
  assert.equal(row.sessionCount, 4);
  assert.equal(row.gradebookCount, 2);
});

test('class and student boards skip classes with no sessions in report window', () => {
  const matches = weeklyReportsHubServiceSource.match(/if \(!filteredSessions\.length\) \{\s*continue;\s*\}/g);
  assert.ok(matches && matches.length >= 2);
});

test('mapStudentBoardRows omits students with no expected sessions in the period', () => {
  const studentMap = new Map();
  studentMap.set('STU/1', {
    studentId: 'STU/1',
    name: 'Active Student',
    sessionCount: 2,
    attendance: { sessionCount: 2 }
  });
  studentMap.set('STU/2', {
    studentId: 'STU/2',
    name: 'No Sessions',
    sessionCount: 0,
    attendance: { sessionCount: 0 }
  });
  const rows = weeklyReportsHubService.mapStudentBoardRows(studentMap);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].studentId, 'STU/1');
});

test('buildStudentDetailRowFromClass attaches punctuality summary', () => {
  const row = weeklyReportsHubService.buildStudentDetailRowFromClass({
    matrixRow: {
      studentRecordId: 'student-1',
      personId: 'person-1',
      name: 'Ada Student',
      records: [
        {
          expectedForSession: true,
          status: 'present',
          lateMinutes: 0,
          earlyLeaveMinutes: 0
        },
        {
          expectedForSession: true,
          status: 'late',
          lateMinutes: 5,
          earlyLeaveMinutes: 0
        }
      ]
    },
    sessions: [{ id: 's1', date: '2026-01-06' }, { id: 's2', date: '2026-01-07' }],
    gradesPayload: {},
    sessionsById: new Map(),
    caseRows: [],
    sessionIdSet: new Set(['s1', 's2']),
    classData: {},
    orgPolicyLayer: {}
  });
  assert.equal(row.punctuality.attendedSessions, 2);
  assert.equal(row.punctuality.onTimeSessions, 1);
  assert.equal(row.punctuality.punctualityPercent, 50);
});

test('mergeStudentDetailIntoMap merges punctuality across classes', () => {
  const studentMap = new Map();
  const baseDetail = weeklyReportsHubService.buildStudentDetailRowFromClass({
    matrixRow: {
      studentRecordId: 'student-1',
      personId: 'person-1',
      name: 'Ada Student',
      records: [{
        expectedForSession: true,
        status: 'present',
        lateMinutes: 0,
        earlyLeaveMinutes: 0
      }]
    },
    sessions: [{ id: 's1' }],
    gradesPayload: {},
    sessionsById: new Map(),
    caseRows: [],
    sessionIdSet: new Set(['s1']),
    classData: {},
    orgPolicyLayer: {}
  });
  weeklyReportsHubService.mergeStudentDetailIntoMap(studentMap, 'class-a', baseDetail);
  const lateDetail = weeklyReportsHubService.buildStudentDetailRowFromClass({
    matrixRow: {
      studentRecordId: 'student-1',
      personId: 'person-1',
      name: 'Ada Student',
      records: [{
        expectedForSession: true,
        status: 'late',
        lateMinutes: 10,
        earlyLeaveMinutes: 0
      }]
    },
    sessions: [{ id: 's2' }],
    gradesPayload: {},
    sessionsById: new Map(),
    caseRows: [],
    sessionIdSet: new Set(['s2']),
    classData: {},
    orgPolicyLayer: {}
  });
  weeklyReportsHubService.mergeStudentDetailIntoMap(studentMap, 'class-b', lateDetail);
  const merged = studentMap.get('student-1');
  assert.equal(merged.punctuality.attendedSessions, 2);
  assert.equal(merged.punctuality.onTimeSessions, 1);
  assert.equal(merged.punctuality.punctualityPercent, 50);
});
