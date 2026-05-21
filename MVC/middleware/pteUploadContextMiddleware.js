const pteAttemptLedgerService = require('../services/pte/pteAttemptLedgerService');
const pteUploadPathUtils = require('../utils/pteUploadPathUtils');

function cleanText(value, max = 260) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function buildFallbackContext(req, bucket) {
  return {
    bucket,
    userId: cleanText(req.user?.id, 120) || 'user_unsaved',
    practiceName: cleanText(req.body?.practiceName, 180) || '',
    testName: cleanText(req.body?.testName, 180) || '',
    sessionId: cleanText(req.params?.sessionId || req.body?.sessionId, 120) || 'session_unsaved',
    itemId: cleanText(req.params?.itemId || req.body?.itemId, 120) || 'item_unsaved'
  };
}

function setQuestionBankContext(req, _res, next) {
  req.pteStorageContext = {
    ...(req.pteStorageContext || {}),
    bucket: pteUploadPathUtils.PTE_BUCKETS.QUESTION_BANK
  };
  next();
}

function setStudentContext(options = {}) {
  const isPublicApplicant = options.publicApplicant === true;
  return (req, _res, next) => {
    req.pteStorageContext = {
      ...(req.pteStorageContext || {}),
      bucket: isPublicApplicant
        ? pteUploadPathUtils.PTE_BUCKETS.PUBLIC_APPLICANTS
        : pteUploadPathUtils.PTE_BUCKETS.STUDENTS
    };
    next();
  };
}

function resolveRuntimeBucket(mode = '') {
  const token = cleanText(mode, 60).toLowerCase();
  if (token === 'smart') return pteUploadPathUtils.PTE_BUCKETS.SMART_PRACTICE;
  if (token === 'mock') return pteUploadPathUtils.PTE_BUCKETS.MOCK_EXAMS;
  return pteUploadPathUtils.PTE_BUCKETS.PRACTICE_BY_SKILLS;
}

function setRuntimeAttemptContext(mode = 'skills') {
  const bucket = resolveRuntimeBucket(mode);
  return async (req, res, next) => {
    const fallback = buildFallbackContext(req, bucket);
    try {
      const sessionId = cleanText(req.params?.sessionId || req.body?.sessionId, 120);
      if (!sessionId) {
        req.pteStorageContext = { ...(req.pteStorageContext || {}), ...fallback };
        return next();
      }

      const detail = await pteAttemptLedgerService.getAttemptSessionDetail(
        sessionId,
        req.user,
        { scopeId: req.accessScope },
        { includeEvents: false, includeArtifacts: false, includeLifecycle: false }
      );
      const session = detail?.session || {};
      const metadata = session && typeof session.metadata === 'object' ? session.metadata : {};
      const practiceMeta = metadata && typeof metadata.practice === 'object' ? metadata.practice : {};
      const mockMeta = metadata && typeof metadata.mockExam === 'object' ? metadata.mockExam : {};

      req.pteStorageContext = {
        ...(req.pteStorageContext || {}),
        bucket,
        userId: cleanText(session.userId, 120) || fallback.userId,
        practiceName: cleanText(
          req.body?.practiceName || practiceMeta.name || metadata.practiceName,
          180
        ) || fallback.practiceName,
        testName: cleanText(
          req.body?.testName || mockMeta.testTitle || mockMeta.testCode || metadata.testName,
          180
        ) || fallback.testName,
        sessionId: cleanText(session.id, 120) || fallback.sessionId,
        itemId: cleanText(req.params?.itemId || req.body?.itemId, 120) || fallback.itemId
      };
      return next();
    } catch (error) {
      return res.status(400).json({
        status: 'error',
        message: `Unable to resolve upload storage context. ${error.message}`
      });
    }
  };
}

module.exports = {
  setQuestionBankContext,
  setStudentContext,
  setRuntimeAttemptContext
};
