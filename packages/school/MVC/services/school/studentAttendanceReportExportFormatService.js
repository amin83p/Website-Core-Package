'use strict';

const DEFAULT_REPORT_EXPORT_FORMATS = Object.freeze({
  docx: true,
  pdf: true,
  payload: true
});

const DEFAULT_OVERALL_EXPORT_FORMATS = Object.freeze({
  docx: true,
  payload: true
});

function clean(value = '') {
  return String(value ?? '').trim();
}

function policyFlag(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(token)) return true;
  if (['0', 'false', 'off', 'no'].includes(token)) return false;
  return fallback;
}

function parseTemplateExportFormatsInput(raw = {}) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return {};
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  return typeof raw === 'object' ? raw : {};
}

function sanitizeExportFormatFlags(raw = {}, { kind = 'report' } = {}) {
  if (kind === 'overall') {
    return {
      docx: policyFlag(raw.docx, true),
      payload: policyFlag(raw.payload, true)
    };
  }
  return {
    docx: policyFlag(raw.docx, true),
    pdf: policyFlag(raw.pdf, true),
    payload: policyFlag(raw.payload, true)
  };
}

function sanitizeTemplateExportFormats(input = {}, normalizedPolicy = {}) {
  const parsed = parseTemplateExportFormatsInput(input);
  const reportIn = parsed.report && typeof parsed.report === 'object' ? parsed.report : {};
  const overallIn = parsed.overall && typeof parsed.overall === 'object' ? parsed.overall : {};
  const reportId = clean(normalizedPolicy.reportTemplateId);
  const overallIds = Array.isArray(normalizedPolicy.overallReportTemplateIds)
    ? normalizedPolicy.overallReportTemplateIds
    : [];

  const report = {};
  if (reportId) {
    report[reportId] = sanitizeExportFormatFlags(
      reportIn[reportId] || reportIn[reportId.toLowerCase()] || {},
      { kind: 'report' }
    );
  }

  const overall = {};
  overallIds.forEach((templateId) => {
    const id = clean(templateId);
    if (!id) return;
    overall[id] = sanitizeExportFormatFlags(
      overallIn[id] || overallIn[id.toLowerCase()] || {},
      { kind: 'overall' }
    );
  });

  return { report, overall };
}

function resolveTemplateExportFormats(policy = {}, kind = 'report', templateId = '') {
  const id = clean(templateId);
  if (!id) {
    return kind === 'overall'
      ? { ...DEFAULT_OVERALL_EXPORT_FORMATS }
      : { ...DEFAULT_REPORT_EXPORT_FORMATS };
  }
  const bucket = kind === 'overall'
    ? policy?.templateExportFormats?.overall
    : policy?.templateExportFormats?.report;
  const stored = bucket?.[id] || bucket?.[id.toLowerCase()];
  return sanitizeExportFormatFlags(stored || {}, { kind });
}

function isSarExportFormatEnabled(policy = {}, kind = 'report', templateId = '', format = '') {
  const token = clean(format).toLowerCase();
  const key = token === 'json' ? 'payload' : token;
  const flags = resolveTemplateExportFormats(policy, kind, templateId);
  return flags[key] !== false;
}

function resolveEffectiveClassExportFlags(policy = {}, templateId = '', templateMeta = {}) {
  const flags = resolveTemplateExportFormats(policy, 'report', templateId);
  return {
    hasDocx: Boolean(templateMeta.hasDocx) && flags.docx !== false,
    hasPdf: Boolean(templateMeta.hasPdf) && flags.pdf !== false,
    hasPayload: flags.payload !== false
  };
}

function resolveEffectiveOverallExportFlags(policy = {}, templateId = '', templateMeta = {}) {
  const flags = resolveTemplateExportFormats(policy, 'overall', templateId);
  return {
    hasDocx: Boolean(templateMeta.hasDocx) && flags.docx !== false,
    hasPayload: flags.payload !== false
  };
}

function assertSarExportFormatAllowed(policy = {}, kind = 'report', templateId = '', format = '') {
  const token = clean(format).toLowerCase();
  if (!['json', 'docx', 'pdf'].includes(token)) return;
  if (kind === 'overall' && token === 'pdf') {
    const error = new Error('Overall reports do not support PDF export.');
    error.statusCode = 400;
    throw error;
  }
  if (!isSarExportFormatEnabled(policy, kind, templateId, token)) {
    const label = token === 'json' ? 'Payload' : token.toUpperCase();
    const error = new Error(`${label} export is disabled for this template in School Settings.`);
    error.statusCode = 400;
    throw error;
  }
}

module.exports = {
  DEFAULT_REPORT_EXPORT_FORMATS,
  DEFAULT_OVERALL_EXPORT_FORMATS,
  sanitizeExportFormatFlags,
  sanitizeTemplateExportFormats,
  resolveTemplateExportFormats,
  isSarExportFormatEnabled,
  resolveEffectiveClassExportFlags,
  resolveEffectiveOverallExportFlags,
  assertSarExportFormatAllowed
};
