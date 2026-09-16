'use strict';

const assert = require('assert');
const test = require('node:test');
const {
  buildSessionListHtml,
  buildSessionListText,
  buildTeacherReviewEmailContent,
  groupEntriesByClassTitle
} = require('../MVC/services/school/sessionUncompletedNotificationService');

const sampleEntries = [
  {
    classData: { id: 'C1', title: 'Algebra I' },
    session: { sessionId: 'S1', date: '2026-09-01', startTime: '09:00', endTime: '10:00' },
    title: 'Period 1'
  },
  {
    classData: { id: 'C1', title: 'Algebra I' },
    session: { sessionId: 'S2', date: '2026-09-02', startTime: '11:00', endTime: '12:00' },
    title: 'Period 2'
  },
  {
    classData: { id: 'C2', title: 'Biology' },
    session: { sessionId: 'S3', date: '2026-09-03', startTime: '13:00', endTime: '14:30' },
    title: 'Lab'
  }
];

test('groupEntriesByClassTitle sorts class groups', () => {
  const groups = groupEntriesByClassTitle(sampleEntries);
  assert.equal(groups.length, 2);
  assert.equal(groups[0][0], 'Algebra I');
  assert.equal(groups[0][1].length, 2);
});

test('buildSessionListHtml uses class headers and clickable session bullets', () => {
  const html = buildSessionListHtml(sampleEntries, {
    baseUrl: 'https://school.example',
    sessionTimingByKey: new Map([
      ['S1', { timingLabel: 'Please complete soon.' }]
    ])
  });
  assert.match(html, /role="presentation"/);
  assert.match(html, /Algebra I/);
  assert.match(html, /Biology/);
  assert.match(html, /href="https:\/\/school\.example\/school\/classes\/C1\/sessions\/S1"/);
  assert.match(html, /Period 1/);
  assert.match(html, /Please complete soon\./);
  assert.match(html, /&#128279;/);
});

test('buildSessionListText groups by class with bullet links', () => {
  const text = buildSessionListText(sampleEntries, {
    baseUrl: 'https://school.example',
    sessionTimingByKey: new Map([['S2', { timingLabel: 'Time remaining: 2 days.' }]])
  });
  assert.match(text, /^Algebra I/m);
  assert.match(text, /• Period 2/);
  assert.match(text, /https:\/\/school\.example\/school\/classes\/C1\/sessions\/S2/);
  assert.match(text, /Time remaining: 2 days\./);
});

test('buildTeacherReviewEmailContent asks teacher to review and complete', async () => {
  const content = await buildTeacherReviewEmailContent({
    teacherName: 'Jane Doe',
    orgName: 'Demo School',
    entries: sampleEntries.slice(0, 1),
    baseUrl: 'https://school.example',
    orgId: ''
  });
  assert.match(content.plainText, /Dear Jane Doe/);
  assert.match(content.plainText, /require review and completion/);
  assert.match(content.plainText, /Sincerely,/);
  assert.match(content.htmlBody, /role="presentation"/);
  assert.match(content.htmlBody, /Session completion reminder/);
  assert.match(content.htmlBody, /Demo School/);
  assert.match(content.htmlBody, /sent by <strong[^>]*>.*<\/strong>/);
});
