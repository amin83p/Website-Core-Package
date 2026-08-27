'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const fileAssetStorage = requireCoreModule('MVC/services/fileAssetStorageService');
const schoolDataService = require('./schoolDataService');
const reportService = require('./reportService');
const reportRuleEngineService = require('./reportRuleEngineService');
const reportDocxRenderService = require('./reportDocxRenderService');
const reportFunderDocxService = require('./reportFunderDocxService');
const reportFunderPdfService = require('./reportFunderPdfService');
const reportPdfRenderService = require('./reportPdfRenderService');
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

function listDocxPlaceholderAliases(field = {}) {
  const aliases = new Set();
  const primary = reportRuleEngineService.normalizeDocxAlias(field.docxAlias);
  if (reportRuleEngineService.DOCX_ALIAS_PATTERN.test(primary)) aliases.add(primary);
  (Array.isArray(field.legacyDocxAliases) ? field.legacyDocxAliases : []).forEach((row) => {
    const alias = reportRuleEngineService.normalizeDocxAlias(row);
    if (reportRuleEngineService.DOCX_ALIAS_PATTERN.test(alias)) aliases.add(alias);
  });
  return [...aliases];
}

function formatMissingDocxTokenError(template, missingTokens = [], placeholders = {}) {
  const hints = missingTokens.map((token) => {
    const legacyAlias = String(token || '').replace(/^O\./, '');
    const field = getDataFields(template).find((row) => listDocxPlaceholderAliases(row).includes(legacyAlias));
    if (field) {
      const currentAlias = reportRuleEngineService.normalizeDocxAlias(field.docxAlias);
      const currentToken = currentAlias ? `O.${currentAlias}` : `O.${field.id}`;
      const hasCurrent = Object.prototype.hasOwnProperty.call(placeholders, currentToken);
      return `${token} (field "${field.label || field.id}" now uses ${currentToken}${hasCurrent ? '' : ', value missing'})`;
    }
    return token;
  });
  return `DOCX export cancelled. Missing stored values for: ${hints.join(', ')}. Update the Word template shortcuts or add previous shortcuts under legacy DOCX aliases on the overall fields.`;
}

function snapshotDocxAliases(template = {}) {
  return new Map(
    getDataFields(template).map((field) => [String(field.id), String(field.docxAlias || '')])
  );
}

function buildReservedDocxAliasTokens(template = {}) {
  const reserved = new Set();
  getDataFields(template).forEach((field) => {
    const id = normalizeTokenKey(field?.id);
    const prefillKey = normalizeTokenKey(field?.prefillKey);
    if (id) reserved.add(id);
    if (prefillKey) reserved.add(prefillKey);
  });
  Object.values(template?.placeholderMap || {}).forEach((token) => {
    const key = normalizeTokenKey(token);
    if (key) reserved.add(key);
  });
  return reserved;
}

function deterministicPreviewDocxAlias(fieldId, reserved = new Set()) {
  const slug = String(fieldId || 'field').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const firstMatch = slug.match(/[a-z]/);
  const first = firstMatch ? firstMatch[0] : 'f';
  const tailSource = slug.replace(/[^a-z0-9]/g, '').slice(1);
  const baseTail = `${tailSource}000`.slice(0, 3);
  const candidates = [
    `${first}${baseTail}`.slice(0, 4),
    `${first}${baseTail.slice(0, 2)}0`.slice(0, 4),
    `${first}000`.slice(0, 4)
  ];
  for (let counter = 0; counter < 1000; counter += 1) {
    const suffix = String(counter).padStart(3, '0').slice(-3);
    const candidate = counter === 0
      ? candidates.find((value) => reportRuleEngineService.DOCX_ALIAS_PATTERN.test(value) && !reserved.has(value))
      : `${first}${suffix}`.slice(0, 4);
    if (candidate && reportRuleEngineService.DOCX_ALIAS_PATTERN.test(candidate) && !reserved.has(candidate)) {
      reserved.add(candidate);
      return candidate;
    }
  }
  return reportRuleEngineService.generateDocxAlias(reserved);
}

function attachDocxAliasesToKeyOptions(template = {}, options = []) {
  const prepared = prepareSourceTemplateForKeyOptions(template);
  const reserved = buildReservedDocxAliasTokens(prepared);
  getDataFields(prepared).forEach((field) => {
    const alias = reportRuleEngineService.normalizeDocxAlias(field.docxAlias);
    if (reportRuleEngineService.DOCX_ALIAS_PATTERN.test(alias)) reserved.add(alias);
  });

  const aliasByCatalogKey = new Map();
  getDataFields(prepared).forEach((field) => {
    const alias = reportRuleEngineService.normalizeDocxAlias(field.docxAlias);
    if (!reportRuleEngineService.DOCX_ALIAS_PATTERN.test(alias)) return;
    [
      normalizeTokenKey(field.id),
      normalizeTokenKey(field.prefillKey),
      normalizeTokenKey(prepared?.placeholderMap?.[field.id])
    ].filter(Boolean).forEach((key) => aliasByCatalogKey.set(key, alias));
  });

  return options.map((option) => {
    if (option.origin === 'docx_alias') {
      const alias = String(option.key || '').toLowerCase();
      return {
        ...option,
        docxAlias: reportRuleEngineService.DOCX_ALIAS_PATTERN.test(alias) ? alias : ''
      };
    }
    const catalogKey = normalizeTokenKey(option.key);
    if (!catalogKey) return { ...option, docxAlias: '' };
    let docxAlias = aliasByCatalogKey.get(catalogKey) || '';
    if (!reportRuleEngineService.DOCX_ALIAS_PATTERN.test(docxAlias)) {
      if (!aliasByCatalogKey.has(catalogKey)) {
        docxAlias = deterministicPreviewDocxAlias(catalogKey, reserved);
        aliasByCatalogKey.set(catalogKey, docxAlias);
      } else {
        docxAlias = aliasByCatalogKey.get(catalogKey);
      }
    }
    return { ...option, docxAlias: docxAlias || '' };
  });
}

function buildDocxAliasLookup(template = {}) {
  const aliasToCatalogKey = new Map();
  const aliasKeys = new Set();
  getSourceTemplateKeyOptions(template).forEach((option) => {
    if (option.origin === 'docx_alias') return;
    const catalogKey = normalizeTokenKey(option.key);
    const alias = reportRuleEngineService.normalizeDocxAlias(option.docxAlias);
    if (!catalogKey || !reportRuleEngineService.DOCX_ALIAS_PATTERN.test(alias)) return;
    aliasToCatalogKey.set(alias, catalogKey);
    aliasKeys.add(alias);
  });
  return { aliasToCatalogKey, aliasKeys };
}

function mirrorDocxAliasValues(template = {}, values = {}) {
  const mirrored = { ...(values || {}) };
  getSourceTemplateKeyOptions(template).forEach((option) => {
    if (option.origin === 'docx_alias') return;
    const catalogKey = normalizeTokenKey(option.key);
    const alias = reportRuleEngineService.normalizeDocxAlias(option.docxAlias);
    if (!catalogKey || !reportRuleEngineService.DOCX_ALIAS_PATTERN.test(alias)) return;
    if (Object.prototype.hasOwnProperty.call(mirrored, catalogKey)) {
      mirrored[alias] = mirrored[catalogKey];
    }
  });
  return mirrored;
}

