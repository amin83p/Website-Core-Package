const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const schoolRepositories = require('../packages/school/MVC/repositories/school');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const notificationService = require('../packages/school/MVC/services/school/notificationService');
const sessionStudentCaseService = require('../packages/school/MVC/services/school/sessionStudentCaseService');

const manifest = JSON.parse(fs.readFileSync('packages/school/package.manifest.json', 'utf8'));

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('school manifest declares session student cases data entity', () => {
  const entity = (manifest.dataEntities || []).find((row) => row.entityType === 'sessionStudentCases');
  assert.ok(entity);
  assert.equal(entity.collectionName, 'schoolSessionStudentCases');
});

test('class routes expose session student case endpoints under SCHOOL_SESSIONS', () => {
  const src = read('packages/school/MVC/routes/classRoutes.js');
  assert.match(src, /\/:id\/sessions\/:sessionId\/cases/);
  assert.match(src, /ctrl\.listSessionStudentCases/);
  assert.match(src, /ctrl\.saveSessionStudentCase/);
  assert.match(src, /ctrl\.updateSessionStudentCaseStatus/);
  assert.match(src, /requireAccess\(SECTIONS\.SCHOOL_SESSIONS, OPERATIONS\.READ_ALL\)/);
  assert.match(src, /requireAccess\(SECTIONS\.SCHOOL_SESSIONS, OPERATIONS\.UPDATE\)/);
});

test('session manager renders student cases tab, modal, and avoids attendance duplicate fields', () => {
  const src = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.match(src, /data-session-panel="student-cases"/);
  assert.match(src, /id="session-panel-student-cases"/);
  assert.match(src, /id="studentCaseModal"/);
  assert.match(src, /btn-open-student-case/);
  assert.match(src, /id="btnResolveStudentCase"/);
  assert.match(src, /saveStudentCase\(\{ resolve: true \}\)/);
  assert.match(src, /payload\.status = 'resolved'/);
  assert.doesNotMatch(src, /studentCaseLate/i);
  assert.doesNotMatch(src, /studentCaseAbsent/i);
  assert.doesNotMatch(src, /studentCaseEarly/i);
});

test('session student case service creates and resolves source notifications', async () => {
  const originals = {
    getDataById: schoolDataService.getDataById,
    getClassSessions: schoolDataService.getClassSessions,
    create: schoolRepositories.sessionStudentCases.create,
    update: schoolRepositories.sessionStudentCases.update,
    getById: schoolRepositories.sessionStudentCases.getById,
    upsertSourceNotification: notificationService.upsertSourceNotification,
    resolveSourceNotification: notificationService.resolveSourceNotification
  };
  const user = { id: 'USR-1', personId: 'TCH-1', activeOrgId: '900000', username: 'teacher' };
  let upsertPayload = null;
  let resolvePayload = null;
  try {
    schoolDataService.getDataById = async (entityType) => {
      if (entityType === 'classes') {
        return {
          id: 'CLS-1',
          orgId: '900000',
          title: 'Class A',
          instructors: [{ personId: 'TCH-1', name: 'Teacher One' }]
        };
      }
      return null;
    };
    schoolDataService.getClassSessions = async () => ([{
      sessionId: 'SES-1',
      date: '2026-06-23',
      startTime: '09:00',
      endTime: '11:00',
      roster: [{ personId: 'STU-1', name: 'Student One', attendance: 'present' }]
    }]);
    schoolRepositories.sessionStudentCases.create = async (payload) => ({ id: 'SSC-1', ...payload });
    schoolRepositories.sessionStudentCases.update = async (_id, payload) => ({ id: 'SSC-1', ...payload });
    schoolRepositories.sessionStudentCases.getById = async () => ({
      id: 'SSC-1',
      orgId: '900000',
      classId: 'CLS-1',
      sessionId: 'SES-1',
      studentPersonId: 'STU-1',
      studentName: 'Student One',
      classTitle: 'Class A',
      sessionDate: '2026-06-23',
      status: 'open',
      summary: 'Needs support',
      lifecycle: [],
      audit: {}
    });
    notificationService.upsertSourceNotification = async (payload) => {
      upsertPayload = payload;
      return { id: 'SN-1', ...payload };
    };
    notificationService.resolveSourceNotification = async (payload) => {
      resolvePayload = payload;
      return { id: 'SN-1', ...payload };
    };

    const created = await sessionStudentCaseService.saveCase({
      classId: 'CLS-1',
      sessionId: 'SES-1',
      input: { studentPersonId: 'STU-1', category: 'learning', summary: 'Needs support', details: 'Extra practice needed.' },
      reqUser: user
    });
    assert.equal(created.id, 'SSC-1');
    assert.equal(created.studentPersonId, 'STU-1');
    assert.equal(upsertPayload.sourceType, 'student_session_case');
    assert.equal(upsertPayload.sourceId, 'SSC-1');

    const savedAndResolved = await sessionStudentCaseService.saveCase({
      classId: 'CLS-1',
      sessionId: 'SES-1',
      caseId: 'SSC-1',
      input: { studentPersonId: 'STU-1', category: 'learning', summary: 'Needs support', details: 'Resolved from modal.', status: 'resolved' },
      reqUser: user
    });
    assert.equal(savedAndResolved.status, 'resolved');
    assert.equal(savedAndResolved.lifecycle.at(-1).action, 'case_resolved');
    assert.equal(resolvePayload.sourceType, 'student_session_case');
    assert.equal(resolvePayload.sourceId, 'SSC-1');

    resolvePayload = null;
    const resolved = await sessionStudentCaseService.updateStatus({
      classId: 'CLS-1',
      sessionId: 'SES-1',
      caseId: 'SSC-1',
      status: 'resolved',
      reqUser: user
    });
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolvePayload.sourceType, 'student_session_case');
    assert.equal(resolvePayload.sourceId, 'SSC-1');
  } finally {
    schoolDataService.getDataById = originals.getDataById;
    schoolDataService.getClassSessions = originals.getClassSessions;
    schoolRepositories.sessionStudentCases.create = originals.create;
    schoolRepositories.sessionStudentCases.update = originals.update;
    schoolRepositories.sessionStudentCases.getById = originals.getById;
    notificationService.upsertSourceNotification = originals.upsertSourceNotification;
    notificationService.resolveSourceNotification = originals.resolveSourceNotification;
  }
});
