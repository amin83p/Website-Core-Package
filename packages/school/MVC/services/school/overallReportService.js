'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const fileAssetStorage = requireCoreModule('MVC/services/fileAssetStorageService');
const schoolDataService = require('./schoolDataService');
const reportService = require('./reportService');
const reportRuleEngineService = require('./reportRuleEngineService');
const reportDocxRenderService = require('./reportDocxRenderService');
const reportFunderDocxService = require('./reportFunderDocxService');
const overallReportTemplateModel = require('../../models/school/overallReportTemplateModel');
const overallReportInstanceModel = require('../../models/school/overallReportInstanceModel');

const COMPLETED_SOURCE_STATUSES = new Set(['submitted', 'locked']);
const DATA_FIELD_EXCLUSIONS = new Set(['section', 'subheader', 'row_break']);

function clone(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function clean(value = '') {
  return String(value ?? '').trim();
}

function normalizeTokenKey(value = '') {
  return reportDocxRenderService.normalizeTokenKey(value);
}

function valuesEqual(left, right) {
  if (left === right) return true;
  return JSON.stringify(left ?? '') === JSON.stringify(right ?? '');
}

function getDataFields(template = {}) {
  return (Array.isArray(template?.schema?.fields) ? template.schema.fields : [])
    .filter((field) => field?.id && !DATA_FIELD_EXCLUSIONS.has(String(field.type || '').toLowerCase()));
}

function getAllPrefillKeys() {
  const catalog = reportService.getPrefillCatalog();
  return Object.values(catalog || {})
    .flatMap((rows) => Array.isArray(rows) ? rows : [])
    .map((row) => clean(row?.key || row?.id || row))
    .filter(Boolean);
}

function getSourceTemplateKeyCatalog(template = {}) {
  const keys = new Set(getAllPrefillKeys());
  getDataFields(template).forEach((field) => {
    if (field.prefillKey) keys.add(clean(field.prefillKey));
    if (field.docxAlias) keys.add(clean(field.docxAlias));
    const mappedToken = normalizeTokenKey(template?.placeholderMap?.[field.id]);
    if (!mappedToken && field.id) keys.add(clean(field.id));
  });
  Object.values(template?.placeholderMap || {}).forEach((token) => {
    const key = normalizeTokenKey(token);
    if (key) keys.add(key);
  });
  return [...keys].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

async function validateTemplateReferences(template, reqUser) {
  const orgId = toPublicId(template?.orgId);
  const sourceTemplates = new Map();
  for (const slot of template?.sourceSlots || []) {
    // eslint-disable-next-line no-await-in-loop
    const sourceTemplate = await schoolDataService.getDataById('reportTemplates', slot.templateId, reqUser);
    if (!sourceTemplate || !idsEqual(sourceTemplate.orgId, orgId)) {
      throw new Error(`Source template for slot ${slot.slotKey} was not found in the active organization.`);
    }
    if (String(sourceTemplate.status || '').toLowerCase() === 'archived') {
      throw new Error(`Archived report template "${sourceTemplate.title || sourceTemplate.id}" cannot be newly selected.`);
    }
    sourceTemplates.set(slot.slotKey, sourceTemplate);
  }
  for (const field of getDataFields(template)) {
    for (const reference of field.sourceReferences || []) {
      const sourceTemplate = sourceTemplates.get(reference.slotKey);
      const keySet = new Set(getSourceTemplateKeyCatalog(sourceTemplate));
      if (!keySet.has(reference.key)) {
        throw new Error(
          `Overall field "${field.label || field.id}" references unavailable key "${reference.slotKey}.${reference.key}".`
        );
      }
    }
  }
  return sourceTemplates;
}

function buildCalculatedOrder(template = {}) {
  const fields = getDataFields(template);
  const fieldMap = new Map(fields.map((field) => [String(field.id), field]));
  const derived = fields.filter((field) => String(field.overallValueMode || 'manual') !== 'manual');
  const derivedIds = new Set(derived.map((field) => String(field.id)));
  const indegree = new Map(derived.map((field) => [String(field.id), 0]));
  const dependents = new Map(derived.map((field) => [String(field.id), []]));
  derived.forEach((field) => {
    (field.calculationDependencies || []).forEach((dependencyId) => {
      if (!fieldMap.has(dependencyId)) throw new Error(`Unknown overall field dependency "${dependencyId}".`);
      if (!derivedIds.has(dependencyId)) return;
      indegree.set(field.id, (indegree.get(field.id) || 0) + 1);
      dependents.get(dependencyId).push(field.id);
    });
  });
  const queue = [...derivedIds].filter((fieldId) => (indegree.get(fieldId) || 0) === 0);
  const ordered = [];
  while (queue.length) {
    const fieldId = queue.shift();
    ordered.push(fieldId);
    (dependents.get(fieldId) || []).forEach((dependentId) => {
      indegree.set(dependentId, (indegree.get(dependentId) || 0) - 1);
      if ((indegree.get(dependentId) || 0) === 0) queue.push(dependentId);
    });
  }
  if (ordered.length !== derivedIds.size) throw new Error('Overall report field calculations contain a dependency cycle.');
  return { fields, fieldMap, ordered };
}

function getAffectedFieldIds(template, slotKey, sourceKey) {
  const fields = getDataFields(template);
  const affected = new Set(
    fields
      .filter((field) => (field.sourceReferences || []).some((reference) => (
        reference.slotKey === slotKey && reference.key === sourceKey
      )))
      .map((field) => field.id)
  );
  let changed = true;
  while (changed) {
    changed = false;
    fields.forEach((field) => {
      if (affected.has(field.id)) return;
      if (!(field.calculationDependencies || []).some((fieldId) => affected.has(fieldId))) return;
      affected.add(field.id);
      changed = true;
    });
  }
  return affected;
}

function calculateAnswers({
  template,
  sourceValues = {},
  currentAnswers = {},
  derivedOverrides = {},
  initialize = false,
  replaceOverrideFieldIds = []
}) {
  const { fields, fieldMap, ordered } = buildCalculatedOrder(template);
  const answers = { ...(currentAnswers || {}) };
  const overrides = { ...(derivedOverrides || {}) };
  const replaceOverrides = new Set(replaceOverrideFieldIds || []);
  const diagnostics = [];

  fields.forEach((field) => {
    if (String(field.overallValueMode || 'manual') !== 'manual') return;
    if (initialize && !Object.prototype.hasOwnProperty.call(answers, field.id)) {
      answers[field.id] = clone(field.defaultValue, field.defaultValue ?? '');
    }
  });

  ordered.forEach((fieldId) => {
    const field = fieldMap.get(fieldId);
    const mode = String(field?.overallValueMode || 'manual');
    if (mode === 'derived_editable' && overrides[fieldId] && !replaceOverrides.has(fieldId)) return;
    const previousValue = answers[fieldId];
    try {
      answers[fieldId] = reportRuleEngineService.evaluateSafeExpression(field.calculationRule.expression, {
        value: previousValue,
        answers,
        sources: sourceValues
      });
      if (replaceOverrides.has(fieldId)) overrides[fieldId] = false;
    } catch (error) {
      if (field?.calculationRule?.onError === 'empty') answers[fieldId] = '';
      else answers[fieldId] = previousValue;
      diagnostics.push({
        fieldId,
        fieldLabel: field?.label || fieldId,
        message: error.message
      });
    }
  });

  return { answers, derivedOverrides: overrides, diagnostics };
}

function validateAnswers(template, answers) {
  return reportRuleEngineService.evaluateTemplateValidations({
    template,
    mergedAnswers: answers || {},
    prefill: {}
  });
}

function hasBlockingValidationErrors(validation = {}) {
  return validation?.hasBlockingErrors === true
    || (Array.isArray(validation?.errors) && validation.errors.length > 0);
}

function nextRevision(instance = {}) {
  return Math.max(1, Number(instance?.revision || 1) || 1) + 1;
}

async function buildSourcePayload(instance, reqUser) {
  const [template, assignment] = await Promise.all([
    schoolDataService.getDataById('reportTemplates', instance.templateId, reqUser),
    instance.assignmentId
      ? schoolDataService.getDataById('reportAssignments', instance.assignmentId, reqUser)
      : Promise.resolve(null)
  ]);
  if (!template) throw new Error(`Report template not found for source instance ${instance.id}.`);
  const bundle = reportService.buildDocxPlaceholderPayloadDetailed(template, instance, assignment);
  const values = {};
  Object.entries(bundle.placeholders || {}).forEach(([token, value]) => {
    const key = normalizeTokenKey(token);
    if (key) values[key] = value;
  });
  return { template, assignment, values, diagnostics: bundle.conversionDiagnostics || [] };
}

async function createOverallInstance({
  template,
  sourceSelections,
  selectedDocxKey = 'default',
  title = '',
  reqUser
}) {
  if (String(template?.status || '').toLowerCase() !== 'active') {
    throw new Error('Only active overall report templates can create reports.');
  }
  await validateTemplateReferences(template, reqUser);
  const selectionsBySlot = new Map(
    (Array.isArray(sourceSelections) ? sourceSelections : []).map((row) => [clean(row?.slotKey).toUpperCase(), row])
  );
  const sourceValues = {};
  const normalizedSelections = [];
  for (const slot of template.sourceSlots || []) {
    const requested = selectionsBySlot.get(slot.slotKey);
    if (!requested?.instanceId) throw new Error(`Select a completed report for source slot ${slot.slotKey}.`);
    // eslint-disable-next-line no-await-in-loop
    const sourceInstance = await schoolDataService.getDataById('reportInstances', requested.instanceId, reqUser);
    if (!sourceInstance || !idsEqual(sourceInstance.orgId, template.orgId)) {
      throw new Error(`Source report for slot ${slot.slotKey} was not found in the active organization.`);
    }
    if (!idsEqual(sourceInstance.templateId, slot.templateId)) {
      throw new Error(`Source report ${sourceInstance.id} does not match template slot ${slot.slotKey}.`);
    }
    const sourceStatus = String(sourceInstance.status || '').toLowerCase();
    if (!COMPLETED_SOURCE_STATUSES.has(sourceStatus)) {
      throw new Error(`Source report ${sourceInstance.id} must be submitted or locked.`);
    }
    // eslint-disable-next-line no-await-in-loop
    const payload = await buildSourcePayload(sourceInstance, reqUser);
    sourceValues[slot.slotKey] = payload.values;
    normalizedSelections.push({
      slotKey: slot.slotKey,
      templateId: sourceInstance.templateId,
      templateTitle: clean(payload.template?.title || payload.template?.name || sourceInstance.templateId),
      templateVersion: Number(sourceInstance.templateVersion || 1),
      instanceId: sourceInstance.id,
      instanceTitle: clean(sourceInstance.title || sourceInstance.name || sourceInstance.id),
      instanceStatus: sourceStatus,
      capturedAt: new Date().toISOString()
    });
  }
  const requestedDocxKey = clean(selectedDocxKey || 'default') || 'default';
  const availableDocx = reportFunderDocxService.buildAvailableDocxOptions(template);
  const selectedOption = availableDocx.find((row) => (
    idsEqual(row.key, requestedDocxKey)
    || String(row.key || '').toLowerCase() === requestedDocxKey.toLowerCase()
  ));
  if (!selectedOption) throw new Error('The selected overall report Word template is unavailable.');
  const resolvedDocx = reportFunderDocxService.resolveDocxTemplateForFunder({
    template,
    funderKey: selectedOption.key
  });
  if (!resolvedDocx.docxTemplate) throw new Error('Select an available Word template before creating the overall report.');
  const calculated = calculateAnswers({
    template,
    sourceValues,
    currentAnswers: {},
    derivedOverrides: {},
    initialize: true
  });
  if (calculated.diagnostics.length) {
    throw new Error(`Unable to calculate overall report fields: ${calculated.diagnostics.map((row) => row.message).join(' | ')}`);
  }
  const now = new Date().toISOString();
  const record = overallReportInstanceModel.sanitizeInstance({
    orgId: template.orgId,
    overallTemplateId: template.id,
    overallTemplateVersion: template.version,
    title: clean(title) || `${template.title} - ${now.slice(0, 10)}`,
    status: 'draft',
    selectedDocxKey: resolvedDocx.docxKey,
    templateSnapshot: clone(template, {}),
    sourceSelections: normalizedSelections,
    sourceValues,
    answers: calculated.answers,
    derivedOverrides: calculated.derivedOverrides,
    generatedDocs: [],
    revision: 1,
    audit: {
      createUser: reqUser?.id || '',
      createDateTime: now,
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: now
    }
  });
  return schoolDataService.addData('overallReportInstances', record, reqUser);
}

async function getOverallInstance(id, reqUser) {
  const instance = await schoolDataService.getDataById('overallReportInstances', id, reqUser);
  if (!instance) throw new Error('Overall report not found.');
  const activeOrgId = toPublicId(reqUser?.activeOrgId || reqUser?.organizationId || reqUser?.orgId);
  if (activeOrgId && !idsEqual(instance.orgId, activeOrgId)) throw new Error('Overall report is outside the active organization.');
  return instance;
}

async function saveOverallAnswers({ instance, submittedAnswers = {}, reqUser }) {
  if (String(instance.status || '') !== 'draft') throw new Error('Only draft overall reports can be edited.');
  const template = instance.templateSnapshot || {};
  const fields = getDataFields(template);
  const nextAnswers = { ...(instance.answers || {}) };
  const overrides = { ...(instance.derivedOverrides || {}) };
  fields.forEach((field) => {
    const mode = String(field.overallValueMode || 'manual');
    if (mode === 'derived_locked') return;
    if (!Object.prototype.hasOwnProperty.call(submittedAnswers, field.id)) return;
    nextAnswers[field.id] = submittedAnswers[field.id];
  });
  const baseline = calculateAnswers({
    template,
    sourceValues: instance.sourceValues || {},
    currentAnswers: nextAnswers,
    derivedOverrides: {},
    initialize: false
  });
  fields.forEach((field) => {
    if (String(field.overallValueMode) !== 'derived_editable') return;
    if (!Object.prototype.hasOwnProperty.call(submittedAnswers, field.id)) return;
    overrides[field.id] = !valuesEqual(submittedAnswers[field.id], baseline.answers[field.id]);
  });
  const finalCalculation = calculateAnswers({
    template,
    sourceValues: instance.sourceValues || {},
    currentAnswers: nextAnswers,
    derivedOverrides: overrides,
    initialize: false
  });
  const validation = validateAnswers(template, finalCalculation.answers);
  const now = new Date().toISOString();
  return schoolDataService.updateData('overallReportInstances', instance.id, {
    answers: finalCalculation.answers,
    derivedOverrides: finalCalculation.derivedOverrides,
    revision: nextRevision(instance),
    audit: {
      ...(instance.audit || {}),
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: now
    }
  }, reqUser).then((updated) => ({ instance: updated, validation, diagnostics: finalCalculation.diagnostics }));
}

async function buildSourceUpdatePreview(instance, reqUser) {
  const template = instance.templateSnapshot || {};
  const latestValues = {};
  const issues = [];
  for (const selection of instance.sourceSelections || []) {
    // eslint-disable-next-line no-await-in-loop
    const sourceInstance = await schoolDataService.getDataById('reportInstances', selection.instanceId, reqUser);
    if (!sourceInstance) {
      issues.push({ slotKey: selection.slotKey, message: `Source report ${selection.instanceId} is unavailable.` });
      continue;
    }
    if (!idsEqual(sourceInstance.orgId, instance.orgId)
      || !idsEqual(sourceInstance.templateId, selection.templateId)) {
      issues.push({
        slotKey: selection.slotKey,
        message: `Source report ${sourceInstance.id} no longer matches the stored organization or template.`
      });
      continue;
    }
    if (!COMPLETED_SOURCE_STATUSES.has(String(sourceInstance.status || '').toLowerCase())) {
      issues.push({ slotKey: selection.slotKey, message: `Source report ${sourceInstance.id} is no longer submitted or locked.` });
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const sourcePayload = await buildSourcePayload(sourceInstance, reqUser);
      latestValues[selection.slotKey] = sourcePayload.values;
      if (sourcePayload.diagnostics.length) {
        sourcePayload.diagnostics.forEach((diagnostic) => {
          issues.push({
            slotKey: selection.slotKey,
            message: diagnostic.message || diagnostic.error || 'A source value could not be converted.'
          });
        });
      }
    } catch (error) {
      issues.push({ slotKey: selection.slotKey, message: error.message });
    }
  }
  const candidateSources = clone(instance.sourceValues || {}, {});
  Object.entries(latestValues).forEach(([slotKey, values]) => {
    candidateSources[slotKey] = { ...(candidateSources[slotKey] || {}), ...(values || {}) };
  });
  const candidate = calculateAnswers({
    template,
    sourceValues: candidateSources,
    currentAnswers: instance.answers || {},
    derivedOverrides: instance.derivedOverrides || {},
    initialize: false
  });
  const changes = [];
  Object.entries(latestValues).forEach(([slotKey, values]) => {
    const stored = instance.sourceValues?.[slotKey] || {};
    Object.keys(stored).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(values || {}, key)) return;
      issues.push({
        slotKey,
        key,
        message: `Current source no longer provides "${key}". The stored snapshot value was preserved.`
      });
    });
    Object.entries(values || {}).forEach(([key, newValue]) => {
      if (valuesEqual(stored[key], newValue)) return;
      const affectedIds = getAffectedFieldIds(template, slotKey, key);
      const affectedFields = getDataFields(template)
        .filter((field) => affectedIds.has(field.id))
        .map((field) => ({
          fieldId: field.id,
          label: field.label || field.id,
          currentValue: instance.answers?.[field.id],
          newValue: candidate.answers?.[field.id],
          overridden: Boolean(instance.derivedOverrides?.[field.id])
        }));
      changes.push({
        selectionKey: `${slotKey}:${encodeURIComponent(key)}`,
        slotKey,
        sourceInstanceId: (instance.sourceSelections || []).find((row) => row.slotKey === slotKey)?.instanceId || '',
        sourceInstanceTitle: (instance.sourceSelections || []).find((row) => row.slotKey === slotKey)?.instanceTitle || '',
        sourceTemplateId: (instance.sourceSelections || []).find((row) => row.slotKey === slotKey)?.templateId || '',
        sourceTemplateTitle: (instance.sourceSelections || []).find((row) => row.slotKey === slotKey)?.templateTitle || '',
        key,
        oldValue: stored[key],
        newValue,
        affectedFields
      });
    });
  });
  return { changes, issues, diagnostics: candidate.diagnostics };
}

