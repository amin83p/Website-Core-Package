const { coreFilesService } = require('./pteUploadPathCoreDependencies');

const PTE_ROOT_FOLDER = 'PTE';

const PTE_BUCKETS = Object.freeze({
  PRACTICE_BY_SKILLS: 'Practice_By_Skills',
  SMART_PRACTICE: 'Smart_Practice',
  MOCK_EXAMS: 'Mock_Exams',
  QUESTION_BANK: 'Question_Bank',
  STUDENTS: 'Students',
  PUBLIC_APPLICANTS: 'Public_Applicants'
});

function cleanText(value, max = 260) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function sanitizeFolderToken(value, fallback = 'unspecified', max = 120) {
  const token = cleanText(value, max);
  if (!token) return fallback;
  const normalized = token
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '');
  return normalized || fallback;
}

function normalizeBucketToken(value, fallback = PTE_BUCKETS.PRACTICE_BY_SKILLS) {
  const token = cleanText(value, 120).toLowerCase();
  const byToken = {
    practice_by_skills: PTE_BUCKETS.PRACTICE_BY_SKILLS,
    smart_practice: PTE_BUCKETS.SMART_PRACTICE,
    mock_exams: PTE_BUCKETS.MOCK_EXAMS,
    question_bank: PTE_BUCKETS.QUESTION_BANK,
    students: PTE_BUCKETS.STUDENTS,
    public_applicants: PTE_BUCKETS.PUBLIC_APPLICANTS
  };
  return byToken[token] || fallback;
}

function getQuestionBankRoot() {
  return coreFilesService.resolveUploadCategory('pte-question-bank');
}

function getStudentsRoot(isPublicApplicant = false) {
  const bucket = isPublicApplicant
    ? PTE_BUCKETS.PUBLIC_APPLICANTS
    : PTE_BUCKETS.STUDENTS;
  return coreFilesService.resolveUploadCategory('pte-students', false, {
    pteStorageContext: { bucket }
  });
}

function buildQuestionBankCategory() {
  return getQuestionBankRoot();
}

function buildStudentCategory(context = {}) {
  const bucket = normalizeBucketToken(
    context.bucket || '',
    context.isPublicApplicant ? PTE_BUCKETS.PUBLIC_APPLICANTS : PTE_BUCKETS.STUDENTS
  );
  const normalizedItemId = sanitizeFolderToken(
    context.itemId || context.studentId || context.applicantId || context.personId || '',
    'item_unsaved'
  );
  return coreFilesService.resolveUploadCategory('pte-students', context.includeItemFolder !== false, {
    pteStorageContext: { bucket },
    params: { id: normalizedItemId },
    body: {
      studentId: context.studentId || normalizedItemId,
      mediaItemId: context.mediaItemId || '',
      applicantId: context.applicantId || '',
      personId: context.personId || '',
      studentItemId: context.itemId || ''
    }
  });
}

function buildAttemptCategory(context = {}) {
  const bucket = normalizeBucketToken(context.bucket, PTE_BUCKETS.PRACTICE_BY_SKILLS);
  return coreFilesService.resolveUploadCategory('pte-attempts', false, {
    pteStorageContext: {
      bucket,
      userId: context.userId,
      practiceName: context.practiceName,
      testName: context.testName,
      sessionId: context.sessionId,
      itemId: context.itemId
    }
  });
}

module.exports = {
  PTE_ROOT_FOLDER,
  PTE_BUCKETS,
  sanitizeFolderToken,
  normalizeBucketToken,
  getQuestionBankRoot,
  getStudentsRoot,
  buildQuestionBankCategory,
  buildStudentCategory,
  buildAttemptCategory
};
