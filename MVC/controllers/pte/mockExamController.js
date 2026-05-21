const path = require('path');
const coreFilesService = require('../../services/coreFilesService');
const uploadMiddleware = require('../../middleware/upload');
const pteAttemptLedgerService = require('../../services/pte/pteAttemptLedgerService');
const pteMockExamDataService = require('../../services/pte/pteMockExamDataService');
const pteQuestionVersionRepository = require('../../repositories/pteQuestionVersionRepository');

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function cleanNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Number(fallback || 0);
  return numeric;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseMaybeJson(input, fallback = null) {
  if (input === undefined || input === null || input === '') return fallback;
  if (typeof input === 'object') return input;
  const token = String(input || '').trim();
  if (!token) return fallback;
  try {
    return JSON.parse(token);
  } catch (_) {
    throw new Error('Invalid mock exam payload.');
  }
}

function readRuntimePayload(req) {
  const body = req?.body;
  if (body && Object.prototype.hasOwnProperty.call(body, 'runtimePlan')) {
    return parseMaybeJson(body.runtimePlan, {}) || {};
  }
  return (body && typeof body === 'object') ? body : {};
}

function buildAttachmentUrlFromPath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/').trim();
  if (!normalized) return '';
  if (/^https?:\/\/[^/]+\/uploads\//i.test(normalized)) return normalized;
  if (/^\/uploads\//i.test(normalized)) return normalized;
  const dirPath = path.dirname(normalized);
  const dirUrl = coreFilesService.getWebUrlForUpload(dirPath);
  const filename = path.basename(normalized);
  if (!dirUrl || !filename) return '';
  return `${dirUrl}/${filename}`;
}

function resolveAttemptItemQuestion(item = {}, questionMap = new Map()) {
  const metadata = isPlainObject(item?.metadata) ? item.metadata : {};
  const snapshot = isPlainObject(metadata.questionSnapshot) ? metadata.questionSnapshot : null;
  if (snapshot?.id) {
    return {
      ...snapshot,
      payload: isPlainObject(snapshot.payload) ? snapshot.payload : {},
      mediaAssets: Array.isArray(snapshot.mediaAssets) ? snapshot.mediaAssets : []
    };
  }
  return questionMap.get(cleanText(item?.questionVersionId, 120)) || null;
}

function finalItemStatus(status = '') {
  return pteMockExamDataService.FINAL_ITEM_STATUSES.has(cleanText(status, 40).toLowerCase());
}

function currentItemIndex(items = []) {
  const rows = Array.isArray(items) ? items : [];
  const index = rows.findIndex((item) => !finalItemStatus(item?.status));
  return index >= 0 ? index : Math.max(0, rows.length - 1);
}

function jsonError(res, error, statusCode = 400) {
  return res.status(statusCode).json({
    status: 'error',
    message: error?.message || 'Request failed.'
  });
}

async function hydrateAttemptDetail(sessionId, req, options = {}) {
  const detail = await pteAttemptLedgerService.getAttemptSessionDetail(
    sessionId,
    req.user,
    { scopeId: req.accessScope },
    {
      includeEvents: options.includeEvents !== false,
      includeArtifacts: options.includeArtifacts !== false,
      eventLimit: options.eventLimit || 300
    }
  );
  const session = detail?.session || null;
  if (!session || !pteMockExamDataService.isStrictMockSession(session)) {
    throw new Error('This session is not a strict PTE mock exam.');
  }

  const itemRows = Array.isArray(detail?.items) ? detail.items : [];
  const questionIds = Array.from(new Set(
    itemRows.map((row) => cleanText(row?.questionVersionId, 120)).filter(Boolean)
  ));
  const sessionOrgId = cleanText(session?.orgId, 120);
  const questionRows = questionIds.length
    ? await pteQuestionVersionRepository.list({
      query: {
        id__in: questionIds.join(','),
        ...(sessionOrgId ? { orgId__eq: sessionOrgId } : {})
      },
      scope: { canViewAll: true },
      projection: {
        id: 1,
        orgId: 1,
        familyId: 1,
        status: 1,
        code: 1,
        title: 1,
        instructions: 1,
        testType: 1,
        skill: 1,
        questionType: 1,
        payload: 1,
        scoringConfig: 1,
        responseContract: 1,
        mediaAssets: 1
      }
    })
    : [];
  const questionMap = new Map(questionRows.map((row) => [cleanText(row?.id, 120), row]));
  const artifacts = Array.isArray(detail?.artifacts) ? detail.artifacts : [];
  const artifactMap = new Map();
  artifacts.forEach((artifact) => {
    const key = cleanText(artifact?.attemptItemId, 120);
    if (!key) return;
    if (!artifactMap.has(key)) artifactMap.set(key, []);
    artifactMap.get(key).push(artifact);
  });

  const items = itemRows.map((item) => ({
    ...item,
    question: resolveAttemptItemQuestion(item, questionMap),
    artifacts: artifactMap.get(cleanText(item?.id, 120)) || []
  }));

  return {
    ...detail,
    session,
    items
  };
}

async function ensureStrictCurrentItem(req, itemId, options = {}) {
  const detail = await hydrateAttemptDetail(req.params.sessionId, req, {
    includeEvents: false,
    includeArtifacts: options.includeArtifacts !== false
  });
  const session = detail.session;
  if (pteMockExamDataService.isExpired(session)) {
    throw new Error('Mock exam time has expired. Finish the exam to auto-submit remaining items.');
  }
  const current = pteMockExamDataService.findCurrentRuntimeItem(detail.items);
  if (!current) {
    throw new Error('No active mock exam item is available.');
  }
  const expectedId = cleanText(current.id, 120);
  if (expectedId !== cleanText(itemId, 120)) {
    throw new Error('Strict mock exam only allows the current expected question to be changed.');
  }
  return {
    detail,
    session,
    item: current
  };
}

function queueMockExamScoring(sessionId, user, accessScope) {
  const safeSessionId = cleanText(sessionId, 120);
  if (!safeSessionId) return;
  setTimeout(() => {
    pteMockExamDataService.scoreFinishedMockSession(
      safeSessionId,
      user,
      { scopeId: accessScope }
    ).catch((error) => {
      // eslint-disable-next-line no-console
      console.warn(`[PTE_MOCK_EXAM][SCORING][WARN] ${error?.message || error}`);
    });
  }, 250);
}

async function showMockExams(req, res) {
  try {
    const result = await pteMockExamDataService.listPublishedMockTests(
      req.user,
      { scopeId: req.accessScope },
      { limit: 200 }
    );
    return res.render('pte/practice/mockExams', {
      title: 'PTE Mock Exams',
      tests: Array.isArray(result?.tests) ? result.tests : [],
      activeSession: result?.activeSession || null,
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function showReady(req, res) {
  try {
    const testVersionId = cleanText(req.params.testVersionId, 120);
    const [readiness, activeSession] = await Promise.all([
      pteMockExamDataService.getMockTestReadiness(testVersionId, req.user, { scopeId: req.accessScope }),
      pteMockExamDataService.findActiveStrictMockSession(req.user)
    ]);
    return res.render('pte/practice/mockExamReady', {
      title: `Ready: ${readiness.title}`,
      test: readiness,
      activeSession,
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function issueStartToken(req, res) {
  try {
    return res.json({
      status: 'success',
      results: {
        actionStateId: cleanText(req.actionStateId, 220)
      }
    });
  } catch (error) {
    return jsonError(res, error);
  }
}

async function startMockExam(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const testVersionId = cleanText(payload.testVersionId || req.body?.testVersionId, 120);
    const confirmationAccepted = payload.confirmationAccepted === true
      || String(payload.confirmationAccepted || '').toLowerCase() === 'true';
    if (!confirmationAccepted) {
      throw new Error('You must accept the strict mock exam warning before starting.');
    }

    const activeSession = await pteMockExamDataService.findActiveStrictMockSession(req.user);
    if (activeSession) {
      throw new Error('You already have an in-progress strict mock exam. Continue or finish it before starting another one.');
    }

    const readiness = await pteMockExamDataService.getMockTestReadiness(
      testVersionId,
      req.user,
      { scopeId: req.accessScope }
    );
    if (!readiness.ready) {
      const errorText = Array.isArray(readiness?.validationState?.errors)
        ? readiness.validationState.errors.join(' ')
        : '';
      throw new Error(errorText || 'This PTE test is not ready for strict mock exam delivery.');
    }

    const metadata = pteMockExamDataService.buildStartMetadata(
      readiness,
      isPlainObject(payload.equipmentCheck) ? payload.equipmentCheck : {},
      new Date()
    );

    const result = await pteAttemptLedgerService.startAttemptSession(
      {
        attemptType: 'test_run',
        testVersionId: readiness.id,
        metadata,
        source: {
          module: 'pte_mock_exam_ui',
          eventType: 'mock_exam_started',
          eventId: `PTE-MOCK-START-${readiness.id}-${Date.now()}`,
          idempotencyKey: req.actionStateId
            ? `${cleanText(req.actionStateId, 180)}:mock-exam-start:${readiness.id}`
            : ''
        }
      },
      req.user,
      { scopeId: req.accessScope },
      {
        allowPublishedTestRuntimeAccess: true
      }
    );

    return res.json({
      status: 'success',
      message: 'Mock exam started.',
      results: {
        ...result,
        redirectUrl: `/pte/practice/mock-exams/session/${encodeURIComponent(result?.session?.id || '')}`
      }
    });
  } catch (error) {
    return jsonError(res, error);
  }
}

async function showRunner(req, res) {
  try {
    const sessionId = cleanText(req.params.sessionId, 120);
    const detail = await hydrateAttemptDetail(sessionId, req, {
      includeEvents: false,
      includeArtifacts: true
    });
    const session = detail.session;
    const items = detail.items;
    const remainingSeconds = pteMockExamDataService.getRemainingSeconds(session);
    if (pteMockExamDataService.isExpired(session)) {
      await pteAttemptLedgerService.submitAttemptSession(
        session.id,
        {
          autoSubmitRemaining: true,
          source: {
            module: 'pte_mock_exam_ui',
            eventType: 'mock_exam_time_expired',
            eventId: `PTE-MOCK-EXPIRED-${session.id}-${Date.now()}`
          }
        },
        req.user,
        { scopeId: req.accessScope },
        {
          disableAutoScoring: true
        }
      );
      queueMockExamScoring(session.id, req.user, req.accessScope);
      return res.redirect(`/pte/practice/mock-exams/session/${encodeURIComponent(session.id)}/complete`);
    }

    const mockExam = isPlainObject(session?.metadata?.mockExam) ? session.metadata.mockExam : {};
    return res.render('pte/practice/practiceRunner', {
      title: `PTE Mock Exam ${session.id}`,
      session,
      items,
      events: [],
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId || '',
      strictMockExam: true,
      runnerConfig: {
        mode: 'strict_mock_exam',
        endpoints: {
          base: '/pte/practice/mock-exams/api/runtime'
        },
        initialIndex: currentItemIndex(items),
        remainingSeconds,
        expiresAt: cleanText(mockExam?.timingSnapshot?.expiresAt, 80),
        testTitle: cleanText(mockExam?.testTitle, 260) || 'PTE Mock Exam',
        testCode: cleanText(mockExam?.testCode, 120),
        testTypeLabel: cleanText(mockExam?.detectedTestTypeLabel, 80),
        completionUrl: `/pte/practice/mock-exams/session/${encodeURIComponent(session.id)}/complete`
      }
    });
  } catch (error) {
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function showComplete(req, res) {
  try {
    const sessionId = cleanText(req.params.sessionId, 120);
    const detail = await hydrateAttemptDetail(sessionId, req, {
      includeEvents: false,
      includeArtifacts: false
    });
    const session = detail.session;
    const items = detail.items;
    return res.render('pte/practice/mockExamComplete', {
      title: 'PTE Mock Exam Complete',
      session,
      items,
      includeModal: true,
      user: req.user || null
    });
  } catch (error) {
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function startRuntimeItem(req, res) {
  try {
    const payload = readRuntimePayload(req);
    await ensureStrictCurrentItem(req, req.params.itemId, { includeArtifacts: false });
    const result = await pteAttemptLedgerService.startAttemptItem(
      req.params.sessionId,
      req.params.itemId,
      {
        ...payload,
        source: {
          ...(isPlainObject(payload.source) ? payload.source : {}),
          module: 'pte_mock_exam_ui',
          eventType: 'mock_exam_question_started',
          eventId: `PTE-MOCK-QSTART-${cleanText(req.params.itemId, 120)}-${Date.now()}`
        }
      },
      req.user,
      { scopeId: req.accessScope }
    );
    return res.json({
      status: 'success',
      message: 'Mock exam question started.',
      results: result
    });
  } catch (error) {
    return jsonError(res, error);
  }
}

async function saveRuntimeItem(req, res) {
  try {
    const payload = readRuntimePayload(req);
    await ensureStrictCurrentItem(req, req.params.itemId, { includeArtifacts: false });
    const result = await pteAttemptLedgerService.saveAttemptItem(
      req.params.sessionId,
      req.params.itemId,
      {
        ...payload,
        source: {
          ...(isPlainObject(payload.source) ? payload.source : {}),
          module: 'pte_mock_exam_ui',
          eventType: 'mock_exam_response_saved',
          eventId: `PTE-MOCK-SAVE-${cleanText(req.params.itemId, 120)}-${Date.now()}`
        }
      },
      req.user,
      { scopeId: req.accessScope }
    );
    return res.json({
      status: 'success',
      message: 'Mock exam response saved.',
      results: result
    });
  } catch (error) {
    return jsonError(res, error);
  }
}

async function uploadRuntimeItemAudio(req, res) {
  try {
    if (!req.file) throw new Error('No audio file uploaded.');
    const sessionId = cleanText(req.params.sessionId, 120);
    const itemId = cleanText(req.params.itemId, 120);
    const guard = await ensureStrictCurrentItem(req, itemId, { includeArtifacts: true });
    const existingAudio = Array.isArray(guard.item?.artifacts)
      ? guard.item.artifacts.find((row) => cleanText(row?.artifactType, 80).toLowerCase() === 'audio')
      : null;
    if (existingAudio || (Array.isArray(guard.item?.artifactIds) && guard.item.artifactIds.length > 0)) {
      throw new Error('Strict mock exam speaking responses can only be recorded and uploaded once.');
    }

    const runtimePayload = readRuntimePayload(req);
    const normalizedPath = String(uploadMiddleware.getStoredFilePath(req.file) || '').replace(/\\/g, '/');
    const normalizedUrl = String(uploadMiddleware.getStoredFileUrl(req.file) || '').replace(/\\/g, '/');
    const artifact = {
      clientArtifactId: cleanText(req.body?.clientArtifactId, 160) || `MOCK-AUDIO-${Date.now()}`,
      artifactType: 'audio',
      name: cleanText(req.file.originalname, 260) || cleanText(req.file.filename, 260) || 'mock-exam-audio.webm',
      mimeType: cleanText(req.file.mimetype, 120) || 'audio/webm',
      sizeBytes: Math.max(0, Number(req.file.size || 0) || 0),
      path: normalizedPath,
      url: buildAttachmentUrlFromPath(normalizedUrl || normalizedPath),
      durationSeconds: Math.max(0, cleanNumber(req.body?.durationSeconds, 0)),
      metadata: {
        source: 'mock_exam_recording',
        originalName: cleanText(req.file.originalname, 260),
        filename: cleanText(req.file.filename, 260),
        localPath: cleanText(req.file.localPath, 1200),
        uploadUrl: cleanText(req.file.uploadUrl, 1200),
        storagePath: cleanText(req.file.storagePath, 1200),
        gatewayRelativePath: cleanText(req.file.gatewayRelativePath, 1200),
        gatewayFileName: cleanText(req.file.gatewayFileName, 260)
      }
    };

    const result = await pteAttemptLedgerService.saveAttemptItem(
      sessionId,
      itemId,
      {
        ...runtimePayload,
        artifacts: [artifact],
        source: {
          ...(isPlainObject(runtimePayload.source) ? runtimePayload.source : {}),
          module: 'pte_mock_exam_ui',
          eventType: 'mock_exam_audio_uploaded',
          eventId: `PTE-MOCK-AUDIO-${itemId}-${Date.now()}`
        }
      },
      req.user,
      { scopeId: req.accessScope }
    );

    const createdArtifact = Array.isArray(result?.artifacts) && result.artifacts.length
      ? result.artifacts[result.artifacts.length - 1]
      : artifact;

    return res.json({
      status: 'success',
      message: 'Audio uploaded and linked to mock exam item.',
      results: {
        session: result?.session || null,
        item: result?.item || null,
        artifact: createdArtifact
      }
    });
  } catch (error) {
    return jsonError(res, error);
  }
}

async function submitRuntimeItem(req, res) {
  try {
    const payload = readRuntimePayload(req);
    await ensureStrictCurrentItem(req, req.params.itemId, { includeArtifacts: false });
    const result = await pteAttemptLedgerService.submitAttemptItem(
      req.params.sessionId,
      req.params.itemId,
      {
        ...payload,
        disableAutoScoring: true,
        source: {
          ...(isPlainObject(payload.source) ? payload.source : {}),
          module: 'pte_mock_exam_ui',
          eventType: 'mock_exam_question_submitted',
          eventId: `PTE-MOCK-QSUB-${cleanText(req.params.itemId, 120)}-${Date.now()}`
        }
      },
      req.user,
      { scopeId: req.accessScope },
      {
        disableAutoScoring: true
      }
    );
    return res.json({
      status: 'success',
      message: 'Mock exam question submitted.',
      results: result
    });
  } catch (error) {
    return jsonError(res, error);
  }
}

async function finishRuntime(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const sessionId = cleanText(req.params.sessionId, 120);
    const detail = await hydrateAttemptDetail(sessionId, req, {
      includeEvents: false,
      includeArtifacts: false
    });
    if (!detail.session || !pteMockExamDataService.isStrictMockSession(detail.session)) {
      throw new Error('This session is not a strict PTE mock exam.');
    }

    const result = await pteAttemptLedgerService.submitAttemptSession(
      sessionId,
      {
        ...payload,
        autoSubmitRemaining: true,
        source: {
          ...(isPlainObject(payload.source) ? payload.source : {}),
          module: 'pte_mock_exam_ui',
          eventType: 'mock_exam_finished',
          eventId: `PTE-MOCK-FINISH-${sessionId}-${Date.now()}`
        }
      },
      req.user,
      { scopeId: req.accessScope },
      {
        disableAutoScoring: true
      }
    );
    queueMockExamScoring(sessionId, req.user, req.accessScope);
    return res.json({
      status: 'success',
      message: 'Mock exam finished. Scoring has started in the background.',
      results: {
        ...result,
        redirectUrl: `/pte/practice/mock-exams/session/${encodeURIComponent(sessionId)}/complete`
      }
    });
  } catch (error) {
    return jsonError(res, error);
  }
}

async function getRuntimeSession(req, res) {
  try {
    const detail = await hydrateAttemptDetail(req.params.sessionId, req, {
      includeEvents: String(req.query?.includeEvents || 'false').toLowerCase() === 'true',
      includeArtifacts: true,
      eventLimit: Number.parseInt(req.query?.eventLimit, 10) || 300
    });
    return res.json({
      status: 'success',
      results: {
        ...detail,
        remainingSeconds: pteMockExamDataService.getRemainingSeconds(detail.session)
      }
    });
  } catch (error) {
    return jsonError(res, error);
  }
}

module.exports = {
  showMockExams,
  showReady,
  issueStartToken,
  startMockExam,
  showRunner,
  showComplete,
  startRuntimeItem,
  saveRuntimeItem,
  uploadRuntimeItemAudio,
  submitRuntimeItem,
  finishRuntime,
  getRuntimeSession
};