async function applySourceUpdates({
  instance,
  selectedKeys = [],
  replaceOverrideFieldIds = [],
  reqUser
}) {
  if (String(instance.status || '') !== 'draft') throw new Error('Only draft overall reports can apply source updates.');
  const preview = await buildSourceUpdatePreview(instance, reqUser);
  const selected = new Set((Array.isArray(selectedKeys) ? selectedKeys : []).map(clean).filter(Boolean));
  if (!selected.size) throw new Error('Select at least one source value to update.');
  const nextSources = clone(instance.sourceValues || {}, {});
  let applied = 0;
  const replaceableFields = new Set();
  preview.changes.forEach((change) => {
    if (!selected.has(change.selectionKey)) return;
    nextSources[change.slotKey] = { ...(nextSources[change.slotKey] || {}), [change.key]: change.newValue };
    (change.affectedFields || []).forEach((field) => replaceableFields.add(field.fieldId));
    applied += 1;
  });
  if (!applied) throw new Error('The selected source values no longer have changes to apply.');
  const calculated = calculateAnswers({
    template: instance.templateSnapshot || {},
    sourceValues: nextSources,
    currentAnswers: instance.answers || {},
    derivedOverrides: instance.derivedOverrides || {},
    replaceOverrideFieldIds: (Array.isArray(replaceOverrideFieldIds) ? replaceOverrideFieldIds : [])
      .filter((fieldId) => replaceableFields.has(fieldId)),
    initialize: false
  });
  const updated = await schoolDataService.updateData('overallReportInstances', instance.id, {
    sourceValues: nextSources,
    answers: calculated.answers,
    derivedOverrides: calculated.derivedOverrides,
    revision: nextRevision(instance),
    audit: {
      ...(instance.audit || {}),
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: new Date().toISOString(),
      sourceValuesUpdatedAt: new Date().toISOString()
    }
  }, reqUser);
  return { instance: updated, appliedCount: applied, diagnostics: calculated.diagnostics };
}

