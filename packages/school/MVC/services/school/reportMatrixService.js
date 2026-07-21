const schoolDataService = require('./schoolDataService');
const reportService = require('./reportService');
const reportIntegrityService = require('./reportIntegrityService');
const reportInstanceSaveService = require('./reportInstanceSaveService');
const sessionConductService = require('./sessionConductService');
const reportViewService = require('./reportViewService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { getPrefillValue } = require('./reportPrefillKeyUtils');

const VISUAL_TYPES = new Set(['section', 'subheader', 'row_break']);
const STUDENT_NAME_KEYS = new Set([
  'student_name',
  'student_full_name',
  'student_preferred_name'
]);

function clean(value) {
  return String(value || '').trim();
}

function isVisualField(field = {}) {
  return VISUAL_TYPES.has(clean(field?.type).toLowerCase());
}

function isCalculatedField(field = {}) {
  return clean(field?.valueMode || 'manual').toLowerCase() === 'calculated';
}

function isReadOnlyField(field = {}) {
  return field?.readOnly === true || isCalculatedField(field);
}

function isStudentNameField(field = {}) {
  const prefillKey = clean(field?.prefillKey).toLowerCase();
  const fieldId = clean(field?.id).toLowerCase();
  return STUDENT_NAME_KEYS.has(prefillKey) || STUDENT_NAME_KEYS.has(fieldId);
}

function stableValueToken(value) {
  if (value === undefined) return '__undefined__';
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function valuesAreIdentical(values = []) {
  if (!values.length) return false;
  const first = stableValueToken(values[0]);
  return values.every((value) => stableValueToken(value) === first);
}

function buildFieldHelpText(field = {}) {
  const parts = [];
  const helpText = clean(field?.helpText);
  const placeholder = clean(field?.placeholder);
  if (helpText) parts.push(helpText);
  if (placeholder && placeholder !== helpText) parts.push(`Expected: ${placeholder}`);
  (Array.isArray(field?.validationRules) ? field.validationRules : [])
    .filter((rule) => rule?.enabled !== false && clean(rule?.message))
    .forEach((rule) => parts.push(clean(rule.message)));
  return [...new Set(parts)].join(' ');
}

function toFieldDto(field = {}, extra = {}) {
  return {
    id: clean(field.id),
    label: clean(field.label || field.id || 'Field'),
    type: clean(field.type || 'text').toLowerCase() || 'text',
    required: field.required === true,
    readOnly: isReadOnlyField(field),
    calculated: isCalculatedField(field),
    valueMode: isCalculatedField(field) ? 'calculated' : 'manual',
    calculationRule: field?.calculationRule && typeof field.calculationRule === 'object'
      ? {
          enabled: field.calculationRule.enabled === true || String(field.calculationRule.enabled || '').toLowerCase() === 'true',
          expression: clean(field.calculationRule.expression),
          onError: clean(field.calculationRule.onError || 'keep_last').toLowerCase() === 'empty' ? 'empty' : 'keep_last'
        }
      : { enabled: false, expression: '', onError: 'keep_last' },
    calculationDependencies: Array.isArray(field?.calculationDependencies)
      ? field.calculationDependencies.map(clean).filter(Boolean)
      : [],
    sharedAcrossStudents: field.sharedAcrossStudents === true,
    fullPageWidth: field.fullPageWidth === true || String(field.fullPageWidth || '').toLowerCase() === 'true',
    prefillKey: clean(field.prefillKey),
    placeholder: clean(field.placeholder),
    helpText: buildFieldHelpText(field),
    options: Array.isArray(field.options)
      ? field.options.map((option) => ({
          value: String(option?.value ?? ''),
          label: clean(option?.label || option?.value)
        }))
      : [],
    ...extra
  };
}

function buildCalculationPrefill(template, prefill = {}) {
  const source = prefill && typeof prefill === 'object' ? prefill : {};
  const keys = new Set();
  const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
  fields.filter(isCalculatedField).forEach((field) => {
    const expression = clean(field?.calculationRule?.expression);
    const pattern = /\bprefill\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
    let match = pattern.exec(expression);
    while (match) {
      keys.add(match[1]);
      match = pattern.exec(expression);
    }
  });
  const out = {};
  keys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
  });
  return out;
}

