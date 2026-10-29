const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  resolveBrowserTabIconUrl,
  faviconMimeTypeFromUrl,
  DEFAULT_BRAND
} = require('../MVC/services/appBrandingService');

test('resolveBrowserTabIconUrl prefers faviconUrl then iconSvgUrl then logoUrl', () => {
  assert.equal(
    resolveBrowserTabIconUrl({
      faviconUrl: '/uploads/custom/favicon.png',
      iconSvgUrl: '/uploads/a.svg',
      logoUrl: '/uploads/logo.png'
    }),
    '/uploads/custom/favicon.png'
  );
  assert.equal(
    resolveBrowserTabIconUrl({
      faviconUrl: '',
      iconSvgUrl: '/uploads/a.svg',
      logoUrl: '/uploads/logo.png'
    }),
    '/uploads/a.svg'
  );
  assert.equal(
    resolveBrowserTabIconUrl({
      faviconUrl: '',
      iconSvgUrl: '',
      logoUrl: '/uploads/logo.png'
    }),
    '/uploads/logo.png'
  );
  assert.equal(resolveBrowserTabIconUrl({}), DEFAULT_BRAND.iconSvgUrl);
});

test('faviconMimeTypeFromUrl maps common extensions', () => {
  assert.equal(faviconMimeTypeFromUrl('/uploads/icon.svg'), 'image/svg+xml');
  assert.equal(faviconMimeTypeFromUrl('/uploads/icon.ico'), 'image/x-icon');
  assert.equal(faviconMimeTypeFromUrl('/uploads/icon.png'), 'image/png');
  assert.equal(faviconMimeTypeFromUrl('/uploads/icon.PNG?v=2'), 'image/png');
});

test('application defaults form includes browser tab icon field', () => {
  const view = fs.readFileSync(
    path.join(__dirname, '../MVC/views/systemSettings/appSettings.ejs'),
    'utf8'
  );
  assert.match(view, /name="faviconUrl"/);
  assert.match(view, /Browser tab icon \(favicon\)/);
});

test('layout uses resolved browser tab icon links', () => {
  const layout = fs.readFileSync(
    path.join(__dirname, '../MVC/views/layouts/layout.ejs'),
    'utf8'
  );
  assert.match(layout, /layoutBrowserTabIconUrl/);
  assert.match(layout, /layoutBrowserTabIconType/);
  assert.doesNotMatch(layout, /layoutIconSvgUrl/);
  assert.doesNotMatch(layout, /rel="icon" type="image\/png" href="<%= layoutLogoUrl %>"/);
});