function prepareSourceTemplateForKeyOptions(template = {}) {
  const prepared = clone(template, {});
  if (!prepared?.schema?.fields) return prepared;
  const reserved = buildReservedDocxAliasTokens(prepared);
  getDataFields(prepared).forEach((field) => {
    const alias = reportRuleEngineService.normalizeDocxAlias(field.docxAlias);
    if (reportRuleEngineService.DOCX_ALIAS_PATTERN.test(alias) && !reserved.has(alias)) {
      reserved.add(alias);
      field.docxAlias = alias;
      return;
    }
    field.docxAlias = deterministicPreviewDocxAlias(field.id, reserved);
  });
  return prepared;
}

function ensureSourceTemplateDocxAliases(template = {}) {
  const working = clone(template, {});
  if (!working?.schema?.fields) return { template: working, changed: false };
  const before = snapshotDocxAliases(working);
  getDataFields(working).forEach((field) => {
    const alias = reportRuleEngineService.normalizeDocxAlias(field.docxAlias);
    if (alias && !reportRuleEngineService.DOCX_ALIAS_PATTERN.test(alias)) {
      field.docxAlias = '';
    }
  });
  reportRuleEngineService.ensureTemplateDocxAliases(working);
  const after = snapshotDocxAliases(working);
  const changed = before.size !== after.size
    || [...after.entries()].some(([fieldId, alias]) => before.get(fieldId) !== alias);
  return { template: working, changed };
}

function getSourceTemplateKeyOptions(template = {}) {
  const prepared = prepareSourceTemplateForKeyOptions(template);
  const templateId = clean(prepared?.id);
  const templateTitle = clean(prepared?.title || prepared?.name || templateId);
  const templateType = clean(prepared?.type);
  const templateVersion = Number(prepared?.version || 1);
  const options = new Map();

  const addOption = (keyValue, metadata = {}) => {
    const key = clean(keyValue);
    if (!key) return;
    const existing = options.get(key) || {};
    const incomingPriority = Number(metadata.priority || 0);
    const existingPriority = Number(existing.priority || 0);
    const preferred = incomingPriority >= existingPriority ? metadata : existing;
    options.set(key, {
      key,
      label: clean(preferred.label || existing.label || metadata.label || key),
      description: clean(preferred.description || existing.description || metadata.description),
      origin: clean(preferred.origin || existing.origin || metadata.origin || 'predefined'),
      group: clean(preferred.group || existing.group || metadata.group || 'Available values'),
      fieldId: clean(preferred.fieldId || existing.fieldId || metadata.fieldId),
      fieldType: clean(preferred.fieldType || existing.fieldType || metadata.fieldType),
      templateId,
      templateTitle,
      templateType,
      templateVersion,
      priority: Math.max(existingPriority, incomingPriority)
    });
  };

  Object.entries(reportService.getPrefillCatalog() || {}).forEach(([group, rows]) => {
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      addOption(row?.key || row?.id || row, {
        label: row?.label || row?.key || row,
        description: row?.description || '',
        origin: 'predefined',
        group,
        priority: 10
      });
    });
  });

  getDataFields(prepared).forEach((field) => {
    const fieldLabel = clean(field?.label || field?.id || 'Template field');
    const fieldMetadata = {
      fieldId: clean(field?.id),
      fieldType: clean(field?.type),
      priority: 30
    };
    if (field.prefillKey) {
      addOption(field.prefillKey, {
        ...fieldMetadata,
        label: fieldLabel,
        description: `Predefined value used by the template field ${fieldLabel}.`,
        origin: 'template_prefill',
        group: 'Template fields'
      });
    }
    if (field.docxAlias) {
      addOption(field.docxAlias, {
        ...fieldMetadata,
        label: `${fieldLabel} (DOCX shortcut)`,
        description: `DOCX shortcut exported for the template field ${fieldLabel}.`,
        origin: 'docx_alias',
        group: 'Template fields'
      });
    }
    const mappedToken = normalizeTokenKey(prepared?.placeholderMap?.[field.id]);
    addOption(mappedToken || field.id, {
      ...fieldMetadata,
      label: fieldLabel,
      description: `Saved or calculated value from the template field ${fieldLabel}.`,
      origin: 'template_field',
      group: 'Template fields',
      priority: 40
    });
  });

  Object.values(prepared?.placeholderMap || {}).forEach((token) => {
    const key = normalizeTokenKey(token);
    addOption(key, {
      label: key,
      description: 'DOCX placeholder value exported by the selected report template.',
      origin: 'placeholder',
      group: 'Template placeholders',
      priority: 20
    });
  });

  return attachDocxAliasesToKeyOptions(template, [...options.values()]
    .map(({ priority, ...option }) => option)
    .sort((left, right) => (
      String(left.group || '').localeCompare(String(right.group || ''))
      || String(left.label || '').localeCompare(String(right.label || ''))
      || String(left.key || '').localeCompare(String(right.key || ''))
    )));
}

function getSourceTemplateKeyCatalog(template = {}) {
  return getSourceTemplateKeyOptions(template)
    .map((option) => option.key)
    .sort((left, right) => left.localeCompare(right));
}

function isOptionalSlot(slot = {}) {
  return String(slot?.requirement || 'necessary').trim().toLowerCase() === 'optional';
}

function buildEmptySourceSlotValues(sourceTemplate = {}) {
  const keys = getSourceTemplateKeyCatalog(sourceTemplate);
  const placeholders = {};
  keys.forEach((key) => {
    placeholders[key] = '';
  });
  return buildSourceValuesFromPlaceholders(sourceTemplate, placeholders);
}

