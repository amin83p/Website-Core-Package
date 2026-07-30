'use strict';

const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const uploadMiddleware = requireCoreModule('MVC/middleware/upload');
const { isAjax } = requireCoreModule('MVC/utils/generalTools');
const schoolDataService = require('../../services/school/schoolDataService');
const reportViewService = require('../../services/school/reportViewService');
const reportFunderDocxService = require('../../services/school/reportFunderDocxService');
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
    const rows = scoped(await schoolDataService.fetchData('overallReportTemplates', {}, req.user), req.user)
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
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function loadTemplateFormData(req, template = null) {
  const orgId = activeOrgId(req.user);
  const sourceTemplates = scoped(await schoolDataService.fetchData('reportTemplates', {}, req.user), req.user)
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
      nextSlotNumber: 3,
      sourceSlots: [
        { slotKey: 'T1', order: 1, templateId: '', templateVersionAtSelection: 1 },
        { slotKey: 'T2', order: 2, templateId: '', templateVersionAtSelection: 1 }
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
    const docxTemplatesByFunder = reportViewService.buildDocxTemplatesByFunderFromUpload({
      body: req.body,
      existingTemplate: existing,
      uploadedFiles
    });
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
    const templates = scoped(await schoolDataService.fetchData('reportTemplates', {}, req.user), req.user)
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

async function listOverallReports(req, res) {
  try {
    const query = String(req.query.q || '').trim().toLowerCase();
    const rows = scoped(await schoolDataService.fetchData('overallReportInstances', {}, req.user), req.user)
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
      newUrl: null,
      newLabel: null,
      print: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function showCreateOverallReport(req, res) {
  try {
    const template = await schoolDataService.getDataById('overallReportTemplates', req.params.templateId, req.user);
    if (!template || !idsEqual(template.orgId, activeOrgId(req.user))) throw new Error('Overall report template not found.');
    const [allInstances, reportTemplates] = await Promise.all([
      schoolDataService.fetchData('reportInstances', {}, req.user),
      schoolDataService.fetchData('reportTemplates', {}, req.user)
    ]);
    const completedInstances = scoped(allInstances, req.user)
      .filter((row) => ['submitted', 'locked'].includes(String(row.status || '').toLowerCase()));
    const sourceTemplateMap = new Map(
      scoped(reportTemplates, req.user).map((row) => [String(row.id), row])
    );
    const instancesBySlot = {};
    (template.sourceSlots || []).forEach((slot) => {
      instancesBySlot[slot.slotKey] = completedInstances.filter((row) => idsEqual(row.templateId, slot.templateId));
    });
    const sourceSlotOptions = (template.sourceSlots || []).map((slot) => {
      const sourceTemplate = sourceTemplateMap.get(String(slot.templateId)) || {};
      return {
        ...slot,
        templateTitle: String(sourceTemplate.title || sourceTemplate.name || slot.templateId),
        templateType: String(sourceTemplate.type || ''),
        templateVersion: Number(sourceTemplate.version || slot.templateVersionAtSelection || 1),
        instances: (instancesBySlot[slot.slotKey] || []).map((row) => ({
          id: row.id,
          title: row.title || row.name || row.id,
          status: row.status,
          templateId: row.templateId,
          studentId: row.studentId || row.personId || '',
          studentName: row.prefillSnapshot?.student_full_name || row.prefillSnapshot?.student_name || '',
          className: row.prefillSnapshot?.class_name || '',
          teacherName: row.prefillSnapshot?.teacher_name || '',
          reportDate: row.prefillSnapshot?.report_date || row.audit?.lastUpdateDateTime || row.audit?.createDateTime || ''
        }))
      };
    });
    return res.render('school/report/overallReportCreate', {
      title: 'Create Overall Report',
      template,
      instancesBySlot,
      sourceSlotOptions,
      docxOptions: reportFunderDocxService.buildAvailableDocxOptions(template),
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function createOverallReport(req, res) {
  try {
    const template = await schoolDataService.getDataById('overallReportTemplates', req.params.templateId, req.user);
    if (!template || !idsEqual(template.orgId, activeOrgId(req.user))) throw new Error('Overall report template not found.');
    const sourceSelections = (template.sourceSlots || []).map((slot) => ({
      slotKey: slot.slotKey,
      instanceId: req.body[`sourceInstance_${slot.slotKey}`]
    }));
    const instance = await overallReportService.createOverallInstance({
      template,
      sourceSelections,
      selectedDocxKey: req.body.selectedDocxKey,
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
    const validation = overallReportService.validateAnswers(instance.templateSnapshot || {}, instance.answers || {});
    const exportPreview = await overallReportService.buildExportPreview(instance).catch((error) => ({
      ready: false,
      missingTokens: [],
      error: error.message
    }));
    return res.render('school/report/overallReportEditor', {
      title: instance.title || 'Overall Report',
      instance,
      template: instance.templateSnapshot || {},
      exportPreview,
      validation,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function saveOverallReport(req, res) {
  try {
    const instance = await overallReportService.getOverallInstance(req.params.id, req.user);
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
    return res.json({ status: 'success', ...(await overallReportService.buildExportPreview(instance)) });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function exportDocx(req, res) {
  try {
    const instance = await overallReportService.getOverallInstance(req.params.id, req.user);
    const result = await overallReportService.exportOverallReport(instance, req.user);
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
  deleteTemplate,
  sourceTemplates,
  listOverallReports,
  showCreateOverallReport,
  createOverallReport,
  showOverallReportEditor,
  saveOverallReport,
  sourceUpdatePreview,
  sourceUpdateApply,
  resetDerivedOverride,
  lifecycle,
  deleteOverallReport,
  exportPreview,
  exportDocx
};
