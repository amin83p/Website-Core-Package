'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const schoolDataService = require('./schoolDataService');
const overallReportService = require('./overallReportService');
const reportFunderDocxService = require('./reportFunderDocxService');
const overallReportManagementSessionModel = require('../../models/school/overallReportManagementSessionModel');

function clean(value, max = 4000) {
  const text = String(value ?? '').replace(/\0/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function activeOrgId(reqUser) {
  const id = toPublicId(reqUser?.activeOrgId || reqUser?.organizationId || reqUser?.orgId);
  if (!id) throw new Error('Activate an organization before using overall report management.');
  return id;
}

function cloneSlots(slots = {}) {
  const out = {};
  Object.entries(slots || {}).forEach(([slotKey, rows]) => {
    out[slotKey] = (Array.isArray(rows) ? rows : []).map((row) => ({ ...row }));
  });
  return out;
}

function templateReferencedByRows(rows, templateId) {
  return (Array.isArray(rows) ? rows : []).some((row) => (
    idsEqual(row?.selectedOverallTemplateId, templateId)
  ));
}

function assertTemplateRemovalAllowed(existingRows, nextTemplateIds) {
  const removed = (existingRows?.selectedTemplateIds || []).filter(
    (id) => !nextTemplateIds.some((nextId) => idsEqual(nextId, id))
  );
  removed.forEach((templateId) => {
    if (templateReferencedByRows(existingRows?.rows, templateId)) {
      throw new Error(`Overall template ${templateId} cannot be removed because students are assigned to it.`);
    }
  });
}

function buildTemplateMeta(template) {
  return {
    id: template.id,
    title: template.title,
    hasOverallFields: overallReportService.templateHasOverallFields(template),
    hasAttachedDocx: overallReportService.templateHasAttachedDocx(template),
    docxOptions: reportFunderDocxService.buildAvailableDocxOptions(template)
  };
}

function templateMatchesStudent(templateSlots, studentSlots) {
  return templateSlots.every((slot) => {
    const options = studentSlots?.[slot.slotKey] || [];
    return options.length > 0;
  });
}

function buildDefaultSelections(templateSlots, studentSlots) {
  const selections = {};
  templateSlots.forEach((slot) => {
    const options = studentSlots?.[slot.slotKey] || [];
    if (options.length === 1) {
      selections[slot.slotKey] = options[0].id;
    }
  });
  return selections;
}

function selectionsFromMap(selectionMap, templateSlots) {
  return templateSlots
    .map((slot) => {
      const instanceId = selectionMap?.[slot.slotKey];
      if (!instanceId) return null;
      return { slotKey: slot.slotKey, instanceId };
    })
    .filter(Boolean);
}

function flattenStudentInstancesForStudent(templateSlotsByTemplate, templates) {
  const instances = [];
  templates.forEach((template) => {
    const slots = templateSlotsByTemplate[template.id] || {};
    const slotMeta = new Map((template.sourceSlots || []).map((slot) => [slot.slotKey, slot]));
    Object.entries(slots).forEach(([slotKey, rows]) => {
      const meta = slotMeta.get(slotKey) || {};
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        instances.push({
          instanceId: row.id,
          instanceTitle: row.title || row.id,
          sourceTemplateTitle: meta.templateTitle || row.templateId || '',
          slotKey,
          overallTemplateId: template.id
        });
      });
    });
  });
  return instances;
}

function buildRowFromMatrixStudent(student, templates, selectedTemplateIds) {
  const matchingTemplates = templates
    .filter((template) => selectedTemplateIds.some((id) => idsEqual(id, template.id)))
    .filter((template) => templateMatchesStudent(
      template.sourceSlots,
      student.templateSlots?.[template.id] || {}
    ))
    .map((template) => ({
      templateId: template.id,
      templateTitle: template.title,
      hasOverallFields: template.hasOverallFields,
      hasAttachedDocx: template.hasAttachedDocx
    }));

  let selectedOverallTemplateId = null;
  if (matchingTemplates.length === 1) {
    selectedOverallTemplateId = matchingTemplates[0].templateId;
  }

  const activeTemplate = templates.find((row) => idsEqual(row.id, selectedOverallTemplateId));
  const activeSlots = activeTemplate
    ? (student.templateSlots?.[activeTemplate.id] || {})
    : {};
  const defaultSelections = activeTemplate
    ? buildDefaultSelections(activeTemplate.sourceSlots, activeSlots)
    : {};
  const sourceSelections = activeTemplate
    ? selectionsFromMap(defaultSelections, activeTemplate.sourceSlots)
    : [];

  return {
    studentId: student.studentId,
    studentName: student.studentName,
    instances: flattenStudentInstancesForStudent(student.templateSlots || {}, templates),
    sourceSelections,
    selectedOverallTemplateId,
    excludedOverallTemplateIds: [],
    overallInstanceId: null,
    selectedDocxKey: 'default',
    matchingTemplates
  };
}