async function resolveSourceSlotSelection({
  slot,
  requested,
  templateOrgId,
  studentId = '',
  allowedStatuses,
  sourceTemplateMap,
  reqUser,
  requireStudentMatch = false
}) {
  const instanceId = clean(requested?.instanceId || '');
  const sourceTemplate = sourceTemplateMap?.get(slot.slotKey);
  if (!instanceId) {
    if (!isOptionalSlot(slot)) {
      const studentLabel = requireStudentMatch && studentId ? ` for student ${studentId}` : '';
      throw new Error(`Select a report for source slot ${slot.slotKey}${studentLabel}.`);
    }
    if (!sourceTemplate) {
      throw new Error(`Source template for optional slot ${slot.slotKey} was not found in the active organization.`);
    }
    return {
      sourceValuesEntry: buildEmptySourceSlotValues(sourceTemplate),
      normalizedSelection: {
        slotKey: slot.slotKey,
        templateId: slot.templateId,
        templateTitle: clean(sourceTemplate?.title || sourceTemplate?.name || slot.templateId),
        templateVersion: Number(slot.templateVersionAtSelection || sourceTemplate?.version || 1),
        instanceId: '',
        instanceTitle: '',
        instanceStatus: '',
        skipped: true,
        capturedAt: new Date().toISOString()
      }
    };
  }

  const sourceInstance = await schoolDataService.getDataById('reportInstances', instanceId, reqUser);
  if (!sourceInstance || !idsEqual(sourceInstance.orgId, templateOrgId)) {
    throw new Error(`Source report for slot ${slot.slotKey} was not found in the active organization.`);
  }
  if (!idsEqual(sourceInstance.templateId, slot.templateId)) {
    throw new Error(`Source report ${sourceInstance.id} does not match template slot ${slot.slotKey}.`);
  }
  const instanceStudentId = clean(sourceInstance.studentId || sourceInstance.personId);
  if (requireStudentMatch && instanceStudentId && studentId && instanceStudentId !== studentId) {
    throw new Error(`Source report ${sourceInstance.id} does not belong to student ${studentId}.`);
  }
  const sourceStatus = String(sourceInstance.status || '').toLowerCase();
  if (!allowedStatuses.has(sourceStatus)) {
    throw new Error(`Source report ${sourceInstance.id} has status "${sourceStatus}" which is not allowed for this workspace.`);
  }
  const payload = await buildSourcePayload(sourceInstance, reqUser);
  return {
    sourceValuesEntry: payload.values,
    normalizedSelection: {
      slotKey: slot.slotKey,
      templateId: sourceInstance.templateId,
      templateTitle: clean(payload.template?.title || payload.template?.name || sourceInstance.templateId),
      templateVersion: Number(sourceInstance.templateVersion || 1),
      instanceId: sourceInstance.id,
      instanceTitle: clean(sourceInstance.title || sourceInstance.name || sourceInstance.id),
      instanceStatus: sourceStatus,
      skipped: false,
      capturedAt: new Date().toISOString()
    }
  };
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

function buildSourceValuesFromPlaceholders(template = {}, placeholders = {}) {
  const values = {};
  Object.entries(placeholders || {}).forEach(([token, value]) => {
    const key = normalizeTokenKey(token);
    if (key) values[key] = value;
  });
  return mirrorDocxAliasValues(template, values);
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
  const values = buildSourceValuesFromPlaceholders(template, bundle.placeholders);
  return { template, assignment, values, diagnostics: bundle.conversionDiagnostics || [] };
}

async function createOverallInstance({
  template,
  sourceSelections,
  selectedDocxKey = 'default',
  selectedPdfKey = 'default',
  title = '',
  reqUser,
  allowMissingDocx = false,
  allowMissingPdf = true
}) {
  if (String(template?.status || '').toLowerCase() !== 'active') {
    throw new Error('Only active overall report templates can create reports.');
  }
  const sourceTemplateMap = await validateTemplateReferences(template, reqUser);
  const selectionsBySlot = new Map(
    (Array.isArray(sourceSelections) ? sourceSelections : []).map((row) => [clean(row?.slotKey).toUpperCase(), row])
  );
  const sourceValues = {};
  const normalizedSelections = [];
  for (const slot of template.sourceSlots || []) {
    const requested = selectionsBySlot.get(slot.slotKey) || {};
    // eslint-disable-next-line no-await-in-loop
    const resolved = await resolveSourceSlotSelection({
      slot,
      requested,
      templateOrgId: template.orgId,
      allowedStatuses: COMPLETED_SOURCE_STATUSES,
      sourceTemplateMap,
      reqUser,
      requireStudentMatch: false
    });
    sourceValues[slot.slotKey] = resolved.sourceValuesEntry;
    normalizedSelections.push(resolved.normalizedSelection);
  }
  const requestedDocxKey = clean(selectedDocxKey || 'default') || 'default';
  const availableDocx = reportFunderDocxService.buildAvailableDocxOptions(template);
  const selectedOption = availableDocx.find((row) => (
    idsEqual(row.key, requestedDocxKey)
    || String(row.key || '').toLowerCase() === requestedDocxKey.toLowerCase()
  ));
  let resolvedDocx;
  if (!selectedOption) {
    if (!allowMissingDocx) {
      throw new Error('The selected overall report Word template is unavailable.');
    }
    resolvedDocx = {
      docxKey: requestedDocxKey,
      label: requestedDocxKey,
      docxTemplate: null
    };
  } else {
    resolvedDocx = reportFunderDocxService.resolveDocxTemplateForFunder({
      template,
      funderKey: selectedOption.key
    });
    if (!resolvedDocx.docxTemplate && !allowMissingDocx) {
      throw new Error('Select an available Word template before creating the overall report.');
    }
  }
  const resolvedPdf = resolveSelectedPdfKey(template, selectedPdfKey, { allowMissingPdf });
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
    selectedPdfKey: resolvedPdf.pdfKey,
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
    if (!isOverallFieldEditable(field)) return;
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
    if (!isOverallFieldEditable(field)) return;
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
  const slotTemplates = {};
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
      slotTemplates[selection.slotKey] = sourcePayload.template;
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
      const normalizedKey = normalizeTokenKey(key);
      const { aliasKeys } = buildDocxAliasLookup(slotTemplates[slotKey] || {});
      if (aliasKeys.has(normalizedKey)) return;
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
    const workspace = ensureWorkspaceShape(instance);
    const entries = workspace.studentEntries.length
      ? workspace.studentEntries
      : [{ answers: instance.answers || {}, sourceValues: instance.sourceValues || {}, derivedOverrides: instance.derivedOverrides || {} }];
    entries.forEach((entry) => {
      const validation = validateAnswers(instance.templateSnapshot || {}, entry.answers || {});
      if (hasBlockingValidationErrors(validation)) {
        const error = new Error(`Resolve all validation errors before submitting${entry.studentId ? ` (${entry.studentName || entry.studentId})` : ''}.`);
        error.validation = validation;
        throw error;
      }
      const calculation = findCalculationMismatches({
        ...instance,
        answers: entry.answers || {},
        sourceValues: entry.sourceValues || {},
        derivedOverrides: entry.derivedOverrides || {}
      });
      if (calculation.diagnostics.length || calculation.mismatches.length) {
        throw new Error('Save the overall report to resolve calculation changes before submitting it.');
      }
    });
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
    listDocxPlaceholderAliases(field).forEach((alias) => {
      placeholders[`O.${alias}`] = value;
    });
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

async function buildPdfExportPreview(instance) {
  const template = instance.templateSnapshot || {};
  const availablePdf = reportFunderPdfService.buildAvailablePdfOptions(template);
  const selectedPdf = availablePdf.find((row) => (
    idsEqual(row.key, instance.selectedPdfKey)
    || String(row.key || '').toLowerCase() === String(instance.selectedPdfKey || '').toLowerCase()
  ));
  if (!selectedPdf) throw new Error('The selected overall report PDF template is unavailable.');
  const resolved = reportFunderPdfService.resolvePdfTemplateForFunder({
    template,
    funderKey: selectedPdf.key
  });
  if (!resolved.pdfTemplate) throw new Error('The selected overall report PDF template is unavailable.');
  const payload = buildDocxPayloadDetailed(instance);
  const validation = validateAnswers(template, instance.answers || {});
  const calculation = findCalculationMismatches(instance);
  return {
    pdfKey: resolved.pdfKey,
    pdfLabel: resolved.label,
    fileName: resolved.pdfTemplate.originalName || resolved.pdfTemplate.fileName || '',
    placeholders: payload.placeholders,
    validation,
    conversionDiagnostics: payload.conversionDiagnostics,
    calculationDiagnostics: calculation.diagnostics,
    calculationMismatches: calculation.mismatches,
    ready: !hasBlockingValidationErrors(validation)
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
  const workspace = ensureWorkspaceShape(instance);
  if (workspace.studentEntries.length > 1) {
    return exportWorkspaceZip({ instance: workspace, docxKey: instance.selectedDocxKey, reqUser });
  }
  const entryInstance = workspace.studentEntries.length === 1
    ? buildVirtualEntryInstance(workspace, workspace.studentEntries[0])
    : instance;
  const preview = await buildExportPreview(entryInstance);
  if (preview.missingTokens.length) {
    throw new Error(formatMissingDocxTokenError(entryInstance.templateSnapshot, preview.missingTokens, preview.placeholders));
  }
  if (!preview.ready) {
    throw new Error('DOCX export cancelled because the overall report has validation or calculation errors.');
  }
  const rendered = await reportDocxRenderService.renderReportInstanceDocx({
    template: entryInstance.templateSnapshot,
    instance: entryInstance,
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
    studentId: workspace.studentEntries[0]?.studentId || '',
    generatedAt: new Date().toISOString(),
    generatedBy: reqUser?.id || '',
    revision: Number(instance.revision || 1)
  };
  let nextStudentEntries = workspace.studentEntries;
  if (nextStudentEntries.length === 1) {
    nextStudentEntries = [{
      ...nextStudentEntries[0],
      generatedDocs: [...(nextStudentEntries[0].generatedDocs || []), generatedDoc]
    }];
  }
  const updated = await schoolDataService.updateData('overallReportInstances', instance.id, {
    studentEntries: nextStudentEntries,
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

function ensureWorkspaceShape(instance = {}) {
  const studentEntries = overallReportInstanceModel.wrapLegacyAsStudentEntries(instance);
  return {
    ...instance,
    studentEntries,
    filtersSnapshot: overallReportInstanceModel.sanitizeFiltersSnapshot(instance.filtersSnapshot || {})
  };
}

function templateHasOverallFields(template = {}) {
  return getDataFields(template).length > 0;
}

function resolveAllowedSourceStatuses(statuses) {
  const requested = (Array.isArray(statuses) ? statuses : [])
    .map((status) => clean(status).toLowerCase())
    .filter((status) => overallReportInstanceModel.LOAD_STATUSES.includes(status));
  return new Set(requested.length ? requested : ['submitted', 'locked']);
}

function sessionDateInRange(sessionDate, startDate, endDate) {
  const value = clean(sessionDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const start = clean(startDate);
  const end = clean(endDate);
  if (start && value < start) return false;
  if (end && value > end) return false;
  return true;
}

function summarizeSourceInstance(row = {}) {
  return {
    id: row.id,
    title: row.title || row.name || row.id,
    status: row.status,
    templateId: row.templateId,
    studentId: row.studentId || row.personId || '',
    studentName: row.prefillSnapshot?.student_full_name
      || row.prefillSnapshot?.student_name
      || row.studentName
      || '',
    className: row.prefillSnapshot?.class_name || row.className || '',
    teacherName: row.prefillSnapshot?.teacher_name || row.teacherName || '',
    sessionDate: row.sessionDate || '',
    reportDate: row.prefillSnapshot?.report_date || row.sessionDate || row.audit?.lastUpdateDateTime || ''
  };
}

async function loadOverallCreateCandidates({
  template,
  startDate = '',
  endDate = '',
  studentIds = [],
  statuses = ['submitted', 'locked'],
  reqUser
}) {
  if (!template?.id) throw new Error('Overall report template is required.');
  await validateTemplateReferences(template, reqUser);
  const allowedStatuses = resolveAllowedSourceStatuses(statuses);
  const studentFilter = new Set(
    (Array.isArray(studentIds) ? studentIds : [])
      .map((id) => clean(id))
      .filter(Boolean)
  );
  const [allInstances, reportTemplates] = await Promise.all([
    schoolDataService.fetchAllData('reportInstances', {}, reqUser),
    schoolDataService.fetchAllData('reportTemplates', {}, reqUser)
  ]);
  const orgId = toPublicId(reqUser?.activeOrgId || reqUser?.organizationId || reqUser?.orgId || template.orgId);
  const sourceTemplateMap = new Map(
    (Array.isArray(reportTemplates) ? reportTemplates : [])
      .filter((row) => idsEqual(row?.orgId, orgId))
      .map((row) => [String(row.id), row])
  );
  const slots = (template.sourceSlots || []).map((slot) => {
    const sourceTemplate = sourceTemplateMap.get(String(slot.templateId)) || {};
    return {
      slotKey: slot.slotKey,
      templateId: slot.templateId,
      templateTitle: clean(sourceTemplate.title || sourceTemplate.name || slot.templateId),
      templateType: clean(sourceTemplate.type || ''),
      templateVersion: Number(sourceTemplate.version || slot.templateVersionAtSelection || 1),
      requirement: String(slot.requirement || 'necessary').toLowerCase()
    };
  });
  const necessarySlots = slots.filter((slot) => slot.requirement !== 'optional');
  const matching = (Array.isArray(allInstances) ? allInstances : [])
    .filter((row) => idsEqual(row?.orgId, orgId))
    .filter((row) => allowedStatuses.has(String(row.status || '').toLowerCase()))
    .filter((row) => clean(row.studentId || row.personId))
    .filter((row) => sessionDateInRange(row.sessionDate, startDate, endDate))
    .filter((row) => !studentFilter.size || studentFilter.has(clean(row.studentId || row.personId)));

  const byStudent = new Map();
  matching.forEach((row) => {
    const studentId = clean(row.studentId || row.personId);
    if (!studentId) return;
    if (!byStudent.has(studentId)) {
      byStudent.set(studentId, {
        studentId,
        studentName: summarizeSourceInstance(row).studentName || studentId,
        slots: Object.fromEntries(slots.map((slot) => [slot.slotKey, []]))
      });
    }
    const entry = byStudent.get(studentId);
    slots.forEach((slot) => {
      if (!idsEqual(row.templateId, slot.templateId)) return;
      entry.slots[slot.slotKey].push(summarizeSourceInstance(row));
      if (!entry.studentName || entry.studentName === studentId) {
        entry.studentName = summarizeSourceInstance(row).studentName || studentId;
      }
    });
  });

  const students = [...byStudent.values()]
    .filter((row) => {
      const requiredSlots = necessarySlots.length ? necessarySlots : slots;
      return requiredSlots.every((slot) => (row.slots[slot.slotKey] || []).length > 0);
    })
    .sort((a, b) => String(a.studentName || a.studentId).localeCompare(String(b.studentName || b.studentId)));

  return {
    templateId: template.id,
    templateTitle: template.title,
    hasOverallFields: templateHasOverallFields(template),
    sourceSlots: slots,
    docxOptions: reportFunderDocxService.buildAvailableDocxOptions(template),
    pdfOptions: reportFunderPdfService.buildAvailablePdfOptions(template),
    filters: {
      startDate: clean(startDate),
      endDate: clean(endDate),
      studentIds: [...studentFilter],
      statuses: [...allowedStatuses]
    },
    students
  };
}

async function resolveStudentEntrySelections({
  template,
  entry,
  allowedStatuses,
  sourceTemplateMap,
  reqUser
}) {
  const selectionsBySlot = new Map(
    (Array.isArray(entry?.sourceSelections) ? entry.sourceSelections : [])
      .map((row) => [clean(row?.slotKey).toUpperCase(), row])
  );
  const sourceValues = {};
  const normalizedSelections = [];
  for (const slot of template.sourceSlots || []) {
    const requested = selectionsBySlot.get(slot.slotKey) || {};
    // eslint-disable-next-line no-await-in-loop
    const resolved = await resolveSourceSlotSelection({
      slot,
      requested,
      templateOrgId: template.orgId,
      studentId: clean(entry?.studentId),
      allowedStatuses,
      sourceTemplateMap,
      reqUser,
      requireStudentMatch: true
    });
    sourceValues[slot.slotKey] = resolved.sourceValuesEntry;
    normalizedSelections.push(resolved.normalizedSelection);
  }
  const calculated = calculateAnswers({
    template,
    sourceValues,
    currentAnswers: entry?.answers || {},
    derivedOverrides: entry?.derivedOverrides || {},
    initialize: true
  });
  if (calculated.diagnostics.length) {
    throw new Error(`Unable to calculate overall report fields for ${entry?.studentId || 'student'}: ${
      calculated.diagnostics.map((row) => row.message).join(' | ')
    }`);
  }
  return {
    studentId: clean(entry.studentId),
    studentName: clean(entry.studentName) || clean(entry.studentId),
    sourceSelections: normalizedSelections,
    sourceValues,
    answers: calculated.answers,
    derivedOverrides: calculated.derivedOverrides,
    generatedDocs: Array.isArray(entry?.generatedDocs) ? entry.generatedDocs : [],
    included: entry?.included !== false
  };
}

function resolveSelectedDocxKey(template, selectedDocxKey = 'default', { allowMissingDocx = false } = {}) {
  const requestedDocxKey = clean(selectedDocxKey || 'default') || 'default';
  const availableDocx = reportFunderDocxService.buildAvailableDocxOptions(template);
  const selectedOption = availableDocx.find((row) => (
    idsEqual(row.key, requestedDocxKey)
    || String(row.key || '').toLowerCase() === requestedDocxKey.toLowerCase()
  ));
  if (!selectedOption) {
    if (!allowMissingDocx) {
      throw new Error('The selected overall report Word template is unavailable.');
    }
    return {
      docxKey: requestedDocxKey,
      label: requestedDocxKey,
      docxTemplate: null
    };
  }
  const resolvedDocx = reportFunderDocxService.resolveDocxTemplateForFunder({
    template,
    funderKey: selectedOption.key
  });
  if (!resolvedDocx.docxTemplate && !allowMissingDocx) {
    throw new Error('Select an available Word template before creating the overall report.');
  }
  return resolvedDocx;
}

function resolveSelectedPdfKey(template, selectedPdfKey = 'default', { allowMissingPdf = true } = {}) {
  const requestedPdfKey = clean(selectedPdfKey || 'default') || 'default';
  const availablePdf = reportFunderPdfService.buildAvailablePdfOptions(template);
  const selectedOption = availablePdf.find((row) => (
    idsEqual(row.key, requestedPdfKey)
    || String(row.key || '').toLowerCase() === requestedPdfKey.toLowerCase()
  ));
  if (!selectedOption) {
    if (!allowMissingPdf) {
      throw new Error('The selected overall report PDF template is unavailable.');
    }
    return {
      pdfKey: requestedPdfKey,
      label: requestedPdfKey,
      pdfTemplate: null
    };
  }
  const resolvedPdf = reportFunderPdfService.resolvePdfTemplateForFunder({
    template,
    funderKey: selectedOption.key
  });
  if (!resolvedPdf.pdfTemplate && !allowMissingPdf) {
    throw new Error('Select an available PDF template before creating the overall report.');
  }
  return resolvedPdf;
}

function templateHasAttachedDocx(template = {}, docxKey = 'default') {
  const availableDocx = reportFunderDocxService.buildAvailableDocxOptions(template);
  const selectedOption = availableDocx.find((row) => (
    idsEqual(row.key, docxKey)
    || String(row.key || '').toLowerCase() === String(docxKey || 'default').toLowerCase()
  )) || availableDocx[0];
  if (!selectedOption) return false;
  const resolved = reportFunderDocxService.resolveDocxTemplateForFunder({
    template,
    funderKey: selectedOption.key
  });
  return Boolean(resolved?.docxTemplate);
}

function templateHasAttachedPdf(template = {}, pdfKey = 'default') {
  const availablePdf = reportFunderPdfService.buildAvailablePdfOptions(template);
  const selectedOption = availablePdf.find((row) => (
    idsEqual(row.key, pdfKey)
    || String(row.key || '').toLowerCase() === String(pdfKey || 'default').toLowerCase()
  )) || availablePdf[0];
  if (!selectedOption) return false;
  const resolved = reportFunderPdfService.resolvePdfTemplateForFunder({
    template,
    funderKey: selectedOption.key
  });
  return Boolean(resolved?.pdfTemplate);
}

async function buildNormalizedStudentEntries({
  template,
  studentEntries,
  allowedStatuses,
  reqUser
}) {
  const sourceTemplateMap = await validateTemplateReferences(template, reqUser);
  const normalized = [];
  for (const entry of (Array.isArray(studentEntries) ? studentEntries : [])) {
    if (entry?.included === false) continue;
    // eslint-disable-next-line no-await-in-loop
    normalized.push(await resolveStudentEntrySelections({
      template,
      entry,
      allowedStatuses,
      sourceTemplateMap,
      reqUser
    }));
  }
  if (!normalized.length) throw new Error('Select at least one student with complete necessary source reports.');
  return normalized;
}

async function createOverallWorkspace({
  template,
  filters = {},
  selectedDocxKey = 'default',
  selectedPdfKey = 'default',
  title = '',
  studentEntries = [],
  reqUser,
  allowMissingDocx = false
}) {
  if (String(template?.status || '').toLowerCase() !== 'active') {
    throw new Error('Only active overall report templates can create reports.');
  }
  await validateTemplateReferences(template, reqUser);
  const filtersSnapshot = overallReportInstanceModel.sanitizeFiltersSnapshot(filters);
  const allowedStatuses = resolveAllowedSourceStatuses(filtersSnapshot.statuses);
  const normalizedEntries = await buildNormalizedStudentEntries({
    template,
    studentEntries,
    allowedStatuses,
    reqUser
  });
  const resolvedDocx = resolveSelectedDocxKey(template, selectedDocxKey, { allowMissingDocx });
  const resolvedPdf = resolveSelectedPdfKey(template, selectedPdfKey, { allowMissingPdf: true });
  const now = new Date().toISOString();
  const record = overallReportInstanceModel.sanitizeInstance({
    orgId: template.orgId,
    overallTemplateId: template.id,
    overallTemplateVersion: template.version,
    title: clean(title) || `${template.title} - ${now.slice(0, 10)}`,
    status: 'draft',
    selectedDocxKey: resolvedDocx.docxKey,
    selectedPdfKey: resolvedPdf.pdfKey,
    templateSnapshot: clone(template, {}),
    filtersSnapshot,
    studentEntries: normalizedEntries,
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

async function saveOverallWorkspace({
  instance,
  studentEntries = [],
  title = '',
  selectedDocxKey = '',
  selectedPdfKey = '',
  filters = null,
  reqUser
}) {
  if (String(instance.status || '') !== 'draft') {
    throw new Error('Only draft overall reports can be edited.');
  }
  const template = instance.templateSnapshot || {};
  const filtersSnapshot = overallReportInstanceModel.sanitizeFiltersSnapshot(
    filters != null ? filters : instance.filtersSnapshot || {}
  );
  const allowedStatuses = resolveAllowedSourceStatuses(filtersSnapshot.statuses);
  const normalizedEntries = await buildNormalizedStudentEntries({
    template,
    studentEntries,
    allowedStatuses,
    reqUser
  });
  const resolvedDocx = resolveSelectedDocxKey(template, selectedDocxKey || instance.selectedDocxKey);
  const resolvedPdf = resolveSelectedPdfKey(template, selectedPdfKey || instance.selectedPdfKey);
  const now = new Date().toISOString();
  return schoolDataService.updateData('overallReportInstances', instance.id, {
    title: clean(title) || instance.title,
    selectedDocxKey: resolvedDocx.docxKey,
    selectedPdfKey: resolvedPdf.pdfKey,
    filtersSnapshot,
    studentEntries: normalizedEntries,
    revision: nextRevision(instance),
    audit: {
      ...(instance.audit || {}),
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: now
    }
  }, reqUser);
}

function buildVirtualEntryInstance(instance, entry) {
  return {
    ...instance,
    sourceSelections: entry.sourceSelections || [],
    sourceValues: entry.sourceValues || {},
    answers: entry.answers || {},
    derivedOverrides: entry.derivedOverrides || {},
    generatedDocs: entry.generatedDocs || []
  };
}

function findStudentEntry(instance, studentId) {
  const workspace = ensureWorkspaceShape(instance);
  const entry = workspace.studentEntries.find((row) => idsEqual(row.studentId, studentId));
  if (!entry) throw new Error('Student entry not found on this overall report.');
  return { workspace, entry };
}

function isOverallFieldEditable(field = {}) {
  if (field.readOnly === true || String(field.readOnly).toLowerCase() === 'true') return false;
  return String(field.overallValueMode || 'manual') !== 'derived_locked';
}

function previewStudentEntry({ instance, studentId }) {
  const { workspace, entry } = findStudentEntry(instance, studentId);
  const template = workspace.templateSnapshot || {};
  const fields = getDataFields(template).map((field) => {
    const mode = String(field.overallValueMode || 'manual');
    return {
      id: field.id,
      label: field.label || field.id,
      type: field.type || 'text',
      helpText: field.helpText || '',
      required: field.required === true,
      overallValueMode: mode,
      readOnly: !isOverallFieldEditable(field),
      editable: isOverallFieldEditable(field),
      value: entry.answers?.[field.id],
      overridden: Boolean(entry.derivedOverrides?.[field.id])
    };
  });
  const validation = validateAnswers(template, entry.answers || {});
  return {
    studentId: entry.studentId,
    studentName: entry.studentName,
    sourceSelections: entry.sourceSelections,
    fields,
    answers: entry.answers || {},
    derivedOverrides: entry.derivedOverrides || {},
    validation,
    hasOverallFields: fields.length > 0
  };
}

async function saveStudentAnswers({ instance, studentId, submittedAnswers = {}, reqUser }) {
  if (String(instance.status || '') !== 'draft') {
    throw new Error('Only draft overall reports can be edited.');
  }
  const { workspace, entry } = findStudentEntry(instance, studentId);
  const template = workspace.templateSnapshot || {};
  const fields = getDataFields(template);
  const nextAnswers = { ...(entry.answers || {}) };
  const overrides = { ...(entry.derivedOverrides || {}) };
  fields.forEach((field) => {
    if (!isOverallFieldEditable(field)) return;
    if (!Object.prototype.hasOwnProperty.call(submittedAnswers, field.id)) return;
    nextAnswers[field.id] = submittedAnswers[field.id];
  });
  const baseline = calculateAnswers({
    template,
    sourceValues: entry.sourceValues || {},
    currentAnswers: nextAnswers,
    derivedOverrides: {},
    initialize: false
  });
  fields.forEach((field) => {
    if (String(field.overallValueMode) !== 'derived_editable') return;
    if (!isOverallFieldEditable(field)) return;
    if (!Object.prototype.hasOwnProperty.call(submittedAnswers, field.id)) return;
    overrides[field.id] = !valuesEqual(submittedAnswers[field.id], baseline.answers[field.id]);
  });
  const finalCalculation = calculateAnswers({
    template,
    sourceValues: entry.sourceValues || {},
    currentAnswers: nextAnswers,
    derivedOverrides: overrides,
    initialize: false
  });
  const validation = validateAnswers(template, finalCalculation.answers);
  const nextEntries = workspace.studentEntries.map((row) => (
    idsEqual(row.studentId, studentId)
      ? {
        ...row,
        answers: finalCalculation.answers,
        derivedOverrides: finalCalculation.derivedOverrides
      }
      : row
  ));
  const updated = await schoolDataService.updateData('overallReportInstances', instance.id, {
    studentEntries: nextEntries,
    revision: nextRevision(instance),
    audit: {
      ...(instance.audit || {}),
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: new Date().toISOString()
    }
  }, reqUser);
  return {
    instance: updated,
    validation,
    diagnostics: finalCalculation.diagnostics,
    preview: previewStudentEntry({ instance: updated, studentId })
  };
}

async function renderEntryDocx(instance, entry, docxKey, reqUser) {
  const virtual = buildVirtualEntryInstance(instance, entry);
  if (docxKey) virtual.selectedDocxKey = docxKey;
  const preview = await buildExportPreview(virtual);
  if (preview.missingTokens.length) {
    throw new Error(formatMissingDocxTokenError(virtual.templateSnapshot, preview.missingTokens, preview.placeholders));
  }
  if (hasBlockingValidationErrors(preview.validation) || preview.calculationMismatches.length || preview.calculationDiagnostics.length) {
    throw new Error(`DOCX export cancelled for ${entry.studentName || entry.studentId} because of validation or calculation errors.`);
  }
  const rendered = await reportDocxRenderService.renderReportInstanceDocx({
    template: virtual.templateSnapshot,
    instance: virtual,
    placeholders: preview.placeholders,
    collections: {},
    docxTemplateOverride: preview.resolved.docxTemplate
  });
  const safeStudent = clean(entry.studentName || entry.studentId || 'student').replace(/[^\w.-]+/g, '_');
  const fileName = rendered.fileName?.includes(safeStudent)
    ? rendered.fileName
    : `${safeStudent}_${rendered.fileName || 'overall.docx'}`;
  const saved = await fileAssetStorage.saveBuffer({
    scopeKey: instance.orgId,
    relativeDir: 'school-reports/overall/generated',
    fileName,
    originalName: fileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: rendered.buffer
  });
  const generatedDoc = {
    fileName: saved.fileName || fileName,
    path: saved.path || saved.url || '',
    url: saved.url || '',
    docxKey: preview.docxKey,
    studentId: entry.studentId,
    generatedAt: new Date().toISOString(),
    generatedBy: reqUser?.id || '',
    revision: Number(instance.revision || 1)
  };
  return { rendered: { ...rendered, fileName, buffer: rendered.buffer }, saved, generatedDoc, preview };
}

async function generateStudentDocx({ instance, studentId, docxKey = '', reqUser }) {
  const { workspace, entry } = findStudentEntry(instance, studentId);
  const result = await renderEntryDocx(
    workspace,
    entry,
    docxKey || workspace.selectedDocxKey,
    reqUser
  );
  const nextEntries = workspace.studentEntries.map((row) => (
    idsEqual(row.studentId, studentId)
      ? { ...row, generatedDocs: [...(row.generatedDocs || []), result.generatedDoc] }
      : row
  ));
  const updated = await schoolDataService.updateData('overallReportInstances', instance.id, {
    studentEntries: nextEntries,
    generatedDocs: [...(instance.generatedDocs || []), result.generatedDoc],
    revision: nextRevision(instance),
    audit: {
      ...(instance.audit || {}),
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: new Date().toISOString()
    }
  }, reqUser);
  return { ...result, instance: updated };
}

async function exportWorkspaceZip({ instance, docxKey = '', reqUser }) {
  const workspace = ensureWorkspaceShape(instance);
  if (!workspace.studentEntries.length) throw new Error('This overall report has no students to export.');
  const key = clean(docxKey) || workspace.selectedDocxKey;
  const files = [];
  const generatedDocs = [];
  let nextEntries = [...workspace.studentEntries];
  for (const entry of workspace.studentEntries) {
    // eslint-disable-next-line no-await-in-loop
    const result = await renderEntryDocx(workspace, entry, key, reqUser);
    files.push({ fileName: result.rendered.fileName, buffer: result.rendered.buffer });
    generatedDocs.push(result.generatedDoc);
    nextEntries = nextEntries.map((row) => (
      idsEqual(row.studentId, entry.studentId)
        ? { ...row, generatedDocs: [...(row.generatedDocs || []), result.generatedDoc] }
        : row
    ));
  }
  const zipBuffer = await reportDocxRenderService.zipReportInstanceDocxFiles(files);
  const zipName = `${clean(workspace.title || 'overall-report').replace(/[^\w.-]+/g, '_') || 'overall-report'}.zip`;
  const saved = await fileAssetStorage.saveBuffer({
    scopeKey: instance.orgId,
    relativeDir: 'school-reports/overall/generated',
    fileName: zipName,
    originalName: zipName,
    mimeType: 'application/zip',
    buffer: zipBuffer
  });
  const packageDoc = {
    fileName: saved.fileName || zipName,
    path: saved.path || saved.url || '',
    url: saved.url || '',
    docxKey: key,
    generatedAt: new Date().toISOString(),
    generatedBy: reqUser?.id || '',
    revision: Number(instance.revision || 1)
  };
  const updated = await schoolDataService.updateData('overallReportInstances', instance.id, {
    studentEntries: nextEntries,
    generatedDocs: [...(instance.generatedDocs || []), ...generatedDocs, packageDoc],
    revision: nextRevision(instance),
    audit: {
      ...(instance.audit || {}),
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: new Date().toISOString()
    }
  }, reqUser);
  return {
    zipBuffer,
    fileName: zipName,
    generatedDocs,
    packageDoc,
    instance: updated
  };
}

async function exportWorkspaceDocx({ instance, docxKey = '', studentId = '', reqUser }) {
  if (studentId) {
    return generateStudentDocx({ instance, studentId, docxKey, reqUser });
  }
  return exportWorkspaceZip({ instance, docxKey, reqUser });
}

async function renderEntryPdf(instance, entry, pdfKey, reqUser) {
  const virtual = buildVirtualEntryInstance(instance, entry);
  if (pdfKey) virtual.selectedPdfKey = pdfKey;
  const preview = await buildPdfExportPreview(virtual);
  if (hasBlockingValidationErrors(preview.validation) || preview.calculationMismatches.length || preview.calculationDiagnostics.length) {
    throw new Error(`PDF export cancelled for ${entry.studentName || entry.studentId} because of validation or calculation errors.`);
  }
  const rendered = await reportPdfRenderService.renderReportInstancePdf({
    template: virtual.templateSnapshot,
    instance: virtual,
    placeholders: preview.placeholders,
    mergedAnswers: virtual.answers,
    pdfTemplateOverride: preview.resolved.pdfTemplate
  });
  const safeStudent = clean(entry.studentName || entry.studentId || 'student').replace(/[^\w.-]+/g, '_');
  const fileName = rendered.fileName?.includes(safeStudent)
    ? rendered.fileName
    : `${safeStudent}_${rendered.fileName || 'overall.pdf'}`;
  const saved = await fileAssetStorage.saveBuffer({
    scopeKey: instance.orgId,
    relativeDir: 'school-reports/overall/generated',
    fileName,
    originalName: fileName,
    mimeType: 'application/pdf',
    buffer: rendered.buffer
  });
  const generatedDoc = {
    fileName: saved.fileName || fileName,
    path: saved.path || saved.url || '',
    url: saved.url || '',
    pdfKey: preview.pdfKey,
    studentId: entry.studentId,
    generatedAt: new Date().toISOString(),
    generatedBy: reqUser?.id || '',
    revision: Number(instance.revision || 1)
  };
  return { rendered: { ...rendered, fileName, buffer: rendered.buffer }, saved, generatedDoc, preview };
}

async function generateStudentPdf({ instance, studentId, pdfKey = '', reqUser }) {
  const { workspace, entry } = findStudentEntry(instance, studentId);
  const result = await renderEntryPdf(
    workspace,
    entry,
    pdfKey || workspace.selectedPdfKey,
    reqUser
  );
  const nextEntries = workspace.studentEntries.map((row) => (
    idsEqual(row.studentId, studentId)
      ? { ...row, generatedDocs: [...(row.generatedDocs || []), result.generatedDoc] }
      : row
  ));
  const updated = await schoolDataService.updateData('overallReportInstances', instance.id, {
    studentEntries: nextEntries,
    generatedDocs: [...(instance.generatedDocs || []), result.generatedDoc],
    revision: nextRevision(instance),
    audit: {
      ...(instance.audit || {}),
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: new Date().toISOString()
    }
  }, reqUser);
  return { ...result, instance: updated };
}

async function exportWorkspacePdfZip({ instance, pdfKey = '', reqUser }) {
  const workspace = ensureWorkspaceShape(instance);
  if (!workspace.studentEntries.length) throw new Error('This overall report has no students to export.');
  const key = clean(pdfKey) || workspace.selectedPdfKey;
  const files = [];
  const generatedDocs = [];
  let nextEntries = [...workspace.studentEntries];
  for (const entry of workspace.studentEntries) {
    // eslint-disable-next-line no-await-in-loop
    const result = await renderEntryPdf(workspace, entry, key, reqUser);
    files.push({ fileName: result.rendered.fileName, buffer: result.rendered.buffer });
    generatedDocs.push(result.generatedDoc);
    nextEntries = nextEntries.map((row) => (
      idsEqual(row.studentId, entry.studentId)
        ? { ...row, generatedDocs: [...(row.generatedDocs || []), result.generatedDoc] }
        : row
    ));
  }
  const zipBuffer = await reportPdfRenderService.zipReportInstancePdfFiles(files);
  const zipName = `${clean(workspace.title || 'overall-report').replace(/[^\w.-]+/g, '_') || 'overall-report'}_pdf.zip`;
  const saved = await fileAssetStorage.saveBuffer({
    scopeKey: instance.orgId,
    relativeDir: 'school-reports/overall/generated',
    fileName: zipName,
    originalName: zipName,
    mimeType: 'application/zip',
    buffer: zipBuffer
  });
  const packageDoc = {
    fileName: saved.fileName || zipName,
    path: saved.path || saved.url || '',
    url: saved.url || '',
    pdfKey: key,
    generatedAt: new Date().toISOString(),
    generatedBy: reqUser?.id || '',
    revision: Number(instance.revision || 1)
  };
  const updated = await schoolDataService.updateData('overallReportInstances', instance.id, {
    studentEntries: nextEntries,
    generatedDocs: [...(instance.generatedDocs || []), ...generatedDocs, packageDoc],
    revision: nextRevision(instance),
    audit: {
      ...(instance.audit || {}),
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: new Date().toISOString()
    }
  }, reqUser);
  return {
    zipBuffer,
    fileName: zipName,
    generatedDocs,
    packageDoc,
    instance: updated
  };
}

async function exportWorkspacePdf({ instance, pdfKey = '', studentId = '', reqUser }) {
  if (studentId) {
    return generateStudentPdf({ instance, studentId, pdfKey, reqUser });
  }
  return exportWorkspacePdfZip({ instance, pdfKey, reqUser });
}

async function exportOverallReportPdf(instance, reqUser) {
  if (!COMPLETED_SOURCE_STATUSES.has(String(instance.status || '').toLowerCase())) {
    throw new Error('Submit or lock the overall report before exporting the final PDF.');
  }
  const workspace = ensureWorkspaceShape(instance);
  if (workspace.studentEntries.length > 1) {
    return exportWorkspacePdfZip({ instance: workspace, pdfKey: instance.selectedPdfKey, reqUser });
  }
  const entryInstance = workspace.studentEntries.length === 1
    ? buildVirtualEntryInstance(workspace, workspace.studentEntries[0])
    : instance;
  const preview = await buildPdfExportPreview(entryInstance);
  if (!preview.ready) {
    throw new Error('PDF export cancelled because the overall report has validation or calculation errors.');
  }
  const rendered = await reportPdfRenderService.renderReportInstancePdf({
    template: entryInstance.templateSnapshot,
    instance: entryInstance,
    placeholders: preview.placeholders,
    mergedAnswers: entryInstance.answers,
    pdfTemplateOverride: preview.resolved.pdfTemplate
  });
  const saved = await fileAssetStorage.saveBuffer({
    scopeKey: instance.orgId,
    relativeDir: 'school-reports/overall/generated',
    fileName: rendered.fileName,
    originalName: rendered.fileName,
    mimeType: 'application/pdf',
    buffer: rendered.buffer
  });
  const generatedDoc = {
    fileName: saved.fileName || rendered.fileName,
    path: saved.path || saved.url || '',
    url: saved.url || '',
    pdfKey: preview.pdfKey,
    studentId: workspace.studentEntries[0]?.studentId || '',
    generatedAt: new Date().toISOString(),
    generatedBy: reqUser?.id || '',
    revision: Number(instance.revision || 1)
  };
  let nextStudentEntries = workspace.studentEntries;
  if (nextStudentEntries.length === 1) {
    nextStudentEntries = [{
      ...nextStudentEntries[0],
      generatedDocs: [...(nextStudentEntries[0].generatedDocs || []), generatedDoc]
    }];
  }
  const updated = await schoolDataService.updateData('overallReportInstances', instance.id, {
    studentEntries: nextStudentEntries,
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

function buildOverallExportPayload(instance = {}) {
  const template = instance.templateSnapshot || {};
  const workspace = ensureWorkspaceShape(instance);
  const entry = workspace.studentEntries[0] || null;
  const validation = validateAnswers(template, entry?.answers || instance.answers || {});
  return {
    id: instance.id,
    title: instance.title,
    status: instance.status,
    overallTemplateId: instance.overallTemplateId,
    overallTemplateVersion: instance.overallTemplateVersion,
    selectedDocxKey: instance.selectedDocxKey,
    selectedPdfKey: instance.selectedPdfKey,
    sourceSelections: entry?.sourceSelections || instance.sourceSelections || [],
    sourceValues: entry?.sourceValues || instance.sourceValues || {},
    answers: entry?.answers || instance.answers || {},
    derivedOverrides: entry?.derivedOverrides || instance.derivedOverrides || {},
    schema: template.schema || {},
    validation,
    exportedAt: new Date().toISOString()
  };
}

module.exports = {
  COMPLETED_SOURCE_STATUSES: Object.freeze([...COMPLETED_SOURCE_STATUSES]),
  getSourceTemplateKeyCatalog,
  getSourceTemplateKeyOptions,
  ensureSourceTemplateDocxAliases,
  prepareSourceTemplateForKeyOptions,
  validateTemplateReferences,
  calculateAnswers,
  validateAnswers,
  buildSourceValuesFromPlaceholders,
  buildSourcePayload,
  createOverallInstance,
  createOverallWorkspace,
  saveOverallWorkspace,
  loadOverallCreateCandidates,
  ensureWorkspaceShape,
  templateHasOverallFields,
  templateHasAttachedDocx,
  templateHasAttachedPdf,
  previewStudentEntry,
  saveStudentAnswers,
  generateStudentDocx,
  generateStudentPdf,
  exportWorkspaceZip,
  exportWorkspacePdfZip,
  exportWorkspaceDocx,
  exportWorkspacePdf,
  getOverallInstance,
  saveOverallAnswers,
  buildSourceUpdatePreview,
  applySourceUpdates,
  resetDerivedOverride,
  transitionStatus,
  hasBlockingValidationErrors,
  isOverallFieldEditable,
  buildDocxPayload,
  buildDocxPayloadDetailed,
  findCalculationMismatches,
  buildExportPreview,
  buildPdfExportPreview,
  buildOverallExportPayload,
  exportOverallReport,
  exportOverallReportPdf,
  resolveSelectedPdfKey,
  formatMissingDocxTokenError,
  listDocxPlaceholderAliases
};
