'use strict';

const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { isAjax } = requireCoreModule('MVC/utils/generalTools');
const schoolDataService = require('../../services/school/schoolDataService');
const overallReportService = require('../../services/school/overallReportService');
const overallReportManagementService = require('../../services/school/overallReportManagementService');

function activeOrgId(reqUser) {
  const id = toPublicId(reqUser?.activeOrgId || reqUser?.organizationId || reqUser?.orgId);
  if (!id) throw new Error('Activate an organization before using overall report management.');
  return id;
}

function scoped(rows, reqUser) {
  const orgId = activeOrgId(reqUser);
  return (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row?.orgId, orgId));
}

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(String(value || ''));
  } catch (_) {
    return fallback;
  }
}

function parseList(value) {
  if (Array.isArray(value)) return value;
  return String(value || '')
    .split(',')
    .map((row) => String(row || '').trim())
    .filter(Boolean);
}

function sendError(req, res, error, title = 'Overall Report Management Error') {
  if (isAjax(req)) {
    return res.status(400).json({
      status: 'error',
      message: error.message,
      validation: error.validation || null
    });
  }
  return res.status(400).render('error', { title, message: error.message, user: req.user });
}

async function listManagementSessions(req, res) {
  try {
    const query = String(req.query.q || '').trim().toLowerCase();
    const rows = (await overallReportManagementService.listManagementSessions(req.user))
      .filter((row) => !query || [row.id, row.title, row.startDate, row.endDate]
        .some((value) => String(value || '').toLowerCase().includes(query)));
    const { data, pagination } = paginate(rows, req.query);
    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });
    return res.render('school/report/overallManagementList', {
      title: 'Overall Report Management',
      tableName: 'Overall_Report_Management',
      newUrl: 'school/reports/overall-management',
      newLabel: 'New Session',
      data,
      pagination,
      filters: req.query,
      user: req.user,
      print: true,
      includeModal: true,
      includeModal_Table: true
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function showNewWorkspace(req, res) {
  try {
    const templates = scoped(
      await schoolDataService.fetchAllData('overallReportTemplates', {}, req.user),
      req.user
    )
      .filter((row) => String(row.status || '').toLowerCase() === 'active')
      .map((row) => overallReportManagementService.buildTemplateMeta(row))
      .sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));
    return res.render('school/report/overallManagementWorkspace', {
      title: 'New Overall Report Management Session',
      session: null,
      templates,
      templateOptions: templates.map((row) => ({ id: row.id, label: row.title || row.id })),
      user: req.user,
      includeModal: true,
      actionStateId: res.locals.actionStateId || ''
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function showEditWorkspace(req, res) {
  try {
    const session = await overallReportManagementService.getManagementSession(req.params.id, req.user);
    const templates = scoped(
      await schoolDataService.fetchAllData('overallReportTemplates', {}, req.user),
      req.user
    )
      .filter((row) => (
        String(row.status || '').toLowerCase() === 'active'
        || (session.selectedTemplateIds || []).some((id) => idsEqual(id, row.id))
      ))
      .map((row) => overallReportManagementService.buildTemplateMeta(row))
      .sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));
    return res.render('school/report/overallManagementWorkspace', {
      title: session.title || 'Overall Report Management',
      session,
      templates,
      templateOptions: templates.map((row) => ({ id: row.id, label: row.title || row.id })),
      user: req.user,
      includeModal: true,
      actionStateId: res.locals.actionStateId || ''
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function loadMatrixApi(req, res) {
  try {
    const payload = await overallReportManagementService.loadManagementMatrix({
      templateIds: parseList(req.body.templateIds || req.body.selectedTemplateIds),
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      studentIds: parseList(req.body.studentIds),
      statuses: parseList(req.body.statuses).length
        ? parseList(req.body.statuses)
        : ['submitted', 'locked'],
      excludeStudentIds: parseList(req.body.excludeStudentIds),
      reqUser: req.user
    });
    return res.json({ status: 'success', ...payload });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function saveSessionApi(req, res) {
  try {
    const rows = parseJson(req.body.rowsJson, parseJson(req.body.rows, []));
    const saved = await overallReportManagementService.saveManagementSession({
      id: req.body.id || req.params.id || '',
      title: req.body.title,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      selectedTemplateIds: parseList(req.body.selectedTemplateIds || req.body.templateIds),
      addFilters: parseJson(req.body.addFiltersJson, {
        studentIds: parseList(req.body.addStudentIds),
        statuses: parseList(req.body.addStatuses)
      }),
      rows,
      reqUser: req.user
    });
    return res.json({
      status: 'success',
      message: 'Management session saved.',
      session: saved,
      redirect: `/school/reports/overall-management/edit/${encodeURIComponent(saved.id)}`
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function addStudents(req, res) {
  try {
    const session = await overallReportManagementService.getManagementSession(req.params.id, req.user);
    const result = await overallReportManagementService.addStudentsToSession({
      session,
      addFilters: {
        studentIds: parseList(req.body.studentIds || req.body.addStudentIds),
        statuses: parseList(req.body.statuses || req.body.addStatuses).length
          ? parseList(req.body.statuses || req.body.addStatuses)
          : (session.addFilters?.statuses || ['submitted', 'locked'])
      },
      reqUser: req.user
    });
    return res.json({
      status: 'success',
      message: result.added.length
        ? `${result.added.length} student(s) added.`
        : 'No new students matched the filters.',
      session: result.session,
      added: result.added
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function createRowInstance(req, res) {
  try {
    const session = await overallReportManagementService.getManagementSession(req.params.id, req.user);
    const result = await overallReportManagementService.createRowOverallInstance({
      session,
      studentId: req.params.studentId,
      reqUser: req.user
    });
    return res.json({
      status: 'success',
      message: 'Overall report created for student.',
      instance: result.instance,
      session: result.session
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function rowPreview(req, res) {
  try {
    const session = await overallReportManagementService.getManagementSession(req.params.id, req.user);
    const row = overallReportManagementService.findSessionRow(session, req.params.studentId);
    if (!row.overallInstanceId) throw new Error('Create an overall report for this student before previewing.');
    const instance = await overallReportService.getOverallInstance(row.overallInstanceId, req.user);
    if (req.method === 'POST') {
      const answers = parseJson(req.body.answersJson, req.body.answers || {});
      const result = await overallReportService.saveStudentAnswers({
        instance,
        studentId: req.params.studentId,
        submittedAnswers: answers,
        reqUser: req.user
      });
      return res.json({ status: 'success', message: 'Student answers saved.', ...result });
    }
    return res.json({
      status: 'success',
      ...overallReportService.previewStudentEntry({
        instance,
        studentId: req.params.studentId
      })
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function rowExportDocx(req, res) {
  try {
    const session = await overallReportManagementService.getManagementSession(req.params.id, req.user);
    const row = overallReportManagementService.findSessionRow(session, req.params.studentId);
    if (!row.overallInstanceId) throw new Error('Create an overall report for this student before exporting.');
    const instance = await overallReportService.getOverallInstance(row.overallInstanceId, req.user);
    const result = await overallReportService.generateStudentDocx({
      instance,
      studentId: req.params.studentId,
      docxKey: req.body.selectedDocxKey || req.body.docxKey || row.selectedDocxKey || instance.selectedDocxKey,
      reqUser: req.user
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${result.rendered.fileName}"`);
    return res.send(result.rendered.buffer);
  } catch (error) {
    return sendError(req, res, error, 'Export Overall Report Document');
  }
}

async function rowExportPayload(req, res) {
  try {
    const session = await overallReportManagementService.getManagementSession(req.params.id, req.user);
    const row = overallReportManagementService.findSessionRow(session, req.params.studentId);
    if (!row.overallInstanceId) throw new Error('Create an overall report for this student before exporting.');
    const instance = await overallReportService.getOverallInstance(row.overallInstanceId, req.user);
    const payload = overallReportService.buildOverallExportPayload(instance);
    const fileName = `${instance.id || 'overall'}-payload.json`;
    if (String(req.query.download || '') === '1') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    }
    return res.json(payload);
  } catch (error) {
    return sendError(req, res, error, 'Export Overall Report Payload');
  }
}

async function deleteManagementSession(req, res) {
  try {
    const session = await overallReportManagementService.getManagementSession(req.params.id, req.user);
    await overallReportManagementService.deleteManagementSession(session, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Management session deleted.' });
    return res.redirect('/school/reports/overall-management');
  } catch (error) {
    return sendError(req, res, error);
  }
}

module.exports = {
  listManagementSessions,
  showNewWorkspace,
  showEditWorkspace,
  loadMatrixApi,
  saveSessionApi,
  addStudents,
  createRowInstance,
  rowPreview,
  rowExportDocx,
  rowExportPayload,
  deleteManagementSession
};
