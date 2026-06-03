const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const test = require('node:test');
const assert = require('node:assert/strict');

function renderHeader(locals = {}) {
  const viewPath = path.join(process.cwd(), 'MVC', 'views', 'partials', 'header.ejs');
  const template = fs.readFileSync(viewPath, 'utf8');
  const render = ejs.compile(template, { filename: viewPath });
  return render({
    user: {
      id: 'USER_1',
      name: 'Amin User',
      canSwitchProfile: false
    },
    appBrand: {},
    siteWarnings: [],
    publicMenu: [],
    chatAccess: { canRead: false, canReadAll: false },
    buildVersionShort: '',
    ...locals
  });
}

test('header shows build version row before Sign Out when buildVersionShort is provided', () => {
  const html = renderHeader({ buildVersionShort: 'abc123' });
  const buildIndex = html.indexOf('Build: <code>abc123</code>');
  const signoutIndex = html.indexOf('Sign Out');

  assert.ok(buildIndex >= 0, 'expected Build row to be rendered');
  assert.ok(signoutIndex >= 0, 'expected Sign Out row to be rendered');
  assert.ok(buildIndex < signoutIndex, 'expected Build row to appear before Sign Out');
});

test('header hides build version row when buildVersionShort is empty', () => {
  const html = renderHeader({ buildVersionShort: '' });
  assert.equal(html.includes('Build: <code>'), false);
});

test('header renders authenticated Main Menu after public menu divider', () => {
  const html = renderHeader({
    publicMenu: [
      { label: 'Home', href: '/', icon: 'bi-house', target: '_self', children: [] }
    ]
  });

  assert.match(html, /data-header-app-menu-root="nav"/);
  assert.match(html, /data-header-app-menu-root="inline"/);
  assert.match(html, /data-header-app-menu-list="nav"/);
  assert.match(html, /data-header-app-menu-list="inline"/);
  assert.match(html, /header-auto-menu-separator/);
  assert.ok(html.indexOf('Home') < html.indexOf('Main Menu'));
});

test('header does not render automatic Main Menu for guests', () => {
  const html = renderHeader({
    user: null,
    publicMenu: [
      { label: 'Home', href: '/', icon: 'bi-house', target: '_self', children: [] }
    ]
  });

  assert.equal(html.includes('data-header-app-menu-root='), false);
  assert.equal(html.includes('data-header-app-menu-list='), false);
});

test('header Main Menu client loader reuses Start Menu endpoint', () => {
  const scriptPath = path.join(process.cwd(), 'public', 'scripts', 'main.js');
  const source = fs.readFileSync(scriptPath, 'utf8');

  assert.match(source, /function initHeaderApplicationMenu/);
  assert.match(source, /fetch\('\/sections\/start-menu'/);
  assert.match(source, /data-header-app-menu-list/);
  assert.match(source, /rootNodes = Array\.isArray\(data\.sections\) \? data\.sections : \[\]/);
  assert.doesNotMatch(source, /initHeaderApplicationMenu[\s\S]*OTHER_SECTIONS[\s\S]*function initGlobalActions/);
  assert.match(source, /function renderRawSvgIcon/);
  assert.match(source, /header-app-menu-icon/);
});
