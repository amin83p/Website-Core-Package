'use strict';

const schoolDataService = require('./schoolDataService');
const semiMonthlyReportPolicyModel = require('../../models/school/semiMonthlyReportPolicyModel');
const semiMonthlyReportPolicyService = require('./semiMonthlyReportPolicyService');
const schoolSemiMonthlyReportService = require('./schoolSemiMonthlyReportService');
const studentAttendanceReportGenerationService = require('./studentAttendanceReportGenerationService');
const studentAttendanceReportExportFormatService = require('./studentAttendanceReportExportFormatService');
const overallReportGenerationEngineService = require('./overallReportGenerationEngineService');
const overallReportService = require('./overallReportService');
const reportIntegrityService = require('./reportIntegrityService');
const reportViewService = require('./reportViewService');
const reportService = require('./reportService');
const reportDocxRenderService = require('./reportDocxRenderService');
const reportPdfRenderService = require('./reportPdfRenderService');
const reportFunderDocxService = require('./reportFunderDocxService');
const reportFunderPdfService = require('./reportFunderPdfService');

const {
  sortClasses,
  enrichOverallExportOptionsForStudent
} = studentAttendanceReportGenerationService;
const { runWithConcurrency } = require('../../utils/asyncPool');

function clean(value = '') {
  return String(value ?? '').trim();
}

function safeFileToken(value = '', fallback = 'export') {
  const token = clean(value).replace(/[^\w.-]+/g, '_').slice(0, 60);
  return token || fallback;
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

function isOptionalSlot(slot = {}) {
  return String(slot?.requirement || 'necessary').trim().toLowerCase() === 'optional';
}

function sortOverallSlots(overallTemplate = null) {
  if (!overallTemplate || !Array.isArray(overallTemplate.sourceSlots)) return [];
  return [...overallTemplate.sourceSlots].sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
}

function buildOverallSlotSummaries(overallTemplate = null) {
  return sortOverallSlots(overallTemplate).map((slot, index) => ({
    slotKey: clean(slot.slotKey).toUpperCase(),
    slotIndex: index,
    templateId: clean(slot.templateId),
    requirement: isOptionalSlot(slot) ? 'optional' : 'necessary'
  }));
}

function normalizeDateOnly(value = '') {
  return schoolSemiMonthlyReportService.normalizeDateOnly(value);
}

function templateIdAllowedForSlot(slot = {}, policy = {}, templateId = '') {
  const slotTemplateId = clean(slot.templateId);
  const instanceTemplateId = clean(templateId);
  if (!instanceTemplateId) return false;
  if (slotTemplateId) return instanceTemplateId === slotTemplateId;
  const allowed = semiMonthlyReportPolicyService.normalizeIdList(policy.reportTemplateIds);
  return allowed.some((id) => clean(id).toLowerCase() === instanceTemplateId.toLowerCase());
}

function pickLatestInstance(instances = [], slot = {}, policy = {}) {
  const rows = (Array.isArray(instances) ? instances : [])
    .filter((row) => clean(row?.id) && templateIdAllowedForSlot(slot, policy, row.templateId))
    .sort((a, b) => {
      const aDate = normalizeDateOnly(a.sessionDate);
      const bDate = normalizeDateOnly(b.sessionDate);
      if (aDate !== bDate) return bDate.localeCompare(aDate);
      return clean(b.id).localeCompare(clean(a.id));
    });
  return rows[0] || null;
}

function buildInstanceCandidatePool(student = {}) {
  const pool = [];
  sortClasses(student.classes).forEach((classRow) => {
    (Array.isArray(classRow.instances) ? classRow.instances : []).forEach((instance) => {
      const instanceId = clean(instance.id);
      if (!instanceId) return;
      pool.push({
        id: instanceId,
        instanceId,
        templateId: clean(instance.templateId),
        sessionDate: normalizeDateOnly(instance.sessionDate),
        classId: clean(classRow.classId),
        className: clean(classRow.className) || clean(classRow.classId),
        templateTitle: clean(instance.templateLabel) || clean(instance.templateId),
        status: clean(instance.status)
      });
    });
  });
  return pool;
}

function resolveInstanceIdOverride(instanceIdsBySlot = {}, slot = {}, index = 0) {
  const slotKey = clean(slot.slotKey).toUpperCase();
  return clean(
    instanceIdsBySlot[slotKey]
    || instanceIdsBySlot[slot.slotKey]
    || instanceIdsBySlot[String(index)]
    || instanceIdsBySlot[index]
  );
}

function resolveOverallSlotAssignments(student = {}, policy = {}, overallTemplate = null, instanceIdsBySlot = {}) {
  const slots = sortOverallSlots(overallTemplate);
  const pool = buildInstanceCandidatePool(student);
  const usedInstanceIds = new Set();
  const slotAssignments = [];
  const missingSlots = [];
  const warnings = [];
  const matchedInstanceIds = [];
  const matchedClassIds = [];

  slots.forEach((slot, index) => {
    const optional = isOptionalSlot(slot);
    const slotKey = clean(slot.slotKey).toUpperCase();
    const available = pool.filter((candidate) => (
      !usedInstanceIds.has(candidate.instanceId)
      && templateIdAllowedForSlot(slot, policy, candidate.templateId)
    ));
    const instanceOptions = available.map((candidate) => ({
      instanceId: candidate.instanceId,
      sessionDate: candidate.sessionDate,
      templateId: candidate.templateId,
      templateTitle: candidate.templateTitle,
      classId: candidate.classId,
      className: candidate.className,
      status: candidate.status
    }));

    const overrideId = resolveInstanceIdOverride(instanceIdsBySlot, slot, index);
    let selected = null;
    if (overrideId) {
      selected = available.find((row) => row.instanceId === overrideId)
        || pool.find((row) => (
          row.instanceId === overrideId
          && templateIdAllowedForSlot(slot, policy, row.templateId)
          && !usedInstanceIds.has(row.instanceId)
        ))
        || null;
      if (!selected && !optional) {
        missingSlots.push(slotKey || String(index + 1));
        warnings.push(`Selected instance for slot ${slot.slotKey || index + 1} is not valid.`);
      }
    } else {
      const picked = pickLatestInstance(available, slot, policy);
      selected = picked
        ? available.find((row) => row.instanceId === clean(picked.id)) || null
        : null;
    }

    const assignment = {
      slotKey,
      slotIndex: index,
      slotTemplateId: clean(slot.templateId),
      selectedInstanceId: '',
      templateId: '',
      templateTitle: '',
      classId: '',
      className: '',
      instanceOptions
    };

    if (selected) {
      usedInstanceIds.add(selected.instanceId);
      assignment.selectedInstanceId = selected.instanceId;
      assignment.templateId = selected.templateId;
      assignment.templateTitle = selected.templateTitle;
      assignment.classId = selected.classId;
      assignment.className = selected.className;
      matchedInstanceIds.push(selected.instanceId);
      if (selected.classId) matchedClassIds.push(selected.classId);
    } else if (!optional) {
      missingSlots.push(slotKey || String(index + 1));
      warnings.push(`No report instance for slot ${slot.slotKey || index + 1}.`);
    }

    slotAssignments.push(assignment);
  });

  return {
    slotAssignments,
    missingSlots,
    warnings,
    matchedInstanceIds,
    matchedClassIds
  };
}

function buildClassRowsForOverall(student = {}, policy = {}) {
  const classes = sortClasses(student.classes);
  return classes.map((classRow, index) => {
    const instances = Array.isArray(classRow.instances) ? classRow.instances : [];
    const defaultInstance = instances.length === 1
      ? instances[0]
      : pickLatestInstance(instances, {}, policy);
    const selectedInstanceId = clean(defaultInstance?.id);
    const templateId = clean(defaultInstance?.templateId);
    return {
      classId: clean(classRow.classId),
      className: clean(classRow.className) || clean(classRow.classId),
      slotIndex: index,
      templateId,
      templateTitle: clean(defaultInstance?.templateLabel) || templateId,
      selectedInstanceId,
      instanceOptions: instances.map((row) => ({
        instanceId: clean(row.id),
        sessionDate: normalizeDateOnly(row.sessionDate),
        templateId: clean(row.templateId),
        templateTitle: clean(row.templateLabel) || clean(row.templateId),
        status: clean(row.status)
      })),
      exportable: Boolean(selectedInstanceId)
    };
  });
}

function buildSmmrOverallExportBlock(student, policy, overallTemplate) {
  if (!overallTemplate) return null;

  const slots = sortOverallSlots(overallTemplate);
  const slotSummaries = buildOverallSlotSummaries(overallTemplate);
  const necessarySlots = slots.filter((slot) => !isOptionalSlot(slot));
  const {
    slotAssignments,
    missingSlots,
    warnings,
    matchedInstanceIds,
    matchedClassIds
  } = resolveOverallSlotAssignments(student, policy, overallTemplate);
  const templateId = clean(overallTemplate.id || policy.overallReportTemplateId);
  const templateTitle = clean(overallTemplate.title) || templateId;

  const eligible = slots.length > 0 && (necessarySlots.length === 0 || missingSlots.length === 0);
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
    matchedInstanceIds,
    slots: slotSummaries,
    necessarySlotCount: necessarySlots.length,
    slotCount: slots.length,
    slotAssignments
  };
}