async function resetDerivedOverride({ instance, fieldId, reqUser }) {
  if (String(instance.status || '') !== 'draft') {
    throw new Error('Only draft overall reports can reset derived overrides.');
  }
  const field = getDataFields(instance.templateSnapshot || {})
    .find((row) => row.id === clean(fieldId));
  if (!field || String(field.overallValueMode || '') !== 'derived_editable') {
    throw new Error('Select an editable derived field to reset.');
  }
  const calculated = calculateAnswers({
    template: instance.templateSnapshot || {},
    sourceValues: instance.sourceValues || {},
    currentAnswers: instance.answers || {},
    derivedOverrides: instance.derivedOverrides || {},
    replaceOverrideFieldIds: [field.id],
    initialize: false
  });
  const updated = await schoolDataService.updateData('overallReportInstances', instance.id, {
    answers: calculated.answers,
    derivedOverrides: calculated.derivedOverrides,
    revision: nextRevision(instance),
    audit: {
      ...(instance.audit || {}),
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: new Date().toISOString()
    }
  }, reqUser);
  return { instance: updated, diagnostics: calculated.diagnostics };
}

async function transitionStatus({ instance, action, reqUser }) {
  const current = String(instance.status || 'draft').toLowerCase();
  let next = current;
  if (action === 'submit') {
    if (current !== 'draft') throw new Error('Only draft overall reports can be submitted.');
    const validation = validateAnswers(instance.templateSnapshot || {}, instance.answers || {});
    if (hasBlockingValidationErrors(validation)) {
      const error = new Error('Resolve all validation errors before submitting this overall report.');
      error.validation = validation;
      throw error;
    }
    const calculation = findCalculationMismatches(instance);
    if (calculation.diagnostics.length || calculation.mismatches.length) {
      throw new Error('Save the overall report to resolve calculation changes before submitting it.');
    }
    next = 'submitted';
  } else if (action === 'lock') {
    if (current !== 'submitted') throw new Error('Only submitted overall reports can be locked.');
    next = 'locked';
  } else if (action === 'unlock') {
    if (current !== 'locked') throw new Error('Only locked overall reports can be unlocked.');
    next = 'submitted';
  } else if (action === 'reopen') {
    if (current !== 'submitted') throw new Error('Only submitted overall reports can be reopened to draft.');
    next = 'draft';
  } else if (action === 'archive') {
    next = 'archived';
  } else {
    throw new Error('Unsupported overall report lifecycle action.');
  }
  const now = new Date().toISOString();
  const audit = {
    ...(instance.audit || {}),
    lastUpdateUser: reqUser?.id || '',
    lastUpdateDateTime: now
  };
  if (next === 'submitted') audit.submittedAt = action === 'submit' ? now : audit.submittedAt;
  if (next === 'locked') audit.lockedAt = now;
  if (action === 'unlock') {
    audit.unlockedAt = now;
    audit.unlockedBy = reqUser?.id || '';
  }
  if (next === 'archived') audit.archivedAt = now;
  return schoolDataService.updateData('overallReportInstances', instance.id, {
    status: next,
    revision: nextRevision(instance),
    audit
  }, reqUser);
}

