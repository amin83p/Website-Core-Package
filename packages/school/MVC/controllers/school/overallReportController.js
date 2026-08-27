'use strict';

const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const uploadMiddleware = requireCoreModule('MVC/middleware/upload');
const { isAjax } = requireCoreModule('MVC/utils/generalTools');
const schoolDataService = require('../../services/school/schoolDataService');
const reportViewService = require('../../services/school/reportViewService');
const reportFunderDocxService = require('../../services/school/reportFunderDocxService');
const reportFunderPdfService = require('../../services/school/reportFunderPdfService');
const reportPdfRenderService = require('../../services/school/reportPdfRenderService');
const overallReportService = require('../../services/school/overallReportService');
const overallReportTemplateModel = require('../../models/school/overallReportTemplateModel');

function activeOrgId(reqUser) {
  const id = toPublicId(reqUser?.activeOrgId || reqUser?.organizationId || reqUser?.orgId);
  if (!id) throw new Error('Activate an organization before using overall reports.');
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

function clonePlainValue(value, fallback) {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function uploadedFileRecord(file) {
  if (!file) return null;
  const storedPath = uploadMiddleware.getStoredFilePath(file);
  const storedUrl = uploadMiddleware.getStoredFileUrl(file);
  if (!storedPath && !storedUrl) return null;
  return {
    fileName: String(file.filename || ''),
    originalName: String(file.originalname || file.filename || ''),
    path: String(storedPath || storedUrl),
    url: String(storedUrl || storedPath),
    uploadedAt: new Date().toISOString()
  };
}

function sendError(req, res, error, title = 'Overall Report Error') {
  if (isAjax(req)) return res.status(400).json({
    status: 'error',
    message: error.message,
    validation: error.validation || null
  });
  return res.status(400).render('error', { title, message: error.message, user: req.user });
}

function sendForbidden(req, res, message) {
  if (isAjax(req)) return res.status(403).json({ status: 'error', message });
  return res.status(403).render('error', {
    title: 'Access Denied',
    message,
    user: req.user
  });
}

async function listTemplates(req, res) {
  try {
    const query = String(req.query.q || '').trim().toLowerCase();
    const rows = scoped(await schoolDataService.fetchAllData('overallReportTemplates', {}, req.user), req.user)
      .filter((row) => !query || [row.id, row.title, row.status, row.description]
        .some((value) => String(value || '').toLowerCase().includes(query)))
      .sort((a, b) => String(b.audit?.lastUpdateDateTime || '').localeCompare(String(a.audit?.lastUpdateDateTime || '')));
    const { data, pagination } = paginate(rows, req.query);
    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });
    return res.render('school/report/overallTemplateList', {
      title: 'Overall Report Templates',
      tableName: 'Overall_Report_Templates',
      data,
      pagination,
      filters: req.query,
      newUrl: 'school/reports/overall-templates',
      newLabel: 'Add Overall Template',
      print: true,
      includeModal: true,
      includeModal_Table: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function loadTemplateFormData(req, template = null) {
  const orgId = activeOrgId(req.user);
  const sourceTemplates = scoped(await schoolDataService.fetchAllData('reportTemplates', {}, req.user), req.user)
    .filter((row) => String(row.status || '').toLowerCase() !== 'archived')
    .map((row) => {
      const keyOptions = overallReportService.getSourceTemplateKeyOptions(row);
      return {
        ...row,
        keyOptions,
        keyCatalog: overallReportService.getSourceTemplateKeyCatalog(row)
      };
    });
  const activeFunders = await reportFunderDocxService.loadActiveFunderOptions(req.user, orgId).catch(() => []);
  return {
    template: template || {
      title: '',
      version: 1,
      status: 'draft',
      description: '',
      nextSlotNumber: 2,
      sourceSlots: [
        { slotKey: 'T1', order: 1, templateId: '', templateVersionAtSelection: 1 }
      ],
      schema: { version: 1, fields: [] },
      docxTemplatesByFunder: []
    },
    sourceTemplates,
    funderPickerOptions: reportFunderDocxService.buildFunderPickerOptions(activeFunders),
    valueModes: overallReportTemplateModel.OVERALL_VALUE_MODES,
    statuses: overallReportTemplateModel.TEMPLATE_STATUSES
  };
}

async function showTemplateForm(req, res) {
  try {
    let template = null;
    if (req.params.id) {
      template = await schoolDataService.getDataById('overallReportTemplates', req.params.id, req.user);
      if (!template || !idsEqual(template.orgId, activeOrgId(req.user))) throw new Error('Overall report template not found.');
    }
    const context = await loadTemplateFormData(req, template);
    return res.render('school/report/overallTemplateForm', {
      title: template ? 'Edit Overall Report Template' : 'New Overall Report Template',
      ...context,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function saveTemplate(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    const orgId = activeOrgId(req.user);
    const existing = id
      ? await schoolDataService.getDataById('overallReportTemplates', id, req.user)
      : null;
    if (id && (!existing || !idsEqual(existing.orgId, orgId))) throw new Error('Overall report template not found.');
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    const defaultFile = uploadedFiles.find((file) => String(file.fieldname) === 'docxTemplate');
    const docxTemplate = uploadedFileRecord(defaultFile) || existing?.docxTemplate || null;
    const defaultPdfFile = uploadedFiles.find((file) => String(file.fieldname) === 'pdfTemplate');
    const pdfTemplate = uploadedFileRecord(defaultPdfFile) || existing?.pdfTemplate || null;
    const docxTemplatesByFunder = reportViewService.buildDocxTemplatesByFunderFromUpload({
      body: req.body,
      existingTemplate: existing,
      uploadedFiles
    });
    const pdfTemplatesByFunder = reportViewService.buildPdfTemplatesByFunderFromUpload({
      body: req.body,
      existingTemplate: existing,
      uploadedFiles
    });
    const pdfFieldMap = reportViewService.buildPdfFieldMapFromPayload(req.body);
    const rawPayload = {
      ...(existing || {}),
      orgId,
      title: req.body.title,
      version: req.body.version,
      status: req.body.status,
      description: req.body.description,
      sourceSlots: parseJson(req.body.sourceSlotsJson, []),
      nextSlotNumber: req.body.nextSlotNumber,
      schema: parseJson(req.body.schemaJson, { version: 1, fields: [] }),
      placeholderMap: parseJson(req.body.placeholderMapJson, {}),
      docxTemplate,
      docxTemplatesByFunder,
      pdfTemplate,
      pdfTemplatesByFunder,
      pdfFieldMap,
      audit: {
        ...(existing?.audit || {}),
        createUser: existing?.audit?.createUser || req.user?.id || '',
        createDateTime: existing?.audit?.createDateTime || new Date().toISOString(),
        lastUpdateUser: req.user?.id || '',
        lastUpdateDateTime: new Date().toISOString()
      }
    };
    const payload = overallReportTemplateModel.sanitizeTemplate(rawPayload, { existing, isUpdate: Boolean(existing) });
    await overallReportService.validateTemplateReferences(payload, req.user);
    const saved = existing
      ? await schoolDataService.updateData('overallReportTemplates', existing.id, payload, req.user)
      : await schoolDataService.addData('overallReportTemplates', payload, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Overall report template saved.', result: saved });
    return res.redirect('/school/reports/overall-templates');
  } catch (error) {
    return sendError(req, res, error, 'Save Overall Report Template');
  }
}

async function inspectTemplatePdfFields(req, res) {
  try {
    const orgId = activeOrgId(req.user);
    const template = await schoolDataService.getDataById('overallReportTemplates', req.params.id, req.user);
    if (!template || !idsEqual(template.orgId, orgId)) throw new Error('Overall report template not found.');
    const selectedPdfKey = String(req.query.pdfKey || req.body?.pdfKey || 'default').trim();
    const resolved = reportFunderPdfService.resolvePdfTemplateForFunder({
      template,
      funderKey: selectedPdfKey || 'default'
    });
    if (!resolved.pdfTemplate) {
      throw new Error('This overall report template has no PDF file configured. Upload a PDF template first.');
    }
    const inspected = await reportPdfRenderService.inspectPdfTemplateFields(resolved.pdfTemplate);
    return res.json({
      status: 'success',
      templateId: template.id,
      pdfKey: resolved.pdfKey,
      label: resolved.label,
      fields: inspected.fields,
      filePath: inspected.filePath
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function copyTemplate(req, res) {
  try {
    const orgId = activeOrgId(req.user);
    const source = await schoolDataService.getDataById('overallReportTemplates', req.params.id, req.user);
    if (!source || !idsEqual(source.orgId, orgId)) throw new Error('Overall report template not found.');

    const now = new Date().toISOString();
    const payload = overallReportTemplateModel.sanitizeTemplate({
      orgId,
      title: `${String(source.title || 'Overall Report Template').trim() || 'Overall Report Template'} Copy`,
      version: source.version,
      status: 'draft',
      description: source.description,
      sourceSlots: clonePlainValue(source.sourceSlots, []),
      nextSlotNumber: source.nextSlotNumber,
      schema: clonePlainValue(source.schema, { version: 1, fields: [] }),
      placeholderMap: clonePlainValue(source.placeholderMap, {}),
      docxTemplate: clonePlainValue(source.docxTemplate, null),
      docxTemplatesByFunder: clonePlainValue(source.docxTemplatesByFunder, []),
      pdfTemplate: clonePlainValue(source.pdfTemplate, null),
      pdfTemplatesByFunder: clonePlainValue(source.pdfTemplatesByFunder, []),
      pdfFieldMap: clonePlainValue(source.pdfFieldMap, {}),
      audit: {
        createUser: req.user?.id || '',
        createDateTime: now,
        lastUpdateUser: req.user?.id || '',
        lastUpdateDateTime: now
      }
    });
    await overallReportService.validateTemplateReferences(payload, req.user);
    const saved = await schoolDataService.addData('overallReportTemplates', payload, req.user);
    if (isAjax(req)) return res.json({
      status: 'success',
      message: 'Overall report template copied.',
      result: saved,
      redirectTo: `/school/reports/overall-templates/edit/${encodeURIComponent(String(saved?.id || ''))}`
    });
    return res.redirect(`/school/reports/overall-templates/edit/${encodeURIComponent(String(saved?.id || ''))}`);
  } catch (error) {
    return sendError(req, res, error, 'Copy Overall Report Template');
  }
}

async function deleteTemplate(req, res) {
  try {
    const template = await schoolDataService.getDataById('overallReportTemplates', req.params.id, req.user);
    if (!template || !idsEqual(template.orgId, activeOrgId(req.user))) throw new Error('Overall report template not found.');
    const linked = scoped(await schoolDataService.fetchData('overallReportInstances', {
      overallTemplateId__eq: template.id
    }, req.user), req.user);
    if (linked.length) {
      throw new Error(`This template is referenced by ${linked.length} overall report instance(s): ${linked.slice(0, 5).map((row) => row.id).join(', ')}. Archive it instead.`);
    }
    await schoolDataService.deleteData('overallReportTemplates', template.id, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Overall report template deleted.' });
    return res.redirect('/school/reports/overall-templates');
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function sourceTemplates(req, res) {
  try {
    const templates = scoped(await schoolDataService.fetchAllData('reportTemplates', {}, req.user), req.user)
      .filter((row) => String(row.status || '').toLowerCase() !== 'archived')
      .map((row) => {
        const keyOptions = overallReportService.getSourceTemplateKeyOptions(row);
        return {
          id: row.id,
          title: row.title,
          type: row.type,
          version: Number(row.version || 1),
          status: row.status,
          keys: overallReportService.getSourceTemplateKeyCatalog(row),
          keyOptions
        };
      });
    return res.json({ status: 'success', results: templates });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function ensureSourceTemplateDocx(req, res) {
  try {
    const templateId = String(req.params.templateId || '').trim();
    if (!templateId) throw new Error('Report template id is required.');
    const template = await schoolDataService.getDataById('reportTemplates', templateId, req.user);
    if (!template || !idsEqual(template.orgId, activeOrgId(req.user))) {
      throw new Error('Report template not found.');
    }
    const { template: ensured, changed } = overallReportService.ensureSourceTemplateDocxAliases(template);
    const saved = changed
      ? await schoolDataService.updateData('reportTemplates', template.id, {
        schema: ensured.schema,
        audit: {
          ...(template.audit || {}),
          lastUpdateUser: req.user?.id || '',
          lastUpdateDateTime: new Date().toISOString()
        }
      }, req.user)
      : template;
    const keyOptions = overallReportService.getSourceTemplateKeyOptions(saved);
    return res.json({
      status: 'success',
      templateId: saved.id,
      keyOptions,
      keyCatalog: overallReportService.getSourceTemplateKeyCatalog(saved),
      docxAliasesEnsured: changed
    });
  } catch (error) {
    return sendError(req, res, error, 'Prepare Source Template DOCX Shortcuts');
  }
}

async function listOverallReports(req, res) {
  try {
    const query = String(req.query.q || '').trim().toLowerCase();
    const rows = scoped(await schoolDataService.fetchAllData('overallReportInstances', {}, req.user), req.user)
      .filter((row) => !query || [row.id, row.title, row.status, row.overallTemplateId]
        .some((value) => String(value || '').toLowerCase().includes(query)))
      .sort((a, b) => String(b.audit?.lastUpdateDateTime || '').localeCompare(String(a.audit?.lastUpdateDateTime || '')));
    const { data, pagination } = paginate(rows, req.query);
    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });
    return res.render('school/report/overallReportList', {
      title: 'Overall Reports',
      tableName: 'Overall_Reports',
      data,
      pagination,
      filters: req.query,
      newUrl: 'school/reports/overall-reports',
      newLabel: 'New Overall Report',
      print: true,
      includeModal: true,
      includeModal_Table: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function showCreateOverallReport(req, res) {
  try {
    const templateId = cleanParam(req.params.templateId);
    let template = null;
    let sourceSlots = [];
    let docxOptions = [];
    let pdfOptions = [];
    if (templateId) {
      template = await schoolDataService.getDataById('overallReportTemplates', templateId, req.user);
      if (!template || !idsEqual(template.orgId, activeOrgId(req.user))) {
        throw new Error('Overall report template not found.');
      }
      const reportTemplates = scoped(await schoolDataService.fetchAllData('reportTemplates', {}, req.user), req.user);
      const byId = new Map(reportTemplates.map((row) => [String(row.id), row]));
      sourceSlots = (template.sourceSlots || []).map((slot) => {
        const sourceTemplate = byId.get(String(slot.templateId)) || {};
        return {
          ...slot,
          templateTitle: String(sourceTemplate.title || sourceTemplate.name || slot.templateId),
          templateType: String(sourceTemplate.type || ''),
          templateVersion: Number(sourceTemplate.version || slot.templateVersionAtSelection || 1)
        };
      });
      docxOptions = reportFunderDocxService.buildAvailableDocxOptions(template);
      pdfOptions = reportFunderPdfService.buildAvailablePdfOptions(template);
    }
    return res.render('school/report/overallReportCreate', {
      title: 'Create Overall Report',
      template,
      sourceSlots,
      docxOptions,
      pdfOptions,
      hasOverallFields: overallReportService.templateHasOverallFields(template || {}),
      instance: null,
      readOnly: false,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

function cleanParam(value) {
  return String(value || '').trim();
}

async function getTemplateApi(req, res) {
  try {
    const template = await schoolDataService.getDataById('overallReportTemplates', req.params.id, req.user);
    if (!template || !idsEqual(template.orgId, activeOrgId(req.user))) {
      throw new Error('Overall report template not found.');
    }
    const reportTemplates = scoped(await schoolDataService.fetchAllData('reportTemplates', {}, req.user), req.user);
    const byId = new Map(reportTemplates.map((row) => [String(row.id), row]));
    const sourceSlots = (template.sourceSlots || []).map((slot) => {
      const sourceTemplate = byId.get(String(slot.templateId)) || {};
      return {
        slotKey: slot.slotKey,
        templateId: slot.templateId,
        templateTitle: String(sourceTemplate.title || sourceTemplate.name || slot.templateId),
        templateType: String(sourceTemplate.type || ''),
        templateVersion: Number(sourceTemplate.version || slot.templateVersionAtSelection || 1)
      };
    });
    return res.json({
      status: 'success',
      template: {
        id: template.id,
        title: template.title,
        status: template.status,
        version: template.version
      },
      sourceSlots,
      hasOverallFields: overallReportService.templateHasOverallFields(template),
      docxOptions: reportFunderDocxService.buildAvailableDocxOptions(template),
      pdfOptions: reportFunderPdfService.buildAvailablePdfOptions(template)
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function loadCandidatesApi(req, res) {
  try {
    const templateId = cleanParam(req.body.templateId || req.query.templateId);
    const template = await schoolDataService.getDataById('overallReportTemplates', templateId, req.user);
    if (!template || !idsEqual(template.orgId, activeOrgId(req.user))) {
      throw new Error('Overall report template not found.');
    }
    const studentIds = Array.isArray(req.body.studentIds)
      ? req.body.studentIds
      : parseJson(req.body.studentIdsJson, []);
    const statuses = Array.isArray(req.body.statuses)
      ? req.body.statuses
      : parseJson(req.body.statusesJson, ['submitted', 'locked']);
    const result = await overallReportService.loadOverallCreateCandidates({
      template,
      startDate: req.body.startDate || req.query.startDate || '',
      endDate: req.body.endDate || req.query.endDate || '',
      studentIds,
      statuses,
      reqUser: req.user
    });
    return res.json({ status: 'success', ...result });
  } catch (error) {
    return sendError(req, res, error, 'Load Overall Report Candidates');
  }
}

async function createOverallReport(req, res) {
  try {
    const templateId = cleanParam(req.body.templateId || req.params.templateId);
    const template = await schoolDataService.getDataById('overallReportTemplates', templateId, req.user);
    if (!template || !idsEqual(template.orgId, activeOrgId(req.user))) {
      throw new Error('Overall report template not found.');
    }
    const studentEntries = parseJson(req.body.studentEntriesJson, req.body.studentEntries || []);
    const filters = parseJson(req.body.filtersJson, {
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      studentIds: parseJson(req.body.studentIdsJson, []),
      statuses: parseJson(req.body.statusesJson, ['submitted', 'locked'])
    });
    if (Array.isArray(studentEntries) && studentEntries.length) {
      const instance = await overallReportService.createOverallWorkspace({
        template,
        filters,
        selectedDocxKey: req.body.selectedDocxKey,
        selectedPdfKey: req.body.selectedPdfKey,
        title: req.body.title,
        studentEntries,
        reqUser: req.user
      });
      if (isAjax(req)) {
        return res.json({
          status: 'success',
          result: instance,
          redirect: `/school/reports/overall-reports/edit/${instance.id}`
        });
      }
      return res.redirect(`/school/reports/overall-reports/edit/${instance.id}`);
    }
    const sourceSelections = (template.sourceSlots || []).map((slot) => ({
      slotKey: slot.slotKey,
      instanceId: req.body[`sourceInstance_${slot.slotKey}`]
    }));
    const instance = await overallReportService.createOverallInstance({
      template,
      sourceSelections,
      selectedDocxKey: req.body.selectedDocxKey,
      selectedPdfKey: req.body.selectedPdfKey,
      title: req.body.title,
      reqUser: req.user
    });
    if (isAjax(req)) return res.json({ status: 'success', result: instance, redirect: `/school/reports/overall-reports/edit/${instance.id}` });
    return res.redirect(`/school/reports/overall-reports/edit/${instance.id}`);
  } catch (error) {
    return sendError(req, res, error, 'Create Overall Report');
  }
}

async function showOverallReportEditor(req, res) {
  try {
    const instance = await overallReportService.getOverallInstance(req.params.id, req.user);
    const workspaceEntries = Array.isArray(instance.studentEntries) ? instance.studentEntries : [];
    if (workspaceEntries.length) {
      const workspace = overallReportService.ensureWorkspaceShape(instance);
      const template = instance.templateSnapshot || {};
      const reportTemplates = scoped(await schoolDataService.fetchAllData('reportTemplates', {}, req.user), req.user);
      const byId = new Map(reportTemplates.map((row) => [String(row.id), row]));
      const sourceSlots = (template.sourceSlots || []).map((slot) => {
        const sourceTemplate = byId.get(String(slot.templateId)) || {};
        return {
          ...slot,
          templateTitle: String(sourceTemplate.title || sourceTemplate.name || slot.templateId),
          templateType: String(sourceTemplate.type || ''),
          templateVersion: Number(sourceTemplate.version || slot.templateVersionAtSelection || 1)
        };
      });
      return res.render('school/report/overallReportCreate', {
        title: instance.title || 'Overall Report',
        template,
        sourceSlots,
        docxOptions: reportFunderDocxService.buildAvailableDocxOptions(template),
        pdfOptions: reportFunderPdfService.buildAvailablePdfOptions(template),
        hasOverallFields: overallReportService.templateHasOverallFields(template),
        instance: workspace,
        readOnly: String(instance.status || '') !== 'draft',
        includeModal: true,
        user: req.user,
        actionStateId: req.actionStateId
      });
    }
    const validation = overallReportService.validateAnswers(instance.templateSnapshot || {}, instance.answers || {});
    const exportPreview = await overallReportService.buildExportPreview(instance).catch((error) => ({
      ready: false,
      missingTokens: [],
      error: error.message
    }));
    const template = instance.templateSnapshot || {};
    const pdfExportPreview = reportFunderPdfService.templateHasAnyPdf(template)
      ? await overallReportService.buildPdfExportPreview(instance).catch((error) => ({
        ready: false,
        error: error.message
      }))
      : null;
    return res.render('school/report/overallReportEditor', {
      title: instance.title || 'Overall Report',
      instance,
      template,
      exportPreview,
      pdfExportPreview,
      validation,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function saveOverallWorkspace(req, res) {
  try {
    const instance = await overallReportService.getOverallInstance(req.params.id, req.user);
    const studentEntries = parseJson(req.body.studentEntriesJson, req.body.studentEntries || []);
    const filters = parseJson(req.body.filtersJson, null);
    const updated = await overallReportService.saveOverallWorkspace({
      instance,
      studentEntries,
      title: req.body.title,
      selectedDocxKey: req.body.selectedDocxKey,
      selectedPdfKey: req.body.selectedPdfKey,
      filters,
      reqUser: req.user
    });
    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message: 'Overall report saved.',
        result: updated,
        redirect: `/school/reports/overall-reports/edit/${updated.id}`
      });
    }
    return res.redirect(`/school/reports/overall-reports/edit/${updated.id}`);
  } catch (error) {
    return sendError(req, res, error, 'Save Overall Report');
  }
}

async function studentPreview(req, res) {
  try {
    const instance = await overallReportService.getOverallInstance(req.params.id, req.user);
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

async function generateStudentDocx(req, res) {
  try {
    const instance = await overallReportService.getOverallInstance(req.params.id, req.user);
    const result = await overallReportService.generateStudentDocx({
      instance,
      studentId: req.params.studentId,
      docxKey: req.body.selectedDocxKey || req.body.docxKey || instance.selectedDocxKey,
      reqUser: req.user
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${result.rendered.fileName}"`);
    return res.send(result.rendered.buffer);
  } catch (error) {
    return sendError(req, res, error, 'Generate Overall Report Document');
  }
}

async function exportZip(req, res) {
  try {
    const instance = await overallReportService.getOverallInstance(req.params.id, req.user);
    const result = await overallReportService.exportWorkspaceZip({
      instance,
      docxKey: req.body.selectedDocxKey || req.body.docxKey || instance.selectedDocxKey,
      reqUser: req.user
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    return res.send(result.zipBuffer);
  } catch (error) {
    return sendError(req, res, error, 'Export Overall Report Package');
  }
}

async function saveOverallReport(req, res) {
  try {
    const instance = await overallReportService.getOverallInstance(req.params.id, req.user);
    if ((instance.studentEntries || []).length && (req.body.studentEntriesJson || req.body.studentEntries)) {
      return saveOverallWorkspace(req, res);
    }
    const answers = parseJson(req.body.answersJson, req.body.answers || {});
    const result = await overallReportService.saveOverallAnswers({ instance, submittedAnswers: answers, reqUser: req.user });
    if (isAjax(req)) return res.json({ status: 'success', message: 'Overall report saved.', ...result });
    return res.redirect(`/school/reports/overall-reports/edit/${instance.id}`);
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function sourceUpdatePreview(req, res) {
  try {
    const instance = await overallReportService.getOverallInstance(req.params.id, req.user);
    const preview = await overallReportService.buildSourceUpdatePreview(instance, req.user);
    return res.json({
      status: 'success',
      message: preview.changes.length ? `${preview.changes.length} source value change(s) found.` : 'No source value changes were found.',
      ...preview
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function sourceUpdateApply(req, res) {
  try {
    const instance = await overallReportService.getOverallInstance(req.params.id, req.user);
    const selectedKeys = Array.isArray(req.body.selectedKeys) ? req.body.selectedKeys : [req.body.selectedKeys].filter(Boolean);
    const replaceOverrideFieldIds = Array.isArray(req.body.replaceOverrideFieldIds)
      ? req.body.replaceOverrideFieldIds
      : [req.body.replaceOverrideFieldIds].filter(Boolean);
    const result = await overallReportService.applySourceUpdates({
      instance,
      selectedKeys,
      replaceOverrideFieldIds,
      reqUser: req.user
    });
    return res.json({ status: 'success', message: `Applied ${result.appliedCount} selected source update(s).`, ...result });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function resetDerivedOverride(req, res) {
  try {
    const instance = await overallReportService.getOverallInstance(req.params.id, req.user);
    const result = await overallReportService.resetDerivedOverride({
      instance,
      fieldId: req.body.fieldId,
      reqUser: req.user
    });
    return res.json({
      status: 'success',
      message: 'The field was reset to its calculated value.',
      ...result
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function lifecycle(req, res) {
  try {
    const instance = await overallReportService.getOverallInstance(req.params.id, req.user);
    if (req.params.action === 'unlock' && !(await reportViewService.canUnlockReportInstance(req.user))) {
      return sendForbidden(req, res, 'Only a super user can unlock a locked overall report.');
    }
    if (['reopen', 'archive'].includes(req.params.action)
      && !(await reportViewService.canReopenReportInstanceToDraft(req.user))) {
      return sendForbidden(
        req,
        res,
        req.params.action === 'archive'
          ? 'Only an administrator can archive an overall report.'
          : 'Only an administrator can reopen a submitted overall report.'
      );
    }
    const updated = await overallReportService.transitionStatus({
      instance,
      action: req.params.action,
      reqUser: req.user
    });
    if (isAjax(req)) return res.json({ status: 'success', result: updated, message: `Overall report ${req.params.action} completed.` });
    return res.redirect(`/school/reports/overall-reports/edit/${instance.id}`);
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function deleteOverallReport(req, res) {
  try {
    const instance = await overallReportService.getOverallInstance(req.params.id, req.user);
    if ((instance.generatedDocs || []).length) {
      if (!(await reportViewService.canReopenReportInstanceToDraft(req.user))) {
        return sendForbidden(req, res, 'Only an administrator can archive an exported overall report.');
      }
      const archived = await overallReportService.transitionStatus({
        instance,
        action: 'archive',
        reqUser: req.user
      });
      if (isAjax(req)) {
        return res.json({
          status: 'success',
          message: 'The exported overall report was archived instead of deleted.',
          result: archived
        });
      }
      return res.redirect('/school/reports/overall-reports');
    }
    await schoolDataService.deleteData('overallReportInstances', instance.id, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Overall report deleted.' });
    return res.redirect('/school/reports/overall-reports');
  } catch (error) {
    return sendError(req, res, error, 'Delete Overall Report');
  }
}

async function exportPreview(req, res) {
  try {
    const instance = await overallReportService.getOverallInstance(req.params.id, req.user);
    const template = instance.templateSnapshot || {};
    const docxPreview = await overallReportService.buildExportPreview(instance);
    let pdfPreview = null;
    if (reportFunderPdfService.templateHasAnyPdf(template)) {
      pdfPreview = await overallReportService.buildPdfExportPreview(instance);
    }
    return res.json({ status: 'success', ...docxPreview, pdfPreview });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function exportPdf(req, res) {
  try {
    const instance = await overallReportService.getOverallInstance(req.params.id, req.user);
    const studentId = cleanParam(req.body.studentId || req.query.studentId);
    const pdfKey = cleanParam(req.body.selectedPdfKey || req.body.pdfKey || instance.selectedPdfKey);
    if (studentId || (instance.studentEntries || []).length > 1 || req.body.asZip === true || req.body.asZip === 'true') {
      const result = await overallReportService.exportWorkspacePdf({
        instance,
        pdfKey,
        studentId,
        reqUser: req.user
      });
      if (result.zipBuffer) {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
        return res.send(result.zipBuffer);
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${result.rendered.fileName}"`);
      return res.send(result.rendered.buffer);
    }
    const result = await overallReportService.exportOverallReportPdf(instance, req.user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${result.rendered.fileName}"`);
    return res.send(result.rendered.buffer);
  } catch (error) {
    return sendError(req, res, error, 'Export Overall Report PDF');
  }
}

async function generateStudentPdf(req, res) {
  try {
    const instance = await overallReportService.getOverallInstance(req.params.id, req.user);
    const result = await overallReportService.generateStudentPdf({
      instance,
      studentId: req.params.studentId,
      pdfKey: req.body.selectedPdfKey || req.body.pdfKey || instance.selectedPdfKey,
      reqUser: req.user
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${result.rendered.fileName}"`);
    return res.send(result.rendered.buffer);
  } catch (error) {
    return sendError(req, res, error, 'Generate Overall Report PDF');
  }
}

async function exportPdfZip(req, res) {
  try {
    const instance = await overallReportService.getOverallInstance(req.params.id, req.user);
    const result = await overallReportService.exportWorkspacePdfZip({
      instance,
      pdfKey: req.body.selectedPdfKey || req.body.pdfKey || instance.selectedPdfKey,
      reqUser: req.user
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    return res.send(result.zipBuffer);
  } catch (error) {
    return sendError(req, res, error, 'Export Overall Report PDF Package');
  }
}

async function exportDocx(req, res) {
  try {
    const instance = await overallReportService.getOverallInstance(req.params.id, req.user);
    const studentId = cleanParam(req.body.studentId || req.query.studentId);
    const docxKey = cleanParam(req.body.selectedDocxKey || req.body.docxKey || instance.selectedDocxKey);
    if (studentId || (instance.studentEntries || []).length > 1 || req.body.asZip === true || req.body.asZip === 'true') {
      const result = await overallReportService.exportWorkspaceDocx({
        instance,
        docxKey,
        studentId,
        reqUser: req.user
      });
      if (result.zipBuffer) {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
        return res.send(result.zipBuffer);
      }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${result.rendered.fileName}"`);
      return res.send(result.rendered.buffer);
    }
    const result = await overallReportService.exportOverallReport(instance, req.user);
    if (result.zipBuffer) {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
      return res.send(result.zipBuffer);
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${result.rendered.fileName}"`);
    return res.send(result.rendered.buffer);
  } catch (error) {
    return sendError(req, res, error, 'Export Overall Report');
  }
}

module.exports = {
  listTemplates,
  showTemplateForm,
  saveTemplate,
  inspectTemplatePdfFields,
  copyTemplate,
  deleteTemplate,
  sourceTemplates,
  ensureSourceTemplateDocx,
  listOverallReports,
  showCreateOverallReport,
  getTemplateApi,
  loadCandidatesApi,
  createOverallReport,
  showOverallReportEditor,
  saveOverallReport,
  saveOverallWorkspace,
  studentPreview,
  generateStudentDocx,
  generateStudentPdf,
  exportZip,
  exportPdfZip,
  sourceUpdatePreview,
  sourceUpdateApply,
  resetDerivedOverride,
  lifecycle,
  deleteOverallReport,
  exportPreview,
  exportDocx,
  exportPdf
};
