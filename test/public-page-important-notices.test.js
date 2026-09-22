const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const dataService = require('../MVC/services/publicPageContentSettingsDataService');

test('normalizeContent includes importantNotices defaults when missing', () => {
  const model = dataService.normalizeContent({});
  assert.ok(model.importantNotices, 'importantNotices section should exist');
  assert.equal(model.importantNotices.hero.title, 'Important Notices');
  assert.ok(Array.isArray(model.importantNotices.notices));
  assert.ok(model.importantNotices.notices.length >= 3);
  assert.ok(model.importantNotices.resourcePanel.links.length >= 1);
});

test('parseSubmittedContent accepts importantNotices payload', () => {
  const payload = {
    importantNotices: {
      hero: { title: 'Custom Notices Title' },
      notices: [{ title: 'Test notice', summary: 'Summary', body: ['Body'], active: true, order: 10 }]
    }
  };
  const parsed = dataService.normalizeContent(payload);
  assert.equal(parsed.importantNotices.hero.title, 'Custom Notices Title');
  assert.equal(parsed.importantNotices.notices[0].title, 'Test notice');
});

test('home route and public view are wired for Important Notices', () => {
  const routes = readText('MVC/routes/homeRoutes.js');
  assert.match(routes, /\/important-notices/);
  assert.match(routes, /importantNotices/);

  const view = readText('MVC/views/importantNotices.ejs');
  assert.match(view, /pte-public-page/);
  assert.match(view, /importantNoticesContent/);
  assert.match(view, /offer-hero-top pte-hero-copy/);
  assert.match(view, /pte-hero-copy h1/);
  assert.match(view, /notices-toc/);
  assert.match(view, /important-notices-public-body/);
  assert.match(view, /important-notices-page::before/);
  assert.match(view, /linear-gradient\(135deg, #f8fbff/);
  assert.doesNotMatch(view, /background-attachment:\s*fixed/);

  const branding = readText('MVC/services/appBrandingService.js');
  assert.match(branding, /\/important-notices/);

  const settingsView = readText('MVC/views/systemSettings/publicPageContentSettings.ejs');
  assert.match(settingsView, /important-notices-content-pane/);
  assert.match(settingsView, /importantNotices\.notices/);
});
