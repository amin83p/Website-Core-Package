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

test('header shows About the app menu item before Sign Out when buildVersionShort is provided', () => {
  const html = renderHeader({ buildVersionShort: 'abc123' });
  const aboutIndex = html.indexOf('About the app');
  const signoutIndex = html.indexOf('Sign Out');

  assert.ok(aboutIndex >= 0, 'expected About the app menu item to be rendered');
  assert.ok(signoutIndex >= 0, 'expected Sign Out row to be rendered');
  assert.ok(aboutIndex < signoutIndex, 'expected About the app to appear before Sign Out');
  assert.match(html, /data-bs-target="#aboutAppModal"/);
});

test('header shows committed and running-since labels in About modal when provided', () => {
  const html = renderHeader({
    buildVersionShort: 'abc123',
    buildVersionCommitAtLabel: 'Aug 25, 2026 4:35 PM',
    buildVersionStartedAtLabel: 'Aug 25, 2026 4:40 PM'
  });

  assert.match(html, /id="aboutAppModal"/);
  assert.match(html, /<code>abc123<\/code>/);
  assert.match(html, />Committed</);
  assert.match(html, />Aug 25, 2026 4:35 PM</);
  assert.match(html, />Running since</);
  assert.match(html, />Aug 25, 2026 4:40 PM</);
});

test('header hides committed label in About modal when commit label is empty', () => {
  const html = renderHeader({
    buildVersionShort: 'abc123',
    buildVersionCommitAtLabel: '',
    buildVersionStartedAtLabel: 'Aug 25, 2026 4:40 PM'
  });

  assert.equal(html.includes('>Committed<'), false);
  assert.match(html, />Running since</);
  assert.match(html, />Aug 25, 2026 4:40 PM</);
});

test('header hides About the app menu item and modal when buildVersionShort is empty', () => {
  const html = renderHeader({ buildVersionShort: '' });
  assert.equal(html.includes('About the app'), false);
  assert.equal(html.includes('id="aboutAppModal"'), false);
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
