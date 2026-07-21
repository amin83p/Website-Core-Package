'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const schoolDataService = require('../MVC/services/school/schoolDataService');
const reportInstanceSaveService = require('../MVC/services/school/reportInstanceSaveService');
const reportViewService = require('../MVC/services/school/reportViewService');

function withPatched(target, replacements, callback) {
  const originals = {};
  Object.entries(replacements).forEach(([key, value]) => {
    originals[key] = target[key];
    target[key] = value;
  });
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      Object.entries(originals).forEach(([key, value]) => {
        target[key] = value;
      });
    });
}

test('persistInstanceAnswers skips sharedAnswers update when siblings are not draft', async () => {
  const assignmentUpdates = [];
  const instanceUpdates = [];
  const template = {
    id: 'TPL-1',
    schema: {
      fields: [
        { id: 'shared_note', type: 'textarea', sharedAcrossStudents: true },
        { id: 'private_note', type: 'textarea', sharedAcrossStudents: false }
      ]
    }
  };
  const assignment = {
    id: 'ASN-1',
    reportScope: 'each_student',
    sharedAnswers: { shared_note: 'original shared' }
  };
  const instance = {
    id: 'RI-1',
    assignmentId: 'ASN-1',
    status: 'draft',
    answers: { private_note: 'old private' },
    prefillSnapshot: {}
  };

  await withPatched(schoolDataService, {
    fetchData: async (entityType) => {
      if (entityType === 'reportInstances') {
        return [
          { id: 'RI-1', assignmentId: 'ASN-1', status: 'draft' },
          { id: 'RI-2', assignmentId: 'ASN-1', status: 'submitted' }
        ];
      }
      return [];
    },
    updateData: async (entityType, id, payload) => {
      if (entityType === 'reportAssignments') {
        assignmentUpdates.push({ id, payload });
        return { ...assignment, ...payload };
      }
      if (entityType === 'reportInstances') {
        instanceUpdates.push({ id, payload });
        return { ...instance, ...payload };
      }
      return payload;
    }
  }, async () => {
    const result = await reportInstanceSaveService.persistInstanceAnswers({
      instance,
      template,
      assignment,
      body: {
        field__shared_note: 'changed shared',
        field__private_note: 'new private'
      },
      submitAction: 'save',
      reqUser: { id: 'U1', activeOrgId: '900000' }
    });

    assert.equal(result.sharedAnswersSkipped, true);
    assert.match(String(result.sharedAnswersSkipReason || ''), /read-only/i);
    assert.equal(assignmentUpdates.length, 0, 'sharedAnswers must not be written');
    assert.equal(instanceUpdates.length, 1);
    assert.equal(instanceUpdates[0].payload.answers.private_note, 'new private');
    assert.equal(result.sharedAnswers.shared_note, 'original shared');
  });
});

test('persistInstanceAnswers writes sharedAnswers when all siblings are draft', async () => {
  const assignmentUpdates = [];
  const template = {
    id: 'TPL-1',
    schema: {
      fields: [
        { id: 'shared_note', type: 'textarea', sharedAcrossStudents: true },
        { id: 'private_note', type: 'textarea', sharedAcrossStudents: false }
      ]
    }
  };
  const assignment = {
    id: 'ASN-1',
    reportScope: 'each_student',
    sharedAnswers: { shared_note: 'original shared' }
  };
  const instance = {
    id: 'RI-1',
    assignmentId: 'ASN-1',
    status: 'draft',
    answers: { private_note: 'old private' },
    prefillSnapshot: {}
  };

  await withPatched(schoolDataService, {
    fetchData: async (entityType) => {
      if (entityType === 'reportInstances') {
        return [
          { id: 'RI-1', assignmentId: 'ASN-1', status: 'draft' },
          { id: 'RI-2', assignmentId: 'ASN-1', status: 'draft' }
        ];
      }
      return [];
    },
    updateData: async (entityType, id, payload) => {
      if (entityType === 'reportAssignments') {
        assignmentUpdates.push({ id, payload });
        return { ...assignment, ...payload };
      }
      if (entityType === 'reportInstances') {
        return { ...instance, ...payload };
      }
      return payload;
    }
  }, async () => {
    const result = await reportInstanceSaveService.persistInstanceAnswers({
      instance,
      template,
      assignment,
      body: {
        field__shared_note: 'changed shared',
        field__private_note: 'new private'
      },
      submitAction: 'save',
      reqUser: { id: 'U1', activeOrgId: '900000' }
    });

    assert.equal(result.sharedAnswersSkipped, false);
    assert.equal(assignmentUpdates.length, 1);
    assert.equal(assignmentUpdates[0].payload.sharedAnswers.shared_note, 'changed shared');
  });
});

test('persistInstanceAnswers writes sharedAnswers for admin editors despite non-draft siblings', async () => {
  const assignmentUpdates = [];
  const template = {
    id: 'TPL-1',
    schema: {
      fields: [
        { id: 'shared_note', type: 'textarea', sharedAcrossStudents: true },
        { id: 'private_note', type: 'textarea', sharedAcrossStudents: false }
      ]
    }
  };
  const assignment = {
    id: 'ASN-1',
    reportScope: 'each_student',
    sharedAnswers: { shared_note: 'original shared' }
  };
  const instance = {
    id: 'RI-1',
    assignmentId: 'ASN-1',
    status: 'submitted',
    answers: { private_note: 'old private' },
    prefillSnapshot: {}
  };

  await withPatched(schoolDataService, {
    fetchData: async (entityType) => {
      if (entityType === 'reportInstances') {
        return [
          { id: 'RI-1', assignmentId: 'ASN-1', status: 'submitted' },
          { id: 'RI-2', assignmentId: 'ASN-1', status: 'submitted' }
        ];
      }
      return [];
    },
    updateData: async (entityType, id, payload) => {
      if (entityType === 'reportAssignments') {
        assignmentUpdates.push({ id, payload });
        return { ...assignment, ...payload };
      }
      if (entityType === 'reportInstances') {
        return { ...instance, ...payload };
      }
      return payload;
    }
  }, async () => {
    await withPatched(reportViewService, {
      isReportInstanceAdminEditor: async () => true
    }, async () => {
      const result = await reportInstanceSaveService.persistInstanceAnswers({
        instance,
        template,
        assignment,
        body: {
          field__shared_note: 'admin shared change',
          field__private_note: 'admin private'
        },
        submitAction: 'submit',
        reqUser: { id: 'ADMIN-1', activeOrgId: '900000' }
      });

      assert.equal(result.sharedAnswersSkipped, false);
      assert.equal(assignmentUpdates.length, 1);
      assert.equal(assignmentUpdates[0].payload.sharedAnswers.shared_note, 'admin shared change');
    });
  });
});

test('isTeacherModifiableInstanceStatus is draft-only', () => {
  assert.equal(reportViewService.isTeacherModifiableInstanceStatus('draft'), true);
  assert.equal(reportViewService.isTeacherModifiableInstanceStatus('submitted'), false);
  assert.equal(reportViewService.isTeacherModifiableInstanceStatus('locked'), false);
  assert.equal(reportViewService.isTeacherModifiableInstanceStatus('archived'), false);
});
