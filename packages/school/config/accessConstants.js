const path = require('path');

function cleanText(value = '', max = 4000) {
  const out = String(value || '').trim();
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeFilePath(value = '') {
  return cleanText(value).replace(/\\/g, '/');
}

function isPackageOwnedPath(absPath = '') {
  const normalized = normalizeFilePath(absPath).toLowerCase();
  return normalized.includes('/packages/school/') || normalized.includes('/uploads/packages/school/');
}

function buildCoreRootCandidates() {
  const unique = new Set();
  const out = [];
  const add = (value = '') => {
    const resolved = path.resolve(value);
    const key = normalizeFilePath(resolved).toLowerCase();
    if (!key || unique.has(key)) return;
    unique.add(key);
    out.push(resolved);
  };

  add(process.env.PACKAGE_CORE_ROOT || '');
  add(path.resolve(__dirname, '../../../'));
  add(path.resolve(__dirname, '../../../../'));
  add(process.cwd());
  return out;
}

function requireCoreAccessConstants() {
  let lastError = null;
  const tried = [];
  for (const root of buildCoreRootCandidates()) {
    const candidate = path.resolve(root, 'config/accessConstants');
    tried.push(candidate);
    if (isPackageOwnedPath(candidate)) continue;
    try {
      return require(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  const suffix = lastError ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Unable to resolve core access constants. Tried: ${tried.join(', ')}.${suffix}`);
}

const { SECTIONS: CORE_SECTIONS, OPERATIONS } = requireCoreAccessConstants();

const SCHOOL_SECTIONS = Object.freeze({
  SCHOOL: 'SCHOOL',
  SCHOOL_DASHBOARD: 'SCHOOL',
  SCHOOL_MASTER_ACADEMIA_HUB: 'SCHOOL_MASTER_ACADEMIA_HUB',
  SCHOOL_MASTER_HUB: 'SCHOOL_MASTER_ACADEMIA_HUB',
  SCHOOL_STUDENTS: 'SCHOOL_STUDENTS',
  SCHOOL_TEACHERS: 'SCHOOL_TEACHERS',
  SCHOOL_STAFF: 'SCHOOL_STAFF',
  SCHOOL_SUBJECTS: 'SCHOOL_SUBJECTS',
  SCHOOL_TERMS: 'SCHOOL_TERMS',
  SCHOOL_CLASSES: 'SCHOOL_CLASSES',
  SCHOOL_CLASS_ENROLLMENT_PERIODS: 'SCHOOL_CLASS_ENROLLMENT_PERIODS',
  SCHOOL_CLASS_CYCLES: 'SCHOOL_CLASS_CYCLES',
  SCHOOL_DEPARTMENTS: 'SCHOOL_DEPARTMENTS',
  SCHOOL_PAY_RATES: 'SCHOOL_PAY_RATES',
  SCHOOL_SESSION_STATUSES: 'SCHOOL_SESSION_STATUSES',
  SCHOOL_TIMESHEET_PERIODS: 'SCHOOL_TIMESHEET_PERIODS',
  SCHOOL_TIMESHEETS: 'SCHOOL_TIMESHEETS',
  SCHOOL_SCHEDULES: 'SCHOOL_SCHEDULES',
  SCHOOL_SESSIONS: 'SCHOOL_SESSIONS',
  SCHOOL_REPORTS: 'SCHOOL_REPORTS',
  SCHOOL_REPORTS_TEMPLATE: 'SCHOOL_REPORTS_TEMPLATE',
  SCHOOL_REPORTS_ASSIGNMENT: 'SCHOOL_REPORTS_ASSIGNMENT',
  SCHOOL_REPORTS_INSTANCES: 'SCHOOL_REPORTS_INSTANCES',
  SCHOOL_EXAMS: 'SCHOOL_EXAMS',
  SCHOOL_EXAMS_TEMPLATE: 'SCHOOL_EXAMS_TEMPLATE',
  SCHOOL_EXAMS_ALLOCATION: 'SCHOOL_EXAMS_ALLOCATION',
  SCHOOL_EXAMS_TAKING: 'SCHOOL_EXAMS_TAKING',
  SCHOOL_EXAMS_REVIEW: 'SCHOOL_EXAMS_REVIEW',
  SCHOOL_ATTENDANCES: 'SCHOOL_ATTENDANCES',
  SCHOOL_GRADEBOOK: 'SCHOOL_GRADEBOOK',
  SCHOOL_HOLIDAYS: 'SCHOOL_HOLIDAYS',
  SCHOOL_PROGRAMS: 'SCHOOL_PROGRAMS',
  SCHOOL_PROGRAM_REGISTRATIONS: 'SCHOOL_PROGRAM_REGISTRATIONS',
  SCHOOL_PRIOR_SUBJECT_CREDITS: 'SCHOOL_PRIOR_SUBJECT_CREDITS',
  SCHOOL_TERM_REGISTRATIONS: 'SCHOOL_TERM_REGISTRATIONS',
  SCHOOL_TRANSACTION_TEMPLATES: 'SCHOOL_TRANSACTION_TEMPLATES',
  SCHOOL_TRANSACTION_DEFINITIONS: 'SCHOOL_TRANSACTION_TEMPLATES',
  SCHOOL_FEE_DEFINITIONS: 'SCHOOL_TRANSACTION_TEMPLATES',
  SCHOOL_ACCOUNTS: 'SCHOOL_ACCOUNTS',
  SCHOOL_TRANSACTIONS: 'SCHOOL_TRANSACTIONS',
  SCHOOL_SAMPLE_DATA: 'SCHOOL_SAMPLE_DATA',
  SCHOOL_ACADEMIC_LEDGER: 'SCHOOL_ACADEMIC_LEDGER',
  SCHOOL_WITHDRAWAL: 'SCHOOL_WITHDRAWAL',
  SCHOOL_LEAVE_REQUESTS: 'SCHOOL_LEAVE_REQUESTS',
  SCHOOL_NOTIFICATIONS: 'SCHOOL_NOTIFICATIONS'
});

const SCHOOL_ROLES = Object.freeze({
  STUDENT: 'school_student',
  TEACHER: 'school_teacher',
  STAFF: 'school_staff'
});

const SCHOOL_UPLOAD_FOLDERS = Object.freeze({
  STUDENTS: 'school.students',
  REPORT_TEMPLATES: 'school.reportTemplates',
  EXAM_MEDIA: 'school.examMedia',
  CLASS_WORKSPACE: 'school.classWorkspace',
  SUBJECT_WORKSPACE: 'school.subjectWorkspace'
});

const SECTIONS = Object.freeze({
  ...(CORE_SECTIONS || {}),
  ...SCHOOL_SECTIONS
});

module.exports = {
  SCHOOL_SECTIONS,
  SCHOOL_ROLES,
  SCHOOL_UPLOAD_FOLDERS,
  SECTIONS,
  OPERATIONS
};