function buildFieldSectionMap(template) {
  const sectionMap = new Map();
  const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
  let current = { id: 'shared-default', label: 'Shared fields' };
  fields.forEach((field, index) => {
    const type = clean(field?.type).toLowerCase();
    if (type === 'section') {
      current = {
        id: clean(field.id) || `section-${index + 1}`,
        label: clean(field.label) || 'Shared fields'
      };
      return;
    }
    if (type === 'subheader') {
      const subheaderId = clean(field.id) || `subheader-${index + 1}`;
      current = {
        id: `${current.id}--${subheaderId}`,
        label: [current.label, clean(field.label)].filter(Boolean).join(' / ') || 'Shared fields'
      };
      return;
    }
    if (field?.id && !isVisualField(field)) sectionMap.set(clean(field.id), current);
  });
  return sectionMap;
}

function findMatchingInstance(instances = [], { assignmentId, assignmentRowId, teacherId, studentId } = {}) {
  const targetKey = `student:${clean(studentId)}`;
  return (Array.isArray(instances) ? instances : []).find((row) => (
    idsEqual(row?.assignmentId, assignmentId)
    && clean(row?.assignmentRowId) === clean(assignmentRowId)
    && idsEqual(row?.teacherId, teacherId)
    && clean(row?.targetKey) === targetKey
    && clean(row?.status).toLowerCase() !== 'archived'
  )) || null;
}

async function resolveMatrixBase({ assignmentId, assignmentRowId = '', teacherId = '', studentId = '', reqUser } = {}) {
  const resolved = await reportIntegrityService.resolveStartInstanceContext({
    assignmentId,
    assignmentRowId,
    reqUser,
    requestedTeacherId: teacherId,
    fallbackTeacherId: reqUser?.personId || '',
    requestedStudentId: studentId
  });
  if (!reportService.isStudentTargetedScope(resolved.assignment?.reportScope)) {
    throw new Error('The report matrix is available only for student-targeted assignments.');
  }
  return resolved;
}

async function buildStudentMatrixRow({
  assignment,
  template,
  teacherId,
  studentId,
  instance,
  reqUser,
  treatSubmittedAsLocked = false
} = {}) {
  let effectiveInstance = instance;
  if (!effectiveInstance) {
    const prefillSnapshot = await reportService.buildPrefillSnapshot({
      assignment,
      teacherId,
      studentId,
      reqUser
    });
    effectiveInstance = {
      assignmentId: assignment.id,
      assignmentRowId: assignment.assignmentRowId || '',
      classId: assignment.classId,
      sessionId: assignment.sessionId,
      sessionDate: assignment.sessionDate,
      templateId: assignment.templateId,
      teacherId,
      studentId,
      targetKey: `student:${studentId}`,
      status: 'pending',
      answers: {},
      prefillSnapshot
    };
  }
  const mergedAnswers = reportService.mergeTemplateData(template, effectiveInstance, assignment);
  const prefill = effectiveInstance.prefillSnapshot || {};
  // Recompute once more from the values that will be rendered in the matrix.
  // This keeps calculated, read-only student fields visible even when an older
  // instance stored an empty/stale calculated answer.
  const recalculated = reportService.recomputeCalculatedAnswers({
    template,
    mergedAnswers,
    prefill
  });
  const renderedAnswers = recalculated && recalculated.answers && typeof recalculated.answers === 'object'
    ? recalculated.answers
    : mergedAnswers;
  const studentName = clean(
    renderedAnswers.student_full_name
    || prefill.student_full_name
    || prefill.student_preferred_name
    || prefill.student_name
    || studentId
  );
  const status = instance ? clean(instance.status || 'draft').toLowerCase() : 'pending';
  const instanceId = toPublicId(instance?.id);

  return {
    studentId: clean(studentId),
    studentName,
    instanceId: instanceId || '',
    isPending: !instanceId,
    status,
    locked: status === 'locked' || (status === 'submitted' && treatSubmittedAsLocked),
    answers: renderedAnswers,
    calculationPrefill: buildCalculationPrefill(template, prefill),
    editHref: instanceId ? `/school/reports/instances/edit-v2/${encodeURIComponent(instanceId)}` : ''
  };
}

