const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const schoolRepositories = require('../packages/school/MVC/repositories/school');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const classEnrollmentReadService = require('../packages/school/MVC/services/school/classEnrollmentReadService');
const taskService = require('../packages/school/MVC/services/school/taskService');
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

test('session student case service creates and resolves source tasks', async () => {
  const originals = {
    getDataById: schoolDataService.getDataById,
    getClassSessions: schoolDataService.getClassSessions,
    create: schoolRepositories.sessionStudentCases.create,
    update: schoolRepositories.sessionStudentCases.update,
    getById: schoolRepositories.sessionStudentCases.getById,
    upsertSourceTask: taskService.upsertSourceTask,
    resolveSourceTask: taskService.resolveSourceTask
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
    taskService.upsertSourceTask = async (payload) => {
      upsertPayload = payload;
      return { id: 'TSK-1', ...payload };
    };
    taskService.resolveSourceTask = async (payload) => {
      resolvePayload = payload;
      return { id: 'TSK-1', ...payload };
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
    taskService.upsertSourceTask = originals.upsertSourceTask;
    taskService.resolveSourceTask = originals.resolveSourceTask;
  }
});

test('session student case save accepts enrolled students missing from persisted roster', async () => {
  const originals = {
    getDataById: schoolDataService.getDataById,
    getClassSessions: schoolDataService.getClassSessions,
    fetchData: schoolDataService.fetchData,
    listActiveStudentIdsForClass: classEnrollmentReadService.listActiveStudentIdsForClass,
    create: schoolRepositories.sessionStudentCases.create,
    upsertSourceTask: taskService.upsertSourceTask
  };
  const user = { id: 'USR-1', personId: 'TCH-1', activeOrgId: '900000', username: 'teacher' };
  let createdPayloads = [];
  try {
    schoolDataService.getDataById = async (entityType) => {
      if (entityType === 'classes') {
        return {
          id: 'CLS-1',
          orgId: '900000',
          title: 'Class A',
          instructors: [{ personId: 'TCH-1', name: 'Teacher One' }],
          enrollment: {
            students: [
              { studentId: 'REG-1', personId: 'STU-1', status: 'enrolled' },
              { studentId: 'REG-3', personId: 'STU-3', status: 'enrolled' }
            ]
          }
        };
      }
      return null;
    };
    schoolDataService.getClassSessions = async () => ([{
      sessionId: 'SES-1',
      date: '2026-06-23',
      startTime: '09:00',
      endTime: '11:00',
      roster: [{ personId: 'STU-1', name: 'Student One', attendance: 'present' }],
      gradebooks: [{ scores: { 'STU-4': 10 } }]
    }]);
    schoolDataService.fetchData = async (entityType) => {
      if (entityType === 'students') {
        return [
          { id: 'REG-1', personId: 'STU-1' },
          { id: 'REG-2', personId: 'STU-2' }
        ];
      }
      return [];
    };
    classEnrollmentReadService.listActiveStudentIdsForClass = async () => ({
      source: 'canonical',
      studentIds: new Set(['REG-1', 'REG-2']),
      usedFallback: false
    });
    schoolRepositories.sessionStudentCases.create = async (payload) => {
      createdPayloads.push(payload);
      return { id: `SSC-${createdPayloads.length}`, ...payload };
    };
    taskService.upsertSourceTask = async (payload) => ({ id: 'TSK-1', ...payload });

    // Enrollment period student missing from stored roster.
    const fromEnrollment = await sessionStudentCaseService.saveCase({
      classId: 'CLS-1',
      sessionId: 'SES-1',
      input: { studentPersonId: 'STU-2', category: 'learning', summary: 'Needs support', details: 'Enrolled but not yet on stored roster.' },
      reqUser: user
    });
    assert.equal(fromEnrollment.studentPersonId, 'STU-2');

    // Inline class enrollment list personId (no period mapping required).
    const fromClassList = await sessionStudentCaseService.saveCase({
      classId: 'CLS-1',
      sessionId: 'SES-1',
      input: { studentPersonId: 'STU-3', category: 'learning', summary: 'Class list student' },
      reqUser: user
    });
    assert.equal(fromClassList.studentPersonId, 'STU-3');

    // Gradebook-only person shown on Manage Session for fixed classes.
    const fromGradebook = await sessionStudentCaseService.saveCase({
      classId: 'CLS-1',
      sessionId: 'SES-1',
      input: { studentPersonId: 'STU-4', category: 'learning', summary: 'Gradebook student' },
      reqUser: user
    });
    assert.equal(fromGradebook.studentPersonId, 'STU-4');

    // Empty person id is still rejected.
    await assert.rejects(
      () => sessionStudentCaseService.saveCase({
        classId: 'CLS-1',
        sessionId: 'SES-1',
        input: { studentPersonId: '', category: 'learning', summary: 'Missing student' },
        reqUser: user
      }),
      /Selected student is not on this session roster/
    );
  } finally {
    schoolDataService.getDataById = originals.getDataById;
    schoolDataService.getClassSessions = originals.getClassSessions;
    schoolDataService.fetchData = originals.fetchData;
    classEnrollmentReadService.listActiveStudentIdsForClass = originals.listActiveStudentIdsForClass;
    schoolRepositories.sessionStudentCases.create = originals.create;
    taskService.upsertSourceTask = originals.upsertSourceTask;
  }
});
