'use strict';

const schoolAiProviderDataService = require('../../services/school/schoolAiProviderDataService');
const schoolAiServiceAssignmentDataService = require('../../services/school/schoolAiServiceAssignmentDataService');
const schoolAiServiceDefinitionDataService = require('../../services/school/schoolAiServiceDefinitionDataService');
const schoolAiServiceExecutionService = require('../../services/school/schoolAiServiceExecutionService');
const { getAiServiceByKey } = require('../../config/schoolAiServiceRegistry');
const schoolAiTokenUsageDataService = require('../../services/school/schoolAiTokenUsageDataService');
const schoolAiUserUsageLimitDataService = require('../../services/school/schoolAiUserUsageLimitDataService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { isAjax } = requireCoreModule('MVC/utils/generalTools');
const { USAGE_PERIOD_TYPES } = require('../../services/school/schoolAiModelUtils');
const { listAiServices } = require('../../config/schoolAiServiceRegistry');
const schoolIdentityLookupService = require('../../services/school/schoolIdentityLookupService');

const AI_ASSIST_NAV = '/dashboard/section-nav/SCHOOL_AI_ASSIST';

function aiAssistDashboardBtn() {
  return `<a href="${AI_ASSIST_NAV}" class="btn btn-filled btn-secondary btn-md mb-2"><i class="bi bi-robot me-1"></i> School AI Assist</a>`;
}

function aiAssistSectionNavBtns({ omit = [] } = {}) {
  const skip = new Set((Array.isArray(omit) ? omit : [omit]).filter(Boolean));
  const links = [
    { key: 'providers', href: '/school/ai-assist/providers', label: 'AI Providers', icon: 'bi-key-fill' },
    { key: 'assignments', href: '/school/ai-assist/service-assignments', label: 'Service Assignments', icon: 'bi-sliders' },
    { key: 'definitions', href: '/school/ai-assist/service-definitions', label: 'Service Definitions', icon: 'bi-braces' },
    { key: 'limits', href: '/school/ai-assist/token-usage/limits', label: 'Usage Limits', icon: 'bi-shield-check' },
    { key: 'tokens', href: '/school/ai-assist/token-usage', label: 'Consumed Tokens', icon: 'bi-cpu-fill' }
  ];
  return links
    .filter((row) => !skip.has(row.key))
    .map((row) => `<a href="${row.href}" class="btn btn-outline-primary btn-md mb-2"><i class="bi ${row.icon} me-1"></i> ${row.label}</a>`);
}

function navButtons() {
  return [aiAssistDashboardBtn(), ...aiAssistSectionNavBtns()];
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function normalizeCheckboxBody(body = {}) {
  return {
    ...body,
    isActive: hasOwn(body, 'isActive') ? body.isActive : 'false',
    isDefault: hasOwn(body, 'isDefault') ? body.isDefault : 'false'
  };
}

exports.listProviders = async (req, res) => {
  try {
    const accessContext = { scopeId: req.accessScope };
    const result = await schoolAiProviderDataService.listProviders(req.user, req.query, accessContext);
    if (isAjax(req)) {
      return res.json({ status: 'success', results: result.rows, pagination: result.pagination });
    }
    const searchableFields = ['id', 'name', 'providerId', 'notes', 'project', 'location'];
    return res.render('school/aiAssist/providerList', {
      title: 'School AI Providers',
      data: result.rows,
      pagination: result.pagination,
      newUrl: 'school/ai-assist/providers',
      newLabel: 'Add Provider Key',
      tableName: 'School_AI_Providers',
      searchableFields,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: true,
      filters: req.query,
      user: req.user,
      actionStateId: req?.actionStateId || '',
      headerManageBtns: [aiAssistDashboardBtn()],
      manageBtns: aiAssistSectionNavBtns({ omit: ['providers'] })
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showCreateProvider = async (req, res) => {
    return res.render('school/aiAssist/providerForm', {
      title: 'Create School AI Provider',
      provider: null,
      providerOptions: schoolAiProviderDataService.getProviderOptions(),
      includeModal: true,
      user: req.user,
      actionStateId: req?.actionStateId || ''
    });
};

exports.showEditProvider = async (req, res) => {
  try {
    const provider = await schoolAiProviderDataService.getProviderById(req.params.id, req.user, { scopeId: req.accessScope });
    if (!provider) return res.status(404).render('error', { title: 'Not Found', message: 'Provider not found.', user: req.user });
    const raw = await schoolAiProviderDataService.getRawProviderById(
      provider.id,
      req.user,
      { scopeId: req.accessScope }
    );
    return res.render('school/aiAssist/providerForm', {
      title: 'Edit School AI Provider',
      provider: { ...provider, models: raw?.models || [], bannedUserIds: raw?.bannedUserIds || [] },
      providerOptions: schoolAiProviderDataService.getProviderOptions(),
      includeModal: true,
      user: req.user,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.createProvider = async (req, res) => {
  try {
    await schoolAiProviderDataService.createProvider(normalizeCheckboxBody(req.body), req.user, { scopeId: req.accessScope });
    if (isAjax(req)) return res.json({ status: 'success', redirectTo: '/school/ai-assist/providers' });
    return res.redirect('/school/ai-assist/providers');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.updateProvider = async (req, res) => {
  try {
    await schoolAiProviderDataService.updateProvider(req.params.id, normalizeCheckboxBody(req.body), req.user, { scopeId: req.accessScope });
    if (isAjax(req)) return res.json({ status: 'success', redirectTo: '/school/ai-assist/providers' });
    return res.redirect('/school/ai-assist/providers');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.deleteProvider = async (req, res) => {
  try {
    await schoolAiProviderDataService.deleteProvider(req.params.id, req.user, { scopeId: req.accessScope });
    return res.json({ status: 'success' });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.setDefaultProvider = async (req, res) => {
  try {
    const id = String(req.body?.id || req.query?.id || '').trim();
    await schoolAiProviderDataService.setDefaultProvider(id, req.user, { scopeId: req.accessScope });
    return res.json({ status: 'success' });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.showServiceAssignments = async (req, res) => {
  try {
    const matrix = await schoolAiServiceAssignmentDataService.listMatrix(req.user, { scopeId: req.accessScope });
    return res.render('school/aiAssist/serviceAssignmentList', {
      title: 'School AI Service Assignments',
      matrix,
      includeModal: true,
      user: req.user,
      actionStateId: req?.actionStateId || '',
      headerManageBtns: [aiAssistDashboardBtn()],
      manageBtns: aiAssistSectionNavBtns({ omit: ['assignments'] })
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.saveServiceAssignment = async (req, res) => {
  try {
    const serviceKey = req.params.serviceKey;
    await schoolAiServiceAssignmentDataService.upsertForService(serviceKey, req.body, req.user, { scopeId: req.accessScope });
    if (isAjax(req)) return res.json({ status: 'success' });
    return res.redirect('/school/ai-assist/service-assignments');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.listTokenUsage = async (req, res) => {
  try {
    const result = await schoolAiTokenUsageDataService.listUsage(req.user, req.query, { scopeId: req.accessScope });
    if (isAjax(req)) {
      return res.json({ status: 'success', results: result.rows, pagination: result.pagination });
    }
    const searchableFields = ['userId', 'serviceKey', 'providerId', 'modelId', 'status', 'traceId'];
    const serviceOptions = listAiServices();
    const selectedServiceKey = String(req.query.serviceKey__eq || '').trim();
    return res.render('school/aiAssist/tokenUsageList', {
      title: 'School AI Consumed Tokens',
      data: result.rows,
      pagination: result.pagination,
      serviceOptions,
      selectedServiceKey,
      newUrl: 'school/ai-assist/token-usage',
      tableName: 'School_AI_Token_Usage',
      searchableFields,
      includeModal: true,
      includeModal_Table: true,
      print: true,
      filters: req.query,
      user: req.user,
      actionStateId: req?.actionStateId || '',
      headerManageBtns: [aiAssistDashboardBtn()],
      manageBtns: aiAssistSectionNavBtns({ omit: ['tokens', 'providers'] })
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showTokenUsageDetail = async (req, res) => {
  try {
    const row = await schoolAiTokenUsageDataService.getUsageById(req.params.id, req.user, { scopeId: req.accessScope });
    if (!row) return res.status(404).render('error', { title: 'Not Found', message: 'Usage row not found.', user: req.user });
    return res.render('school/aiAssist/tokenUsageDetail', {
      title: 'AI Token Usage Detail',
      usage: row,
      includeModal: true,
      user: req.user,
      navButtons: navButtons()
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.listUsageLimits = async (req, res) => {
  try {
    const accessContext = { scopeId: req.accessScope };
    const result = await schoolAiUserUsageLimitDataService.listLimits(req.user, req.query, accessContext);
    if (isAjax(req)) {
      return res.json({ status: 'success', results: result.rows, pagination: result.pagination });
    }
    const searchableFields = ['id', 'userId', 'periodType', 'appliesTo', 'notes'];
    return res.render('school/aiAssist/usageLimitList', {
      title: 'School AI Usage Limits',
      data: result.rows,
      pagination: result.pagination,
      serviceOptions: listAiServices(),
      periodTypes: USAGE_PERIOD_TYPES,
      newUrl: 'school/ai-assist/token-usage/limits',
      newLabel: 'New Usage Limit',
      tableName: 'School_AI_Usage_Limits',
      searchableFields,
      includeModal: true,
      includeModal_Table: true,
      print: true,
      filters: req.query,
      user: req.user,
      actionStateId: req?.actionStateId || '',
      headerManageBtns: [aiAssistDashboardBtn()],
      manageBtns: aiAssistSectionNavBtns({ omit: ['limits', 'providers'] })
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showCreateUsageLimit = async (req, res) => {
  return res.render('school/aiAssist/usageLimitForm', {
    title: 'Create Usage Limit',
    limit: null,
    periodTypes: USAGE_PERIOD_TYPES,
    serviceOptions: listAiServices(),
    includeModal: true,
    user: req.user,
    actionStateId: req?.actionStateId || ''
  });
};

exports.createUsageLimit = async (req, res) => {
  try {
    const body = normalizeCheckboxBody(req.body);
    await schoolAiUserUsageLimitDataService.createLimit(body, req.user, { scopeId: req.accessScope });
    if (isAjax(req)) return res.json({ status: 'success', redirectTo: '/school/ai-assist/token-usage/limits' });
    return res.redirect('/school/ai-assist/token-usage/limits');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showEditUsageLimit = async (req, res) => {
  try {
    const limit = await schoolAiUserUsageLimitDataService.getLimitById(req.params.id, req.user, { scopeId: req.accessScope });
    if (!limit) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Usage limit not found.', user: req.user });
    }
    const nameMap = await schoolIdentityLookupService.mapUserDisplayNames(req.user, [limit.userId]);
    const userId = String(limit.userId || '').trim();
    const userDisplayName = nameMap.get(userId) || userId;
    return res.render('school/aiAssist/usageLimitForm', {
      title: 'Edit Usage Limit',
      limit: { ...limit, userDisplayName },
      periodTypes: USAGE_PERIOD_TYPES,
      serviceOptions: listAiServices(),
      includeModal: true,
      user: req.user,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.updateUsageLimit = async (req, res) => {
  try {
    const body = normalizeCheckboxBody(req.body);
    await schoolAiUserUsageLimitDataService.updateLimit(req.params.id, body, req.user, { scopeId: req.accessScope });
    if (isAjax(req)) return res.json({ status: 'success', redirectTo: '/school/ai-assist/token-usage/limits' });
    return res.redirect('/school/ai-assist/token-usage/limits');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.deleteUsageLimit = async (req, res) => {
  try {
    await schoolAiUserUsageLimitDataService.deleteLimit(req.params.id, req.user, { scopeId: req.accessScope });
    return res.json({ status: 'success' });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

function buildRunnerInputDefaults(definition, source = {}) {
  const inputs = Array.isArray(definition?.inputs) ? definition.inputs : [];
  const data = source && typeof source === 'object' ? source : {};
  const defaults = {};
  inputs.forEach((field) => {
    const id = String(field?.id || '').trim();
    if (!id) return;
    if (data[id] !== undefined && data[id] !== null && String(data[id]).trim() !== '') {
      defaults[id] = data[id];
      return;
    }
    if ((id === 'report_text' || id === 'report_body') && !defaults[id]) {
      const lines = Object.entries(data)
        .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
        .map(([key, value]) => `${key}: ${String(value).trim()}`);
      if (lines.length) defaults[id] = lines.join('\n\n');
    }
  });
  return defaults;
}

exports.prepareServiceRunnerContext = async (serviceKey, req, { inputSource = {} } = {}) => {
  const key = String(serviceKey || '').trim();
  if (!key || !getAiServiceByKey(key)) return null;
  const accessContext = { scopeId: req.accessScope };
  const definition = await schoolAiServiceDefinitionDataService.getByServiceKey(key, req.user, accessContext);
  const registry = getAiServiceByKey(key);
  const configured = Boolean(definition?.prompt?.userPromptTemplate?.trim());
  const active = definition?.isActive !== false;
  return {
    serviceKey: key,
    label: registry?.label || key,
    description: registry?.description || '',
    definition,
    configured,
    active,
    inputDefaults: buildRunnerInputDefaults(definition, inputSource),
    runUrl: `/school/ai-assist/services/${encodeURIComponent(key)}/run`
  };
};

exports.listServiceDefinitions = async (req, res) => {
  try {
    const payload = await schoolAiServiceDefinitionDataService.listForOrg(req.user, { scopeId: req.accessScope });
    return res.render('school/aiAssist/serviceDefinitionList', {
      title: 'School AI Service Definitions',
      services: payload.services,
      orgId: payload.orgId,
      includeModal: true,
      user: req.user,
      actionStateId: req?.actionStateId || '',
      headerManageBtns: [aiAssistDashboardBtn()],
      manageBtns: aiAssistSectionNavBtns({ omit: ['definitions'] })
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showEditServiceDefinition = async (req, res) => {
  try {
    const serviceKey = req.params.serviceKey;
    const registry = getAiServiceByKey(serviceKey);
    if (!registry) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Unknown AI service.', user: req.user });
    }
    const definition = await schoolAiServiceDefinitionDataService.getByServiceKey(
      serviceKey,
      req.user,
      { scopeId: req.accessScope }
    );
    return res.render('school/aiAssist/serviceDefinitionForm', {
      title: `Configure: ${registry.label}`,
      registry,
      definition,
      inputTypes: ['text', 'textarea', 'number', 'boolean', 'select', 'json'],
      includeModal: true,
      user: req.user,
      actionStateId: req?.actionStateId || '',
      headerManageBtns: [aiAssistDashboardBtn()],
      manageBtns: aiAssistSectionNavBtns({ omit: ['definitions'] })
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.saveServiceDefinition = async (req, res) => {
  try {
    const serviceKey = req.params.serviceKey;
    await schoolAiServiceDefinitionDataService.upsertDefinition(
      serviceKey,
      req.body,
      req.user,
      { scopeId: req.accessScope }
    );
    if (isAjax(req)) return res.json({ status: 'success' });
    return res.redirect('/school/ai-assist/service-definitions');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.listProviderVendorModels = async (req, res) => {
  try {
    const providerRecordId = String(req.params.id || '').trim();
    const isDraft = providerRecordId === 'draft';
    const source = { ...req.query, ...req.body };
    const result = await schoolAiProviderDataService.listVendorModels(
      req.user,
      {
        providerRecordId: isDraft ? '' : providerRecordId,
        providerId: source.providerId,
        apiKey: source.apiKey,
        project: source.project,
        location: source.location,
        baseUrl: source.baseUrl
      },
      { scopeId: req.accessScope }
    );
    return res.json({ status: 'success', ...result });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.runSchoolAiService = async (req, res) => {
  try {
    const serviceKey = req.params.serviceKey;
    let inputs = {};
    if (req.body?.inputs && typeof req.body.inputs === 'object' && !Array.isArray(req.body.inputs)) {
      inputs = req.body.inputs;
    } else if (req.body && typeof req.body === 'object') {
      const body = { ...req.body };
      delete body.actionStateId;
      delete body.inputs;
      inputs = body;
    }
    const result = await schoolAiServiceExecutionService.run({
      serviceKey,
      inputs,
      requestingUser: req.user,
      accessContext: { scopeId: req.accessScope }
    });
    return res.json({ status: 'success', result });
  } catch (error) {
    return res.status(400).json({
      status: 'error',
      message: error.message,
      validationErrors: error.validationErrors || undefined
    });
  }
};