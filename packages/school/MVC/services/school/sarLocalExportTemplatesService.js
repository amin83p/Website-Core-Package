'use strict';

const crypto = require('crypto');
const reportDocxRenderService = require('./reportDocxRenderService');
const reportFunderDocxService = require('./reportFunderDocxService');
const schoolDataService = require('./schoolDataService');
const reportExportBatchCacheService = require('./reportExportBatchCacheService');
const studentAttendanceReportGenerationService = require('./studentAttendanceReportGenerationService');
const reportIntegrityService = require('./reportIntegrityService');
const { validateSarRawSnapshot } = require('./sarRawSnapshotSchema');

function clean(value = '') {
  return String(value ?? '').trim();
}

function templateRefKey(templateId, variantKey) {
  return `${clean(templateId)}|${clean(variantKey) || 'default'}`;
}

function contentHashBase64(dataBase64 = '') {
  return crypto.createHash('sha256').update(String(dataBase64 || ''), 'utf8').digest('hex').slice(0, 16);
}

function parseTemplateRefs(body = {}) {
  const raw = body.refs || body.templateRefs || body.templates;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

async function resolveDocxRef(templateId, variantKey, reqUser, exportBatchCache) {
  const template = exportBatchCache?.templateById?.get(clean(templateId))
    || await reportIntegrityService.assertTemplateAccessible(clean(templateId), reqUser);
  const resolved = reportFunderDocxService.resolveDocxTemplateForFunder({
    template,
    funderKey: clean(variantKey) || 'default'
  });
  if (!resolved.docxTemplate) {
    throw new Error(`Template ${templateId} has no DOCX for variant ${variantKey || 'default'}.`);
  }
  const { binary } = await reportDocxRenderService.readDocxTemplateBuffer(resolved.docxTemplate, { exportBatchCache });
  const dataBase64 = Buffer.from(binary).toString('base64');
  return {
    templateRefKey: templateRefKey(templateId, resolved.docxKey || variantKey),
    templateId: clean(templateId),
    variantKey: clean(resolved.docxKey || variantKey) || 'default',
    label: resolved.label || resolved.docxKey || 'default',
    dataBase64,
    contentHash: contentHashBase64(dataBase64)
  };
}

function addResolvableDocxRefsForTemplateRow(templateId, templateRow, unique, { allowedKeys = null } = {}) {
  const tid = clean(templateId);
  if (!tid || !templateRow) return 0;
  const allowSet = allowedKeys instanceof Set ? allowedKeys : null;
  const options = reportFunderDocxService.buildAvailableDocxOptions(templateRow);
  let added = 0;
  options.forEach((opt) => {
    const requestedKey = clean(opt?.key);
    if (!requestedKey) return;
    if (allowSet && !allowSet.has(requestedKey)) return;
    const resolved = reportFunderDocxService.resolveDocxTemplateForFunder({
      template: templateRow,
      funderKey: requestedKey
    });
    if (!resolved?.docxTemplate) return;
    const variantKey = clean(resolved.docxKey || requestedKey) || requestedKey;
    unique.set(templateRefKey(tid, variantKey), { templateId: tid, variantKey });
    added += 1;
  });
  return added;
}

function buildTemplateRefsFromSnapshot(snapshot = {}) {
  const plan = snapshot.exportPlan || {};
  const classTemplateId = clean(plan.reportTemplateId);
  const unique = new Map();
  const templatesById = snapshot.reportTemplatesById && typeof snapshot.reportTemplatesById === 'object'
    ? snapshot.reportTemplatesById
    : {};

  if (classTemplateId) {
    const classTemplateRow = templatesById[classTemplateId];
    const classOptions = Array.isArray(plan.classTemplateDocxOptions) ? plan.classTemplateDocxOptions : [];
    if (classOptions.length) {
      const allowedKeys = new Set(
        classOptions.map((opt) => clean(opt?.key || opt?.value)).filter(Boolean)
      );
      addResolvableDocxRefsForTemplateRow(classTemplateId, classTemplateRow, unique, { allowedKeys });
    } else if (classTemplateRow) {
      addResolvableDocxRefsForTemplateRow(classTemplateId, classTemplateRow, unique);
    }
  }

  Object.entries(templatesById).forEach(([templateId, templateRow]) => {
    const tid = clean(templateId);
    if (!tid || tid === classTemplateId) return;
    addResolvableDocxRefsForTemplateRow(tid, templateRow, unique);
  });

  return [...unique.values()];
}

async function fetchLocalExportTemplatesForSnapshot(req, snapshot = {}) {
  validateSarRawSnapshot(snapshot, { requireMatrix: false });
  const reqUser = req?.user;
  const exportBatchCache = reportExportBatchCacheService.createExportBatchCache();
  Object.entries(snapshot.reportTemplatesById || {}).forEach(([id, row]) => {
    if (row && typeof row === 'object') exportBatchCache.templateById.set(clean(id), row);
  });
  const refs = buildTemplateRefsFromSnapshot(snapshot);
  if (!refs.length) {
    const error = new Error('Snapshot has no exportable DOCX templates to cache.');
    error.statusCode = 400;
    throw error;
  }
  const templates = {};
  const skipped = [];
  for (const ref of refs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const pack = await resolveDocxRef(ref.templateId, ref.variantKey, reqUser, exportBatchCache);
      templates[pack.templateRefKey] = pack;
    } catch (error) {
      skipped.push({
        templateId: ref.templateId,
        variantKey: ref.variantKey,
        message: clean(error?.message) || 'resolve_failed'
      });
    }
  }
  if (!Object.keys(templates).length) {
    const detail = skipped[0]?.message || 'No DOCX templates could be loaded from snapshot.';
    const error = new Error(detail);
    error.statusCode = 400;
    throw error;
  }
  return {
    orgId: clean(reqUser?.activeOrgId) || clean(snapshot.manifest?.orgId),
    templates,
    refCount: refs.length,
    loadedCount: Object.keys(templates).length,
    skipped
  };
}