function classifyMatrixFields(template, rows, assignment) {
  const fields = (Array.isArray(template?.schema?.fields) ? template.schema.fields : [])
    .filter((field) => field?.id && !isVisualField(field));
  const sectionMap = buildFieldSectionMap(template);
  const dtoExtras = (field) => {
    const section = sectionMap.get(clean(field.id)) || { id: 'shared-default', label: 'Shared fields' };
    return { sectionId: section.id, sectionLabel: section.label };
  };
  const studentNameFields = fields.filter(isStudentNameField);
  const sharedFields = fields.filter((field) => (
    field.sharedAcrossStudents === true
    && !isReadOnlyField(field)
    && !isCalculatedField(field)
  ));
  const sharedReadOnlyFields = fields.filter((field) => (
    field.sharedAcrossStudents === true
    && isReadOnlyField(field)
    && !isCalculatedField(field)
  ));
  const consumed = new Set([...studentNameFields, ...sharedFields, ...sharedReadOnlyFields].map((field) => clean(field.id)));
  const commonReadOnlyFields = [...sharedReadOnlyFields];

  fields.forEach((field) => {
    if (consumed.has(clean(field.id)) || !isReadOnlyField(field) || isCalculatedField(field)) return;
    const values = rows.map((row) => row.answers?.[field.id]);
    if (valuesAreIdentical(values)) {
      commonReadOnlyFields.push(field);
      consumed.add(clean(field.id));
    }
  });

  const sharedAnswers = assignment?.sharedAnswers && typeof assignment.sharedAnswers === 'object'
    ? assignment.sharedAnswers
    : {};
  const sharedFieldDtos = sharedFields.map((field) => {
    const hasSavedValue = Object.prototype.hasOwnProperty.call(sharedAnswers, field.id);
    const rowValues = rows.map((row) => row.answers?.[field.id]);
    const identicalInitialValues = valuesAreIdentical(rowValues);
    return toFieldDto(field, {
      ...dtoExtras(field),
      value: hasSavedValue ? sharedAnswers[field.id] : (identicalInitialValues ? rowValues[0] : ''),
      hasConflictingInitialValues: !hasSavedValue && !identicalInitialValues
    });
  });

  const commonFieldDtos = commonReadOnlyFields.map((field) => toFieldDto(field, {
    ...dtoExtras(field),
    value: Object.prototype.hasOwnProperty.call(sharedAnswers, field.id)
      ? sharedAnswers[field.id]
      : rows[0]?.answers?.[field.id]
  }));
  const tableFields = fields
    .filter((field) => !consumed.has(clean(field.id)))
    .map((field) => toFieldDto(field, dtoExtras(field)));

  const fieldDtosById = new Map(sharedFieldDtos.map((field) => [field.id, field]));
  const sharedGroups = [];
  const groupsById = new Map();
  fields.forEach((field) => {
    const dto = fieldDtosById.get(clean(field.id));
    if (!dto) return;
    const groupId = dto.sectionId || 'shared-default';
    let group = groupsById.get(groupId);
    if (!group) {
      group = { id: groupId, label: dto.sectionLabel || 'Shared fields', fields: [] };
      groupsById.set(groupId, group);
      sharedGroups.push(group);
    }
    group.fields.push(dto);
  });

  return {
    sharedFields: sharedFieldDtos,
    commonFields: commonFieldDtos,
    sharedGroups,
    tableFields,
    studentNameFieldIds: studentNameFields.map((field) => clean(field.id))
  };
}

function buildProgress(rows = []) {
  const total = rows.length;
  const submitted = rows.filter((row) => row.status === 'submitted' || row.status === 'locked').length;
  const drafts = rows.filter((row) => row.status === 'draft').length;
  return {
    total,
    submitted,
    drafts,
    pending: Math.max(0, total - submitted - drafts)
  };
}