function buildSmmrOverallExportOptions(student, policy, overallTemplates = []) {
  return (Array.isArray(overallTemplates) ? overallTemplates : [])
    .map((template) => buildSmmrOverallExportBlock(student, policy, template))
    .filter(Boolean);
}

function collectUniqueClassIdsFromStudents(students = []) {
  const ids = new Set();
  (Array.isArray(students) ? students : []).forEach((student) => {
    sortClasses(student.classes).forEach((classRow) => {
      const classId = clean(classRow.classId);
      if (classId) ids.add(classId);
    });
  });
  return [...ids];
}

async function loadPeriodRowsByClassIdMap(classIds = [], reqUser) {
  const map = new Map();
  const uniqueIds = [...new Set((Array.isArray(classIds) ? classIds : []).map((id) => clean(id)).filter(Boolean))];
  if (!uniqueIds.length) return map;
  await runWithConcurrency(uniqueIds, 6, async (classId) => {
    const rows = await schoolDataService.getClassEnrollmentPeriodsByClassId(classId, reqUser).catch(() => []);
    map.set(classId, Array.isArray(rows) ? rows : []);
  });
  return map;
}

function resolveStudentFunderContext(student, periodRowsByClassId, startDate, endDate) {
  const periodRows = [];
  sortClasses(student.classes).forEach((classRow) => {
    const rows = periodRowsByClassId instanceof Map ? periodRowsByClassId.get(clean(classRow.classId)) : null;
    if (Array.isArray(rows)) periodRows.push(...rows);
  });
  return reportFunderDocxService.resolveStudentFunderForReportPeriod({
    periodRows,
    personId: clean(student.personId),
    studentId: clean(student.studentRecordId),
    windowStart: startDate,
    windowEnd: endDate
  });
}