function buildDocxPayloadDetailed(instance) {
  const placeholders = {};
  const conversionDiagnostics = [];
  Object.entries(instance.sourceValues || {}).forEach(([slotKey, values]) => {
    Object.entries(values || {}).forEach(([key, value]) => {
      placeholders[`${slotKey}.${key}`] = value;
    });
  });
  const template = instance.templateSnapshot || {};
  getDataFields(template).forEach((field) => {
    const conversion = reportRuleEngineService.convertFieldValueForExport({
      field,
      value: instance.answers?.[field.id],
      answers: instance.answers || {},
      prefill: {}
    });
    const value = reportRuleEngineService.applyExportTextCase(conversion.value, field.exportTextCase);
    if (conversion.diagnostic) conversionDiagnostics.push(conversion.diagnostic);
    placeholders[`O.${field.id}`] = value;
    const alias = reportRuleEngineService.normalizeDocxAlias(field.docxAlias);
    if (reportRuleEngineService.DOCX_ALIAS_PATTERN.test(alias)) placeholders[`O.${alias}`] = value;
  });
  return { placeholders, conversionDiagnostics };
}

function buildDocxPayload(instance) {
  return buildDocxPayloadDetailed(instance).placeholders;
}

function findCalculationMismatches(instance) {
  const template = instance.templateSnapshot || {};
  const calculated = calculateAnswers({
    template,
    sourceValues: instance.sourceValues || {},
    currentAnswers: instance.answers || {},
    derivedOverrides: instance.derivedOverrides || {},
    initialize: false
  });
  const mismatches = [];
  getDataFields(template).forEach((field) => {
    const mode = String(field.overallValueMode || 'manual');
    if (mode === 'manual') return;
    if (mode === 'derived_editable' && instance.derivedOverrides?.[field.id]) return;
    if (valuesEqual(instance.answers?.[field.id], calculated.answers?.[field.id])) return;
    mismatches.push({
      fieldId: field.id,
      fieldLabel: field.label || field.id,
      storedValue: instance.answers?.[field.id],
      calculatedValue: calculated.answers?.[field.id]
    });
  });
  return { mismatches, diagnostics: calculated.diagnostics };
}

