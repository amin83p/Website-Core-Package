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
const overallReportService = require('./overallReportService');
const studentAttendanceReportExportFormatService = require('./studentAttendanceReportExportFormatService');

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

async function loadGenerationContext(req, options = {}) {
  const activeOrgId = clean(req.user?.activeOrgId);
  if (!activeOrgId) {
    const error = new Error('Select an active organization before generating reports.');
    error.statusCode = 400;
    throw error;
  }

  const policy = studentAttendanceReportPolicyService.resolvePolicy(
    await studentAttendanceReportPolicyModel.getPolicyForOrg(activeOrgId)
  );
  if (!clean(policy.reportTemplateId)) {
    const error = new Error('Configure a report template in School Settings before generating reports.');
    error.statusCode = 400;
    throw error;
  }

  await studentAttendanceReportPolicyService.assertReportTemplateAccessible(policy.reportTemplateId, req.user);

  const overallTemplates = await studentAttendanceReportPolicyService.assertOverallTemplatesAccessible(policy.overallReportTemplateIds, req.user);
  const overallTemplate = overallTemplates[0] || null;
  const overallTemplateMap = new Map(overallTemplates.map((template) => [clean(template.id), template]));

  const payload = await studentAttendanceReportService.buildStudentAttendanceReportPayload(req, options);
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

async function loadTemplateMetaMap(templateIds = [], reqUser, policy = {}) {
  const map = new Map();
  const uniqueIds = [...new Set(templateIds.map((id) => clean(id)).filter(Boolean))];
  for (const templateId of uniqueIds) {
    const template = await schoolDataService.getDataById('reportTemplates', templateId, reqUser);
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
      ...effective
    });
  }
  return map;
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
    hasDocx: overallReportService.templateHasAttachedDocx(overallTemplate)
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

async function buildStudentAttendanceReportExportPlan(req, options = {}) {
  const ctx = await loadGenerationContext(req, options);
  const { policy, overallTemplates, students, startDate, endDate } = ctx;

  const templateIds = [policy.reportTemplateId];
  const templateMetaMap = await loadTemplateMetaMap(templateIds, req.user, policy);

  const planStudents = students.map((student) => {
    const classRows = buildClassExportRowsForStudent(student, policy, null, templateMetaMap);
    const overallOptions = buildOverallExportOptions(student, policy, overallTemplates, classRows);
    const overall = overallOptions.find((option) => option.eligible) || overallOptions[0] || null;
    return {
      personId: clean(student.personId),
      name: clean(student.name) || clean(student.personId),
      classes: classRows,
      overall,
      overallOptions
    };
  });

  const defaultReportMeta = templateMetaMap.get(clean(policy.reportTemplateId)) || {};
  const overallTemplateSummaries = overallTemplates.map((template) => {
    const templateId = clean(template.id);
    const rawOverallMeta = {
      hasDocx: overallReportService.templateHasAttachedDocx(template)
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
    overallReportTemplateId: clean(policy.overallReportTemplateId),
    overallReportTemplateIds: policy.overallReportTemplateIds || [],
    overallReportTemplateTitle: overallTemplateSummaries[0]?.title || '',
    overallReportTemplateTitleList: overallTemplateSummaries.map((row) => row.title).join(', '),
    overallReportTemplates: overallTemplateSummaries,
    overallBulkExportFormats: {
      hasDocx: overallTemplateSummaries.some((row) => row.hasDocx),
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

async function exportClassTarget(student, classId, format, ctx, reqUser) {
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
  const engineResult = await reportGenerationEngineService.generateReportOutput({
    templateId,
    classId: clean(classId),
    teacherId,
    reportStartDate: startDate,
    reportDueDate: endDate,
    reportScope: 'selected_students',
    targetStudentIds: [clean(student.personId)],
    format,
    docxMode: 'single'
  }, {}, reqUser);

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

async function exportOverallTarget(student, selectedClassIds, overallTemplateId, format, ctx, reqUser) {
  const { startDate, endDate } = ctx;
  if (format === 'pdf') {
    const error = new Error('Overall reports do not support PDF export.');
    error.statusCode = 400;
    throw error;
  }

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

  const pipeline = await overallReportGenerationEngineService.generateOverallPipeline({
    filterStartDate: startDate,
    filterEndDate: endDate,
    studentIds: [clean(student.personId)],
    sourceRuns,
    overallTemplateId: chosenTemplateId,
    format: format === 'json' ? 'json' : 'docx',
    docxMode: 'single'
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

async function bundleExportFiles(files, format, startDate, endDate) {
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

  const ctx = await loadGenerationContext(req, options);
  const studentMap = new Map(ctx.students.map((row) => [clean(row.personId), row]));
  const files = [];

  for (const target of targets) {
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
      files.push(await exportClassTarget(student, classId, format, ctx, req.user));
      continue;
    }

    if (type === 'overall') {
      const classIds = Array.isArray(target?.classIds)
        ? target.classIds.map((id) => clean(id)).filter(Boolean)
        : [];
      files.push(await exportOverallTarget(student, classIds, clean(target?.overallTemplateId), format, ctx, req.user));
      continue;
    }

    const error = new Error(`Unsupported export target type: ${type || '(empty)'}.`);
    error.statusCode = 400;
    throw error;
  }

  return bundleExportFiles(files, format, ctx.startDate, ctx.endDate);
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
  buildSourceRunsForStudent,
  buildClassExportRowsForStudent,
  buildOverallExportBlock,
  buildOverallExportOptions,
  buildStudentAttendanceReportExportPlan,
  exportStudentAttendanceReportSelections,
  generateStudentAttendanceReports
};
