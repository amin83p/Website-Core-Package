const schoolDataService = require('./schoolDataService');
const reportService = require('./reportService');
const reportRuleEngineService = require('./reportRuleEngineService');
const reportIntegrityService = require('./reportIntegrityService');
const reportAssignmentModel = require('../../models/school/reportAssignmentModel');
const reportScopePolicy = require('./reportScopePolicy');
const reportDocxRenderService = require('./reportDocxRenderService');
const reportPdfRenderService = require('./reportPdfRenderService');
const reportFunderDocxService = require('./reportFunderDocxService');
const reportFunderPdfService = require('./reportFunderPdfService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const { getPrefillValue } = require('./reportPrefillKeyUtils');

const EPHEMERAL_ASSIGNMENT_ID = 'engine:ephemeral';

function getActiveOrgId(reqUser) {
  return String(
    reqUser?.activeOrgId
    || reqUser?.organizationId
    || reqUser?.orgId
    || ''
  ).trim();
}

function inferAssignmentReportScope(assignment) {
  try {
    return reportScopePolicy.normalizeReportScope(assignment?.reportScope);
  } catch (_) {
    return 'class';
  }
}

function inferAssignmentTargetType(row) {
  const explicit = String(row?.targetType || '').trim().toLowerCase();
  if (explicit === 'date') return 'date';
  if (explicit === 'session') return 'session';
  return String(row?.sessionId || '').trim() ? 'session' : 'date';
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function isEmptyValue(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function stableValueToken(value) {
  if (value === undefined) return '__undefined__';
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function coercePrefillValueForField(field, rawPrefill) {
  const type = String(field?.type || '').trim().toLowerCase();
  if (type === 'checkbox') {
    return rawPrefill === true || String(rawPrefill).toLowerCase() === 'true' || String(rawPrefill) === '1';
  }
  if (type === 'number') {
    const n = Number(rawPrefill);
    return Number.isFinite(n) ? n : '';
  }
  if (Array.isArray(rawPrefill)) {
    if (rawPrefill.length && rawPrefill.every((item) => item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'number'))) {
      return reportService.formatStudentPhonesList(rawPrefill);
    }
    return rawPrefill.map((item) => String(item ?? '')).filter(Boolean).join(', ');
  }
  if (rawPrefill === undefined || rawPrefill === null) return '';
  return String(rawPrefill).trim();
}

function evaluateExpressionFieldValue(field, answers, prefill) {
  const rule = reportRuleEngineService.normalizeCalculationRule(field?.calculationRule || {});
  if (!rule.expression) return null;
  const safeAnswers = answers && typeof answers === 'object' ? answers : {};
  const safePrefill = prefill && typeof prefill === 'object' ? prefill : {};
  try {
    return reportRuleEngineService.evaluateSafeExpression(rule.expression, {
      value: safeAnswers[field?.id],
      answers: safeAnswers,
      prefill: safePrefill
    });
  } catch (_) {
    if (rule.onError === 'empty') return '';
    const previous = safeAnswers[field?.id];
    return previous === undefined || previous === null ? '' : previous;
  }
}

function coerceExpressionValueForField(field, rawValue) {
  return coercePrefillValueForField(field, rawValue);
}

function isVisualOnlyField(field) {
  const type = String(field?.type || '').trim().toLowerCase();
  return type === 'section' || type === 'subheader' || type === 'row_break';
}

function hydrateAnswersFromPrefill(template, instance, options = {}) {
  const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
  const prefill = instance?.prefillSnapshot && typeof instance.prefillSnapshot === 'object'
    ? instance.prefillSnapshot
    : {};
  const currentAnswers = instance?.answers && typeof instance.answers === 'object'
    ? { ...instance.answers }
    : {};
  const overwritePrefillFields = options?.overwritePrefillFields === true;
  let changed = false;

  fields.forEach((field) => {
    const type = String(field?.type || '').trim().toLowerCase();
    if (!field?.id || type === 'section' || type === 'subheader' || type === 'row_break') return;

    const valueMode = reportRuleEngineService.normalizeValueMode(field?.valueMode);
    if (valueMode === 'calculated' || valueMode === 'derived_editable') {
      const currentValue = currentAnswers[field.id];
      const hasCurrentValue = !isEmptyValue(currentValue);
      if (hasCurrentValue && !overwritePrefillFields && valueMode === 'derived_editable') return;

      const evaluated = evaluateExpressionFieldValue(field, currentAnswers, prefill);
      if (evaluated === null && !overwritePrefillFields && hasCurrentValue) return;

      const nextValue = coerceExpressionValueForField(field, evaluated);
      if (hasCurrentValue && !overwritePrefillFields && stableValueToken(currentValue) === stableValueToken(nextValue)) return;

      currentAnswers[field.id] = nextValue;
      changed = true;
      return;
    }

    const resolvedPrefill = getPrefillValue(prefill, field?.prefillKey);
    if (!resolvedPrefill.found) return;

    const currentValue = currentAnswers[field.id];
    const hasCurrentValue = !isEmptyValue(currentValue);
    const looksRating = /session_rating|classEffort|classParticipation|respectsTeachers|respectsStudents|conduct/i.test(
      String(field?.prefillKey || '')
    );
    const currentIsNa = ['n/a', 'na'].includes(String(currentValue ?? '').trim().toLowerCase());
    const canOverwriteNaRating = looksRating && currentIsNa;
    if (hasCurrentValue && !overwritePrefillFields && !canOverwriteNaRating) return;

    const rawPrefill = resolvedPrefill.value;
    let nextValue = rawPrefill;
    if (type === 'checkbox') {
      nextValue = rawPrefill === true || String(rawPrefill).toLowerCase() === 'true' || String(rawPrefill) === '1';
    } else if (type === 'number') {
      const n = Number(rawPrefill);
      nextValue = Number.isFinite(n) ? n : '';
    } else if (rawPrefill === undefined || rawPrefill === null) {
      nextValue = '';
    } else {
      nextValue = String(rawPrefill).trim();
    }

    currentAnswers[field.id] = nextValue;
    changed = true;
  });

  return { changed, answers: currentAnswers };
}

async function resolveClassStudentPersonIds({
  classData,
  sessions = [],
  reqUser,
  startDate = '',
  endDate = ''
} = {}) {
  const classId = String(classData?.id || '').trim();
  if (!classId) return [];
  const enrollmentStartDate = normalizeDateOnly(startDate) || normalizeDateOnly(endDate);
  const enrollmentEndDate = normalizeDateOnly(endDate) || normalizeDateOnly(startDate);
  const snapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
    classId,
    classItem: classData,
    reqUser,
    activeOrgId: classData?.orgId,
    sessionDates: (Array.isArray(sessions) ? sessions : []).map((row) => String(row?.date || '').trim()).filter(Boolean),
    startDate: enrollmentStartDate,
    endDate: enrollmentEndDate,
    canonicalStatuses: classEnrollmentReadService.getReportRosterStatusesForClass(classData)
  });
  const activeStudentIds = snapshot?.studentIds instanceof Set ? [...snapshot.studentIds] : [];
  if (!activeStudentIds.length) return [];

  const allStudents = await schoolDataService.fetchAllData('students', {}, reqUser);
  const studentToPersonMap = new Map(
    (Array.isArray(allStudents) ? allStudents : [])
      .map((student) => [String(student?.id || '').trim(), String(student?.personId || '').trim()])
      .filter(([studentId, personId]) => Boolean(studentId && personId))
  );

  const resolvedSet = new Set();
  activeStudentIds.forEach((studentId) => {
    const personId = String(studentToPersonMap.get(String(studentId || '').trim()) || '').trim();
    if (personId) resolvedSet.add(personId);
  });
  return [...resolvedSet];
}

async function resolveTargetStudentIds({
  assignment,
  classData,
  sessions,
  reqUser,
  requestedStudentIds = []
} = {}) {
  const reportScope = inferAssignmentReportScope(assignment);
  let referenceDate = String(assignment?.reportDueDate || assignment?.dueDate || assignment?.sessionDate || '').trim();
  if (!referenceDate && inferAssignmentTargetType(assignment) === 'session') {
    const sessionId = String(assignment?.sessionId || '').trim();
    if (sessionId) {
      const sessionMatch = (Array.isArray(sessions) ? sessions : [])
        .find((row) => String(row?.sessionId || '').trim() === sessionId);
      referenceDate = String(sessionMatch?.date || '').trim();
    }
  }

  const classStudentIds = await resolveClassStudentPersonIds({
    classData,
    sessions,
    reqUser,
    startDate: normalizeDateOnly(assignment?.reportStartDate) || referenceDate,
    endDate: normalizeDateOnly(assignment?.reportDueDate) || referenceDate
  });
  const classStudentSet = new Set(classStudentIds);

  let targetStudentIds = [];
  if (reportScope === 'class') {
    targetStudentIds = [''];
  } else if (reportScope === 'each_student') {
    targetStudentIds = classStudentIds;
    if (!targetStudentIds.length) throw new Error('No students found for this class assignment.');
  } else {
    const configured = Array.isArray(assignment.targetStudentIds)
      ? assignment.targetStudentIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    targetStudentIds = configured.filter((id) => classStudentSet.has(id));
    if (!targetStudentIds.length) throw new Error('No valid selected students are available for this assignment.');
  }

  const filterIds = (Array.isArray(requestedStudentIds) ? requestedStudentIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (filterIds.length) {
    const filterSet = new Set(filterIds);
    if (reportScope === 'class') {
      if (filterSet.size > 1 || (filterSet.size === 1 && filterSet.has(''))) {
        throw new Error('Class-scope generation does not support student filtering.');
      }
      targetStudentIds = [''];
    } else {
      targetStudentIds = targetStudentIds.filter((id) => filterSet.has(id));
      if (!targetStudentIds.length) throw new Error('None of the requested students are in this assignment target.');
    }
  }

  return targetStudentIds;
}

async function buildEphemeralAssignmentContext(params = {}, reqUser) {
  const orgId = getActiveOrgId(reqUser);
  if (!orgId) throw new Error('Active organization is required for ad-hoc report generation.');

  const templateId = String(params.templateId || '').trim();
  const classId = String(params.classId || '').trim();
  const reportStartDate = normalizeDateOnly(params.reportStartDate);
  const reportDueDate = normalizeDateOnly(params.reportDueDate);
  if (!templateId || !classId || !reportStartDate || !reportDueDate) {
    throw new Error('templateId, classId, reportStartDate, and reportDueDate are required for ad-hoc generation.');
  }

  const template = await reportIntegrityService.assertTemplateAccessible(templateId, reqUser);
  const teacherId = String(params.teacherId || '').trim();
  if (!teacherId) throw new Error('teacherId is required for ad-hoc generation.');

  const sessionId = String(params.sessionId || '').trim();
  const sessionDate = normalizeDateOnly(params.sessionDate || params.dueDate || reportDueDate);
  const dueDate = normalizeDateOnly(params.dueDate || params.sessionDate || reportDueDate);
  const targetType = sessionId ? 'session' : 'date';
  const taskStartTime = String(params.taskStartTime || '09:00').trim();
  const taskEndTime = String(params.taskEndTime || '10:00').trim();

  const sanitized = reportAssignmentModel.sanitizeAssignment({
    id: EPHEMERAL_ASSIGNMENT_ID,
    orgId,
    classId,
    templateId,
    templateVersion: template.version || 1,
    reportScope: params.reportScope || 'each_student',
    targetStudentIds: Array.isArray(params.targetStudentIds) ? params.targetStudentIds : [],
    teacherIds: [teacherId],
    sharedAnswers: params.sharedAnswers && typeof params.sharedAnswers === 'object' ? params.sharedAnswers : {},
    status: 'active',
    targetRows: [{
      targetType,
      sessionId,
      sessionDate,
      dueDate: targetType === 'date' ? dueDate : '',
      reportStartDate,
      reportDueDate,
      taskStartTime,
      taskEndTime,
      teacherId,
      status: 'active'
    }]
  });

  const assignment = reportAssignmentModel.applyTargetRowToAssignment(
    sanitized,
    sanitized.targetRows[0]
  );
  return { template, assignment };
}

async function resolveGenerationContext(request = {}, reqUser) {
  const assignmentId = String(request?.assignmentId || '').trim();

  if (assignmentId) {
    const ctx = await reportIntegrityService.resolveStartInstanceContext({
      assignmentId,
      assignmentRowId: request?.assignmentRowId || '',
      reqUser,
      requestedTeacherId: request?.teacherId || '',
      fallbackTeacherId: request?.teacherId || '',
      requestedStudentId: Array.isArray(request?.studentIds) && request.studentIds.length === 1
        ? String(request.studentIds[0] || '').trim()
        : ''
    });

    let targetStudentIds = ctx.targetStudentIds;
    if (Array.isArray(request?.studentIds) && request.studentIds.length) {
      const filterSet = new Set(request.studentIds.map((id) => String(id || '').trim()).filter(Boolean));
      if (inferAssignmentReportScope(ctx.assignment) === 'class') {
        if (filterSet.size > 1 || (filterSet.size === 1 && !filterSet.has(''))) {
          throw new Error('Class-scope generation does not support student filtering.');
        }
      } else {
        targetStudentIds = targetStudentIds.filter((id) => filterSet.has(id));
        if (!targetStudentIds.length) throw new Error('None of the requested students are in this assignment target.');
      }
    }

    return {
      source: 'assignment',
      template: ctx.template,
      assignment: ctx.assignment,
      teacherId: ctx.teacherId,
      targetStudentIds,
      classData: ctx.classData,
      sessions: ctx.sessions
    };
  }

  const hasAdHoc = String(request?.templateId || '').trim() && String(request?.classId || '').trim();
  if (!hasAdHoc) {
    throw new Error('Provide assignmentId or ad-hoc templateId + classId + report period dates.');
  }

  const { template, assignment } = await buildEphemeralAssignmentContext(request, reqUser);
  const [classData, sessions] = await Promise.all([
    schoolDataService.getDataById('classes', assignment.classId, reqUser),
    schoolDataService.getClassSessions(assignment.classId, reqUser)
  ]);
  if (!classData) throw new Error('Class not found for ad-hoc generation.');

  const targetStudentIds = await resolveTargetStudentIds({
    assignment,
    classData,
    sessions,
    reqUser,
    requestedStudentIds: request?.studentIds
  });

  const teacherId = String(request?.teacherId || assignment.teacherId || assignment.teacherIds?.[0] || '').trim();
  if (!teacherId) throw new Error('teacherId is required for ad-hoc generation.');

  return {
    source: 'adhoc',
    template,
    assignment,
    teacherId,
    targetStudentIds,
    classData,
    sessions
  };
}

async function buildSyntheticInstance({
  template,
  assignment,
  teacherId,
  studentId = '',
  reqUser
} = {}) {
  const prefillSnapshot = await reportService.buildPrefillSnapshot({
    assignment,
    teacherId,
    studentId,
    reqUser
  });
  const instance = {
    id: `engine-${studentId || 'class'}`,
    status: 'engine',
    assignmentId: assignment?.id || '',
    assignmentRowId: assignment?.assignmentRowId || assignment?.rowId || '',
    templateId: template?.id || '',
    teacherId,
    studentId: studentId || '',
    classId: assignment?.classId || '',
    sessionId: assignment?.sessionId || '',
    sessionDate: assignment?.sessionDate || '',
    answers: {},
    prefillSnapshot,
    derivedOverrides: {}
  };
  const hydrated = hydrateAnswersFromPrefill(template, instance);
  instance.answers = hydrated.answers;
  const mergedAnswers = reportService.mergeTemplateData(template, instance, assignment);
  const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
  fields.forEach((field) => {
    if (!field?.id || isVisualOnlyField(field)) return;
    const valueMode = reportRuleEngineService.normalizeValueMode(field?.valueMode);
    if (valueMode === 'calculated') {
      instance.answers[field.id] = mergedAnswers[field.id];
    }
  });
  return instance;
}

function assessGenerationWarnings(template, assignment, instance, mergedAnswers = null) {
  const warnings = [];
  const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
  const merged = mergedAnswers && typeof mergedAnswers === 'object'
    ? mergedAnswers
    : reportService.mergeTemplateData(template, instance, assignment);
  const studentTargeted = reportService.isStudentTargetedScope(assignment?.reportScope);
  const sharedRaw = assignment?.sharedAnswers && typeof assignment.sharedAnswers === 'object'
    ? assignment.sharedAnswers
    : {};
  const prefill = instance?.prefillSnapshot && typeof instance.prefillSnapshot === 'object'
    ? instance.prefillSnapshot
    : {};
  const answers = instance?.answers && typeof instance.answers === 'object' ? instance.answers : {};

  fields.forEach((field) => {
    if (isVisualOnlyField(field) || !field?.id) return;
    const fieldId = String(field.id);
    const valueMode = reportRuleEngineService.normalizeValueMode(field?.valueMode);
    const mergedValue = merged[fieldId];

    if (valueMode === 'manual' && !String(field?.prefillKey || '').trim() && isEmptyValue(mergedValue)) {
      warnings.push({
        code: 'empty_manual_field',
        fieldId,
        label: String(field.label || fieldId),
        message: 'Manual field has no prefill key and will export empty.'
      });
    }

    if (studentTargeted && field.sharedAcrossStudents === true && !Object.prototype.hasOwnProperty.call(sharedRaw, fieldId) && isEmptyValue(mergedValue)) {
      warnings.push({
        code: 'empty_shared_field',
        fieldId,
        label: String(field.label || fieldId),
        message: 'Shared field has no assignment sharedAnswers value and will export empty.'
      });
    }

    if (valueMode === 'derived_editable' || valueMode === 'calculated') {
      const rule = reportRuleEngineService.normalizeCalculationRule(field?.calculationRule || {});
      if (!rule.expression) return;
      try {
        const computed = reportRuleEngineService.evaluateSafeExpression(rule.expression, {
          value: answers[fieldId],
          answers,
          prefill
        });
        const coerced = coerceExpressionValueForField(field, computed);
        if (isEmptyValue(coerced) && isEmptyValue(mergedValue)) {
          warnings.push({
            code: 'expression_fallback',
            fieldId,
            label: String(field.label || fieldId),
            message: 'Expression field resolved to an empty value.'
          });
        }
      } catch (error) {
        warnings.push({
          code: 'expression_fallback',
          fieldId,
          label: String(field.label || fieldId),
          message: error.message || 'Expression evaluation failed.'
        });
      }
    }
  });

  return warnings;
}

function buildPlaceholderBundle(template, instance, assignment, format = 'json') {
  if (format === 'docx') {
    return reportService.buildDocxPlaceholderPayloadDetailed(template, instance, assignment);
  }
  if (format === 'pdf') {
    return reportService.buildPdfPlaceholderPayloadDetailed(template, instance, assignment);
  }
  return reportService.buildPlaceholderPayloadDetailed(template, instance, assignment);
}

async function buildStudentPayload({
  template,
  assignment,
  instance,
  reqUser,
  options = {}
} = {}) {
  const format = String(options.format || 'json').trim().toLowerCase();
  const mergedAnswers = reportService.mergeTemplateData(template, instance, assignment);
  const placeholderBundle = buildPlaceholderBundle(template, instance, assignment, format);
  const collections = await reportService.buildReportDocxCollections({
    template,
    instance,
    assignment,
    reqUser
  });
  const warnings = assessGenerationWarnings(template, assignment, instance, mergedAnswers);
  const collectionDiagnostics = Object.fromEntries(
    Object.entries(collections || {}).map(([key, rows]) => [key, { rowCount: Array.isArray(rows) ? rows.length : 0 }])
  );

  return {
    instanceId: instance?.id || '',
    studentId: instance?.studentId || '',
    studentName: String(instance?.prefillSnapshot?.student_full_name || instance?.studentId || '').trim(),
    templateId: template?.id || '',
    templateVersion: template?.version,
    status: instance?.status || 'engine',
    placeholders: placeholderBundle.placeholders,
    collections,
    answers: instance?.answers || {},
    mergedAnswers,
    conversionDiagnostics: placeholderBundle.conversionDiagnostics || [],
    collectionDiagnostics,
    assignmentSharedAnswers: assignment?.sharedAnswers || {},
    prefillSnapshot: instance?.prefillSnapshot || {},
    warnings
  };
}

async function renderStudentDocx({
  template,
  assignment,
  instance,
  reqUser,
  docxKey = '',
  payload = null
} = {}) {
  if (!reportFunderDocxService.templateHasAnyDocx(template)) {
    throw new Error('This report template has no DOCX file configured.');
  }
  const studentPayload = payload || await buildStudentPayload({
    template,
    assignment,
    instance,
    reqUser,
    options: { format: 'docx' }
  });
  const resolved = reportFunderDocxService.resolveDocxTemplateForFunder({
    template,
    funderKey: String(docxKey || 'default').trim() || 'default'
  });
  if (!resolved.docxTemplate) {
    throw new Error('No DOCX template available for this student.');
  }
  const file = await reportDocxRenderService.renderReportInstanceDocx({
    template,
    instance,
    placeholders: studentPayload.placeholders,
    collections: studentPayload.collections,
    docxTemplateOverride: resolved.docxTemplate
  });
  const safeName = String(studentPayload.studentName || instance?.studentId || file.fileName)
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .slice(0, 60);
  return {
    ...file,
    fileName: `${safeName || 'student'}_report.docx`,
    warnings: studentPayload.warnings
  };
}

async function renderStudentPdf({
  template,
  assignment,
  instance,
  reqUser,
  pdfKey = '',
  payload = null
} = {}) {
  if (!reportFunderPdfService.templateHasAnyPdf(template)) {
    throw new Error('This report template has no PDF file configured.');
  }
  const studentPayload = payload || await buildStudentPayload({
    template,
    assignment,
    instance,
    reqUser,
    options: { format: 'pdf' }
  });
  const mergedAnswers = studentPayload.mergedAnswers;
  const resolved = reportFunderPdfService.resolvePdfTemplateForFunder({
    template,
    funderKey: String(pdfKey || 'default').trim() || 'default'
  });
  if (!resolved.pdfTemplate) {
    throw new Error('No PDF template available for this student.');
  }
  const file = await reportPdfRenderService.renderReportInstancePdf({
    template,
    instance,
    placeholders: studentPayload.placeholders,
    mergedAnswers,
    pdfTemplateOverride: resolved.pdfTemplate
  });
  const safeName = String(studentPayload.studentName || instance?.studentId || file.fileName)
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .slice(0, 60);
  return {
    ...file,
    fileName: `${safeName || 'student'}_report.pdf`,
    warnings: studentPayload.warnings
  };
}

function resolveStudentExportKey(studentId, explicitKey, suggestedMap) {
  const cleanStudentId = String(studentId || '').trim();
  const explicit = String(explicitKey || '').trim();
  if (explicit) return explicit;
  return String(suggestedMap.get(cleanStudentId) || 'default').trim() || 'default';
}

async function generateReportOutput(request = {}, options = {}, reqUser) {
  const format = String(request?.format || options?.format || 'json').trim().toLowerCase();
  if (!['json', 'docx', 'pdf'].includes(format)) {
    throw new Error('Invalid export format. Use json, docx, or pdf.');
  }

  const context = await resolveGenerationContext(request, reqUser);
  const {
    template,
    assignment,
    teacherId,
    targetStudentIds,
    source
  } = context;

  const rows = [];
  for (const studentId of targetStudentIds) {
    const instance = await buildSyntheticInstance({
      template,
      assignment,
      teacherId,
      studentId,
      reqUser
    });
    const payload = await buildStudentPayload({
      template,
      assignment,
      instance,
      reqUser,
      options: { format }
    });
    rows.push({
      studentId,
      studentName: payload.studentName,
      instance,
      payload
    });
  }

  const result = {
    source,
    format,
    assignmentId: assignment?.id || '',
    assignmentRowId: assignment?.assignmentRowId || assignment?.rowId || '',
    templateId: template?.id || '',
    templateTitle: template?.title || '',
    classId: assignment?.classId || '',
    teacherId,
    reportStartDate: assignment?.reportStartDate || '',
    reportDueDate: assignment?.reportDueDate || '',
    assignmentSharedAnswers: assignment?.sharedAnswers || {},
    rows,
    warnings: rows.flatMap((row) => row.payload?.warnings || [])
  };

  if (format === 'json') {
    result.payload = {
      rows: rows.map((row) => ({
        studentId: row.studentId,
        studentName: row.studentName,
        instanceId: row.instance?.id || '',
        ...row.payload
      }))
    };
    return result;
  }

  const selectionByStudent = new Map(
    (Array.isArray(request?.selections) ? request.selections : [])
      .map((row) => [String(row?.studentId || '').trim(), row])
      .filter(([studentId]) => studentId)
  );

  if (format === 'pdf') {
    const suggestions = await reportFunderPdfService.buildExportPdfSuggestions({
      template,
      assignment: {
        ...assignment,
        reportStartDate: assignment?.reportStartDate,
        reportDueDate: assignment?.reportDueDate,
        classId: assignment?.classId
      },
      reqUser,
      students: rows.map((row) => ({
        studentId: row.studentId,
        personId: row.studentId,
        instanceId: row.instance?.id || '',
        studentName: row.studentName
      }))
    });
    const suggestedByStudent = new Map(
      (suggestions?.rows || []).map((row) => [String(row.studentId), row.suggestedPdfKey])
    );
    const rendered = [];
    for (const row of rows) {
      const selection = selectionByStudent.get(String(row.studentId)) || {};
      const pdfKey = resolveStudentExportKey(
        row.studentId,
        selection.pdfKey || request?.pdfKey,
        suggestedByStudent
      );
      const file = await renderStudentPdf({
        template,
        assignment,
        instance: row.instance,
        reqUser,
        pdfKey,
        payload: row.payload
      });
      rendered.push(file);
    }
    if (rendered.length === 1) {
      result.file = rendered[0];
      result.contentType = 'application/pdf';
      return result;
    }
    const zipBuffer = await reportPdfRenderService.zipReportInstancePdfFiles(rendered);
    result.buffer = zipBuffer;
    result.contentType = 'application/zip';
    result.fileName = `report-engine-${assignment?.id || 'adhoc'}-pdf.zip`;
    return result;
  }

  const docxModeRaw = String(request?.docxMode || options?.docxMode || '').trim().toLowerCase();
  const docxMode = docxModeRaw === 'zip' || docxModeRaw === 'single'
    ? docxModeRaw
    : (rows.length === 1 ? 'single' : 'consolidated');

  const suggestions = await reportFunderDocxService.buildExportDocxSuggestions({
    template,
    assignment: {
      ...assignment,
      reportStartDate: assignment?.reportStartDate,
      reportDueDate: assignment?.reportDueDate,
      classId: assignment?.classId
    },
    reqUser,
    students: rows.map((row) => ({
      studentId: row.studentId,
      personId: row.studentId,
      instanceId: row.instance?.id || '',
      studentName: row.studentName
    }))
  });
  const suggestedByStudent = new Map(
    (suggestions?.rows || []).map((row) => [String(row.studentId), row.suggestedDocxKey])
  );

  const rendered = [];
  for (const row of rows) {
    const selection = selectionByStudent.get(String(row.studentId)) || {};
    const docxKey = resolveStudentExportKey(
      row.studentId,
      selection.docxKey || request?.docxKey,
      suggestedByStudent
    );
    const file = await renderStudentDocx({
      template,
      assignment,
      instance: row.instance,
      reqUser,
      docxKey,
      payload: row.payload
    });
    rendered.push(file);
  }

  if (docxMode === 'zip') {
    const zipBuffer = await reportDocxRenderService.zipReportInstanceDocxFiles(rendered);
    result.buffer = zipBuffer;
    result.contentType = 'application/zip';
    result.fileName = `report-engine-${assignment?.id || 'adhoc'}.zip`;
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
  result.fileName = `report-engine-${assignment?.id || 'adhoc'}.docx`;
  return result;
}

module.exports = {
  EPHEMERAL_ASSIGNMENT_ID,
  hydrateAnswersFromPrefill,
  evaluateExpressionFieldValue,
  coercePrefillValueForField,
  coerceExpressionValueForField,
  stableValueToken,
  resolveGenerationContext,
  buildEphemeralAssignmentContext,
  buildSyntheticInstance,
  assessGenerationWarnings,
  buildStudentPayload,
  renderStudentDocx,
  renderStudentPdf,
  generateReportOutput
};