async function buildExportPreview(instance) {
  const template = instance.templateSnapshot || {};
  const availableDocx = reportFunderDocxService.buildAvailableDocxOptions(template);
  const selectedDocx = availableDocx.find((row) => (
    idsEqual(row.key, instance.selectedDocxKey)
    || String(row.key || '').toLowerCase() === String(instance.selectedDocxKey || '').toLowerCase()
  ));
  if (!selectedDocx) throw new Error('The selected overall report Word template is unavailable.');
  const resolved = reportFunderDocxService.resolveDocxTemplateForFunder({
    template,
    funderKey: selectedDocx.key
  });
  if (!resolved.docxTemplate) throw new Error('The selected overall report Word template is unavailable.');
  const payload = buildDocxPayloadDetailed(instance);
  const placeholders = payload.placeholders;
  const inspection = await reportDocxRenderService.inspectDocxTemplateTokens(resolved.docxTemplate);
  const missingTokens = inspection.tokens.filter((token) => !Object.prototype.hasOwnProperty.call(placeholders, token));
  const validation = validateAnswers(template, instance.answers || {});
  const calculation = findCalculationMismatches(instance);
  return {
    docxKey: resolved.docxKey,
    docxLabel: resolved.label,
    fileName: resolved.docxTemplate.originalName || resolved.docxTemplate.fileName || '',
    placeholders,
    tokens: inspection.tokens,
    missingTokens,
    validation,
    conversionDiagnostics: payload.conversionDiagnostics,
    calculationDiagnostics: calculation.diagnostics,
    calculationMismatches: calculation.mismatches,
    ready: !missingTokens.length
      && !hasBlockingValidationErrors(validation)
      && !payload.conversionDiagnostics.length
      && !calculation.diagnostics.length
      && !calculation.mismatches.length,
    resolved
  };
}

