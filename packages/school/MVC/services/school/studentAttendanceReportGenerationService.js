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
      if (!classRow) {
        warnings.push(`No class available for overall slot ${slot.slotKey || index + 1} (${student.name || personId}).`);
        return;
      }
      const classId = clean(classRow.classId);
      if (selectedSet && !selectedSet.has(classId)) {
        warnings.push(`Class ${classRow.className || classId} is not selected for overall slot ${slot.slotKey || index + 1}.`);
        return;
      }
      const teacherId = resolveTeacherIdForClass(classRow);
      if (!teacherId) {
        warnings.push(`Class ${classRow.className || classRow.classId} has no teacher for slot ${slot.slotKey || index + 1}.`);
        return;
      }
      sourceRuns.push({
        slotKey: clean(slot.slotKey).toUpperCase(),
        templateId: clean(slot.templateId) || clean(policy.reportTemplateId),
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

  const policy = await studentAttendanceReportPolicyModel.getPolicyForOrg(activeOrgId);
  if (!clean(policy.reportTemplateId)) {
    const error = new Error('Configure a report template in School Settings before generating reports.');
    error.statusCode = 400;
    throw error;
  }

  await studentAttendanceReportPolicyService.assertReportTemplateAccessible(policy.reportTemplateId, req.user);

  let overallTemplate = null;
  if (clean(policy.overallReportTemplateId)) {
    overallTemplate = await studentAttendanceReportPolicyService.assertOverallTemplateAccessible(
      policy.overallReportTemplateId,
      req.user
    );
  }

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
    payload,
    students,
    startDate: payload.startDate,
    endDate: payload.endDate
  };
}

async function loadTemplateMetaMap(templateIds = [], reqUser) {
  const map = new Map();
  const uniqueIds = [...new Set(templateIds.map((id) => clean(id)).filter(Boolean))];
  for (const templateId of uniqueIds) {
    const template = await schoolDataService.getDataById('reportTemplates', templateId, reqUser);
    if (!template) continue;
    map.set(templateId, {
      templateTitle: studentAttendanceReportPolicyService.formatTemplateLabel(template, templateId),
      hasDocx: reportFunderDocxService.templateHasAnyDocx(template),
      hasPdf: reportFunderPdfService.templateHasAnyPdf(template)
    });
  }
  return map;
}

function buildClassExportRowsForStudent(student, policy, overallTemplate, templateMetaMap) {
  const classes = sortClasses(student.classes);
  const slots = sortOverallSlots(overallTemplate);
  const rows = [];

  if (slots.length) {
    slots.forEach((slot, index) => {
      const classRow = classes[index];
      if (!classRow) return;
      const classId = clean(classRow.classId);
      const templateId = clean(slot.templateId) || clean(policy.reportTemplateId);
      const meta = templateMetaMap.get(templateId) || {};
      const teacherId = resolveTeacherIdForClass(classRow);
      rows.push({
        classId,
        className: clean(classRow.className) || classId,
        teacherId,
        slotKey: clean(slot.slotKey).toUpperCase(),
        slotIndex: index,
        templateId,
        templateTitle: meta.templateTitle || templateId,
        hasDocx: Boolean(meta.hasDocx),
        hasPdf: Boolean(meta.hasPdf),
        exportable: Boolean(teacherId),
        warning: teacherId ? '' : `No teacher assigned for ${classRow.className || classId}.`
      });
    });
    return rows;
  }

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
      exportable: Boolean(teacherId),
      warning: teacherId ? '' : `No teacher assigned for ${classRow.className || classId}.`
    });
  });
  return rows;
}

function buildOverallExportBlock(student, policy, overallTemplate, classRows) {
  if (!overallTemplate) return null;

  const slots = sortOverallSlots(overallTemplate);
  const missingSlots = [];
  const warnings = [];

  slots.forEach((slot, index) => {
    const row = classRows.find((entry) => Number(entry.slotIndex) === index);
    if (!row) {
      missingSlots.push(clean(slot.slotKey) || String(index + 1));
      warnings.push(`No class available for slot ${slot.slotKey || index + 1}.`);
      return;
    }
    if (!row.exportable) {
      missingSlots.push(clean(slot.slotKey) || String(index + 1));
      warnings.push(row.warning || `Slot ${slot.slotKey || index + 1} is not exportable.`);
    }
  });

  const eligible = slots.length > 0
    && missingSlots.length === 0
    && classRows.length >= slots.length;

  return {
    defined: true,
    templateId: clean(policy.overallReportTemplateId),
    templateTitle: clean(overallTemplate.title) || clean(policy.overallReportTemplateId),
    hasDocx: overallReportService.templateHasAttachedDocx(overallTemplate),
    eligible,
    missingSlots,
    warnings,
    slotCount: slots.length
  };
}

