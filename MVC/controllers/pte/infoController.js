const { SECTIONS } = require('../../../config/accessConstants');
const ptePublicPackageDataService = require('../../services/pte/ptePublicPackageDataService');
const ptePublicPageSettingsDataService = require('../../services/pte/ptePublicPageSettingsDataService');

async function showPteTestInfo(req, res) {
  try {
    const user = req.user || null;
    const dashboardHref = `/dashboard/section-nav/${encodeURIComponent(SECTIONS.PTE || 'PTE')}`;
    const pageModel = await ptePublicPageSettingsDataService.getPublicPageModel({
      user,
      dashboardHref
    });

    res.set('Cache-Control', 'no-store, private');
    return res.render('pte/testInfo', {
      title: 'PTE Practice App',
      includeModal: false,
      htmlClass: 'pte-public-root',
      bodyClass: 'pte-public-body public-zoom-centered-body',
      mainClass: 'container pte-public-main',
      user,
      dashboardHref,
      page: pageModel
    });
  } catch (error) {
    return res.status(500).render('error', {
      title: 'PTE Practice App',
      message: error.message || 'Unable to load the PTE public page.',
      error,
      user: req.user || null
    });
  }
}

function isAjax(req) {
  return Boolean(req?.headers?.['x-ajax-request'] || req?.xhr || String(req?.headers?.accept || '').includes('json'));
}

function buildPackageNotice(query = {}) {
  const status = String(query.status || '').trim().toLowerCase();
  const packageName = String(query.packageName || '').trim();
  const providedMessage = String(query.message || '').trim();
  if (!status) return null;

  if (status === 'selected') {
    return {
      type: 'success',
      title: 'Package added',
      message: providedMessage || `${packageName || 'The selected package'} was added to your profile.`
    };
  }

  if (status === 'already') {
    return {
      type: 'info',
      title: 'Already in your profile',
      message: providedMessage || `${packageName || 'This package'} is already connected to your profile.`
    };
  }

  if (status === 'join-required') {
    return {
      type: 'warning',
      title: 'Join Public PTE first',
      message: providedMessage || 'Please activate Public PTE access, then return to choose a package.'
    };
  }

  if (status === 'error') {
    return {
      type: 'danger',
      title: 'Package was not added',
      message: providedMessage || 'We could not add that package. Please try again.'
    };
  }

  return null;
}

async function showPublicPackages(req, res) {
  try {
    const packagePage = await ptePublicPackageDataService.listPublicPackages(req.user || null);
    return res.render('pte/publicPackages', {
      title: 'PTE Public Packages',
      includeModal: false,
      bodyClass: 'public-zoom-centered-body',
      user: req.user || null,
      page: packagePage,
      notice: buildPackageNotice(req.query || {})
    });
  } catch (error) {
    return res.status(500).render('error', {
      title: 'PTE Public Packages',
      message: error.message,
      user: req.user || null
    });
  }
}

async function selectPublicPackage(req, res) {
  try {
    const result = await ptePublicPackageDataService.selectPublicPackage(req.params.packageId, req.user || null);
    const status = result.alreadyAssigned ? 'already' : 'selected';
    const packageName = encodeURIComponent(result.package?.name || 'PTE public package');

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        alreadyAssigned: result.alreadyAssigned === true,
        message: result.alreadyAssigned
          ? 'This package is already connected to your profile.'
          : 'Package added to your profile.',
        package: result.package
      });
    }

    return res.redirect(`/pte/packages?status=${status}&packageName=${packageName}`);
  } catch (error) {
    const code = String(error?.code || '').trim();
    const status = code === 'PTE_PUBLIC_ACCESS_REQUIRED' ? 'join-required' : 'error';
    const message = encodeURIComponent(error.message || 'Unable to add this package.');

    if (isAjax(req)) {
      return res.status(code === 'AUTH_REQUIRED' ? 401 : 400).json({
        status: 'error',
        message: error.message,
        code
      });
    }

    return res.redirect(`/pte/packages?status=${status}&message=${message}`);
  }
}

module.exports = {
  showPteTestInfo,
  showPublicPackages,
  selectPublicPackage
};