function applyPreviewInstanceExportKeys(instanceRows, student, templateMetaMap, periodRowsByClassId, startDate, endDate) {
  const funder = resolveStudentFunderContext(student, periodRowsByClassId, startDate, endDate);
  const funderKey = funder.funderKey || '';
  return (Array.isArray(instanceRows) ? instanceRows : []).map((row) => {
    if (!row?.exportable) {
      return { ...row, suggestedDocxKey: '', suggestedPdfKey: '', funderLabel: '' };
    }
    const meta = templateMetaMap.get(clean(row.templateId)) || {};
    const template = meta.template || null;
    return {
      ...row,
      suggestedDocxKey: template
        ? reportFunderDocxService.suggestDocxKeyForFunder({ template, funderKey })
        : 'default',
      suggestedPdfKey: template
        ? reportFunderPdfService.suggestPdfKeyForFunder({ template, funderKey })
        : 'default',
      funderLabel: clean(funder.funderLabel) || ''
    };
  });
}

function buildExportPlanSummaries(templateIds, templateMetaMap, policy, overallTemplates) {
  const reportTemplateSummaries = templateIds.map((templateId) => {
    const meta = templateMetaMap.get(templateId) || {};
    const effective = studentAttendanceReportExportFormatService.resolveEffectiveClassExportFlags(
      policy,
      templateId,
      meta
    );
    return {
      id: templateId,
      title: meta.templateTitle || templateId,
      hasDocx: effective.hasDocx,
      hasPdf: effective.hasPdf,
      hasPayload: effective.hasPayload
    };
  });

  const overallTemplateSummaries = (Array.isArray(overallTemplates) ? overallTemplates : []).map((template) => {
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

  return { reportTemplateSummaries, overallTemplateSummaries };
}

function finalizeExportPlanShape({
  startDate,
  endDate,
  templateIds,
  policy,
  reportTemplateSummaries,
  overallTemplateSummaries,
  planStudents
}) {
  return {
    startDate,
    endDate,
    reportTemplateIds: templateIds,
    reportTemplates: reportTemplateSummaries,
    overallReportTemplateIds: policy.overallReportTemplateIds || [],
    overallReportTemplates: overallTemplateSummaries,
    overallBulkExportFormats: {
      hasDocx: overallTemplateSummaries.some((row) => row.hasDocx),
      hasPdf: overallTemplateSummaries.some((row) => row.hasPdf),
      hasPayload: overallTemplateSummaries.some((row) => row.hasPayload !== false)
    },
    students: planStudents
  };
}

async function loadTemplateMetaMap(templateIds = [], reqUser, policy = {}) {
  const map = new Map();
  const uniqueIds = [...new Set(templateIds.map((id) => clean(id)).filter(Boolean))];
  await Promise.all(uniqueIds.map(async (templateId) => {
    const template = await schoolDataService.getDataById('reportTemplates', templateId, reqUser);
    if (!template) return;
    const rawMeta = {
      templateTitle: semiMonthlyReportPolicyService.formatTemplateLabel(template, templateId),
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
      docxOptions: reportFunderDocxService.buildAvailableDocxOptions(template),
      pdfOptions: reportFunderPdfService.buildAvailablePdfOptions(template),
      template
    });
  }));
  return map;
}

async function loadExportContext(req, options = {}) {
  const activeOrgId = clean(req.user?.activeOrgId);
  if (!activeOrgId) {
    const error = new Error('Select an active organization before exporting reports.');
    error.statusCode = 400;
    throw error;
  }

  const policy = semiMonthlyReportPolicyService.resolvePolicy(
    await semiMonthlyReportPolicyModel.getPolicyForOrg(activeOrgId)
  );
  if (!semiMonthlyReportPolicyService.normalizeIdList(policy.reportTemplateIds).length) {
    const error = new Error('Configure report templates in School Settings before exporting.');
    error.statusCode = 400;
    throw error;
  }

  const overallTemplates = await semiMonthlyReportPolicyService.assertOverallTemplatesAccessible(
    policy.overallReportTemplateIds,
    req.user
  );
  const overallTemplateMap = new Map(overallTemplates.map((template) => [clean(template.id), template]));
  const payload = options.existingPayload
    && typeof options.existingPayload === 'object'
    ? options.existingPayload
    : await schoolSemiMonthlyReportService.buildSemiMonthlyReportPayload(req, options);
  const students = Array.isArray(payload.students) ? payload.students : [];
  if (!students.length) {
    const error = new Error('No students matched the current filters.');
    error.statusCode = 400;
    throw error;
  }

  return {
    policy,
    overallTemplates,
    overallTemplateMap,
    payload,
    students,
    startDate: payload.startDate,
    endDate: payload.endDate
  };
}

function flattenInstanceRows(student, templateMetaMap, policy) {
  const personId = clean(student.personId);
  const rows = [];
  sortClasses(student.classes).forEach((classRow) => {
    (Array.isArray(classRow.instances) ? classRow.instances : []).forEach((instance) => {
      const instanceId = clean(instance.id);
      const templateId = clean(instance.templateId);
      const meta = templateMetaMap.get(templateId) || {};
      const effective = studentAttendanceReportExportFormatService.resolveEffectiveClassExportFlags(
        policy,
        templateId,
        {
          hasDocx: Boolean(meta.hasDocx),
          hasPdf: Boolean(meta.hasPdf)
        }
      );
      const exportable = Boolean(instanceId)
        && (effective.hasDocx || effective.hasPdf || effective.hasPayload);
      rows.push({
        instanceId,
        templateId,
        templateTitle: meta.templateTitle || clean(instance.templateLabel) || templateId,
        sessionDate: normalizeDateOnly(instance.sessionDate),
        status: clean(instance.status),
        assignmentId: clean(instance.assignmentId),
        classId: clean(classRow.classId),
        className: clean(classRow.className) || clean(classRow.classId),
        hasDocx: effective.hasDocx,
        hasPdf: effective.hasPdf,
        hasPayload: effective.hasPayload,
        docxOptions: Array.isArray(meta.docxOptions) ? meta.docxOptions : [],
        pdfOptions: Array.isArray(meta.pdfOptions) ? meta.pdfOptions : [],
        exportable
      });
    });
  });
  return rows;
}

async function enrichInstanceRowsForExport(student, instanceRows = [], options = {}) {
  const {
    startDate = '',
    endDate = '',
    reqUser,
    periodRowsByClassId = null,
    sharedCaches = null
  } = options;
  const rows = Array.isArray(instanceRows) ? instanceRows : [];
  const studentRecordId = clean(student?.studentRecordId);
  const personId = clean(student?.personId);
  const studentName = clean(student?.name) || personId;
  const templateCache = sharedCaches?.templateCache || new Map();
  const assignmentCache = sharedCaches?.assignmentCache || new Map();
  const instanceCache = sharedCaches?.instanceCache || new Map();
  const suggestionCache = sharedCaches?.suggestionCache || new Map();
  const orgId = clean(reqUser?.activeOrgId);
  let funderOptionsPromise = sharedCaches?.funderOptionsPromise || null;
  if (!funderOptionsPromise && orgId) {
    funderOptionsPromise = reportFunderDocxService.loadActiveFunderOptions(reqUser, orgId).catch(() => []);
    if (sharedCaches) sharedCaches.funderOptionsPromise = funderOptionsPromise;
  }

  const periodRowsForClass = (classId) => {
    if (periodRowsByClassId instanceof Map) {
      return periodRowsByClassId.get(clean(classId)) || [];
    }
    return [];
  };

  async function resolveSuggestionForGroup(groupRows = [], template, effectiveAssignment) {
    if (!template || !groupRows.length) return new Map();
    const groupKey = [
      clean(template.id),
      clean(effectiveAssignment?.id || effectiveAssignment?.assignmentId),
      clean(groupRows[0]?.classId)
    ].join('|');
    if (suggestionCache.has(groupKey)) {
      return suggestionCache.get(groupKey);
    }
    const classId = clean(groupRows[0]?.classId);
    const periodRows = periodRowsForClass(classId);
    const funderOptions = funderOptionsPromise ? await funderOptionsPromise : [];
    const suggestionStudent = {
      studentId: studentRecordId,
      personId,
      studentName
    };
    const [docxSuggestions, pdfSuggestions] = await Promise.all([
      reportFunderDocxService.buildExportDocxSuggestions({
        template,
        assignment: effectiveAssignment,
        reqUser,
        windowStart: startDate,
        windowEnd: endDate,
        students: [suggestionStudent],
        cachedPeriodRows: periodRows,
        cachedFunderOptions: funderOptions
      }).catch(() => ({ rows: [] })),
      reportFunderPdfService.buildExportPdfSuggestions({
        template,
        assignment: effectiveAssignment,
        reqUser,
        windowStart: startDate,
        windowEnd: endDate,
        students: [suggestionStudent],
        cachedPeriodRows: periodRows,
        cachedFunderOptions: funderOptions
      }).catch(() => ({ rows: [] }))
    ]);
    const docxRow = (docxSuggestions.rows || [])[0] || {};
    const pdfRow = (pdfSuggestions.rows || [])[0] || {};
    const resolved = {
      suggestedDocxKey: clean(docxRow.suggestedDocxKey)
        || reportFunderDocxService.suggestDocxKeyForFunder({ template, funderKey: docxRow.funderKey }),
      suggestedPdfKey: clean(pdfRow.suggestedPdfKey)
        || reportFunderPdfService.suggestPdfKeyForFunder({ template, funderKey: pdfRow.funderKey }),
      funderLabel: clean(docxRow.funderLabel)
    };
    suggestionCache.set(groupKey, resolved);
    return resolved;
  }

  const exportableRows = rows.filter((row) => row?.exportable);
  const groups = new Map();
  exportableRows.forEach((row) => {
    const groupKey = [
      clean(row.templateId),
      clean(row.assignmentId),
      clean(row.classId)
    ].join('|');
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
  });

  const groupSuggestionByKey = new Map();
  await runWithConcurrency([...groups.entries()], 4, async ([groupKey, groupRows]) => {
    const templateId = clean(groupRows[0]?.templateId);
    let template = templateCache.get(templateId);
    if (!template && templateId) {
      template = await schoolDataService.getDataById('reportTemplates', templateId, reqUser);
      templateCache.set(templateId, template);
    }
    const sampleRow = groupRows[0];
    const instanceId = clean(sampleRow?.instanceId);
    let instanceRecord = instanceCache.get(instanceId);
    if (!instanceRecord && instanceId) {
      instanceRecord = await schoolDataService.getDataById('reportInstances', instanceId, reqUser);
      instanceCache.set(instanceId, instanceRecord);
    }
    const assignmentId = clean(sampleRow?.assignmentId || instanceRecord?.assignmentId);
    let assignment = assignmentCache.get(assignmentId);
    if (!assignment && assignmentId) {
      assignment = await schoolDataService.getDataById('reportAssignments', assignmentId, reqUser);
      assignmentCache.set(assignmentId, assignment);
    }
    const effectiveAssignment = reportViewService.applyAssignmentRow(
      assignment,
      reportViewService.findAssignmentRow(assignment, instanceRecord?.assignmentRowId || '')
    );
    const assignmentForSuggestion = effectiveAssignment && typeof effectiveAssignment === 'object'
      ? {
        ...effectiveAssignment,
        classId: clean(effectiveAssignment.classId) || clean(sampleRow?.classId)
      }
      : { classId: clean(sampleRow?.classId) };
    const resolved = await resolveSuggestionForGroup(groupRows, template, assignmentForSuggestion);
    groupSuggestionByKey.set(groupKey, { template, resolved });
  });

  return rows.map((row) => {
    if (!row?.exportable) return row;
    const groupKey = [
      clean(row.templateId),
      clean(row.assignmentId),
      clean(row.classId)
    ].join('|');
    const groupData = groupSuggestionByKey.get(groupKey) || {};
    const template = groupData.template || templateCache.get(clean(row.templateId));
    const resolved = groupData.resolved || {};
    const docxOptions = Array.isArray(row.docxOptions) && row.docxOptions.length
      ? row.docxOptions
      : (template ? reportFunderDocxService.buildAvailableDocxOptions(template) : []);
    const pdfOptions = Array.isArray(row.pdfOptions) && row.pdfOptions.length
      ? row.pdfOptions
      : (template ? reportFunderPdfService.buildAvailablePdfOptions(template) : []);
    return {
      ...row,
      docxOptions,
      pdfOptions,
      suggestedDocxKey: resolved.suggestedDocxKey || '',
      suggestedPdfKey: resolved.suggestedPdfKey || '',
      funderLabel: resolved.funderLabel || ''
    };
  });
}

async function buildPlanStudentsFromContext(
  ctx,
  reqUser,
  templateMetaMap,
  periodRowsByClassId,
  enrichMode = 'preview',
  instanceIdsToEnrich = null
) {
  const { policy, overallTemplates, students, startDate, endDate } = ctx;
  const enrichSet = instanceIdsToEnrich instanceof Set ? instanceIdsToEnrich : null;
  const sharedCaches = (enrichMode === 'full' || (enrichSet && enrichSet.size))
    ? {
      templateCache: new Map(),
      assignmentCache: new Map(),
      instanceCache: new Map(),
      suggestionCache: new Map()
    }
    : null;
  const planStudents = [];

  for (const student of students) {
    let overallOptions = buildSmmrOverallExportOptions(student, policy, overallTemplates);
    const classRows = sortClasses(student.classes).map((classRow) => ({
      classId: clean(classRow.classId)
    }));
    // eslint-disable-next-line no-await-in-loop
    overallOptions = await enrichOverallExportOptionsForStudent({
      student,
      classRows,
      overallOptions,
      overallTemplates,
      policy,
      startDate,
      endDate,
      reqUser,
      periodRowsByClassId
    });
    const overall = overallOptions.find((option) => option.eligible) || overallOptions[0] || null;
    const instanceRows = flattenInstanceRows(student, templateMetaMap, policy);

    let instances;
    if (enrichMode === 'full') {
      // eslint-disable-next-line no-await-in-loop
      instances = await enrichInstanceRowsForExport(student, instanceRows, {
        startDate,
        endDate,
        reqUser,
        periodRowsByClassId,
        sharedCaches
      });
    } else if (enrichSet && enrichSet.size) {
      const rowsToEnrich = instanceRows.filter((row) => (
        row.exportable && enrichSet.has(clean(row.instanceId))
      ));
      // eslint-disable-next-line no-await-in-loop
      const enrichedRows = rowsToEnrich.length
        ? await enrichInstanceRowsForExport(student, rowsToEnrich, {
          startDate,
          endDate,
          reqUser,
          periodRowsByClassId,
          sharedCaches
        })
        : [];
      const enrichedById = new Map(enrichedRows.map((row) => [clean(row.instanceId), row]));
      const previewRows = applyPreviewInstanceExportKeys(
        instanceRows,
        student,
        templateMetaMap,
        periodRowsByClassId,
        startDate,
        endDate
      );
      instances = previewRows.map((row) => enrichedById.get(clean(row.instanceId)) || row);
    } else {
      instances = applyPreviewInstanceExportKeys(
        instanceRows,
        student,
        templateMetaMap,
        periodRowsByClassId,
        startDate,
        endDate
      );
    }

    planStudents.push({
      personId: clean(student.personId),
      studentRecordId: clean(student.studentRecordId),
      name: clean(student.name) || clean(student.personId),
      instances,
      overall,
      overallOptions
    });
  }

  return planStudents;
}

async function buildSemiMonthlyReportExportPreview(req, options = {}) {
  const ctx = options.existingContext || await loadExportContext(req, options);
  const { policy, overallTemplates, students, startDate, endDate } = ctx;
  const templateIds = semiMonthlyReportPolicyService.normalizeIdList(policy.reportTemplateIds);
  const templateMetaMap = await loadTemplateMetaMap(templateIds, req.user, policy);
  const periodRowsByClassId = await loadPeriodRowsByClassIdMap(
    collectUniqueClassIdsFromStudents(students),
    req.user
  );
  const planStudents = await buildPlanStudentsFromContext(
    ctx,
    req.user,
    templateMetaMap,
    periodRowsByClassId,
    'preview'
  );
  const { reportTemplateSummaries, overallTemplateSummaries } = buildExportPlanSummaries(
    templateIds,
    templateMetaMap,
    policy,
    overallTemplates
  );
  return finalizeExportPlanShape({
    startDate,
    endDate,
    templateIds,
    policy,
    reportTemplateSummaries,
    overallTemplateSummaries,
    planStudents
  });
}

async function buildSemiMonthlyReportExportPlan(req, options = {}) {
  const ctx = options.existingContext || await loadExportContext(req, options);
  const { policy, overallTemplates, students, startDate, endDate } = ctx;
  const templateIds = semiMonthlyReportPolicyService.normalizeIdList(policy.reportTemplateIds);
  const templateMetaMap = await loadTemplateMetaMap(templateIds, req.user, policy);
  const periodRowsByClassId = await loadPeriodRowsByClassIdMap(
    collectUniqueClassIdsFromStudents(students),
    req.user
  );
  const enrichMode = options.enrichMode === 'full' ? 'full' : 'targeted';
  const instanceIdsToEnrich = options.instanceIdsToEnrich instanceof Set
    ? options.instanceIdsToEnrich
    : null;
  const planStudents = await buildPlanStudentsFromContext(
    ctx,
    req.user,
    templateMetaMap,
    periodRowsByClassId,
    enrichMode === 'full' ? 'full' : 'targeted',
    instanceIdsToEnrich
  );

  const { reportTemplateSummaries, overallTemplateSummaries } = buildExportPlanSummaries(
    templateIds,
    templateMetaMap,
    policy,
    overallTemplates
  );

  return finalizeExportPlanShape({
    startDate,
    endDate,
    templateIds,
    policy,
    reportTemplateSummaries,
    overallTemplateSummaries,
    planStudents
  });
}

async function exportStoredInstance(instanceId, format, reqUser, options = {}) {
  const instance = await reportIntegrityService.getAccessibleInstanceOrThrow(instanceId, reqUser);
  const [template, assignment] = await Promise.all([
    schoolDataService.getDataById('reportTemplates', instance.templateId, reqUser),
    schoolDataService.getDataById('reportAssignments', instance.assignmentId, reqUser)
  ]);
  if (!template) throw new Error('Template not found.');

  const effectiveAssignment = reportViewService.applyAssignmentRow(
    assignment,
    reportViewService.findAssignmentRow(assignment, instance.assignmentRowId || '')
  );
  const token = clean(format).toLowerCase();

  if (token === 'docx') {
    if (!reportFunderDocxService.templateHasAnyDocx(template)) {
      throw new Error('This report template has no DOCX file configured.');
    }
    const exportPayload = await reportService.buildReportInstanceExportPayload({
      template,
      instance,
      assignment: effectiveAssignment,
      format: 'docx',
      reqUser
    });
    const resolved = reportFunderDocxService.resolveDocxTemplateForFunder({
      template,
      funderKey: clean(options.docxKey) || 'default'
    });
    const rendered = await reportDocxRenderService.renderReportInstanceDocx({
      template,
      instance,
      placeholders: exportPayload.placeholders,
      collections: exportPayload.collections,
      docxTemplateOverride: resolved.docxTemplate
    });
    return {
      buffer: rendered.buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: rendered.fileName
    };
  }

  if (token === 'pdf') {
    if (!reportFunderPdfService.templateHasAnyPdf(template)) {
      throw new Error('This report template has no PDF file configured.');
    }
    const exportPayload = await reportService.buildReportInstanceExportPayload({
      template,
      instance,
      assignment: effectiveAssignment,
      format: 'pdf',
      reqUser
    });
    const resolved = reportFunderPdfService.resolvePdfTemplateForFunder({
      template,
      funderKey: clean(options.pdfKey) || 'default'
    });
    const rendered = await reportPdfRenderService.renderReportInstancePdf({
      template,
      instance,
      placeholders: exportPayload.placeholders,
      mergedAnswers: exportPayload.mergedAnswers,
      pdfTemplateOverride: resolved.pdfTemplate
    });
    return {
      buffer: rendered.buffer,
      contentType: 'application/pdf',
      fileName: rendered.fileName
    };
  }

  const payload = await reportService.buildReportInstanceExportPayload({
    template,
    instance,
    assignment: effectiveAssignment,
    format: 'json',
    reqUser
  });
  const buffer = Buffer.from(JSON.stringify({ status: 'success', payload }, null, 2), 'utf8');
  return {
    buffer,
    contentType: 'application/json',
    fileName: `report-${instance.id}-payload.json`
  };
}

function resolveOverallOption(student, overallTemplateId, ctx) {
  const options = Array.isArray(student?.overallOptions) ? student.overallOptions : [];
  const chosenId = clean(overallTemplateId);
  const option = options.find((row) => clean(row?.templateId) === chosenId)
    || options.find((row) => row?.eligible)
    || options[0]
    || null;
  if (!option?.defined || !option.eligible) {
    const error = new Error(`Overall report is not eligible for ${student.name || student.personId}.`);
    error.statusCode = 400;
    throw error;
  }
  const overallTemplate = ctx.overallTemplateMap.get(clean(option.templateId));
  if (!overallTemplate) {
    const error = new Error('Overall report template was not found.');
    error.statusCode = 400;
    throw error;
  }
  return { overallTemplate, option };
}

function hasInstanceIdOverrides(instanceIdsBySlot = {}) {
  return Object.values(instanceIdsBySlot).some((value) => clean(value));
}

function buildSourceRunsForOverallTarget(fullStudent, overallTemplate, option, instanceIdsBySlot = {}, policy = {}) {
  const resolved = hasInstanceIdOverrides(instanceIdsBySlot) || !Array.isArray(option?.slotAssignments)
    ? resolveOverallSlotAssignments(fullStudent, policy, overallTemplate, instanceIdsBySlot)
    : {
      slotAssignments: option.slotAssignments,
      warnings: []
    };
  const runs = [];
  (resolved.slotAssignments || []).forEach((assignment) => {
    const instanceId = clean(assignment.selectedInstanceId);
    if (!instanceId) return;
    runs.push({
      slotKey: clean(assignment.slotKey).toUpperCase(),
      templateId: clean(assignment.templateId),
      classId: clean(assignment.classId),
      instanceId,
      studentId: clean(fullStudent.personId)
    });
  });

  const warnings = Array.isArray(resolved.warnings) ? resolved.warnings : [];
  if (!runs.length) {
    const error = new Error(warnings[0] || 'No source instances could be resolved for the overall report.');
    error.statusCode = 400;
    throw error;
  }

  return { sourceRuns: runs, warnings };
}

async function exportOverallTarget(
  planStudent,
  overallTemplateId,
  format,
  instanceIdsBySlot,
  ctx,
  reqUser,
  templateVariantKey = ''
) {
  const { startDate, endDate } = ctx;
  const { overallTemplate, option } = resolveOverallOption(planStudent, overallTemplateId, ctx);
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

  const fullStudent = ctx.students.find((row) => clean(row.personId) === clean(planStudent.personId)) || planStudent;
  const exportStudentLabel = clean(fullStudent.name || planStudent.name || fullStudent.personId || planStudent.personId);
  const exportPersonId = clean(fullStudent.personId || planStudent.personId);
  const { sourceRuns, warnings: buildWarnings } = buildSourceRunsForOverallTarget(
    fullStudent,
    overallTemplate,
    option,
    instanceIdsBySlot,
    ctx.policy
  );
  const sourceBatch = await overallReportGenerationEngineService.generateSourceBatchFromStoredInstances({
    filterStartDate: startDate,
    filterEndDate: endDate,
    sourceRuns
  }, reqUser);
  const overall = await overallReportGenerationEngineService.generateOverallFromSourceBatch({
    overallTemplateId: chosenTemplateId,
    sourceBatch,
    studentIds: [exportPersonId],
    format: format === 'json' ? 'json' : (format === 'pdf' ? 'pdf' : 'docx'),
    docxMode: 'single',
    selectedDocxKey: variantKey,
    selectedPdfKey: variantKey
  }, reqUser);

  const mergedWarnings = [
    ...buildWarnings,
    ...(sourceBatch.warnings || []),
    ...(overall.warnings || [])
  ];

  if (format === 'json') {
    const buffer = Buffer.from(JSON.stringify({ status: 'success', overall }, null, 2), 'utf8');
    return {
      buffer,
      contentType: 'application/json',
      fileName: `${safeFileToken(`${exportStudentLabel}_${overallTemplate.title || chosenTemplateId}`)}_overall_payload.json`,
      warnings: mergedWarnings
    };
  }

  if (format === 'pdf') {
    if (overall.file?.buffer) {
      return {
        buffer: overall.file.buffer,
        contentType: overall.contentType || 'application/pdf',
        fileName: overall.file.fileName || `${safeFileToken(`${exportStudentLabel}_${overallTemplate.title || chosenTemplateId}`)}_overall.pdf`,
        warnings: mergedWarnings
      };
    }
    if (overall.buffer) {
      return {
        buffer: overall.buffer,
        contentType: overall.contentType || 'application/pdf',
        fileName: overall.fileName || `${safeFileToken(`${exportStudentLabel}_${overallTemplate.title || chosenTemplateId}`)}_overall.pdf`,
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
      fileName: overall.file.fileName || `${safeFileToken(`${exportStudentLabel}_${overallTemplate.title || chosenTemplateId}`)}_overall.docx`,
      warnings: mergedWarnings
    };
  }
  if (overall.buffer) {
    return {
      buffer: overall.buffer,
      contentType: overall.contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: overall.fileName || `${safeFileToken(`${exportStudentLabel}_${overallTemplate.title || chosenTemplateId}`)}_overall.docx`,
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
  if (!entries.length) throw new Error('No files were available to zip.');
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

  if (files.length === 1) {
    return {
      buffer: files[0].buffer,
      contentType: files[0].contentType,
      fileName: files[0].fileName,
      warnings
    };
  }

  const mergeDocuments = Boolean(options.mergeDocuments);

  if (format === 'docx' && mergeDocuments) {
    const buffer = reportDocxRenderService.mergeReportInstanceDocxBuffers(files.map((row) => row.buffer));
    return {
      buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: `semi_monthly_overall_reports_${startDate}_${endDate}.docx`,
      warnings
    };
  }

  if (format === 'pdf' && mergeDocuments) {
    const buffer = await reportPdfRenderService.mergeReportInstancePdfBuffers(files.map((row) => row.buffer));
    return {
      buffer,
      contentType: 'application/pdf',
      fileName: `semi_monthly_overall_reports_${startDate}_${endDate}.pdf`,
      warnings
    };
  }

  if (format === 'docx') {
    const zipBuffer = await reportDocxRenderService.zipReportInstanceDocxFiles(files);
    return {
      buffer: zipBuffer,
      contentType: 'application/zip',
      fileName: `semi_monthly_reports_${startDate}_${endDate}.zip`,
      warnings
    };
  }

  if (format === 'pdf') {
    const zipBuffer = await reportPdfRenderService.zipReportInstancePdfFiles(files);
    return {
      buffer: zipBuffer,
      contentType: 'application/zip',
      fileName: `semi_monthly_reports_${startDate}_${endDate}_pdf.zip`,
      warnings
    };
  }

  const zipBuffer = await zipGenericFiles(files);
  return {
    buffer: zipBuffer,
    contentType: 'application/zip',
    fileName: `semi_monthly_payloads_${startDate}_${endDate}.zip`,
    warnings
  };
}

async function exportSemiMonthlyReportSelections(req, options = {}) {
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

  const ctx = await loadExportContext(req, options);
  const instanceIdsToEnrich = new Set();
  targets.forEach((target) => {
    if (clean(target?.type).toLowerCase() === 'instance') {
      const instanceId = clean(target?.instanceId);
      if (instanceId) instanceIdsToEnrich.add(instanceId);
    }
  });
  const plan = await buildSemiMonthlyReportExportPlan(req, {
    ...options,
    existingContext: ctx,
    enrichMode: 'targeted',
    instanceIdsToEnrich
  });
  const studentMap = new Map(ctx.students.map((row) => [clean(row.personId), row]));
  const planStudentMap = new Map(plan.students.map((row) => [clean(row.personId), row]));

  const exportJobs = targets.map((target) => async () => {
    const type = clean(target?.type).toLowerCase();
    const studentId = clean(target?.studentId);
    const student = studentMap.get(studentId);
    const planStudent = planStudentMap.get(studentId);
    if (!student || !planStudent) {
      const error = new Error(`Student ${studentId || '(unknown)'} was not found in the current selection.`);
      error.statusCode = 400;
      throw error;
    }

    if (type === 'instance') {
      const instanceId = clean(target?.instanceId);
      if (!instanceId) {
        const error = new Error('Instance export targets require instanceId.');
        error.statusCode = 400;
        throw error;
      }
      const instanceRow = (planStudent.instances || []).find((row) => clean(row.instanceId) === instanceId);
      if (!instanceRow || !instanceRow.exportable) {
        const error = new Error(`Instance ${instanceId} is not exportable for this student.`);
        error.statusCode = 400;
        throw error;
      }
      if (format === 'docx' && !instanceRow.hasDocx) return null;
      if (format === 'pdf' && !instanceRow.hasPdf) return null;
      if (format === 'json' && instanceRow.hasPayload === false) return null;
      studentAttendanceReportExportFormatService.assertSarExportFormatAllowed(
        ctx.policy,
        'report',
        clean(instanceRow.templateId),
        format
      );
      const docxKey = clean(target?.docxKey) || clean(instanceRow.suggestedDocxKey);
      const pdfKey = clean(target?.pdfKey) || clean(instanceRow.suggestedPdfKey);
      const rendered = await exportStoredInstance(instanceId, format, req.user, { docxKey, pdfKey });
      const stem = safeFileToken(`${student.name || studentId}_${instanceRow.className}_${instanceRow.sessionDate || instanceId}`);
      return {
        ...rendered,
        fileName: rendered.fileName || `${stem}.${format === 'json' ? 'json' : format}`,
        warnings: []
      };
    }

    if (type === 'overall') {
      const overallTemplateId = clean(target?.overallTemplateId);
      const instanceIdsBySlot = target?.instanceIdsBySlot && typeof target.instanceIdsBySlot === 'object'
        ? target.instanceIdsBySlot
        : {};
      return exportOverallTarget(
        planStudent,
        overallTemplateId,
        format,
        instanceIdsBySlot,
        ctx,
        req.user,
        clean(target?.templateVariantKey)
      );
    }

    const error = new Error(`Unsupported export target type: ${type || '(empty)'}.`);
    error.statusCode = 400;
    throw error;
  });

  const fileResults = await runWithConcurrency(exportJobs, 3, async (job) => job());
  const files = fileResults.filter(Boolean);

  if (!files.length) {
    const error = new Error('Select at least one report that supports this export format.');
    error.statusCode = 400;
    throw error;
  }

  const bundleMode = clean(body.bundleMode).toLowerCase();
  const mergeDocuments = bundleMode === 'merge' && (format === 'docx' || format === 'pdf');
  return bundleExportFiles(files, format, ctx.startDate, ctx.endDate, { mergeDocuments });
}

module.exports = {
  buildSemiMonthlyReportExportPlan,
  buildSemiMonthlyReportExportPreview,
  exportSemiMonthlyReportSelections,
  buildSmmrOverallExportBlock,
  buildClassRowsForOverall,
  resolveOverallSlotAssignments,
  flattenInstanceRows,
  applyPreviewInstanceExportKeys,
  enrichInstanceRowsForExport,
  exportStoredInstance,
  loadExportContext
};
