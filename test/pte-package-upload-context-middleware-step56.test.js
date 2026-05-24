const test = require('node:test');
const assert = require('node:assert/strict');

const {
  setQuestionBankContext,
  setStudentContext,
  setRuntimeAttemptContext
} = require('../packages/pte/MVC/middleware/pteUploadContextMiddleware');

const { pteUploadPathUtils } = require('../packages/pte/MVC/services/pte/pteUploadContextDependencies');

function runMiddleware(mw, req = {}, res = {}, next = () => {}) {
  return new Promise((resolve, reject) => {
    const onNext = (err) => {
      if (err) return reject(err);
      resolve(req);
    };
    const safeRes = res && typeof res.status === 'function'
      ? res
      : {
          status: () => ({
            json: () => {}
          })
        };
    return Promise.resolve(mw(req, safeRes, onNext)).catch(reject);
  });
}

test('setQuestionBankContext writes practice-by-skills storage context', async () => {
  const req = { pteStorageContext: { existing: 'value' } };
  await runMiddleware(setQuestionBankContext, req);

  assert.equal(req.pteStorageContext.bucket, pteUploadPathUtils.PTE_BUCKETS.QUESTION_BANK);
  assert.equal(req.pteStorageContext.existing, 'value');
});

test('setStudentContext writes public or private storage context', async () => {
  const privateReq = {};
  await runMiddleware(setStudentContext(), privateReq);
  assert.equal(privateReq.pteStorageContext.bucket, pteUploadPathUtils.PTE_BUCKETS.STUDENTS);

  const publicReq = {};
  await runMiddleware(setStudentContext({ publicApplicant: true }), publicReq);
  assert.equal(publicReq.pteStorageContext.bucket, pteUploadPathUtils.PTE_BUCKETS.PUBLIC_APPLICANTS);
});

test('setRuntimeAttemptContext falls back gracefully when session id is missing', async () => {
  const req = {
    user: { id: 'USR123' },
    body: {
      practiceName: 'Practice Example',
      testName: 'Mock Test',
      itemId: 'ITEM-9'
    }
  };
  const setRuntime = setRuntimeAttemptContext('mock');

  await runMiddleware(setRuntime, req);

  assert.equal(req.pteStorageContext.bucket, pteUploadPathUtils.PTE_BUCKETS.MOCK_EXAMS);
  assert.equal(req.pteStorageContext.userId, 'USR123');
  assert.equal(req.pteStorageContext.practiceName, 'Practice Example');
  assert.equal(req.pteStorageContext.testName, 'Mock Test');
  assert.equal(req.pteStorageContext.itemId, 'ITEM-9');
  assert.equal(req.pteStorageContext.sessionId, 'session_unsaved');
});

test('setRuntimeAttemptContext does not require active request scope before calling next', async () => {
  const req = {
    user: { id: 'USR777' },
    params: { sessionId: '' },
    body: { itemId: 'ITEM-1' }
  };
  await runMiddleware(setRuntimeAttemptContext('skills'), req);

  assert.equal(req.pteStorageContext.sessionId, 'session_unsaved');
  assert.equal(req.pteStorageContext.userId, 'USR777');
  assert.equal(req.pteStorageContext.bucket, pteUploadPathUtils.PTE_BUCKETS.PRACTICE_BY_SKILLS);
  assert.equal(req.pteStorageContext.itemId, 'ITEM-1');
});
