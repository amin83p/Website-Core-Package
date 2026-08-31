const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('node:path');

const PACKAGE_ROOT = path.resolve(__dirname, '..');

const schoolRepositories = require('../MVC/repositories/school');
const schoolDataService = require('../MVC/services/school/schoolDataService');
const classEnrollmentReadService = require('../MVC/services/school/classEnrollmentReadService');
const taskService = require('../MVC/services/school/taskService');
const sessionStudentCaseService = require('../MVC/services/school/sessionStudentCaseService');
const sessionStudentCaseModel = require('../MVC/models/school/sessionStudentCaseModel');
const sessionStudentCaseResultVisibilityService = require('../MVC/services/school/sessionStudentCaseResultVisibilityService');

const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.manifest.json'), 'utf8'));

function read(file) {
  return fs.readFileSync(path.join(PACKAGE_ROOT, file), 'utf8');
}

test('school manifest declares session student cases data entity', () => {
  const entity = (manifest.dataEntities || []).find((row) => row.entityType === 'sessionStudentCases');
  assert.ok(entity);
  assert.equal(entity.collectionName, 'schoolSessionStudentCases');
});

test('class routes expose session student case endpoints under SCHOOL_SESSION_STUDENT_CASES', () => {
  const src = read('MVC/routes/classRoutes.js');
  const controller = read('MVC/controllers/school/classController.js');
  assert.match(src, /\/:id\/sessions\/:sessionId\/cases/);
  assert.match(src, /classCtrl\.listSessionStudentCases/);
  assert.match(src, /classCtrl\.saveSessionStudentCase/);
  assert.match(src, /classCtrl\.updateSessionStudentCaseStatus/);
  assert.match(src, /router\.delete\('\/:id\/sessions\/:sessionId\/cases\/:caseId'/);
  assert.match(src, /classCtrl\.deleteSessionStudentCase/);
  assert.match(src, /requireAccess\(SECTIONS\.SCHOOL_SESSION_STUDENT_CASES, OPERATIONS\.READ_ALL\)/);
  assert.match(src, /requireAccess\(SECTIONS\.SCHOOL_SESSION_STUDENT_CASES, OPERATIONS\.CREATE\)/);
  assert.match(src, /requireAccess\(SECTIONS\.SCHOOL_SESSION_STUDENT_CASES, OPERATIONS\.UPDATE\)/);
  assert.match(src, /requireAccess\(SECTIONS\.SCHOOL_SESSION_STUDENT_CASES, OPERATIONS\.DELETE\)/);
  assert.match(src, /requireCaseStatusMutationAccess/);
  assert.match(controller, /studentCaseCapabilities/);
  assert.match(controller, /sessionStudentCaseAccessService/);
  assert.match(controller, /sessionStudentCaseService\.deleteCase/);
  assert.match(controller, /sessionStudentCaseSummary:\s*sessionStudentCaseService\.summarizeSessionCases\(sessionStudentCases\)/);
});

test('session manager renders student cases tab, modal, and avoids attendance duplicate fields', () => {
  const src = read('MVC/views/school/class/sessionManager.ejs');
  const modalShell = read('MVC/views/school/sessionStudentCase/partials/sessionStudentCaseModal.ejs');
  const modalBody = read('MVC/views/school/sessionStudentCase/partials/sessionStudentCaseModalBody.ejs');
  const modalFooter = read('MVC/views/school/sessionStudentCase/partials/sessionStudentCaseModalFooter.ejs');
  const modalAssets = read('MVC/views/school/sessionStudentCase/partials/sessionStudentCaseModalAssets.ejs');
  const clientSource = read('public/scripts/sessionStudentCaseModalClient.js');
  assert.match(src, /data-session-panel="student-cases"/);
  assert.match(src, /id="session-panel-student-cases"/);
  assert.match(src, /sessionStudentCaseModalAssets/);
  assert.match(modalAssets, /school\/sessionStudentCase\/partials\/sessionStudentCaseModal/);
  assert.match(modalShell, /sessionStudentCaseModalBody/);
  assert.match(modalShell, /sessionStudentCaseModalFooter/);
  assert.match(modalShell, /id="studentCaseModal"/);
  assert.match(src, /id="btnOpenStudentCaseWizard"/);
  assert.match(clientSource, /btnResolveStudentCase/);
  assert.match(clientSource, /payload\.status = 'resolved'/);
  assert.match(modalBody, /name="studentCaseSeverity"/);
  assert.match(modalBody, /id="studentCaseDetailPresets"/);
  assert.match(modalBody, /id="studentCaseDetails"/);
  assert.match(modalBody, /student-case-details-textarea/);
  assert.match(modalBody, /Pick a common issue below, then adjust the detail text if needed/);
  assert.match(modalBody, /id="studentCaseResultNote"/);
  assert.match(modalBody, /id="studentCaseRevealResultToCreator"/);
  assert.match(modalBody, /Reveal the Result to the Creator/);
  assert.match(clientSource, /collectResultPayload/);
  assert.match(clientSource, /canViewResultNote/);
  assert.match(modalBody, /id="studentCaseLocked"/);
  assert.match(clientSource, /studentCaseLocked/);
  assert.match(clientSource, /canEditCase/);
  assert.match(clientSource, /apiMode !== 'session'/);
  assert.match(clientSource, /setResolveVisible/);
  assert.match(src, /row\.locked === true/);
  assert.match(src, /canOpenRow/);
  assert.match(src, /canReadStudentCases/);
  assert.match(src, /SessionStudentCaseModal\.openRemote\(caseId\)/);
  assert.doesNotMatch(modalBody, /id="studentCaseDetailsWrap"/);
  assert.match(clientSource, /Issue Required/);
  assert.match(src, /canDeleteStudentCases/);
  assert.match(src, /studentCaseCapabilities/);
  assert.match(src, /canCreateStudentCases/);
  assert.match(src, /canResolveStudentCases/);
  assert.match(src, /btn-delete-student-case/);
  assert.match(src, /method: 'DELETE'/);
  assert.match(src, /function confirmStudentCaseDelete\(row\)/);
  assert.doesNotMatch(src, /id="studentCaseSummary"/);
  assert.doesNotMatch(src, /studentCaseLate/i);
  assert.doesNotMatch(src, /studentCaseAbsent/i);
  assert.doesNotMatch(src, /studentCaseEarly/i);
  assert.match(src, /id="sessionStudentCasesNavBadges"/);
  assert.match(src, /id="sessionStudentCasesActiveNavBadge"/);
  assert.match(src, /id="sessionStudentCasesResolvedNavBadge"/);
  assert.match(src, /session-nav-badge-group/);
  assert.match(src, /sessionStudentCasesActiveNavBadge.*bg-danger/s);
  assert.match(src, /sessionStudentCasesResolvedNavBadge.*bg-success/s);
  assert.match(src, /function syncSessionStudentCasesNavBadge\(/);
  assert.match(src, /function isActiveStudentCaseStatus\(/);
  assert.match(src, /syncSessionStudentCasesNavBadge\(\)/);
});

test('session student case model sanitizes result note and reveal flag defaults', () => {
  const sanitized = sessionStudentCaseModel.sanitizeCaseInput({
    orgId: 'ORG-1',
    classId: 'CLS-1',
    sessionId: 'SES-1',
    details: 'Student struggled with the lesson.',
    resultNote: '  Follow-up scheduled. ',
    revealResultToCreator: 'true'
  });
  assert.equal(sanitized.resultNote, 'Follow-up scheduled.');
  assert.equal(sanitized.revealResultToCreator, true);
  assert.equal(sanitized.locked, false);
});

test('session student case model sanitizes locked flag', () => {
  const sanitized = sessionStudentCaseModel.sanitizeCaseInput({
    orgId: 'ORG-1',
    classId: 'CLS-1',
    sessionId: 'SES-1',
    details: 'Resolved and locked.',
    locked: 'true'
  });
  assert.equal(sanitized.locked, true);
});

test('summarizeSessionCases splits active and resolved counts for nav badges', () => {
  const summary = sessionStudentCaseService.summarizeSessionCases([
    { status: 'open', severity: 'info' },
    { status: 'in_progress', severity: 'warning' },
    { status: 'resolved', severity: 'info' },
    { status: 'cancelled', severity: 'info' }
  ]);
  assert.equal(summary.totalCount, 4);
  assert.equal(summary.activeCount, 2);
  assert.equal(summary.resolvedCount, 2);
  assert.equal(summary.hasCases, true);
  assert.equal(summary.hasActiveCases, true);

  const resolvedOnly = sessionStudentCaseService.summarizeSessionCases([
    { status: 'resolved', severity: 'info' }
  ]);
  assert.equal(resolvedOnly.activeCount, 0);
  assert.equal(resolvedOnly.resolvedCount, 1);
});

test('session student case result visibility redacts fields by viewer access', () => {
  const caseRow = {
    id: 'SSC-1',
    resultNote: 'Resolved after coaching.',
    revealResultToCreator: true,
    audit: { createdBy: 'USR_CREATOR' }
  };
  const resolverView = sessionStudentCaseResultVisibilityService.redactCaseForViewer(caseRow, {
    reqUser: { id: 'USR_RESOLVER' },
    capabilities: { canResolve: true }
  });
  assert.equal(resolverView.resultNote, 'Resolved after coaching.');
  assert.equal(resolverView.revealResultToCreator, true);

  const creatorView = sessionStudentCaseResultVisibilityService.redactCaseForViewer(caseRow, {
    reqUser: { id: 'USR_CREATOR' },
    capabilities: { canResolve: false }
  });
  assert.equal(creatorView.resultNote, 'Resolved after coaching.');
  assert.equal(creatorView.revealResultToCreator, undefined);

  const hiddenView = sessionStudentCaseResultVisibilityService.redactCaseForViewer(caseRow, {
    reqUser: { id: 'USR_OTHER' },
    capabilities: { canResolve: false }
  });
  assert.equal(hiddenView.resultNote, undefined);
  assert.equal(hiddenView.revealResultToCreator, undefined);
});

test('applyResultFieldsForSave strips resolver-only writes from non-resolvers', () => {
  const existing = {
    resultNote: 'Existing note',
    revealResultToCreator: false
  };
  const blocked = sessionStudentCaseResultVisibilityService.applyResultFieldsForSave({
    input: {
      resultNote: 'Tampered note',
      revealResultToCreator: true,
      locked: true
    },
    existing,
    canManageResultFields: false
  });
  assert.equal(blocked.resultNote, 'Existing note');
  assert.equal(blocked.revealResultToCreator, false);
  assert.equal(blocked.locked, false);

  const allowed = sessionStudentCaseResultVisibilityService.applyResultFieldsForSave({
    input: {
      resultNote: 'Updated note',
      revealResultToCreator: true,
      locked: true
    },
    existing,
    canManageResultFields: true,
    nextStatus: 'resolved'
  });
  assert.equal(allowed.resultNote, 'Updated note');
  assert.equal(allowed.revealResultToCreator, true);
  assert.equal(allowed.locked, true);
});

test('locked resolved case permissions require resolve access for edit and delete', () => {
  const lockedCase = { status: 'resolved', locked: true };
  const unlockedCase = { status: 'resolved', locked: false };
  const editorCaps = { canUpdate: true, canDelete: true, canResolve: false };
  const resolverCaps = { canUpdate: true, canDelete: true, canResolve: true };

  assert.equal(sessionStudentCaseResultVisibilityService.canEditCase(lockedCase, editorCaps), false);
  assert.equal(sessionStudentCaseResultVisibilityService.canDeleteCase(lockedCase, editorCaps), false);
  assert.equal(sessionStudentCaseResultVisibilityService.canEditCase(unlockedCase, editorCaps), true);
  assert.equal(sessionStudentCaseResultVisibilityService.canDeleteCase(unlockedCase, editorCaps), true);
  assert.equal(sessionStudentCaseResultVisibilityService.canEditCase(lockedCase, resolverCaps), true);
  assert.equal(sessionStudentCaseResultVisibilityService.canDeleteCase(lockedCase, resolverCaps), true);

  assert.throws(
    () => sessionStudentCaseResultVisibilityService.assertCaseMutationAllowed(lockedCase, editorCaps, { action: 'edit' }),
    /locked/i
  );
});

test('reopening a locked case clears locked flag on save', () => {
  const reopened = sessionStudentCaseResultVisibilityService.applyResultFieldsForSave({
    input: {},
    existing: { status: 'resolved', locked: true },
    canManageResultFields: false,
    nextStatus: 'reopened'
  });
  assert.equal(reopened.locked, false);
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
  let deletedTaskOptions = null;
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
    taskService.deleteSourceTask = async (payload, reqUser, options = {}) => {
      deletedTask = payload;
      deletedTaskOptions = options;
      return true;
    };

    const deleted = await sessionStudentCaseService.deleteCase({
      classId: 'CLS-1',
      sessionId: 'SES-1',
      caseId: 'SSC-1',
      reqUser: user,
      capabilities: { canDelete: true }
    });

    assert.equal(deleted.id, 'SSC-1');
    assert.equal(removedId, 'SSC-1');
    assert.equal(deletedTask.sourceType, 'student_session_case');
    assert.equal(deletedTask.sourceId, 'SSC-1');
    assert.equal(deletedTaskOptions?.skipAdminCheck, true);
  } finally {
    schoolRepositories.sessionStudentCases.getById = originals.getById;
    schoolRepositories.sessionStudentCases.remove = originals.remove;
    taskService.deleteSourceTask = originals.deleteSourceTask;
  }
});

test('deleteCase rejects locked resolved case without resolve access', async () => {
  const originals = {
    getById: schoolRepositories.sessionStudentCases.getById
  };
  try {
    schoolRepositories.sessionStudentCases.getById = async () => ({
      id: 'SSC-LOCKED',
      orgId: '900000',
      classId: 'CLS-1',
      sessionId: 'SES-1',
      status: 'resolved',
      locked: true
    });
    await assert.rejects(
      () => sessionStudentCaseService.deleteCase({
        classId: 'CLS-1',
        sessionId: 'SES-1',
        caseId: 'SSC-LOCKED',
        reqUser: { id: 'USR-1', activeOrgId: '900000' },
        capabilities: { canDelete: true, canResolve: false }
      }),
      /locked/i
    );
  } finally {
    schoolRepositories.sessionStudentCases.getById = originals.getById;
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
    assert.ok(created.audit?.createDateTime);
    assert.ok(created.audit?.lastUpdateDateTime);
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
    assert.ok(savedAndResolved.audit?.lastUpdateDateTime);
    assert.equal(resolvePayload.sourceType, 'student_session_case');
    assert.equal(resolvePayload.sourceId, 'SSC-1');

    schoolRepositories.sessionStudentCases.getById = async () => ({
      id: 'SSC-1',
      orgId: '900000',
      classId: 'CLS-1',
      sessionId: 'SES-1',
      studentPersonId: 'STU-1',
      studentName: 'Student One',
      classTitle: 'Class A',
      sessionDate: '2026-06-23',
      status: 'resolved',
      locked: true,
      resultNote: 'Initial note',
      summary: 'Needs support',
      details: 'Resolved from modal.',
      lifecycle: savedAndResolved.lifecycle || [],
      audit: {}
    });
    const updatedResultFields = await sessionStudentCaseService.saveCase({
      classId: 'CLS-1',
      sessionId: 'SES-1',
      caseId: 'SSC-1',
      input: {
        studentPersonId: 'STU-1',
        category: 'learning',
        details: 'Resolved from modal.',
        resultNote: 'Updated result note',
        revealResultToCreator: true,
        locked: false
      },
      reqUser: user,
      canManageResultFields: true,
      capabilities: { canResolve: true }
    });
    assert.equal(updatedResultFields.status, 'resolved');
    assert.equal(updatedResultFields.resultNote, 'Updated result note');
    assert.equal(updatedResultFields.revealResultToCreator, true);
    assert.equal(updatedResultFields.locked, false);
    assert.equal(updatedResultFields.lifecycle.at(-1).action, 'case_updated');

    resolvePayload = null;
    schoolRepositories.sessionStudentCases.getById = async () => ({
      id: 'SSC-1',
      orgId: '900000',
      classId: 'CLS-1',
      sessionId: 'SES-1',
      studentPersonId: 'STU-1',
      status: 'resolved',
      locked: false,
      lifecycle: updatedResultFields.lifecycle || [],
      audit: {}
    });
    const resolved = await sessionStudentCaseService.updateStatus({
      classId: 'CLS-1',
      sessionId: 'SES-1',
      caseId: 'SSC-1',
      status: 'resolved',
      reqUser: user,
      capabilities: { canResolve: true }
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

    // Empty person id is rejected for student-specific categories.
    await assert.rejects(
      () => sessionStudentCaseService.saveCase({
        classId: 'CLS-1',
        sessionId: 'SES-1',
        input: { studentPersonId: '', category: 'learning', details: 'Missing student' },
        reqUser: user
      }),
      /Select at least one student for this case category/
    );

    const sessionWide = await sessionStudentCaseService.saveCase({
      classId: 'CLS-1',
      sessionId: 'SES-1',
      input: { studentPersonId: '', category: 'technology', details: 'Projector would not connect.' },
      reqUser: user
    });
    assert.equal(sessionWide.studentPersonId, '');
    assert.match(sessionWide.summary, /Technology:/);
  } finally {
    schoolDataService.getDataById = originals.getDataById;
    schoolDataService.getClassSessions = originals.getClassSessions;
    schoolDataService.fetchData = originals.fetchData;
    classEnrollmentReadService.listActiveStudentIdsForClass = originals.listActiveStudentIdsForClass;
    schoolRepositories.sessionStudentCases.create = originals.create;
    taskService.upsertSourceTask = originals.upsertSourceTask;
  }
});

test('session student case presets mark session-wide categories as student-optional', () => {
  const presetService = require('../MVC/services/school/sessionStudentCasePresetService');
  assert.equal(presetService.categoryRequiresStudent('learning'), true);
  assert.equal(presetService.categoryRequiresStudent('behavior'), true);
  assert.equal(presetService.categoryRequiresStudent('technology'), false);
  assert.equal(presetService.categoryRequiresStudent('lesson_delivery'), false);
  assert.deepEqual(presetService.getPresetConfig().studentOptionalCategories, [
    'technology',
    'resources',
    'lesson_delivery',
    'other'
  ]);
});