async function buildStudentAttendanceReportExportPlan(req, options = {}) {
  const ctx = await loadGenerationContext(req, options);
  const { policy, overallTemplate, students, startDate, endDate } = ctx;

  const templateIds = [policy.reportTemplateId];
  if (overallTemplate) {
    sortOverallSlots(overallTemplate).forEach((slot) => {
      const slotTemplateId = clean(slot.templateId);
      if (slotTemplateId) templateIds.push(slotTemplateId);
    });
  }
  const templateMetaMap = await loadTemplateMetaMap(templateIds, req.user);

  const planStudents = students.map((student) => {
    const classRows = buildClassExportRowsForStudent(student, policy, overallTemplate, templateMetaMap);
    const overall = buildOverallExportBlock(student, policy, overallTemplate, classRows);
    return {
      personId: clean(student.personId),
      name: clean(student.name) || clean(student.personId),
      classes: classRows,
      overall
    };
  });

  const defaultReportMeta = templateMetaMap.get(clean(policy.reportTemplateId)) || {};

  return {
    startDate,
    endDate,
    reportTemplateId: clean(policy.reportTemplateId),
    reportTemplateTitle: defaultReportMeta.templateTitle || clean(policy.reportTemplateId),
    overallReportTemplateId: clean(policy.overallReportTemplateId),
    overallReportTemplateTitle: overallTemplate
      ? (clean(overallTemplate.title) || clean(policy.overallReportTemplateId))
      : '',
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

function resolveClassTemplateId(student, classId, policy, overallTemplate) {
  const classes = sortClasses(student.classes);
  const slots = sortOverallSlots(overallTemplate);
  if (!slots.length) return clean(policy.reportTemplateId);

  const index = classes.findIndex((row) => clean(row.classId) === clean(classId));
  if (index < 0) return clean(policy.reportTemplateId);
  const slot = slots[index];
  return clean(slot?.templateId) || clean(policy.reportTemplateId);
}

async function exportClassTarget(student, classId, format, ctx, reqUser) {
  const { policy, overallTemplate, startDate, endDate } = ctx;
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

  const templateId = resolveClassTemplateId(student, classId, policy, overallTemplate);
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

async function exportOverallTarget(student, selectedClassIds, format, ctx, reqUser) {
  const { policy, overallTemplate, startDate, endDate } = ctx;
  if (!overallTemplate) {
    const error = new Error('No overall report template is configured.');
    error.statusCode = 400;
    throw error;
  }
  if (format === 'pdf') {
    const error = new Error('Overall reports do not support PDF export.');
    error.statusCode = 400;
    throw error;
  }

  const selectedSet = Array.isArray(selectedClassIds)
    ? new Set(selectedClassIds.map((id) => clean(id)).filter(Boolean))
    : null;
  const { sourceRuns, warnings: buildWarnings } = buildSourceRunsForStudent({
    student,
    policy,
    overallTemplate,
    startDate,
    endDate,
    selectedClassIds: selectedSet
  });

  const slotCount = sortOverallSlots(overallTemplate).length;
  if (!sourceRuns.length || sourceRuns.length < slotCount) {
    const error = new Error(buildWarnings[0] || 'Selected classes do not satisfy the overall report template.');
    error.statusCode = 400;
    throw error;
  }

  const pipeline = await overallReportGenerationEngineService.generateOverallPipeline({
    filterStartDate: startDate,
    filterEndDate: endDate,
    studentIds: [clean(student.personId)],
    sourceRuns,
    overallTemplateId: policy.overallReportTemplateId,
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
      fileName: `${safeFileToken(student.name || student.personId)}_overall_payload.json`,
      warnings: mergedWarnings
    };
  }

  if (overall.file?.buffer) {
    return {
      buffer: overall.file.buffer,
      contentType: overall.contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: overall.file.fileName || `${safeFileToken(student.name || student.personId)}_overall.docx`,
      warnings: mergedWarnings
    };
  }
  if (overall.buffer) {
    return {
      buffer: overall.buffer,
      contentType: overall.contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: overall.fileName || `${safeFileToken(student.name || student.personId)}_overall.docx`,
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
      files.push(await exportOverallTarget(student, classIds, format, ctx, req.user));
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
    overallTemplateId: policy.overallReportTemplateId,
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
  buildStudentAttendanceReportExportPlan,
  exportStudentAttendanceReportSelections,
  generateStudentAttendanceReports
};