async function loadManagementMatrix({
  templateIds = [],
  startDate = '',
  endDate = '',
  studentIds = [],
  statuses = ['submitted', 'locked'],
  excludeStudentIds = [],
  reqUser
}) {
  const selectedTemplateIds = [...new Set(
    (Array.isArray(templateIds) ? templateIds : [])
      .map((id) => clean(id))
      .filter(Boolean)
  )];
  if (!selectedTemplateIds.length) throw new Error('Select at least one overall report template.');
  const exclude = new Set(
    (Array.isArray(excludeStudentIds) ? excludeStudentIds : [])
      .map((id) => clean(id))
      .filter(Boolean)
  );

  const templates = [];
  const studentMap = new Map();

  for (const templateId of selectedTemplateIds) {
    // eslint-disable-next-line no-await-in-loop
    const template = await schoolDataService.getDataById('overallReportTemplates', templateId, reqUser);
    if (!template || !idsEqual(template.orgId, activeOrgId(reqUser))) {
      throw new Error(`Overall report template ${templateId} was not found.`);
    }
    // eslint-disable-next-line no-await-in-loop
    const candidates = await overallReportService.loadOverallCreateCandidates({
      template,
      startDate,
      endDate,
      studentIds,
      statuses,
      reqUser
    });
    const meta = {
      ...buildTemplateMeta(template),
      sourceSlots: candidates.sourceSlots || []
    };
    templates.push(meta);

    (candidates.students || []).forEach((student) => {
      if (exclude.has(student.studentId)) return;
      if (!studentMap.has(student.studentId)) {
        studentMap.set(student.studentId, {
          studentId: student.studentId,
          studentName: student.studentName,
          templateSlots: {}
        });
      }
      const entry = studentMap.get(student.studentId);
      entry.templateSlots[template.id] = cloneSlots(student.slots);
      if (!entry.studentName && student.studentName) entry.studentName = student.studentName;
    });
  }

  const students = [...studentMap.values()]
    .map((student) => buildRowFromMatrixStudent(student, templates, selectedTemplateIds))
    .sort((a, b) => String(a.studentName || a.studentId).localeCompare(String(b.studentName || b.studentId)));

  return {
    templates,
    selectedTemplateIds,
    filters: {
      startDate: clean(startDate, 20),
      endDate: clean(endDate, 20),
      studentIds: [...new Set((Array.isArray(studentIds) ? studentIds : []).map((id) => clean(id)).filter(Boolean))],
      statuses: [...new Set((Array.isArray(statuses) ? statuses : ['submitted', 'locked']).map((s) => clean(s, 20).toLowerCase()).filter(Boolean))]
    },
    students
  };
}

async function getManagementSession(id, reqUser) {
  const session = await schoolDataService.getDataById('overallReportManagementSessions', id, reqUser);
  if (!session) throw new Error('Management session not found.');
  if (!idsEqual(session.orgId, activeOrgId(reqUser))) {
    throw new Error('Management session is outside the active organization.');
  }
  return session;
}

async function listManagementSessions(reqUser) {
  const orgId = activeOrgId(reqUser);
  return (await schoolDataService.fetchAllData('overallReportManagementSessions', {}, reqUser))
    .filter((row) => idsEqual(row.orgId, orgId))
    .sort((a, b) => String(b.audit?.lastUpdateDateTime || '').localeCompare(String(a.audit?.lastUpdateDateTime || '')));
}

async function saveManagementSession({
  id = '',
  title = '',
  startDate = '',
  endDate = '',
  selectedTemplateIds = [],
  addFilters = {},
  rows = [],
  reqUser
}) {
  const orgId = activeOrgId(reqUser);
  const now = new Date().toISOString();
  const nextTemplateIds = [...new Set(
    (Array.isArray(selectedTemplateIds) ? selectedTemplateIds : [])
      .map((templateId) => clean(templateId))
      .filter(Boolean)
  )];

  if (id) {
    const existing = await getManagementSession(id, reqUser);
    const nextStart = clean(startDate) || existing.startDate;
    const nextEnd = clean(endDate) || existing.endDate;
    if (nextStart !== clean(existing.startDate, 20) || nextEnd !== clean(existing.endDate, 20)) {
      throw new Error('Date range cannot be changed after the session is saved.');
    }
    assertTemplateRemovalAllowed(existing, nextTemplateIds);
    const updated = await schoolDataService.updateData('overallReportManagementSessions', existing.id, {
      title: clean(title) || existing.title,
      startDate: existing.startDate,
      endDate: existing.endDate,
      selectedTemplateIds: nextTemplateIds,
      addFilters: overallReportManagementSessionModel.sanitizeAddFilters(addFilters),
      rows: overallReportManagementSessionModel.sanitizeRows(rows),
      audit: {
        ...(existing.audit || {}),
        lastUpdateUser: reqUser?.id || '',
        lastUpdateDateTime: now
      }
    }, reqUser);
    return updated;
  }

  const record = overallReportManagementSessionModel.sanitizeSession({
    orgId,
    title: clean(title) || `Overall Report Management ${now.slice(0, 10)}`,
    status: 'draft',
    startDate,
    endDate,
    selectedTemplateIds: nextTemplateIds,
    addFilters,
    rows,
    audit: {
      createUser: reqUser?.id || '',
      createDateTime: now,
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: now
    }
  });
  return schoolDataService.addData('overallReportManagementSessions', record, reqUser);
}