async function fetchLocalExportTemplates(req, body = {}) {
  const reqUser = req?.user;
  const refs = parseTemplateRefs(body);
  if (!refs.length) {
    const error = new Error('Provide at least one template ref { templateId, variantKey }.');
    error.statusCode = 400;
    throw error;
  }
  const exportBatchCache = reportExportBatchCacheService.createExportBatchCache();
  const unique = new Map();
  refs.forEach((row) => {
    const templateId = clean(row?.templateId);
    const variantKey = clean(row?.variantKey) || 'default';
    if (!templateId) return;
    unique.set(templateRefKey(templateId, variantKey), { templateId, variantKey });
  });

  const templates = {};
  for (const [, ref] of unique) {
    // eslint-disable-next-line no-await-in-loop
    const pack = await resolveDocxRef(ref.templateId, ref.variantKey, reqUser, exportBatchCache);
    templates[pack.templateRefKey] = pack;
  }
  return {
    orgId: clean(reqUser?.activeOrgId),
    templates
  };
}

async function refsFromExportTargets(targets = [], snapshot = {}, reqUser) {
  const exportBatchCache = reportExportBatchCacheService.createExportBatchCache();
  Object.entries(snapshot.reportTemplatesById || {}).forEach(([id, row]) => {
    exportBatchCache.templateById.set(id, row);
  });
  const studentMap = new Map((snapshot.matrix?.students || []).map((row) => [clean(row.personId), row]));
  const ctx = {
    policy: snapshot.policy || snapshot.policySummary,
    overallTemplates: Object.values(snapshot.reportTemplatesById || {}).filter((row) => row?.sourceSlots),
    overallTemplateMap: new Map(Object.entries(snapshot.reportTemplatesById || {})),
    startDate: snapshot.manifest?.startDate,
    endDate: snapshot.manifest?.endDate,
    exportBatchCache
  };
  const plan = await studentAttendanceReportGenerationService.buildDocxTemplateLoadPlan(
    targets,
    ctx,
    studentMap,
    exportBatchCache,
    reqUser
  );
  return plan.uniqueRefs.map((ref) => ({
    templateId: ref.templateId,
    variantKey: ref.variantKey
  }));
}

module.exports = {
  fetchLocalExportTemplates,
  fetchLocalExportTemplatesForSnapshot,
  buildTemplateRefsFromSnapshot,
  refsFromExportTargets,
  templateRefKey,
  contentHashBase64
};