async function buildMatrixContext({ assignmentId, assignmentRowId = '', teacherId = '', reqUser } = {}) {
  const resolved = await resolveMatrixBase({ assignmentId, assignmentRowId, teacherId, reqUser });
  const { assignment, assignmentRow, template, classData, teacherId: resolvedTeacherId, targetStudentIds } = resolved;
  await sessionConductService.assertAssignmentSessionConductReadyOrThrow({
    assignment,
    reqUser,
    schoolDataService
  });
  const isAdminEditor = await reportViewService.isReportInstanceAdminEditor(reqUser);
  const treatSubmittedAsLocked = !isAdminEditor;
  const instances = await schoolDataService.fetchData('reportInstances', {
    assignmentId__eq: assignment.id,
    page: 1,
    limit: 10000
  }, reqUser);
  const rows = await Promise.all(targetStudentIds.map((studentId) => buildStudentMatrixRow({
    assignment,
    template,
    teacherId: resolvedTeacherId,
    studentId,
    instance: findMatchingInstance(instances, {
      assignmentId: assignment.id,
      assignmentRowId: assignment.assignmentRowId || assignmentRow?.rowId || '',
      teacherId: resolvedTeacherId,
      studentId
    }),
    reqUser,
    treatSubmittedAsLocked
  })));
  rows.sort((a, b) => a.studentName.localeCompare(b.studentName) || a.studentId.localeCompare(b.studentId));
  const fieldGroups = classifyMatrixFields(template, rows, assignment);
  const teacherName = clean(rows[0]?.answers?.teacher_name || rows[0]?.answers?.instructor_name || resolvedTeacherId);
  const sharedFieldsGate = reportViewService.evaluateSharedFieldsEditability({
    assignment,
    template,
    instances,
    currentInstanceId: '',
    allowAdminOverride: isAdminEditor
  });

  return {
    assignmentId: toPublicId(assignment.id),
    assignmentRowId: clean(assignment.assignmentRowId || assignmentRow?.rowId),
    templateId: toPublicId(template.id),
    templateTitle: clean(template.title || template.name || 'Report'),
    classId: toPublicId(classData?.id || assignment.classId),
    className: clean(classData?.title || assignment.classId),
    sessionId: clean(assignment.sessionId),
    sessionDate: clean(assignment.sessionDate || assignment.reportDueDate),
    reportStartDate: clean(assignment.reportStartDate),
    reportDueDate: clean(assignment.reportDueDate || assignment.dueDate || assignment.sessionDate),
    teacherId: clean(resolvedTeacherId),
    teacherName,
    scope: clean(assignment.reportScope).toLowerCase(),
    sharedFieldsEditable: sharedFieldsGate.sharedFieldsEditable,
    sharedFieldsLockReason: sharedFieldsGate.reason || '',
    sharedFieldsBlockingSiblingCount: sharedFieldsGate.blockingSiblingCount || 0,
    ...fieldGroups,
    rows,
    progress: buildProgress(rows)
  };
}

function matrixPayloadToFormBody(template, rowAnswers = {}, sharedAnswers = {}, submitAction = 'save') {
  const body = { submitAction };
  (Array.isArray(template?.schema?.fields) ? template.schema.fields : []).forEach((field) => {
    if (!field?.id || isVisualField(field)) return;
    const source = field.sharedAcrossStudents === true ? sharedAnswers : rowAnswers;
    body[`field__${field.id}`] = source && Object.prototype.hasOwnProperty.call(source, field.id)
      ? source[field.id]
      : undefined;
  });
  return body;
}

