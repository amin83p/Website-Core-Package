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
  const controller = read('packages/school/MVC/controllers/school/classController.js');
  assert.match(src, /\/:id\/sessions\/:sessionId\/cases/);
  assert.match(src, /classCtrl\.listSessionStudentCases/);
  assert.match(src, /classCtrl\.saveSessionStudentCase/);
  assert.match(src, /classCtrl\.updateSessionStudentCaseStatus/);
  assert.match(src, /router\.delete\('\/:id\/sessions\/:sessionId\/cases\/:caseId'/);
  assert.match(src, /classCtrl\.deleteSessionStudentCase/);
  assert.match(src, /requireAccess\(SECTIONS\.SCHOOL_SESSIONS, OPERATIONS\.READ_ALL\)/);
  assert.match(src, /requireAccess\(SECTIONS\.SCHOOL_SESSIONS, OPERATIONS\.UPDATE\)/);
  assert.match(src, /requireAccess\(SECTIONS\.SCHOOL_SESSIONS, OPERATIONS\.DELETE\)/);
  assert.match(controller, /Only administrators can delete student cases/);
  assert.match(controller, /sessionStudentCaseService\.deleteCase/);
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
  assert.match(src, /name="studentCaseSeverity"/);
  assert.match(src, /id="studentCaseDetailPresets"/);
  assert.match(src, /id="studentCaseDetails"/);
  assert.match(src, /student-case-details-textarea/);
  assert.match(src, /Pick a common issue below, then adjust the detail text if needed/);
  assert.doesNotMatch(src, /id="studentCaseDetailsWrap"/);
  assert.match(src, /studentCaseDetailPresets.*addEventListener\('change'/s);
  assert.match(src, /function collectStudentCaseDetailsValue\(\)[\s\S]*?getElementById\('studentCaseDetails'\)/);
  assert.match(src, /Issue Required/);
  assert.match(src, /canDeleteStudentCases/);
  assert.match(src, /btn-delete-student-case/);
  assert.match(src, /method: 'DELETE'/);
  assert.match(src, /function confirmStudentCaseDelete\(row\)/);
  assert.doesNotMatch(src, /id="studentCaseSummary"/);
  assert.doesNotMatch(src, /studentCaseLate/i);
  assert.doesNotMatch(src, /studentCaseAbsent/i);
  assert.doesNotMatch(src, /studentCaseEarly/i);
});

test('session student case delete removes its source task and scoped case record', async () => {
  const originals = {
    getById: schoolRepositories.sessionStudentCases.getById,
    remove: schoolRepositories.sessionStudentCases.remove,
    deleteSourceTask: taskService.deleteSourceTask
  };
  const user = { id: 'ADM-1', activeOrgId: '900000', roles: ['admin'] };
  let removedId = '';
  let deletedTask = null;
  try {
    schoolRepositories.sessionStudentCases.getById = async () => ({
      id: 'SSC-1',
      orgId: '900000',
      classId: 'CLS-1',
      sessionId: 'SES-1',
      studentPersonId: 'STU-1',
      studentName: 'Student One'
    });
    schoolRepositories.sessionStudentCases.remove = async (id) => {
      removedId = id;
      return true;
    };
    taskService.deleteSourceTask = async (payload) => {
      deletedTask = payload;
      return true;
    };

    const deleted = await sessionStudentCaseService.deleteCase({
      classId: 'CLS-1',
      sessionId: 'SES-1',
      caseId: 'SSC-1',
      reqUser: user
    });

    assert.equal(deleted.id, 'SSC-1');
    assert.equal(removedId, 'SSC-1');
    assert.equal(deletedTask.sourceType, 'student_session_case');
    assert.equal(deletedTask.sourceId, 'SSC-1');
  } finally {
    schoolRepositories.sessionStudentCases.getById = originals.getById;
    schoolRepositories.sessionStudentCases.remove = originals.remove;
    taskService.deleteSourceTask = originals.deleteSourceTask;
  }
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
      input: { studentPersonId: 'STU-1', category: 'learning', details: 'Extra practice needed.' },
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
      input: { studentPersonId: 'STU-1', category: 'learning', details: 'Resolved from modal.', status: 'resolved' },
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
      input: { studentPersonId: 'STU-2', category: 'learning', details: 'Enrolled but not yet on stored roster.' },
      reqUser: user
    });
    assert.equal(fromEnrollment.studentPersonId, 'STU-2');

    // Inline class enrollment list personId (no period mapping required).
    const fromClassList = await sessionStudentCaseService.saveCase({
      classId: 'CLS-1',
      sessionId: 'SES-1',
      input: { studentPersonId: 'STU-3', category: 'learning', details: 'Class list student issue.' },
      reqUser: user
    });
    assert.equal(fromClassList.studentPersonId, 'STU-3');

    // Gradebook-only person shown on Manage Session for fixed classes.
    const fromGradebook = await sessionStudentCaseService.saveCase({
      classId: 'CLS-1',
      sessionId: 'SES-1',
      input: { studentPersonId: 'STU-4', category: 'learning', details: 'Gradebook student issue.' },
      reqUser: user
    });
    assert.equal(fromGradebook.studentPersonId, 'STU-4');

    // Empty person id is still rejected.
    await assert.rejects(
      () => sessionStudentCaseService.saveCase({
        classId: 'CLS-1',
        sessionId: 'SES-1',
        input: { studentPersonId: '', category: 'learning', details: 'Missing student' },
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