async function exportOverallReport(instance, reqUser) {
  if (!COMPLETED_SOURCE_STATUSES.has(String(instance.status || '').toLowerCase())) {
    throw new Error('Submit or lock the overall report before exporting the final DOCX.');
  }
  const preview = await buildExportPreview(instance);
  if (preview.missingTokens.length) {
    throw new Error(`DOCX export cancelled. Missing stored values for: ${preview.missingTokens.join(', ')}.`);
  }
  if (!preview.ready) {
    throw new Error('DOCX export cancelled because the overall report has validation or calculation errors.');
  }
  const rendered = await reportDocxRenderService.renderReportInstanceDocx({
    template: instance.templateSnapshot,
    instance,
    placeholders: preview.placeholders,
    collections: {},
    docxTemplateOverride: preview.resolved.docxTemplate
  });
  const saved = await fileAssetStorage.saveBuffer({
    scopeKey: instance.orgId,
    relativeDir: 'school-reports/overall/generated',
    fileName: rendered.fileName,
    originalName: rendered.fileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: rendered.buffer
  });
  const generatedDoc = {
    fileName: saved.fileName || rendered.fileName,
    path: saved.path || saved.url || '',
    url: saved.url || '',
    docxKey: preview.docxKey,
    generatedAt: new Date().toISOString(),
    generatedBy: reqUser?.id || '',
    revision: Number(instance.revision || 1)
  };
  const updated = await schoolDataService.updateData('overallReportInstances', instance.id, {
    generatedDocs: [...(instance.generatedDocs || []), generatedDoc],
    revision: nextRevision(instance),
    audit: {
      ...(instance.audit || {}),
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: new Date().toISOString()
    }
  }, reqUser);
  return { rendered, saved, generatedDoc, instance: updated };
}

module.exports = {
  COMPLETED_SOURCE_STATUSES: Object.freeze([...COMPLETED_SOURCE_STATUSES]),
  getSourceTemplateKeyCatalog,
  validateTemplateReferences,
  calculateAnswers,
  validateAnswers,
  buildSourcePayload,
  createOverallInstance,
  getOverallInstance,
  saveOverallAnswers,
  buildSourceUpdatePreview,
  applySourceUpdates,
  resetDerivedOverride,
  transitionStatus,
  hasBlockingValidationErrors,
  buildDocxPayload,
  buildDocxPayloadDetailed,
  findCalculationMismatches,
  buildExportPreview,
  exportOverallReport
};
