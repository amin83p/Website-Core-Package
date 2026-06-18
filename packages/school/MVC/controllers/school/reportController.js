const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const accessService = requireCoreModule('MVC/services/security');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

const { isAjax } = requireCoreModule('MVC/utils/generalTools');
const dataServiceGlobal = requireCoreModule('MVC/services/dataService');
const schoolDataService = require('../../services/school/schoolDataService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const reportService = require('../../services/school/reportService');
const reportDocxRenderService = require('../../services/school/reportDocxRenderService');
const reportIntegrityService = require('../../services/school/reportIntegrityService');
const reportViewService = require('../../services/school/reportViewService');
const reportRuleEngineService = require('../../services/school/reportRuleEngineService');
const { getPrefillValue } = require('../../services/school/reportPrefillKeyUtils');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
const reportTemplateModel = require('../../models/school/reportTemplateModel');
const reportAssignmentModel = require('../../models/school/reportAssignmentModel');
const reportInstanceModel = require('../../models/school/reportInstanceModel');
const {
  getActiveOrgIdOrThrow: getActiveOrgIdOrThrowShared,
  assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared
} = requireCoreModule('MVC/utils/orgContextUtils');

const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });
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

async function saveTemplate(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    const isEdit = Boolean(id);
    const activeOrgId = isEdit ? getActiveOrgIdOrThrow(req.user) : await assertCreateOrgContextOrThrow(req.user);
    let existing = null;

    if (isEdit) {
      existing = await reportIntegrityService.assertTemplateAccessible(id, req.user);
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
    const classFilter = String(req.query.classId || '').trim();
    const q = String(req.query.q || '').trim().toLowerCase();

    const { rows: assignments, selectedClassTitle } = await reportViewService.buildAssignmentListContext({
      reqUser: req.user,
      classFilter,
      q
    });

    const { data, pagination } = paginate(assignments, req.query);
    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    res.render('school/report/assignmentList', {
      title: 'Report Assignments',
      tableName: 'Report_Assignments',
      data,
      newUrl: 'school/reports/assignments',
      newLabel: 'Add Assignment',
      pagination,
      filters: req.query,
      selectedClassId: classFilter,
      selectedClassTitle,
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
      teacherIds,
      status,
      notes,
      timesheetReflection,
      allocatedHours
    } = requestPayload;
    if (timesheetReflection && (!Number.isFinite(allocatedHours) || allocatedHours <= 0)) {
      throw new Error('Enter allocated hours greater than zero when Timesheet reflection is enabled.');
    }
    const hasSessionTargets = selectedSessionIds.length > 0;
    const effectiveConflictPermitted = hasSessionTargets ? true : Boolean(conflictPermitted);

    const {
      sessions,
      template,
      effectiveDateTargets,
      persistedTargetStudentIds
    } = await reportIntegrityService.validateAssignmentCrossEntityContext({
      classId,
      templateId,
      reqUser: req.user,
      reportScope,
      hasSessionTargets,
      selectedDateTargets,
      selectedSessionIds,
      teacherIds,
      requestedTaskStartTime,
      requestedTaskEndTime,
      conflictPermitted: effectiveConflictPermitted,
      requestedReportStartDate,
      requestedReportDueDate,
      selectedTargetStudentIds,
      excludeAssignmentId: isEdit ? id : ''
    });

    const resolvedPeriod = reportViewService.resolveReportPeriod({
      requestedStartDate: requestedReportStartDate,
      requestedDueDate: requestedReportDueDate,
      selectedSessionIds,
      selectedDateTargets: effectiveDateTargets,
      sessions
    });

    const basePayload = {
      orgId: existing?.orgId || activeOrgId,
      classId,
      reportScope,
      targetStudentIds: persistedTargetStudentIds,
      templateId: template.id,
      templateVersion: Number(template.version || 1),
      teacherIds,
      conflictPermitted: effectiveConflictPermitted,
      taskStartTime: requestedTaskStartTime,
      taskEndTime: requestedTaskEndTime,
      reportStartDate: resolvedPeriod.reportStartDate,
      reportDueDate: resolvedPeriod.reportDueDate,
      status,
      notes,
      timesheetReflection,
      allocatedHours: timesheetReflection ? Number(allocatedHours) : 0,
      audit: {
        createUser: existing?.audit?.createUser || req.user?.id || '',
        createDateTime: existing?.audit?.createDateTime || new Date().toISOString(),
        lastUpdateUser: req.user?.id || '',
        lastUpdateDateTime: new Date().toISOString()
      }
    };

    if (isEdit) {
      if (hasSessionTargets) {
        if (selectedSessionIds.length !== 1) {
          throw new Error('Edit mode supports exactly one target session. Use New Assignment for bulk creation.');
        }
        const session = sessions.find((row) => idsEqual(row.sessionId || '', selectedSessionIds[0] || ''));
        if (!session) throw new Error('Selected class session was not found.');
        await schoolDataService.updateData('reportAssignments', id, {
          ...basePayload,
          targetType: 'session',
          sessionId: String(session.sessionId || ''),
          sessionDate: String(session.date || ''),
          dueDate: ''
        }, req.user);
      } else {
        if (effectiveDateTargets.length !== 1) {
          throw new Error('Edit mode supports exactly one due date target. Use New Assignment for bulk creation.');
        }
        const dueDate = String(effectiveDateTargets[0] || '').trim();
        await schoolDataService.updateData('reportAssignments', id, {
          ...basePayload,
          targetType: 'date',
          sessionId: '',
          sessionDate: dueDate,
          dueDate
        }, req.user);
      }
    } else {
      const payloads = [];
      if (hasSessionTargets) {
        selectedSessionIds.forEach((sessionId) => {
          const session = sessions.find((row) => idsEqual(row.sessionId || '', sessionId || ''));
          if (!session) throw new Error(`Selected class session was not found: ${sessionId}`);
          payloads.push({
            ...basePayload,
            targetType: 'session',
            sessionId: String(session.sessionId || ''),
            sessionDate: String(session.date || ''),
            dueDate: ''
          });
        });
      } else {
        effectiveDateTargets.forEach((dueDate) => {
          payloads.push({
            ...basePayload,
            targetType: 'date',
            sessionId: '',
            sessionDate: dueDate,
            dueDate
          });
        });
      }

      for (const payload of payloads) {
        await schoolDataService.addData('reportAssignments', payload, req.user);
      }

      if (isAjax(req)) {
        return res.json({
          status: 'success',
          message: `${payloads.length} assignment${payloads.length === 1 ? '' : 's'} saved successfully.`
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

    await schoolDataService.deleteData('reportAssignments', req.params.id, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Assignment deleted.' });
    res.redirect('/school/reports/assignments');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function listInstances(req, res) {
  try {
    const assignmentFilter = String(req.query.assignmentId || '').trim();
    const q = String(req.query.q || '').trim().toLowerCase();
    const instances = await reportViewService.buildInstanceListRows({
      reqUser: req.user,
      assignmentFilter,
      q
    });

    const { data, pagination } = paginate(instances, req.query);
    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    res.render('school/report/instanceList', {
      title: 'Report Instances',
      tableName: 'Report_Instances',
      data,
      newUrl: 'school/reports/instances',
      newLabel: null,
      pagination,
      filters: req.query,
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
    const {
      assignment,
      teacherId,
      targetStudentIds
    } = await reportIntegrityService.resolveStartInstanceContext({
      assignmentId: req.params.assignmentId,
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
      return res.redirect(`/school/reports/instances/edit/${createdOrResolved[0].id}`);
    }

    return res.redirect(`/school/reports/instances?assignmentId=${encodeURIComponent(assignment.id)}`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function showInstanceEditor(req, res) {
  try {
    const instance = await reportIntegrityService.getAccessibleInstanceOrThrow(req.params.id, req.user);

    const [template, assignment, classData] = await Promise.all([
      schoolDataService.getDataById('reportTemplates', instance.templateId, req.user),
      schoolDataService.getDataById('reportAssignments', instance.assignmentId, req.user),
      schoolDataService.getDataById('classes', instance.classId, req.user)
    ]);
    if (!template) throw new Error('Template not found for this report instance.');

    if (String(req.query.refreshPrefill || '') === '1' && String(instance.status || '') !== 'locked') {
      const refreshed = await reportService.buildPrefillSnapshot({
        assignment: assignment || {
          classId: instance.classId,
          sessionId: instance.sessionId,
          sessionDate: instance.sessionDate,
          teacherIds: [instance.teacherId]
        },
        teacherId: instance.teacherId,
        studentId: instance.studentId,
        reqUser: req.user
      });
      const hydrated = hydrateInitialAnswersFromPrefill(template, {
        ...instance,
        prefillSnapshot: refreshed
      }, { overwritePrefillFields: true });
      await schoolDataService.updateData('reportInstances', instance.id, {
        prefillSnapshot: refreshed,
        ...(hydrated.changed ? { answers: hydrated.answers } : {}),
        audit: {
          lastUpdateUser: req.user?.id || '',
          lastUpdateDateTime: new Date().toISOString()
        }
      }, req.user);
      return res.redirect(`/school/reports/instances/edit/${instance.id}`);
    }

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
    const mergedData = reportService.mergeTemplateData(template, latestInstance, assignment);
    const validationSummary = reportRuleEngineService.evaluateTemplateValidations({
      template,
      mergedAnswers: mergedData,
      prefill: latestInstance?.prefillSnapshot || {}
    });

    const studentPersonId = String(latestInstance.studentId || '').trim();
    const [classSessions, teacherPerson, studentRowsByPerson, studentPersonDirect] = await Promise.all([
      schoolDataService.getClassSessions(latestInstance.classId, req.user),
      latestInstance.teacherId
        ? dataServiceGlobal.getDataById('persons', latestInstance.teacherId, req.user, PERSON_QUERY_OPTIONS)
        : Promise.resolve(null),
      studentPersonId
        ? schoolDataService.fetchData('students', { personId__eq: studentPersonId, page: 1, limit: 1 }, req.user)
        : Promise.resolve([]),
      studentPersonId
        ? dataServiceGlobal.getDataById('persons', studentPersonId, req.user, PERSON_QUERY_OPTIONS)
        : Promise.resolve(null)
    ]);
    let studentRegistry = Array.isArray(studentRowsByPerson) && studentRowsByPerson.length ? studentRowsByPerson[0] : null;
    if (!studentRegistry && studentPersonId) {
      studentRegistry = await schoolDataService.getDataById('students', studentPersonId, req.user);
    }
    const studentPerson = studentPersonDirect || (studentRegistry && studentRegistry.personId
      ? await dataServiceGlobal.getDataById('persons', studentRegistry.personId, req.user, PERSON_QUERY_OPTIONS)
      : null);
    const instanceDetails = buildReportInstanceDetailsForView(latestInstance, {
      assignment,
      classData,
      classSessions,
      teacherPerson,
      studentRegistry,
      studentPerson
    });

    res.render('school/report/instanceEditor', {
      title: `Report Editor: ${template.title}`,
      instance: latestInstance,
      template,
      assignment,
      classData,
      instanceDetails,
      mergedData,
      validationSummary,
      safeReturnUrl: resolveSafeSameOriginReturnUrl(req, latestInstance?.id),
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
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

    const mergedBeforeSave = reportService.mergeTemplateData(template, instance, assignment);
    const parsedAnswers = reportViewService.buildInstanceAnswers(template, req.body, mergedBeforeSave);
    const recomputedBeforeSave = reportService.recomputeCalculatedAnswers({
      template,
      mergedAnswers: parsedAnswers.answers,
      prefill: instance?.prefillSnapshot || {}
    });
    const fullAnswers = recomputedBeforeSave.answers;
    const { studentAnswers, sharedAnswers } = reportService.partitionInstanceSave(template, assignment, fullAnswers);
    const nextStatus = reportViewService.resolveInstanceNextStatus(instance, req.body.submitAction);

    const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
    const sharedFieldIds = fields
      .filter((f) => {
        const type = String(f?.type || '').trim().toLowerCase();
        const visualOnly = type === 'section' || type === 'subheader' || type === 'row_break';
        return !visualOnly && f?.sharedAcrossStudents === true;
      })
      .map((f) => f.id);
    const eachStudent = String(assignment?.reportScope || '').trim().toLowerCase() === 'each_student';
    const nextShared = {};
    if (eachStudent && sharedFieldIds.length > 0) {
      sharedFieldIds.forEach((fid) => {
        nextShared[fid] = sharedAnswers[fid];
      });
    }

    const assignmentForValidation = eachStudent
      ? {
          ...(assignment || {}),
          sharedAnswers: {
            ...((assignment?.sharedAnswers && typeof assignment.sharedAnswers === 'object') ? assignment.sharedAnswers : {}),
            ...sharedAnswers
          }
        }
      : assignment;
    const mergedForValidation = reportService.mergeTemplateData(
      template,
      {
        ...(instance || {}),
        answers: studentAnswers,
        prefillSnapshot: instance?.prefillSnapshot || {}
      },
      assignmentForValidation
    );
    const validationSummary = reportRuleEngineService.evaluateTemplateValidations({
      template,
      mergedAnswers: mergedForValidation,
      prefill: instance?.prefillSnapshot || {},
      extraIssues: parsedAnswers.issues
    });
    const isSubmitAction = String(req.body?.submitAction || '').trim().toLowerCase() === 'submit';
    if (isSubmitAction && validationSummary.hasBlockingErrors) {
      const firstError = validationSummary.errors[0];
      const message = validationSummary.errors.length > 1
        ? `${firstError.message} (+${validationSummary.errors.length - 1} more validation error(s)).`
        : firstError.message;
      throw new Error(message);
    }

    if (eachStudent && sharedFieldIds.length > 0 && assignment?.id) {
      await schoolDataService.updateData('reportAssignments', assignment.id, {
        sharedAnswers: nextShared
      }, req.user);
    }

    await schoolDataService.updateData('reportInstances', instance.id, {
      answers: studentAnswers,
      status: nextStatus,
      audit: {
        lastUpdateUser: req.user?.id || '',
        lastUpdateDateTime: new Date().toISOString(),
        submittedAt: nextStatus === 'submitted' ? (instance.audit?.submittedAt || new Date().toISOString()) : instance.audit?.submittedAt
      }
    }, req.user);

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

async function exportInstance(req, res) {
  try {
    const instance = await reportIntegrityService.getAccessibleInstanceOrThrow(req.params.id, req.user);

    const [template, assignment] = await Promise.all([
      schoolDataService.getDataById('reportTemplates', instance.templateId, req.user),
      schoolDataService.getDataById('reportAssignments', instance.assignmentId, req.user)
    ]);
    if (!template) throw new Error('Template not found.');

    const placeholderBundle = reportService.buildPlaceholderPayloadDetailed(template, instance, assignment);
    const placeholders = placeholderBundle.placeholders;
    const mergedAnswers = reportService.mergeTemplateData(template, instance, assignment);
    const payload = {
      instanceId: instance.id,
      templateId: template.id,
      templateVersion: template.version,
      status: instance.status,
      placeholders,
      answers: instance.answers || {},
      mergedAnswers,
      conversionDiagnostics: placeholderBundle.conversionDiagnostics || [],
      assignmentSharedAnswers: assignment?.sharedAnswers || {},
      prefillSnapshot: instance.prefillSnapshot || {}
    };

    const format = String(req.query.format || 'json').trim().toLowerCase();

    if (format === 'docx') {
      const rendered = await reportDocxRenderService.renderReportInstanceDocx({
        template,
        instance,
        placeholders
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

module.exports = {
  showHome,
  listTemplates,
  showTemplateForm,
  saveTemplate,
  deleteTemplate,
  listAssignments,
  showAssignmentForm,
  saveAssignment,
  deleteAssignment,
  listInstances,
  listPersonReports,
  startInstance,
  showInstanceEditor,
  saveInstance,
  lockInstance,
  exportInstance
};

