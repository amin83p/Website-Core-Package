'use strict';

const path = require('path');
const { requireCoreModule } = require('./schoolCoreContracts');
const studentAttendanceReportGenerationService = require('./studentAttendanceReportGenerationService');
const reportGenerationEngineService = require('./reportGenerationEngineService');
const overallReportGenerationEngineService = require('./overallReportGenerationEngineService');
const overallReportService = require('./overallReportService');
const reportFunderDocxService = require('./reportFunderDocxService');
const reportExportBatchCacheService = require('./reportExportBatchCacheService');
const reportDocxRenderService = require('./reportDocxRenderService');
const reportDocxRenderCore = require('./reportDocxRenderCore');
const { runWithConcurrency } = require('../../utils/asyncPool');
const sarExportConfigService = require('./sarExportConfigService');
const {
  BUNDLE_SCHEMA_VERSION,
  SUPPORTED_RENDER_CORE_VERSION,
  validateRenderBundle
} = require('./sarLocalRenderBundleSchema');

function clean(value = '') {
  return String(value ?? '').trim();
}

function safeFileToken(value, fallback = 'export') {
  const token = String(value || '').trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return token || fallback;
}

function templateRefKey(templateId, variantKey) {
  return `${clean(templateId)}|${clean(variantKey) || 'default'}`;
}

async function resolveClassBundleTarget(target, student, ctx, reqUser, exportBatchCache) {
  const classId = clean(target?.classId);
  const personId = clean(student.personId);
  const classes = Array.isArray(student.classes) ? student.classes : [];
  const classRow = classes.find((row) => clean(row.classId) === classId);
  if (!classRow) {
    throw new Error(`Class ${classId} was not found for ${student.name || personId}.`);
  }
  const teacherId = studentAttendanceReportGenerationService.resolveTeacherIdForClass
    ? studentAttendanceReportGenerationService.resolveTeacherIdForClass(classRow)
    : clean(classRow.teacherId);
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
    exportBatchCache,
    docxKey: clean(target?.docxKey),
    pdfKey: clean(target?.pdfKey),
    selections: [{ studentId: personId, docxKey: clean(target?.docxKey), pdfKey: clean(target?.pdfKey) }]
  };
  const pack = await reportGenerationEngineService.prepareLocalDocxRenderTarget(engineRequest, reqUser);
  return {
    id: `class:${personId}:${classId}`,
    type: 'class',
    studentId: personId,
    studentName: student.name || personId,
    classId,
    templateRefKey: pack.templateRefKey,
    placeholders: pack.placeholders,
    collections: pack.collections || {},
    fileName: pack.fileName,
    warnings: pack.warnings || []
  };
}

async function resolveOverallBundleTarget(target, student, ctx, reqUser, exportBatchCache) {
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
  if (!resolved.docxTemplate) {
    throw new Error('Overall template has no DOCX file for this variant.');
  }
  const pipeline = await overallReportGenerationEngineService.generateOverallPipeline({
    filterStartDate: ctx.startDate,
    filterEndDate: ctx.endDate,
    studentIds: [clean(student.personId)],
    sourceRuns,
    overallTemplateId: overallTemplate.id,
    format: 'json',
    selectedDocxKey: variantKey,
    exportBatchCache
  }, reqUser);
  const overallJson = pipeline.overall || {};
  const row = (overallJson.students || [])[0];
  if (!row) {
    throw new Error(`No overall render data for ${student.name || student.personId}.`);
  }
  const safeName = safeFileToken(`${student.name || student.personId}_${overallTemplate.title || overallTemplate.id}`);
  return {
    id: `overall:${clean(student.personId)}:${overallTemplate.id}`,
    type: 'overall',
    studentId: clean(student.personId),
    studentName: student.name || student.personId,
    overallTemplateId: overallTemplate.id,
    templateRefKey: templateRefKey(overallTemplate.id, resolved.docxKey || variantKey),
    placeholders: row.placeholders || {},
    collections: {},
    fileName: `${safeName}_overall.docx`,
    warnings: [...(buildWarnings || []), ...(row.warnings || []), ...(overallJson.warnings || [])]
  };
}

