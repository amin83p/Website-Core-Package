'use strict';

const schoolDataService = require('./schoolDataService');
const overallReportService = require('./overallReportService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function cleanId(value = '') {
  return String(value ?? '').trim();
}

const DEFAULT_POLICY = Object.freeze({
  reportTemplateId: '',
  overallReportTemplateId: '',
  overallReportTemplateIds: Object.freeze([])
});

function normalizeIdList(value, fallbackValue = '') {
  let source = value;
  if (source === undefined || source === null || source === '') {
    source = fallbackValue ? [fallbackValue] : [];
  }
  if (typeof source === 'string') {
    const text = source.trim();
    if (!text) {
      source = [];
    } else if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text);
        source = Array.isArray(parsed) ? parsed : [text];
      } catch {
        source = [text];
      }
    } else {
      source = text.split(',');
    }
  }
  const seen = new Set();
  return (Array.isArray(source) ? source : [source])
    .map((id) => cleanId(id))
    .filter(Boolean)
    .filter((id) => {
      const key = id.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizePolicyFromStored(input = {}) {
  const overallReportTemplateIds = normalizeIdList(input.overallReportTemplateIds, input.overallReportTemplateId);
  return {
    reportTemplateId: cleanId(input.reportTemplateId),
    overallReportTemplateId: overallReportTemplateIds[0] || '',
    overallReportTemplateIds
  };
}

function normalizePolicyFromForm(input = {}) {
  return normalizePolicyFromStored({
    reportTemplateId: input.reportTemplateId,
    overallReportTemplateId: input.overallReportTemplateId,
    overallReportTemplateIds: input.overallReportTemplateIds || input.overallReportTemplateIdsJson
  });
}

function resolvePolicy(input = {}) {
  return normalizePolicyFromStored(input);
}

async function assertReportTemplateAccessible(templateId, reqUser, { required = false } = {}) {
  const id = cleanId(templateId);
  if (!id) {
    if (required) {
      const error = new Error('Select a report template for the Student Attendance Report.');
      error.statusCode = 400;
      throw error;
    }
    return null;
  }
  const template = await schoolDataService.getDataById('reportTemplates', id, reqUser);
  if (!template) {
    const error = new Error('The selected report template was not found.');
    error.statusCode = 400;
    throw error;
  }
  const activeOrgId = cleanId(reqUser?.activeOrgId);
  if (activeOrgId && !idsEqual(template.orgId, activeOrgId)) {
    const error = new Error('The selected report template is not available for the active organization.');
    error.statusCode = 400;
    throw error;
  }
  if (String(template.status || '').trim().toLowerCase() === 'archived') {
    const error = new Error('Archived report templates cannot be selected.');
    error.statusCode = 400;
    throw error;
  }
  return template;
}

async function assertOverallTemplateAccessible(templateId, reqUser) {
  const id = cleanId(templateId);
  if (!id) return null;
  const template = await schoolDataService.getDataById('overallReportTemplates', id, reqUser);
  if (!template) {
    const error = new Error('The selected overall report template was not found.');
    error.statusCode = 400;
    throw error;
  }
  const activeOrgId = cleanId(reqUser?.activeOrgId);
  if (activeOrgId && !idsEqual(template.orgId, activeOrgId)) {
    const error = new Error('The selected overall report template is not available for the active organization.');
    error.statusCode = 400;
    throw error;
  }
  if (String(template.status || '').trim().toLowerCase() !== 'active') {
    const error = new Error('Overall report template must be active.');
    error.statusCode = 400;
    throw error;
  }
  await overallReportService.validateTemplateReferences(template, reqUser);
  return template;
}

async function assertOverallTemplatesAccessible(templateIds = [], reqUser) {
  const templates = [];
  for (const templateId of normalizeIdList(templateIds)) {
    // eslint-disable-next-line no-await-in-loop
    const template = await assertOverallTemplateAccessible(templateId, reqUser);
    if (template) templates.push(template);
  }
  return templates;
}

async function validatePolicyInput(input = {}, reqUser) {
  const normalized = normalizePolicyFromForm(input);
  await assertReportTemplateAccessible(normalized.reportTemplateId, reqUser, { required: false });
  await assertOverallTemplatesAccessible(normalized.overallReportTemplateIds, reqUser);
  return normalized;
}

function formatTemplateLabel(template = {}, fallbackId = '') {
  const id = cleanId(template?.id || fallbackId);
  const title = cleanId(template?.title || id);
  const type = cleanId(template?.type);
  const version = Number(template?.version) || 1;
  if (!id) return '';
  return type ? `${title} | ${type} v${version}` : `${title} v${version}`;
}

module.exports = {
  DEFAULT_POLICY,
  normalizePolicyFromStored,
  normalizePolicyFromForm,
  resolvePolicy,
  normalizeIdList,
  validatePolicyInput,
  assertReportTemplateAccessible,
  assertOverallTemplateAccessible,
  assertOverallTemplatesAccessible,
  formatTemplateLabel
};
