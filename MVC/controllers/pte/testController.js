const paginate = require('../../utils/paginationHelper');
const {
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields
} = require('../../utils/generalTools');
const pteTestDataService = require('../../services/pte/pteTestDataService');
const pteAttemptLedgerService = require('../../services/pte/pteAttemptLedgerService');
const questionTypeRegistry = require('../../services/pte/questionTypeRegistry');

const LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: [
    'id',
    'orgId',
    'familyId',
    'revisionNumber',
    'isLatestRevision',
    'status',
    'creator.userId'
  ],
  defaultSearchFields: [
    'id',
    'familyId',
    'code',
    'title',
    'description',
    'status',
    'tags',
    'creator.displayName',
    'creator.userId'
  ],
  allowMetaKeys: true
});

const FAMILY_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'familyId', 'status'],
  defaultSearchFields: ['id', 'familyId', 'title', 'code', 'status'],
  allowMetaKeys: true
});

const PICKER_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: [
    'id',
    'familyId',
    'skill',
    'questionType',
    'status'
  ],
  defaultSearchFields: [
    'id',
    'familyId',
    'code',
    'title',
    'questionType',
    'skill',
    'tags'
  ],
  allowMetaKeys: true
});

const RUNTIME_PICKER_USER_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'username', 'email', 'status'],
  defaultSearchFields: ['id', 'name', 'username', 'email'],
  allowMetaKeys: true
});

const BLUEPRINT_SECTION_META = Object.freeze({
  speaking_writing: Object.freeze({
    label: 'Speaking & Writing',
    academicMinutes: '76-84 min',
    coreMinutes: '50-65 min'
  }),
  reading: Object.freeze({
    label: 'Reading',
    academicMinutes: '22-30 min',
    coreMinutes: '27-37 min'
  }),
  listening: Object.freeze({
    label: 'Listening',
    academicMinutes: '31-39 min',
    coreMinutes: '22-37 min'
  })
});

const TEST_BLUEPRINT_PLAN = Object.freeze({
  academic: Object.freeze([
    { section: 'speaking_writing', questionType: 'speaking_read_aloud', count: '6-7' },
    { section: 'speaking_writing', questionType: 'speaking_repeat_sentence', count: '10-12' },
    { section: 'speaking_writing', questionType: 'speaking_describe_image', count: '3-4' },
    { section: 'speaking_writing', questionType: 'speaking_respond_to_situation', count: '2-3' },
    { section: 'speaking_writing', questionType: 'speaking_answer_short_question', count: '5-6' },
    { section: 'speaking_writing', questionType: 'writing_summarize_written_text', count: '1-2' },
    { section: 'speaking_writing', questionType: 'writing_short_answer', count: '1-2' },
    { section: 'speaking_writing', questionType: 'writing_essay', count: '1-2' },
    { section: 'reading', questionType: 'reading_mcq_single', count: '1-2' },
    { section: 'reading', questionType: 'reading_mcq_multiple', count: '1-2' },
    { section: 'reading', questionType: 'reading_true_false', count: '1-2' },
    { section: 'reading', questionType: 'reading_writing_fill_in_blank', count: '5-6' },
    { section: 'reading', questionType: 'reading_fill_in_blank', count: '4-5' },
    { section: 'reading', questionType: 'reading_reorder_paragraphs', count: '2-3' },
    { section: 'reading', questionType: 'reading_matching', count: '1-2' },
    { section: 'listening', questionType: 'listening_summarize_spoken_text', count: '1-2' },
    { section: 'listening', questionType: 'listening_mcq_single', count: '1-2' },
    { section: 'listening', questionType: 'listening_mcq_multiple', count: '1-2' },
    { section: 'listening', questionType: 'listening_fill_in_blank', count: '2-3' },
    { section: 'listening', questionType: 'listening_select_missing_word', count: '1-2' },
    { section: 'listening', questionType: 'listening_highlight_incorrect_words', count: '1-2' },
    { section: 'listening', questionType: 'listening_dictation', count: '3-4' },
    { section: 'listening', questionType: 'listening_matching', count: '1-2' }
  ]),
  core: Object.freeze([
    { section: 'speaking_writing', questionType: 'speaking_read_aloud', count: '6-7' },
    { section: 'speaking_writing', questionType: 'speaking_repeat_sentence', count: '10-12' },
    { section: 'speaking_writing', questionType: 'speaking_describe_image', count: '3-4' },
    { section: 'speaking_writing', questionType: 'speaking_respond_to_situation', count: '2-4' },
    { section: 'speaking_writing', questionType: 'writing_summarize_written_text', count: '1-2' },
    { section: 'speaking_writing', questionType: 'writing_write_email', count: '2-3' },
    { section: 'reading', questionType: 'reading_mcq_single', count: '1-2' },
    { section: 'reading', questionType: 'reading_mcq_multiple', count: '1-2' },
    { section: 'reading', questionType: 'reading_writing_fill_in_blank', count: '5-6' },
    { section: 'reading', questionType: 'reading_fill_in_blank', count: '4-5' },
    { section: 'reading', questionType: 'reading_reorder_paragraphs', count: '2-3' },
    { section: 'listening', questionType: 'listening_summarize_spoken_text', count: '1-2' },
    { section: 'listening', questionType: 'listening_mcq_single', count: '1-2' },
    { section: 'listening', questionType: 'listening_mcq_multiple', count: '1-2' },
    { section: 'listening', questionType: 'listening_fill_in_blank', count: '2-3' },
    { section: 'listening', questionType: 'listening_select_missing_word', count: '1-2' },
    { section: 'listening', questionType: 'listening_highlight_incorrect_words', count: '1-2' },
    { section: 'listening', questionType: 'listening_dictation', count: '3-4' }
  ])
});

