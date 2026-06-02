const { requireCoreModule } = require('./schoolCoreContracts');
const uploadMiddleware = requireCoreModule('MVC/middleware/upload');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const WINDOW_POLICY_OPTIONS = new Set(['strict_fixed_window', 'suggested_window']);
const QUESTION_PRESENTATION_MODE_OPTIONS = new Set(['sequential_one_by_one', 'all_questions_on_one_page']);

function parseCsvList(value) {
  return String(value || '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

function parseJsonMaybe(value, fallback) {
  if (value == null || value === '') return fallback;
  try {
    const parsed = JSON.parse(String(value));
    return parsed;
  } catch (_) {
    return fallback;
  }
}

function normalizeIdList(values = []) {
  const raw = Array.isArray(values) ? values : [];
  const seen = new Set();
  const out = [];
  raw.forEach((row) => {
    let token = '';
    if (typeof row === 'string' || typeof row === 'number') token = String(row).trim();
    else if (row && typeof row === 'object') token = String(row.id || row.subjectId || '').trim();
    if (!token || seen.has(token)) return;
    seen.add(token);
    out.push(token);
  });
  return out;
}

function parseTemplateSubjectIds(body = {}, existingTemplate = null) {
  const parsedFromJson = parseJsonMaybe(body.subjectIdsJson, []);
  if (Array.isArray(parsedFromJson) && parsedFromJson.length) {
    return normalizeIdList(parsedFromJson);
  }
  if (Array.isArray(body.subjectIds) && body.subjectIds.length) {
    return normalizeIdList(body.subjectIds);
  }
  const csv = String(body.subjectIds || '').trim();
  if (csv) return normalizeIdList(csv.split(','));

  const fallbackList = Array.isArray(existingTemplate?.subjectIds) ? existingTemplate.subjectIds : [];
  if (fallbackList.length) return normalizeIdList(fallbackList);
  const fallbackOne = String(body.subjectId || existingTemplate?.subjectId || '').trim();
  return fallbackOne ? [fallbackOne] : [];
}

function clampNumber(value, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseWindowPolicy(value, fallback = 'strict_fixed_window') {
  const token = String(value || '').trim().toLowerCase();
  if (WINDOW_POLICY_OPTIONS.has(token)) return token;
  return fallback;
}

function parseQuestionPresentationMode(value, fallback = 'all_questions_on_one_page') {
  const token = String(value || '').trim().toLowerCase();
  if (QUESTION_PRESENTATION_MODE_OPTIONS.has(token)) return token;
  return fallback;
}

function parseBooleanLike(value, fallback = false) {
  const token = String(value || '').trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'off'].includes(token)) return false;
  return Boolean(fallback);
}

function parseTemplatePayload(body = {}, existingTemplate = null) {
  const title = String(body.title || '').trim();
  if (!title) throw new Error('Template title is required.');
  const visibilityToken = String(body.visibility || existingTemplate?.visibility || 'private').trim().toLowerCase();
  const visibility = visibilityToken === 'public' ? 'public' : 'private';

  const departmentId = String(body.departmentId || existingTemplate?.departmentId || '').trim();
  const departmentCode = String(body.departmentCode || existingTemplate?.departmentCode || '').trim().toUpperCase();
  const departmentName = String(body.departmentName || existingTemplate?.departmentName || '').trim();
  const subjectIds = parseTemplateSubjectIds(body, existingTemplate);
  if (!departmentId) throw new Error('Department is required.');
  if (!subjectIds.length) throw new Error('At least one subject is required.');

  return {
    orgId: existingTemplate?.orgId || toPublicId(body.orgId) || '',
    code: String(body.code || '').trim().toUpperCase(),
    title,
    description: String(body.description || '').trim(),
    ownerUserId: String(body.ownerUserId || existingTemplate?.ownerUserId || '').trim(),
    ownerTeacherId: String(existingTemplate?.ownerTeacherId || '').trim(),
    visibility,
    departmentId,
    departmentCode,
    departmentName,
    subjectIds,
    subjectId: String(subjectIds[0] || ''),
    parentTemplateId: String(existingTemplate?.parentTemplateId || '').trim(),
    rootTemplateId: String(existingTemplate?.rootTemplateId || '').trim(),
    revisionDepth: Number(existingTemplate?.revisionDepth || 0) || 0,
    classLevel: String(body.classLevel || '').trim(),
    status: String(body.status || existingTemplate?.status || 'draft').trim().toLowerCase(),
    tags: parseCsvList(body.tags),
    settings: {
      defaultTimezone: String(body.defaultTimezone || existingTemplate?.settings?.defaultTimezone || 'UTC').trim() || 'UTC',
      defaultDurationMinutes: clampNumber(
        body.defaultDurationMinutes,
        Number(existingTemplate?.settings?.defaultDurationMinutes || 60),
        { min: 1, max: 1440 }
      ),
      passScorePercent: clampNumber(
        body.passScorePercent,
        Number(existingTemplate?.settings?.passScorePercent || 50),
        { min: 0, max: 100 }
      ),
      shuffleQuestions: String(body.shuffleQuestions || '').trim().toLowerCase() === 'true',
      allowBackNavigation: String(body.allowBackNavigation || '').trim().toLowerCase() !== 'false',
      showResultImmediately: String(body.showResultImmediately || '').trim().toLowerCase() === 'true',
      defaultWindowPolicy: parseWindowPolicy(
        body.defaultWindowPolicy,
        parseWindowPolicy(existingTemplate?.settings?.defaultWindowPolicy, 'strict_fixed_window')
      ),
      defaultQuestionPresentationMode: parseQuestionPresentationMode(
        body.defaultQuestionPresentationMode,
        parseQuestionPresentationMode(existingTemplate?.settings?.defaultQuestionPresentationMode, 'all_questions_on_one_page')
      ),
      defaultCountsInFinalScore: parseBooleanLike(
        body.defaultCountsInFinalScore,
        existingTemplate?.settings?.defaultCountsInFinalScore !== false
      )
    },
    audit: {
      createUser: existingTemplate?.audit?.createUser || '',
      createDateTime: existingTemplate?.audit?.createDateTime || '',
      lastUpdateUser: ''
    }
  };
}

function parseRevisionPayload(body = {}) {
  return {
    title: String(body.title || '').trim(),
    instructions: String(body.instructions || '').trim(),
    durationMinutes: clampNumber(body.durationMinutes, 60, { min: 1, max: 1440 }),
    tags: parseCsvList(body.tags),
    blueprintSummary: {
      guidance: String(body.blueprintGuidance || '').trim()
    }
  };
}

function parseExistingMediaRefs(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => ({
        id: String(row?.id || '').trim(),
        fileId: String(row?.fileId || '').trim(),
        label: String(row?.label || '').trim(),
        fileName: String(row?.fileName || '').trim(),
        originalName: String(row?.originalName || '').trim(),
        mimeType: String(row?.mimeType || '').trim(),
        storagePath: String(row?.storagePath || '').trim(),
        url: String(row?.url || '').trim(),
        sizeBytes: Number(row?.sizeBytes || 0) || 0
      }))
      .filter((row) => row.id || row.storagePath || row.url || row.fileId);
  } catch (_) {
    return [];
  }
}