async function addStudentsToSession({ session, addFilters = {}, reqUser }) {
  const existingIds = (session.rows || []).map((row) => row.studentId);
  const matrix = await loadManagementMatrix({
    templateIds: session.selectedTemplateIds,
    startDate: session.startDate,
    endDate: session.endDate,
    studentIds: addFilters.studentIds || [],
    statuses: addFilters.statuses || session.addFilters?.statuses || ['submitted', 'locked'],
    excludeStudentIds: existingIds,
    reqUser
  });
  const mergedRows = [
    ...(session.rows || []),
    ...matrix.students.map((row) => overallReportManagementSessionModel.sanitizeRow({
      studentId: row.studentId,
      studentName: row.studentName,
      instances: row.instances,
      sourceSelections: row.sourceSelections,
      selectedOverallTemplateId: row.selectedOverallTemplateId,
      excludedOverallTemplateIds: row.excludedOverallTemplateIds,
      overallInstanceId: null,
      selectedDocxKey: 'default'
    }))
  ];
  const updated = await schoolDataService.updateData('overallReportManagementSessions', session.id, {
    addFilters: overallReportManagementSessionModel.sanitizeAddFilters({
      ...(session.addFilters || {}),
      ...addFilters
    }),
    rows: overallReportManagementSessionModel.sanitizeRows(mergedRows),
    audit: {
      ...(session.audit || {}),
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: new Date().toISOString()
    }
  }, reqUser);
  return { session: updated, added: matrix.students };
}

function findSessionRow(session, studentId) {
  const row = (session.rows || []).find((entry) => idsEqual(entry.studentId, studentId));
  if (!row) throw new Error('Student row not found in this management session.');
  return row;
}

async function createRowOverallInstance({ session, studentId, reqUser }) {
  const row = findSessionRow(session, studentId);
  if (row.overallInstanceId) throw new Error('An overall report has already been created for this student.');
  const templateId = row.selectedOverallTemplateId;
  if (!templateId) throw new Error('Select an overall report template for this student first.');
  const template = await schoolDataService.getDataById('overallReportTemplates', templateId, reqUser);
  if (!template || !idsEqual(template.orgId, session.orgId)) {
    throw new Error('Selected overall report template was not found.');
  }
  if (!overallReportService.templateHasOverallFields(template)) {
    throw new Error('The selected overall report template has no defined fields.');
  }
  const slots = template.sourceSlots || [];
  const selectionMap = Object.fromEntries(
    (row.sourceSelections || []).map((entry) => [entry.slotKey, entry.instanceId])
  );
  if (slots.some((slot) => !selectionMap[slot.slotKey])) {
    throw new Error('Select a source report for every required template slot.');
  }

  const instance = await overallReportService.createOverallWorkspace({
    template,
    filters: {
      startDate: session.startDate,
      endDate: session.endDate,
      studentIds: [studentId],
      statuses: session.addFilters?.statuses || ['submitted', 'locked']
    },
    selectedDocxKey: row.selectedDocxKey || 'default',
    selectedPdfKey: row.selectedPdfKey || 'default',
    title: `${session.title} — ${row.studentName || studentId}`,
    studentEntries: [{
      studentId,
      studentName: row.studentName,
      sourceSelections: row.sourceSelections,
      included: true
    }],
    reqUser,
    allowMissingDocx: true
  });

  const nextRows = (session.rows || []).map((entry) => (
    idsEqual(entry.studentId, studentId)
      ? { ...entry, overallInstanceId: instance.id }
      : entry
  ));
  const updatedSession = await schoolDataService.updateData('overallReportManagementSessions', session.id, {
    rows: nextRows,
    audit: {
      ...(session.audit || {}),
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: new Date().toISOString()
    }
  }, reqUser);
  return { instance, session: updatedSession };
}

async function deleteManagementSession(session, reqUser) {
  if (String(session.status || '') !== 'draft') {
    throw new Error('Only draft management sessions can be deleted.');
  }
  await schoolDataService.deleteData('overallReportManagementSessions', session.id, reqUser);
}

module.exports = {
  loadManagementMatrix,
  getManagementSession,
  listManagementSessions,
  saveManagementSession,
  addStudentsToSession,
  createRowOverallInstance,
  deleteManagementSession,
  findSessionRow,
  buildTemplateMeta,
  templateReferencedByRows
};
