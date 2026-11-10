'use strict';

const studentAttendanceReportService = require('./studentAttendanceReportService');
const studentAttendanceReportGenerationService = require('./studentAttendanceReportGenerationService');
const schoolDataService = require('./schoolDataService');
const { SAR_RAW_SNAPSHOT_VERSION, validateSarRawSnapshot } = require('./sarRawSnapshotSchema');

function clean(value = '') {
  return String(value ?? '').trim();
}

function safeFileToken(value, fallback = 'export') {
  const token = String(value || '').trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return token || fallback;
}

async function loadReportTemplatesForSnapshot(ctx, reqUser) {
  const byId = {};
  const classTemplateId = clean(ctx.policy?.reportTemplateId);
  if (classTemplateId) {
    const row = await schoolDataService.getDataById('reportTemplates', classTemplateId, reqUser).catch(() => null);
    if (row) byId[classTemplateId] = row;
  }
  const overallList = Array.isArray(ctx.overallTemplates) ? ctx.overallTemplates : [];
  for (const template of overallList) {
    const id = clean(template?.id);
    if (!id) continue;
    byId[id] = template;
  }
  return byId;
}

async function buildSarRawSnapshot(fauxReq, options = {}) {
  const reqUser = fauxReq?.user;
  const activeOrgId = clean(reqUser?.activeOrgId);
  if (!activeOrgId) {
    const error = new Error('Select an active organization before exporting a snapshot.');
    error.statusCode = 400;
    throw error;
  }

  const matrix = await studentAttendanceReportService.buildStudentAttendanceReportPayload(fauxReq, {
    ...options,
    retainClassPayloads: true
  });
  const exportPlan = await studentAttendanceReportGenerationService.buildStudentAttendanceReportExportPlan(fauxReq);
  const ctx = await studentAttendanceReportGenerationService.loadGenerationContext(fauxReq, {
    skipAttendanceMatrix: true,
    policyAccessCache: options.policyAccessCache
  });
  const reportTemplatesById = await loadReportTemplatesForSnapshot(ctx, reqUser);

  const snapshot = {
    schemaVersion: SAR_RAW_SNAPSHOT_VERSION,
    manifest: {
      createdAt: new Date().toISOString(),
      orgId: activeOrgId,
      startDate: matrix.startDate,
      endDate: matrix.endDate,
      studentCount: Array.isArray(matrix.students) ? matrix.students.length : 0,
      sensitiveDataNotice: 'Contains student attendance data. Store securely; do not email.',
      fileStem: `student_attendance_${matrix.startDate}_${matrix.endDate}`
    },
    policy: ctx.policy,
    policySummary: {
      reportTemplateId: clean(ctx.policy?.reportTemplateId),
      overallReportTemplateId: clean(ctx.policy?.overallReportTemplateId),
      overallReportTemplateIds: ctx.policy?.overallReportTemplateIds || []
    },
    matrix,
    exportPlan,
    classMatrixPayloadsByClassId: matrix.classMatrixPayloadsByClassId || {},
    reportTemplatesById
  };
  validateSarRawSnapshot(snapshot);
  return snapshot;
}

function snapshotToDownloadBuffer(snapshot, { pretty = false } = {}) {
  validateSarRawSnapshot(snapshot);
  const json = pretty ? JSON.stringify(snapshot, null, 2) : JSON.stringify(snapshot);
  return {
    buffer: Buffer.from(json, 'utf8'),
    contentType: 'application/json',
    fileName: `${safeFileToken(snapshot.manifest?.fileStem)}.sarraw.json`
  };
}

module.exports = {
  buildSarRawSnapshot,
  snapshotToDownloadBuffer,
  validateSarRawSnapshot,
  SAR_RAW_SNAPSHOT_VERSION
};