function parseObjectiveOptions(body = {}, questionType, objectiveMode) {
  if (questionType !== 'objective') return [];
  if (objectiveMode === 'true_false') {
    const correctToken = String(body.trueFalseCorrect || 'true').trim().toLowerCase();
    const trueIsCorrect = correctToken !== 'false';
    return [
      { id: 'TRUE', text: 'True', isCorrect: trueIsCorrect, order: 1 },
      { id: 'FALSE', text: 'False', isCorrect: !trueIsCorrect, order: 2 }
    ];
  }

  const optionLines = String(body.objectiveOptionsText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const options = optionLines.map((line, idx) => {
    const isCorrect = line.startsWith('*');
    const text = (isCorrect ? line.slice(1) : line).trim();
    return {
      id: `OPT_${idx + 1}`,
      text,
      isCorrect,
      order: idx + 1
    };
  }).filter((row) => row.text);

  if (options.length < 2) {
    throw new Error('Objective questions require at least two options. Prefix correct option lines with *');
  }
  if (!options.some((row) => row.isCorrect)) {
    throw new Error('Mark at least one correct objective option using * at the beginning of the line.');
  }
  return options;
}

function buildUploadedMediaRefs(files = []) {
  const list = Array.isArray(files) ? files : [];
  const now = Date.now();
  return list
    .filter((file) => file && file.path && file.filename)
    .map((file, index) => {
      const storedPath = String(uploadMiddleware.getStoredFilePath(file) || '').trim();
      const storedUrl = String(uploadMiddleware.getStoredFileUrl(file) || storedPath).trim();
      return {
        id: `MEDIA_${now}_${index + 1}`,
        fileId: '',
        label: String(file.originalname || file.filename || '').trim(),
        fileName: String(file.filename || '').trim(),
        originalName: String(file.originalname || file.filename || '').trim(),
        mimeType: String(file.mimetype || '').trim(),
        storagePath: storedPath,
        url: storedUrl,
        sizeBytes: Number(file.size || 0) || 0
      };
    });
}

function parseMediaUrlRows(body = {}) {
  const urlTokens = Array.isArray(body.mediaUrl) ? body.mediaUrl : [body.mediaUrl];
  const labelTokens = Array.isArray(body.mediaLabel) ? body.mediaLabel : [body.mediaLabel];
  const rows = [];
  urlTokens.forEach((rawUrl, index) => {
    const url = String(rawUrl || '').trim();
    if (!url) return;
    rows.push({
      id: `MEDIA_URL_${Date.now()}_${index + 1}`,
      fileId: '',
      label: String(labelTokens[index] || '').trim(),
      fileName: '',
      originalName: '',
      mimeType: '',
      storagePath: '',
      url,
      sizeBytes: 0
    });
  });
  return rows;
}

function parseQuestionPayload(body = {}, options = {}) {
  const questionType = String(body.questionType || '').trim().toLowerCase();
  if (!['objective', 'subjective'].includes(questionType)) {
    throw new Error('questionType must be objective or subjective.');
  }

  const objectiveMode = questionType === 'objective'
    ? (String(body.objectiveMode || 'single_choice').trim().toLowerCase() || 'single_choice')
    : '';
  if (questionType === 'objective' && !['single_choice', 'multiple_choice', 'true_false'].includes(objectiveMode)) {
    throw new Error('objectiveMode is invalid.');
  }

  const existingMediaRefs = parseExistingMediaRefs(body.existingMediaRefsJson || body.mediaRefsJson);
  const uploadedMedia = buildUploadedMediaRefs(options.uploadedFiles || []);
  const urlMedia = parseMediaUrlRows(body);
  const mediaRefs = [...existingMediaRefs, ...uploadedMedia, ...urlMedia];

  const promptText = String(body.promptText || '').trim();
  if (!promptText && mediaRefs.length === 0) {
    throw new Error('Question prompt or media is required.');
  }

  const maxScore = clampNumber(body.maxScore, 1, { min: 0, max: 100000 });
  const negativeScore = clampNumber(body.negativeScore, 0, { min: -100000, max: 0 });
  const objectiveOptions = parseObjectiveOptions(body, questionType, objectiveMode);

  return {
    id: String(body.questionId || '').trim(),
    templateId: String(body.templateId || '').trim(),
    revisionId: String(body.revisionId || '').trim(),
    sequenceNo: clampNumber(body.sequenceNo, 1, { min: 1, max: 100000 }),
    questionType,
    objectiveMode,
    promptText,
    promptHtml: String(body.promptHtml || '').trim(),
    mediaRefs,
    objectiveOptions,
    acceptedOptionIds: [],
    subjectiveConfig: questionType === 'subjective'
      ? {
          minLength: clampNumber(body.subjectiveMinLength, 0, { min: 0, max: 200000 }),
          maxLength: clampNumber(body.subjectiveMaxLength, 4000, { min: 1, max: 200000 }),
          rubricHint: String(body.subjectiveRubricHint || '').trim(),
          allowAttachments: String(body.subjectiveAllowAttachments || '').trim().toLowerCase() === 'true'
        }
      : { minLength: 0, maxLength: 4000, rubricHint: '', allowAttachments: false },
    scoring: {
      maxScore,
      negativeScore,
      partialAllowed: String(body.partialAllowed || '').trim().toLowerCase() === 'true',
      rubricCriteria: String(body.rubricCriteria || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    },
    tags: parseCsvList(body.tags),
    status: String(body.status || 'draft').trim().toLowerCase()
  };
}

function parseAllocationPayload(body = {}) {
  const classId = String(body.classId || '').trim();
  if (!classId) throw new Error('Class is required.');

  const allocationName = String(body.allocationName || '').trim();
  const timezone = String(body.timezone || 'UTC').trim() || 'UTC';
  const localStartDate = String(body.windowStartLocalDate || '').trim();
  const localStartTime = String(body.windowStartLocalTime || '').trim();
  const localEndDate = String(body.windowEndLocalDate || '').trim();
  const localEndTime = String(body.windowEndLocalTime || '').trim();
  const windowStartUtc = String(body.windowStartUtc || '').trim();
  const windowEndUtc = String(body.windowEndUtc || '').trim();

  return {
    classId,
    allocationName,
    instructionsForStudents: String(body.instructionsForStudents || '').trim(),
    status: String(body.status || 'scheduled').trim().toLowerCase(),
    timezone,
    windowStartUtc,
    windowEndUtc,
    windowStartLocalDate: localStartDate,
    windowStartLocalTime: localStartTime,
    windowEndLocalDate: localEndDate,
    windowEndLocalTime: localEndTime,
    durationMinutes: clampNumber(body.durationMinutes, 60, { min: 1, max: 1440 }),
    // HTML checkboxes omit the field when unchecked; treat only explicit true-like values as on.
    autoSubmitOnExpire: String(body.autoSubmitOnExpire || '').trim().toLowerCase() === 'true',
    allowLateStart: String(body.allowLateStart || '').trim().toLowerCase() === 'true',
    maxAttemptsPerStudent: clampNumber(body.maxAttemptsPerStudent, 1, { min: 1, max: 20 }),
    shuffleQuestions: String(body.shuffleQuestions || '').trim().toLowerCase() === 'true',
    windowPolicy: parseWindowPolicy(body.windowPolicy, 'strict_fixed_window'),
    questionPresentationMode: parseQuestionPresentationMode(body.questionPresentationMode, 'all_questions_on_one_page'),
    countsInFinalScore: parseBooleanLike(body.countsInFinalScore, true),
    tags: parseCsvList(body.tags)
  };
}

module.exports = {
  parseTemplatePayload,
  parseRevisionPayload,
  parseQuestionPayload,
  parseExistingMediaRefs,
  parseAllocationPayload
};
