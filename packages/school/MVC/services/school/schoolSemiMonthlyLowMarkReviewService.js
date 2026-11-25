'use strict';

const schoolDataService = require('./schoolDataService');
const schoolSemiMonthlyReportService = require('./schoolSemiMonthlyReportService');
const semiMonthlyReportPolicyModel = require('../../models/school/semiMonthlyReportPolicyModel');
const semiMonthlyReportPolicyService = require('./semiMonthlyReportPolicyService');
const studentAttendanceReportService = require('./studentAttendanceReportService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const rollingEnrollmentPeriodFilterService = require('./rollingEnrollmentPeriodFilterService');
const reportFunderDocxService = require('./reportFunderDocxService');
const reportService = require('./reportService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const { runWithConcurrency } = require('../../utils/asyncPool');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const {
  periodQualifiesForFunderSelection,
  periodOverlapsReportRange
} = require('./schoolSemiMonthlyReportByFunderService');

const AVERAGE_CLASS_MARK_LABEL = 'Average Class Mark (Auto Calculation)';
const FALLBACK_FIELD_IDS = ['Average_Class_Mark', 'average_class_mark'];
const sarExportJobService = require('./sarExportJobService');

const REVIEW_METRICS = Object.freeze([
  Object.freeze({
    key: 'attendance',
    uiLabel: 'Attendance',
    labels: ['Attendance'],
    fieldIds: ['Attendance', 'attendance'],
    prefillKeys: ['student_attendance_span_percent']
  }),
  Object.freeze({
    key: 'punctuality',
    uiLabel: 'Punctuality',
    labels: ['Punctuality', 'Punctuality For Class'],
    fieldIds: ['Punctuality', 'punctuality'],
    prefillKeys: ['student_punctuality_span_percent']
  }),
  Object.freeze({
    key: 'speaking',
    uiLabel: 'Speaking',
    labels: ['Speaking', 'Presentation / Speaking Tasks'],
    labelContains: ['presentation', 'speaking tasks'],
    fieldIds: ['speaking', 'speaking_avg', 'Speaking'],
    prefillKeys: ['student_gradebook_skill_speaking_avg_percent']
  }),
  Object.freeze({
    key: 'listening',
    uiLabel: 'Listening',
    labels: ['Listening', 'Listening Comprehension Tasks'],
    labelContains: ['listening comprehension'],
    fieldIds: ['listening', 'listening_avg', 'Listening'],
    prefillKeys: ['student_gradebook_skill_listening_avg_percent']
  }),
  Object.freeze({
    key: 'reading',
    uiLabel: 'Reading',
    labels: ['Reading', 'Reading Comprehension'],
    labelContains: ['reading comprehension'],
    fieldIds: ['reading', 'reading_avg', 'Reading'],
    prefillKeys: ['student_gradebook_skill_reading_avg_percent']
  }),
  Object.freeze({
    key: 'writing',
    uiLabel: 'Writing',
    labels: ['Writing', 'Grammar / Vocab Tasks & Writing Tasks'],
    labelContains: ['grammar / vocab', 'writing tasks'],
    fieldIds: ['writing', 'writing_avg', 'Writing'],
    prefillKeys: ['student_gradebook_skill_writing_avg_percent']
  }),
  Object.freeze({
    key: 'average_class_mark',
    uiLabel: 'Average Class Mark',
    labels: [],
    fieldIds: [],
    prefillKeys: []
  })
]);

const REVIEW_METRIC_BY_KEY = new Map(REVIEW_METRICS.map((row) => [row.key, row]));
const REVIEW_METRIC_KEY_SET = new Set(REVIEW_METRICS.map((row) => row.key));

const DEFAULT_METRIC_KEYS = ['average_class_mark'];

function collectCellRowsForDate(
  studentRecordId,
  sessionDate,
  selectedMetricKeys = [],
  evaluations = [],
  onlyBelowThreshold = true
) {
  const forSlot = evaluations.filter(
    (row) => row.studentRecordId === studentRecordId && row.sessionDate === sessionDate
  );
  if (!forSlot.length) return [];

  const multiMetric = selectedMetricKeys.length > 1;
  if (!multiMetric) {
    let rows = forSlot;
    if (onlyBelowThreshold) rows = rows.filter((entry) => !entry.passesThreshold);
    return rows;
  }

  const failingInstanceIds = new Set(
    forSlot.filter((row) => !row.passesThreshold).map((row) => row.instanceId)
  );
  if (!failingInstanceIds.size) {
    failingInstanceIds.clear();
    forSlot.forEach((row) => failingInstanceIds.add(row.instanceId));
  }

  const expanded = [];
  failingInstanceIds.forEach((instanceId) => {
    selectedMetricKeys.forEach((metricKey) => {
      const row = forSlot.find(
        (entry) => entry.instanceId === instanceId && entry.metricKey === metricKey
      );
      if (!row) return;
      if (onlyBelowThreshold && row.passesThreshold) return;
      expanded.push(row);
    });
  });

  if (!expanded.length && multiMetric) {
    const fallback = forSlot.filter((entry) => !entry.passesThreshold);
    if (fallback.length) return fallback;
  }

  return expanded.length ? expanded : forSlot.filter((entry) => !entry.passesThreshold);
}

function normalizeDateOnly(value = '') {
  return schoolSemiMonthlyReportService.normalizeDateOnly(value);
}

function parseIdList(value = '') {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[,|]/)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function parseThreshold(value) {
  const n = Number.parseFloat(String(value ?? '').trim());
  if (!Number.isFinite(n) || n < 1 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

function normalizeFieldLabel(value = '') {
  return String(value || '').trim().toLowerCase();
}

function isExcludedMetricField(field = {}) {
  const label = normalizeFieldLabel(field?.label);
  if (!label) return false;
  if (label.startsWith('future goal:')) return true;
  return false;
}

function listNumberFields(template = {}) {
  const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
  return fields.filter((field) => {
    if (String(field?.type || '').trim().toLowerCase() !== 'number') return false;
    if (isExcludedMetricField(field)) return false;
    return Boolean(String(field?.id || '').trim());
  });
}

function resolveAverageClassMarkField(template = {}) {
  const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
  const byLabel = fields.filter(
    (field) => normalizeFieldLabel(field?.label) === normalizeFieldLabel(AVERAGE_CLASS_MARK_LABEL)
  );
  if (byLabel.length) {
    const calculated = byLabel.find((field) => String(field?.valueMode || '').toLowerCase() === 'calculated');
    const pick = calculated || byLabel[0];
    if (pick?.id) return { fieldId: String(pick.id).trim(), field: pick };
  }
  for (const id of FALLBACK_FIELD_IDS) {
    const field = fields.find((row) => String(row?.id || '').trim() === id);
    if (field) return { fieldId: id, field };
  }
  return null;
}

function resolveMetricField(template = {}, metricKey = '') {
  const key = String(metricKey || '').trim();
  const metric = REVIEW_METRIC_BY_KEY.get(key);
  if (!metric) return null;
  if (key === 'average_class_mark') {
    return resolveAverageClassMarkField(template);
  }
  const numberFields = listNumberFields(template);
  const labelNorms = (metric.labels || []).map((label) => normalizeFieldLabel(label)).filter(Boolean);
  for (const field of numberFields) {
    const fieldLabel = normalizeFieldLabel(field.label);
    if (labelNorms.includes(fieldLabel)) {
      return { fieldId: String(field.id).trim(), field };
    }
  }
  for (const id of metric.fieldIds || []) {
    const token = String(id || '').trim();
    if (!token) continue;
    const field = numberFields.find((row) => String(row.id || '').trim() === token);
    if (field) return { fieldId: token, field };
  }
  for (const prefillKey of metric.prefillKeys || []) {
    const token = String(prefillKey || '').trim();
    if (!token) continue;
    const field = numberFields.find((row) => String(row.prefillKey || '').trim() === token);
    if (field?.id) return { fieldId: String(field.id).trim(), field };
  }
  for (const fragment of metric.labelContains || []) {
    const needle = normalizeFieldLabel(fragment);
    if (!needle) continue;
    const field = numberFields.find((row) => normalizeFieldLabel(row.label).includes(needle));
    if (field?.id) return { fieldId: String(field.id).trim(), field };
  }
  return null;
}

function parseMetricKeys(value) {
  const raw = value;
  let tokens = [];
  if (Array.isArray(raw)) tokens = raw;
  else if (raw !== undefined && raw !== null && raw !== '') tokens = parseIdList(raw);
  const unique = [];
  const seen = new Set();
  tokens.forEach((item) => {
    const key = String(item || '').trim();
    if (!REVIEW_METRIC_KEY_SET.has(key) || seen.has(key)) return;
    seen.add(key);
    unique.push(key);
  });
  return unique.length ? unique : [...DEFAULT_METRIC_KEYS];
}

function auditConfiguredTemplates(
  templateIds = [],
  templateById = new Map(),
  labelById = new Map(),
  selectedMetricKeys = DEFAULT_METRIC_KEYS
) {
  const warnings = [];
  const fieldsByTemplateId = new Map();
  const metricKeys = parseMetricKeys(selectedMetricKeys);
  (Array.isArray(templateIds) ? templateIds : []).forEach((templateId) => {
    const token = String(templateId || '').trim();
    if (!token) return;
    const template = templateById.get(token);
    const templateLabel = labelById.get(token) || token;
    if (!template) {
      warnings.push({
        templateId: token,
        templateLabel,
        message: 'Template could not be loaded.'
      });
      return;
    }
    const metricMap = new Map();
    const missingMetrics = [];
    metricKeys.forEach((metricKey) => {
      const metric = REVIEW_METRIC_BY_KEY.get(metricKey);
      const resolved = resolveMetricField(template, metricKey);
      if (resolved?.fieldId) {
        metricMap.set(metricKey, resolved.fieldId);
        return;
      }
      missingMetrics.push(metric?.uiLabel || metricKey);
    });
    if (metricMap.size) fieldsByTemplateId.set(token, metricMap);
    if (!metricMap.size) {
      warnings.push({
        templateId: token,
        templateLabel,
        severity: 'error',
        message: `${templateLabel}: none of the selected metrics exist on this template.`
      });
    }
  });
  return { fieldsByTemplateId, warnings, selectedMetricKeys: metricKeys };
}

function intersectStudentRecordIdSets(sets = []) {
  const active = sets.filter((set) => set instanceof Set && set.size > 0);
  if (!active.length) return null;
  let result = new Set(active[0]);
  for (let i = 1; i < active.length; i += 1) {
    result = new Set([...result].filter((id) => active[i].has(id)));
  }
  return result;
}

function instanceStudentRecordId(instance = {}) {
  const direct = String(instance?.studentId || '').trim();
  if (direct) return toPublicId(direct) || direct;
  const prefill = String(
    instance?.prefillSnapshot?.student_record_id
    || instance?.prefillSnapshot?.studentRecordId
    || ''
  ).trim();
  return toPublicId(prefill) || prefill;
}

function studentAllowedForInstance(instance = {}, allowedStudentRecordIds = null, resolveCanonical = null) {
  if (!(allowedStudentRecordIds instanceof Set)) return true;
  const raw = instanceStudentRecordId(instance);
  if (!raw) return false;
  const sid = typeof resolveCanonical === 'function' ? resolveCanonical(raw) : raw;
  for (const allowed of allowedStudentRecordIds) {
    const allowedCanonical = typeof resolveCanonical === 'function' ? resolveCanonical(allowed) : allowed;
    if (idsEqual(allowedCanonical, sid) || idsEqual(allowed, raw)) return true;
  }
  return false;
}

function lookupStudentLabel(labelByRecordId, studentRecordId = '') {
  const token = String(studentRecordId || '').trim();
  if (!token || !(labelByRecordId instanceof Map)) return null;
  if (labelByRecordId.has(token)) return labelByRecordId.get(token);
  for (const [key, meta] of labelByRecordId.entries()) {
    if (idsEqual(key, token)) return meta;
  }
  return null;
}

async function buildStudentIdentityIndex(req) {
  const routeAccessContext = schoolDataService.buildRouteAccessContext(req);
  const students = await schoolDataService.fetchAllData('students', {}, req.user, routeAccessContext);
  const aliasToRecordId = new Map();
  const registerAlias = (alias, recordId) => {
    const aliasToken = String(alias || '').trim();
    const recordToken = String(recordId || '').trim();
    if (!aliasToken || !recordToken) return;
    aliasToRecordId.set(aliasToken, recordToken);
    aliasToRecordId.set(aliasToken.toLowerCase(), recordToken);
    const publicAlias = toPublicId(aliasToken);
    if (publicAlias && publicAlias !== aliasToken) {
      aliasToRecordId.set(publicAlias, recordToken);
    }
  };

  const personIds = [];
  (Array.isArray(students) ? students : []).forEach((row) => {
    const studentRecordId = toPublicId(row?.id) || String(row?.id || '').trim();
    if (!studentRecordId) return;
    registerAlias(studentRecordId, studentRecordId);
    registerAlias(row?.id, studentRecordId);
    const personId = toPublicId(row?.personId) || String(row?.personId || '').trim();
    if (personId) {
      personIds.push(personId);
      registerAlias(personId, studentRecordId);
    }
    registerAlias(row?.studentNumber, studentRecordId);
    registerAlias(row?.customStudentId, studentRecordId);
  });

  const personById = await schoolPersonAccessService.buildPersonByIdMap({
    reqUser: req.user,
    personIds
  });

  const labelByRecordId = new Map();
  (Array.isArray(students) ? students : []).forEach((row) => {
    const studentRecordId = toPublicId(row?.id) || String(row?.id || '').trim();
    if (!studentRecordId) return;
    const personId = toPublicId(row?.personId) || String(row?.personId || '').trim();
    const person = personById.get(personId);
    let name = schoolPersonAccessService.formatPersonName(person, studentRecordId);
    const studentNumber = String(row?.studentNumber || '').trim();
    if (studentNumber && name && !String(name).includes(studentNumber)) {
      name = `${name} (${studentNumber})`;
    }
    labelByRecordId.set(studentRecordId, {
      studentRecordId,
      personId,
      name: String(name || studentRecordId).trim()
    });
  });

  function resolveCanonical(rawId = '') {
    const token = String(rawId || '').trim();
    if (!token) return '';
    if (aliasToRecordId.has(token)) return aliasToRecordId.get(token);
    const lower = token.toLowerCase();
    if (aliasToRecordId.has(lower)) return aliasToRecordId.get(lower);
    const publicToken = toPublicId(token);
    if (publicToken && aliasToRecordId.has(publicToken)) return aliasToRecordId.get(publicToken);
    for (const [alias, recordId] of aliasToRecordId.entries()) {
      if (idsEqual(alias, token)) return recordId;
    }
    return token;
  }

  return {
    labelByRecordId,
    resolveCanonical,
    loadedStudentCount: Array.isArray(students) ? students.length : 0,
    aliasCount: aliasToRecordId.size
  };
}

async function resolveFunderStudentRecordIds(req, funderIds = [], startDate = '', endDate = '') {
  const union = new Set();
  const activeOrgId = String(req.user?.activeOrgId || '').trim();
  const routeAccessContext = schoolDataService.buildRouteAccessContext(req);
  const [allPeriods, classes, activeFunders] = await Promise.all([
    schoolDataService.getAccessibleClassEnrollmentPeriods(req.user),
    schoolDataService.fetchAllData('classes', {}, req.user, routeAccessContext),
    activeOrgId
      ? reportFunderDocxService.loadActiveFunderOptions(req.user, activeOrgId).catch(() => [])
      : Promise.resolve([])
  ]);
  const classById = new Map();
  (Array.isArray(classes) ? classes : []).forEach((row) => {
    const id = toPublicId(row?.id);
    if (id) classById.set(id, row);
  });

  const ids = parseIdList(funderIds);
  ids.forEach((funderId) => {
    (Array.isArray(allPeriods) ? allPeriods : []).forEach((period) => {
      if (activeOrgId) {
        const rowOrgId = String(period?.orgId || period?.organizationId || '').trim();
        if (rowOrgId && !idsEqual(rowOrgId, activeOrgId)) return;
      }
      if (!rollingEnrollmentPeriodFilterService.matchesFunderFilter(period, funderId)) return;
      if (!periodQualifiesForFunderSelection(period)) return;
      if (!periodOverlapsReportRange(period, startDate, endDate)) return;
      const classId = toPublicId(period?.classId);
      if (!classId || !classById.has(classId)) return;
      const studentRecordId = toPublicId(period?.studentId) || String(period?.studentId || '').trim();
      if (studentRecordId) union.add(studentRecordId);
    });
  });
  return union;
}

async function resolveClassStudentRecordIds(req, classIds = [], startDate = '', endDate = '') {
  const union = new Set();
  const activeOrgId = String(req.user?.activeOrgId || '').trim();
  const routeAccessContext = schoolDataService.buildRouteAccessContext(req);
  const classes = await schoolDataService.fetchAllData('classes', {}, req.user, routeAccessContext);
  const classSet = new Set(parseIdList(classIds).map((id) => toPublicId(id) || id));
  const canonicalStatuses = classEnrollmentReadService.HISTORICAL_ROLLING_ROSTER_STATUSES;

  await runWithConcurrency(
    (Array.isArray(classes) ? classes : []).filter((row) => classSet.has(toPublicId(row?.id) || String(row?.id || '').trim())),
    4,
    async (classRow) => {
      const classId = toPublicId(classRow?.id);
      if (!classId) return;
      const snapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
        classId,
        classItem: classRow,
        reqUser: req.user,
        activeOrgId,
        startDate,
        endDate,
        canonicalStatuses
      });
      const studentIds = snapshot.studentIds instanceof Set ? snapshot.studentIds : new Set();
      studentIds.forEach((sid) => union.add(String(sid || '').trim()));
    }
  );
  return union;
}

async function resolveManualStudentRecordIds(req, studentIds = []) {
  const selected = await studentAttendanceReportService.resolveSelectedStudents(req, parseIdList(studentIds));
  return new Set(
    selected.map((row) => String(row.studentRecordId || '').trim()).filter(Boolean)
  );
}

async function resolveAllowedStudentRecordIds(req, filters = {}, startDate = '', endDate = '') {
  const constraintSets = [];
  const manual = parseIdList(filters.studentIds);
  const funders = parseIdList(filters.funderIds);
  const classes = parseIdList(filters.classIds);
  if (manual.length) {
    constraintSets.push(await resolveManualStudentRecordIds(req, manual));
  }
  if (funders.length) {
    constraintSets.push(await resolveFunderStudentRecordIds(req, funders, startDate, endDate));
  }
  if (classes.length) {
    constraintSets.push(await resolveClassStudentRecordIds(req, classes, startDate, endDate));
  }
  if (!constraintSets.length) return null;
  return intersectStudentRecordIdSets(constraintSets);
}

function teacherNameFromClass(classRow = null) {
  if (!classRow || typeof classRow !== 'object') return '';
  const instructors = Array.isArray(classRow.instructors) ? classRow.instructors : [];
  const names = instructors.map((row) => String(row?.name || '').trim()).filter(Boolean);
  if (names.length) return names.join(', ');
  return String(classRow.teacherName || '').trim();
}

function resolveNumericMark(merged = {}, fieldId = '') {
  const key = String(fieldId || '').trim();
  if (!key) return null;
  let raw = merged[key];
  if (raw === undefined) raw = merged[String(key)];
  if (raw === '' || raw === undefined || raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseReviewInput(body = {}) {
  const startDate = normalizeDateOnly(body.startDate);
  const endDate = normalizeDateOnly(body.endDate);
  const threshold = parseThreshold(body.threshold);
  if (!startDate || !endDate) throw new Error('Start date and end date are required.');
  if (endDate < startDate) throw new Error('End date must be on or after start date.');
  if (threshold == null) throw new Error('Enter a threshold between 1 and 100.');
  const metricKeys = parseMetricKeys(body.metricKeys);
  if (!metricKeys.length) throw new Error('Select at least one metric to review.');
  return {
    startDate,
    endDate,
    threshold,
    metricKeys,
    filters: {
      studentIds: parseIdList(body.studentIds),
      funderIds: parseIdList(body.funderIds),
      classIds: parseIdList(body.classIds),
      templateId: String(body.templateId || '').trim(),
      metricKeys,
      onlyBelowThreshold: body.onlyBelowThreshold !== false && body.onlyBelowThreshold !== 'false'
    }
  };
}

async function buildLowMarkReviewPayload(req, input = {}, options = {}) {
  const { jobId, onProgress } = options;
  const tick = () => {
    if (jobId) sarExportJobService.assertJobNotCancelled(jobId);
  };
  const reportProgress = (patch) => {
    if (typeof onProgress === 'function') onProgress(patch);
    if (jobId) {
      sarExportJobService.updateJobProgress(jobId, patch);
    }
  };

  const { startDate, endDate, threshold, filters } = input;
  const activeOrgId = String(req.user?.activeOrgId || '').trim();
  const policy = semiMonthlyReportPolicyService.resolvePolicy(activeOrgId
    ? await semiMonthlyReportPolicyModel.getPolicyForOrg(activeOrgId)
    : {});
  let reportTemplateIds = [...(policy.reportTemplateIds || [])];
  if (!reportTemplateIds.length) {
    throw new Error('Add report templates in School Settings → School Semi-Monthly Report before running a scan.');
  }
  if (filters.templateId) {
    const allowed = reportTemplateIds.some((id) => idsEqual(id, filters.templateId));
    if (!allowed) throw new Error('Selected template is not configured for School Semi-Monthly Report.');
    reportTemplateIds = [filters.templateId];
  }

  tick();
  reportProgress({ phase: 'templates', processedItems: 0, totalItems: reportTemplateIds.length });

  const templateById = new Map();
  const labelById = new Map();
  let templateProcessed = 0;
  for (const templateId of reportTemplateIds) {
    tick();
    // eslint-disable-next-line no-await-in-loop
    const template = await schoolDataService.getDataById('reportTemplates', templateId, req.user);
    const token = String(templateId || '').trim();
    if (template) templateById.set(token, template);
    labelById.set(token, semiMonthlyReportPolicyService.formatTemplateLabel(template, token));
    templateProcessed += 1;
    reportProgress({
      phase: 'templates',
      processedItems: templateProcessed,
      totalItems: reportTemplateIds.length
    });
  }

  const {
    fieldsByTemplateId,
    warnings,
    selectedMetricKeys
  } = auditConfiguredTemplates(reportTemplateIds, templateById, labelById, input.metricKeys);
  const selectedMetrics = selectedMetricKeys.map((key) => {
    const metric = REVIEW_METRIC_BY_KEY.get(key);
    return { key, uiLabel: metric?.uiLabel || key };
  });

  const studentIdentity = await buildStudentIdentityIndex(req);
  const { labelByRecordId, resolveCanonical } = studentIdentity;

  const classIdFilter = new Set(parseIdList(filters.classIds).map((id) => toPublicId(id) || id));
  const allowedStudentRecordIds = await resolveAllowedStudentRecordIds(req, filters, startDate, endDate);
  if (allowedStudentRecordIds instanceof Set && !allowedStudentRecordIds.size) {
    return {
      status: 'success',
      startDate,
      endDate,
      threshold,
      message: 'No students matched the selected scope filters.',
      filtersApplied: filters,
      selectedMetrics,
      templateWarnings: warnings,
      columns: [],
      students: [],
      scannedInstanceCount: 0,
      matchedStudentCount: 0
    };
  }

  tick();
  const routeAccessContext = schoolDataService.buildRouteAccessContext(req);
  const templateIdSet = schoolSemiMonthlyReportService.buildTemplateIdSet(reportTemplateIds);
  const instanceQuery = activeOrgId ? { orgId__eq: activeOrgId } : {};
  const allInstances = await schoolDataService.fetchAllData(
    'reportInstances',
    instanceQuery,
    req.user,
    routeAccessContext
  );
  let instances = schoolSemiMonthlyReportService.filterInstancesForSemiMonthlyWindow(
    allInstances,
    templateIdSet,
    startDate,
    endDate
  );
  if (classIdFilter.size) {
    instances = instances.filter((row) => {
      const classId = toPublicId(row?.classId) || String(row?.classId || '').trim();
      return classIdFilter.has(classId);
    });
  }
  if (allowedStudentRecordIds instanceof Set) {
    instances = instances.filter((row) => studentAllowedForInstance(row, allowedStudentRecordIds, resolveCanonical));
  }

  const classes = await schoolDataService.fetchAllData('classes', {}, req.user, routeAccessContext);
  const classById = new Map();
  (Array.isArray(classes) ? classes : []).forEach((row) => {
    const id = toPublicId(row?.id);
    if (id) classById.set(id, row);
  });

  const assignmentCache = new Map();
  async function loadAssignment(assignmentId) {
    const key = String(assignmentId || '').trim();
    if (!key) return null;
    if (assignmentCache.has(key)) return assignmentCache.get(key);
    const row = await schoolDataService.getDataById('reportAssignments', key, req.user);
    assignmentCache.set(key, row || null);
    return row || null;
  }

  const totalInstances = instances.length;
  reportProgress({ phase: 'instances', processedItems: 0, totalItems: Math.max(1, totalInstances) });

  const evaluations = [];
  let processed = 0;
  await runWithConcurrency(instances, 8, async (instance) => {
    try {
      tick();
      const templateId = String(instance?.templateId || '').trim();
      const metricFields = fieldsByTemplateId.get(templateId);
      if (!(metricFields instanceof Map) || !metricFields.size) return;
      const template = templateById.get(templateId);
      if (!template) return;
      const assignment = await loadAssignment(instance?.assignmentId);
      const merged = reportService.mergeTemplateData(template, instance, assignment);
      const rawStudentKey = instanceStudentRecordId(instance);
      const studentRecordId = resolveCanonical(rawStudentKey);
      if (!studentRecordId) return;
      const sessionDate = normalizeDateOnly(instance?.sessionDate);
      if (!sessionDate) return;
      const classId = toPublicId(instance?.classId) || String(instance?.classId || '').trim();
      const classRow = classById.get(classId);
      const className = classRow
        ? String(classRow.name || classRow.title || classId).trim()
        : classId;
      const instanceId = toPublicId(instance?.id) || String(instance?.id || '').trim();
      const templateLabel = labelById.get(templateId) || templateId;
      const schemaFields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
      const editUrl = instanceId
        ? `/school/reports/instances/edit/${encodeURIComponent(instanceId)}`
        : '';
      selectedMetricKeys.forEach((metricKey) => {
        const fieldId = metricFields.get(metricKey);
        if (!fieldId) return;
        const mark = resolveNumericMark(merged, fieldId);
        if (mark == null) return;
        const metric = REVIEW_METRIC_BY_KEY.get(metricKey);
        const schemaField = schemaFields.find((row) => String(row?.id || '').trim() === fieldId);
        const fieldLabel = String(schemaField?.label || metric?.uiLabel || metricKey).trim();
        evaluations.push({
          studentRecordId,
          sessionDate,
          mark,
          gapBelowThreshold: Math.max(0, threshold - mark),
          passesThreshold: mark >= threshold,
          metricKey,
          metricLabel: metric?.uiLabel || metricKey,
          fieldLabel,
          instanceId,
          classId,
          className,
          teacherName: teacherNameFromClass(classRow),
          templateId,
          templateLabel,
          editUrl
        });
      });
    } finally {
      processed += 1;
      if (processed % 5 === 0 || processed === totalInstances) {
        reportProgress({ phase: 'instances', processedItems: processed, totalItems: Math.max(1, totalInstances) });
      }
    }
  });

  tick();
  reportProgress({ phase: 'students', processedItems: 0, totalItems: 1 });

  const belowByStudent = new Map();
  evaluations.forEach((row) => {
    if (row.passesThreshold) return;
    if (!belowByStudent.has(row.studentRecordId)) belowByStudent.set(row.studentRecordId, []);
    belowByStudent.get(row.studentRecordId).push(row);
  });

  const onlyBelowThreshold = filters.onlyBelowThreshold !== false;
  const studentRecordIds = onlyBelowThreshold
    ? [...belowByStudent.keys()]
    : [...new Set(evaluations.map((row) => row.studentRecordId).filter(Boolean))];

  const columnDateSet = new Set();
  studentRecordIds.forEach((sid) => {
    if (onlyBelowThreshold) {
      (belowByStudent.get(sid) || []).forEach((row) => columnDateSet.add(row.sessionDate));
      return;
    }
    evaluations.filter((row) => row.studentRecordId === sid).forEach((row) => {
      columnDateSet.add(row.sessionDate);
    });
  });
  const columns = [...columnDateSet].sort().map((sessionDate) => ({
    sessionDate,
    headerLabel: sessionDate
  }));

  const evalByStudentDate = new Map();
  evaluations.forEach((row) => {
    const key = `${row.studentRecordId}|${row.sessionDate}`;
    if (!evalByStudentDate.has(key)) evalByStudentDate.set(key, []);
    evalByStudentDate.get(key).push(row);
  });

  let students = studentRecordIds
    .map((studentRecordId) => {
      const meta = lookupStudentLabel(labelByRecordId, studentRecordId) || {
        studentRecordId,
        personId: '',
        name: studentRecordId
      };
      const cells = {};
      columns.forEach(({ sessionDate }) => {
        const key = `${studentRecordId}|${sessionDate}`;
        const rows = collectCellRowsForDate(
          studentRecordId,
          sessionDate,
          selectedMetricKeys,
          evaluations,
          onlyBelowThreshold
        );
        if (!rows.length) return;
        cells[sessionDate] = rows.map((entry) => ({
          instanceId: entry.instanceId,
          classId: entry.classId,
          className: entry.className,
          teacherName: entry.teacherName,
          templateId: entry.templateId,
          templateLabel: entry.templateLabel,
          metricKey: entry.metricKey,
          metricLabel: entry.metricLabel,
          fieldLabel: entry.fieldLabel,
          mark: entry.mark,
          gapBelowThreshold: entry.gapBelowThreshold,
          passesThreshold: entry.passesThreshold,
          editUrl: entry.editUrl
        }));
      });
      return {
        personId: meta.personId,
        studentRecordId,
        name: meta.name,
        cells
      };
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  if (onlyBelowThreshold) {
    students = students.filter((student) => {
      const cells = student?.cells && typeof student.cells === 'object' ? student.cells : {};
      return Object.keys(cells).some((date) => Array.isArray(cells[date]) && cells[date].length > 0);
    });
  }

  reportProgress({ phase: 'students', processedItems: 1, totalItems: 1 });

  return {
    status: 'success',
    startDate,
    endDate,
    threshold,
    filtersApplied: filters,
    selectedMetrics,
    templateWarnings: warnings,
    columns,
    students,
    scannedInstanceCount: totalInstances,
    matchedStudentCount: students.length
  };
}

module.exports = {
  AVERAGE_CLASS_MARK_LABEL,
  REVIEW_METRICS,
  REVIEW_METRIC_BY_KEY,
  resolveAverageClassMarkField,
  resolveMetricField,
  parseMetricKeys,
  auditConfiguredTemplates,
  parseReviewInput,
  parseThreshold,
  buildLowMarkReviewPayload,
  intersectStudentRecordIdSets,
  resolveNumericMark,
  collectCellRowsForDate
};