function formatQuestionTypeLabel(typeKey = '') {
  return String(typeKey || '')
    .trim()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildBlueprintGuideModel() {
  const defsByType = new Map(
    (Array.isArray(questionTypeRegistry.listTypes()) ? questionTypeRegistry.listTypes() : [])
      .map((row) => [String(row?.key || '').trim(), row || {}])
  );

  const buildRows = (testType = '') => {
    const rows = Array.isArray(TEST_BLUEPRINT_PLAN[testType]) ? TEST_BLUEPRINT_PLAN[testType] : [];
    return rows.map((row, index) => {
      const typeKey = String(row.questionType || '').trim();
      const def = defsByType.get(typeKey) || {};
      const testTypes = Array.isArray(def.testTypes) ? def.testTypes : [];
      return {
        order: index + 1,
        section: row.section,
        sectionLabel: BLUEPRINT_SECTION_META[row.section]?.label || '-',
        questionType: typeKey,
        questionLabel: def.label || formatQuestionTypeLabel(typeKey),
        skill: String(def.skill || '').trim().toLowerCase(),
        recommendedCount: String(row.count || '').trim() || '-',
        isSupportedByRegistry: testTypes.includes(testType)
      };
    });
  };

  return {
    sectionMeta: BLUEPRINT_SECTION_META,
    academicRows: buildRows('academic'),
    coreRows: buildRows('core')
  };
}

function splitPagination(query = {}) {
  const source = query && typeof query === 'object' ? query : {};
  const page = Number.parseInt(source.page, 10) || 1;
  const limit = Number.parseInt(source.limit, 10) || undefined;
  const filtered = { ...source };
  delete filtered.page;
  delete filtered.limit;
  return { page, limit, filtered };
}

function normalizeMultiValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (value === undefined || value === null || value === '') return [];
  return String(value)
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function parseMaybeJson(input, fallback = null) {
  if (input === undefined || input === null || input === '') return fallback;
  if (typeof input === 'object') return input;
  const token = String(input || '').trim();
  if (!token) return fallback;
  try {
    return JSON.parse(token);
  } catch (_) {
    throw new Error('Invalid test payload.');
  }
}

function readRuntimePayload(req) {
  const body = req?.body;
  if (body && Object.prototype.hasOwnProperty.call(body, 'runtimePlan')) {
    return parseMaybeJson(body.runtimePlan, {}) || {};
  }
  return (body && typeof body === 'object') ? body : {};
}

function normalizePreviewTest(input = {}, fallback = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const safeFallback = fallback && typeof fallback === 'object' ? fallback : {};
  const output = {
    ...safeFallback,
    ...source
  };
  output.id = cleanText(output.id, 120);
  output.familyId = cleanText(output.familyId, 140);
  output.code = cleanText(output.code, 120);
  output.title = cleanText(output.title, 260);
  output.description = String(output.description || '');
  output.instructions = String(output.instructions || '');
  output.tags = Array.isArray(output.tags)
    ? output.tags.map((row) => cleanText(row, 120)).filter(Boolean)
    : [];
  output.allocations = (output.allocations && typeof output.allocations === 'object' && !Array.isArray(output.allocations))
    ? output.allocations
    : {};
  return output;
}

function buildRuntimeLedgerFilters(query = {}) {
  const source = (query && typeof query === 'object') ? query : {};
  return {
    q: cleanText(source.q, 220),
    type: cleanText(source.type, 40).toLowerCase(),
    searchFields: cleanText(source.searchFields, 400),
    startDate: cleanText(source.startDate || source.eventFrom, 80),
    endDate: cleanText(source.endDate || source.eventTo, 80),
    attemptTypes: normalizeMultiValue(source.attemptTypes),
    eventTypes: normalizeMultiValue(source.eventTypes),
    skills: normalizeMultiValue(source.skills),
    userIds: normalizeMultiValue(source.userIds),
    sessionStatus: cleanText(source.sessionStatus, 40).toLowerCase(),
    itemStatus: cleanText(source.itemStatus, 40).toLowerCase(),
    questionType: cleanText(source.questionType, 120).toLowerCase(),
    sessionId: cleanText(source.sessionId, 120),
    itemId: cleanText(source.itemId, 120),
    testVersionId: cleanText(source.testVersionId, 120),
    questionVersionId: cleanText(source.questionVersionId, 120),
    withFeedback: cleanText(source.withFeedback, 10).toLowerCase(),
    minScoreFinal: cleanText(source.minScoreFinal, 40),
    maxScoreFinal: cleanText(source.maxScoreFinal, 40),
    minTimeSpentSeconds: cleanText(source.minTimeSpentSeconds, 40),
    maxTimeSpentSeconds: cleanText(source.maxTimeSpentSeconds, 40)
  };
}

async function listTests(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, LIST_QUERY_OPTIONS);
    const page = Number.parseInt(req.query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || undefined;
    const result = await pteTestDataService.listTests(
      {
        ...query,
        page,
        limit
      },
      req.user,
      {
        scopeId: req.accessScope
      },
      {
        paginated: true,
        pagination: { page, limit }
      }
    );
    const rows = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const searchableFields = await inferSearchableFields(rows, {
      exclude: ['audit', 'allocations', 'validation', 'runtimeWarnings']
    });
    const data = rows;
    const pagination = result?.pagination || paginate(rows, req.query.page, req.query.limit).pagination;

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        results: data,
        pagination
      });
    }

    return res.render('pte/tests/testList', {
      title: 'PTE Tests',
      tableName: 'PTE_Tests',
      data,
      searchableFields,
      newUrl: 'pte/tests',
      newLabel: 'New Test',
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: true,
      btn_export: true,
      pagination,
      filters: req.query,
      user: req.user,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function showBlueprintGuide(req, res) {
  try {
    await pteTestDataService.resolveReadVisibility(req.user, { scopeId: req.accessScope });
    const guide = buildBlueprintGuideModel();
    return res.render('pte/tests/testBlueprintGuide', {
      title: 'PTE Test Configuration Guide',
      tableName: 'PTE_Test_Configuration_Guide',
      guide,
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function showForm(req, res) {
  try {
    const isEdit = Boolean(req.params.id);
    let test = null;
    if (isEdit) {
      test = await pteTestDataService.getTestById(req.params.id, req.user, {
        scopeId: req.accessScope
      });
      if (!test) return res.status(404).render('404', { title: 'Not Found', user: req.user || null });
    } else {
      await pteTestDataService.assertCreateContext(req.user);
    }

    return res.render('pte/tests/testForm', {
      title: isEdit ? `Edit Test: ${test.id}` : 'Create PTE Test',
      test,
      formOptions: pteTestDataService.getFormOptions(),
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function saveTest(req, res) {
  try {
    const id = cleanText(req.params.id, 120);
    const inputPlan = parseMaybeJson(req.body?.testPlan, {}) || {};
    const payload = (inputPlan && typeof inputPlan === 'object') ? inputPlan : {};

    if (id) {
      await pteTestDataService.updateTest(id, payload, req.user, {
        scopeId: req.accessScope
      });
      if (isAjax(req)) return res.json({ status: 'success', message: 'Test draft updated successfully.' });
      return res.redirect('/pte/tests');
    }

    await pteTestDataService.createTest(payload, req.user, {
      scopeId: req.accessScope
    });
    if (isAjax(req)) return res.json({ status: 'success', message: 'Test draft created successfully.' });
    return res.redirect('/pte/tests');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function validateDraft(req, res) {
  try {
    const payload = parseMaybeJson(req.body?.testPlan, {}) || {};
    const existingTestId = cleanText(req.body?.testId, 120);
    const result = await pteTestDataService.validateTestPayload(payload, req.user, {
      scopeId: req.accessScope
    }, {
      existingTestId: existingTestId || ''
    });
    return res.json({
      status: 'success',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function publishTest(req, res) {
  try {
    await pteTestDataService.publishTest(req.params.id, req.user, {
      scopeId: req.accessScope
    });
    return res.json({ status: 'success', message: 'Test published successfully.' });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function reviseTest(req, res) {
  try {
    const revision = await pteTestDataService.reviseTest(req.params.id, req.user, {
      scopeId: req.accessScope
    });
    return res.json({
      status: 'success',
      message: 'Revision draft created successfully.',
      results: { id: revision?.id || '' }
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function archiveTest(req, res) {
  try {
    await pteTestDataService.archiveTest(req.params.id, req.user, {
      scopeId: req.accessScope
    });
    return res.json({ status: 'success', message: 'Test archived successfully.' });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function deleteTest(req, res) {
  try {
    await pteTestDataService.deleteTest(req.params.id, req.user, {
      scopeId: req.accessScope
    });
    return res.json({ status: 'success', message: 'Test deleted successfully.' });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function getFamilyRevisions(req, res) {
  try {
    const rows = await pteTestDataService.listFamilyRevisions(req.params.familyId, req.user, {
      scopeId: req.accessScope
    });
    return res.json({
      status: 'success',
      results: rows
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function listPublishedQuestionsPicker(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, PICKER_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(query);
    const result = await pteTestDataService.listPublishedQuestionPicker(
      filtered,
      req.user,
      {
        scopeId: req.accessScope
      },
      {
        paginated: true,
        pagination: { page, limit }
      }
    );
    const rows = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const data = rows;
    const pagination = result?.pagination || paginate(rows, page, limit).pagination;
    return res.json({
      status: 'success',
      results: data,
      pagination
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function getFormOptions(req, res) {
  try {
    await pteTestDataService.resolveReadVisibility(req.user, { scopeId: req.accessScope });
    return res.json({
      status: 'success',
      results: {
        formOptions: pteTestDataService.getFormOptions()
      }
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function showExamPreview(req, res) {
  try {
    let test = null;
    const modeToken = String(req.params.id || '').trim();
    if (modeToken) {
      test = await pteTestDataService.getTestById(modeToken, req.user, {
        scopeId: req.accessScope
      });
      if (!test) return res.status(404).render('404', { title: 'Not Found', user: req.user || null });
    } else {
      const inputPlan = parseMaybeJson(req.body?.testPlan, {}) || {};
      test = normalizePreviewTest(inputPlan, {
        title: 'Untitled Test',
        allocations: {}
      });
    }

    return res.render('pte/tests/testExamPreview', {
      layout: false,
      title: 'PTE Test Preview',
      test: normalizePreviewTest(test),
      user: req.user || null
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function startRuntimeAttempt(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const result = await pteAttemptLedgerService.startAttemptSession(payload, req.user, {
      scopeId: req.accessScope
    });
    return res.json({
      status: 'success',
      message: 'Attempt session started.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function startRuntimeAttemptItem(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const result = await pteAttemptLedgerService.startAttemptItem(
      req.params.sessionId,
      req.params.itemId,
      payload,
      req.user,
      { scopeId: req.accessScope }
    );
    return res.json({
      status: 'success',
      message: 'Attempt item started.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function saveRuntimeAttemptItem(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const result = await pteAttemptLedgerService.saveAttemptItem(
      req.params.sessionId,
      req.params.itemId,
      payload,
      req.user,
      { scopeId: req.accessScope }
    );
    return res.json({
      status: 'success',
      message: 'Attempt item progress saved.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function submitRuntimeAttemptItem(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const result = await pteAttemptLedgerService.submitAttemptItem(
      req.params.sessionId,
      req.params.itemId,
      payload,
      req.user,
      { scopeId: req.accessScope }
    );
    return res.json({
      status: 'success',
      message: 'Attempt item submitted.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function scoreRuntimeAttemptItem(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const result = await pteAttemptLedgerService.recordAttemptItemScore(
      req.params.sessionId,
      req.params.itemId,
      payload,
      req.user,
      { scopeId: req.accessScope }
    );
    return res.json({
      status: 'success',
      message: 'Attempt item score recorded.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function feedbackRuntimeAttemptItem(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const result = await pteAttemptLedgerService.recordAttemptItemFeedback(
      req.params.sessionId,
      req.params.itemId,
      payload,
      req.user,
      { scopeId: req.accessScope }
    );
    return res.json({
      status: 'success',
      message: 'Attempt item feedback recorded.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function submitRuntimeAttemptSession(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const result = await pteAttemptLedgerService.submitAttemptSession(
      req.params.sessionId,
      payload,
      req.user,
      { scopeId: req.accessScope }
    );
    return res.json({
      status: 'success',
      message: 'Attempt session submitted.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function getRuntimeAttemptSession(req, res) {
  try {
    const includeEvents = String(req.query?.includeEvents || 'true').toLowerCase() !== 'false';
    const eventLimit = Number.parseInt(req.query?.eventLimit, 10) || 200;
    const result = await pteAttemptLedgerService.getAttemptSessionDetail(
      req.params.sessionId,
      req.user,
      { scopeId: req.accessScope },
      { includeEvents, eventLimit }
    );
    return res.json({
      status: 'success',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function getRuntimeAnalyticsMe(req, res) {
  try {
    const result = await pteAttemptLedgerService.getMyAnalytics(
      req.user,
      { scopeId: req.accessScope },
      {
        from: req.query?.from || req.query?.dateFrom || '',
        to: req.query?.to || req.query?.dateTo || ''
      }
    );
    return res.json({
      status: 'success',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function listRuntimeLedger(req, res) {
  try {
    const filters = buildRuntimeLedgerFilters(req.query || {});
    const page = Number.parseInt(req.query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || undefined;
    const selectedUserRows = filters.userIds.length
      ? await pteAttemptLedgerService.listRuntimePickerUsers(
        { id__in: filters.userIds.join(',') },
        req.user,
        { scopeId: req.accessScope }
      )
      : [];
    const result = await pteAttemptLedgerService.listRuntimeLedgerEvents(
      {
        ...filters,
        page,
        limit
      },
      req.user,
      { scopeId: req.accessScope },
      { pagination: { page, limit } }
    );
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const searchableFields = await inferSearchableFields(rows, {
      exclude: ['audit', 'source', 'traitScores', 'responseSummary', 'artifactRefs', 'metadata', 'creator']
    });
    const data = rows;
    const pagination = result?.pagination || paginate(rows, req.query.page, req.query.limit).pagination;
    const filterOptions = pteAttemptLedgerService.getRuntimeFilterOptions();

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        results: data,
        pagination
      });
    }

    return res.render('pte/tests/runtimeLedgerList', {
      title: 'PTE Attempt Ledger',
      tableName: 'PTE_Attempt_Ledger',
      data,
      searchableFields,
      newUrl: 'pte/tests/runtime/ledger',
      newLabel: null,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: true,
      btn_export: true,
      pagination,
      filters,
      selectedUsers: Array.isArray(selectedUserRows) ? selectedUserRows : [],
      filterOptions,
      questionTypeOptions: Array.isArray(result?.optionSets?.questionTypes) ? result.optionSets.questionTypes : [],
      user: req.user,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function pickerRuntimeUsers(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, RUNTIME_PICKER_USER_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const rows = await pteAttemptLedgerService.listRuntimePickerUsers(
      filtered,
      req.user,
      { scopeId: req.accessScope }
    );
    const { data, pagination } = paginate(rows, page, limit);
    return res.json({
      status: 'success',
      results: data,
      pagination
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  listTests,
  showBlueprintGuide,
  showForm,
  saveTest,
  validateDraft,
  publishTest,
  reviseTest,
  archiveTest,
  deleteTest,
  getFamilyRevisions,
  listPublishedQuestionsPicker,
  getFormOptions,
  showExamPreview,
  startRuntimeAttempt,
  startRuntimeAttemptItem,
  saveRuntimeAttemptItem,
  submitRuntimeAttemptItem,
  scoreRuntimeAttemptItem,
  feedbackRuntimeAttemptItem,
  submitRuntimeAttemptSession,
  getRuntimeAttemptSession,
  getRuntimeAnalyticsMe,
  listRuntimeLedger,
  pickerRuntimeUsers
};
