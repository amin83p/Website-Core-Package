const ptePublicPageSettingsDataService = require('../../services/pte/ptePublicPageSettingsDataService');

function isAjax(req) {
  return Boolean(req?.headers?.['x-ajax-request'] || req?.xhr || String(req?.headers?.accept || '').includes('json'));
}

async function showSettingsPage(req, res) {
  try {
    const data = await ptePublicPageSettingsDataService.getSettingsForManagement(req.user || null);
    return res.render('pte/publicPage/settings', {
      title: 'PTE Public Page',
      includeModal: true,
      user: req.user || null,
      data,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    return res.status(500).render('error', {
      title: 'PTE Public Page',
      message: error.message || 'Unable to load PTE public page settings.',
      error,
      user: req.user || null
    });
  }
}

async function saveSettingsPage(req, res) {
  try {
    const saved = await ptePublicPageSettingsDataService.saveSettings(req.body || {}, req.user || null);
    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message: 'PTE public page settings saved.',
        data: saved
      });
    }
    return res.redirect('/pte/public-page?status=saved');
  } catch (error) {
    const statusCode = /invalid|required|configured|submitted/i.test(String(error?.message || '')) ? 400 : 500;
    if (isAjax(req)) {
      return res.status(statusCode).json({
        status: 'error',
        message: error.message || 'Unable to save PTE public page settings.'
      });
    }
    return res.status(statusCode).render('error', {
      title: 'PTE Public Page',
      message: error.message || 'Unable to save PTE public page settings.',
      error,
      user: req.user || null
    });
  }
}

function issueMutationToken(req, res) {
  return res.json({
    status: 'success',
    results: {
      actionStateId: req.actionStateId || ''
    }
  });
}

module.exports = {
  showSettingsPage,
  saveSettingsPage,
  issueMutationToken
};
