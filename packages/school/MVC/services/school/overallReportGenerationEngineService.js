const schoolDataService = require('./schoolDataService');
const reportGenerationEngineService = require('./reportGenerationEngineService');
const overallReportService = require('./overallReportService');
const reportDocxRenderService = require('./reportDocxRenderService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const DATA_FIELD_EXCLUSIONS = new Set(['section', 'subheader', 'row_break']);

function getDataFields(template = {}) {
  return (Array.isArray(template?.schema?.fields) ? template.schema.fields : [])
    .filter((field) => field?.id && !DATA_FIELD_EXCLUSIONS.has(String(field.type || '').toLowerCase()));
}

function clean(value = '') {
  return String(value ?? '').trim();
}

function isEmptyValue(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function findEngineStudentRow(engineResult, studentId) {
  const target = String(studentId ?? '').trim();
  const rows = Array.isArray(engineResult?.rows) ? engineResult.rows : [];
  return rows.find((row) => String(row?.studentId ?? '').trim() === target) || null;
}

function collectStudentsFromSourceBatch(sourceBatch = {}) {
  const studentMap = new Map();
  (Array.isArray(sourceBatch?.sourceRuns) ? sourceBatch.sourceRuns : []).forEach((run) => {
    (Array.isArray(run?.engineResult?.rows) ? run.engineResult.rows : []).forEach((row) => {
      const studentId = String(row?.studentId ?? '').trim();
      if (!studentMap.has(studentId)) {
        studentMap.set(studentId, {
          studentId,
          studentName: clean(row?.studentName || row?.payload?.studentName || studentId)
        });
      }
    });
  });
  return [...studentMap.values()];
}

function isOptionalSlot(slot = {}) {
  return String(slot?.requirement || 'necessary').trim().toLowerCase() === 'optional';
}

function buildEmptySourceSlotValues(sourceTemplate = {}) {
  const keys = overallReportService.getSourceTemplateKeyCatalog(sourceTemplate);
  const placeholders = {};
  keys.forEach((key) => {
    placeholders[key] = '';
  });
  return overallReportService.buildSourceValuesFromPlaceholders(sourceTemplate, placeholders);
}

function mapSourceRunsToSlots(template, sourceRuns = []) {
  const slots = Array.isArray(template?.sourceSlots) ? template.sourceSlots : [];
  if (!slots.length) throw new Error('Overall template has no source slots.');
  const mapped = new Map();
  const runs = Array.isArray(sourceRuns) ? sourceRuns : [];

  slots.forEach((slot) => {
    const slotKey = clean(slot?.slotKey).toUpperCase();
    const run = runs.find((row) => {
      const runSlot = clean(row?.slotKey).toUpperCase();
      if (runSlot && runSlot === slotKey) return true;
      return idsEqual(row?.templateId, slot?.templateId);
    });
    if (!run) {
      if (isOptionalSlot(slot)) {
        mapped.set(slotKey, null);
        return;
      }
      throw new Error(`Missing source batch for slot ${slotKey} (template ${slot.templateId}).`);
    }
    mapped.set(slotKey, run);
  });

  runs.forEach((run) => {
    const runSlot = clean(run?.slotKey).toUpperCase();
    const matchesSlot = slots.some((slot) => {
      if (runSlot && runSlot === clean(slot.slotKey).toUpperCase()) return true;
      return idsEqual(run?.templateId, slot?.templateId);
    });
    if (!matchesSlot && runSlot) {
      // extra run — ignored with warning handled at caller
    }
  });

  return mapped;
}

function buildSourceValuesFromStudentPayload(reportTemplate, studentPayload = {}) {
  return overallReportService.buildSourceValuesFromPlaceholders(
    reportTemplate,
    studentPayload?.placeholders || {}
  );
}

function buildOverallVirtualInstance(template, {
  studentId = '',
  studentName = '',
  sourceValues = {},
  answers = {},
  derivedOverrides = {},
  selectedDocxKey = 'default',
  filtersSnapshot = {}
} = {}) {
  const cleanStudentId = String(studentId ?? '').trim();
  return {
    id: `overall-engine-${cleanStudentId || 'class'}`,
    status: 'engine',
    orgId: template?.orgId || '',
    title: clean(template?.title) || 'Overall Report',
    overallTemplateId: template?.id || '',
    overallTemplateVersion: template?.version,
    selectedDocxKey: clean(selectedDocxKey) || 'default',
    templateSnapshot: template,
    sourceSelections: [],
    sourceValues,
    answers,
    derivedOverrides,
    filtersSnapshot,
    studentId: cleanStudentId,
    studentName: clean(studentName)
  };
}

function assessOverallGenerationWarnings(template, virtualInstance, mergedPayload = null) {
  const warnings = [];
  const answers = virtualInstance?.answers || {};
  const payload = mergedPayload || overallReportService.buildDocxPayloadDetailed(virtualInstance);
  const placeholders = payload?.placeholders || {};

  getDataFields(template).forEach((field) => {
    const fieldId = String(field?.id || '');
    if (!fieldId) return;
    const mode = String(field?.overallValueMode || 'manual');
    if (mode === 'manual' && isEmptyValue(answers[fieldId])) {
      warnings.push({
        code: 'empty_manual_field',
        fieldId,
        label: String(field.label || fieldId),
        message: 'Manual overall field has no value and may export empty.'
      });
    }
    const oToken = `O.${fieldId}`;
    if (Object.prototype.hasOwnProperty.call(placeholders, oToken) && isEmptyValue(placeholders[oToken])) {
      warnings.push({
        code: 'empty_overall_placeholder',
        fieldId,
        label: String(field.label || fieldId),
        message: `Overall placeholder ${oToken} is empty after conversion.`
      });
    }
  });

  return warnings;
}

async function loadReportTemplate(templateId, reqUser) {
  const template = await schoolDataService.getDataById('reportTemplates', templateId, reqUser);
  if (!template) throw new Error(`Report template ${templateId} was not found.`);
  return template;
}

async function loadOverallTemplate(templateId, reqUser) {
  const template = await schoolDataService.getDataById('overallReportTemplates', templateId, reqUser);
  if (!template) throw new Error(`Overall report template ${templateId} was not found.`);
  if (String(template?.status || '').toLowerCase() !== 'active') {
    throw new Error('Only active overall report templates can be used for generation.');
  }
  return template;
}

async function buildStudentSourceValues(template, slotMap, studentId, templateCache, reqUser) {
  const sourceValues = {};
  const slots = Array.isArray(template?.sourceSlots) ? template.sourceSlots : [];

  for (const slot of slots) {
    const slotKey = clean(slot.slotKey).toUpperCase();
    const run = slotMap.get(slotKey);
    if (!run) {
      if (isOptionalSlot(slot)) {
        const reportTemplateId = slot.templateId;
        if (!templateCache.has(reportTemplateId)) {
          templateCache.set(reportTemplateId, await loadReportTemplate(reportTemplateId, reqUser));
        }
        const reportTemplate = templateCache.get(reportTemplateId);
        sourceValues[slotKey] = buildEmptySourceSlotValues(reportTemplate);
        continue;
      }
      throw new Error(`Missing source batch for slot ${slotKey}.`);
    }
    const row = findEngineStudentRow(run?.engineResult, studentId);
    if (!row) {
      throw new Error(`No engine output found for student ${studentId || '(class)'} on slot ${slotKey}.`);
    }
    const reportTemplateId = slot.templateId;
    if (!templateCache.has(reportTemplateId)) {
      templateCache.set(reportTemplateId, await loadReportTemplate(reportTemplateId, reqUser));
    }
    const reportTemplate = templateCache.get(reportTemplateId);
    const payload = row.payload || await reportGenerationEngineService.buildStudentPayload({
      template: reportTemplate,
      assignment: { reportScope: 'each_student', sharedAnswers: {} },
      instance: row.instance,
      reqUser,
      options: { format: 'docx' }
    });
    sourceValues[slotKey] = buildSourceValuesFromStudentPayload(reportTemplate, payload);
  }

  return sourceValues;
}

async function renderVirtualOverallDocx(virtualInstance, docxKey = '') {
  const instance = { ...virtualInstance };
  if (docxKey) instance.selectedDocxKey = docxKey;
  const preview = await overallReportService.buildExportPreview(instance);
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
  const safeStudent = clean(instance.studentName || instance.studentId || 'student').replace(/[^\w.-]+/g, '_');
  const fileName = rendered.fileName?.includes(safeStudent)
    ? rendered.fileName
    : `${safeStudent || 'student'}_${rendered.fileName || 'overall.docx'}`;
  return {
    ...rendered,
    fileName,
    docxKey: preview.docxKey
  };
}

async function generateSourceBatch(request = {}, reqUser) {
  const sourceRuns = Array.isArray(request?.sourceRuns) ? request.sourceRuns : [];
  if (!sourceRuns.length) throw new Error('Add at least one source run.');

  const globalStudentIds = Array.isArray(request?.studentIds) ? request.studentIds : undefined;
  const warnings = [];
  const results = [];

  for (const run of sourceRuns) {
    const engineResult = await reportGenerationEngineService.generateReportOutput({
      templateId: run.templateId,
      classId: run.classId,
      teacherId: run.teacherId,
      reportStartDate: run.reportStartDate,
      reportDueDate: run.reportDueDate,
      reportScope: run.reportScope,
      targetStudentIds: run.targetStudentIds,
      sessionId: run.sessionId,
      sessionDate: run.sessionDate,
      dueDate: run.dueDate,
      taskStartTime: run.taskStartTime,
      taskEndTime: run.taskEndTime,
      sharedAnswers: run.sharedAnswers,
      assignmentId: run.assignmentId,
      assignmentRowId: run.assignmentRowId,
      studentIds: globalStudentIds,
      format: run.format || 'json',
      docxMode: run.docxMode,
      docxKey: run.docxKey,
      pdfKey: run.pdfKey
    }, {}, reqUser);

    (engineResult.warnings || []).forEach((warning) => warnings.push(warning));

    results.push({
      slotKey: clean(run.slotKey).toUpperCase(),
      templateId: run.templateId,
      classId: run.classId,
      teacherId: run.teacherId,
      reportStartDate: run.reportStartDate,
      reportDueDate: run.reportDueDate,
      format: engineResult.format,
      engineResult
    });
  }

  const batch = {
    filterStartDate: clean(request?.filterStartDate),
    filterEndDate: clean(request?.filterEndDate),
    sourceRuns: results,
    students: collectStudentsFromSourceBatch({ sourceRuns: results }),
    warnings
  };

  return batch;
}

async function buildOverallStudentEntry({
  overallTemplate,
  slotMap,
  studentId,
  studentName,
  selectedDocxKey,
  filtersSnapshot,
  templateCache,
  reqUser
}) {
  const sourceValues = await buildStudentSourceValues(
    overallTemplate,
    slotMap,
    studentId,
    templateCache,
    reqUser
  );
  const calculated = overallReportService.calculateAnswers({
    template: overallTemplate,
    sourceValues,
    currentAnswers: {},
    derivedOverrides: {},
    initialize: true
  });
  if (calculated.diagnostics.length) {
    const first = calculated.diagnostics[0];
    throw new Error(`Unable to calculate overall fields for ${studentName || studentId}: ${first.message}`);
  }

  const virtualInstance = buildOverallVirtualInstance(overallTemplate, {
    studentId,
    studentName,
    sourceValues,
    answers: calculated.answers,
    derivedOverrides: calculated.derivedOverrides,
    selectedDocxKey,
    filtersSnapshot
  });

  const docxPayload = overallReportService.buildDocxPayloadDetailed(virtualInstance);
  const validation = overallReportService.validateAnswers(overallTemplate, calculated.answers);
  const warnings = assessOverallGenerationWarnings(overallTemplate, virtualInstance, docxPayload);

  return {
    studentId,
    studentName,
    sourceValues,
    answers: calculated.answers,
    derivedOverrides: calculated.derivedOverrides,
    placeholders: docxPayload.placeholders,
    conversionDiagnostics: docxPayload.conversionDiagnostics || [],
    validation,
    calculationDiagnostics: calculated.diagnostics,
    virtualInstance,
    warnings
  };
}

async function generateOverallFromSourceBatch(request = {}, reqUser) {
  const overallTemplateId = clean(request?.overallTemplateId);
  if (!overallTemplateId) throw new Error('overallTemplateId is required.');

  const sourceBatch = request?.sourceBatch;
  if (!sourceBatch || !Array.isArray(sourceBatch?.sourceRuns) || !sourceBatch.sourceRuns.length) {
    throw new Error('sourceBatch with at least one source run is required.');
  }

  const overallTemplate = await loadOverallTemplate(overallTemplateId, reqUser);
  await overallReportService.validateTemplateReferences(overallTemplate, reqUser);

  const slotMap = mapSourceRunsToSlots(overallTemplate, sourceBatch.sourceRuns);
  const allStudents = collectStudentsFromSourceBatch(sourceBatch);
  const filterIds = (Array.isArray(request?.studentIds) ? request.studentIds : [])
    .map((id) => String(id ?? '').trim());
  const selectedStudents = filterIds.length
    ? allStudents.filter((row) => filterIds.includes(String(row.studentId ?? '').trim()))
    : allStudents;

  if (!selectedStudents.length) {
    throw new Error('No students matched the requested overall export selection.');
  }

  const format = clean(request?.format || 'json').toLowerCase();
  if (format !== 'json' && format !== 'docx') {
    throw new Error('Invalid overall format. Use json or docx.');
  }

  const selectedDocxKey = clean(request?.selectedDocxKey) || 'default';
  const docxModeRaw = clean(request?.docxMode).toLowerCase();
  const docxMode = docxModeRaw === 'zip' || docxModeRaw === 'consolidated'
    ? docxModeRaw
    : (selectedStudents.length === 1 ? 'single' : 'consolidated');

  const selectionByStudent = new Map(
    (Array.isArray(request?.selections) ? request.selections : [])
      .map((row) => [String(row?.studentId ?? '').trim(), row])
      .filter(([studentId]) => studentId)
  );

  const filtersSnapshot = {
    startDate: clean(sourceBatch.filterStartDate),
    endDate: clean(sourceBatch.filterEndDate),
    studentIds: selectedStudents.map((row) => row.studentId)
  };

  const templateCache = new Map();
  const warnings = [...(sourceBatch.warnings || [])];
  const studentEntries = [];

  for (const student of selectedStudents) {
    const entry = await buildOverallStudentEntry({
      overallTemplate,
      slotMap,
      studentId: student.studentId,
      studentName: student.studentName,
      selectedDocxKey,
      filtersSnapshot,
      templateCache,
      reqUser
    });
    warnings.push(...entry.warnings);
    studentEntries.push(entry);
  }

  const result = {
    overallTemplateId: overallTemplate.id,
    overallTemplateTitle: overallTemplate.title,
    format,
    filtersSnapshot,
    warnings,
    students: studentEntries.map((entry) => ({
      studentId: entry.studentId,
      studentName: entry.studentName,
      sourceValues: entry.sourceValues,
      answers: entry.answers,
      derivedOverrides: entry.derivedOverrides,
      placeholders: entry.placeholders,
      conversionDiagnostics: entry.conversionDiagnostics,
      validation: entry.validation,
      calculationDiagnostics: entry.calculationDiagnostics,
      warnings: entry.warnings
    }))
  };

  if (format === 'json') {
    return result;
  }

  const rendered = [];
  for (const entry of studentEntries) {
    const selection = selectionByStudent.get(String(entry.studentId ?? '').trim()) || {};
    const docxKey = clean(selection.docxKey) || selectedDocxKey;
    const file = await renderVirtualOverallDocx(entry.virtualInstance, docxKey);
    rendered.push(file);
    entry.file = file;
  }

  result.students = studentEntries.map((entry) => ({
    studentId: entry.studentId,
    studentName: entry.studentName,
    file: entry.file
  }));

  if (docxMode === 'zip') {
    const zipBuffer = await reportDocxRenderService.zipReportInstanceDocxFiles(rendered);
    result.buffer = zipBuffer;
    result.contentType = 'application/zip';
    result.fileName = `${clean(overallTemplate.title || 'overall-report').replace(/[^\w.-]+/g, '_') || 'overall-report'}.zip`;
    return result;
  }

  if (rendered.length === 1 || docxMode === 'single') {
    result.file = rendered[0];
    result.contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return result;
  }

  const buffer = reportDocxRenderService.mergeReportInstanceDocxBuffers(rendered.map((item) => item.buffer));
  result.buffer = buffer;
  result.contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  result.fileName = `${clean(overallTemplate.title || 'overall-report').replace(/[^\w.-]+/g, '_') || 'overall-report'}.docx`;
  return result;
}

async function generateOverallPipeline(request = {}, reqUser) {
  const sourceBatch = await generateSourceBatch({
    filterStartDate: request?.filterStartDate,
    filterEndDate: request?.filterEndDate,
    studentIds: request?.studentIds,
    sourceRuns: request?.sourceRuns
  }, reqUser);

  const overall = await generateOverallFromSourceBatch({
    overallTemplateId: request?.overallTemplateId,
    sourceBatch,
    studentIds: request?.studentIds,
    selectedDocxKey: request?.selectedDocxKey,
    format: request?.format,
    docxMode: request?.docxMode,
    selections: request?.selections
  }, reqUser);

  return {
    sourceBatch,
    overall
  };
}

module.exports = {
  buildSourceValuesFromStudentPayload,
  buildOverallVirtualInstance,
  generateSourceBatch,
  generateOverallFromSourceBatch,
  generateOverallPipeline
};
