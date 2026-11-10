'use strict';

const studentAttendanceReportGenerationService = require('./studentAttendanceReportGenerationService');
const reportGenerationEngineService = require('./reportGenerationEngineService');
const overallReportGenerationEngineService = require('./overallReportGenerationEngineService');
const overallReportService = require('./overallReportService');
const reportFunderDocxService = require('./reportFunderDocxService');
const reportExportBatchCacheService = require('./reportExportBatchCacheService');
const { validateSarRawSnapshot } = require('./sarRawSnapshotSchema');
const { SUPPORTED_RENDER_CORE_VERSION, BUNDLE_SCHEMA_VERSION, validateRenderBundle } = require('./sarLocalRenderBundleSchema');
const { runWithConcurrency } = require('../../utils/asyncPool');
const sarExportConfigService = require('./sarExportConfigService');

function clean(value = '') {
  return String(value ?? '').trim();
}

function safeFileToken(value, fallback = 'export') {
  return String(value || '').trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
}

function templateRefKey(templateId, variantKey) {
  return `${clean(templateId)}|${clean(variantKey) || 'default'}`;
}

function buildSnapshotGenerationCtx(snapshot) {
  const overallTemplates = Object.values(snapshot.reportTemplatesById || {})
    .filter((row) => Array.isArray(row?.sourceSlots) && row.sourceSlots.length);
  const overallTemplateMap = new Map(overallTemplates.map((row) => [clean(row.id), row]));
  const exportBatchCache = reportExportBatchCacheService.createExportBatchCache();
  Object.entries(snapshot.reportTemplatesById || {}).forEach(([id, tpl]) => {
    exportBatchCache.templateById.set(clean(id), tpl);
  });
  Object.entries(snapshot.classMatrixPayloadsByClassId || {}).forEach(([classId, row]) => {
    const exportSessions = Array.isArray(row?.exportSessions) && row.exportSessions.length
      ? row.exportSessions
      : (Array.isArray(row.sessions) ? row.sessions : []);
    exportBatchCache.classById.set(clean(classId), {
      classData: row.classData,
      sessions: exportSessions
    });
  });
  return {
    policy: snapshot.policy || {},
    overallTemplates,
    overallTemplate: overallTemplates[0] || null,
    overallTemplateMap,
    students: Array.isArray(snapshot.matrix?.students) ? snapshot.matrix.students : [],
    startDate: snapshot.manifest?.startDate,
    endDate: snapshot.manifest?.endDate,
    exportBatchCache,
    activeOrgId: snapshot.manifest?.orgId
  };
}

async function resolveClassTargetFromSnapshot(target, student, ctx, reqUser, docxTemplates) {
  const classId = clean(target?.classId);
  const personId = clean(student.personId);
  const classRow = (student.classes || []).find((row) => clean(row.classId) === classId);
  if (!classRow) throw new Error(`Class ${classId} not found for ${student.name || personId}.`);
  const teacherId = studentAttendanceReportGenerationService.resolveTeacherIdForClass(classRow) || clean(classRow.teacherId);
  const engineRequest = {
    templateId: clean(ctx.policy.reportTemplateId),
    classId,
    teacherId,
    reportStartDate: ctx.startDate,
    reportDueDate: ctx.endDate,
    reportScope: 'selected_students',
    targetStudentIds: [personId],
    format: 'docx',
    docxMode: 'single',
    exportBatchCache: ctx.exportBatchCache,
    docxKey: clean(target?.docxKey),
    pdfKey: clean(target?.pdfKey),
    selections: [{ studentId: personId, docxKey: clean(target?.docxKey), pdfKey: clean(target?.pdfKey) }]
  };
  const pack = await reportGenerationEngineService.prepareLocalDocxRenderTarget(engineRequest, reqUser);
  const tpl = docxTemplates[pack.templateRefKey];
  if (!tpl?.dataBase64) throw new Error(`Missing cached DOCX template ${pack.templateRefKey}`);
  return {
    id: `class:${personId}:${classId}`,
    type: 'class',
    studentId: personId,
    templateRefKey: pack.templateRefKey,
    placeholders: pack.placeholders || {},
    collections: pack.collections || {},
    fileName: pack.fileName,
    warnings: pack.warnings || []
  };
}