async function saveMatrixRow({
  assignmentId,
  assignmentRowId = '',
  teacherId = '',
  studentId = '',
  submitAction = 'save',
  answers = {},
  sharedAnswers = {},
  reqUser,
  includeMatrix = true
} = {}) {
  const resolved = await resolveMatrixBase({ assignmentId, assignmentRowId, teacherId, studentId, reqUser });
  const { assignment, assignmentRow, template, teacherId: resolvedTeacherId } = resolved;
  await sessionConductService.assertAssignmentSessionConductReadyOrThrow({
    assignment,
    reqUser,
    schoolDataService
  });
  const resolvedStudentId = studentId && resolved.targetStudentIds.some((targetId) => idsEqual(targetId, studentId))
    ? studentId
    : resolved.targetStudentIds[0];
  const instances = await schoolDataService.fetchData('reportInstances', {
    assignmentId__eq: assignment.id,
    page: 1,
    limit: 10000
  }, reqUser);
  let instance = findMatchingInstance(instances, {
    assignmentId: assignment.id,
    assignmentRowId: assignment.assignmentRowId || assignmentRow?.rowId || '',
    teacherId: resolvedTeacherId,
    studentId: resolvedStudentId
  });

  if (instance) {
    const allowed = await reportViewService.canEditReportInstanceAnswers(instance, reqUser);
    if (!allowed) {
      const status = clean(instance.status).toLowerCase();
      if (status === 'locked') {
        throw new Error('Locked report instances cannot be changed.');
      }
      if (status === 'submitted') {
        throw new Error(
          'Submitted report instances can only be edited by an administrator. Ask an admin to reopen as draft.'
        );
      }
      throw new Error('This report instance cannot be changed.');
    }
  }

  if (!instance) {
    const prefillSnapshot = await reportService.buildPrefillSnapshot({
      assignment,
      teacherId: resolvedTeacherId,
      studentId: resolvedStudentId,
      reqUser
    });
    instance = await schoolDataService.addData('reportInstances', {
      orgId: assignment.orgId,
      assignmentId: assignment.id,
      assignmentRowId: assignment.assignmentRowId || assignmentRow?.rowId || '',
      classId: assignment.classId,
      sessionId: assignment.sessionId,
      sessionDate: assignment.sessionDate,
      templateId: assignment.templateId,
      templateVersion: assignment.templateVersion || template?.schema?.version || 1,
      teacherId: resolvedTeacherId,
      studentId: resolvedStudentId,
      targetKey: `student:${resolvedStudentId}`,
      status: 'draft',
      answers: {},
      prefillSnapshot,
      generatedDocs: [],
      audit: {
        createUser: reqUser?.id || '',
        createDateTime: new Date().toISOString(),
        lastUpdateUser: reqUser?.id || '',
        lastUpdateDateTime: new Date().toISOString()
      }
    }, reqUser);
  }

  const result = await reportInstanceSaveService.persistInstanceAnswers({
    instance,
    template,
    assignment,
    body: matrixPayloadToFormBody(template, answers, sharedAnswers, submitAction),
    submitAction,
    reqUser
  });
  const matrix = includeMatrix
    ? await buildMatrixContext({
        assignmentId: assignment.id,
        assignmentRowId: assignment.assignmentRowId || assignmentRow?.rowId || '',
        teacherId: resolvedTeacherId,
        reqUser
      })
    : null;

  return {
    instanceId: toPublicId(result.updatedInstance?.id || instance.id),
    status: result.nextStatus,
    validation: result.validationSummary,
    matrix
  };
}

async function saveMatrixRows({
  assignmentId,
  assignmentRowId = '',
  teacherId = '',
  rows = [],
  submitAction = 'save',
  sharedAnswers = {},
  reqUser
} = {}) {
  const resolved = await resolveMatrixBase({ assignmentId, assignmentRowId, teacherId, reqUser });
  const { assignment, assignmentRow, teacherId: resolvedTeacherId, targetStudentIds } = resolved;
  const instances = await schoolDataService.fetchData('reportInstances', {
    assignmentId__eq: assignment.id,
    page: 1,
    limit: 10000
  }, reqUser);
  const requestedRows = Array.isArray(rows) ? rows : [];
  const results = [];

  for (const row of requestedRows) {
    const studentId = clean(row?.studentId);
    if (!studentId) continue;
    const allowed = targetStudentIds.some((targetId) => idsEqual(targetId, studentId));
    if (!allowed) {
      results.push({ studentId, status: 'error', message: 'This student is not targeted by the report assignment.' });
      continue;
    }
    const instance = findMatchingInstance(instances, {
      assignmentId: assignment.id,
      assignmentRowId: assignment.assignmentRowId || assignmentRow?.rowId || '',
      teacherId: resolvedTeacherId,
      studentId
    });
    if (instance) {
      const canEdit = await reportViewService.canEditReportInstanceAnswers(instance, reqUser);
      if (!canEdit) {
        const reportStatus = clean(instance.status).toLowerCase() || 'unknown';
        results.push({
          studentId,
          status: 'skipped',
          reportStatus,
          message: reportStatus === 'submitted'
            ? 'Submitted report instance was skipped (admin reopen required).'
            : 'Locked report instance was skipped.'
        });
        continue;
      }
    }
    try {
      const saved = await saveMatrixRow({
        assignmentId: assignment.id,
        assignmentRowId: assignment.assignmentRowId || assignmentRow?.rowId || '',
        teacherId: resolvedTeacherId,
        studentId,
        submitAction,
        answers: row?.answers && typeof row.answers === 'object' ? row.answers : {},
        sharedAnswers: sharedAnswers && typeof sharedAnswers === 'object' ? sharedAnswers : {},
        reqUser,
        includeMatrix: false
      });
      results.push({
        studentId,
        status: 'success',
        reportStatus: saved.status,
        instanceId: saved.instanceId,
        validation: saved.validation
      });
    } catch (error) {
      results.push({
        studentId,
        status: 'error',
        message: error.message,
        validation: error.validationSummary || null
      });
    }
  }

  const matrix = await buildMatrixContext({
    assignmentId: assignment.id,
    assignmentRowId: assignment.assignmentRowId || assignmentRow?.rowId || '',
    teacherId: resolvedTeacherId,
    reqUser
  });
  const summary = {
    total: requestedRows.length,
    succeeded: results.filter((result) => result.status === 'success').length,
    failed: results.filter((result) => result.status === 'error').length,
    skipped: results.filter((result) => result.status === 'skipped').length
  };
  return { results, summary, matrix };
}

