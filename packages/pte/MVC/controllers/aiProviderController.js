const paginate = require('../../../../MVC/utils/paginationHelper');
const pteAiProviderDataService = require('../services/pte/pteAiProviderDataService');

function isAjax(req) {
  return Boolean(req?.headers?.['x-ajax-request']);
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function normalizeApiProviderFormBody(body = {}) {
  const source = body && typeof body === 'object' ? body : {};
  return {
    ...source,
    // Unchecked HTML checkboxes are omitted from req.body; make that explicit.
    isActive: hasOwn(source, 'isActive') ? source.isActive : 'false',
    isDefault: hasOwn(source, 'isDefault') ? source.isDefault : 'false'
  };
}

async function showApiProviderList(req, res) {
  try {
    const page = Number.parseInt(req.query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || undefined;
    const result = await pteAiProviderDataService.listProviders(
      req.query,
      req.user,
      { scopeId: req.accessScope },
      {
        paginated: true,
        pagination: { page, limit }
      }
    );
    const rows = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const fallbackPagination = paginate(rows, req.query.page, req.query.limit).pagination;
    const pagination = result?.pagination || fallbackPagination;

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        data: rows,
        pagination
      });
    }

    return res.render('pte/aiAssist/apiProviderList', {
      title: 'PTE AI API Providers',
      data: rows,
      newUrl: 'pte/ai-assisst/api-providers',
      newLabel: 'Add API Key',
      tableName: 'PTE_AI_Providers',
      includeModal: true,
      print: true,
      pagination,
      filters: req.query,
      user: req.user || null,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    if (isAjax(req)) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    return res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
}

async function showAddApiProviderForm(req, res) {
  return res.render('pte/aiAssist/apiProviderForm', {
    title: 'Create PTE API Provider',
    apiProvider: null,
    providerOptions: pteAiProviderDataService.getProviderOptions(),
    includeModal: true,
    print: true,
    user: req.user || null,
    actionStateId: req?.actionStateId || ''
  });
}

async function showEditApiProviderForm(req, res) {
  try {
    const apiProvider = await pteAiProviderDataService.getProviderById(
      req.params.id,
      req.user,
      { scopeId: req.accessScope }
    );
    if (!apiProvider) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'API provider not found.',
        user: req.user || null
      });
    }
    return res.render('pte/aiAssist/apiProviderForm', {
      title: 'Edit PTE API Provider',
      apiProvider,
      providerOptions: pteAiProviderDataService.getProviderOptions(),
      includeModal: true,
      print: true,
      user: req.user || null,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    return res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
}

async function addApiProvider(req, res) {
  try {
    await pteAiProviderDataService.createProvider(
      normalizeApiProviderFormBody(req.body || {}),
      req.user,
      { scopeId: req.accessScope }
    );

    if (isAjax(req)) {
      return res.json({ status: 'success', message: 'API provider saved successfully.' });
    }
    return res.redirect('/pte/ai-assisst/api-providers');
  } catch (error) {
    if (isAjax(req)) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    return res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
}

async function editApiProvider(req, res) {
  try {
    await pteAiProviderDataService.updateProvider(
      req.params.id,
      normalizeApiProviderFormBody(req.body || {}),
      req.user,
      { scopeId: req.accessScope }
    );

    if (isAjax(req)) {
      return res.json({ status: 'success', message: 'API provider updated successfully.' });
    }
    return res.redirect('/pte/ai-assisst/api-providers');
  } catch (error) {
    if (isAjax(req)) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    return res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
}

async function deleteApiProvider(req, res) {
  try {
    await pteAiProviderDataService.deleteProvider(
      req.params.id,
      req.user,
      { scopeId: req.accessScope }
    );
    return res.json({ status: 'success', message: 'API provider deleted.' });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
}

async function setDefaultApiProvider(req, res) {
  try {
    const providerId = String(req.body?.providerId || '').trim();
    if (!providerId) {
      return res.status(400).json({ status: 'error', message: 'Provider selection is required.' });
    }
    await pteAiProviderDataService.setDefaultProvider(
      providerId,
      req.user,
      { scopeId: req.accessScope }
    );
    return res.json({ status: 'success', message: 'Default API provider updated.' });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message || 'Unable to set default API provider.' });
  }
}

module.exports = {
  showApiProviderList,
  showAddApiProviderForm,
  showEditApiProviderForm,
  addApiProvider,
  editApiProvider,
  deleteApiProvider,
  setDefaultApiProvider
};
