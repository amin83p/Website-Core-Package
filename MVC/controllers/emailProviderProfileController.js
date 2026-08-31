const emailProviderProfileService = require('../services/emailProviderProfileService');
const paginate = require('../utils/paginationHelper');
const { resolveEmailManagementOrgContext, canManageEmailManagementInActiveOrg, resolveActiveOrgEmailContext } = require('../utils/emailTemplateOrgContext');

function isAjax(req) {
  return Boolean(req?.headers?.['x-ajax-request'] || req?.xhr);
}

function cleanString(value, { max = 5000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function buildPayloadFromBody(body = {}) {
  return {
    label: cleanString(body.label, { max: 220, allowEmpty: true }),
    provider: cleanString(body.provider, { max: 40, allowEmpty: true }).toLowerCase() || 'resend',
    defaultFromEmail: cleanString(body.defaultFromEmail, { max: 320, allowEmpty: true }),
    verifiedDomains: cleanString(body.verifiedDomains, { max: 4000, allowEmpty: true }),
    apiKey: cleanString(body.apiKey, { max: 8000, allowEmpty: true }),
    isActive: normalizeBoolean(body.isActive, true),
    isDefault: normalizeBoolean(body.isDefault, false)
  };
}

async function showProviderList(req, res) {
  try {
    const [result, canCreateProfile, activeOrgContext] = await Promise.all([
      emailProviderProfileService.listProfiles(req.query || {}, req.user),
      canManageEmailManagementInActiveOrg(req.user, { scopeLabel: 'email provider profiles' }),
      resolveActiveOrgEmailContext(req.user)
    ]);
    const rows = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const pagination = result?.pagination || paginate(rows, req.query?.page, req.query?.limit).pagination;

    if (isAjax(req)) {
      return res.json({ status: 'success', data: rows, pagination });
    }

    return res.render('emailManagement/providerList', {
      title: 'Email Provider Profiles',
      data: rows,
      pagination,
      filters: req.query || {},
      newUrl: 'email-management/providers',
      newLabel: canCreateProfile ? 'Add Provider Profile' : null,
      tableName: 'Email_Provider_Profiles',
      includeModal: true,
      includeModal_Table: true,
      print: true,
      user: req.user || null,
      actionStateId: req?.actionStateId || '',
      activeOrgContext
    });
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message || 'Unable to load provider profiles.' });
    }
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Unable to load provider profiles.',
      user: req.user || null
    });
  }
}

async function showAddProviderForm(req, res) {
  try {
    await resolveEmailManagementOrgContext(req.user, { scopeLabel: 'email provider profiles' });
    return res.render('emailManagement/providerForm', {
      title: 'Create Provider Profile',
      profile: null,
      includeModal: true,
      print: true,
      user: req.user || null,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Unable to open provider form.',
      user: req.user || null
    });
  }
}

async function showEditProviderForm(req, res) {
  try {
    const profile = await emailProviderProfileService.getProfileById(req.params.id, req.user);
    if (!profile) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Email provider profile not found.',
        user: req.user || null
      });
    }
    return res.render('emailManagement/providerForm', {
      title: 'Edit Provider Profile',
      profile,
      includeModal: true,
      print: true,
      user: req.user || null,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Unable to open provider form.',
      user: req.user || null
    });
  }
}

async function pickerEmailProviders(req, res) {
  try {
    const rows = await emailProviderProfileService.listProfilesForPicker(req.query || {}, req.user);
    return res.json({ status: 'success', results: rows });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message || 'Unable to load provider profiles.' });
  }
}

async function addProvider(req, res) {
  try {
    await resolveEmailManagementOrgContext(req.user, { scopeLabel: 'email provider profiles' });
    const payload = buildPayloadFromBody(req.body || {});
    await emailProviderProfileService.createProfile(payload, req.user);
    if (isAjax(req)) {
      return res.json({ status: 'success', message: 'Provider profile saved successfully.' });
    }
    return res.redirect('/email-management/providers');
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message || 'Failed to save provider profile.' });
    }
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Failed to save provider profile.',
      user: req.user || null
    });
  }
}

async function editProvider(req, res) {
  try {
    const payload = buildPayloadFromBody(req.body || {});
    await emailProviderProfileService.updateProfile(req.params.id, payload, req.user);
    if (isAjax(req)) {
      return res.json({ status: 'success', message: 'Provider profile updated successfully.' });
    }
    return res.redirect('/email-management/providers');
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message || 'Failed to update provider profile.' });
    }
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Failed to update provider profile.',
      user: req.user || null
    });
  }
}

async function deleteProvider(req, res) {
  try {
    await emailProviderProfileService.deleteProfile(req.params.id, req.user);
    if (isAjax(req)) {
      return res.json({ status: 'success', message: 'Provider profile deleted successfully.' });
    }
    return res.redirect('/email-management/providers');
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message || 'Failed to delete provider profile.' });
    }
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Failed to delete provider profile.',
      user: req.user || null
    });
  }
}

module.exports = {
  showProviderList,
  showAddProviderForm,
  showEditProviderForm,
  pickerEmailProviders,
  addProvider,
  editProvider,
  deleteProvider
};
