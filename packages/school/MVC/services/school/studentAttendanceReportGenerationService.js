'use strict';

const schoolDataService = require('./schoolDataService');
const studentAttendanceReportService = require('./studentAttendanceReportService');
const studentAttendanceReportPolicyModel = require('../../models/school/studentAttendanceReportPolicyModel');
const studentAttendanceReportPolicyService = require('./studentAttendanceReportPolicyService');
const reportGenerationEngineService = require('./reportGenerationEngineService');
const overallReportGenerationEngineService = require('./overallReportGenerationEngineService');
const reportDocxRenderService = require('./reportDocxRenderService');
const reportPdfRenderService = require('./reportPdfRenderService');
const reportFunderDocxService = require('./reportFunderDocxService');
const reportFunderPdfService = require('./reportFunderPdfService');
const rollingEnrollmentFunderService = require('./rollingEnrollmentFunderService');
const overallReportService = require('./overallReportService');
const studentAttendanceReportExportFormatService = require('./studentAttendanceReportExportFormatService');
const reportExportBatchCacheService = require('./reportExportBatchCacheService');
const { requireCoreModule } = require('./schoolCoreContracts');
const sarExportTimingService = require('./sarExportTimingService');
const sarExportConfigService = require('./sarExportConfigService');
const { runWithConcurrency } = require('../../utils/asyncPool');
const fs = require('fs');
const path = require('path');
const os = require('os');

function clean(value = '') {
  return String(value ?? '').trim();
}

function safeFileToken(value = '', fallback = 'export') {
  const token = clean(value).replace(/[^\w.-]+/g, '_').slice(0, 60);
  return token || fallback;
}

function sortClasses(classes = []) {
  return [...(Array.isArray(classes) ? classes : [])].sort((left, right) => {
    const nameCompare = String(left?.className || '').localeCompare(String(right?.className || ''));
    if (nameCompare !== 0) return nameCompare;
    return String(left?.classId || '').localeCompare(String(right?.classId || ''));
  });
}

function resolveTeacherIdForClass(classRow = {}) {
  return clean(
    classRow?.teacherId
    || classRow?.teacherPersonId
    || classRow?.instructorId
  );
}

function sortOverallSlots(overallTemplate = null) {
  if (!overallTemplate || !Array.isArray(overallTemplate.sourceSlots)) return [];
  return [...overallTemplate.sourceSlots].sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
}

function isOptionalSlot(slot = {}) {
  return String(slot?.requirement || 'necessary').trim().toLowerCase() === 'optional';
}

function countNecessarySlots(overallTemplate = null) {
  return sortOverallSlots(overallTemplate).filter((slot) => !isOptionalSlot(slot)).length;
}

function buildOverallSlotSummaries(overallTemplate = null) {
  return sortOverallSlots(overallTemplate).map((slot, index) => ({
    slotKey: clean(slot.slotKey).toUpperCase(),
    slotIndex: index,
    templateId: clean(slot.templateId),
    requirement: isOptionalSlot(slot) ? 'optional' : 'necessary'
  }));
}

