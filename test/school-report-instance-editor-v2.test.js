const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('report instance V2 route and controller wiring are present and access-gated', () => {
  const routeSource = read('packages/school/MVC/routes/reportRoutes.js');
  const controllerSource = read('packages/school/MVC/controllers/school/reportController.js');

  assert.match(routeSource, /router\.get\('\/instances\/edit-v2\/:id'/);
  assert.match(routeSource, /router\.get\('\/instances\/edit-v2\/:id',[\s\S]*requireReportInstanceEditorAccess,[\s\S]*trackActionState\(REPORT_INSTANCE_SECTION,\s*OPERATIONS\.UPDATE\),[\s\S]*ctrl\.showInstanceEditorV2\);/);

  assert.match(controllerSource, /async function buildInstanceEditorRenderContext\(req\)/);
  assert.match(controllerSource, /async function showInstanceEditorV2\(req,\s*res\)/);
  assert.match(controllerSource, /res\.render\('school\/report\/instanceEditorV2',\s*renderContext\);/);
  assert.match(controllerSource, /showInstanceEditorV2,/);
});

test('instance editor V2 view delegates to shared editor template', () => {
  const v2ViewSource = read('packages/school/MVC/views/school/report/instanceEditorV2.ejs');
  assert.match(v2ViewSource, /include\('school\/report\/instanceEditor',\s*\{\s*editorVariant:\s*'v2'\s*\}\)/);
});

test('shared editor template has V2-only streamlined toolbar and essential details card', () => {
  const viewSource = read('packages/school/MVC/views/school/report/instanceEditor.ejs');

  assert.match(viewSource, /<% if \(!isV2\) { %>[\s\S]*Instances/);
  assert.match(viewSource, /<% if \(!isV2\) { %>[\s\S]*Class Lifecycle/);
  assert.match(viewSource, /<% if \(!isV2\) { %>[\s\S]*Export Payload/);

  const detailsStart = viewSource.indexOf('<% if (isV2) { %>');
  const detailsEnd = viewSource.indexOf('<% } else { %>', detailsStart);
  assert.notEqual(detailsStart, -1);
  assert.notEqual(detailsEnd, -1);
  const v2DetailsBlock = viewSource.slice(detailsStart, detailsEnd);
  assert.ok(v2DetailsBlock.includes('Status'));
  assert.ok(v2DetailsBlock.includes('Teacher'));
  assert.ok(v2DetailsBlock.includes('Class'));
  assert.ok(v2DetailsBlock.includes('Session Date'));
  assert.ok(v2DetailsBlock.includes('Student'));
  assert.ok(v2DetailsBlock.includes('Assignment'));
  assert.equal(v2DetailsBlock.includes('Template'), false);
  assert.equal(v2DetailsBlock.includes('Target'), false);
});

test('shared editor template uses tooltip help markers for V2 instead of inline help text', () => {
  const viewSource = read('packages/school/MVC/views/school/report/instanceEditor.ejs');

  assert.match(viewSource, /if \(isV2 && group\.header\.helpText\)[\s\S]*data-bs-toggle="tooltip"/);
  assert.match(viewSource, /if \(isV2 && field\.helpText\)[\s\S]*data-bs-toggle="tooltip"/);
  assert.match(viewSource, /if \(!isV2 && field\.helpText\)/);
  assert.match(viewSource, /function initializeTooltips\(\)/);
  assert.match(viewSource, /initializeTooltips\(\);/);
});

test('shared editor template has V2 previous report navigator button, modal, and guarded links', () => {
  const viewSource = read('packages/school/MVC/views/school/report/instanceEditor.ejs');

  assert.match(viewSource, /<% \} else \{ %>[\s\S]*id="btnReviewPreviousReports"[\s\S]*Review Previous Reports/);
  assert.match(viewSource, /id="reportReviewNavigatorModal"/);
  assert.match(viewSource, /href="<%= row\.href %>"/);
  assert.match(viewSource, /class="btn btn-outline-primary btn-sm js-report-review-nav-link"[\s\S]*Open V2/);
  assert.match(viewSource, /function bindReportReviewNavigatorLinks\(\)/);
  assert.match(viewSource, /confirmLeave\([\s\S]*Open another report\?/);
  assert.match(viewSource, /bindReportReviewNavigatorLinks\(\);/);
});

test('instance list and master hub report instance actions include Open V2 links', () => {
  const instanceListSource = read('packages/school/MVC/views/school/report/instanceList.ejs');
  const masterHubServiceSource = read('packages/school/MVC/services/school/schoolMasterAcademiaHubService.js');

  assert.match(instanceListSource, /\/school\/reports\/instances\/edit-v2\/<%= row\.id %>/);
  assert.match(instanceListSource, />Open V2</);
  assert.match(instanceListSource, /name="assignmentRowId"/);
  assert.match(instanceListSource, /name="sessionId"/);
  assert.match(instanceListSource, /name="sessionDate"/);
  assert.match(instanceListSource, /name="autoOpenSingle"/);

  assert.match(masterHubServiceSource, /label:\s*'Open V2'/);
  assert.match(masterHubServiceSource, /\/school\/reports\/instances\/edit-v2\/\$\{encodedInstanceId\}/);
});