async function lockMatrixRows({
  assignmentId,
  assignmentRowId = '',
  teacherId = '',
  rows = [],
  reqUser
} = {}) {
  const resolved = await resolveMatrixBase({ assignmentId, assignmentRowId, teacherId, reqUser });
  const { assignment, assignmentRow, teacherId: resolvedTeacherId, targetStudentIds } = resolved;
  const effectiveRowId = assignment.assignmentRowId || assignmentRow?.rowId || '';
  const instances = await schoolDataService.fetchData('reportInstances', {
    assignmentId__eq: assignment.id,
    page: 1,
    limit: 10000
  }, reqUser);
  const requestedRows = Array.isArray(rows) ? rows : [];
  const results = [];

  for (const row of requestedRows) {
    const studentId = clean(row?.studentId);
    if (!studentId) continue;
    if (!targetStudentIds.some((targetId) => idsEqual(targetId, studentId))) {
      results.push({ studentId, status: 'error', message: 'This student is not targeted by the report assignment.' });
      continue;
    }
    const instance = findMatchingInstance(instances, {
      assignmentId: assignment.id,
      assignmentRowId: effectiveRowId,
      teacherId: resolvedTeacherId,
      studentId
    });
    if (!instance) {
      results.push({ studentId, status: 'skipped', message: 'A pending report must be saved before it can be locked.' });
      continue;
    }
    if (clean(instance.status).toLowerCase() === 'locked') {
      results.push({ studentId, status: 'skipped', reportStatus: 'locked', instanceId: toPublicId(instance.id), message: 'Report instance is already locked.' });
      continue;
    }
    try {
      const now = new Date().toISOString();
      await schoolDataService.updateData('reportInstances', instance.id, {
        status: 'locked',
        audit: {
          lastUpdateUser: reqUser?.id || '',
          lastUpdateDateTime: now,
          lockedAt: instance.audit?.lockedAt || now
        }
      }, reqUser);
      results.push({ studentId, status: 'success', reportStatus: 'locked', instanceId: toPublicId(instance.id) });
    } catch (error) {
      results.push({ studentId, status: 'error', message: error.message });
    }
  }

  const matrix = await buildMatrixContext({
    assignmentId: assignment.id,
    assignmentRowId: effectiveRowId,
    teacherId: resolvedTeacherId,
    reqUser
  });
  const summary = {
    total: requestedRows.length,
    succeeded: results.filter((result) => result.status === 'success').length,
    failed: results.filter((result) => result.status === 'error').length,
    skipped: results.filter((result) => result.status === 'skipped').length
  };
  return { results, summary, matrix };
}


function coerceMatrixPrefillValue(field, value) {
  if (value === undefined || value === null) return '';
  const type = clean(field?.type).toLowerCase();
  if (type === 'number' || type === 'decimal' || type === 'currency') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  }
  if (type === 'checkbox' || type === 'boolean') return value === true || String(value).toLowerCase() === 'true';
  return value;
}

async function resolveMatrixData({ assignmentId, assignmentRowId = '', teacherId = '', reqUser } = {}) {
  const resolved = await resolveMatrixBase({ assignmentId, assignmentRowId, teacherId, reqUser });
  const { assignment, assignmentRow, template, teacherId: resolvedTeacherId, targetStudentIds } = resolved;
  const instances = await schoolDataService.fetchData('reportInstances', { assignmentId__eq: assignment.id, page: 1, limit: 10000 }, reqUser);
  const effectiveRowId = assignment.assignmentRowId || assignmentRow?.rowId || assignmentRowId || '';
  return { ...resolved, assignmentRowId: effectiveRowId, resolvedTeacherId, instances, template, assignment, targetStudentIds };
}

