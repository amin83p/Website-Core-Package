const test = require('node:test');
const assert = require('node:assert/strict');

const attemptController = require('../MVC/controllers/pte/attemptController');
const practiceController = require('../MVC/controllers/pte/practiceController');
const pteAttemptLedgerService = require('../MVC/services/pte/pteAttemptLedgerService');
const pteQuestionBankDataService = require('../MVC/services/pte/pteQuestionBankDataService');

const originals = {
  listAttemptSessionsForDetails: pteAttemptLedgerService.listAttemptSessionsForDetails,
  getAttemptSessionDetail: pteAttemptLedgerService.getAttemptSessionDetail,
  listRuntimePickerUsers: pteAttemptLedgerService.listRuntimePickerUsers,
  getMyPracticeAttemptLifecycleDetail: pteAttemptLedgerService.getMyPracticeAttemptLifecycleDetail,
  consumePracticeAccessQuota: pteAttemptLedgerService.consumePracticeAccessQuota,
  listQuestions: pteQuestionBankDataService.listQuestions
};

function restore() {
  pteAttemptLedgerService.listAttemptSessionsForDetails = originals.listAttemptSessionsForDetails;
  pteAttemptLedgerService.getAttemptSessionDetail = originals.getAttemptSessionDetail;
  pteAttemptLedgerService.listRuntimePickerUsers = originals.listRuntimePickerUsers;
  pteAttemptLedgerService.getMyPracticeAttemptLifecycleDetail = originals.getMyPracticeAttemptLifecycleDetail;
  pteAttemptLedgerService.consumePracticeAccessQuota = originals.consumePracticeAccessQuota;
  pteQuestionBankDataService.listQuestions = originals.listQuestions;
}

function createReq(overrides = {}) {
  return {
    params: {},
    query: {},
    body: {},
    user: { id: 'USR-1', activeOrgId: 'ORG-1' },
    accessScope: 'SCOPE-1',
    ...overrides
  };
}

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    rendered: null,
    sent: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    render(view, payload) {
      this.rendered = { view, payload };
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    send(payload) {
      this.sent = payload;
      return this;
    }
  };
}

test.afterEach(() => {
  restore();
});

test('admin details render includes lifecycle payload', async () => {
  pteAttemptLedgerService.listAttemptSessionsForDetails = async () => ({
    rows: [{ id: 'S-1', attemptType: 'skill_practice_run', status: 'finished' }],
    pagination: { currentPage: 1, totalPages: 1, totalItems: 1, limit: 20 },
    filters: {},
    optionSets: {}
  });
  pteAttemptLedgerService.getAttemptSessionDetail = async () => ({
    session: { id: 'S-1', attemptType: 'skill_practice_run', status: 'finished' },
    items: [{ id: 'I-1', questionVersionId: 'Q-1' }],
    events: [],
    artifacts: [],
    lifecycle: {
      summary: { startCount: 1, saveCount: 1 },
      questionMatrix: [],
      intervals: [],
      anomalies: []
    }
  });
  pteQuestionBankDataService.listQuestions = async () => [];
  pteAttemptLedgerService.listRuntimePickerUsers = async () => [];

  const req = createReq({
    params: { sessionId: 'S-1' }
  });
  const res = createRes();

  await attemptController.showAttemptDetails(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.rendered?.view, 'pte/attempt/attemptDetails');
  assert.equal(res.rendered?.payload?.detail?.session?.id, 'S-1');
  assert.equal(typeof res.rendered?.payload?.detail?.lifecycle, 'object');
});

test('admin export endpoint returns JSON lifecycle payload', async () => {
  pteAttemptLedgerService.getAttemptSessionDetail = async () => ({
    session: { id: 'S-1', attemptType: 'skill_practice_run', status: 'finished' },
    lifecycle: {
      summary: { startCount: 2, saveCount: 1 },
      questionMatrix: [],
      intervals: [],
      anomalies: []
    }
  });

  const req = createReq({
    params: { sessionId: 'S-1' },
    query: { format: 'json' }
  });
  const res = createRes();

  await attemptController.exportAttemptDetailsLifecycle(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(String(res.headers['Content-Type'] || '').includes('application/json'), true);
  assert.equal(typeof res.sent, 'string');
  assert.equal(String(res.sent).includes('"session"'), true);
  assert.equal(String(res.sent).includes('"lifecycle"'), true);
});

test('student details route renders lifecycle page for allowed scope', async () => {
  pteAttemptLedgerService.getMyPracticeAttemptLifecycleDetail = async () => ({
    session: { id: 'S-2', status: 'finished' },
    items: [],
    events: [],
    artifacts: [],
    lifecycle: { summary: {}, questionMatrix: [], intervals: [], anomalies: [] }
  });
  pteAttemptLedgerService.consumePracticeAccessQuota = async () => ({
    allowed: true
  });

  const req = createReq({
    params: { sessionId: 'S-2' }
  });
  const res = createRes();

  await practiceController.showAttemptDetails(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.rendered?.view, 'pte/practice/attemptDetails');
  assert.equal(res.rendered?.payload?.detail?.session?.id, 'S-2');
});

test('student details route enforces access and returns 400 error page', async () => {
  pteAttemptLedgerService.getMyPracticeAttemptLifecycleDetail = async () => {
    throw new Error('Attempt session is not accessible.');
  };

  const req = createReq({
    params: { sessionId: 'S-3' }
  });
  const res = createRes();

  await practiceController.showAttemptDetails(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.rendered?.view, 'error');
  assert.equal(String(res.rendered?.payload?.message || '').includes('not accessible'), true);
});

test('student export endpoint returns CSV output', async () => {
  pteAttemptLedgerService.getMyPracticeAttemptLifecycleDetail = async () => ({
    session: { id: 'S-9', attemptType: 'skill_practice_run', status: 'finished' },
    lifecycle: {
      summary: { startCount: 1, saveCount: 1, submitCount: 0, noSaveStartCount: 0 },
      questionMatrix: [],
      intervals: [
        {
          itemId: 'I-1',
          questionOrder: 1,
          questionVersionId: 'Q-1',
          questionTitle: 'Question 1',
          skill: 'reading',
          questionType: 'reading_fill_in_blank',
          startNo: 1,
          startedAt: '2026-04-20T10:00:00.000Z',
          endedAt: '2026-04-20T10:00:10.000Z',
          endReason: 'response_saved',
          durationSeconds: 10,
          saveCountInInterval: 1,
          submitOccurred: false,
          viewInstanceId: 'VIEW-1',
          startEventId: 'E1',
          endEventId: 'E2'
        }
      ],
      anomalies: []
    }
  });

  const req = createReq({
    params: { sessionId: 'S-9' },
    query: { format: 'csv' }
  });
  const res = createRes();

  await practiceController.exportAttemptDetails(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(String(res.headers['Content-Type'] || '').includes('text/csv'), true);
  assert.equal(typeof res.sent, 'string');
  assert.equal(String(res.sent).includes('sessionId,itemId,questionOrder'), true);
  assert.equal(String(res.sent).includes('S-9,I-1,1'), true);
});
