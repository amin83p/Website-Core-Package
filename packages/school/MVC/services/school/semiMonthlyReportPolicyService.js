'use strict';

const schoolDataService = require('./schoolDataService');
const studentAttendanceReportPolicyService = require('./studentAttendanceReportPolicyService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const { normalizeIdList, assertReportTemplateAccessible, formatTemplateLabel } = studentAttendanceReportPolicyService;

const DEFAULT_POLICY = Object.freeze({
  reportTemplateIds: Object.freeze([])
});

function normalizePolicyFromStored(input = {}) {
  return {
    reportTemplateIds: normalizeIdList(input.reportTemplateIds)
  };
}

function normalizePolicyFromForm(input = {}) {
  let source = input.reportTemplateIds;
  if (source === undefined || source === null) {
    source = input.reportTemplateIdsJson;
  }
  return normalizePolicyFromStored({ reportTemplateIds: source });
}

function resolvePolicy(input = {}) {
  return normalizePolicyFromStored(input);
}

async function assertReportTemplatesAccessible(templateIds = [], reqUser) {
  const templates = [];
  for (const templateId of normalizeIdList(templateIds)) {
    // eslint-disable-next-line no-await-in-loop
    const template = await assertReportTemplateAccessible(templateId, reqUser, { required: true });
    if (template) templates.push(template);
  }
  return templates;
}

async function validatePolicyInput(input = {}, reqUser) {
  const normalized = normalizePolicyFromForm(input);
  await assertReportTemplatesAccessible(normalized.reportTemplateIds, reqUser);
  return normalized;
}

module.exports = {
  DEFAULT_POLICY,
  normalizePolicyFromStored,
  normalizePolicyFromForm,
  resolvePolicy,
  normalizeIdList,
  validatePolicyInput,
  formatTemplateLabel
};
