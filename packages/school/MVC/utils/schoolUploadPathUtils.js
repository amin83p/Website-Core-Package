const path = require('path');
const { requireCoreModule } = require('../services/school/schoolCoreContracts');

const uploadFolderSettingsService = requireCoreModule('MVC/services/uploadFolderSettingsService');

function cleanText(value, max = 260) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function sanitizeFolderToken(value, fallback = 'item_unsaved', max = 120) {
  if (typeof uploadFolderSettingsService.sanitizeFolderToken === 'function') {
    return uploadFolderSettingsService.sanitizeFolderToken(value, fallback);
  }
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

function joinUploadParts(...parts) {
  return parts
    .map((part) => String(part || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim())
    .filter(Boolean)
    .join('/');
}

function resolveUploadFolder(key, placeholders = {}) {
  if (!uploadFolderSettingsService || typeof uploadFolderSettingsService.resolveUploadFolder !== 'function') {
    throw new Error('School upload folder settings service is not available.');
  }
  return uploadFolderSettingsService.resolveUploadFolder(key, placeholders);
}

function buildStudentCategory(context = {}) {
  return resolveUploadFolder('school.students', {
    personId: sanitizeFolderToken(context.personId || context.studentId || context.itemId, 'person_unsaved')
  });
}

function buildTeacherCategory(context = {}) {
  return resolveUploadFolder('school.teachers', {
    personId: sanitizeFolderToken(context.personId || context.teacherId || context.itemId, 'person_unsaved')
  });
}

function buildStaffCategory(context = {}) {
  return resolveUploadFolder('school.staff', {
    personId: sanitizeFolderToken(context.personId || context.staffId || context.itemId, 'person_unsaved')
  });
}

function buildReportTemplatesCategory() {
  return resolveUploadFolder('school.reportTemplates');
}

function buildExamMediaCategory(context = {}) {
  return resolveUploadFolder('school.examMedia', {
    templateId: sanitizeFolderToken(context.templateId, 'template_unsaved'),
    questionId: sanitizeFolderToken(context.questionId, 'question_unsaved')
  });
}

function buildClassWorkspaceCategory(context = {}) {
  const classId = sanitizeFolderToken(context.classId, 'class_unsaved');
  const base = resolveUploadFolder('school.classWorkspace', { classId });
  const sessionId = sanitizeFolderToken(context.sessionId, 'session_unsaved');
  const kind = sanitizeFolderToken(context.kind || 'files', 'files');
  const studentPersonId = sanitizeFolderToken(context.studentPersonId || context.personId, '');
  if (kind === 'content') return joinUploadParts(base, 'sessions', sessionId, 'content');
  if (kind === 'comment') return joinUploadParts(base, 'sessions', sessionId, 'comments', studentPersonId);
  if (kind === 'excuse') return joinUploadParts(base, 'sessions', sessionId, 'attendance', studentPersonId, 'excuses');
  if (kind === 'attendance') return joinUploadParts(base, 'sessions', sessionId, 'attendance', studentPersonId);
  return joinUploadParts(base, 'sessions', sessionId, kind);
}

function buildSubjectWorkspaceCategory(context = {}) {
  const subjectId = sanitizeFolderToken(context.subjectId || context.itemId, 'subject_unsaved');
  const base = resolveUploadFolder('school.subjectWorkspace', { subjectId });
  return joinUploadParts(base, 'attachments');
}

module.exports = {
  sanitizeFolderToken,
  joinUploadParts,
  buildStudentCategory,
  buildTeacherCategory,
  buildStaffCategory,
  buildReportTemplatesCategory,
  buildExamMediaCategory,
  buildClassWorkspaceCategory,
  buildSubjectWorkspaceCategory
};
