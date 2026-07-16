const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const accessService = requireCoreModule('MVC/services/security');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

const { isAjax } = requireCoreModule('MVC/utils/generalTools');
const schoolDataService = require('../../services/school/schoolDataService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const reportService = require('../../services/school/reportService');
const reportDocxRenderService = require('../../services/school/reportDocxRenderService');
const reportIntegrityService = require('../../services/school/reportIntegrityService');
const reportViewService = require('../../services/school/reportViewService');
const reportAssignmentBulkRowService = require('../../services/school/reportAssignmentBulkRowService');
const reportRuleEngineService = require('../../services/school/reportRuleEngineService');
const reportInstanceSaveService = require('../../services/school/reportInstanceSaveService');
const reportMatrixService = require('../../services/school/reportMatrixService');
const schoolPersonAccessService = require('../../services/school/schoolPersonAccessService');
const schoolDeletionGuardService = require('../../services/school/schoolDeletionGuardService');
const classReferenceSyncService = require('../../services/school/classReferenceSyncService');
const { getPrefillValue } = require('../../services/school/reportPrefillKeyUtils');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
const reportTemplateModel = require('../../models/school/reportTemplateModel');
const reportAssignmentModel = require('../../models/school/reportAssignmentModel');
const reportInstanceModel = require('../../models/school/reportInstanceModel');
const {
  getActiveOrgIdOrThrow: getActiveOrgIdOrThrowShared,
  assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared
} = requireCoreModule('MVC/utils/orgContextUtils');

const HOME_CARD_VISIBLE_OPERATION_IDS = Object.freeze([
  OPERATIONS.READ_ALL,
  OPERATIONS.READ,
  OPERATIONS.CREATE,
  OPERATIONS.UPDATE,
  OPERATIONS.DELETE,
  OPERATIONS.EXPORT,
  OPERATIONS.IMPORT,
  OPERATIONS.START,
  OPERATIONS.SAVE,
  OPERATIONS.CONFIGURE
]);

function formatPersonDisplayName(person) {
  if (!person || typeof person !== 'object') return '';
  const preferred = String(person?.name?.preferred || '').trim();
  if (preferred) return preferred;
  const first = String(person?.name?.first || '').trim();
  const last = String(person?.name?.last || '').trim();
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  return String(person?.displayName || person?.fullName || person?.id || '').trim();
}

function buildReportInstanceDetailsForView(inst, {
  assignment,
  classData,
  classSessions,
  teacherPerson,
  studentRegistry,
  studentPerson
}) {
  const sessionRow = Array.isArray(classSessions)
    ? classSessions.find((s) => idsEqual(s.sessionId, inst.sessionId))
    : null;
  let sessionSummary = '';
  if (sessionRow) {
    const timePart = [sessionRow.startTime, sessionRow.endTime].filter(Boolean).join(' - ');
    sessionSummary = [sessionRow.date, timePart].filter(Boolean).join(' | ');
  } else if (inst.sessionDate) {
    sessionSummary = `Session date ${inst.sessionDate}`;
  }

  const teacherName = formatPersonDisplayName(teacherPerson);
  const studentName = formatPersonDisplayName(studentPerson);

  const targetKeyRaw = String(inst.targetKey || '').trim();
  let targetLabel = '';
  if (!targetKeyRaw || targetKeyRaw === 'class') {
    targetLabel = 'Whole class';
  } else {
    const m = /^student:(.+)$/i.exec(targetKeyRaw);
    if (m) {
      targetLabel = studentName ? studentName : `Student record ${m[1].trim()}`;
    } else {
      targetLabel = targetKeyRaw;
    }
  }

  const assignmentParts = [];
  if (assignment && String(assignment.sessionDate || '').trim()) {
    assignmentParts.push(`Session date ${String(assignment.sessionDate).trim()}`);
  }
  if (assignment && String(assignment.reportScope || '').trim()) {
    assignmentParts.push(`Scope: ${String(assignment.reportScope).replace(/_/g, ' ')}`);
  }
  const assignmentSummary = assignmentParts.join(' | ');

  const studentExtra = studentRegistry && String(studentRegistry.localId || '').trim()
    ? String(studentRegistry.localId).trim()
    : '';

  return {
    teacherName,
    className: String(classData?.title || '').trim(),
    sessionSummary,
    assignmentSummary,
    studentName,
    studentRecordId: toPublicId(studentRegistry?.id),
    studentLocalId: studentExtra,
    targetLabel
  };
}

function getActiveOrgIdOrThrow(reqUser) {
  return getActiveOrgIdOrThrowShared(reqUser);
}

async function assertCreateOrgContextOrThrow(reqUser) {
  return assertCreateOrgContextOrThrowShared(reqUser, { scopeLabel: 'reports' });
}

async function canAccessHomeCardSection(user, sectionId, ipAddress) {
  if (!user || !sectionId) return false;
  if (await adminAuthorityService.isAdminForRequestAsync(user, sectionId, OPERATIONS.READ_ALL, { section: { id: sectionId } })) return true;
  for (const operationId of HOME_CARD_VISIBLE_OPERATION_IDS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const evaluation = await accessService.evaluateAccess({
        user,
        sectionId,
        operationId,
        ipAddress
      });
      if (evaluation?.allowed) return true;
      if (String(evaluation?.reason || '').includes('does not exist')) return false;
    } catch (_) {
      return false;
    }
  }
  return false;
}

async function filterAccessibleHomeCards(user, cards, ipAddress) {
  const rows = Array.isArray(cards) ? cards : [];
  const out = [];
  const cache = new Map();
  for (const row of rows) {
    const sectionId = String(row?.sectionId || '').trim();
    if (!sectionId) continue;
    if (!cache.has(sectionId)) {
      // eslint-disable-next-line no-await-in-loop
      cache.set(sectionId, await canAccessHomeCardSection(user, sectionId, ipAddress));
    }
    if (cache.get(sectionId)) out.push(row);
  }
  return out;
}

/** Same-origin HTTP(S) referrer only; avoids open redirects. Omits self-referrals (refresh on editor). */
function resolveSafeSameOriginReturnUrl(req, instanceId) {
  const raw = String(req.get('Referrer') || req.get('Referer') || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const expectedHost = String(req.get('host') || '').trim().toLowerCase();
    if (!expectedHost || String(parsed.host || '').toLowerCase() !== expectedHost) return '';
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    const id = String(instanceId || '').trim();
    if (id) {
      const selfPath = `/school/reports/instances/edit/${encodeURIComponent(id)}`;
      if (String(parsed.pathname || '') === selfPath) return '';
    }
    return raw;
  } catch (e) {
    return '';
  }
}

function sendGuardedResponse(res, guardResult, duplicateMessage, duplicateStatus = 409) {
  if (!guardResult || guardResult.status === 'acquired') return false;
  if (guardResult.status === 'busy') {
    res.status(duplicateStatus).json({
      status: 'warning',
      message: duplicateMessage,
      idempotency: {
        state: 'busy',
        retryAfterMs: Number(guardResult.retryAfterMs || 0)
      }
    });
    return true;
  }
  if (guardResult.status === 'replay') {
    const payload = guardResult.payload && typeof guardResult.payload === 'object'
      ? { ...guardResult.payload }
      : { status: 'success' };
    payload.idempotency = { state: 'replayed' };
    res.json(payload);
    return true;
  }
  return false;
}