async function resolveOverallTargetFromSnapshot(target, student, ctx, reqUser, docxTemplates) {
  const classIds = Array.isArray(target?.classIds) ? target.classIds.map((id) => clean(id)).filter(Boolean) : [];
  const {
    overallTemplate,
    sourceRuns,
    buildWarnings
  } = studentAttendanceReportGenerationService.resolveEligibleOverallTemplateForTarget({
    student,
    selectedClassIds: classIds,
    overallTemplateId: clean(target?.overallTemplateId),
    ctx
  });
  const variantKey = overallReportService.resolveOverallTemplateVariantKey(
    overallTemplate,
    clean(target?.templateVariantKey),
    'default'
  );
  const resolved = reportFunderDocxService.resolveDocxTemplateForFunder({
    template: overallTemplate,
    funderKey: variantKey
  });
  if (!resolved.docxTemplate) throw new Error('Overall template has no DOCX for this variant.');
  const pipeline = await overallReportGenerationEngineService.generateOverallPipeline({
    filterStartDate: ctx.startDate,
    filterEndDate: ctx.endDate,
    studentIds: [clean(student.personId)],
    sourceRuns,
    overallTemplateId: overallTemplate.id,
    format: 'json',
    selectedDocxKey: variantKey,
    exportBatchCache: ctx.exportBatchCache
  }, reqUser);
  const row = (pipeline.overall?.students || [])[0];
  if (!row) throw new Error(`No overall render data for ${student.name || student.personId}.`);
  const refKey = templateRefKey(overallTemplate.id, resolved.docxKey || variantKey);
  if (!docxTemplates[refKey]?.dataBase64) throw new Error(`Missing cached overall DOCX ${refKey}`);
  const safeName = safeFileToken(`${student.name || student.personId}_${overallTemplate.title || overallTemplate.id}`);
  return {
    id: `overall:${clean(student.personId)}:${overallTemplate.id}`,
    type: 'overall',
    studentId: clean(student.personId),
    templateRefKey: refKey,
    placeholders: row.placeholders || {},
    collections: {},
    fileName: `${safeName}_overall.docx`,
    warnings: [...(buildWarnings || []), ...(row.warnings || []), ...(pipeline.overall?.warnings || [])]
  };
}

async function prepareVirtualBundleFromSnapshot(snapshot, targets = [], { reqUser, docxTemplates = {}, mergeMode = '' } = {}) {
  validateSarRawSnapshot(snapshot);
  const parsedTargets = studentAttendanceReportGenerationService.parseTargets(targets);
  if (!parsedTargets.length) {
    const error = new Error('Select at least one report target.');
    error.statusCode = 400;
    throw error;
  }
  const ctx = buildSnapshotGenerationCtx(snapshot);
  const studentMap = new Map(ctx.students.map((row) => [clean(row.personId), row]));
  const concurrency = sarExportConfigService.getExportConcurrency();
  const bundleTargets = await runWithConcurrency(parsedTargets, concurrency, async (target) => {
    const type = clean(target?.type).toLowerCase();
    const student = studentMap.get(clean(target?.studentId));
    if (!student) return null;
    if (type === 'class') {
      return resolveClassTargetFromSnapshot(target, student, ctx, reqUser, docxTemplates);
    }
    if (type === 'overall') {
      return resolveOverallTargetFromSnapshot(target, student, ctx, reqUser, docxTemplates);
    }
    return null;
  });
  const rows = bundleTargets.filter(Boolean);
  if (!rows.length) {
    const error = new Error('No render targets could be prepared from the snapshot.');
    error.statusCode = 400;
    throw error;
  }
  const mergeDocuments = String(mergeMode || '').toLowerCase() === 'merge';
  const stem = safeFileToken(snapshot.manifest?.fileStem || `student_attendance_${ctx.startDate}_${ctx.endDate}`);
  const bundle = {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    renderCoreVersion: SUPPORTED_RENDER_CORE_VERSION,
    manifest: {
      createdAt: new Date().toISOString(),
      orgId: clean(snapshot.manifest?.orgId),
      startDate: ctx.startDate,
      endDate: ctx.endDate,
      targetCount: rows.length,
      sensitiveDataNotice: snapshot.manifest?.sensitiveDataNotice || '',
      mergePolicy: {
        mode: mergeDocuments ? 'single' : 'zip',
        outputStem: stem
      }
    },
    templates: docxTemplates,
    targets: rows
  };
  validateRenderBundle(bundle);
  return bundle;
}

module.exports = {
  prepareVirtualBundleFromSnapshot,
  buildSnapshotGenerationCtx
};