async function buildMatrixPrefillPreview({ assignmentId, assignmentRowId = '', teacherId = '', reqUser } = {}) {
  const source = await resolveMatrixData({ assignmentId, assignmentRowId, teacherId, reqUser });
  const fields = (Array.isArray(source.template?.schema?.fields) ? source.template.schema.fields : [])
    .filter((field) => field?.id && !isVisualField(field) && reportService.normalizePrefillKey(field?.prefillKey || ''));
  const students = [];
  for (const studentId of source.targetStudentIds) {
    const instance = findMatchingInstance(source.instances, { assignmentId: source.assignment.id, assignmentRowId: source.assignmentRowId, teacherId: source.resolvedTeacherId, studentId });
    const row = await buildStudentMatrixRow({ assignment: source.assignment, template: source.template, teacherId: source.resolvedTeacherId, studentId, instance, reqUser });
    if (!instance) {
      students.push({ studentId: row.studentId, studentName: row.studentName, status: 'pending', locked: false, pending: true, changes: [] });
      continue;
    }
    const oldPrefill = instance.prefillSnapshot && typeof instance.prefillSnapshot === 'object' ? instance.prefillSnapshot : {};
    const refreshedPrefill = await reportService.buildPrefillSnapshot({ assignment: source.assignment, teacherId: source.resolvedTeacherId, studentId, reqUser });
    const merged = reportService.mergeTemplateData(source.template, instance, source.assignment);
    const changes = new Map();
    for (const field of fields) {
      const key = reportService.normalizePrefillKey(field.prefillKey || '');
      const oldResolved = getPrefillValue(oldPrefill, key);
      const newResolved = getPrefillValue(refreshedPrefill, key);
      const oldValue = oldResolved.found ? oldResolved.value : undefined;
      const newValue = newResolved.found ? newResolved.value : undefined;
      if (stableValueToken(oldValue) === stableValueToken(newValue) || !newResolved.found) continue;
      if (!changes.has(key)) changes.set(key, { prefillKey: key, oldRawValue: oldValue, newRawValue: newValue, fields: [] });
      changes.get(key).fields.push({ fieldId: String(field.id), label: String(field.label || field.id), type: clean(field.type).toLowerCase(), oldValue: coerceMatrixPrefillValue(field, oldValue), newValue: coerceMatrixPrefillValue(field, newValue), currentValue: merged[field.id], oldRawValue: oldValue, newRawValue: newValue });
    }
    const status = clean(instance.status || 'draft').toLowerCase();
    students.push({ studentId: row.studentId, studentName: row.studentName, status, locked: status === 'locked', pending: false, changes: Array.from(changes.values()) });
  }
  return { status: 'success', assignmentId: toPublicId(source.assignment.id), assignmentRowId: source.assignmentRowId, students, summary: { total: students.length, changed: students.filter((s) => s.changes.length).length, locked: students.filter((s) => s.locked).length, pending: students.filter((s) => s.pending).length } };
}