async function buildSarLocalRenderBundle(fauxReq, options = {}) {
  const body = fauxReq.body && typeof fauxReq.body === 'object' ? fauxReq.body : {};
  const targets = studentAttendanceReportGenerationService.parseTargets(options.targets || body.targets);
  if (!targets.length) {
    const error = new Error('Select at least one report for the render bundle.');
    error.statusCode = 400;
    throw error;
  }
  const exportBatchCache = reportExportBatchCacheService.createExportBatchCache();
  const ctx = await studentAttendanceReportGenerationService.loadGenerationContext(fauxReq, {
    ...options,
    skipAttendanceMatrix: options.skipAttendanceMatrix !== false,
    targetClassIds: studentAttendanceReportGenerationService.collectTargetClassIds(targets)
  });
  ctx.exportBatchCache = exportBatchCache;
  const studentMap = new Map(ctx.students.map((row) => [clean(row.personId), row]));
  const reqUser = fauxReq.user;

  const docxLoadPlan = await studentAttendanceReportGenerationService.buildDocxTemplateLoadPlan(
    targets,
    ctx,
    studentMap,
    exportBatchCache,
    reqUser
  );
  if (docxLoadPlan.uniqueRefs.length) {
    await reportExportBatchCacheService.prewarmDocxRefs(exportBatchCache, docxLoadPlan.uniqueRefs, {
      strict: false
    });
  }

  const templates = {};
  for (const ref of docxLoadPlan.uniqueRefs) {
    const key = templateRefKey(ref.templateId, ref.variantKey);
    const { binary } = await reportDocxRenderService.readDocxTemplateBuffer(ref.docxTemplate, { exportBatchCache });
    templates[key] = {
      templateId: ref.templateId,
      variantKey: ref.variantKey,
      label: ref.label,
      dataBase64: Buffer.from(binary).toString('base64')
    };
  }

  const bundleConcurrency = sarExportConfigService.getExportConcurrency();
  const preparedTargets = await runWithConcurrency(targets, bundleConcurrency, async (target) => {
    const type = clean(target?.type).toLowerCase();
    const studentId = clean(target?.studentId);
    const student = studentMap.get(studentId);
    if (!student) return null;
    if (type === 'class') {
      return resolveClassBundleTarget(target, student, ctx, reqUser, exportBatchCache);
    }
    if (type === 'overall') {
      return resolveOverallBundleTarget(target, student, ctx, reqUser, exportBatchCache);
    }
    return null;
  });
  const bundleTargets = preparedTargets.filter(Boolean);
  if (!bundleTargets.length) {
    const error = new Error('No render targets could be prepared.');
    error.statusCode = 400;
    throw error;
  }

  const bundleMode = clean(body.bundleMode).toLowerCase();
  const mergeDocuments = bundleMode === 'merge';
  const bundle = {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    renderCoreVersion: SUPPORTED_RENDER_CORE_VERSION,
    manifest: {
      createdAt: new Date().toISOString(),
      orgId: clean(ctx.activeOrgId || reqUser?.activeOrgId),
      startDate: ctx.startDate,
      endDate: ctx.endDate,
      targetCount: bundleTargets.length,
      sensitiveDataNotice: 'Contains student attendance data. Store securely.',
      mergePolicy: {
        mode: mergeDocuments ? 'single' : 'zip',
        outputStem: `student_attendance_${ctx.startDate}_${ctx.endDate}`
      }
    },
    templates,
    targets: bundleTargets
  };
  validateRenderBundle(bundle);
  return bundle;
}

function packBundleAsZipBuffer(bundle) {
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({
    schemaVersion: bundle.schemaVersion,
    renderCoreVersion: bundle.renderCoreVersion,
    manifest: bundle.manifest
  }, null, 2));
  zip.file('targets.json', JSON.stringify(bundle.targets, null, 2));
  const templatesMeta = {};
  Object.entries(bundle.templates || {}).forEach(([key, row]) => {
    templatesMeta[key] = {
      templateId: row.templateId,
      variantKey: row.variantKey,
      label: row.label,
      file: `templates/${safeFileToken(key, 'template')}.docx.b64`
    };
    zip.file(templatesMeta[key].file, row.dataBase64);
  });
  zip.file('templates/index.json', JSON.stringify(templatesMeta, null, 2));
  return zip;
}

async function buildSarLocalRenderBundleZip(fauxReq, options = {}) {
  const bundle = await buildSarLocalRenderBundle(fauxReq, options);
  const zip = packBundleAsZipBuffer(bundle);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const stem = bundle.manifest?.mergePolicy?.outputStem || 'student_attendance_render_bundle';
  return {
    buffer,
    contentType: 'application/zip',
    fileName: `${safeFileToken(stem)}.sarbundle.zip`,
    bundle
  };
}

async function renderBundleToDocxBuffers(bundle, { concurrency = 4, onProgress } = {}) {
  validateRenderBundle(bundle);
  const targets = bundle.targets;
  const templates = bundle.templates;
  const buffers = new Array(targets.length);
  let processed = 0;
  await runWithConcurrency(targets, Math.max(1, Math.min(concurrency, 16)), async (target, index) => {
    const tpl = templates[target.templateRefKey];
    const binary = Buffer.from(tpl.dataBase64, 'base64');
    const rendered = reportDocxRenderCore.renderDocxFromTemplateBuffer(binary, {
      placeholders: target.placeholders || {},
      collections: target.collections || {},
      fileName: target.fileName
    });
    buffers[index] = rendered.buffer;
    processed += 1;
    if (typeof onProgress === 'function') {
      onProgress({ processed, total: targets.length, fileName: target.fileName });
    }
  });
  return buffers.filter(Boolean);
}

async function exportRenderedBundle(bundle, options = {}) {
  validateRenderBundle(bundle);
  const concurrency = Number(options.concurrency) || 4;
  const buffers = await renderBundleToDocxBuffers(bundle, { concurrency, onProgress: options.onProgress });
  const mergeMode = clean(bundle.manifest?.mergePolicy?.mode).toLowerCase() || 'single';
  const stem = safeFileToken(bundle.manifest?.mergePolicy?.outputStem || 'student_attendance_export');
  if (mergeMode === 'zip') {
    const files = buffers.map((buffer, index) => ({
      buffer,
      fileName: bundle.targets[index]?.fileName || `report_${index + 1}.docx`
    }));
    const zipBuffer = await reportDocxRenderService.zipReportInstanceDocxFiles(files);
    return {
      buffer: zipBuffer,
      contentType: 'application/zip',
      fileName: `${stem}.zip`
    };
  }
  const merged = reportDocxRenderCore.mergeReportInstanceDocxBuffers(buffers);
  return {
    buffer: merged,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileName: `${stem}.docx`
  };
}

module.exports = {
  buildSarLocalRenderBundle,
  buildSarLocalRenderBundleZip,
  renderBundleToDocxBuffers,
  exportRenderedBundle,
  packBundleAsZipBuffer,
  validateRenderBundle,
  templateRefKey,
  BUNDLE_SCHEMA_VERSION
};