function hydrateInitialAnswersFromPrefill(template, instance, options = {}) {
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
    const resolvedPrefill = getPrefillValue(prefill, field?.prefillKey);
    if (!resolvedPrefill.found) return;

    const currentValue = currentAnswers[field.id];
    const hasCurrentValue = !(currentValue === undefined || currentValue === null || String(currentValue) === '');
    if (hasCurrentValue && !overwritePrefillFields) return;

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

function coercePrefillValueForField(field, rawPrefill) {
  const type = String(field?.type || '').trim().toLowerCase();
  if (type === 'checkbox') {
    return rawPrefill === true || String(rawPrefill).toLowerCase() === 'true' || String(rawPrefill) === '1';
  }
  if (type === 'number') {
    const n = Number(rawPrefill);
    return Number.isFinite(n) ? n : '';
  }
  if (rawPrefill === undefined || rawPrefill === null) return '';
  return String(rawPrefill).trim();
}

function stableValueToken(value) {
  if (value === undefined) return '__undefined__';
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function buildAssignmentSnapshotFallback(instance, assignment) {
  return assignment || {
    classId: instance.classId,
    orgId: instance.orgId,
    sessionId: instance.sessionId,
    sessionDate: instance.sessionDate,
    teacherIds: [instance.teacherId].filter(Boolean),
    reportStartDate: instance.reportStartDate,
    reportDueDate: instance.reportDueDate,
    dueDate: instance.dueDate
  };
}

async function buildPrefillRefreshPreview({ instance, template, assignment, reqUser }) {
  const oldPrefill = instance?.prefillSnapshot && typeof instance.prefillSnapshot === 'object'
    ? instance.prefillSnapshot
    : {};
  const refreshedPrefill = await reportService.buildPrefillSnapshot({
    assignment: buildAssignmentSnapshotFallback(instance, assignment),
    teacherId: instance.teacherId,
    studentId: instance.studentId,
    reqUser
  });
  const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
  const currentMerged = reportService.mergeTemplateData(template, instance, assignment);
  const changesByKey = new Map();

  fields.forEach((field) => {
    const type = String(field?.type || '').trim().toLowerCase();
    if (!field?.id || type === 'section' || type === 'subheader' || type === 'row_break') return;
    const prefillKey = reportService.normalizePrefillKey(field?.prefillKey || '');
    if (!prefillKey) return;

    const oldResolved = getPrefillValue(oldPrefill, prefillKey);
    const newResolved = getPrefillValue(refreshedPrefill, prefillKey);
    if (!newResolved.found) return;

    const oldRawValue = oldResolved.found ? oldResolved.value : undefined;
    const newRawValue = newResolved.value;
    const oldValue = coercePrefillValueForField(field, oldRawValue);
    const newValue = coercePrefillValueForField(field, newRawValue);
    if (stableValueToken(oldRawValue) === stableValueToken(newRawValue)) return;

    if (!changesByKey.has(prefillKey)) {
      changesByKey.set(prefillKey, {
        prefillKey,
        oldRawValue,
        newRawValue,
        fields: []
      });
    }

    changesByKey.get(prefillKey).fields.push({
      fieldId: String(field.id || ''),
      label: String(field.label || field.id || ''),
      type,
      oldValue,
      newValue,
      currentValue: currentMerged[field.id],
      oldRawValue,
      newRawValue
    });
  });

  return {
    refreshedPrefill,
    changes: Array.from(changesByKey.values())
  };
}

async function showHome(req, res) {
  try {
    const [allTemplates, allAssignments, allInstances] = await Promise.all([
      schoolDataService.fetchData('reportTemplates', {}, req.user),
      schoolDataService.fetchData('reportAssignments', {}, req.user),
      schoolDataService.fetchData('reportInstances', {}, req.user)
    ]);
    const summary = reportViewService.buildHomeSummary(allTemplates, allAssignments, allInstances, req.user);
    const dashboardSections = [
      {
        title: 'Report Templates',
        description: `Design fields and DOCX mappings. Total templates: ${Number(summary?.templateCount || 0)}.`,
        href: '/school/reports/templates',
        sectionId: SECTIONS.SCHOOL_REPORTS_TEMPLATE,
        icon: 'bi-file-earmark-richtext',
        subtleClass: 'bg-primary-subtle text-primary',
        buttonClass: 'btn btn-primary',
        buttonLabel: 'Open Templates'
      },
      {
        title: 'Assignments',
        description: `Assign reports to classes/sessions. Total assignments: ${Number(summary?.assignmentCount || 0)}.`,
        href: '/school/reports/assignments',
        sectionId: SECTIONS.SCHOOL_REPORTS_ASSIGNMENT,
        icon: 'bi-calendar2-check',
        subtleClass: 'bg-warning-subtle text-warning',
        buttonClass: 'btn btn-warning text-dark',
        buttonLabel: 'Open Assignments'
      },
      {
        title: 'Report Instances',
        description: `Continue and submit report drafts. Drafts: ${Number(summary?.draftCount || 0)}, Submitted: ${Number(summary?.submittedCount || 0)}.`,
        href: '/school/reports/instances',
        sectionId: SECTIONS.SCHOOL_REPORTS_INSTANCES,
        icon: 'bi-journal-check',
        subtleClass: 'bg-success-subtle text-success',
        buttonClass: 'btn btn-success',
        buttonLabel: 'Open Instances'
      },
      {
        title: 'Assigned Reports',
        description: 'View reports assigned to teacher, staff, or student profiles.',
        href: '/school/reports/person-reports',
        sectionId: SECTIONS.SCHOOL_REPORTS_INSTANCES,
        icon: 'bi-people',
        subtleClass: 'bg-info-subtle text-info',
        buttonClass: 'btn btn-info text-dark',
        buttonLabel: 'Open Assigned Reports'
      }
    ];
    const accessibleDashboardSections = await filterAccessibleHomeCards(req.user, dashboardSections, req.ip);

    res.render('school/report/reportHome', {
      title: 'School Reports',
      summary,
      dashboardSections: accessibleDashboardSections,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function listTemplates(req, res) {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const allTemplates = await schoolDataService.fetchData('reportTemplates', {}, req.user);

    const filtered = allTemplates
      .filter((row) => {
        if (!q) return true;
        return [row.id, row.title, row.type, row.status]
          .map((v) => String(v || '').toLowerCase())
          .some((v) => v.includes(q));
      })
      .sort((a, b) => String(b.audit?.createDateTime || '').localeCompare(String(a.audit?.createDateTime || '')));

    const { data, pagination } = paginate(filtered, req.query);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    res.render('school/report/templateList', {
      title: 'Report Templates',
      tableName: 'Report_Templates',
      data,
      newUrl: 'school/reports/templates',
      newLabel: 'Add Template',
      pagination,
      filters: req.query,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: true,
      print: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

function clonePlainValue(value, fallback) {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function resolveNextTemplateVersion(templates = [], sourceTemplate = {}, orgId = '') {
  const sourceType = String(sourceTemplate?.type || '').trim().toLowerCase();
  const targetOrgId = String(orgId || sourceTemplate?.orgId || '').trim();
  const versions = (Array.isArray(templates) ? templates : [])
    .filter((row) => idsEqual(row?.orgId, targetOrgId))
    .filter((row) => String(row?.type || '').trim().toLowerCase() === sourceType)
    .map((row) => Number(row?.version || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  const maxVersion = versions.length ? Math.max(...versions) : Number(sourceTemplate?.version || 0);
  return Math.min(1000, Math.max(1, maxVersion + 1));
}

function buildCopiedTemplateDraft(sourceTemplate = {}, templates = [], activeOrgId = '') {
  const originalTitle = String(sourceTemplate?.title || 'Report Template').trim() || 'Report Template';
  return {
    orgId: activeOrgId || sourceTemplate.orgId,
    type: String(sourceTemplate?.type || 'progress_report_v1').trim().toLowerCase() || 'progress_report_v1',
    version: resolveNextTemplateVersion(templates, sourceTemplate, activeOrgId || sourceTemplate.orgId),
    title: `Copy of ${originalTitle}`.slice(0, 180),
    status: 'draft',
    description: String(sourceTemplate?.description || '').trim(),
    schema: clonePlainValue(sourceTemplate?.schema, { version: 1, fields: [] }),
    placeholderMap: clonePlainValue(sourceTemplate?.placeholderMap, {}),
    docxTemplate: clonePlainValue(sourceTemplate?.docxTemplate, null)
  };
}
async function showTemplateForm(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    const isEdit = Boolean(id);
    let template = null;

    if (isEdit) {
      template = await reportIntegrityService.assertTemplateAccessible(id, req.user);
    } else {
      await assertCreateOrgContextOrThrow(req.user);
    }

    res.render('school/report/templateForm', {
      title: isEdit ? 'Edit Report Template' : 'New Report Template',
      template,
      fieldTypes: reportTemplateModel.FIELD_TYPES,
      templateStatuses: reportTemplateModel.TEMPLATE_STATUSES,
      prefillCatalog: reportService.getPrefillCatalog(),
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function showTemplateCopyForm(req, res) {
  try {
    const activeOrgId = await assertCreateOrgContextOrThrow(req.user);
    const sourceTemplate = await reportIntegrityService.assertTemplateAccessible(req.params.id, req.user);
    if (sourceTemplate?.orgId && !idsEqual(sourceTemplate.orgId, activeOrgId)) {
      throw new Error('Activate the source template organization before copying this report template.');
    }
    const allTemplates = await schoolDataService.fetchData('reportTemplates', {}, req.user);
    const template = buildCopiedTemplateDraft(sourceTemplate, allTemplates, activeOrgId);

    res.render('school/report/templateForm', {
      title: 'Copy Report Template',
      template,
      copySourceTemplate: sourceTemplate,
      fieldTypes: reportTemplateModel.FIELD_TYPES,
      templateStatuses: reportTemplateModel.TEMPLATE_STATUSES,
      prefillCatalog: reportService.getPrefillCatalog(),
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}
async function saveTemplate(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    const isEdit = Boolean(id);
    const activeOrgId = isEdit ? getActiveOrgIdOrThrow(req.user) : await assertCreateOrgContextOrThrow(req.user);
    let existing = null;

    if (isEdit) {
      existing = await reportIntegrityService.assertTemplateAccessible(id, req.user);
    }

    
    let copySourceTemplate = null;
    const copySourceTemplateId = String(req.body.copySourceTemplateId || '').trim();
    if (!isEdit && copySourceTemplateId) {
      copySourceTemplate = await reportIntegrityService.assertTemplateAccessible(copySourceTemplateId, req.user);
      if (copySourceTemplate?.orgId && !idsEqual(copySourceTemplate.orgId, activeOrgId)) {
        throw new Error('Activate the source template organization before saving this copied report template.');
      }
    }

    const payload = reportViewService.buildTemplateSavePayload({
      body: req.body,
      existingTemplate: existing,
      activeOrgId,
      reqUser: req.user,
      uploadedFile: req.file
    });
    // Validate prefill keys against catalog whitelist before saving template
    // This prevents templates from referencing undefined/non-existent prefill values
    // Audit test (school.report.shared-fields.test.js) ensures all catalog keys are produced by buildPrefillSnapshot
    if (!isEdit && copySourceTemplate && !req.file && copySourceTemplate.docxTemplate) {
      payload.docxTemplate = clonePlainValue(copySourceTemplate.docxTemplate, null);
    }

    const invalidPrefillKeys = reportService.validateTemplatePrefillKeys(payload.schema);
    if (invalidPrefillKeys.length) {
      const details = invalidPrefillKeys
        .slice(0, 5)
        .map((item) => `${item.label || item.fieldId}: ${item.prefillKey}`)
        .join('; ');
      throw new Error(`Invalid report prefill key${invalidPrefillKeys.length === 1 ? '' : 's'}: ${details}. Choose a key from the prefill catalog or leave the field blank.`);
    }

    if (isEdit) {
      await schoolDataService.updateData('reportTemplates', id, payload, req.user);
    } else {
      await schoolDataService.addData('reportTemplates', payload, req.user);
    }

    if (isAjax(req)) return res.json({ status: 'success', message: 'Template saved successfully.' });
    res.redirect('/school/reports/templates');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function deleteTemplate(req, res) {
  try {
    await reportIntegrityService.assertTemplateAccessible(req.params.id, req.user);

    await schoolDataService.deleteData('reportTemplates', req.params.id, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Template deleted.' });
    res.redirect('/school/reports/templates');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function listAssignments(req, res) {
  try {
    const parseIdList = (raw) => {
      if (Array.isArray(raw)) {
        return [...new Set(raw.map((item) => String(item || '').trim()).filter(Boolean))];
      }
      const text = String(raw || '').trim();
      if (!text) return [];
      return [...new Set(text.split(',').map((item) => String(item || '').trim()).filter(Boolean))];
    };
    const classIds = parseIdList(req.query.classIds);
    if (!classIds.length) classIds.push(...parseIdList(req.query.classId));
    const teacherPersonId = String(req.query.teacherPersonId || '').trim();
    const reportScope = String(req.query.reportScope || '').trim().toLowerCase();
    const qRaw = String(req.query.q || '').trim();
    const q = qRaw.toLowerCase();

    const {
      rows: assignments,
      selectedClassTitle,
      selectedClassIds,
      selectedClasses,
      selectedTeacherPersonId,
      selectedTeacherName,
      selectedReportScope
    } = await reportViewService.buildAssignmentListContext({
      reqUser: req.user,
      classFilter: classIds[0] || '',
      classIds,
      teacherPersonId,
      reportScope,
      q
    });
    const filters = {
      ...req.query,
      q: qRaw,
      classIds: selectedClassIds.join(','),
      classId: selectedClassIds[0] || '',
      teacherPersonId: selectedTeacherPersonId || '',
      reportScope: selectedReportScope || ''
    };

    const { data, pagination } = paginate(assignments, req.query);
    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    res.render('school/report/assignmentList', {
      title: 'Report Assignments',
      tableName: 'Report_Assignments',
      data,
      newUrl: 'school/reports/assignments',
      newLabel: 'Add Assignment',
      pagination,
      filters,
      selectedClassId: selectedClassIds[0] || '',
      selectedClassIds,
      selectedClasses,
      selectedClassTitle,
      selectedTeacherId: selectedTeacherPersonId,
      selectedTeacherName,
      selectedReportScope,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: true,
      print: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function showAssignmentForm(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    const isEdit = Boolean(id);
    let assignment = null;

    if (isEdit) {
      assignment = await reportIntegrityService.assertAssignmentAccessible(id, req.user);
    } else {
      await assertCreateOrgContextOrThrow(req.user);
    }

    const formContext = await reportViewService.buildAssignmentFormContext({
      assignment,
      requestedClassId: req.query.classId,
      reqUser: req.user
    });

    res.render('school/report/assignmentForm', {
      title: isEdit ? 'Edit Report Assignment' : 'New Report Assignment',
      assignment,
      ...formContext,
      assignmentReportScopes: reportAssignmentModel.ASSIGNMENT_REPORT_SCOPES || ['class', 'each_student', 'selected_students'],
      assignmentStatuses: reportAssignmentModel.ASSIGNMENT_STATUSES,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function generateAssignmentTargetRows(req, res) {
  try {
    const classId = String(req.body?.classId || '').trim();
    if (!classId) throw new Error('Class is required.');

    const sessions = await schoolDataService.getClassSessions(classId, req.user);
    const rows = reportAssignmentBulkRowService.generateBulkTargetRows({
      preset: req.body?.preset,
      startDate: req.body?.startDate,
      endDate: req.body?.endDate,
      sessions,
      customStepDays: req.body?.customStepDays,
      linkSessions: req.body?.linkSessions !== false,
      defaults: req.body?.defaults || {}
    });

    const anchorCount = reportAssignmentBulkRowService.buildScheduleAnchors({
      preset: req.body?.preset,
      startDate: req.body?.startDate,
      endDate: req.body?.endDate,
      sessions,
      customStepDays: req.body?.customStepDays
    }).length;

    return res.json({
      status: 'success',
      anchorCount,
      rows
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function previewAssignmentTargetRows(req, res) {
  try {
    const classId = String(req.body?.classId || '').trim();
    const targetRows = reportViewService.parseTargetRowsField(req.body?.targetRowsJson || req.body?.targetRows);
    const excludeAssignmentId = String(req.params?.id || req.body?.assignmentId || '').trim();
    const payload = await reportIntegrityService.previewAssignmentTargetRows({
      classId,
      targetRows,
      reqUser: req.user,
      excludeAssignmentId
    });
    return res.json({ status: 'success', ...payload });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function saveAssignment(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    const isEdit = Boolean(id);
    const activeOrgId = isEdit ? getActiveOrgIdOrThrow(req.user) : await assertCreateOrgContextOrThrow(req.user);
    let existing = null;

    if (isEdit) {
      existing = await reportIntegrityService.assertAssignmentAccessible(id, req.user);
    }

    const requestPayload = reportViewService.parseAssignmentSaveRequest(req.body);
    const {
      classId,
      templateId,
      selectedSessionIds,
      selectedDateTargets,
      requestedReportStartDate,
      requestedReportDueDate,
      requestedTaskStartTime,
      requestedTaskEndTime,
      conflictPermitted,
      selectedTargetStudentIds,
      reportScope,
      status,
      notes,
      targetRows
    } = requestPayload;
    const hasSessionTargets = selectedSessionIds.length > 0;
    const effectiveConflictPermitted = hasSessionTargets ? true : Boolean(conflictPermitted);

    const {
      template,
      effectiveTargetRows,
      persistedTargetStudentIds
    } = await reportIntegrityService.validateAssignmentCrossEntityContext({
      classId,
      templateId,
      reqUser: req.user,
      reportScope,
      hasSessionTargets,
      selectedDateTargets,
      selectedSessionIds,
      teacherIds: targetRows.length
        ? targetRows.map((row) => row.teacherId).filter(Boolean)
        : requestPayload.teacherIds,
      requestedTaskStartTime,
      requestedTaskEndTime,
      conflictPermitted: effectiveConflictPermitted,
      requestedReportStartDate,
      requestedReportDueDate,
      selectedTargetStudentIds,
      targetRows,
      excludeAssignmentId: isEdit ? id : ''
    });

    const firstActiveRow = effectiveTargetRows.find((row) => String(row?.status || '').toLowerCase() === 'active') || effectiveTargetRows[0];
    const rowTeacherIds = [...new Set(effectiveTargetRows
      .map((row) => String(row?.teacherId || '').trim())
      .filter(Boolean))];

    const basePayload = {
      orgId: existing?.orgId || activeOrgId,
      classId,
      reportScope,
      targetStudentIds: persistedTargetStudentIds,
      templateId: template.id,
      templateVersion: Number(template.version || 1),
      teacherIds: rowTeacherIds,
      targetRows: effectiveTargetRows,
      targetType: firstActiveRow.targetType,
      sessionId: firstActiveRow.sessionId,
      sessionDate: firstActiveRow.sessionDate,
      dueDate: firstActiveRow.dueDate,
      conflictPermitted: firstActiveRow.conflictPermitted,
      taskStartTime: firstActiveRow.taskStartTime,
      taskEndTime: firstActiveRow.taskEndTime,
      reportStartDate: firstActiveRow.reportStartDate,
      reportDueDate: firstActiveRow.reportDueDate,
      status,
      notes,
      timesheetReflection: firstActiveRow.timesheetReflection,
      allocatedHours: firstActiveRow.timesheetReflection ? Number(firstActiveRow.allocatedHours) : 0,
      audit: {
        createUser: existing?.audit?.createUser || req.user?.id || '',
        createDateTime: existing?.audit?.createDateTime || new Date().toISOString(),
        lastUpdateUser: req.user?.id || '',
        lastUpdateDateTime: new Date().toISOString()
      }
    };

    if (isEdit) {
      await schoolDataService.updateData('reportAssignments', id, basePayload, req.user);
      await classReferenceSyncService.cleanupReportInstancesForRemovedTargetRows({
        assignmentId: id,
        previousAssignment: existing,
        nextAssignment: { ...existing, ...basePayload, id },
        reqUser: req.user
      });
      await classReferenceSyncService.notifyClassReferencesChanged({
        classId,
        reason: `report_assignment_saved:${id}`,
        reqUser: req.user
      });
    } else {
      await schoolDataService.addData('reportAssignments', basePayload, req.user);

      if (isAjax(req)) {
        return res.json({
          status: 'success',
          message: `Assignment saved with ${effectiveTargetRows.length} target row${effectiveTargetRows.length === 1 ? '' : 's'}.`
        });
      }
      return res.redirect('/school/reports/assignments');
    }

    if (isAjax(req)) return res.json({ status: 'success', message: 'Assignment saved successfully.' });
    res.redirect('/school/reports/assignments');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function deleteAssignment(req, res) {
  try {
    await reportIntegrityService.assertAssignmentAccessible(req.params.id, req.user);
    const assignment = await schoolDataService.getDataById('reportAssignments', req.params.id, req.user);
    if (!assignment) throw new Error('Assignment not found.');
    const instances = await schoolDataService.fetchData('reportInstances', {
      assignmentId__eq: assignment.id,
      page: 1,
      limit: 10000
    }, req.user);
    for (const instance of (Array.isArray(instances) ? instances : [])) {
      // Preserve existing lock/approval protection before removing owned instances.
      // eslint-disable-next-line no-await-in-loop
      await reportIntegrityService.assertInstanceDeletable(instance.id, req.user);
    }
    for (const instance of (Array.isArray(instances) ? instances : [])) {
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.deleteData('reportInstances', instance.id, req.user, { skipDeletionGuard: true });
    }
    await schoolDataService.deleteData('reportAssignments', req.params.id, req.user, { skipDeletionGuard: true });
    await classReferenceSyncService.notifyAfterReportDelete({ record: assignment, reqUser: req.user });
    if (isAjax(req)) return res.json({
      status: 'success',
      operation: 'physical-delete',
      deletedCounts: { reportAssignments: 1, reportInstances: instances.length },
      message: `Assignment and ${instances.length} owned report instance(s) deleted.`
    });
    res.redirect('/school/reports/assignments');
  } catch (error) {
    return schoolDeletionGuardService.handleDeleteError(req, res, error);
  }
}

async function getAssignmentDeletePreview(req, res) {
  try {
    const activeOrgId = getActiveOrgIdOrThrowShared(req.user);
    const preview = await reportViewService.buildAssignmentDeletePreview({
      reqUser: req.user,
      activeOrgId,
      assignmentId: req.params.id
    });
    return res.json({
      status: 'success',
      ...preview
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function deleteInstance(req, res) {
  try {
    await reportIntegrityService.assertInstanceDeletable(req.params.id, req.user);
    const instance = await schoolDataService.getDataById('reportInstances', req.params.id, req.user);
    if (!instance) throw new Error('Report instance not found.');
    await schoolDataService.deleteData('reportInstances', req.params.id, req.user);
    await classReferenceSyncService.notifyAfterReportDelete({ record: instance, reqUser: req.user });
    if (isAjax(req)) return res.json({ status: 'success', message: 'Report instance deleted.' });
    res.redirect('/school/reports/instances');
  } catch (error) {
    return schoolDeletionGuardService.handleDeleteError(req, res, error);
  }
}

async function listInstances(req, res) {
  try {
    const assignmentFilter = String(req.query.assignmentId || '').trim();
    const assignmentRowFilter = String(req.query.assignmentRowId || req.query.rowId || '').trim();
    const sessionFilter = String(req.query.sessionId || '').trim();
    const sessionDateFilter = String(req.query.sessionDate || '').trim();
    const teacherFilter = String(req.query.teacherId || '').trim();
    const studentFilter = String(req.query.studentId || '').trim();
    const autoOpenSingle = ['1', 'true', 'yes'].includes(String(req.query.autoOpenSingle || '').trim().toLowerCase());
    const q = String(req.query.q || '').trim().toLowerCase();
    const instances = await reportViewService.buildInstanceListRows({
      reqUser: req.user,
      assignmentFilter,
      assignmentRowFilter,
      sessionFilter,
      sessionDateFilter,
      teacherFilter,
      studentFilter,
      q
    });

    if (!isAjax(req) && autoOpenSingle && instances.length === 1) {
      const row = instances[0];
      if (row.isPendingAssignment) {
        const params = new URLSearchParams();
        if (row.teacherId) params.set('teacherId', row.teacherId);
        if (row.assignmentRowId) params.set('rowId', row.assignmentRowId);
        if (row.studentId) params.set('studentId', row.studentId);
        params.set('editor', 'v2');
        return res.redirect(`/school/reports/instances/start/${encodeURIComponent(row.assignmentId)}?${params.toString()}`);
      }
      return res.redirect(`/school/reports/instances/edit-v2/${encodeURIComponent(row.id)}`);
    }

    const { data, pagination } = paginate(instances, req.query);
    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    const canUnlockReportInstance = await reportViewService.canUnlockReportInstance(req.user);

    res.render('school/report/instanceList', {
      title: 'Report Instances',
      tableName: 'Report_Instances',
      data,
      newUrl: 'school/reports/instances',
      newLabel: null,
      pagination,
      filters: req.query,
      canUnlockReportInstance,
      includeModal: true,
      includeModal_Table: true,
      print: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function listPersonReports(req, res) {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const requestedScope = String(req.query.scope || '').trim().toLowerCase();
    const requestedPersonId = String(req.query.personId || '').trim();
    const personReportContext = await reportViewService.buildPersonReportListContext({
      reqUser: req.user,
      requestedScope,
      requestedPersonId,
      q
    });
    const instances = personReportContext.rows;

    const { data, pagination } = paginate(instances, req.query);
    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    res.render('school/report/personReportList', {
      title: 'Assigned Reports by Person',
      tableName: 'Report_Assigned_ByPerson',
      data,
      newUrl: 'school/reports/person-reports',
      newLabel: null,
      pagination,
      filters: req.query,
      isAdminViewer: personReportContext.isAdminViewer,
      viewerRoles: personReportContext.viewerRoles,
      selectedScope: personReportContext.selectedScope,
      selectedPersonId: personReportContext.selectedPersonId,
      selectedPersonLabel: personReportContext.selectedPersonLabel,
      includeModal: true,
      includeModal_Table: true,
      print: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function startInstance(req, res) {
  try {
    const preferV2Editor = String(req.query.editor || '').trim().toLowerCase() === 'v2';
    const {
      assignment,
      assignmentRow,
      teacherId,
      targetStudentIds
    } = await reportIntegrityService.resolveStartInstanceContext({
      assignmentId: req.params.assignmentId,
      assignmentRowId: req.query.rowId || req.query.assignmentRowId || '',
      reqUser: req.user,
      requestedTeacherId: req.query.teacherId,
      fallbackTeacherId: req.user?.personId || '',
      requestedStudentId: req.query.studentId
    });

    const createdOrResolved = [];
    for (const studentId of targetStudentIds) {
      const targetKey = studentId ? `student:${studentId}` : 'class';
      const existingInstances = await schoolDataService.fetchData('reportInstances', {
        assignmentId__eq: assignment.id,
        assignmentRowId__eq: assignment.assignmentRowId || '',
        teacherId__eq: teacherId,
        targetKey__eq: targetKey,
        page: 1,
        limit: 1
      }, req.user);
      let instance = Array.isArray(existingInstances) && existingInstances.length ? existingInstances[0] : null;
      if (!instance) {
        const prefillSnapshot = await reportService.buildPrefillSnapshot({
          assignment,
          teacherId,
          studentId,
          reqUser: req.user
        });
        instance = await schoolDataService.addData('reportInstances', {
          orgId: assignment.orgId,
          assignmentId: assignment.id,
          assignmentRowId: assignment.assignmentRowId || assignmentRow?.rowId || '',
          classId: assignment.classId,
          sessionId: assignment.sessionId,
          sessionDate: assignment.sessionDate,
          templateId: assignment.templateId,
          templateVersion: assignment.templateVersion,
          teacherId,
          studentId,
          targetKey,
          status: 'draft',
          answers: {},
          prefillSnapshot,
          generatedDocs: [],
          audit: {
            createUser: req.user?.id || '',
            createDateTime: new Date().toISOString(),
            lastUpdateUser: req.user?.id || '',
            lastUpdateDateTime: new Date().toISOString()
          }
        }, req.user);
      }
      createdOrResolved.push(instance);
    }

    if (createdOrResolved.length === 1) {
      const editorPath = preferV2Editor ? 'edit-v2' : 'edit';
      return res.redirect(`/school/reports/instances/${editorPath}/${createdOrResolved[0].id}`);
    }

    const params = new URLSearchParams();
    params.set('assignmentId', assignment.id);
    if (assignment.assignmentRowId) params.set('assignmentRowId', assignment.assignmentRowId);
    return res.redirect(`/school/reports/instances?${params.toString()}`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function buildInstanceEditorRenderContext(req) {
  const instance = await reportIntegrityService.getAccessibleInstanceOrThrow(req.params.id, req.user);

  const [template, assignment, classData] = await Promise.all([
    schoolDataService.getDataById('reportTemplates', instance.templateId, req.user),
    schoolDataService.getDataById('reportAssignments', instance.assignmentId, req.user),
    schoolDataService.getDataById('classes', instance.classId, req.user)
  ]);
  if (!template) throw new Error('Template not found for this report instance.');
  const effectiveAssignment = reportViewService.applyAssignmentRow(
    assignment,
    reportViewService.findAssignmentRow(assignment, instance.assignmentRowId || '')
  );

  let latestInstance = await schoolDataService.getDataById('reportInstances', req.params.id, req.user);
  if (String(latestInstance?.status || '').toLowerCase() !== 'locked') {
    const hydrated = hydrateInitialAnswersFromPrefill(template, latestInstance);
    if (hydrated.changed) {
      latestInstance = await schoolDataService.updateData('reportInstances', latestInstance.id, {
        answers: hydrated.answers,
        audit: {
          lastUpdateUser: req.user?.id || '',
          lastUpdateDateTime: new Date().toISOString(),
          prefillHydratedAt: new Date().toISOString()
        }
      }, req.user);
    }
  }
  const mergedData = reportService.mergeTemplateData(template, latestInstance, effectiveAssignment);
  const validationSummary = reportRuleEngineService.evaluateTemplateValidations({
    template,
    mergedAnswers: mergedData,
    prefill: latestInstance?.prefillSnapshot || {}
  });

  const studentPersonId = String(latestInstance.studentId || '').trim();
  const [classSessions, teacherPerson, studentRowsByPerson, studentPersonDirect] = await Promise.all([
    schoolDataService.getClassSessions(latestInstance.classId, req.user),
    latestInstance.teacherId
      ? schoolPersonAccessService.getPersonById({ reqUser: req.user, personId: latestInstance.teacherId })
      : Promise.resolve(null),
    studentPersonId
      ? schoolDataService.fetchData('students', { personId__eq: studentPersonId, page: 1, limit: 1 }, req.user)
      : Promise.resolve([]),
    studentPersonId
      ? schoolPersonAccessService.getPersonById({ reqUser: req.user, personId: studentPersonId })
      : Promise.resolve(null)
  ]);
  let studentRegistry = Array.isArray(studentRowsByPerson) && studentRowsByPerson.length ? studentRowsByPerson[0] : null;
  if (!studentRegistry && studentPersonId) {
    studentRegistry = await schoolDataService.getDataById('students', studentPersonId, req.user);
  }
  const studentPerson = studentPersonDirect || (studentRegistry && studentRegistry.personId
    ? await schoolPersonAccessService.getPersonById({ reqUser: req.user, personId: studentRegistry.personId })
    : null);
  const instanceDetails = buildReportInstanceDetailsForView(latestInstance, {
    assignment: effectiveAssignment,
    classData,
    classSessions,
    teacherPerson,
    studentRegistry,
    studentPerson
  });
  const reportReviewNavigator = await reportViewService.buildReportReviewNavigator({
    currentInstance: latestInstance,
    reqUser: req.user,
    participantOnly: req.reportInstanceParticipantAccess === true
  });
  const canUnlockReportInstance = await reportViewService.canUnlockReportInstance(req.user);

  return {
    title: `Report Editor: ${template.title}`,
    instance: latestInstance,
    template,
    assignment: effectiveAssignment,
    classData,
    instanceDetails,
    mergedData,
    validationSummary,
    reportReviewNavigator,
    canUnlockReportInstance,
    safeReturnUrl: resolveSafeSameOriginReturnUrl(req, latestInstance?.id),
    includeModal: true,
    user: req.user,
    actionStateId: req.actionStateId
  };
}

async function showInstanceEditor(req, res) {
  try {
    const renderContext = await buildInstanceEditorRenderContext(req);
    res.render('school/report/instanceEditor', renderContext);
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function showInstanceEditorV2(req, res) {
  try {
    const renderContext = await buildInstanceEditorRenderContext(req);
    res.render('school/report/instanceEditorV2', renderContext);
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function saveInstance(req, res) {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'report_instance_save',
      activeOrgId,
      String(req.params.id || '').trim(),
      String(req.body?.submitAction || '').trim(),
      req.body || {}
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(res, guardResult, 'Report save is already in progress. Please wait.')) return;

    const instance = await reportIntegrityService.getEditableInstanceOrThrow(req.params.id, req.user);

    const [template, assignment] = await Promise.all([
      schoolDataService.getDataById('reportTemplates', instance.templateId, req.user),
      schoolDataService.getDataById('reportAssignments', instance.assignmentId, req.user)
    ]);
    if (!template) throw new Error('Template not found.');
    const effectiveAssignment = reportViewService.applyAssignmentRow(
      assignment,
      reportViewService.findAssignmentRow(assignment, instance.assignmentRowId || '')
    );

    const saveResult = await reportInstanceSaveService.persistInstanceAnswers({
      instance,
      template,
      assignment: effectiveAssignment,
      body: req.body,
      submitAction: req.body?.submitAction,
      reqUser: req.user
    });
    const validationSummary = saveResult.validationSummary;

    const payloadOut = {
      status: 'success',
      message: 'Report saved successfully.',
      validation: {
        errorCount: validationSummary.errors.length,
        warningCount: validationSummary.warnings.length
      }
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect(`/school/reports/instances/edit/${instance.id}`);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function showReportMatrix(req, res) {
  try {
    const matrix = await reportMatrixService.buildMatrixContext({
      assignmentId: req.params.assignmentId,
      assignmentRowId: req.query.assignmentRowId || req.query.rowId || '',
      teacherId: req.query.teacherId || '',
      reqUser: req.user
    });
    return res.render('school/report/instanceMatrix', {
      title: `Fill Reports: ${matrix.templateTitle}`,
      matrix,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(400).render('error', {
      title: 'Unable to Open Report Matrix',
      message: error.message,
      user: req.user
    });
  }
}

async function saveReportMatrixRow(req, res) {
  let guardKey = '';
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'report_matrix_row_save',
      activeOrgId,
      String(req.params.assignmentId || '').trim(),
      String(body.assignmentRowId || '').trim(),
      String(body.teacherId || '').trim(),
      String(body.studentId || '').trim(),
      String(body.submitAction || 'save').trim(),
      body.answers || {},
      body.sharedAnswers || {}
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(res, guardResult, 'This report row save is already in progress. Please wait.')) return;

    const result = await reportMatrixService.saveMatrixRow({
      assignmentId: req.params.assignmentId,
      assignmentRowId: body.assignmentRowId || '',
      teacherId: body.teacherId || '',
      studentId: body.studentId || '',
      submitAction: body.submitAction || 'save',
      answers: body.answers && typeof body.answers === 'object' ? body.answers : {},
      sharedAnswers: body.sharedAnswers && typeof body.sharedAnswers === 'object' ? body.sharedAnswers : {},
      reqUser: req.user
    });
    const payloadOut = {
      status: 'success',
      message: result.status === 'submitted' ? 'Report submitted successfully.' : 'Report draft saved successfully.',
      instanceId: result.instanceId,
      reportStatus: result.status,
      validation: result.validation,
      matrix: result.matrix
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({
      status: 'error',
      message: error.message,
      validation: error.validationSummary || null
    });
  }
}

async function saveReportMatrixRows(req, res) {
  let guardKey = '';
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'report_matrix_bulk_save',
      activeOrgId,
      String(req.params.assignmentId || '').trim(),
      String(body.assignmentRowId || '').trim(),
      String(body.teacherId || '').trim(),
      String(body.submitAction || 'save').trim(),
      Array.isArray(body.rows) ? body.rows : [],
      body.sharedAnswers || {}
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(res, guardResult, 'This report bulk save is already in progress. Please wait.')) return;

    const result = await reportMatrixService.saveMatrixRows({
      assignmentId: req.params.assignmentId,
      assignmentRowId: body.assignmentRowId || '',
      teacherId: body.teacherId || '',
      rows: Array.isArray(body.rows) ? body.rows : [],
      submitAction: body.submitAction || 'save',
      sharedAnswers: body.sharedAnswers && typeof body.sharedAnswers === 'object' ? body.sharedAnswers : {},
      reqUser: req.user
    });
    const summary = result.summary || { total: 0, succeeded: 0, failed: 0, skipped: 0 };
    const actionLabel = String(body.submitAction || 'save').trim().toLowerCase() === 'submit' ? 'submitted' : 'saved';
    const payloadOut = {
      status: summary.failed > 0 ? 'partial' : 'success',
      message: String(summary.succeeded) + ' report(s) ' + actionLabel + '; ' + String(summary.skipped) + ' locked row(s) skipped; ' + String(summary.failed) + ' row(s) failed.',
      summary,
      results: result.results,
      matrix: result.matrix
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({
      status: 'error',
      message: error.message,
      validation: error.validationSummary || null
    });
  }
}

async function previewInstancePrefillRefresh(req, res) {
  try {
    const instance = await reportIntegrityService.getAccessibleInstanceOrThrow(req.params.id, req.user);
    const [template, assignment] = await Promise.all([
      schoolDataService.getDataById('reportTemplates', instance.templateId, req.user),
      schoolDataService.getDataById('reportAssignments', instance.assignmentId, req.user)
    ]);
    if (!template) throw new Error('Template not found.');

    if (String(instance.status || '').toLowerCase() === 'locked') {
      return res.status(400).json({
        status: 'error',
        message: 'Locked report instances cannot refresh prefill values.'
      });
    }

    const effectiveAssignment = reportViewService.applyAssignmentRow(
      assignment,
      reportViewService.findAssignmentRow(assignment, instance.assignmentRowId || '')
    );
    const preview = await buildPrefillRefreshPreview({ instance, template, assignment: effectiveAssignment, reqUser: req.user });
    return res.json({
      status: 'success',
      message: preview.changes.length
        ? `${preview.changes.length} prefill key update${preview.changes.length === 1 ? '' : 's'} found.`
        : 'No prefill value changes were found.',
      changes: preview.changes,
      changedCount: preview.changes.length
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function applyInstancePrefillRefresh(req, res) {
  try {
    const instance = await reportIntegrityService.getEditableInstanceOrThrow(req.params.id, req.user);
    const [template, assignment] = await Promise.all([
      schoolDataService.getDataById('reportTemplates', instance.templateId, req.user),
      schoolDataService.getDataById('reportAssignments', instance.assignmentId, req.user)
    ]);
    if (!template) throw new Error('Template not found.');
    const effectiveAssignment = reportViewService.applyAssignmentRow(
      assignment,
      reportViewService.findAssignmentRow(assignment, instance.assignmentRowId || '')
    );

    const rawSelected = Array.isArray(req.body?.selectedKeys)
      ? req.body.selectedKeys
      : String(req.body?.selectedKeys || '').split(',');
    const selectedKeys = new Set(
      rawSelected
        .map((key) => reportService.normalizePrefillKey(key))
        .filter(Boolean)
    );
    if (!selectedKeys.size) {
      throw new Error('Select at least one prefill key to replace.');
    }

    const preview = await buildPrefillRefreshPreview({ instance, template, assignment: effectiveAssignment, reqUser: req.user });
    const selectedChanges = preview.changes.filter((change) => selectedKeys.has(change.prefillKey));
    if (!selectedChanges.length) {
      throw new Error('The selected prefill keys no longer have changes to apply.');
    }

    const nextPrefill = {
      ...((instance.prefillSnapshot && typeof instance.prefillSnapshot === 'object') ? instance.prefillSnapshot : {})
    };
    const nextAnswers = {
      ...((instance.answers && typeof instance.answers === 'object') ? instance.answers : {})
    };
    selectedChanges.forEach((change) => {
      nextPrefill[change.prefillKey] = change.newRawValue;
      (change.fields || []).forEach((fieldChange) => {
        if (!fieldChange?.fieldId) return;
        nextAnswers[fieldChange.fieldId] = fieldChange.newValue;
      });
    });

    const mergedAfterPrefillRefresh = reportService.mergeTemplateData(
      template,
      {
        ...(instance || {}),
        prefillSnapshot: nextPrefill,
        answers: nextAnswers
      },
      effectiveAssignment
    );
    const recomputedAfterPrefillRefresh = reportService.recomputeCalculatedAnswers({
      template,
      mergedAnswers: mergedAfterPrefillRefresh,
      prefill: nextPrefill
    });
    const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
    fields.forEach((field) => {
      const type = String(field?.type || '').trim().toLowerCase();
      if (!field?.id || type === 'section' || type === 'subheader' || type === 'row_break') return;
      if (String(field?.valueMode || 'manual').trim().toLowerCase() !== 'calculated') return;
      nextAnswers[field.id] = recomputedAfterPrefillRefresh.answers[field.id];
    });

    await schoolDataService.updateData('reportInstances', instance.id, {
      prefillSnapshot: nextPrefill,
      answers: nextAnswers,
      audit: {
        lastUpdateUser: req.user?.id || '',
        lastUpdateDateTime: new Date().toISOString(),
        prefillRefreshedAt: new Date().toISOString()
      }
    }, req.user);

    return res.json({
      status: 'success',
      message: `Applied ${selectedChanges.length} selected prefill update${selectedChanges.length === 1 ? '' : 's'}.`,
      appliedCount: selectedChanges.length
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function lockInstance(req, res) {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'report_instance_lock',
      activeOrgId,
      String(req.params.id || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 90000,
      replayTtlMs: 10000
    });
    if (sendGuardedResponse(res, guardResult, 'Report lock is already in progress. Please wait.')) return;

    const instance = await reportIntegrityService.getAccessibleInstanceOrThrow(req.params.id, req.user);

    await schoolDataService.updateData('reportInstances', instance.id, {
      status: 'locked',
      audit: {
        lastUpdateUser: req.user?.id || '',
        lastUpdateDateTime: new Date().toISOString(),
        lockedAt: instance.audit?.lockedAt || new Date().toISOString()
      }
    }, req.user);

    const payloadOut = { status: 'success', message: 'Report locked successfully.' };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect(`/school/reports/instances/edit/${instance.id}`);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function unlockInstance(req, res) {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'report_instance_unlock',
      activeOrgId,
      String(req.params.id || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 90000,
      replayTtlMs: 10000
    });
    if (sendGuardedResponse(res, guardResult, 'Report unlock is already in progress. Please wait.')) return;

    const instance = await reportIntegrityService.assertInstanceUnlockable(req.params.id, req.user);
    const nextStatus = reportIntegrityService.resolveInstanceUnlockTargetStatus(instance);
    const now = new Date().toISOString();

    await schoolDataService.updateData('reportInstances', instance.id, {
      status: nextStatus,
      audit: {
        lastUpdateUser: req.user?.id || '',
        lastUpdateDateTime: now,
        unlockedAt: now,
        unlockedBy: toPublicId(req.user?.id || '')
      }
    }, req.user);

    const payloadOut = {
      status: 'success',
      message: `Report unlocked successfully. Status is now ${nextStatus}.`,
      nextStatus
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect(`/school/reports/instances/edit/${instance.id}`);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function exportInstance(req, res) {
  try {
    const instance = await reportIntegrityService.getAccessibleInstanceOrThrow(req.params.id, req.user);

    const [template, assignment] = await Promise.all([
      schoolDataService.getDataById('reportTemplates', instance.templateId, req.user),
      schoolDataService.getDataById('reportAssignments', instance.assignmentId, req.user)
    ]);
    if (!template) throw new Error('Template not found.');

    const effectiveAssignment = reportViewService.applyAssignmentRow(
      assignment,
      reportViewService.findAssignmentRow(assignment, instance.assignmentRowId || '')
    );
    const placeholderBundle = reportService.buildPlaceholderPayloadDetailed(template, instance, effectiveAssignment);
    const placeholders = placeholderBundle.placeholders;
    const collections = await reportService.buildReportDocxCollections({
      template,
      instance,
      assignment: effectiveAssignment,
      reqUser: req.user
    });
    const mergedAnswers = reportService.mergeTemplateData(template, instance, effectiveAssignment);
    const collectionDiagnostics = Object.fromEntries(
      Object.entries(collections || {}).map(([key, rows]) => [key, { rowCount: Array.isArray(rows) ? rows.length : 0 }])
    );
    const payload = {
      instanceId: instance.id,
      templateId: template.id,
      templateVersion: template.version,
      status: instance.status,
      placeholders,
      collections,
      answers: instance.answers || {},
      mergedAnswers,
      conversionDiagnostics: placeholderBundle.conversionDiagnostics || [],
      collectionDiagnostics,
      assignmentSharedAnswers: effectiveAssignment?.sharedAnswers || {},
      prefillSnapshot: instance.prefillSnapshot || {}
    };

    const format = String(req.query.format || 'json').trim().toLowerCase();

    if (format === 'docx') {
      const rendered = await reportDocxRenderService.renderReportInstanceDocx({
        template,
        instance,
        placeholders,
        collections
      });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${rendered.fileName}"`);
      return res.send(rendered.buffer);
    }

    if (String(req.query.download || '') === '1') {
      const fileName = `report-${instance.id}-payload.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(JSON.stringify(payload, null, 2));
    }

    res.json({ status: 'success', payload });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'DOCX Export Error', message: error.message, user: req.user });
  }
}


async function previewReportMatrixPrefill(req, res) {
  try {
    const preview = await reportMatrixService.buildMatrixPrefillPreview({ assignmentId: req.params.assignmentId, assignmentRowId: req.query.assignmentRowId || req.query.rowId || '', teacherId: req.query.teacherId || '', reqUser: req.user });
    return res.json(preview);
  } catch (error) { return res.status(400).json({ status: 'error', message: error.message }); }
}

async function applyReportMatrixPrefill(req, res) {
  let guardKey = '';
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey(['report_matrix_prefill_apply', activeOrgId, req.params.assignmentId, body.assignmentRowId || '', body.teacherId || '', body.updates || []]);
    const guardResult = idempotencyGuardService.beginGuard({ key: guardKey, runningTtlMs: 120000, replayTtlMs: 15000 });
    if (sendGuardedResponse(res, guardResult, 'This prefill update is already in progress. Please wait.')) return;
    const result = await reportMatrixService.applyMatrixPrefill({ assignmentId: req.params.assignmentId, assignmentRowId: body.assignmentRowId || '', teacherId: body.teacherId || '', updates: Array.isArray(body.updates) ? body.updates : [], reqUser: req.user });
    const payload = { status: result.summary.failed ? 'partial' : 'success', message: String(result.summary.succeeded) + ' student report(s) updated; ' + String(result.summary.skipped) + ' skipped.', summary: result.summary, results: result.results, matrix: result.matrix };
    idempotencyGuardService.completeGuard(guardKey, payload);
    return res.json(payload);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function exportReportMatrix(req, res) {
  try {
    const payload = await reportMatrixService.buildMatrixExportPayload({ assignmentId: req.params.assignmentId, assignmentRowId: req.query.assignmentRowId || req.query.rowId || '', teacherId: req.query.teacherId || '', reqUser: req.user });
    const format = String(req.query.format || 'json').trim().toLowerCase();
    if (format !== 'docx') {
      const output = JSON.stringify({ status: 'success', payload }, null, 2);
      if (String(req.query.download || '') === '1') { res.setHeader('Content-Type', 'application/json'); res.setHeader('Content-Disposition', 'attachment; filename="report-matrix-' + payload.assignmentId + '-payload.json"'); return res.send(output); }
      return res.json({ status: 'success', payload });
    }
    const [template, assignment] = await Promise.all([schoolDataService.getDataById('reportTemplates', payload.templateId, req.user), schoolDataService.getDataById('reportAssignments', payload.assignmentId, req.user)]);
    if (!template?.docxTemplate?.path) throw new Error('This report template has no DOCX file configured. Upload a DOCX template first.');
    const effectiveAssignment = reportViewService.applyAssignmentRow(assignment, reportViewService.findAssignmentRow(assignment, payload.assignmentRowId));
    const rendered = [];
    for (const row of payload.rows) {
      const instance = { id: row.instanceId || ('pending-' + row.studentId), assignmentId: payload.assignmentId, assignmentRowId: payload.assignmentRowId, templateId: payload.templateId, teacherId: payload.teacherId, studentId: row.studentId, status: row.status, answers: row.answers, prefillSnapshot: row.prefillSnapshot };
      const placeholderBundle = reportService.buildPlaceholderPayloadDetailed(template, instance, effectiveAssignment);
      const collections = await reportService.buildReportDocxCollections({ template, instance, assignment: effectiveAssignment, reqUser: req.user });
      rendered.push(await reportDocxRenderService.renderReportInstanceDocx({ template, instance, placeholders: placeholderBundle.placeholders, collections }));
    }
    const buffer = reportDocxRenderService.mergeReportInstanceDocxBuffers(rendered.map((item) => item.buffer));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="report-matrix-' + payload.assignmentId + '.docx"');
    return res.send(buffer);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Report Matrix Export Error', message: error.message, user: req.user });
  }
}

module.exports = {
  showHome,
  listTemplates,
  showTemplateForm,
  showTemplateCopyForm,
  saveTemplate,
  deleteTemplate,
  listAssignments,
  showAssignmentForm,
  generateAssignmentTargetRows,
  previewAssignmentTargetRows,
  saveAssignment,
  deleteAssignment,
  getAssignmentDeletePreview,
  listInstances,
  listPersonReports,
  startInstance,
  showInstanceEditor,
  showInstanceEditorV2,
  showReportMatrix,
  saveReportMatrixRow,
  saveReportMatrixRows,
  previewReportMatrixPrefill,
  applyReportMatrixPrefill,
  exportReportMatrix,
  saveInstance,
  previewInstancePrefillRefresh,
  applyInstancePrefillRefresh,
  lockInstance,
  unlockInstance,
  deleteInstance,
  exportInstance
};