async function applyMatrixPrefill({ assignmentId, assignmentRowId = '', teacherId = '', updates = [], reqUser } = {}) {
  const source = await resolveMatrixData({ assignmentId, assignmentRowId, teacherId, reqUser });
  const preview = await buildMatrixPrefillPreview({ assignmentId, assignmentRowId: source.assignmentRowId, teacherId: source.resolvedTeacherId, reqUser });
  const requested = Array.isArray(updates) ? updates : [];
  const results = [];
  for (const update of requested) {
    const studentId = clean(update?.studentId);
    const instance = findMatchingInstance(source.instances, { assignmentId: source.assignment.id, assignmentRowId: source.assignmentRowId, teacherId: source.resolvedTeacherId, studentId });
    const previewStudent = preview.students.find((student) => idsEqual(student.studentId, studentId));
    if (!instance || previewStudent?.locked) { results.push({ studentId, status: 'skipped', message: !instance ? 'Pending student has no stored snapshot.' : 'Locked report instance was skipped.' }); continue; }
    const keys = new Set((Array.isArray(update?.prefillKeys) ? update.prefillKeys : []).map((key) => reportService.normalizePrefillKey(key)).filter(Boolean));
    const changes = (previewStudent?.changes || []).filter((change) => keys.has(change.prefillKey));
    if (!changes.length) { results.push({ studentId, status: 'skipped', message: 'No selected prefill changes remain.' }); continue; }
    const nextPrefill = { ...(instance.prefillSnapshot || {}) };
    const nextAnswers = { ...(instance.answers || {}) };
    changes.forEach((change) => { nextPrefill[change.prefillKey] = change.newRawValue; (change.fields || []).forEach((field) => { nextAnswers[field.fieldId] = field.newValue; }); });
    const merged = reportService.mergeTemplateData(source.template, { ...instance, prefillSnapshot: nextPrefill, answers: nextAnswers }, source.assignment);
    const recalculated = reportService.recomputeCalculatedAnswers({ template: source.template, mergedAnswers: merged, prefill: nextPrefill });
    (Array.isArray(source.template?.schema?.fields) ? source.template.schema.fields : []).filter((field) => isCalculatedField(field) && field.id).forEach((field) => { nextAnswers[field.id] = recalculated.answers[field.id]; });
    await schoolDataService.updateData('reportInstances', instance.id, { prefillSnapshot: nextPrefill, answers: nextAnswers, audit: { lastUpdateUser: reqUser?.id || '', lastUpdateDateTime: new Date().toISOString(), prefillRefreshedAt: new Date().toISOString() } }, reqUser);
    results.push({ studentId, status: 'success', appliedCount: changes.length });
  }
  const matrix = await buildMatrixContext({ assignmentId, assignmentRowId: source.assignmentRowId, teacherId: source.resolvedTeacherId, reqUser });
  return { results, matrix, summary: { total: requested.length, succeeded: results.filter((r) => r.status === 'success').length, skipped: results.filter((r) => r.status === 'skipped').length, failed: results.filter((r) => r.status === 'error').length } };
}

async function buildMatrixExportPayload({ assignmentId, assignmentRowId = '', teacherId = '', reqUser } = {}) {
  const source = await resolveMatrixData({ assignmentId, assignmentRowId, teacherId, reqUser });
  const matrix = await buildMatrixContext({ assignmentId, assignmentRowId: source.assignmentRowId, teacherId: source.resolvedTeacherId, reqUser });
  const rows = [];
  for (const row of matrix.rows) {
    const instance = findMatchingInstance(source.instances, { assignmentId: source.assignment.id, assignmentRowId: source.assignmentRowId, teacherId: source.resolvedTeacherId, studentId: row.studentId });
    const effective = instance || { id: '', status: 'pending', studentId: row.studentId, teacherId: source.resolvedTeacherId, answers: {}, prefillSnapshot: await reportService.buildPrefillSnapshot({ assignment: source.assignment, teacherId: source.resolvedTeacherId, studentId: row.studentId, reqUser }) };
    rows.push({ studentId: row.studentId, studentName: row.studentName, status: row.status, locked: row.locked, pending: row.isPending, instanceId: row.instanceId, prefillSnapshot: effective.prefillSnapshot || {}, answers: effective.answers || {}, rawAnswers: effective.answers || {}, mergedAnswers: reportService.mergeTemplateData(source.template, effective, source.assignment) });
  }
  return {
    assignmentId: matrix.assignmentId,
    assignmentRowId: matrix.assignmentRowId,
    templateId: matrix.templateId,
    templateTitle: matrix.templateTitle,
    classId: matrix.classId,
    className: matrix.className,
    sessionId: matrix.sessionId,
    sessionDate: matrix.sessionDate,
    teacherId: matrix.teacherId,
    reportStartDate: matrix.reportStartDate,
    reportDueDate: matrix.reportDueDate,
    assignmentSharedAnswers: source.assignment.sharedAnswers || {},
    sharedAnswers: source.assignment.sharedAnswers || {},
    commonFields: matrix.commonFields,
    sharedFields: matrix.sharedFields,
    rows
  };
}

module.exports = {
  isVisualField,
  isCalculatedField,
  isReadOnlyField,
  isStudentNameField,
  valuesAreIdentical,
  buildFieldHelpText,
  buildFieldSectionMap,
  buildCalculationPrefill,
  findMatchingInstance,
  classifyMatrixFields,
  buildProgress,
  buildMatrixContext,
  matrixPayloadToFormBody,
  saveMatrixRow,
  saveMatrixRows,
  lockMatrixRows,
  buildMatrixPrefillPreview,
  applyMatrixPrefill,
  buildMatrixExportPayload
};
