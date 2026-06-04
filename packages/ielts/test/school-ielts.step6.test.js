const test = require('node:test');
const assert = require('node:assert/strict');

const schoolDataService = require('../MVC/services/school/schoolDataService');
const ieltsDataService = require('../MVC/services/ielts/ieltsDataService');
const schoolRepositories = require('../MVC/repositories/school');
const ieltsRepositories = require('../MVC/repositories/ielts');

const transactionDefinitionModel = require('../MVC/models/school/transactionDefinitionModel');
const timesheetModel = require('../MVC/models/school/timesheetModel');
const timesheetPeriodModel = require('../MVC/models/school/timesheetPeriodModel');
const microAssessmentModel = require('../MVC/models/ielts/microAssessmentModel');

function createRestoreStack() {
  const restorers = [];
  return {
    stub(target, methodName, replacement) {
      const original = target[methodName];
      target[methodName] = replacement;
      restorers.push(() => {
        target[methodName] = original;
      });
    },
    restoreAll() {
      while (restorers.length) {
        const restore = restorers.pop();
        restore();
      }
    }
  };
}

test('schoolDataService.fetchData uses school scope builder', async () => {
  const stack = createRestoreStack();
  const calls = [];

  stack.stub(schoolRepositories.subjects, 'list', async (payload) => {
    calls.push(payload);
    return [];
  });

  try {
    await schoolDataService.fetchData('subjects', { q: 'math' }, { activeOrgId: '44' });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].query, { q: 'math' });
    assert.deepEqual(calls[0].scope, {
      denyAll: false,
      canViewAll: false,
      activeOrgId: '44',
      allowSystemFallback: false
    });
  } finally {
    stack.restoreAll();
  }
});

test('schoolDataService aliases feeDefinitions to transactionDefinitions with SYSTEM fallback for normal users', async () => {
  const stack = createRestoreStack();
  const calls = [];

  stack.stub(schoolRepositories.transactionDefinitions, 'list', async (payload) => {
    calls.push(payload);
    return [];
  });

  try {
    await schoolDataService.fetchData('feeDefinitions', {}, { activeOrgId: '99' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].scope.allowSystemFallback, true);
  } finally {
    stack.restoreAll();
  }
});

test('school transaction definition repository includes SYSTEM rows when fallback scope is enabled', async () => {
  const stack = createRestoreStack();

  stack.stub(transactionDefinitionModel, 'getAllTransactionDefinitions', async () => ([
    { id: 'A', orgId: '88', name: 'Org Fee' },
    { id: 'B', orgId: 'SYSTEM', name: 'Default Fee' },
    { id: 'C', orgId: '77', name: 'Other Org Fee' }
  ]));

  try {
    delete require.cache[require.resolve('../MVC/repositories/school')];
    const freshSchoolRepositories = require('../MVC/repositories/school');
    const rows = await freshSchoolRepositories.transactionDefinitions.list({
      scope: {
        denyAll: false,
        canViewAll: false,
        activeOrgId: '88',
        allowSystemFallback: true
      }
    });
    assert.deepEqual(rows.map((item) => item.id).sort(), ['A', 'B']);
  } finally {
    stack.restoreAll();
  }
});

test('school timesheet repository resolves org from period when missing on row', async () => {
  const stack = createRestoreStack();

  stack.stub(timesheetModel, 'getAllTimesheets', async () => ([
    { id: 't1', periodId: 'p1', orgId: '' },
    { id: 't2', periodId: 'p2', orgId: '70' }
  ]));
  stack.stub(timesheetPeriodModel, 'getAllTimesheetPeriods', async () => ([
    { id: 'p1', orgId: '55' },
    { id: 'p2', orgId: '70' }
  ]));

  try {
    delete require.cache[require.resolve('../MVC/repositories/school')];
    const freshSchoolRepositories = require('../MVC/repositories/school');
    const rows = await freshSchoolRepositories.timesheets.list({
      scope: {
        denyAll: false,
        canViewAll: false,
        activeOrgId: '55',
        allowSystemFallback: false
      }
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 't1');
    assert.equal(rows[0].orgId, '55');
  } finally {
    stack.restoreAll();
  }
});

test('ieltsDataService routes fetchData through repository registry', async () => {
  const stack = createRestoreStack();
  const calls = [];

  stack.stub(ieltsRepositories.task2Samples, 'list', async (payload) => {
    calls.push(payload);
    return [{ id: 's1' }];
  });

  try {
    const rows = await ieltsDataService.fetchData('task2Samples', { q: 'sample' }, { activeOrgId: 'ORG-1' });
    assert.equal(rows.length, 1);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].query, { q: 'sample' });
    assert.equal(calls[0]?.scope?.activeOrgId, 'ORG-1');
  } finally {
    stack.restoreAll();
  }
});

test('ielts repository preserves legacy q search for assessment questions', async () => {
  const stack = createRestoreStack();

  stack.stub(microAssessmentModel, 'getAllAssessments', async () => ([
    { id: 'm1', title: 'Band Grammar', questions: [{ atomic_question: 'Grammar range', question_key: 'gram' }] },
    { id: 'm2', title: 'Task Response', questions: [{ atomic_question: 'Idea relevance', question_key: 'task' }] }
  ]));

  try {
    delete require.cache[require.resolve('../MVC/repositories/ielts')];
    const freshIeltsRepositories = require('../MVC/repositories/ielts');
    const rows = await freshIeltsRepositories.microAssessments.list({
      query: { q: 'grammar' },
      scope: { canViewAll: true }
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'm1');
  } finally {
    stack.restoreAll();
  }
});
