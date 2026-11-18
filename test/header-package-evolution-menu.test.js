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
    user: { id: 'USER_1', name: 'Admin', canSwitchProfile: false },
    appBrand: {},
    siteWarnings: [],
    publicMenu: [],
    chatAccess: { canRead: false, canReadAll: false },
    buildVersionShort: '',
    ...locals
  });
}

test('header shows Package evolution when canViewPackageEvolution is true', () => {
  const html = renderHeader({ canViewPackageEvolution: true });
  assert.match(html, /Package evolution/);
  assert.match(html, /href="\/package-evolution"/);
});

test('header hides Package evolution when canViewPackageEvolution is false', () => {
  const html = renderHeader({ canViewPackageEvolution: false });
  assert.equal(html.includes('Package evolution'), false);
});