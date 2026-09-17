'use strict';

const schoolDataService = require('./schoolDataService');
const studentAttendanceReportPolicyService = require('./studentAttendanceReportPolicyService');
const studentAttendanceReportExportFormatService = require('./studentAttendanceReportExportFormatService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const {
  normalizeIdList,
  assertReportTemplateAccessible,
  assertOverallTemplatesAccessible,
  formatTemplateLabel
} = studentAttendanceReportPolicyService;

const DEFAULT_POLICY = Object.freeze({
  reportTemplateIds: Object.freeze([]),
  overallReportTemplateId: '',
  overallReportTemplateIds: Object.freeze([]),
  templateExportFormats: Object.freeze({
    report: Object.freeze({}),
    overall: Object.freeze({})
  })
});

function normalizePolicyFromStored(input = {}) {
  const reportTemplateIds = normalizeIdList(input.reportTemplateIds);
  const overallReportTemplateIds = normalizeIdList(
    input.overallReportTemplateIds,
    input.overallReportTemplateId
  );
  const base = {
    reportTemplateIds,
    overallReportTemplateId: overallReportTemplateIds[0] || '',
    overallReportTemplateIds
  };
  return {
    ...base,
    templateExportFormats: studentAttendanceReportExportFormatService.sanitizeSmmrTemplateExportFormats(
      input.templateExportFormats,
      base
    )
  };
}

function normalizePolicyFromForm(input = {}) {
  let reportSource = input.reportTemplateIds;
  if (reportSource === undefined || reportSource === null) {
    reportSource = input.reportTemplateIdsJson;
  }
  let overallSource = input.overallReportTemplateIds;
  if (overallSource === undefined || overallSource === null) {
    overallSource = input.overallReportTemplateIdsJson;
  }
  const base = normalizePolicyFromStored({
    reportTemplateIds: reportSource,
    overallReportTemplateId: input.overallReportTemplateId,
    overallReportTemplateIds: overallSource
  });
  return {
    ...base,
    templateExportFormats: studentAttendanceReportExportFormatService.sanitizeSmmrTemplateExportFormats(
      input.templateExportFormats,
      base
    )
  };
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
  await assertOverallTemplatesAccessible(normalized.overallReportTemplateIds, reqUser);
  return normalized;
}

module.exports = {
  DEFAULT_POLICY,
  normalizePolicyFromStored,
  normalizePolicyFromForm,
  resolvePolicy,
  normalizeIdList,
  validatePolicyInput,
  formatTemplateLabel,
  assertOverallTemplatesAccessible
};