function parseTargets(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function buildSourceRunsForStudent({
  student = {},
  policy = {},
  overallTemplate = null,
  startDate = '',
  endDate = '',
  selectedClassIds = null
} = {}) {
  const personId = clean(student.personId);
  const classes = sortClasses(student.classes);
  const warnings = [];
  const selectedSet = selectedClassIds instanceof Set
    ? selectedClassIds
    : (Array.isArray(selectedClassIds) ? new Set(selectedClassIds.map((id) => clean(id)).filter(Boolean)) : null);

  if (!classes.length) {
    warnings.push(`Student ${student.name || personId} has no classes in the selected date range.`);
    return { sourceRuns: [], warnings };
  }

  const slots = sortOverallSlots(overallTemplate);
  const sourceRuns = [];

  if (slots.length) {
    slots.forEach((slot, index) => {
      const classRow = classes[index];
      const optional = isOptionalSlot(slot);
      const classTemplateId = clean(policy.reportTemplateId);
      const slotTemplateId = clean(slot.templateId) || classTemplateId;
      if (!classRow) {
        if (!optional) {
          warnings.push(`No class available for overall slot ${slot.slotKey || index + 1} (${student.name || personId}).`);
        }
        return;
      }
      const classId = clean(classRow.classId);
      if (slotTemplateId && classTemplateId && slotTemplateId !== classTemplateId) {
        if (!optional) {
          warnings.push(`Class ${classRow.className || classId} uses template ${classTemplateId}, but slot ${slot.slotKey || index + 1} requires ${slotTemplateId}.`);
        }
        return;
      }
      if (selectedSet && !selectedSet.has(classId)) {
        if (!optional) {
          warnings.push(`Class ${classRow.className || classId} is not selected for overall slot ${slot.slotKey || index + 1}.`);
        }
        return;
      }
      const teacherId = resolveTeacherIdForClass(classRow);
      if (!teacherId) {
        if (!optional) {
          warnings.push(`Class ${classRow.className || classRow.classId} has no teacher for slot ${slot.slotKey || index + 1}.`);
        }
        return;
      }
      sourceRuns.push({
        slotKey: clean(slot.slotKey).toUpperCase(),
        templateId: classTemplateId || slotTemplateId,
        classId,
        teacherId,
        reportStartDate: startDate,
        reportDueDate: endDate,
        reportScope: 'selected_students',
        targetStudentIds: [personId],
        format: 'json'
      });
    });
    return { sourceRuns, warnings };
  }

  classes.forEach((classRow) => {
    const classId = clean(classRow.classId);
    if (selectedSet && !selectedSet.has(classId)) return;
    const teacherId = resolveTeacherIdForClass(classRow);
    if (!teacherId) {
      warnings.push(`Class ${classRow.className || classRow.classId} has no assigned teacher; skipped for ${student.name || personId}.`);
      return;
    }
    sourceRuns.push({
      templateId: clean(policy.reportTemplateId),
      classId,
      teacherId,
      reportStartDate: startDate,
      reportDueDate: endDate,
      reportScope: 'selected_students',
      targetStudentIds: [personId],
      format: 'docx'
    });
  });

  return { sourceRuns, warnings };
}

function resolveExportPartBuffer(row = {}) {
  if (Buffer.isBuffer(row?.buffer) && row.buffer.length) return row.buffer;
  const scratchPath = clean(row?.scratchPath);
  if (scratchPath && fs.existsSync(scratchPath)) {
    return fs.readFileSync(scratchPath);
  }
  return null;
}

function removeSarExportScratchDir(scratchDir) {
  const dir = clean(scratchDir);
  if (!dir) return;
  if (String(process.env.SAR_EXPORT_KEEP_SCRATCH || '').trim().toLowerCase() === '1'
    || String(process.env.SAR_EXPORT_KEEP_SCRATCH || '').trim().toLowerCase() === 'true') {
    return;
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

function stageExportFileToScratch({ file, index, scratchDir, format }) {
  if (!scratchDir || format !== 'docx' || !file) return file;
  const buffer = resolveExportPartBuffer(file);
  if (!buffer) return file;
  const partPath = path.join(
    scratchDir,
    `part-${index}-${safeFileToken(file.fileName || `student_${index}`, `part_${index}`)}.docx`
  );
  fs.writeFileSync(partPath, buffer);
  return {
    ...file,
    buffer,
    scratchPath: partPath
  };
}

async function buildDocxTemplateLoadPlan(targets = [], ctx = {}, studentMap = new Map(), exportBatchCache, reqUser) {
  const uniqueMap = new Map();
  const byStudent = [];

  const registerRef = (ref = {}) => {
    if (!ref?.docxTemplate) return;
    const uploadRef = reportDocxRenderService.resolveDocxTemplateReadRef(ref.docxTemplate);
    const key = `${clean(ref.templateId)}|${clean(ref.variantKey) || 'default'}|${uploadRef}`;
    if (!uploadRef || uniqueMap.has(key)) return;
    uniqueMap.set(key, {
      templateId: clean(ref.templateId),
      variantKey: clean(ref.variantKey) || 'default',
      uploadRef,
      label: clean(ref.label),
      docxTemplate: ref.docxTemplate
    });
  };

  for (const target of Array.isArray(targets) ? targets : []) {
    const type = clean(target?.type).toLowerCase();
    const studentId = clean(target?.studentId);
    const student = studentMap.get(studentId);
    const studentRefs = [];
    if (!student) continue;

    if (type === 'class') {
      const template = await reportExportBatchCacheService.getOrLoadTemplate(
        exportBatchCache,
        clean(ctx.policy?.reportTemplateId),
        reqUser
      );
      const docxKey = clean(target?.docxKey) || 'default';
      const resolved = reportFunderDocxService.resolveDocxTemplateForFunder({ template, funderKey: docxKey });
      registerRef({
        templateId: template?.id,
        variantKey: resolved.docxKey,
        label: resolved.label,
        docxTemplate: resolved.docxTemplate
      });
      if (resolved.docxTemplate) {
        studentRefs.push({ kind: 'class', variantKey: resolved.docxKey, label: resolved.label });
      }
    }

    if (type === 'overall') {
      const classIds = Array.isArray(target?.classIds)
        ? target.classIds.map((id) => clean(id)).filter(Boolean)
        : [];
      try {
        const { overallTemplate } = resolveEligibleOverallTemplateForTarget({
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
        registerRef({
          templateId: overallTemplate?.id,
          variantKey: resolved.docxKey || variantKey,
          label: resolved.label,
          docxTemplate: resolved.docxTemplate
        });
        if (resolved.docxTemplate) {
          studentRefs.push({
            kind: 'overall',
            templateId: clean(overallTemplate?.id),
            variantKey: resolved.docxKey || variantKey,
            label: resolved.label
          });
        }
      } catch {
        // Skip targets that cannot satisfy template requirements during planning.
      }
    }

    byStudent.push({ studentId, refs: studentRefs });
  }

  return {
    uniqueRefs: [...uniqueMap.values()],
    byStudent
  };
}

function parseExportConcurrency(options = {}) {
  const format = clean(options.format).toLowerCase();
  let concurrency = sarExportConfigService.getExportConcurrency();
  try {
    const uploadStorage = requireCoreModule('MVC/services/uploadStorageService');
    if (uploadStorage.isRailwayGatewayBackend()) {
      concurrency = format === 'docx' ? 1 : Math.min(concurrency, 2);
    }
  } catch {
    // ignore
  }
  return concurrency;
}

function collectTargetClassIds(targets = []) {
  const set = new Set();
  (Array.isArray(targets) ? targets : []).forEach((target) => {
    const type = clean(target?.type).toLowerCase();
    if (type === 'class') {
      const classId = clean(target?.classId);
      if (classId) set.add(classId);
      return;
    }
    if (type === 'overall' && Array.isArray(target?.classIds)) {
      target.classIds.forEach((id) => {
        const classId = clean(id);
        if (classId) set.add(classId);
      });
    }
  });
  return set;
}

async function loadGenerationContext(req, options = {}) {
  const activeOrgId = clean(req.user?.activeOrgId);
  if (!activeOrgId) {
    const error = new Error('Select an active organization before generating reports.');
    error.statusCode = 400;
    throw error;
  }

  const policyAccessCache = options.policyAccessCache
    || studentAttendanceReportPolicyService.createPolicyAccessCache();

  const policy = studentAttendanceReportPolicyService.resolvePolicy(
    await studentAttendanceReportPolicyModel.getPolicyForOrg(activeOrgId)
  );
  if (!clean(policy.reportTemplateId)) {
    const error = new Error('Configure a report template in School Settings before generating reports.');
    error.statusCode = 400;
    throw error;
  }

  await studentAttendanceReportPolicyService.assertReportTemplateAccessible(policy.reportTemplateId, req.user, {
    accessCache: policyAccessCache
  });

  const overallTemplates = await studentAttendanceReportPolicyService.assertOverallTemplatesAccessible(
    policy.overallReportTemplateIds,
    req.user,
    { accessCache: policyAccessCache }
  );
  const overallTemplate = overallTemplates[0] || null;
  const overallTemplateMap = new Map(overallTemplates.map((template) => [clean(template.id), template]));

  const payload = options.skipAttendanceMatrix
    ? await studentAttendanceReportService.buildStudentAttendanceReportExportContextPayload(req, options)
    : await studentAttendanceReportService.buildStudentAttendanceReportPayload(req, options);
  const students = Array.isArray(payload.students) ? payload.students : [];
  if (!students.length) {
    const error = new Error('No students matched the current filters.');
    error.statusCode = 400;
    throw error;
  }

  return {
    policy,
    overallTemplate,
    overallTemplates,
    overallTemplateMap,
    payload,
    students,
    startDate: payload.startDate,
    endDate: payload.endDate
  };
}

async function loadTemplateMetaMap(templateIds = [], reqUser, policy = {}, accessCache = null) {
  const map = new Map();
  const uniqueIds = [...new Set(templateIds.map((id) => clean(id)).filter(Boolean))];
  for (const templateId of uniqueIds) {
    let template = accessCache?.reportTemplates?.get(templateId) || null;
    if (!template) {
      // eslint-disable-next-line no-await-in-loop
      template = await schoolDataService.getDataById('reportTemplates', templateId, reqUser);
    }
    if (!template) continue;
    const rawMeta = {
      templateTitle: studentAttendanceReportPolicyService.formatTemplateLabel(template, templateId),
      hasDocx: reportFunderDocxService.templateHasAnyDocx(template),
      hasPdf: reportFunderPdfService.templateHasAnyPdf(template)
    };
    const effective = studentAttendanceReportExportFormatService.resolveEffectiveClassExportFlags(
      policy,
      templateId,
      rawMeta
    );
    map.set(templateId, {
      ...rawMeta,
      ...effective,
      template
    });
  }
  return map;
}

function buildFunderLabelLookup(activeFunders = []) {
  const labelById = new Map(
    (Array.isArray(activeFunders) ? activeFunders : []).map((row) => [
      String(row.id),
      String(row.label || row.id)
    ])
  );
  labelById.set(reportFunderDocxService.SELF_FUNDER_KEY, 'Self Fund');
  return labelById;
}

function enrichClassExportRowsWithFunderSuggestions(
  student = {},
  classRows = [],
  template = null,
  periodRowsByClassId = null,
  startDate = '',
  endDate = '',
  labelById = new Map()
) {
  const personId = clean(student.personId);
  const studentId = clean(student.studentRecordId || student.studentId);
  const docxOptions = template ? reportFunderDocxService.buildAvailableDocxOptions(template) : [];
  const pdfOptions = template ? reportFunderPdfService.buildAvailablePdfOptions(template) : [];

  return (Array.isArray(classRows) ? classRows : []).map((row) => {
    if (!row?.exportable) {
      return {
        ...row,
        funderLabel: '',
        docxOptions,
        pdfOptions,
        suggestedDocxKey: '',
        suggestedPdfKey: ''
      };
    }
    const classId = clean(row.classId);
    const periodRows = periodRowsByClassId instanceof Map
      ? (periodRowsByClassId.get(classId) || [])
      : [];
    const funder = reportFunderDocxService.resolveStudentFunderForReportPeriod({
      periodRows,
      personId,
      studentId,
      windowStart: startDate,
      windowEnd: endDate
    });
    const funderKey = funder.funderKey || '';
    const funderLabel = funderKey
      ? rollingEnrollmentFunderService.resolveEnrollmentFunderLabel(
        { funderId: funder.funderId, funderType: funder.funderType },
        labelById
      )
      : '';
    return {
      ...row,
      funderLabel,
      docxOptions,
      pdfOptions,
      suggestedDocxKey: template
        ? reportFunderDocxService.suggestDocxKeyForFunder({ template, funderKey })
        : '',
      suggestedPdfKey: template
        ? reportFunderPdfService.suggestPdfKeyForFunder({ template, funderKey })
        : ''
    };
  });
}

function buildClassExportRowsForStudent(student, policy, overallTemplate, templateMetaMap) {
  const classes = sortClasses(student.classes);
  const rows = [];
  const templateId = clean(policy.reportTemplateId);
  const meta = templateMetaMap.get(templateId) || {};
  classes.forEach((classRow, index) => {
    const classId = clean(classRow.classId);
    const teacherId = resolveTeacherIdForClass(classRow);
    rows.push({
      classId,
      className: clean(classRow.className) || classId,
      teacherId,
      slotKey: '',
      slotIndex: index,
      templateId,
      templateTitle: meta.templateTitle || templateId,
      hasDocx: Boolean(meta.hasDocx),
      hasPdf: Boolean(meta.hasPdf),
      hasPayload: meta.hasPayload !== false,
      exportable: Boolean(teacherId),
      warning: teacherId ? '' : `No teacher assigned for ${classRow.className || classId}.`
    });
  });
  return rows;
}

function buildOverallExportBlock(student, policy, overallTemplate, classRows) {
  if (!overallTemplate) return null;

  const slots = sortOverallSlots(overallTemplate);
  const slotSummaries = buildOverallSlotSummaries(overallTemplate);
  const necessarySlots = slots.filter((slot) => !isOptionalSlot(slot));
  const missingSlots = [];
  const warnings = [];
  const matchedClassIds = [];
  const templateId = clean(overallTemplate.id || policy.overallReportTemplateId);
  const templateTitle = clean(overallTemplate.title) || templateId;

  slots.forEach((slot, index) => {
    const optional = isOptionalSlot(slot);
    const row = classRows.find((entry) => Number(entry.slotIndex) === index);
    if (!row) {
      if (optional) return;
      missingSlots.push(clean(slot.slotKey) || String(index + 1));
      warnings.push(`No class available for slot ${slot.slotKey || index + 1}.`);
      return;
    }
    if (!row.exportable) {
      if (optional) return;
      missingSlots.push(clean(slot.slotKey) || String(index + 1));
      warnings.push(row.warning || `Slot ${slot.slotKey || index + 1} is not exportable.`);
      return;
    }
    const slotTemplateId = clean(slot.templateId) || clean(policy.reportTemplateId);
    if (slotTemplateId && clean(row.templateId) !== slotTemplateId) {
      if (optional) return;
      missingSlots.push(clean(slot.slotKey) || String(index + 1));
      warnings.push(`Slot ${slot.slotKey || index + 1} requires template ${slotTemplateId}, but class ${row.className || row.classId} uses ${row.templateId}.`);
      return;
    }
    if (clean(row.classId)) matchedClassIds.push(clean(row.classId));
  });

  const eligible = slots.length > 0
    && (necessarySlots.length === 0 || missingSlots.length === 0);
  const rawOverallMeta = {
    hasDocx: overallReportService.templateHasAttachedDocx(overallTemplate),
    hasPdf: overallReportService.templateHasAttachedPdf(overallTemplate)
  };
  const effectiveOverall = studentAttendanceReportExportFormatService.resolveEffectiveOverallExportFlags(
    policy,
    templateId,
    rawOverallMeta
  );

  return {
    defined: true,
    templateId,
    templateTitle,
    hasDocx: effectiveOverall.hasDocx,
    hasPdf: effectiveOverall.hasPdf,
    hasPayload: effectiveOverall.hasPayload,
    eligible,
    missingSlots,
    warnings,
    matchedClassIds,
    slots: slotSummaries,
    necessarySlotCount: necessarySlots.length,
    slotCount: slots.length
  };
}

function buildOverallExportOptions(student, policy, overallTemplates = [], classRows = []) {
  return (Array.isArray(overallTemplates) ? overallTemplates : [])
    .map((template) => buildOverallExportBlock(student, policy, template, classRows))
    .filter(Boolean);
}

async function loadEnrollmentPeriodRowsForClassIds(classIds = [], reqUser) {
  const uniqueIds = [...new Set(classIds.map((id) => clean(id)).filter(Boolean))];
  const periodRows = [];
  for (const classId of uniqueIds) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await schoolDataService.getClassEnrollmentPeriodsByClassId(classId, reqUser).catch(() => []);
    if (Array.isArray(rows)) periodRows.push(...rows);
  }
  return periodRows;
}

function applyOverallTemplateVariantToOption(option, overallTemplate, policy, funderKey = '') {
  if (!option || !overallTemplate) return option;
  const templateVariantOptions = overallReportService.buildOverallTemplateVariantOptions(overallTemplate)
    .map((variantRow) => {
      const variantEffective = studentAttendanceReportExportFormatService.resolveEffectiveOverallExportFlags(
        policy,
        option.templateId,
        {
          hasDocx: Boolean(variantRow?.hasDocx),
          hasPdf: Boolean(variantRow?.hasPdf)
        }
      );
      return {
        ...variantRow,
        hasDocx: variantEffective.hasDocx,
        hasPdf: variantEffective.hasPdf
      };
    });
  const { suggestedTemplateVariantKey } = overallReportService.suggestOverallTemplateVariantKeys(
    overallTemplate,
    funderKey
  );
  const variantKey = overallReportService.resolveOverallTemplateVariantKey(
    overallTemplate,
    suggestedTemplateVariantKey,
    suggestedTemplateVariantKey
  );
  const variantRow = templateVariantOptions.find((row) => row.key === variantKey) || templateVariantOptions[0];
  const rawOverallMeta = {
    hasDocx: variantRow?.hasDocx ?? overallReportService.templateHasAttachedDocx(overallTemplate, variantKey),
    hasPdf: variantRow?.hasPdf ?? overallReportService.templateHasAttachedPdf(overallTemplate, variantKey)
  };
  const effectiveOverall = studentAttendanceReportExportFormatService.resolveEffectiveOverallExportFlags(
    policy,
    option.templateId,
    rawOverallMeta
  );
  return {
    ...option,
    templateVariantOptions,
    suggestedTemplateVariantKey: variantKey,
    hasDocx: effectiveOverall.hasDocx,
    hasPdf: effectiveOverall.hasPdf,
    hasPayload: effectiveOverall.hasPayload
  };
}

async function enrichOverallExportOptionsForStudent({
  student,
  classRows = [],
  overallOptions = [],
  overallTemplates = [],
  policy = {},
  startDate = '',
  endDate = '',
  reqUser,
  periodRowsByClassId = null,
  funderLabelById = null
} = {}) {
  const classIds = classRows.map((row) => clean(row.classId)).filter(Boolean);
  let periodRows = [];
  if (periodRowsByClassId instanceof Map) {
    classIds.forEach((classId) => {
      const rows = periodRowsByClassId.get(classId);
      if (Array.isArray(rows)) periodRows.push(...rows);
    });
  } else {
    periodRows = await loadEnrollmentPeriodRowsForClassIds(classIds, reqUser);
  }
  const personId = clean(student.personId);
  const studentId = clean(student.studentRecordId || student.studentId);
  const funder = reportFunderDocxService.resolveStudentFunderForReportPeriod({
    periodRows,
    personId,
    studentId,
    windowStart: startDate,
    windowEnd: endDate
  });
  const funderKey = funder.funderKey || '';
  const labelMap = funderLabelById instanceof Map ? funderLabelById : new Map();
  const funderLabel = funderKey
    ? rollingEnrollmentFunderService.resolveEnrollmentFunderLabel(
      { funderId: funder.funderId, funderType: funder.funderType },
      labelMap
    )
    : '';
  const templateById = new Map(
    (Array.isArray(overallTemplates) ? overallTemplates : []).map((template) => [clean(template.id), template])
  );
  return (Array.isArray(overallOptions) ? overallOptions : []).map((option) => {
    const overallTemplate = templateById.get(clean(option.templateId));
    if (!overallTemplate) return { ...option, funderLabel };
    const withVariant = applyOverallTemplateVariantToOption(option, overallTemplate, policy, funderKey);
    return { ...withVariant, funderLabel };
  });
}

async function buildStudentAttendanceReportExportPlan(req, options = {}) {
  const policyAccessCache = studentAttendanceReportPolicyService.createPolicyAccessCache();
  const ctx = await loadGenerationContext(req, {
    ...options,
    skipAttendanceMatrix: true,
    policyAccessCache
  });
  const { policy, overallTemplates, students, startDate, endDate } = ctx;

  const templateIds = [policy.reportTemplateId];
  const templateMetaMap = await loadTemplateMetaMap(templateIds, req.user, policy, policyAccessCache);

  const allClassIds = new Set();
  students.forEach((student) => {
    buildClassExportRowsForStudent(student, policy, null, templateMetaMap).forEach((row) => {
      const classId = clean(row?.classId);
      if (classId) allClassIds.add(classId);
    });
  });
  const periodRowsByClassId = new Map();
  await runWithConcurrency([...allClassIds], 6, async (classId) => {
    const rows = await schoolDataService.getClassEnrollmentPeriodsByClassId(classId, req.user).catch(() => []);
    periodRowsByClassId.set(classId, Array.isArray(rows) ? rows : []);
  });

  const defaultReportMeta = templateMetaMap.get(clean(policy.reportTemplateId)) || {};
  const classReportTemplate = defaultReportMeta.template || null;
  const orgId = clean(req.user?.activeOrgId || classReportTemplate?.orgId);
  const activeFunders = orgId
    ? await reportFunderDocxService.loadActiveFunderOptions(req.user, orgId).catch(() => [])
    : [];
  const funderLabelById = buildFunderLabelLookup(activeFunders);

  const planStudents = [];
  for (const student of students) {
    let classRows = buildClassExportRowsForStudent(student, policy, null, templateMetaMap);
    classRows = enrichClassExportRowsWithFunderSuggestions(
      student,
      classRows,
      classReportTemplate,
      periodRowsByClassId,
      startDate,
      endDate,
      funderLabelById
    );
    let overallOptions = buildOverallExportOptions(student, policy, overallTemplates, classRows);
    // eslint-disable-next-line no-await-in-loop
    overallOptions = await enrichOverallExportOptionsForStudent({
      student,
      classRows,
      overallOptions,
      overallTemplates,
      policy,
      startDate,
      endDate,
      reqUser: req.user,
      periodRowsByClassId,
      funderLabelById
    });
    const overall = overallOptions.find((option) => option.eligible) || overallOptions[0] || null;
    const overallFunderLabel = clean(overallOptions.find((row) => row.funderLabel)?.funderLabel);
    planStudents.push({
      personId: clean(student.personId),
      name: clean(student.name) || clean(student.personId),
      classes: classRows,
      overall,
      overallOptions,
      overallFunderLabel
    });
  }

  const overallTemplateSummaries = overallTemplates.map((template) => {
    const templateId = clean(template.id);
    const rawOverallMeta = {
      hasDocx: overallReportService.templateHasAttachedDocx(template),
      hasPdf: overallReportService.templateHasAttachedPdf(template)
    };
    const effectiveOverall = studentAttendanceReportExportFormatService.resolveEffectiveOverallExportFlags(
      policy,
      templateId,
      rawOverallMeta
    );
    return {
      id: templateId,
      title: clean(template.title) || templateId,
      hasDocx: effectiveOverall.hasDocx,
      hasPdf: effectiveOverall.hasPdf,
      hasPayload: effectiveOverall.hasPayload
    };
  });

  return {
    startDate,
    endDate,
    reportTemplateId: clean(policy.reportTemplateId),
    reportTemplateTitle: defaultReportMeta.templateTitle || clean(policy.reportTemplateId),
    reportTemplateExportFormats: {
      hasDocx: Boolean(defaultReportMeta.hasDocx),
      hasPdf: Boolean(defaultReportMeta.hasPdf),
      hasPayload: defaultReportMeta.hasPayload !== false
    },
    classTemplateDocxOptions: classReportTemplate
      ? reportFunderDocxService.buildAvailableDocxOptions(classReportTemplate)
      : [],
    classTemplatePdfOptions: classReportTemplate
      ? reportFunderPdfService.buildAvailablePdfOptions(classReportTemplate)
      : [],
    overallReportTemplateId: clean(policy.overallReportTemplateId),
    overallReportTemplateIds: policy.overallReportTemplateIds || [],
    overallReportTemplateTitle: overallTemplateSummaries[0]?.title || '',
    overallReportTemplateTitleList: overallTemplateSummaries.map((row) => row.title).join(', '),
    overallReportTemplates: overallTemplateSummaries,
    overallBulkExportFormats: {
      hasDocx: overallTemplateSummaries.some((row) => row.hasDocx),
      hasPdf: overallTemplateSummaries.some((row) => row.hasPdf),
      hasPayload: overallTemplateSummaries.some((row) => row.hasPayload !== false)
    },
    students: planStudents
  };
}

function normalizeEngineResultToFile(engineResult, format, fileStem) {
  const warnings = Array.isArray(engineResult?.warnings) ? engineResult.warnings : [];
  if (format === 'json') {
    const payloadBody = engineResult?.payload
      ? { status: 'success', payload: engineResult.payload }
      : { status: 'success', data: engineResult };
    const buffer = Buffer.from(JSON.stringify(payloadBody, null, 2), 'utf8');
    return {
      buffer,
      contentType: 'application/json',
      fileName: `${safeFileToken(fileStem)}_payload.json`,
      warnings
    };
  }

  if (format === 'docx') {
    if (engineResult?.file?.buffer) {
      return {
        buffer: engineResult.file.buffer,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileName: engineResult.file.fileName || `${safeFileToken(fileStem)}.docx`,
        warnings
      };
    }
    if (engineResult?.buffer) {
      return {
        buffer: engineResult.buffer,
        contentType: engineResult.contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileName: engineResult.fileName || `${safeFileToken(fileStem)}.docx`,
        warnings
      };
    }
    const error = new Error('Report engine did not produce a DOCX file.');
    error.statusCode = 400;
    throw error;
  }

  if (format === 'pdf') {
    if (engineResult?.file?.buffer) {
      return {
        buffer: engineResult.file.buffer,
        contentType: 'application/pdf',
        fileName: engineResult.file.fileName || `${safeFileToken(fileStem)}.pdf`,
        warnings
      };
    }
    if (engineResult?.buffer) {
      return {
        buffer: engineResult.buffer,
        contentType: engineResult.contentType || 'application/pdf',
        fileName: engineResult.fileName || `${safeFileToken(fileStem)}.pdf`,
        warnings
      };
    }
    const error = new Error('Report engine did not produce a PDF file.');
    error.statusCode = 400;
    throw error;
  }

  const error = new Error('Invalid export format.');
  error.statusCode = 400;
  throw error;
}

function resolveClassTemplateId(policy) {
  return clean(policy.reportTemplateId);
}

async function exportClassTarget(student, classId, format, ctx, reqUser, exportBatchCache = null, fileKeys = {}) {
  const { policy, startDate, endDate } = ctx;
  const classes = sortClasses(student.classes);
  const classRow = classes.find((row) => clean(row.classId) === clean(classId));
  if (!classRow) {
    const error = new Error(`Class ${classId} was not found for ${student.name || student.personId}.`);
    error.statusCode = 400;
    throw error;
  }

  const teacherId = resolveTeacherIdForClass(classRow);
  if (!teacherId) {
    const error = new Error(`Class ${classRow.className || classId} has no assigned teacher.`);
    error.statusCode = 400;
    throw error;
  }

  const templateId = resolveClassTemplateId(policy);
  studentAttendanceReportExportFormatService.assertSarExportFormatAllowed(
    policy,
    'report',
    templateId,
    format
  );
  const personId = clean(student.personId);
  const docxKey = clean(fileKeys.docxKey);
  const pdfKey = clean(fileKeys.pdfKey);
  const engineRequest = {
    templateId,
    classId: clean(classId),
    teacherId,
    reportStartDate: startDate,
    reportDueDate: endDate,
    reportScope: 'selected_students',
    targetStudentIds: [personId],
    format,
    docxMode: 'single',
    exportBatchCache: exportBatchCache || ctx?.exportBatchCache || null
  };
  if (docxKey || pdfKey) {
    engineRequest.selections = [{ studentId: personId, docxKey, pdfKey }];
    if (docxKey) engineRequest.docxKey = docxKey;
    if (pdfKey) engineRequest.pdfKey = pdfKey;
  }
  const engineResult = await reportGenerationEngineService.generateReportOutput(engineRequest, {}, reqUser);

  const fileStem = `${student.name || student.personId}_${classRow.className || classId}`;
  return normalizeEngineResultToFile(engineResult, format, fileStem);
}

function findMissingNecessarySourceSlots(overallTemplate, sourceRuns = []) {
  return sortOverallSlots(overallTemplate)
    .filter((slot) => !isOptionalSlot(slot))
    .filter((slot) => !sourceRuns.some((run) => clean(run.slotKey).toUpperCase() === clean(slot.slotKey).toUpperCase()));
}

function resolveOverallTemplateCandidates(overallTemplateId, ctx) {
  const requestedId = clean(overallTemplateId);
  const templates = Array.isArray(ctx.overallTemplates) ? ctx.overallTemplates : [];
  if (!requestedId) return templates;
  const match = templates.find((template) => clean(template.id) === requestedId);
  if (!match) {
    const error = new Error(`Overall report template ${requestedId} is not configured for Student Attendance Report export.`);
    error.statusCode = 400;
    throw error;
  }
  return [match];
}

function resolveEligibleOverallTemplateForTarget({ student, selectedClassIds, overallTemplateId, ctx }) {
  const { policy, startDate, endDate } = ctx;
  const candidates = resolveOverallTemplateCandidates(overallTemplateId, ctx);
  if (!candidates.length) {
    const error = new Error('No overall report template is configured.');
    error.statusCode = 400;
    throw error;
  }

  const selectedSet = Array.isArray(selectedClassIds)
    ? new Set(selectedClassIds.map((id) => clean(id)).filter(Boolean))
    : null;
  const failures = [];
  for (const template of candidates) {
    const { sourceRuns, warnings: buildWarnings } = buildSourceRunsForStudent({
      student,
      policy,
      overallTemplate: template,
      startDate,
      endDate,
      selectedClassIds: selectedSet
    });
    const missingNecessary = findMissingNecessarySourceSlots(template, sourceRuns);
    if (missingNecessary.length) {
      failures.push(buildWarnings[0] || `Necessary source slot ${missingNecessary[0].slotKey || ''} is not available for this student.`);
      continue;
    }
    if (!sourceRuns.length && countNecessarySlots(template) > 0) {
      failures.push(buildWarnings[0] || 'Selected classes do not satisfy the necessary overall report sources.');
      continue;
    }
    return { overallTemplate: template, sourceRuns, buildWarnings };
  }

  const error = new Error(failures[0] || 'Selected classes do not satisfy any configured overall report template.');
  error.statusCode = 400;
  throw error;
}

async function exportOverallTarget(
  student,
  selectedClassIds,
  overallTemplateId,
  format,
  ctx,
  reqUser,
  templateVariantKey = ''
) {
  const { startDate, endDate } = ctx;

  const {
    overallTemplate,
    sourceRuns,
    buildWarnings
  } = resolveEligibleOverallTemplateForTarget({ student, selectedClassIds, overallTemplateId, ctx });
  const chosenTemplateId = clean(overallTemplate.id);
  studentAttendanceReportExportFormatService.assertSarExportFormatAllowed(
    ctx.policy,
    'overall',
    chosenTemplateId,
    format
  );

  const variantKey = overallReportService.resolveOverallTemplateVariantKey(
    overallTemplate,
    templateVariantKey,
    'default'
  );

  const pipeline = await overallReportGenerationEngineService.generateOverallPipeline({
    filterStartDate: startDate,
    filterEndDate: endDate,
    studentIds: [clean(student.personId)],
    sourceRuns,
    overallTemplateId: chosenTemplateId,
    format: format === 'json' ? 'json' : (format === 'pdf' ? 'pdf' : 'docx'),
    docxMode: 'single',
    selectedDocxKey: variantKey,
    selectedPdfKey: variantKey,
    exportBatchCache: ctx?.exportBatchCache || null
  }, reqUser);

  const overall = pipeline.overall || {};
  const mergedWarnings = [
    ...buildWarnings,
    ...(pipeline.sourceBatch?.warnings || []),
    ...(overall.warnings || [])
  ];

  if (format === 'json') {
    const buffer = Buffer.from(JSON.stringify({ status: 'success', overall }, null, 2), 'utf8');
    return {
      buffer,
      contentType: 'application/json',
      fileName: `${safeFileToken(`${student.name || student.personId}_${overallTemplate.title || chosenTemplateId}`)}_overall_payload.json`,
      warnings: mergedWarnings
    };
  }

  if (format === 'pdf') {
    if (overall.file?.buffer) {
      return {
        buffer: overall.file.buffer,
        contentType: overall.contentType || 'application/pdf',
        fileName: overall.file.fileName || `${safeFileToken(`${student.name || student.personId}_${overallTemplate.title || chosenTemplateId}`)}_overall.pdf`,
        warnings: mergedWarnings
      };
    }
    if (overall.buffer) {
      return {
        buffer: overall.buffer,
        contentType: overall.contentType || 'application/pdf',
        fileName: overall.fileName || `${safeFileToken(`${student.name || student.personId}_${overallTemplate.title || chosenTemplateId}`)}_overall.pdf`,
        warnings: mergedWarnings
      };
    }
    const error = new Error('Overall report engine did not produce a PDF file.');
    error.statusCode = 400;
    throw error;
  }

  if (overall.file?.buffer) {
    return {
      buffer: overall.file.buffer,
      contentType: overall.contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: overall.file.fileName || `${safeFileToken(`${student.name || student.personId}_${overallTemplate.title || chosenTemplateId}`)}_overall.docx`,
      warnings: mergedWarnings
    };
  }
  if (overall.buffer) {
    return {
      buffer: overall.buffer,
      contentType: overall.contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: overall.fileName || `${safeFileToken(`${student.name || student.personId}_${overallTemplate.title || chosenTemplateId}`)}_overall.docx`,
      warnings: mergedWarnings
    };
  }

  const error = new Error('Overall report engine did not produce a document.');
  error.statusCode = 400;
  throw error;
}

async function zipGenericFiles(files = []) {
  const entries = (Array.isArray(files) ? files : [])
    .filter((row) => row && row.buffer)
    .map((row, index) => ({
      fileName: safeFileToken(row.fileName || `export_${index + 1}`, `export_${index + 1}`),
      buffer: row.buffer
    }));
  if (!entries.length) {
    throw new Error('No files were available to zip.');
  }
  const JSZip = require('jszip');
  const zip = new JSZip();
  const usedNames = new Set();
  entries.forEach((entry, index) => {
    let name = entry.fileName;
    if (!name.includes('.')) name = `${name}.json`;
    if (usedNames.has(name.toLowerCase())) {
      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '.json';
      name = `${stem}_${index + 1}${ext}`;
    }
    usedNames.add(name.toLowerCase());
    zip.file(name, entry.buffer);
  });
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

async function bundleExportFiles(files, format, startDate, endDate, options = {}) {
  const warnings = files.flatMap((row) => row.warnings || []);
  if (!files.length) {
    const error = new Error('No export files were produced.');
    error.statusCode = 400;
    throw error;
  }

  const mergeDocuments = Boolean(options.mergeDocuments);
  const expectedTargetCount = Math.max(0, Number(options.expectedTargetCount) || 0);
  if (mergeDocuments && expectedTargetCount > 1 && files.length < expectedTargetCount) {
    const stats = reportDocxRenderService.summarizeDocxFileBuffers(files);
    const error = new Error(
      `Bulk merge expected ${expectedTargetCount} reports but only ${files.length} file(s) were produced (${stats.totalBytes} bytes total).`
    );
    error.statusCode = 500;
    throw error;
  }

  if (format === 'docx') {
    files.forEach((row, index) => {
      const buffer = resolveExportPartBuffer(row);
      if (!buffer) return;
      reportDocxRenderService.assertValidDocxPackage(buffer, row.fileName || `export part ${index + 1}`);
    });
  }

  if (files.length === 1) {
    const buffer = resolveExportPartBuffer(files[0]);
    return {
      buffer,
      contentType: files[0].contentType,
      fileName: files[0].fileName,
      warnings
    };
  }

  if (format === 'docx' && mergeDocuments) {
    const partBuffers = files.map((row) => resolveExportPartBuffer(row)).filter(Boolean);
    const scratchPaths = files.map((row) => clean(row?.scratchPath)).filter(Boolean);
    const stats = reportDocxRenderService.summarizeDocxFileBuffers(
      partBuffers.map((buffer, index) => ({ buffer, fileName: files[index]?.fileName }))
    );
    const mergeViaPaths = scratchPaths.length === partBuffers.length && scratchPaths.length > 1;
    const buffer = mergeViaPaths
      ? reportDocxRenderService.mergeReportInstanceDocxPaths(scratchPaths)
      : reportDocxRenderService.mergeReportInstanceDocxBuffers(partBuffers);
    reportDocxRenderService.assertValidDocxPackage(buffer, 'consolidated SAR export');
    const mergeRatio = stats.totalBytes > 0 ? buffer.length / stats.totalBytes : 1;
    if (mergeRatio < 0.35) {
      const error = new Error(
        'Merged DOCX is much smaller than the individual reports. This often happens when a funder template (e.g. WCB) uses section marks inside the document body.'
      );
      error.statusCode = 500;
      throw error;
    }
    return {
      buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: `student_attendance_overall_reports_${startDate}_${endDate}.docx`,
      warnings
    };
  }

  if (format === 'pdf' && mergeDocuments) {
    const buffer = await reportPdfRenderService.mergeReportInstancePdfBuffers(files.map((row) => row.buffer));
    return {
      buffer,
      contentType: 'application/pdf',
      fileName: `student_attendance_overall_reports_${startDate}_${endDate}.pdf`,
      warnings
    };
  }

  if (format === 'docx') {
    const zipBuffer = await reportDocxRenderService.zipReportInstanceDocxFiles(files);
    return {
      buffer: zipBuffer,
      contentType: 'application/zip',
      fileName: `student_attendance_reports_${startDate}_${endDate}.zip`,
      warnings
    };
  }

  if (format === 'pdf') {
    const zipBuffer = await reportPdfRenderService.zipReportInstancePdfFiles(files);
    return {
      buffer: zipBuffer,
      contentType: 'application/zip',
      fileName: `student_attendance_reports_${startDate}_${endDate}_pdf.zip`,
      warnings
    };
  }

  const zipBuffer = await zipGenericFiles(files);
  return {
    buffer: zipBuffer,
    contentType: 'application/zip',
    fileName: `student_attendance_payloads_${startDate}_${endDate}.zip`,
    warnings
  };
}

async function exportStudentAttendanceReportSelections(req, options = {}) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const format = clean(options.format || body.format).toLowerCase();
  if (!['json', 'docx', 'pdf'].includes(format)) {
    const error = new Error('Invalid export format. Use json, docx, or pdf.');
    error.statusCode = 400;
    throw error;
  }

  const targets = parseTargets(options.targets || body.targets);
  if (!targets.length) {
    const error = new Error('Select at least one report to export.');
    error.statusCode = 400;
    throw error;
  }

  const exportTimer = sarExportTimingService.createTimer('sar.exportStudentAttendanceReportSelections');
  const exportBatchCache = reportExportBatchCacheService.createExportBatchCache();
  const ctx = await loadGenerationContext(req, {
    ...options,
    skipAttendanceMatrix: options.skipAttendanceMatrix !== false,
    targetClassIds: collectTargetClassIds(targets)
  });
  exportTimer.mark('loadGenerationContext', { targetCount: targets.length });
  ctx.exportBatchCache = exportBatchCache;
  const studentMap = new Map(ctx.students.map((row) => [clean(row.personId), row]));
  const uploadStorage = requireCoreModule('MVC/services/uploadStorageService');
  const gatewayDocx = format === 'docx' && uploadStorage.isRailwayGatewayBackend();

  const jobId = clean(options.jobId);
  let scratchDir = null;
  if (jobId && format === 'docx') {
    scratchDir = path.join(os.tmpdir(), 'sar-export', jobId);
    fs.mkdirSync(scratchDir, { recursive: true });
  }

  try {
  let docxLoadPlan = { uniqueRefs: [], byStudent: [] };
  if (format === 'docx') {
    docxLoadPlan = await buildDocxTemplateLoadPlan(targets, ctx, studentMap, exportBatchCache, req.user);
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    if (onProgress) {
      onProgress({
        processed: 0,
        total: targets.length,
        phase: 'prewarm',
        templateCount: docxLoadPlan.uniqueRefs.length
      });
    }
    if (docxLoadPlan.uniqueRefs.length) {
      await reportExportBatchCacheService.prewarmDocxRefs(exportBatchCache, docxLoadPlan.uniqueRefs, {
        strict: gatewayDocx
      });
    } else {
      const classReportTemplate = await reportExportBatchCacheService.getOrLoadTemplate(
        exportBatchCache,
        clean(ctx.policy.reportTemplateId),
        req.user
      );
      const fallbackTemplates = [
        classReportTemplate,
        ...(Array.isArray(ctx.overallTemplates) ? ctx.overallTemplates : [])
      ].filter(Boolean);
      await reportExportBatchCacheService.prewarmDocxTemplates(exportBatchCache, fallbackTemplates, {
        strict: gatewayDocx
      });
    }
    exportTimer.mark('prewarm_complete', {
      uniqueTemplateRefs: docxLoadPlan.uniqueRefs.length
    });
  }

  const concurrency = parseExportConcurrency({ format });
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const totalTargets = targets.length;
  let processedTargets = 0;
  if (onProgress) {
    onProgress({ processed: 0, total: totalTargets, phase: 'export' });
  }

  const files = await runWithConcurrency(targets, concurrency, async (target) => {
    try {
      const type = clean(target?.type).toLowerCase();
      const studentId = clean(target?.studentId);
      const student = studentMap.get(studentId);
      if (!student) {
        const error = new Error(`Student ${studentId || '(unknown)'} was not found in the current selection.`);
        error.statusCode = 400;
        throw error;
      }

      if (type === 'class') {
        const classId = clean(target?.classId);
        if (!classId) {
          const error = new Error('Class export targets require classId.');
          error.statusCode = 400;
          throw error;
        }
        return exportClassTarget(student, classId, format, ctx, req.user, exportBatchCache, {
          docxKey: clean(target?.docxKey),
          pdfKey: clean(target?.pdfKey)
        });
      }

      if (type === 'overall') {
        const classIds = Array.isArray(target?.classIds)
          ? target.classIds.map((id) => clean(id)).filter(Boolean)
          : [];
        return exportOverallTarget(
          student,
          classIds,
          clean(target?.overallTemplateId),
          format,
          ctx,
          req.user,
          clean(target?.templateVariantKey)
        );
      }

      const error = new Error(`Unsupported export target type: ${type || '(empty)'}.`);
      error.statusCode = 400;
      throw error;
    } finally {
      processedTargets += 1;
      if (onProgress) {
        onProgress({ processed: processedTargets, total: totalTargets, phase: 'export' });
      }
    }
  });
  exportTimer.mark('targets_complete', { fileCount: files.length });

  const stagedFiles = scratchDir
    ? files.map((file, index) => stageExportFileToScratch({ file, index, scratchDir, format }))
    : files;

  const bundleMode = clean(body.bundleMode).toLowerCase();
  const mergeDocuments = bundleMode === 'merge' && (format === 'docx' || format === 'pdf');
  if (format === 'docx' && mergeDocuments) {
    const stats = reportDocxRenderService.summarizeDocxFileBuffers(stagedFiles);
    exportTimer.mark('bundle_prepare', stats);
  }
  const bundled = await bundleExportFiles(stagedFiles, format, ctx.startDate, ctx.endDate, {
    mergeDocuments,
    expectedTargetCount: targets.length
  });
  exportTimer.mark('bundle_complete');
  exportTimer.log({
    format,
    targetCount: targets.length,
    fileCount: stagedFiles.length,
    concurrency,
    docxTemplateRefs: docxLoadPlan.uniqueRefs.length
  });
  return bundled;
  } finally {
    removeSarExportScratchDir(scratchDir);
  }
}

async function generateDocxForStudentWithoutOverall(student, policy, startDate, endDate, reqUser) {
  const { sourceRuns, warnings } = buildSourceRunsForStudent({
    student,
    policy,
    overallTemplate: null,
    startDate,
    endDate
  });
  if (!sourceRuns.length) {
    const error = new Error(warnings[0] || 'No report source runs could be built for this student.');
    error.statusCode = 400;
    throw error;
  }

  const rendered = [];
  for (const run of sourceRuns) {
    const engineResult = await reportGenerationEngineService.generateReportOutput({
      ...run,
      format: 'docx',
      docxMode: 'single'
    }, {}, reqUser);
    if (engineResult.file?.buffer) {
      rendered.push(engineResult.file);
    } else if (engineResult.buffer) {
      rendered.push({
        buffer: engineResult.buffer,
        fileName: engineResult.fileName || `${clean(student.name || student.personId)}_report.docx`
      });
    }
    (engineResult.warnings || []).forEach((warning) => warnings.push(warning));
  }

  if (!rendered.length) {
    const error = new Error('Report engine did not produce any DOCX output.');
    error.statusCode = 400;
    throw error;
  }

  if (rendered.length === 1) {
    return {
      buffer: rendered[0].buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: rendered[0].fileName || `${clean(student.name || student.personId).replace(/[^\w.-]+/g, '_')}_attendance.docx`,
      warnings
    };
  }

  const zipBuffer = await reportDocxRenderService.zipReportInstanceDocxFiles(rendered);
  const safeName = clean(student.name || student.personId).replace(/[^\w.-]+/g, '_') || 'student';
  return {
    buffer: zipBuffer,
    contentType: 'application/zip',
    fileName: `${safeName}_attendance_reports.zip`,
    warnings
  };
}

async function generateDocxForStudentWithOverall(student, policy, overallTemplate, startDate, endDate, reqUser) {
  const { sourceRuns, warnings: buildWarnings } = buildSourceRunsForStudent({
    student,
    policy,
    overallTemplate,
    startDate,
    endDate
  });
  if (!sourceRuns.length) {
    const error = new Error(buildWarnings[0] || 'No source runs could be built for the overall report.');
    error.statusCode = 400;
    throw error;
  }

  const pipeline = await overallReportGenerationEngineService.generateOverallPipeline({
    filterStartDate: startDate,
    filterEndDate: endDate,
    studentIds: [student.personId],
    sourceRuns,
    overallTemplateId: clean(overallTemplate.id || policy.overallReportTemplateId),
    format: 'docx',
    docxMode: 'single'
  }, reqUser);

  const overall = pipeline.overall || {};
  const mergedWarnings = [
    ...buildWarnings,
    ...(pipeline.sourceBatch?.warnings || []),
    ...(overall.warnings || [])
  ];

  if (overall.file?.buffer) {
    return {
      buffer: overall.file.buffer,
      contentType: overall.contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: overall.file.fileName || `${clean(student.name || student.personId).replace(/[^\w.-]+/g, '_')}_overall.docx`,
      warnings: mergedWarnings
    };
  }
  if (overall.buffer) {
    return {
      buffer: overall.buffer,
      contentType: overall.contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: overall.fileName || `${clean(student.name || student.personId).replace(/[^\w.-]+/g, '_')}_overall.docx`,
      warnings: mergedWarnings
    };
  }

  const error = new Error('Overall report engine did not produce a document.');
  error.statusCode = 400;
  throw error;
}

async function generateStudentAttendanceReports(req, options = {}) {
  const ctx = await loadGenerationContext(req, options);
  const { policy, overallTemplate, students, startDate, endDate } = ctx;

  const warnings = [];
  const files = [];

  for (const student of students) {
    const file = overallTemplate
      ? await generateDocxForStudentWithOverall(student, policy, overallTemplate, startDate, endDate, req.user)
      : await generateDocxForStudentWithoutOverall(student, policy, startDate, endDate, req.user);
    (file.warnings || []).forEach((warning) => warnings.push(warning));
    files.push({
      studentId: student.personId,
      studentName: student.name,
      ...file
    });
  }

  if (files.length === 1) {
    return {
      buffer: files[0].buffer,
      contentType: files[0].contentType,
      fileName: files[0].fileName,
      warnings,
      students: files.map((row) => ({
        studentId: row.studentId,
        studentName: row.studentName,
        fileName: row.fileName
      }))
    };
  }

  const zipEntries = files.map((row) => ({
    buffer: row.buffer,
    fileName: row.fileName
  }));
  const zipBuffer = await reportDocxRenderService.zipReportInstanceDocxFiles(zipEntries);
  return {
    buffer: zipBuffer,
    contentType: 'application/zip',
    fileName: `student_attendance_reports_${startDate}_${endDate}.zip`,
    warnings,
    students: files.map((row) => ({
      studentId: row.studentId,
      studentName: row.studentName,
      fileName: row.fileName
    }))
  };
}

module.exports = {
  sortClasses,
  parseTargets,
  buildSourceRunsForStudent,
  buildClassExportRowsForStudent,
  buildOverallExportBlock,
  buildOverallExportOptions,
  applyOverallTemplateVariantToOption,
  enrichOverallExportOptionsForStudent,
  enrichClassExportRowsWithFunderSuggestions,
  buildStudentAttendanceReportExportPlan,
  exportClassTarget,
  buildDocxTemplateLoadPlan,
  exportStudentAttendanceReportSelections,
  generateStudentAttendanceReports,
  bundleExportFiles
};
