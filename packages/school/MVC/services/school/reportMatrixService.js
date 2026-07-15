const schoolDataService = require('./schoolDataService');
const reportService = require('./reportService');
const reportIntegrityService = require('./reportIntegrityService');
const reportInstanceSaveService = require('./reportInstanceSaveService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

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
    sharedAcrossStudents: field.sharedAcrossStudents === true,
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

async function buildStudentMatrixRow({ assignment, template, teacherId, studentId, instance, reqUser } = {}) {
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
  const studentName = clean(
    mergedAnswers.student_full_name
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
    locked: status === 'locked',
    answers: mergedAnswers,
    editHref: instanceId ? `/school/reports/instances/edit-v2/${encodeURIComponent(instanceId)}` : ''
  };
}

function classifyMatrixFields(template, rows, assignment) {
  const fields = (Array.isArray(template?.schema?.fields) ? template.schema.fields : [])
    .filter((field) => field?.id && !isVisualField(field));
  const studentNameFields = fields.filter(isStudentNameField);
  const sharedFields = fields.filter((field) => field.sharedAcrossStudents === true);
  const consumed = new Set([...studentNameFields, ...sharedFields].map((field) => clean(field.id)));
  const commonReadOnlyFields = [];

  fields.forEach((field) => {
    if (consumed.has(clean(field.id)) || !isReadOnlyField(field)) return;
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
      value: hasSavedValue ? sharedAnswers[field.id] : (identicalInitialValues ? rowValues[0] : ''),
      hasConflictingInitialValues: !hasSavedValue && !identicalInitialValues
    });
  });

  const commonFieldDtos = commonReadOnlyFields.map((field) => toFieldDto(field, {
    value: rows[0]?.answers?.[field.id]
  }));
  const tableFields = fields
    .filter((field) => !consumed.has(clean(field.id)))
    .map((field) => toFieldDto(field));

  return {
    sharedFields: sharedFieldDtos,
    commonFields: commonFieldDtos,
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
    reqUser
  })));
  rows.sort((a, b) => a.studentName.localeCompare(b.studentName) || a.studentId.localeCompare(b.studentId));
  const fieldGroups = classifyMatrixFields(template, rows, assignment);
  const teacherName = clean(rows[0]?.answers?.teacher_name || rows[0]?.answers?.instructor_name || resolvedTeacherId);

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
  reqUser
} = {}) {
  const resolved = await resolveMatrixBase({ assignmentId, assignmentRowId, teacherId, studentId, reqUser });
  const { assignment, assignmentRow, template, teacherId: resolvedTeacherId } = resolved;
  const resolvedStudentId = resolved.targetStudentIds[0];
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

  if (instance && clean(instance.status).toLowerCase() === 'locked') {
    throw new Error('Locked report instances cannot be changed.');
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
  const matrix = await buildMatrixContext({
    assignmentId: assignment.id,
    assignmentRowId: assignment.assignmentRowId || assignmentRow?.rowId || '',
    teacherId: resolvedTeacherId,
    reqUser
  });

  return {
    instanceId: toPublicId(result.updatedInstance?.id || instance.id),
    status: result.nextStatus,
    validation: result.validationSummary,
    matrix
  };
}

module.exports = {
  isVisualField,
  isCalculatedField,
  isReadOnlyField,
  isStudentNameField,
  valuesAreIdentical,
  buildFieldHelpText,
  findMatchingInstance,
  classifyMatrixFields,
  buildProgress,
  buildMatrixContext,
  matrixPayloadToFormBody,
  saveMatrixRow
};
