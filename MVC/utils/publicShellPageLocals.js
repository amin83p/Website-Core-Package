/**
 * Shared layout locals for login, password reset, 404, and styled error pages.
 * Keeps home gradient background + auth card styling consistent.
 */
function getPublicShellPageLocals(overrides = {}) {
  return {
    htmlClass: 'pte-public-root home-public-root login-page-html',
    bodyClass: 'pte-public-body home-public-body public-zoom-centered-body login-page-body',
    mainClass: 'container pte-public-main home-public-main login-page-main',
    pageCss: 'pages/login.css',
    includeModal: true,
    ...overrides
  };
}

module.exports = {
  getPublicShellPageLocals
};
