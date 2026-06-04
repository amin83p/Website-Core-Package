const { requireCoreModule } = require('../../services/ielts/ieltsCoreModuleResolver');
const ieltsService = require('../../services/ielts/ieltsDataService');
const paginate = requireCoreModule('MVC/utils/paginationHelper');

const PROVIDER_OPTIONS = Object.freeze([
  { id: 'google-gemini', label: 'Google Gemini' },
  { id: 'google-vertex', label: 'Google Vertex AI' },
  { id: 'openai', label: 'OpenAI (ChatGPT/API)' },
  { id: 'anthropic', label: 'Anthropic Claude' },
  { id: 'azure-openai', label: 'Azure OpenAI' },
  { id: 'custom', label: 'Custom Provider' }
]);

function asBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function buildApiProviderPayload(body = {}, { isEdit = false } = {}) {
  const payload = {
    id: String(body.id || '').trim(),
    name: String(body.name || '').trim(),
    providerId: String(body.providerId || '').trim().toLowerCase(),
    modelId: String(body.modelId || '').trim(),
    project: String(body.project || '').trim(),
    location: String(body.location || '').trim(),
    notes: String(body.notes || '').trim(),
    isActive: asBool(body.isActive, true),
    isDefault: asBool(body.isDefault, false)
  };

  const apiKey = String(body.apiKey || '').trim();
  if (apiKey) payload.apiKey = apiKey;
  if (!isEdit && !apiKey) {
    throw new Error('API key is required.');
  }
  return payload;
}

exports.showApiProviderSettings = async (req, res) => {
  try {
    const records = await ieltsService.fetchData('apiProviders', req.query, req.user);
    const { data, pagination } = paginate(records, req.query.page, req.query.limit);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', data, pagination });
    }

    return res.render('ielts/apiProviderList', {
      title: 'API Providers',
      data,
      newUrl: 'ielts/api-providers',
      newLabel: 'Add API Key',
      tableName: 'User API Providers',
      includeModal: true,
      print: true,
      pagination,
      filters: req.query,
      user: req.user || null,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    return res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
};

exports.setDefaultApiProvider = async (req, res) => {
  try {
    const providerId = String(req.body?.providerId || '').trim();
    if (!providerId) {
      return res.status(400).json({ status: 'error', message: 'Provider selection is required.' });
    }

    const existing = await ieltsService.getDataById('apiProviders', providerId, req.user);
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Selected API provider was not found.' });
    }
    if (existing.isActive === false) {
      return res.status(400).json({ status: 'error', message: 'Inactive API providers cannot be set as default.' });
    }

    await ieltsService.updateData('apiProviders', providerId, { isDefault: true }, req.user);
    return res.json({ status: 'success', message: 'Default API provider updated.' });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message || 'Unable to set default API provider.' });
  }
};

exports.showAddApiProviderForm = (req, res) => {
  res.render('ielts/apiProviderForm', {
    title: 'Create API Provider',
    apiProvider: null,
    providerOptions: PROVIDER_OPTIONS,
    includeModal: true,
    print: true,
    user: req.user || null,
    actionStateId: req?.actionStateId || ''
  });
};

exports.showEditApiProviderForm = async (req, res) => {
  try {
    const apiProvider = await ieltsService.getDataById('apiProviders', req.params.id, req.user);
    if (!apiProvider) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'API provider not found.',
        user: req.user || null
      });
    }

    return res.render('ielts/apiProviderForm', {
      title: 'Edit API Provider',
      apiProvider,
      providerOptions: PROVIDER_OPTIONS,
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
};

exports.addApiProvider = async (req, res) => {
  try {
    const payload = buildApiProviderPayload(req.body, { isEdit: false });
    await ieltsService.addData('apiProviders', payload, req.user);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'API provider saved successfully.' });
    }

    return res.redirect('/ielts/api-providers');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    return res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
};

exports.editApiProvider = async (req, res) => {
  try {
    const payload = buildApiProviderPayload(req.body, { isEdit: true });
    await ieltsService.updateData('apiProviders', req.params.id, payload, req.user);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'API provider updated successfully.' });
    }

    return res.redirect('/ielts/api-providers');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    return res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
};

exports.deleteApiProvider = async (req, res) => {
  try {
    await ieltsService.deleteData('apiProviders', req.params.id, req.user);
    return res.json({ status: 'success', message: 'API provider deleted.' });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
